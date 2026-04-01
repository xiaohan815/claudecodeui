/**
 * Channel API Routes
 *
 * REST API endpoints for channel management.
 */

import express from "express";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import os from "os";
import { authenticateToken } from "../middleware/auth.js";
import { queryClaudeSDK } from "../claude-sdk.js";
import { spawnCursor } from "../cursor-cli.js";
import { spawnGemini } from "../gemini-cli.js";
import { queryCodex } from "../openai-codex.js";
import { channelSessionsDb, channelConfigDb } from "../database/db.js";
import * as channelPtyManager from "../channels/channel-pty-manager.js";
import { 
  builtInHandlers, 
  isKnownCommand, 
  isChannelCompatible 
} from "./commands.js";
import {
  getAllChannels,
  getChannel,
  startChannel,
  stopChannel,
  enableChannel,
  disableChannel,
  restartChannel,
  getAllowedSenders,
  allowSender,
  removeSender,
  verifyPairingCode,
  getChannelAccessList,
  parsePermissionReply,
  getChannelServiceToken,
} from "../channels/index.js";
import {
  installPluginFromGit,
  uninstallPlugin,
  getPluginsDir,
} from "../utils/plugin-loader.js";
import {
  CLAUDE_MODELS,
  CURSOR_MODELS,
  CODEX_MODELS,
  GEMINI_MODELS,
} from "../../shared/modelConstants.js";

const router = express.Router();
const VALID_PROVIDERS = ["claude", "cursor", "codex", "gemini"];
const VALID_CHAT_TYPES = ["p2p", "group"];

function isFeishuChannel(channelName) {
  return channelName === "feishu-channel";
}

function normalizeAllowedChatTypes(value) {
  if (!Array.isArray(value)) {
    return ["p2p"];
  }

  const normalized = value.filter((item) => VALID_CHAT_TYPES.includes(item));
  return normalized.length > 0 ? normalized : ["p2p"];
}

function buildChannelPrompt(message, images, provider) {
  const trimmedMessage = typeof message === "string" ? message.trim() : "";
  let prompt = trimmedMessage;

  if (!prompt && images.length > 0) {
    prompt =
      "User sent an image without any text. Please inspect the image and reply appropriately.";
  }

  if (images.length > 0 && provider !== "claude") {
    prompt += `\n\n[User also sent ${images.length} image(s). This channel currently passes image input directly only when the provider is Claude.]`;
  }

  return prompt;
}

function installDependencies(cwd) {
  return new Promise((resolve, reject) => {
    const npmProcess = spawn("npm", ["install", "--production", "--ignore-scripts"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    npmProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    npmProcess.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `npm install failed in ${cwd}${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );
        return;
      }
      resolve(true);
    });

    npmProcess.on("error", (error) => {
      reject(error);
    });
  });
}

/**
 * Get available models for all providers
 * GET /api/channels/models
 */
router.get("/models", authenticateToken, async (req, res) => {
  try {
    res.json({
      models: {
        claude: CLAUDE_MODELS.OPTIONS,
        cursor: CURSOR_MODELS.OPTIONS,
        codex: CODEX_MODELS.OPTIONS,
        gemini: GEMINI_MODELS.OPTIONS,
      },
      defaults: {
        claude: CLAUDE_MODELS.DEFAULT,
        cursor: CURSOR_MODELS.DEFAULT,
        codex: CODEX_MODELS.DEFAULT,
        gemini: GEMINI_MODELS.DEFAULT,
      },
    });
  } catch (error) {
    console.error("[Channels] Error getting models:", error);
    res.status(500).json({ error: "Failed to get models" });
  }
});

/**
 * List all channels
 * GET /api/channels
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const channels = getAllChannels();
    res.json({ channels });
  } catch (error) {
    console.error("[Channels] Error listing channels:", error);
    res.status(500).json({ error: "Failed to list channels" });
  }
});

/**
 * Get a specific channel
 * GET /api/channels/:name
 */
router.get("/:name", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    const channel = getChannel(name);

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    res.json({ channel });
  } catch (error) {
    console.error("[Channels] Error getting channel:", error);
    res.status(500).json({ error: "Failed to get channel" });
  }
});

/**
 * Install a new channel from git URL
 * POST /api/channels/install
 */
router.post("/install", authenticateToken, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    let manifest;

    // Check if it's a local path
    if (
      url.startsWith("/") ||
      url.startsWith("./") ||
      url.startsWith("../") ||
      url.match(/^\w+[/\\]/)
    ) {
      // Local path installation
      const resolvedPath = path.resolve(process.cwd(), url);
      console.log(
        `[Channels] Installing channel from local path: ${resolvedPath}`,
      );

      // Check if path exists
      try {
        await fs.access(resolvedPath);
      } catch {
        return res.status(404).json({ error: `Local path not found: ${url}` });
      }

      // Read manifest.json
      const manifestPath = path.join(resolvedPath, "manifest.json");
      let localManifest;
      try {
        const manifestContent = await fs.readFile(manifestPath, "utf-8");
        localManifest = JSON.parse(manifestContent);
      } catch {
        return res
          .status(400)
          .json({ error: "No valid manifest.json found in local path" });
      }

      // Validate it's a channel type
      if (localManifest.type !== "channel") {
        return res
          .status(400)
          .json({ error: "Local plugin is not a channel type" });
      }

      // Copy to plugins directory
      const pluginsDir = getPluginsDir();
      const targetDir = path.join(pluginsDir, localManifest.name);

      await fs.mkdir(targetDir, { recursive: true });

      // Copy files recursively
      const copyRecursive = async (src, dest) => {
        const entries = await fs.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);
          if (entry.isDirectory()) {
            await fs.mkdir(destPath, { recursive: true });
            await copyRecursive(srcPath, destPath);
          } else {
            await fs.copyFile(srcPath, destPath);
          }
        }
      };

      await copyRecursive(resolvedPath, targetDir);
      try {
        await fs.access(path.join(targetDir, "package.json"));
        await installDependencies(targetDir);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          await fs.rm(targetDir, { recursive: true, force: true });
          throw error;
        }
      }
      manifest = localManifest;
    } else if (url.match(/^https?:\/\//) || url.match(/^[\w-]+\/[\w-]+$/)) {
      // Git URL installation
      const fullUrl = url.match(/^https?:\/\//)
        ? url
        : `https://github.com/${url}`;
      console.log(`[Channels] Installing channel from git: ${fullUrl}`);
      manifest = await installPluginFromGit(fullUrl);
    } else {
      return res.status(400).json({ error: "Invalid URL or path format" });
    }

    // Check if it's a channel type
    if (manifest.type !== "channel") {
      // Clean up and reject
      await uninstallPlugin(manifest.name);
      return res
        .status(400)
        .json({ error: "Installed plugin is not a channel type" });
    }

    res.json({
      success: true,
      channel: {
        name: manifest.name,
        displayName: manifest.displayName,
        version: manifest.version,
        description: manifest.description,
      },
    });
  } catch (error) {
    console.error("[Channels] Error installing channel:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to install channel" });
  }
});

/**
 * Enable/start a channel
 * POST /api/channels/:name/enable
 */
router.post("/:name/enable", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;

    console.log(`[Channels] Enabling channel: ${name}`);

    await enableChannel(name);

    res.json({ success: true, message: "Channel enabled" });
  } catch (error) {
    console.error("[Channels] Error enabling channel:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to enable channel" });
  }
});

/**
 * Get channel service token (for testing)
 * GET /api/channels/:name/token
 */
router.get("/:name/token", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    const channel = getChannel(name);

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const token = getChannelServiceToken(name);
    if (!token) {
      return res.status(400).json({ error: "Channel not running" });
    }

    res.json({ token });
  } catch (error) {
    console.error("[Channels] Error getting token:", error);
    res.status(500).json({ error: "Failed to get token" });
  }
});

/**
 * Disable/stop a channel
 * POST /api/channels/:name/disable
 */
router.post("/:name/disable", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;

    console.log(`[Channels] Disabling channel: ${name}`);

    await disableChannel(name);

    res.json({ success: true, message: "Channel disabled" });
  } catch (error) {
    console.error("[Channels] Error disabling channel:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to disable channel" });
  }
});

/**
 * Restart a channel
 * POST /api/channels/:name/restart
 */
router.post("/:name/restart", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;

    console.log(`[Channels] Restarting channel: ${name}`);

    await restartChannel(name);

    res.json({ success: true, message: "Channel restarted" });
  } catch (error) {
    console.error("[Channels] Error restarting channel:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to restart channel" });
  }
});

/**
 * Uninstall a channel
 * DELETE /api/channels/:name
 */
router.delete("/:name", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;

    console.log(`[Channels] Uninstalling channel: ${name}`);

    // Stop if running
    await stopChannel(name);

    // Uninstall
    await uninstallPlugin(name);

    res.json({ success: true, message: "Channel uninstalled" });
  } catch (error) {
    console.error("[Channels] Error uninstalling channel:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to uninstall channel" });
  }
});

/**
 * Get channel configuration (cwd, provider, model)
 * GET /api/channels/:name/config
 */
router.get("/:name/config", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    const channel = getChannel(name);

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const config = channelConfigDb.getConfig(name);
    res.json({ config });
  } catch (error) {
    console.error("[Channels] Error getting channel config:", error);
    res.status(500).json({ error: "Failed to get channel config" });
  }
});

/**
 * Update channel configuration (cwd, provider, model)
 * POST /api/channels/:name/config
 */
router.post("/:name/config", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    const { cwd, provider, model, appId, appSecret, domain, botName, allowedChatTypes, usePersistentPty, ptyIdleTimeoutMinutes } = req.body;

    const channel = getChannel(name);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (provider && !VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({
        error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
      });
    }

    if (allowedChatTypes !== undefined) {
      if (
        !Array.isArray(allowedChatTypes) ||
        allowedChatTypes.some((item) => !VALID_CHAT_TYPES.includes(item))
      ) {
        return res.status(400).json({
          error: `allowedChatTypes must only contain: ${VALID_CHAT_TYPES.join(", ")}`,
        });
      }
    }

    // Check if cwd or provider changed — if so, clear old sessions so the
    // next message starts fresh in the new directory / with the new provider.
    const oldConfig = channelConfigDb.getConfig(name, { includeSecrets: true });
    const cwdChanged = cwd !== undefined && cwd !== oldConfig.cwd;
    const providerChanged = provider !== undefined && provider !== oldConfig.provider;
    const ptyConfigChanged = 
      (usePersistentPty !== undefined && usePersistentPty !== oldConfig.usePersistentPty) ||
      (ptyIdleTimeoutMinutes !== undefined && ptyIdleTimeoutMinutes !== oldConfig.ptyIdleTimeoutMinutes);
    
    const nextFeishuConfig = {
      appId:
        appId === undefined ? oldConfig.appId : String(appId || "").trim(),
      appSecret:
        appSecret === undefined
          ? oldConfig.appSecret
          : String(appSecret || "").trim(),
      domain:
        domain === undefined
          ? oldConfig.domain
          : String(domain || "").trim().toLowerCase() || "feishu",
      botName:
        botName === undefined ? oldConfig.botName : String(botName || "").trim(),
      allowedChatTypes:
        allowedChatTypes === undefined
          ? oldConfig.allowedChatTypes
          : normalizeAllowedChatTypes(allowedChatTypes),
    };
    const feishuConfigChanged =
      isFeishuChannel(name) &&
      (
        nextFeishuConfig.appId !== oldConfig.appId ||
        nextFeishuConfig.appSecret !== oldConfig.appSecret ||
        nextFeishuConfig.domain !== oldConfig.domain ||
        nextFeishuConfig.botName !== oldConfig.botName ||
        JSON.stringify(nextFeishuConfig.allowedChatTypes) !==
          JSON.stringify(oldConfig.allowedChatTypes)
      );

    channelConfigDb.setConfig(name, {
      cwd,
      provider,
      model,
      appId: isFeishuChannel(name) ? nextFeishuConfig.appId : undefined,
      appSecret:
        isFeishuChannel(name) && appSecret !== undefined
          ? nextFeishuConfig.appSecret
          : undefined,
      domain: isFeishuChannel(name) ? nextFeishuConfig.domain : undefined,
      botName: isFeishuChannel(name) ? nextFeishuConfig.botName : undefined,
      allowedChatTypes:
        isFeishuChannel(name) ? nextFeishuConfig.allowedChatTypes : undefined,
      usePersistentPty,
      ptyIdleTimeoutMinutes,
    });
    console.log(`[Channels] Config updated for ${name}:`, {
      cwd,
      provider,
      model,
      usePersistentPty,
      ptyIdleTimeoutMinutes,
      ...(isFeishuChannel(name)
        ? {
            appId: nextFeishuConfig.appId || null,
            domain: nextFeishuConfig.domain,
            botName: nextFeishuConfig.botName || null,
            allowedChatTypes: nextFeishuConfig.allowedChatTypes,
            hasAppSecret: Boolean(nextFeishuConfig.appSecret),
          }
        : {}),
    });

    if (cwdChanged || providerChanged) {
      const cleared = channelSessionsDb.clearAllSessions(name);
      console.log(
        `[Channels] Cleared ${cleared} session(s) for ${name} due to config change (cwd=${cwdChanged}, provider=${providerChanged})`,
      );
    }

    // If PTY config changed, destroy all PTY sessions
    if (ptyConfigChanged) {
      channelPtyManager.destroyChannelSessions(name);
      console.log(`[Channels] Destroyed PTY sessions for ${name} due to PTY config change`);
    }

    if (feishuConfigChanged && channel.status === "running") {
      await restartChannel(name);
    }

    res.json({
      success: true,
      restarted: feishuConfigChanged && channel.status === "running",
      config: channelConfigDb.getConfig(name),
    });
  } catch (error) {
    console.error("[Channels] Error updating channel config:", error);
    res.status(500).json({ error: "Failed to update channel config" });
  }
});

/**
 * Get access list for a channel
 * GET /api/channels/:name/access
 */
router.get("/:name/access", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;

    const channel = getChannel(name);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const accessList = getChannelAccessList(name);

    res.json({
      access: accessList.map((entry) => ({
        senderId: entry.sender_id,
        senderType: entry.sender_type,
        policy: entry.policy,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      })),
    });
  } catch (error) {
    console.error("[Channels] Error getting access list:", error);
    res.status(500).json({ error: "Failed to get access list" });
  }
});

/**
 * Add a sender to the allowlist
 * POST /api/channels/:name/access
 */
router.post("/:name/access", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    const { senderId, senderType = "user", policy = "allow" } = req.body;

    if (!senderId) {
      return res.status(400).json({ error: "senderId is required" });
    }

    const channel = getChannel(name);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (policy === "allow") {
      allowSender(name, senderId, senderType);
    } else {
      removeSender(name, senderId);
    }

    res.json({
      success: true,
      message:
        policy === "allow"
          ? "Sender added to allowlist"
          : "Sender removed from allowlist",
    });
  } catch (error) {
    console.error("[Channels] Error updating access:", error);
    res.status(500).json({ error: "Failed to update access" });
  }
});

/**
 * Remove a sender from the allowlist
 * DELETE /api/channels/:name/access/:senderId
 */
router.delete(
  "/:name/access/:senderId",
  authenticateToken,
  async (req, res) => {
    try {
      const { name, senderId } = req.params;

      const channel = getChannel(name);
      if (!channel) {
        return res.status(404).json({ error: "Channel not found" });
      }

      removeSender(name, senderId);

      res.json({ success: true, message: "Sender removed from allowlist" });
    } catch (error) {
      console.error("[Channels] Error removing sender:", error);
      res.status(500).json({ error: "Failed to remove sender" });
    }
  },
);

/**
 * Generate a pairing code (for pairing mode)
 * POST /api/channels/:name/pair
 */
router.post("/:name/pair", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    const { senderId } = req.body;

    if (!senderId) {
      return res.status(400).json({ error: "senderId is required" });
    }

    const channel = getChannel(name);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // TODO: Implement pairing code generation
    // This would create a pending pairing entry
    const code = Math.random().toString(36).substring(2, 7);

    res.json({
      success: true,
      code,
      message: `Pairing code for ${senderId}: ${code}. Valid for 1 hour.`,
    });
  } catch (error) {
    console.error("[Channels] Error generating pairing code:", error);
    res.status(500).json({ error: "Failed to generate pairing code" });
  }
});

/**
 * Verify a pairing code
 * POST /api/channels/:name/pair/verify
 */
router.post("/:name/pair/verify", authenticateToken, async (req, res) => {
  try {
    const { name } = req.params;
    const { senderId, code } = req.body;

    if (!senderId || !code) {
      return res.status(400).json({ error: "senderId and code are required" });
    }

    const channel = getChannel(name);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const success = verifyPairingCode(name, senderId, code);

    if (success) {
      res.json({ success: true, message: "Pairing successful" });
    } else {
      res.status(400).json({ error: "Invalid or expired pairing code" });
    }
  } catch (error) {
    console.error("[Channels] Error verifying pairing code:", error);
    res.status(500).json({ error: "Failed to verify pairing code" });
  }
});

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
    // Handle new normalized message format (kind-based)
    if (data.kind === "session_created") {
      this._sessionId = data.newSessionId || data.sessionId;
    } else if (data.kind === "text" && data.role === "assistant") {
      // Assistant text message
      if (typeof data.content === "string") {
        this._textChunks.push(data.content);
      }
    } else if (data.kind === "stream_delta") {
      // Streaming text delta
      if (typeof data.content === "string") {
        this._textChunks.push(data.content);
      }
    } else if (data.kind === "complete") {
      const content = this._resultText ?? this._textChunks.join("");
      this._resolve({ content, sessionId: data.sessionId || this._sessionId });
    } else if (data.kind === "error") {
      this._reject(new Error(data.content || "AI query failed"));
    }
  }

  setSessionId(sessionId) {
    this._sessionId = sessionId;
  }
  getSessionId() {
    return this._sessionId;
  }
}

/**
 * Submit a message to the AI via a channel service token
 * POST /api/channels/message
 */
router.post("/message", authenticateToken, async (req, res) => {
  if (!req.isServiceRequest || !req.channelSource) {
    return res.status(403).json({ error: "Channel service token required" });
  }

  const { message, externalChatId, externalSenderId, projectPath, images } = req.body;

  if (message !== undefined && typeof message !== "string") {
    return res.status(400).json({ error: "message must be a string" });
  }
  if (!externalChatId || typeof externalChatId !== "string") {
    return res.status(400).json({ error: "externalChatId is required" });
  }
  if (
    images !== undefined &&
    (!Array.isArray(images) ||
      images.some(
        (image) =>
          !image ||
          typeof image !== "object" ||
          typeof image.data !== "string" ||
          !image.data.startsWith("data:"),
      ))
  ) {
    return res.status(400).json({ error: "images must be an array of data URLs" });
  }

  const channelName = req.channelSource;
  const normalizedImages = Array.isArray(images) ? images : [];

  // Load per-channel config: cwd, provider, model (needed for command context)
  const config = channelConfigDb.getConfig(channelName);

  // Check if message is a slash command
  if (message && typeof message === "string") {
    const trimmed = message.trim();
    
    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(/\s+/);
      const commandName = parts[0].toLowerCase();
      const args = parts.slice(1);
      
      // If it's a known command, handle it locally
      if (isKnownCommand(commandName)) {
        try {
          // Check if command is channel-compatible
          if (isChannelCompatible(commandName)) {
            // Execute the command handler
            const handler = builtInHandlers[commandName];
            const context = {
              channelName,
              externalChatId,
              externalSenderId,
              projectPath,
              provider: config.provider || "claude",
              model: config.model
            };
            
            const result = await handler(args, context);
            
            // Special handling for /clear: delete session
            if (commandName === '/clear') {
              channelSessionsDb.deleteSession(channelName, externalChatId);
            }
            
            // Format response for channel
            let responseText = result.data?.message || result.data?.content || 'Command executed';
            
            // For /help, format the help text
            if (commandName === '/help' && result.data?.content) {
              responseText = result.data.content;
            }
            
            // For /status, format the status data
            if (commandName === '/status' && result.data) {
              responseText = `Version: ${result.data.version || 'unknown'}\n` +
                           `Uptime: ${result.data.uptime || 'unknown'}\n` +
                           `Provider: ${result.data.provider || 'unknown'}\n` +
                           `Model: ${result.data.model || 'unknown'}`;
            }
            
            return res.json({ content: responseText });
          } else {
            // UI-only command
            return res.json({ 
              content: `The ${commandName} command is only available in the Claude Code UI.` 
            });
          }
        } catch (error) {
          console.error(`[ChannelMessage] Command execution error:`, error);
          return res.status(500).json({ 
            error: 'Command execution failed', 
            details: error.message 
          });
        }
      }
      // If not a known command, continue to AI (fall through)
    }
  }
  // Priority: user's explicit config > projectPath from MCP server > homedir fallback
  // projectPath comes from the MCP server (defaults to homedir) and must NOT override
  // a user-configured cwd.
  const cwd = config.cwd || projectPath || os.homedir();
  const provider = config.provider || "claude";
  const model = config.model || undefined;
  const prompt = buildChannelPrompt(message, normalizedImages, provider);

  if (!prompt) {
    return res.status(400).json({ error: "message or images are required" });
  }

  // Session continuation: only supported for Claude (other providers start fresh)
  const existingSessionId =
    provider === "claude"
      ? channelSessionsDb.getSession(channelName, externalChatId) || undefined
      : undefined;

  const CHANNEL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  // Check if PTY mode is enabled for this channel
  if (config.usePersistentPty && provider === "claude") {
    console.log(
      `[ChannelMessage] Using PTY mode for ${channelName} | chat:${externalChatId} | session:${existingSessionId || "NEW"}`,
    );

    try {
      const { content, sessionId: newSessionId } = await channelPtyManager.sendMessage(
        channelName,
        externalChatId,
        prompt,
        {
          cwd,
          model,
          timeoutMs: CHANNEL_TIMEOUT_MS,
          claudeSessionId: existingSessionId,
          idleTimeoutMinutes: config.ptyIdleTimeoutMinutes || 30,
        }
      );

      // Persist session ID
      if (newSessionId) {
        channelSessionsDb.setSession(channelName, externalChatId, newSessionId);
      }

      return res.json({ content, sessionId: newSessionId });
    } catch (err) {
      console.error(`[ChannelPTY] Error for ${channelName}:`, err.message);
      return res.status(500).json({ error: err.message || 'PTY query failed' });
    }
  }

  // Fallback to SDK mode (existing implementation)
  const writer = new ChannelResponseWriter();

  console.log(
    `[ChannelMessage] ${channelName} | provider:${provider} | cwd:${cwd} | chat:${externalChatId} | session:${existingSessionId || "NEW"} | images:${normalizedImages.length} | "${prompt.substring(0, 60)}"`,
  );

  try {
    if (provider === "claude") {
      queryClaudeSDK(
        prompt,
        {
          cwd,
          sessionId: existingSessionId,
          model,
          permissionMode: "bypassPermissions",
          ...(normalizedImages.length > 0
            ? { images: normalizedImages }
            : {}),
          toolsSettings: {
            allowedTools: [],
            disallowedTools: [],
            skipPermissions: true,
          },
        },
        writer,
      ).catch((err) => {
        console.error(
          `[ChannelMessage] queryClaudeSDK threw for ${channelName}:`,
          err.message,
        );
      });
    } else if (provider === "cursor") {
      spawnCursor(
        prompt,
        {
          cwd,
          projectPath: cwd,
          sessionId: null,
          model,
          skipPermissions: true,
        },
        writer,
      ).catch((err) => {
        console.error(
          `[ChannelMessage] spawnCursor threw for ${channelName}:`,
          err.message,
        );
      });
    } else if (provider === "codex") {
      queryCodex(
        prompt,
        {
          cwd,
          projectPath: cwd,
          sessionId: null,
          model,
          permissionMode: "bypassPermissions",
        },
        writer,
      ).catch((err) => {
        console.error(
          `[ChannelMessage] queryCodex threw for ${channelName}:`,
          err.message,
        );
      });
    } else if (provider === "gemini") {
      spawnGemini(
        prompt,
        {
          cwd,
          projectPath: cwd,
          sessionId: null,
          model,
          skipPermissions: true,
        },
        writer,
      ).catch((err) => {
        console.error(
          `[ChannelMessage] spawnGemini threw for ${channelName}:`,
          err.message,
        );
      });
    } else {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Channel message timeout after 5 minutes")),
        CHANNEL_TIMEOUT_MS,
      ),
    );

    const { content, sessionId: newSessionId } = await Promise.race([
      writer.promise,
      timeoutPromise,
    ]);

    // Only persist session ID for Claude (which supports resumption)
    if (provider === "claude" && newSessionId) {
      channelSessionsDb.setSession(channelName, externalChatId, newSessionId);
    }

    return res.json({ content, sessionId: newSessionId });
  } catch (error) {
    console.error(`[ChannelMessage] Error for ${channelName}:`, error.message);
    return res.status(500).json({ error: error.message || "AI query failed" });
  }
});

export default router;
