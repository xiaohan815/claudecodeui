/**
 * Channel PTY Manager
 *
 * Manages persistent PTY sessions for channels to avoid re-reading
 * session history from disk on every message.
 */

import pty from 'node-pty';
import os from 'os';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Session storage: key -> session object
const channelPtySessions = new Map();

// Claude CLI prompt pattern (❯ U+276F)
const CLAUDE_PROMPT_PATTERN = /❯\s*$/m;
const FALLBACK_PROMPT_PATTERN = /^>\s*$/m;

/**
 * ANSI escape sequence patterns
 * 
 * This comprehensive regex pattern matches all ANSI escape sequences including:
 * - CSI sequences (Control Sequence Introducer): ESC [ ... letter
 * - OSC sequences (Operating System Command): ESC ] ... (BEL or ESC \)
 * - Other escape sequences: ESC followed by single character
 * 
 * Based on the ANSI escape code specification and the strip-ansi npm package.
 * Reference: https://github.com/chalk/strip-ansi
 */
const ANSI_REGEX = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

// Control characters (carriage return, line feed, bell, etc.)
const CONTROL_CHARS = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;

// Braille patterns used in CLI spinners (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
const SPINNER_CHARS = /[⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿◐◑◒◓◔◕⏺]/g;

// Box drawing and decorative Unicode characters used in CLI output
const BOX_DRAWING_CHARS = /[✢✣✤✥✦✧✨✩✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊❋]/g;

// Arrow and special symbols
const ARROW_CHARS = /[↑↓←→↔↕↖↗↘↙]/g;

// Stable window for prompt detection (ms)
// Increased to 3000ms to ensure Claude CLI has finished writing to JSONL files
// Claude CLI shows status messages first, then the actual response, then writes to JSONL
const PROMPT_STABLE_WINDOW_MS = 3000;

// Default timeout for AI responses
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Session structure:
 * {
 *   key: string,
 *   pty: IPty,
 *   claudeSessionId: string | null,
 *   status: 'starting' | 'idle' | 'busy' | 'dead',
 *   outputBuffer: string,
 *   pendingResolvers: Array<{ resolve, reject, timer }>,
 *   timeoutId: NodeJS.Timeout | null,
 *   channelName: string,
 *   chatId: string,
 *   cwd: string,
 *   createdAt: Date,
 *   lastActiveAt: Date,
 *   lastProcessedMessageIndex: number,  // Track last processed message to detect new ones
 *   proactiveCallback: Function | null,  // Callback for proactive push
 * }
 */

/**
 * Strip ANSI escape sequences and terminal control characters
 * 
 * This function removes:
 * - All ANSI escape sequences (colors, cursor movement, etc.)
 * - Control characters (carriage return, bell, etc.)
 * - Spinner/progress indicator characters (Braille patterns)
 * - Box drawing and decorative Unicode characters
 * - Arrow symbols
 * 
 * Based on the strip-ansi package approach but extended for CLI-specific characters.
 */
function stripAnsi(text) {
  if (!text || typeof text !== 'string') return '';
  
  let cleaned = text;
  
  // Remove ANSI escape sequences
  cleaned = cleaned.replace(ANSI_REGEX, '');
  
  // Remove control characters (including \r, \n will be handled separately)
  // Keep \n (0x0A) but remove \r (0x0D) and others
  cleaned = cleaned.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  
  // Remove spinner and special characters
  cleaned = cleaned.replace(SPINNER_CHARS, '');
  cleaned = cleaned.replace(BOX_DRAWING_CHARS, '');
  cleaned = cleaned.replace(ARROW_CHARS, '');
  
  // Remove excessive spaces (multiple spaces to single space)
  cleaned = cleaned.replace(/ {2,}/g, ' ');
  
  return cleaned;
}

/**
 * Generate session key
 */
function makeSessionKey(channelName, chatId) {
  return `${channelName}:${chatId}`;
}

/**
 * Read all assistant messages from session JSONL files
 * Returns array of messages with their indices
 * 
 * @returns {Array<Object>} Array of { index, content, stopReason }
 */
async function getAllAssistantMessages(sessionId) {
  if (!sessionId) {
    return [];
  }

  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    
    try {
      await fs.promises.access(projectsDir);
    } catch (error) {
      return [];
    }

    const projects = await fs.promises.readdir(projectsDir);

    for (const projectName of projects) {
      const projectDir = path.join(projectsDir, projectName);
      const stat = await fs.promises.stat(projectDir);
      
      if (!stat.isDirectory()) continue;

      const files = await fs.promises.readdir(projectDir);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

      for (const file of jsonlFiles) {
        const jsonlPath = path.join(projectDir, file);
        
        const fileStream = fs.createReadStream(jsonlPath);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        const messages = [];
        let lineIndex = 0;
        
        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);
              if (entry.sessionId === sessionId) {
                messages.push({ ...entry, lineIndex });
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
          lineIndex++;
        }

        if (messages.length === 0) continue;

        // Extract all assistant messages
        const assistantMessages = [];
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          if (msg.message?.role === 'assistant' && msg.message?.content) {
            const stopReason = msg.message.stop_reason || 'unknown';
            
            // Extract text content
            if (Array.isArray(msg.message.content)) {
              const textParts = msg.message.content
                .filter(part => part.type === 'text' && part.text)
                .map(part => part.text);
              
              if (textParts.length > 0) {
                assistantMessages.push({
                  index: i,
                  content: textParts.join('\n'),
                  stopReason,
                });
              }
            } else if (typeof msg.message.content === 'string') {
              assistantMessages.push({
                index: i,
                content: msg.message.content,
                stopReason,
              });
            }
          }
        }

        if (assistantMessages.length > 0) {
          return assistantMessages;
        }
      }
    }

    return [];
  } catch (error) {
    console.error('[ChannelPTY] Error reading all messages:', error.message);
    return [];
  }
}

/**
 * Check for proactive messages (scheduled tasks)
 * Called when session is idle and receives new output
 */
async function checkForProactiveMessage(session) {
  if (!session.claudeSessionId) {
    session.outputBuffer = '';
    session.stableWindowTimer = null;
    return;
  }

  // Get all assistant messages
  const allMessages = await getAllAssistantMessages(session.claudeSessionId);
  
  if (allMessages.length === 0) {
    session.outputBuffer = '';
    session.stableWindowTimer = null;
    return;
  }

  // Check if there's a new message since last check
  const lastMessage = allMessages[allMessages.length - 1];
  
  if (lastMessage.index > session.lastProcessedMessageIndex) {
    console.log(`[ChannelPTY] Proactive message detected for ${session.key}`);
    
    // Update last processed index
    session.lastProcessedMessageIndex = lastMessage.index;
    
    // Call proactive callback if set
    if (session.proactiveCallback) {
      try {
        await session.proactiveCallback({
          chatId: session.chatId,
          content: lastMessage.content,
          sessionId: session.claudeSessionId,
        });
      } catch (error) {
        console.error(`[ChannelPTY] Proactive callback error:`, error.message);
      }
    }
  }

  session.outputBuffer = '';
  session.stableWindowTimer = null;
}

/**
 * Find session ID by looking for the most recently modified JSONL file in the project directory
 * This is useful when session ID is not extracted from PTY output
 */
async function findLatestSessionId(cwd) {
  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    
    // Normalize cwd to match project directory name
    // Claude CLI replaces both / and _ with -
    const normalizedCwd = cwd.replace(/^\//, '').replace(/[/_]/g, '-');
    const projectDir = path.join(projectsDir, `-${normalizedCwd}`);
    
    try {
      await fs.promises.access(projectDir);
    } catch (error) {
      return null;
    }

    const files = await fs.promises.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
    
    if (jsonlFiles.length === 0) return null;

    // Get file stats and sort by modification time
    const fileStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stat = await fs.promises.stat(filePath);
        return { file, mtime: stat.mtime };
      })
    );

    // Sort by modification time (newest first)
    fileStats.sort((a, b) => b.mtime - a.mtime);

    // Extract session ID from filename (remove .jsonl extension)
    const latestFile = fileStats[0].file;
    const sessionId = latestFile.replace('.jsonl', '');
    
    return sessionId;
  } catch (error) {
    console.error('[ChannelPTY] Error finding latest session ID:', error.message);
    return null;
  }
}

/**
 * Read the last assistant message from session JSONL files
 * This is more reliable than parsing PTY output
 * 
 * @returns {Object|null} { content: string, stopReason: string, hasMoreSteps: boolean }
 */
async function getLastAssistantMessage(sessionId) {
  if (!sessionId) {
    return null;
  }

  try {
    // Find the project directory that contains this session
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    
    // Check if projects directory exists
    try {
      await fs.promises.access(projectsDir);
    } catch (error) {
      console.log('[ChannelPTY] Projects directory not found');
      return null;
    }

    const projects = await fs.promises.readdir(projectsDir);

    for (const projectName of projects) {
      const projectDir = path.join(projectsDir, projectName);
      const stat = await fs.promises.stat(projectDir);
      
      if (!stat.isDirectory()) continue;

      // Read all JSONL files in this project
      const files = await fs.promises.readdir(projectDir);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

      for (const file of jsonlFiles) {
        const jsonlPath = path.join(projectDir, file);
        
        const fileStream = fs.createReadStream(jsonlPath);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        const messages = [];
        
        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);
              if (entry.sessionId === sessionId) {
                messages.push(entry);
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }

        // Find the last assistant message
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.message?.role === 'assistant' && msg.message?.content) {
            const stopReason = msg.message.stop_reason || 'unknown';
            const hasMoreSteps = stopReason === 'tool_use';
            
            // Extract text content from assistant message
            if (Array.isArray(msg.message.content)) {
              const textParts = msg.message.content
                .filter(part => part.type === 'text' && part.text)
                .map(part => part.text);
              
              if (textParts.length > 0) {
                const content = textParts.join('\n');
                return { content, stopReason, hasMoreSteps };
              }
              
              // If no text content but has tool_use, it means AI is executing tools
              if (hasMoreSteps) {
                return { content: '', stopReason, hasMoreSteps };
              }
            } else if (typeof msg.message.content === 'string') {
              return { content: msg.message.content, stopReason, hasMoreSteps };
            }
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error('[ChannelPTY] Error reading JSONL:', error.message);
    return null;
  }
}

/**
 * Extract response from PTY output
 * Cleans up Claude CLI output by:
 * 1. Removing ANSI escape sequences and control characters
 * 2. Removing the prompt line (❯)
 * 3. Removing the user's input echo
 * 4. Removing progress indicators and status lines
 */
function extractResponse(rawOutput) {
  console.log('[ChannelPTY] ===== Extract Response Start =====');
  console.log('[ChannelPTY] Raw output length:', rawOutput.length);
  console.log('[ChannelPTY] Raw output (full):\n', rawOutput);
  
  // 1. Strip ANSI escape sequences and special characters
  let text = stripAnsi(rawOutput);
  console.log('[ChannelPTY] After stripAnsi length:', text.length);
  console.log('[ChannelPTY] After stripAnsi (full):\n', text);

  // 2. Find last prompt position
  const promptIdx = text.lastIndexOf('❯');
  if (promptIdx !== -1) {
    console.log('[ChannelPTY] Found prompt at position:', promptIdx);
    text = text.slice(0, promptIdx);
  } else {
    console.log('[ChannelPTY] No prompt found');
  }

  // 3. Split into lines
  const lines = text.split('\n');
  console.log('[ChannelPTY] Total lines:', lines.length);
  console.log('[ChannelPTY] All lines:', JSON.stringify(lines, null, 2));
  
  // 4. Find actual response content
  // Look for lines that contain actual text (not just status/metadata)
  // The actual response usually contains Chinese/English sentences
  const contentLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;
    
    // Skip status lines
    if (/^(Cultivating|Hyperspacing|Thinking|Composing)…/.test(trimmed)) {
      console.log(`[ChannelPTY] Line ${i}: SKIP (status) - "${trimmed.substring(0, 50)}"`);
      continue;
    }
    
    // Skip separator lines
    if (/^─+$/.test(trimmed) || /^-+$/.test(trimmed)) {
      console.log(`[ChannelPTY] Line ${i}: SKIP (separator)`);
      continue;
    }
    
    // Skip metadata lines
    if (/^(medium|low|high)·\/effort/.test(trimmed) || 
        /thinking\)/.test(trimmed) ||
        /runing stophook/.test(trimmed) ||
        /thought for \d+s\)/.test(trimmed)) {
      console.log(`[ChannelPTY] Line ${i}: SKIP (metadata) - "${trimmed.substring(0, 50)}"`);
      continue;
    }
    
    // Skip "Claude Code" lines
    if (trimmed === 'Claude Code' || trimmed === '; Claude Code') {
      console.log(`[ChannelPTY] Line ${i}: SKIP (Claude Code)`);
      continue;
    }
    
    // Skip lines with only special characters
    if (/^[·•↓↑→←\s;❯]+$/.test(trimmed)) {
      console.log(`[ChannelPTY] Line ${i}: SKIP (special chars)`);
      continue;
    }
    
    // Skip progress indicators
    if (/^\d+[smh]\s*[·•]\s*/.test(trimmed)) {
      console.log(`[ChannelPTY] Line ${i}: SKIP (progress)`);
      continue;
    }
    
    // Extract actual content from lines that contain it
    // Pattern: sometimes the response is embedded like "⏺你好！有什么我可以帮助你的吗？ Composing…"
    // We need to extract just the middle part
    let content = trimmed;
    
    // Remove leading prompt/status
    content = content.replace(/^[❯\s]+/, '');
    
    // Remove trailing status like "Composing… (thought for 2s)"
    content = content.replace(/\s*(Composing|Thinking|Hyperspacing)….*$/i, '');
    
    // Remove "thought for Xs)" at the end
    content = content.replace(/\s*\(thought for \d+s\)\s*$/i, '');
    
    // Remove leading/trailing metadata
    content = content.replace(/^(medium|low|high)·\/effort\s*/i, '');
    content = content.replace(/\s*runing stophook.*$/i, '');
    
    content = content.trim();
    
    // If there's actual content left (not just punctuation/symbols)
    if (content && content.length > 0 && !/^[·•;❯\s]+$/.test(content)) {
      console.log(`[ChannelPTY] Line ${i}: KEEP - "${content}"`);
      contentLines.push(content);
    } else {
      console.log(`[ChannelPTY] Line ${i}: SKIP (no content after cleaning) - original: "${trimmed.substring(0, 50)}"`);
    }
  }

  console.log('[ChannelPTY] Content lines count:', contentLines.length);
  console.log('[ChannelPTY] Content lines:', JSON.stringify(contentLines, null, 2));

  // 5. Remove the first line if it looks like user input echo
  if (contentLines.length > 0) {
    const firstLine = contentLines[0].trim();
    console.log('[ChannelPTY] First content line check:', firstLine);
    // If first line is very short (< 20 chars) and doesn't look like a sentence, it's likely the echo
    if (firstLine.length < 20 && !/[。！？.!?]/.test(firstLine)) {
      console.log('[ChannelPTY] Removing first line (likely user input echo)');
      contentLines.shift();
    }
  }

  // 6. Join and trim
  const result = contentLines.join('\n').trim();
  console.log('[ChannelPTY] Final result length:', result.length);
  console.log('[ChannelPTY] Final result:\n', result);
  console.log('[ChannelPTY] ===== Extract Response End =====');
  
  return result;
}

/**
 * Check if output contains a complete response
 * A complete response has a prompt (❯)
 */
function hasPrompt(text) {
  const cleaned = stripAnsi(text);
  
  // Check for Claude prompt (❯)
  if (CLAUDE_PROMPT_PATTERN.test(cleaned)) {
    return true;
  }
  
  // Try fallback prompt
  if (FALLBACK_PROMPT_PATTERN.test(cleaned)) {
    return true;
  }
  
  return false;
}

/**
 * Get or create a PTY session
 */
async function getOrCreateSession(channelName, chatId, config = {}) {
  const key = makeSessionKey(channelName, chatId);
  const existing = channelPtySessions.get(key);

  if (existing && existing.status !== 'dead') {
    console.log(`[ChannelPTY] Reusing session: ${key}`);
    return existing;
  }

  console.log(`[ChannelPTY] Creating new session: ${key}`);

  const { cwd = os.homedir(), model, claudeSessionId = null } = config;

  // Build shell command
  let shellCommand;
  if (claudeSessionId) {
    shellCommand = `claude --resume "${claudeSessionId}"`;
  } else {
    shellCommand = 'claude';
  }

  if (model) {
    shellCommand += ` --model "${model}"`;
  }
  
  // Add permission bypass for channel automation (auto-approve all tool uses)
  shellCommand += ' --permission-mode bypassPermissions';

  console.log(`[ChannelPTY] Shell command: ${shellCommand}`);

  // Environment variables
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CLAUDECODE_NONINTERACTIVE_HINTS: '1',
  };

  // Spawn PTY
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const shellArgs = os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];

  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env,
  });

  const session = {
    key,
    pty: ptyProcess,
    claudeSessionId,
    status: 'starting',
    outputBuffer: '',
    pendingResolvers: [],
    timeoutId: null,
    stableWindowTimer: null,  // Timer for stable window detection
    channelName,
    chatId,
    cwd,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    lastProcessedMessageIndex: -1,  // Track last processed message
    proactiveCallback: null,  // Callback for proactive push
  };

  channelPtySessions.set(key, session);

  // Handle PTY data
  ptyProcess.onData((data) => {
    session.outputBuffer += data;

    // Try to extract session ID from startup output
    if (!session.claudeSessionId && session.status === 'starting') {
      // Look for session ID in various formats:
      // - "Session: claude_xxxxx"
      // - "session_id: claude_xxxxx"
      // - Starting with claude_ followed by alphanumeric
      const sessionMatch = session.outputBuffer.match(/(?:session[_\s:]+|^|\s)(claude_[a-zA-Z0-9_-]+)/i);
      if (sessionMatch) {
        session.claudeSessionId = sessionMatch[1];
        console.log(`[ChannelPTY] Extracted session ID: ${session.claudeSessionId}`);
      }
    }

    // Check for proactive messages (scheduled tasks) when idle
    if (session.status === 'idle' && session.pendingResolvers.length === 0) {
      // Clear any existing stable window timer
      if (session.stableWindowTimer) {
        clearTimeout(session.stableWindowTimer);
      }
      
      // Check for prompt
      if (hasPrompt(session.outputBuffer)) {
        // Set a stable window timer for proactive detection
        session.stableWindowTimer = setTimeout(async () => {
          await checkForProactiveMessage(session);
        }, PROMPT_STABLE_WINDOW_MS);
      }
    }

    // Check if we have pending resolvers
    if (session.pendingResolvers.length > 0) {
      // Clear any existing stable window timer
      if (session.stableWindowTimer) {
        clearTimeout(session.stableWindowTimer);
      }
      
      // Check for prompt
      if (hasPrompt(session.outputBuffer)) {
        // Set a new stable window timer
        // This timer resets every time new data arrives
        // Only when no new data for PROMPT_STABLE_WINDOW_MS, we extract the response
        session.stableWindowTimer = setTimeout(async () => {
          if (session.pendingResolvers.length > 0 && hasPrompt(session.outputBuffer)) {
            console.log(`[ChannelPTY] Response complete, processing...`);
            
            // Instead of parsing PTY output, read from JSONL file
            // Try to get session ID from: 1) session object, 2) find latest JSONL file
            let sessionIdToUse = session.claudeSessionId;
            if (!sessionIdToUse) {
              sessionIdToUse = await findLatestSessionId(session.cwd);
              if (sessionIdToUse) {
                session.claudeSessionId = sessionIdToUse;
              }
            }
            
            const result = sessionIdToUse ? await getLastAssistantMessage(sessionIdToUse) : null;
            
            if (result && result.hasMoreSteps) {
              // AI is still executing tools, wait for next prompt
              console.log(`[ChannelPTY] Tool execution in progress, waiting...`);
              session.outputBuffer = '';
              session.stableWindowTimer = null;
              // Don't resolve yet, keep the resolver in the queue
              // The next prompt will trigger another stable window check
              return;
            }
            
            const resolver = session.pendingResolvers.shift();
            if (resolver.timer) clearTimeout(resolver.timer);
            
            // Skip queued messages in the resolver list
            while (session.pendingResolvers.length > 0 && session.pendingResolvers[0].type === 'queued') {
              // Don't process queued messages here, they will be processed by processNextQueuedMessage
              break;
            }
            
            if (result && result.content) {
              console.log(`[ChannelPTY] Response received (${result.content.length} chars)`);
              
              // Update lastProcessedMessageIndex to track this message
              const allMessages = await getAllAssistantMessages(session.claudeSessionId);
              if (allMessages.length > 0) {
                session.lastProcessedMessageIndex = allMessages[allMessages.length - 1].index;
              }
              
              session.outputBuffer = '';
              session.status = 'idle';
              session.lastActiveAt = new Date();
              session.stableWindowTimer = null;
              resolver.resolve({ content: result.content, sessionId: session.claudeSessionId });
            } else if (result && !result.content && !result.hasMoreSteps) {
              // No content but also no more steps - might be an error
              console.log(`[ChannelPTY] No content from JSONL, using fallback`);
              const fallbackContent = extractResponse(session.outputBuffer);
              session.outputBuffer = '';
              session.status = 'idle';
              session.lastActiveAt = new Date();
              session.stableWindowTimer = null;
              resolver.resolve({ content: fallbackContent, sessionId: session.claudeSessionId });
            } else {
              console.log(`[ChannelPTY] JSONL read failed, using fallback`);
              // Fallback to PTY output parsing if JSONL read fails
              const fallbackContent = extractResponse(session.outputBuffer);
              session.outputBuffer = '';
              session.status = 'idle';
              session.lastActiveAt = new Date();
              session.stableWindowTimer = null;
              resolver.resolve({ content: fallbackContent, sessionId: session.claudeSessionId });
            }
          }
        }, PROMPT_STABLE_WINDOW_MS);
      }
    }
  });

  // Handle PTY exit
  ptyProcess.onExit((exitCode) => {
    console.log(`[ChannelPTY] Session ${key} exited with code:`, exitCode.exitCode);
    session.status = 'dead';

    // Reject all pending resolvers
    while (session.pendingResolvers.length > 0) {
      const resolver = session.pendingResolvers.shift();
      if (resolver.timer) clearTimeout(resolver.timer);
      resolver.reject(new Error('PTY process exited unexpectedly'));
    }

    // Clean up timeout
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }

    channelPtySessions.delete(key);
  });

  // Wait for initial prompt (session ready)
  await new Promise((resolve, reject) => {
    const startTimeout = setTimeout(() => {
      reject(new Error('PTY session startup timeout'));
    }, 30000); // 30 seconds

    const checkReady = () => {
      if (hasPrompt(session.outputBuffer)) {
        clearTimeout(startTimeout);
        session.outputBuffer = ''; // Clear startup output
        session.status = 'idle';
        resolve();
      } else {
        setTimeout(checkReady, 100);
      }
    };

    checkReady();
  });

  console.log(`[ChannelPTY] Session ${key} ready`);
  return session;
}

/**
 * Set idle timeout for a session
 */
function setIdleTimeout(session, timeoutMinutes) {
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
  }

  session.timeoutId = setTimeout(() => {
    console.log(`[ChannelPTY] Session ${session.key} idle timeout, destroying`);
    destroySession(session.key);
  }, timeoutMinutes * 60 * 1000);
}

/**
 * Send a message to a PTY session and wait for response
 */
async function sendMessage(channelName, chatId, prompt, options = {}) {
  const { cwd, model, timeoutMs = DEFAULT_TIMEOUT_MS, claudeSessionId, idleTimeoutMinutes = 30 } = options;

  console.log(`[ChannelPTY] sendMessage called for ${channelName}:${chatId}`);
  console.log(`[ChannelPTY] Prompt: "${prompt.substring(0, 100)}"`);
  console.log(`[ChannelPTY] Options:`, { cwd, model, timeoutMs, claudeSessionId, idleTimeoutMinutes });

  const session = await getOrCreateSession(channelName, chatId, {
    cwd,
    model,
    claudeSessionId,
  });

  if (session.status === 'dead') {
    console.log(`[ChannelPTY] Session is dead`);
    throw new Error('PTY session is dead');
  }

  // Improved queueing mechanism
  if (session.status === 'busy') {
    console.log(`[ChannelPTY] Session is busy, queueing message (current queue size: ${session.pendingResolvers.length})`);
    
    // Add to queue and wait
    return new Promise((resolve, reject) => {
      const queueTimer = setTimeout(() => {
        console.log(`[ChannelPTY] Queued message timeout after ${timeoutMs}ms`);
        reject(new Error('Timeout waiting for session to become available'));
      }, timeoutMs);
      
      // Add a special queue entry
      session.pendingResolvers.push({
        type: 'queued',
        prompt,
        options,
        resolve: (result) => {
          clearTimeout(queueTimer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(queueTimer);
          reject(error);
        },
        timer: queueTimer,
      });
      
      console.log(`[ChannelPTY] Message queued, total pending: ${session.pendingResolvers.length}`);
    });
  }

  console.log(`[ChannelPTY] Session status: ${session.status}`);
  session.status = 'busy';
  session.lastActiveAt = new Date();

  // Clear idle timeout
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }

  // Send message to PTY
  console.log(`[ChannelPTY] Writing to PTY: "${prompt}"`);
  session.pty.write(prompt + '\r');
  console.log(`[ChannelPTY] Message sent, waiting for response (timeout: ${timeoutMs}ms)`);

  // Wait for response
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log(`[ChannelPTY] Response timeout after ${timeoutMs}ms`);
      // Remove from pending resolvers
      const index = session.pendingResolvers.findIndex(r => r.timer === timer);
      if (index !== -1) {
        session.pendingResolvers.splice(index, 1);
      }
      session.status = 'idle';
      
      // Process next queued message if any
      processNextQueuedMessage(session);
      
      reject(new Error('PTY response timeout'));
    }, timeoutMs);

    session.pendingResolvers.push({ 
      type: 'active',
      resolve: (result) => {
        console.log(`[ChannelPTY] Response received, setting idle timeout to ${idleTimeoutMinutes} minutes`);
        // Set idle timeout after successful response
        setIdleTimeout(session, idleTimeoutMinutes);
        
        // Process next queued message if any
        processNextQueuedMessage(session);
        
        resolve(result);
      }, 
      reject: (error) => {
        // Process next queued message even on error
        processNextQueuedMessage(session);
        reject(error);
      },
      timer 
    });
    console.log(`[ChannelPTY] Added resolver to pending queue (total: ${session.pendingResolvers.length})`);
  });
}

/**
 * Process the next queued message if any
 */
function processNextQueuedMessage(session) {
  // Find the first queued message
  const queuedIndex = session.pendingResolvers.findIndex(r => r.type === 'queued');
  
  if (queuedIndex === -1) {
    console.log(`[ChannelPTY] No queued messages, session going idle`);
    return;
  }
  
  const queued = session.pendingResolvers[queuedIndex];
  session.pendingResolvers.splice(queuedIndex, 1);
  
  console.log(`[ChannelPTY] Processing queued message: "${queued.prompt.substring(0, 50)}"`);
  console.log(`[ChannelPTY] Remaining queued messages: ${session.pendingResolvers.filter(r => r.type === 'queued').length}`);
  
  // Process the queued message
  setImmediate(async () => {
    try {
      const result = await sendMessage(
        session.channelName,
        session.chatId,
        queued.prompt,
        queued.options
      );
      queued.resolve(result);
    } catch (error) {
      queued.reject(error);
    }
  });
}

/**
 * Destroy a specific session
 */
function destroySession(key) {
  const session = channelPtySessions.get(key);
  if (!session) return;

  console.log(`[ChannelPTY] Destroying session: ${key}`);

  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
  }
  
  if (session.stableWindowTimer) {
    clearTimeout(session.stableWindowTimer);
  }

  if (session.pty) {
    session.pty.kill();
  }

  channelPtySessions.delete(key);
}

/**
 * Destroy all sessions for a channel
 */
function destroyChannelSessions(channelName) {
  const keys = Array.from(channelPtySessions.keys()).filter(k => k.startsWith(`${channelName}:`));
  
  console.log(`[ChannelPTY] Destroying ${keys.length} sessions for channel: ${channelName}`);
  
  keys.forEach(key => destroySession(key));
}

/**
 * Get session status
 */
function getSessionStatus(channelName, chatId) {
  const key = makeSessionKey(channelName, chatId);
  const session = channelPtySessions.get(key);

  if (!session) return null;

  return {
    key: session.key,
    status: session.status,
    claudeSessionId: session.claudeSessionId,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    cwd: session.cwd,
  };
}

/**
 * List all sessions for a channel
 */
function listSessions(channelName) {
  const sessions = [];

  for (const [key, session] of channelPtySessions.entries()) {
    if (session.channelName === channelName) {
      sessions.push({
        key: session.key,
        chatId: session.chatId,
        status: session.status,
        claudeSessionId: session.claudeSessionId,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
      });
    }
  }

  return sessions;
}

/**
 * Set proactive callback for a session
 * This callback will be called when scheduled tasks generate new messages
 */
function setProactiveCallback(channelName, chatId, callback) {
  const key = makeSessionKey(channelName, chatId);
  const session = channelPtySessions.get(key);

  if (!session) {
    console.log(`[ChannelPTY] Cannot set proactive callback: session ${key} not found`);
    return false;
  }

  session.proactiveCallback = callback;
  console.log(`[ChannelPTY] Proactive callback set for session ${key}`);
  return true;
}

export {
  getOrCreateSession,
  sendMessage,
  destroySession,
  destroyChannelSessions,
  getSessionStatus,
  listSessions,
  setIdleTimeout,
  setProactiveCallback,
};
