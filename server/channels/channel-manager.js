/**
 * Channel Manager
 *
 * Manages channel lifecycle, including:
 * - Installing channels from git
 * - Starting/stopping channel processes
 * - Generating service tokens
 * - Bridging messages between channels and AI providers
 */

import path from 'path';
import { spawn } from 'child_process';
import { getPluginDir, scanPlugins, getPluginsConfig, savePluginsConfig } from '../utils/plugin-loader.js';
import { startPluginServer, stopPluginServer } from '../utils/plugin-process-manager.js';
import { getOrCreateChannelServiceToken, initializeSystemUser } from './token-manager.js';
import { startMCPClient, stopMCPClient, isMCPConnected } from './mcp-manager.js';
import { gate, AccessPolicy } from './access-control.js';
import { channelConfigDb } from '../database/db.js';

const CHANNEL_TYPE = 'channel';

// Active channel states
const channelStates = new Map(); // channelName -> { status, config, token, process }

/**
 * Get all channels (both active and inactive)
 * @returns {Object[]} Array of channel objects
 */
export function getAllChannels() {
  const plugins = scanPlugins();
  const config = getPluginsConfig();

  return plugins
    .filter(p => p.type === CHANNEL_TYPE)
    .map(plugin => ({
      name: plugin.name,
      displayName: plugin.displayName,
      version: plugin.version,
      description: plugin.description,
      enabled: config[plugin.name]?.enabled !== false,
      status: channelStates.get(plugin.name)?.status || 'stopped',
      repoUrl: plugin.repoUrl
    }));
}

/**
 * Get a specific channel
 * @param {string} channelName - Channel name
 * @returns {Object|null}
 */
export function getChannel(channelName) {
  const plugins = scanPlugins();
  const plugin = plugins.find(p => p.name === channelName && p.type === CHANNEL_TYPE);

  if (!plugin) return null;

  const config = getPluginsConfig();
  const state = channelStates.get(channelName);

  return {
    name: plugin.name,
    displayName: plugin.displayName,
    version: plugin.version,
    description: plugin.description,
    enabled: config[plugin.name]?.enabled !== false,
    status: state?.status || 'stopped',
    repoUrl: plugin.repoUrl
  };
}

/**
 * Get channel service token
 * @param {string} channelName - Channel name
 * @returns {string|null} Service token or null if channel not running
 */
export function getChannelServiceToken(channelName) {
  const state = channelStates.get(channelName);
  if (state && state.status === 'running') {
    return state.serviceToken;
  }
  return null;
}

/**
 * Start a channel
 * @param {string} channelName - Channel name
 * @returns {boolean} Success
 */
export async function startChannel(channelName) {
  // Initialize system user if needed
  initializeSystemUser();

  const pluginDir = getPluginDir(channelName);
  if (!pluginDir) {
    throw new Error(`Channel "${channelName}" not found`);
  }

  // Check if already running
  if (channelStates.has(channelName) && channelStates.get(channelName).status === 'running') {
    console.log(`[Channel] ${channelName} is already running`);
    return true;
  }

  console.log(`[Channel] Starting channel: ${channelName}`);

  try {
    // Get or create service token (reuses existing valid token if available)
    const serviceToken = getOrCreateChannelServiceToken(channelName);
    const channelConfig = channelConfigDb.getConfig(channelName, {
      includeSecrets: true,
    });

    // Set environment variables
    const env = {
      CHANNEL_SERVICE_TOKEN: serviceToken,
      CHANNEL_API_ENDPOINT: `http://localhost:${process.env.PORT || 23003}/api`,
      CHANNEL_NAME: channelName,
      FEISHU_APP_ID: channelConfig.appId || "",
      FEISHU_APP_SECRET: channelConfig.appSecret || "",
      FEISHU_DOMAIN: channelConfig.domain || "feishu",
      FEISHU_BOT_NAME: channelConfig.botName || "",
      FEISHU_ALLOWED_CHAT_TYPES: JSON.stringify(
        channelConfig.allowedChatTypes || ["p2p"],
      ),
    };

    // Get plugin info
    const plugins = scanPlugins();
    const plugin = plugins.find(p => p.name === channelName);

    if (!plugin?.server) {
      throw new Error(`Channel "${channelName}" has no server entry`);
    }

    // Start the channel server process
    const serverPath = path.join(pluginDir, plugin.server);

    // Start MCP client (stdio mode)
    const mcpConnection = await startMCPClient(channelName, serverPath, env);

    // Update state
    channelStates.set(channelName, {
      status: 'running',
      serviceToken,
      mcpConnection,
      startedAt: new Date()
    });

    console.log(`[Channel] Channel ${channelName} started successfully`);
    return true;
  } catch (error) {
    console.error(`[Channel] Failed to start channel ${channelName}:`, error);
    channelStates.set(channelName, {
      status: 'error',
      error: error.message
    });
    throw error;
  }
}

/**
 * Stop a channel
 * @param {string} channelName - Channel name
 */
export async function stopChannel(channelName) {
  const state = channelStates.get(channelName);
  if (!state || state.status !== 'running') {
    return;
  }

  console.log(`[Channel] Stopping channel: ${channelName}`);

  try {
    // Stop MCP client
    await stopMCPClient(channelName);

    // Revoke service token
    // Note: Token revocation is handled in token-manager

    // Update state
    channelStates.delete(channelName);

    console.log(`[Channel] Channel ${channelName} stopped`);
  } catch (error) {
    console.error(`[Channel] Error stopping channel ${channelName}:`, error);
    channelStates.set(channelName, {
      status: 'error',
      error: error.message
    });
  }
}

/**
 * Enable a channel
 * @param {string} channelName - Channel name
 */
export async function enableChannel(channelName) {
  const config = getPluginsConfig();
  config[channelName] = { ...config[channelName], enabled: true };
  savePluginsConfig(config);

  // Auto-start the channel
  await startChannel(channelName);
}

/**
 * Disable a channel
 * @param {string} channelName - Channel name
 */
export async function disableChannel(channelName) {
  const config = getPluginsConfig();
  config[channelName] = { ...config[channelName], enabled: false };
  savePluginsConfig(config);

  // Stop the channel
  await stopChannel(channelName);
}

/**
 * Uninstall a channel
 * @param {string} channelName - Channel name
 */
export async function uninstallChannel(channelName) {
  // Stop if running
  await stopChannel(channelName);

  // Remove from plugin directory
  const { uninstallPlugin } = await import('../utils/plugin-loader.js');
  await uninstallPlugin(channelName);

  // Clean up state
  channelStates.delete(channelName);
}

/**
 * Handle incoming message from a channel
 * @param {string} channelName - Channel name
 * @param {Object} message - Message object
 * @returns {Object} Gate result
 */
export async function handleIncomingMessage(channelName, message) {
  const { senderId, chatId, isGroup, text, policy = AccessPolicy.ALLOWLIST } = message;

  // Run gate check
  const result = gate({
    channelName,
    senderId,
    chatId,
    isGroup,
    text,
    policy
  });

  if (result.action === 'drop') {
    console.log(`[Channel] Message from ${senderId} dropped by gate`);
    return result;
  }

  if (result.action === 'pair') {
    console.log(`[Channel] Pairing code sent to ${senderId}: ${result.code}`);
    return result;
  }

  // Message is allowed - process it
  console.log(`[Channel] Processing message from ${senderId} in ${chatId}`);

  // TODO: Forward to AI provider via API
  // This will be implemented in channel-bridge.js

  return result;
}

/**
 * Start all enabled channels
 */
export async function startEnabledChannels() {
  const channels = getAllChannels();

  for (const channel of channels) {
    if (channel.enabled) {
      try {
        await startChannel(channel.name);
      } catch (error) {
        console.error(`[Channel] Failed to auto-start ${channel.name}:`, error);
      }
    }
  }
}

/**
 * Stop all running channels
 */
export async function stopAllChannels() {
  const promises = [];
  for (const channelName of channelStates.keys()) {
    promises.push(stopChannel(channelName));
  }
  await Promise.all(promises);
}

/**
 * Get channel status
 * @param {string} channelName - Channel name
 * @returns {Object|null}
 */
export function getChannelStatus(channelName) {
  return channelStates.get(channelName) || null;
}

/**
 * Restart a channel
 * @param {string} channelName - Channel name
 */
export async function restartChannel(channelName) {
  await stopChannel(channelName);
  await startChannel(channelName);
}
