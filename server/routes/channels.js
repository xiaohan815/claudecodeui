/**
 * Channel API Routes
 *
 * REST API endpoints for channel management.
 */

import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import os from "os";
import { authenticateToken } from "../middleware/auth.js";
import { queryClaudeSDK } from "../claude-sdk.js";
import { spawnCursor } from "../cursor-cli.js";
import { spawnGemini } from "../gemini-cli.js";
import { queryCodex } from "../openai-codex.js";
import { channelSessionsDb, channelConfigDb } from "../database/db.js";
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

const router = express.Router();

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
    const { cwd, provider, model } = req.body;

    const channel = getChannel(name);
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const VALID_PROVIDERS = ["claude", "cursor", "codex", "gemini"];
    if (provider && !VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({
        error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
      });
    }

    // Check if cwd or provider changed — if so, clear old sessions so the
    // next message starts fresh in the new directory / with the new provider.
    const oldConfig = channelConfigDb.getConfig(name);
    const cwdChanged = cwd && cwd !== oldConfig.cwd;
    const providerChanged = provider && provider !== oldConfig.provider;

    channelConfigDb.setConfig(name, { cwd, provider, model });
    console.log(`[Channels] Config updated for ${name}:`, {
      cwd,
      provider,
      model,
    });

    if (cwdChanged || providerChanged) {
      const cleared = channelSessionsDb.clearAllSessions(name);
      console.log(
        `[Channels] Cleared ${cleared} session(s) for ${name} due to config change (cwd=${cwdChanged}, provider=${providerChanged})`,
      );
    }

    res.json({ success: true, config: channelConfigDb.getConfig(name) });
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
    if (data.type === "session-created") {
      this._sessionId = data.sessionId;
    } else if (data.type === "claude-response") {
      const msg = data.data;
      if (
        msg?.type === "result" &&
        msg?.subtype === "success" &&
        typeof msg.result === "string"
      ) {
        this._resultText = msg.result;
      }
      if (msg?.type === "assistant" && Array.isArray(msg?.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === "text") this._textChunks.push(block.text);
        }
      }
      // Handle streaming text deltas (content_block_delta)
      if (
        msg?.type === "content_block_delta" &&
        msg?.delta?.type === "text_delta" &&
        typeof msg?.delta?.text === "string"
      ) {
        this._textChunks.push(msg.delta.text);
      }
    } else if (data.type === "claude-complete") {
      const content = this._resultText ?? this._textChunks.join("");
      this._resolve({ content, sessionId: data.sessionId || this._sessionId });
    } else if (data.type === "claude-error") {
      this._reject(new Error(data.error || "AI query failed"));
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

  const { message, externalChatId, externalSenderId, projectPath } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  if (!externalChatId || typeof externalChatId !== "string") {
    return res.status(400).json({ error: "externalChatId is required" });
  }

  const channelName = req.channelSource;

  // Load per-channel config: cwd, provider, model
  const config = channelConfigDb.getConfig(channelName);
  // Priority: user's explicit config > projectPath from MCP server > homedir fallback
  // projectPath comes from the MCP server (defaults to homedir) and must NOT override
  // a user-configured cwd.
  const cwd = config.cwd || projectPath || os.homedir();
  const provider = config.provider || "claude";
  const model = config.model || undefined;

  // Session continuation: only supported for Claude (other providers start fresh)
  const existingSessionId =
    provider === "claude"
      ? channelSessionsDb.getSession(channelName, externalChatId) || undefined
      : undefined;

  const writer = new ChannelResponseWriter();

  console.log(
    `[ChannelMessage] ${channelName} | provider:${provider} | cwd:${cwd} | chat:${externalChatId} | session:${existingSessionId || "NEW"} | "${message.substring(0, 60)}"`,
  );

  try {
    if (provider === "claude") {
      queryClaudeSDK(
        message,
        {
          cwd,
          sessionId: existingSessionId,
          model,
          permissionMode: "bypassPermissions",
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
        message,
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
        message,
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
        message,
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

    const CHANNEL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
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
