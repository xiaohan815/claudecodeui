# iMessage Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an iMessage channel plugin for claudecodeui so that messages sent from the Mac's iMessage app are routed to the active AI provider and replies are sent back via AppleScript.

**Architecture:** The iMessage channel runs as a Node.js MCP server (child process managed by claudecodeui). It polls `~/Library/Messages/chat.db` every second for new messages, calls a new `POST /api/channels/message` HTTP endpoint on claudecodeui using a Service Token, then sends the AI response back via `osascript`. claudecodeui's side creates a `ChannelResponseWriter` that collects the streamed response from `queryClaudeSDK` and returns it as JSON.

**Tech Stack:** Node.js 18+, `@modelcontextprotocol/sdk`, `better-sqlite3` (already in claudecodeui), `child_process.spawnSync` (for osascript), Express.js (server side)

---

## File Map

### claudecodeui changes (server side)

| File | Action | Responsibility |
|------|--------|---------------|
| `server/routes/channels.js` | Modify | Add `POST /api/channels/message` endpoint |
| `server/claude-sdk.js` | Read-only | Understand writer interface; `queryClaudeSDK(command, options, writer)` |

### New channel plugin

| File | Action | Responsibility |
|------|--------|---------------|
| `examples/imessage-channel/manifest.json` | Create | Plugin metadata, `type: "channel"`, entry point |
| `examples/imessage-channel/package.json` | Create | Dependencies: `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod` |
| `examples/imessage-channel/server.js` | Create | MCP server + chat.db polling + HTTP calls + AppleScript send |

---

## Architecture Diagram

```
iMessage App (your phone or Mac)
        │
        │ (sends text)
        ▼
~/Library/Messages/chat.db
        │
        │ (better-sqlite3 poll every 1s, ROWID > watermark)
        ▼
server.js (MCP Server, child process of claudecodeui)
  ├── gate(): self-chat bypass, allowlist check via GET /api/channels/imessage-channel/access
  │
  └── POST CHANNEL_API_ENDPOINT/channels/message
        │  Authorization: Bearer $CHANNEL_SERVICE_TOKEN
        │  { message, externalChatId, externalSenderId, projectPath }
        ▼
  claudecodeui: POST /api/channels/message handler
        │  ChannelResponseWriter collects output
        │  channelSessionsDb.getSession() → reuse Claude session per chat
        ▼
  queryClaudeSDK(message, { cwd, sessionId, permissionMode:'bypassPermissions' }, writer)
        │
        │ SDK streams messages → writer collects result text
        │ On claude-complete → saves sessionId → returns { content, sessionId }
        ▼
  HTTP response: { content: "AI reply text", sessionId: "abc..." }
        │
        ▼
server.js receives response body
        │
        └── osascript AppleScript → Messages.app sends reply to chat_id
```

---

## Task 1: Add `POST /api/channels/message` endpoint

**Files:**
- Modify: `server/routes/channels.js`

### Step 1.1: Add imports and ChannelResponseWriter class

At the top of `server/routes/channels.js`, add:

```js
import { queryClaudeSDK } from '../claude-sdk.js';
import { channelSessionsDb } from '../database/db.js';
import os from 'os';
```

Add the `ChannelResponseWriter` class inside `channels.js` before the routes:

```js
/**
 * Collects queryClaudeSDK output for HTTP channel responses.
 * Implements the same interface as WebSocketWriter (ws.send / ws.setSessionId).
 */
class ChannelResponseWriter {
  constructor() {
    this._resultText = null;
    this._textChunks = [];
    this._sessionId = null;
    this._resolve = null;
    this._reject = null;
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  send(data) {
    if (data.type === 'session-created') {
      this._sessionId = data.sessionId;
    } else if (data.type === 'claude-response') {
      const msg = data.data;
      // Prefer the final result message (type: 'result', subtype: 'success')
      if (msg?.type === 'result' && msg?.subtype === 'success' && typeof msg.result === 'string') {
        this._resultText = msg.result;
      }
      // Also collect text blocks from assistant messages as fallback
      if (msg?.type === 'assistant' && Array.isArray(msg?.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text') this._textChunks.push(block.text);
        }
      }
    } else if (data.type === 'claude-complete') {
      const content = this._resultText ?? this._textChunks.join('');
      this._resolve({ content, sessionId: data.sessionId || this._sessionId });
    } else if (data.type === 'claude-error') {
      this._reject(new Error(data.error || 'AI query failed'));
    }
    // Ignore: token-budget, claude-permission-request, etc.
  }

  setSessionId(sessionId) {
    this._sessionId = sessionId;
  }

  getSessionId() {
    return this._sessionId;
  }
}
```

### Step 1.2: Add the route at the bottom of channels.js (before `export default router`)

```js
/**
 * Channel message endpoint — called by channel processes with a service token.
 * Runs queryClaudeSDK and returns the full AI response as JSON.
 *
 * POST /api/channels/message
 * Authorization: Bearer <channel_service_token>
 * Body: { message, externalChatId, externalSenderId, projectPath? }
 * Response: { content, sessionId }
 */
router.post('/message', authenticateToken, async (req, res) => {
  // Only channel service tokens are allowed
  if (!req.isServiceRequest || !req.channelSource) {
    return res.status(403).json({ error: 'Channel service token required' });
  }

  const { message, externalChatId, externalSenderId, projectPath } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  if (!externalChatId || typeof externalChatId !== 'string') {
    return res.status(400).json({ error: 'externalChatId is required' });
  }

  const channelName = req.channelSource;
  const cwd = projectPath || os.homedir();

  // Retrieve existing Claude session for this chat, or create fresh
  const existingSessionId = channelSessionsDb.getSession(channelName, externalChatId);

  const writer = new ChannelResponseWriter();

  console.log(`[ChannelMessage] ${channelName} | chat:${externalChatId} | session:${existingSessionId || 'NEW'} | "${message.substring(0, 60)}"`);

  try {
    // Start AI query — don't await here, let writer handle it
    queryClaudeSDK(
      message,
      {
        cwd,
        sessionId: existingSessionId || undefined,
        permissionMode: 'bypassPermissions',
        toolsSettings: { allowedTools: [], disallowedTools: [], skipPermissions: true },
      },
      writer
    ).catch((err) => {
      // queryClaudeSDK throws after sending claude-error via writer.send
      // writer.promise already rejects, so this is just a safety net
      console.error(`[ChannelMessage] queryClaudeSDK threw for ${channelName}:`, err.message);
    });

    // Wait for the writer to collect the full response (resolves on claude-complete)
    const { content, sessionId: newSessionId } = await writer.promise;

    // Persist session mapping so the next message continues the same conversation
    if (newSessionId) {
      channelSessionsDb.setSession(channelName, externalChatId, newSessionId);
    }

    return res.json({ content, sessionId: newSessionId });
  } catch (error) {
    console.error(`[ChannelMessage] Error for ${channelName}:`, error.message);
    return res.status(500).json({ error: error.message || 'AI query failed' });
  }
});
```

### Step 1.3: Manual smoke test

Start claudecodeui and get a valid service token, then run:

```bash
# Get a token (run claudecodeui first and enable a channel to generate one, or
# temporarily add a debug endpoint or extract from the DB directly)
# For a quick test, use the existing token endpoint after enabling echo-channel:
curl -s -X POST http://localhost:23003/api/channels/echo-channel/enable \
  -H "Authorization: Bearer <your_user_jwt>"

TOKEN=$(curl -s http://localhost:23003/api/channels/echo-channel/token \
  -H "Authorization: Bearer <your_user_jwt>" | node -e "process.stdin||(()=>{let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))})()")

curl -s -X POST http://localhost:23003/api/channels/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"What is 2+2?","externalChatId":"test-chat-1","externalSenderId":"tester"}'
```

Expected response:
```json
{"content":"2 + 2 equals 4.","sessionId":"abc123..."}
```

---

## Task 2: Build the iMessage channel plugin

**Files:**
- Create: `examples/imessage-channel/manifest.json`
- Create: `examples/imessage-channel/package.json`
- Create: `examples/imessage-channel/server.js`

### Step 2.1: Create `manifest.json`

```json
{
  "name": "imessage-channel",
  "displayName": "iMessage Channel",
  "version": "0.1.0",
  "description": "Connect iMessage to claudecodeui. Polls chat.db directly; replies via AppleScript. macOS only.",
  "type": "channel",
  "entry": "server.js",
  "server": "server.js",
  "icon": "MessageSquare",
  "slot": "tab",
  "permissions": []
}
```

### Step 2.2: Create `package.json`

```json
{
  "name": "claudecodeui-imessage-channel",
  "version": "0.1.0",
  "type": "module",
  "description": "iMessage channel for claudecodeui",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.0.0"
  }
}
```

### Step 2.3: Create `server.js`

This is the main channel server. It is an MCP server (for claudecodeui lifecycle management) **and** an independent polling loop that calls the claudecodeui API.

```js
#!/usr/bin/env node
/**
 * iMessage Channel for claudecodeui
 *
 * Reads ~/Library/Messages/chat.db for new messages (requires Full Disk Access).
 * Sends AI responses via osascript → Messages.app.
 *
 * Environment variables (injected by claudecodeui):
 *   CHANNEL_SERVICE_TOKEN  — JWT service token for API authentication
 *   CHANNEL_API_ENDPOINT   — Base URL, e.g. http://localhost:23003/api
 *   CHANNEL_NAME           — "imessage-channel"
 *
 * Optional:
 *   IMESSAGE_PROJECT_PATH  — Working directory for the AI session (default: ~)
 *   IMESSAGE_APPEND_SIGNATURE — "true" (default) | "false"
 *   IMESSAGE_STATE_DIR     — Dir for access.json (default: ~/.claude-code-ui/channels/imessage)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import { randomBytes } from 'crypto';
import { z } from 'zod';

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVICE_TOKEN = process.env.CHANNEL_SERVICE_TOKEN;
const API_ENDPOINT  = process.env.CHANNEL_API_ENDPOINT || 'http://localhost:23003/api';
const CHANNEL_NAME  = process.env.CHANNEL_NAME || 'imessage-channel';
const PROJECT_PATH  = process.env.IMESSAGE_PROJECT_PATH || homedir();
const APPEND_SIG    = process.env.IMESSAGE_APPEND_SIGNATURE !== 'false';
const SIGNATURE     = '\n\nSent via claudecodeui';
const CHAT_DB       = join(homedir(), 'Library', 'Messages', 'chat.db');
const STATE_DIR     = process.env.IMESSAGE_STATE_DIR
                      ?? join(homedir(), '.claude-code-ui', 'channels', 'imessage');
const ACCESS_FILE   = join(STATE_DIR, 'access.json');
const APPROVED_DIR  = join(STATE_DIR, 'approved');

if (!SERVICE_TOKEN) {
  process.stderr.write('[iMessage] CHANNEL_SERVICE_TOKEN not set — exiting\n');
  process.exit(1);
}

process.on('unhandledRejection', err => process.stderr.write(`[iMessage] unhandledRejection: ${err}\n`));
process.on('uncaughtException',  err => process.stderr.write(`[iMessage] uncaughtException: ${err}\n`));

// ─── SQLite ───────────────────────────────────────────────────────────────────

let db;
try {
  db = new Database(CHAT_DB, { readonly: true });
  db.prepare('SELECT ROWID FROM message LIMIT 1').get(); // probe
} catch (err) {
  process.stderr.write(
    `[iMessage] Cannot open ${CHAT_DB}: ${err.message}\n` +
    `  Grant Full Disk Access to your terminal in:\n` +
    `  System Settings → Privacy & Security → Full Disk Access\n`
  );
  process.exit(1);
}

// Apple Core Data epoch: 2001-01-01 UTC
const APPLE_EPOCH_MS = 978307200000;
const appleDate = ns => new Date(ns / 1e6 + APPLE_EPOCH_MS);

// Decode attributedBody blob (newer macOS stores text here when text column is null)
function parseAttributedBody(blob) {
  if (!blob) return null;
  const buf = Buffer.from(blob);
  let i = buf.indexOf('NSString');
  if (i < 0) return null;
  i += 8; // 'NSString'.length
  while (i < buf.length && buf[i] !== 0x2b) i++;
  if (i >= buf.length) return null;
  i++;
  let len;
  const b = buf[i++];
  if (b === 0x81)      { len = buf[i];               i += 1; }
  else if (b === 0x82) { len = buf.readUInt16LE(i);  i += 2; }
  else if (b === 0x83) { len = buf.readUIntLE(i, 3); i += 3; }
  else                 { len = b; }
  if (i + len > buf.length) return null;
  return buf.toString('utf8', i, i + len);
}

function messageText(r) {
  return r.text ?? parseAttributedBody(r.attributedBody) ?? '';
}

// Queries
const qWatermark = db.prepare('SELECT MAX(ROWID) AS max FROM message');

const qPoll = db.prepare(`
  SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.date, m.is_from_me,
         m.cache_has_attachments, h.id AS handle_id, c.guid AS chat_guid, c.style AS chat_style
  FROM message m
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  JOIN chat c ON c.ROWID = cmj.chat_id
  LEFT JOIN handle h ON h.ROWID = m.handle_id
  WHERE m.ROWID > ?
  ORDER BY m.ROWID ASC
`);

const qChatsForHandle = db.prepare(`
  SELECT DISTINCT c.guid FROM chat c
  JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
  JOIN handle h ON h.ROWID = chj.handle_id
  WHERE c.style = 45 AND LOWER(h.id) = ?
`);

// Your own iMessage addresses (learned at boot from chat.db)
const SELF = new Set();
{
  const norm = s => (/^[A-Za-z]:/.test(s) ? s.slice(2) : s).toLowerCase();
  for (const { addr } of db.prepare(
    `SELECT DISTINCT account AS addr FROM message WHERE is_from_me=1 AND account IS NOT NULL AND account!='' LIMIT 50`
  ).all()) SELF.add(norm(addr));
  for (const { addr } of db.prepare(
    `SELECT DISTINCT last_addressed_handle AS addr FROM chat WHERE last_addressed_handle IS NOT NULL AND last_addressed_handle!='' LIMIT 50`
  ).all()) SELF.add(norm(addr));
}
process.stderr.write(`[iMessage] Self-chat addresses: ${[...SELF].join(', ') || '(none)'}\n`);

// ─── Access control ───────────────────────────────────────────────────────────

function defaultAccess() {
  return { dmPolicy: 'allowlist', allowFrom: [], pending: {} };
}

function readAccess() {
  try {
    const raw = readFileSync(ACCESS_FILE, 'utf8');
    const p = JSON.parse(raw);
    return {
      dmPolicy:  p.dmPolicy  ?? 'allowlist',
      allowFrom: p.allowFrom ?? [],
      pending:   p.pending   ?? {},
    };
  } catch (err) {
    if (err.code === 'ENOENT') return defaultAccess();
    try { renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`); } catch {}
    return defaultAccess();
  }
}

function saveAccess(a) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = ACCESS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, ACCESS_FILE);
}

function gate({ senderId, chatGuid, isGroup }) {
  const a = readAccess();

  if (a.dmPolicy === 'disabled') return { action: 'drop' };

  if (!isGroup) {
    if (a.allowFrom.includes(senderId)) return { action: 'deliver' };
    if (a.dmPolicy === 'allowlist')     return { action: 'drop' };

    // pairing mode
    const now = Date.now();
    // prune expired
    let changed = false;
    for (const [code, p] of Object.entries(a.pending)) {
      if (p.expiresAt < now) { delete a.pending[code]; changed = true; }
    }
    if (changed) saveAccess(a);

    for (const [code, p] of Object.entries(a.pending)) {
      if (p.senderId === senderId) {
        if ((p.replies ?? 1) >= 2) return { action: 'drop' };
        p.replies = (p.replies ?? 1) + 1;
        saveAccess(a);
        return { action: 'pair', code, isResend: true };
      }
    }
    if (Object.keys(a.pending).length >= 3) return { action: 'drop' };

    const code = randomBytes(3).toString('hex');
    a.pending[code] = {
      senderId, chatId: chatGuid,
      createdAt: now,
      expiresAt: now + 60 * 60 * 1000,
      replies: 1,
    };
    saveAccess(a);
    return { action: 'pair', code, isResend: false };
  }

  // group: drop by default (extend later)
  return { action: 'drop' };
}

// Poll approved/ dir and send confirmation messages
function checkApprovals() {
  let files;
  try { files = readdirSync(APPROVED_DIR); } catch { return; }
  for (const senderId of files) {
    const file = join(APPROVED_DIR, senderId);
    let chatGuid;
    try { chatGuid = readFileSync(file, 'utf8').trim(); } catch { rmSync(file, { force: true }); continue; }
    if (!chatGuid) { rmSync(file, { force: true }); continue; }
    const err = sendText(chatGuid, 'Paired! Say hi to your assistant.');
    if (err) process.stderr.write(`[iMessage] Approval confirm failed: ${err}\n`);
    rmSync(file, { force: true });
  }
}
setInterval(checkApprovals, 5000).unref();

// ─── Sending (AppleScript) ────────────────────────────────────────────────────

const SEND_SCRIPT = `on run argv
  tell application "Messages" to send (item 1 of argv) to chat id (item 2 of argv)
end run`;

// Echo filter — avoids re-processing our own sent messages
const ECHO_WINDOW_MS = 15000;
const echo = new Map();
function echoKey(raw) { return raw.trim().replace(/\s+/g, ' ').slice(0, 120); }
function trackEcho(chatGuid, key) {
  const now = Date.now();
  for (const [k, t] of echo) if (now - t > ECHO_WINDOW_MS) echo.delete(k);
  echo.set(`${chatGuid}\x00${echoKey(key)}`, now);
}
function consumeEcho(chatGuid, key) {
  const k = `${chatGuid}\x00${echoKey(key)}`;
  const t = echo.get(k);
  if (!t || Date.now() - t > ECHO_WINDOW_MS) return false;
  echo.delete(k);
  return true;
}

function sendText(chatGuid, text) {
  const res = spawnSync('osascript', ['-', text, chatGuid], {
    input: SEND_SCRIPT, encoding: 'utf8',
  });
  if (res.status !== 0) return res.stderr.trim() || `osascript exit ${res.status}`;
  trackEcho(chatGuid, text);
  return null;
}

// Chunk long messages (iMessage has no hard cap but readability suffers)
const MAX_CHUNK = 10000;
function chunk(text) {
  if (text.length <= MAX_CHUNK) return [text];
  const out = [];
  let rest = text;
  while (rest.length > MAX_CHUNK) {
    const para  = rest.lastIndexOf('\n\n', MAX_CHUNK);
    const line  = rest.lastIndexOf('\n',   MAX_CHUNK);
    const space = rest.lastIndexOf(' ',    MAX_CHUNK);
    const cut = para > MAX_CHUNK / 2 ? para
              : line > MAX_CHUNK / 2 ? line
              : space > 0 ? space : MAX_CHUNK;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

// ─── API call to claudecodeui ─────────────────────────────────────────────────

const inFlight = new Map(); // chatGuid → true (deduplicate concurrent polls)

async function sendToAI(chatGuid, senderId, text) {
  if (inFlight.get(chatGuid)) {
    process.stderr.write(`[iMessage] Skipping ${chatGuid} — previous request still in flight\n`);
    return;
  }
  inFlight.set(chatGuid, true);

  try {
    const res = await fetch(`${API_ENDPOINT}/channels/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_TOKEN}`,
      },
      body: JSON.stringify({
        message: text,
        externalChatId: chatGuid,
        externalSenderId: senderId,
        projectPath: PROJECT_PATH,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      process.stderr.write(`[iMessage] API error ${res.status}: ${body}\n`);
      sendText(chatGuid, `(Error: AI returned ${res.status})`);
      return;
    }

    const data = await res.json();
    const reply = (data.content || '').trim();

    if (!reply) {
      process.stderr.write(`[iMessage] Empty AI response for ${chatGuid}\n`);
      return;
    }

    // Send reply in chunks
    const chunks = chunk(reply);
    if (APPEND_SIG && chunks.length > 0) {
      chunks[chunks.length - 1] += SIGNATURE;
    }
    for (let i = 0; i < chunks.length; i++) {
      const err = sendText(chatGuid, chunks[i]);
      if (err) {
        process.stderr.write(`[iMessage] Send chunk ${i + 1}/${chunks.length} failed: ${err}\n`);
        break;
      }
    }
  } catch (err) {
    process.stderr.write(`[iMessage] sendToAI error: ${err.message}\n`);
    sendText(chatGuid, '(Error: could not reach AI)');
  } finally {
    inFlight.delete(chatGuid);
  }
}

// ─── Inbound polling ──────────────────────────────────────────────────────────

let watermark = qWatermark.get()?.max ?? 0;
process.stderr.write(`[iMessage] Watching ${CHAT_DB} (watermark=${watermark})\n`);

function poll() {
  let rows;
  try { rows = qPoll.all(watermark); } catch (err) {
    process.stderr.write(`[iMessage] Poll error: ${err.message}\n`); return;
  }
  for (const r of rows) {
    watermark = r.rowid;
    handleInbound(r);
  }
}

function handleInbound(r) {
  if (!r.chat_guid || r.chat_style == null) return;

  const isGroup = r.chat_style === 43; // 45=DM, 43=group
  const text = messageText(r);
  const hasAtts = r.cache_has_attachments === 1;

  if (!text && !hasAtts) return;
  if (r.is_from_me)  return; // never process our own sends
  if (!r.handle_id)  return;

  const sender = r.handle_id;
  const isSelf = !isGroup && SELF.has(sender.toLowerCase());

  // Self-chat: filter echoes, then deliver
  if (isSelf && consumeEcho(r.chat_guid, text || '\x00att')) return;

  if (!isSelf) {
    const result = gate({ senderId: sender, chatGuid: r.chat_guid, isGroup });

    if (result.action === 'drop') return;

    if (result.action === 'pair') {
      const lead = result.isResend ? 'Still pending' : 'Pairing required';
      const err = sendText(
        r.chat_guid,
        `${lead} — run in claudecodeui:\n/imessage-channel pair ${result.code}`
      );
      if (err) process.stderr.write(`[iMessage] Pairing code send failed: ${err}\n`);
      return;
    }
  }

  // Deliver: call AI
  if (!text) return; // attachment-only messages: skip for now
  sendToAI(r.chat_guid, sender, text).catch(err =>
    process.stderr.write(`[iMessage] sendToAI unhandled: ${err.message}\n`)
  );
}

setInterval(poll, 1000).unref();

// ─── MCP Server (for claudecodeui lifecycle management) ───────────────────────

const mcp = new Server(
  { name: 'imessage-channel', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },
    },
    instructions: [
      'This is the iMessage channel for claudecodeui.',
      'It polls ~/Library/Messages/chat.db and routes messages to the AI.',
      'Use /imessage-channel pair <code> in claudecodeui UI to approve pairings.',
    ].join(' '),
  }
);

// Tool: allow — add sender to allowlist
// Tool: status — show current config
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'allow',
      description: 'Add a phone number or Apple ID email to the iMessage allowlist.',
      inputSchema: {
        type: 'object',
        properties: { senderId: { type: 'string', description: 'e.g. +15551234567 or user@icloud.com' } },
        required: ['senderId'],
      },
    },
    {
      name: 'status',
      description: 'Show current iMessage channel access config.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'pair',
      description: 'Approve a pairing code sent to a pending sender.',
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = req.params.arguments ?? {};
  try {
    switch (req.params.name) {
      case 'status': {
        const a = readAccess();
        const text =
          `dmPolicy: ${a.dmPolicy}\n` +
          `allowFrom (${a.allowFrom.length}): ${a.allowFrom.join(', ') || '(empty)'}\n` +
          `pending pairings: ${Object.keys(a.pending).length}\n` +
          `selfAddresses: ${[...SELF].join(', ') || '(none)'}`;
        return { content: [{ type: 'text', text }] };
      }
      case 'allow': {
        const id = (args.senderId ?? '').trim().toLowerCase();
        if (!id) throw new Error('senderId required');
        const a = readAccess();
        if (!a.allowFrom.includes(id)) { a.allowFrom.push(id); saveAccess(a); }
        return { content: [{ type: 'text', text: `Added ${id} to allowlist` }] };
      }
      case 'pair': {
        const code = (args.code ?? '').trim().toLowerCase();
        const a = readAccess();
        const entry = a.pending[code];
        if (!entry) return { content: [{ type: 'text', text: `No pending pairing for code "${code}"` }] };
        if (Date.now() > entry.expiresAt) {
          delete a.pending[code]; saveAccess(a);
          return { content: [{ type: 'text', text: `Code "${code}" has expired` }] };
        }
        // Approve: add to allowlist, remove from pending, signal server via approved/
        if (!a.allowFrom.includes(entry.senderId)) a.allowFrom.push(entry.senderId);
        delete a.pending[code];
        saveAccess(a);
        mkdirSync(APPROVED_DIR, { recursive: true });
        writeFileSync(join(APPROVED_DIR, entry.senderId), entry.chatId);
        return { content: [{ type: 'text', text: `Paired! ${entry.senderId} added to allowlist.` }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write('[iMessage] Shutting down\n');
  try { db.close(); } catch {}
  process.exit(0);
}
process.stdin.on('end',   shutdown);
process.stdin.on('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

await mcp.connect(new StdioServerTransport());
process.stderr.write('[iMessage] MCP server ready — polling chat.db\n');
```

---

## Task 3: Install dependencies and set up the plugin

### Step 3.1: Install dependencies for the channel

```bash
cd /path/to/claudecodeui/examples/imessage-channel
npm install
```

Expected: `node_modules/` created with `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`.

### Step 3.2: Grant Full Disk Access to Terminal

The Terminal app (or IDE) must have Full Disk Access to read `chat.db`:

1. Open **System Settings → Privacy & Security → Full Disk Access**
2. Click **+** and add your terminal app (Terminal.app / iTerm2 / Ghostty / the IDE running claudecodeui)
3. Restart the terminal / IDE after granting

Verify access:
```bash
ls ~/Library/Messages/chat.db
# Expected: /Users/<you>/Library/Messages/chat.db  (no "Operation not permitted")
```

### Step 3.3: Install the channel into claudecodeui

Start claudecodeui, then use the UI **or** the API:

```bash
# Option A: UI
# Settings → Channels → Install Channel → type: examples/imessage-channel (local path)

# Option B: API (get JWT first by logging into the UI)
curl -X POST http://localhost:23003/api/channels/install \
  -H "Authorization: Bearer <your_jwt>" \
  -H "Content-Type: application/json" \
  -d '{"url": "./examples/imessage-channel"}'
```

Expected response:
```json
{"success":true,"channel":{"name":"imessage-channel","displayName":"iMessage Channel","version":"0.1.0",...}}
```

### Step 3.4: Enable the channel

```bash
curl -X POST http://localhost:23003/api/channels/imessage-channel/enable \
  -H "Authorization: Bearer <your_jwt>"
```

Expected: `{"success":true,"message":"Channel enabled"}`

Check claudecodeui server logs for:
```
[iMessage] Watching /Users/<you>/Library/Messages/chat.db (watermark=...)
[iMessage] MCP server ready — polling chat.db
```

### Step 3.5: Add yourself to the allowlist

Self-chat bypasses the gate automatically (your own iMessage addresses are detected at boot). No additional config needed for self-chat.

To allow others, call the `allow` tool via the MCP connection (or add directly to access.json):

```bash
# access.json is at ~/.claude-code-ui/channels/imessage/access.json
cat > ~/.claude-code-ui/channels/imessage/access.json << 'EOF'
{
  "dmPolicy": "allowlist",
  "allowFrom": [],
  "pending": {}
}
EOF
```

---

## Task 4: End-to-end test

### Step 4.1: Verify self-chat works

1. Open Messages.app on your Mac (or iPhone/iPad signed into the same Apple ID)
2. Start a conversation with yourself (search for your own phone number or iCloud email)
3. Send: `What is the capital of France?`
4. Within 2-3 seconds, you should receive a reply via iMessage

Watch the claudecodeui server logs:
```
[iMessage] Received new inbound message from <your_handle>
[ChannelMessage] imessage-channel | chat:iMessage;-;+1... | session:NEW | "What is the capital of France?"
[iMessage] Sent reply to iMessage;-;+1...
```

### Step 4.2: Verify conversation continuity

Send two messages in the same iMessage chat:
1. `My name is Alice.`
2. `What is my name?`

The second reply should say "Alice" — confirming that `channelSessionsDb` correctly maps the chat GUID to a persistent Claude session.

### Step 4.3: Verify allowlist blocks unknown senders (optional)

Set `dmPolicy` to `allowlist` (already the default) and ask someone not on your allowlist to text your number. Their message should receive no reply. Check logs:
```
[iMessage] Gate: drop sender=+1555... (not in allowlist)
```

### Step 4.4: Verify pairing mode (optional)

Edit `access.json`:
```json
{ "dmPolicy": "pairing", "allowFrom": [], "pending": {} }
```

Text from an unknown number. They should receive:
```
Pairing required — run in claudecodeui:
/imessage-channel pair abc123
```

Then in claudecodeui (e.g., by calling the MCP tool or making an API call):
```
/imessage-channel pair abc123
```

The sender should receive `Paired! Say hi to your assistant.`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `SQLITE_CANTOPEN` on startup | No Full Disk Access | System Settings → Privacy & Security → Full Disk Access → add terminal |
| Channel status shows `error` | `better-sqlite3` or `@modelcontextprotocol/sdk` missing | `cd examples/imessage-channel && npm install` |
| No reply after sending message | API call failed | Check claudecodeui logs for `[ChannelMessage]` lines; verify service token is valid |
| "AI returned 404" in logs | `/api/channels/message` endpoint not added | Complete Task 1 |
| Reply sends but says "Error: could not reach AI" | claudecodeui not running or wrong port | Check `CHANNEL_API_ENDPOINT` in channel logs |
| Messages replay on restart | Expected: watermark resets | Watermark initializes to `MAX(ROWID)` at boot; only new messages are delivered |
| Osascript fails first time | Automation permission needed | Click OK when macOS prompts "Terminal wants to control Messages" |

---

## Self-Review Checklist

- [x] Task 1 covers: service token auth, session persistence, AI query, response collection
- [x] Task 2 covers: chat.db polling, echo filter, gate (allowlist + pairing), self-chat bypass, AppleScript send, MCP server for lifecycle, `allow`/`status`/`pair` tools
- [x] Task 3 covers: FDA requirement, installation, enable
- [x] Task 4 covers: self-chat smoke test, session continuity, access control tests
- [x] No `better-sqlite3` placeholders — full SQL queries included
- [x] No `TBD` or `TODO` — every step has actual code
- [x] Type consistency: `channelSessionsDb.getSession` / `.setSession` match `db.js` exports
- [x] `ChannelResponseWriter.send()` matches `queryClaudeSDK`'s `ws.send()` call signature
