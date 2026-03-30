/**
 * Channel Bridge
 *
 * Bridges WebSocket messages between claudecodeui and Channel MCP servers.
 * Handles:
 * - Forwarding AI responses to channels
 * - Managing channel message subscriptions
 * - Channel notification routing
 */

import { getAllChannels, isMCPConnected, sendNotification } from './index.js';

// Store WebSocket broadcast function (set during initialization)
let wsBroadcastFunction = null;

// Channel-specific subscriptions
const channelSubscriptions = new Map(); // channelName -> Set of session IDs

/**
 * Initialize the channel bridge
 * @param {Function} broadcastFn - WebSocket broadcast function
 */
export function initializeChannelBridge(broadcastFn) {
  wsBroadcastFunction = broadcastFn;
  console.log('[ChannelBridge] Initialized');
}

/**
 * Subscribe a WebSocket session to channel messages
 * @param {string} sessionId - WebSocket session ID
 * @param {string} channelName - Channel name to subscribe to
 */
export function subscribeToChannel(sessionId, channelName) {
  if (!channelSubscriptions.has(channelName)) {
    channelSubscriptions.set(channelName, new Set());
  }
  channelSubscriptions.get(channelName).add(sessionId);
}

/**
 * Unsubscribe a WebSocket session from channel messages
 * @param {string} sessionId - WebSocket session ID
 * @param {string} channelName - Channel name to unsubscribe from
 */
export function unsubscribeFromChannel(sessionId, channelName) {
  const subs = channelSubscriptions.get(channelName);
  if (subs) {
    subs.delete(sessionId);
    if (subs.size === 0) {
      channelSubscriptions.delete(channelName);
    }
  }
}

/**
 * Unsubscribe a WebSocket session from all channels
 * @param {string} sessionId - WebSocket session ID
 */
export function unsubscribeAll(sessionId) {
  for (const [channelName, subs] of channelSubscriptions) {
    subs.delete(sessionId);
    if (subs.size === 0) {
      channelSubscriptions.delete(channelName);
    }
  }
}

/**
 * Broadcast a message to all subscribers of a channel
 * @param {string} channelName - Channel name
 * @param {Object} message - Message to broadcast
 */
export function broadcastToChannel(channelName, message) {
  const fullMessage = {
    type: 'channel_message',
    channel: channelName,
    ...message,
    timestamp: new Date().toISOString()
  };

  // Send via WebSocket if available
  if (wsBroadcastFunction) {
    // Broadcast to all connected clients
    wsBroadcastFunction(fullMessage);
  }

  // Send via MCP notification if channel is connected
  if (isMCPConnected(channelName)) {
    sendNotification(channelName, 'notifications/channel/message', {
      content: message.content,
      meta: message.meta
    });
  }
}

/**
 * Handle AI response and forward to channel if needed
 * @param {Object} response - AI response object
 * @param {Object} context - Context including channel source
 */
export async function handleAIResponse(response, context = {}) {
  if (!context.channelSource) {
    // Not a channel request, skip
    return;
  }

  const channelName = context.channelSource;

  console.log(`[ChannelBridge] Forwarding AI response to channel: ${channelName}`);

  // Broadcast to channel
  broadcastToChannel(channelName, {
    type: 'ai_response',
    content: response.content || response.text,
    meta: {
      sessionId: context.sessionId,
      messageId: context.messageId,
      externalChatId: context.externalChatId
    }
  });

  // Send via MCP notification
  if (isMCPConnected(channelName)) {
    try {
      await sendNotification(channelName, 'notifications/channel/response', {
        content: response.content || response.text,
        chat_id: context.externalChatId,
        session_id: context.sessionId
      });
    } catch (error) {
      console.error(`[ChannelBridge] Failed to send MCP notification to ${channelName}:`, error);
    }
  }
}

/**
 * Forward incoming channel message to AI
 * @param {string} channelName - Channel name
 * @param {Object} message - Channel message
 * @param {Object} aiClient - AI client instance (e.g., Claude SDK)
 */
export async function forwardToAI(channelName, message, aiClient) {
  console.log(`[ChannelBridge] Forwarding message from ${channelName} to AI`);

  try {
    // Prepare the message with channel context
    const aiMessage = {
      role: 'user',
      content: message.text,
      metadata: {
        channelSource: channelName,
        externalChatId: message.chatId,
        senderId: message.senderId,
        isGroup: message.isGroup,
        timestamp: message.timestamp
      }
    };

    // Send to AI (implementation depends on AI client)
    // This is a placeholder - actual implementation will call the appropriate SDK
    const response = await aiClient.sendMessage(aiMessage);

    // Handle the response
    await handleAIResponse(response, {
      channelSource: channelName,
      externalChatId: message.chatId,
      sessionId: response.sessionId,
      messageId: response.messageId
    });

    return response;
  } catch (error) {
    console.error(`[ChannelBridge] Failed to forward message to AI:`, error);
    throw error;
  }
}

/**
 * Handle channel permission request
 * @param {string} channelName - Channel name
 * @param {Object} request - Permission request
 */
export async function handlePermissionRequest(channelName, request) {
  console.log(`[ChannelBridge] Forwarding permission request to ${channelName}`);

  if (!isMCPConnected(channelName)) {
    console.warn(`[ChannelBridge] Channel ${channelName} not connected`);
    return;
  }

  try {
    await sendNotification(channelName, 'notifications/claude/channel/permission_request', {
      request_id: request.id,
      tool_name: request.toolName,
      description: request.description,
      input_preview: request.inputPreview
    });
  } catch (error) {
    console.error(`[ChannelBridge] Failed to send permission request:`, error);
  }
}

/**
 * Handle permission reply from channel
 * @param {string} channelName - Channel name
 * @param {string} requestId - Original request ID
 * @param {string} behavior - 'allow' or 'deny'
 */
export async function handlePermissionReply(channelName, requestId, behavior) {
  console.log(`[ChannelBridge] Permission reply from ${channelName}: ${behavior} for ${requestId}`);

  // Broadcast to AI system
  broadcastToChannel(channelName, {
    type: 'permission_reply',
    requestId,
    behavior,
    timestamp: new Date().toISOString()
  });
}

/**
 * Get bridge status
 * @returns {Object} Bridge status
 */
export function getBridgeStatus() {
  return {
    initialized: wsBroadcastFunction !== null,
    subscriptions: Array.from(channelSubscriptions.entries()).map(
      ([channel, sessions]) => ({ channel, sessionCount: sessions.size })
    )
  };
}
