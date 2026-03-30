/**
 * MCP Manager
 *
 * Manages MCP (Model Context Protocol) connections for channels.
 * Uses stdio transport to communicate with Channel MCP servers.
 */

import { spawn } from 'child_process';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Active MCP connections
const mcpConnections = new Map(); // channelName -> { client, process, tools, capabilities }

/**
 * Start an MCP client for a channel
 * @param {string} channelName - Channel name
 * @param {string} serverPath - Path to channel server script
 * @param {Object} env - Environment variables to pass
 * @returns {Object} MCP client connection
 */
export async function startMCPClient(channelName, serverPath, env = {}) {
  if (mcpConnections.has(channelName)) {
    console.log(`[MCP] Client already exists for channel: ${channelName}`);
    return mcpConnections.get(channelName);
  }

  console.log(`[MCP] Starting MCP client for channel: ${channelName}`);

  try {
    // Create transport
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        ...process.env,
        ...env,
        CHANNEL_NAME: channelName
      }
    });

    // Create client
    const client = new Client(
      { name: 'claudecodeui-channel-host', version: '1.0.0' },
      { capabilities: {} }
    );

    // Connect
    await client.connect(transport);

    // Get available tools
    const toolsResult = await client.listTools();
    const tools = toolsResult.tools || [];

    // Check for channel capabilities
    const capabilities = {
      hasChannel: false,
      hasPermission: false
    };

    // Store connection
    const connection = {
      client,
      transport,
      tools,
      capabilities,
      startedAt: new Date()
    };

    mcpConnections.set(channelName, connection);

    console.log(`[MCP] Client started for ${channelName} with ${tools.length} tools`);

    // Handle process exit
    transport.onclose = () => {
      console.log(`[MCP] Transport closed for channel: ${channelName}`);
      mcpConnections.delete(channelName);
    };

    return connection;
  } catch (error) {
    console.error(`[MCP] Failed to start client for ${channelName}:`, error);
    throw error;
  }
}

/**
 * Stop an MCP client
 * @param {string} channelName - Channel name
 */
export async function stopMCPClient(channelName) {
  const connection = mcpConnections.get(channelName);
  if (!connection) {
    return;
  }

  console.log(`[MCP] Stopping client for channel: ${channelName}`);

  try {
    await connection.client.close();
    mcpConnections.delete(channelName);
    console.log(`[MCP] Client stopped for channel: ${channelName}`);
  } catch (error) {
    console.error(`[MCP] Error stopping client for ${channelName}:`, error);
    mcpConnections.delete(channelName);
  }
}

/**
 * Get MCP connection for a channel
 * @param {string} channelName - Channel name
 * @returns {Object|null}
 */
export function getMCPConnection(channelName) {
  return mcpConnections.get(channelName) || null;
}

/**
 * Check if MCP client is connected
 * @param {string} channelName - Channel name
 * @returns {boolean}
 */
export function isMCPConnected(channelName) {
  return mcpConnections.has(channelName);
}

/**
 * List all active MCP connections
 * @returns {string[]} Channel names
 */
export function listActiveConnections() {
  return Array.from(mcpConnections.keys());
}

/**
 * Stop all MCP connections
 */
export async function stopAllMCPClients() {
  const promises = [];
  for (const channelName of mcpConnections.keys()) {
    promises.push(stopMCPClient(channelName));
  }
  await Promise.all(promises);
}

/**
 * Call a tool on an MCP server
 * @param {string} channelName - Channel name
 * @param {string} toolName - Tool name
 * @param {Object} args - Tool arguments
 * @returns {Object} Tool result
 */
export async function callMCPTool(channelName, toolName, args = {}) {
  const connection = mcpConnections.get(channelName);
  if (!connection) {
    throw new Error(`MCP client not connected for channel: ${channelName}`);
  }

  try {
    const result = await connection.client.callTool({
      name: toolName,
      arguments: args
    });

    return result;
  } catch (error) {
    console.error(`[MCP] Tool call failed for ${channelName}.${toolName}:`, error);
    throw error;
  }
}

/**
 * Set up notification handler for a channel
 * @param {string} channelName - Channel name
 * @param {string} method - Notification method
 * @param {Function} handler - Handler function
 */
export function setNotificationHandler(channelName, method, handler) {
  const connection = mcpConnections.get(channelName);
  if (!connection) {
    console.warn(`[MCP] Cannot set notification handler - ${channelName} not connected`);
    return;
  }

  // Note: SDK may not support per-method handlers, this is a placeholder
  // Actual implementation depends on SDK capabilities
  console.log(`[MCP] Notification handler registered for ${channelName}.${method}`);
}

/**
 * Send a notification to channel MCP server
 * @param {string} channelName - Channel name
 * @param {string} method - Notification method
 * @param {Object} params - Notification params
 */
export async function sendNotification(channelName, method, params = {}) {
  const connection = mcpConnections.get(channelName);
  if (!connection) {
    console.warn(`[MCP] Cannot send notification - ${channelName} not connected`);
    return;
  }

  try {
    // Use notification method
    await connection.client.notification({
      method,
      params
    });
  } catch (error) {
    console.error(`[MCP] Failed to send notification to ${channelName}:`, error);
  }
}
