#!/usr/bin/env node
/**
 * Echo Channel - Example Channel Implementation
 *
 * This is a minimal example of a channel plugin for claudecodeui.
 * It demonstrates the required structure and MCP protocol usage.
 *
 * How it works:
 * 1. Connects to claudecodeui via MCP stdio
 * 2. Exposes a "receive_message" tool to receive external messages
 * 3. Forwards messages to claudecodeui API using Service Token
 * 4. Receives AI responses via MCP notifications
 *
 * Environment variables provided by claudecodeui:
 * - CHANNEL_SERVICE_TOKEN: JWT token for API authentication
 * - CHANNEL_API_ENDPOINT: Base URL of claudecodeui API
 * - CHANNEL_NAME: Name of this channel
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Get environment variables
const SERVICE_TOKEN = process.env.CHANNEL_SERVICE_TOKEN;
const API_ENDPOINT = process.env.CHANNEL_API_ENDPOINT || 'http://localhost:23003/api';
const CHANNEL_NAME = process.env.CHANNEL_NAME || 'echo-channel';

if (!SERVICE_TOKEN) {
  console.error('[EchoChannel] CHANNEL_SERVICE_TOKEN not set');
  process.exit(1);
}

console.error(`[EchoChannel] Starting ${CHANNEL_NAME}`);
console.error(`[EchoChannel] API Endpoint: ${API_ENDPOINT}`);

// Message storage (in-memory, for demo purposes)
const messageHistory = [];

// Create MCP server
const server = new Server(
  {
    name: CHANNEL_NAME,
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      // Declare channel capability
      experimental: {
        'claude/channel': {},
      },
    },
  }
);

// Tool: receive_message - Called when external message arrives
server.setRequestHandler(
  z.object({
    method: z.literal('tools/call'),
    params: z.object({
      name: z.literal('receive_message'),
      arguments: z.object({
        sender_id: z.string(),
        chat_id: z.string(),
        text: z.string(),
        timestamp: z.string().optional(),
      }),
    }),
  }),
  async ({ params }) => {
    const { sender_id, chat_id, text, timestamp } = params.arguments;

    console.error(`[EchoChannel] Received message from ${sender_id}: ${text.substring(0, 50)}...`);

    // Store message
    messageHistory.push({
      sender_id,
      chat_id,
      text,
      timestamp: timestamp || new Date().toISOString(),
    });

    // Forward to claudecodeui API using Service Token
    try {
      const response = await fetch(`${API_ENDPOINT}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SERVICE_TOKEN}`,
        },
        body: JSON.stringify({
          message: text,
          channelSource: CHANNEL_NAME,
          externalChatId: chat_id,
          externalSenderId: sender_id,
        }),
      });

      if (!response.ok) {
        console.error(`[EchoChannel] API error: ${response.status}`);
        return {
          content: [{ type: 'text', text: `Failed to forward message: ${response.status}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: 'Message forwarded to AI' }],
      };
    } catch (error) {
      console.error('[EchoChannel] Failed to forward message:', error);
      return {
        content: [{ type: 'text', text: `Failed to forward message: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: send_message - Called to send message back to external source
server.setRequestHandler(
  z.object({
    method: z.literal('tools/call'),
    params: z.object({
      name: z.literal('send_message'),
      arguments: z.object({
        chat_id: z.string(),
        text: z.string(),
      }),
    }),
  }),
  async ({ params }) => {
    const { chat_id, text } = params.arguments;

    console.error(`[EchoChannel] Sending message to ${chat_id}: ${text.substring(0, 50)}...`);

    // In a real implementation, this would send to actual external service
    // (e.g., Telegram API, Discord webhook, etc.)
    console.error(`[EchoChannel] Would send to chat ${chat_id}: ${text}`);

    return {
      content: [{ type: 'text', text: 'Message sent' }],
    };
  }
);

// Handle notifications from claudecodeui (e.g., AI responses)
server.setNotificationHandler(
  z.object({
    method: z.literal('notifications/channel/response'),
    params: z.object({
      content: z.string(),
      chat_id: z.string().optional(),
      session_id: z.string().optional(),
    }),
  }),
  async ({ params }) => {
    console.error(`[EchoChannel] Received AI response: ${params.content.substring(0, 50)}...`);

    // Send back to external source
    if (params.chat_id) {
      await server.notification({
        method: 'tools/call',
        params: {
          name: 'send_message',
          arguments: {
            chat_id: params.chat_id,
            text: params.content,
          },
        },
      });
    }
  }
);

// Handle permission requests
server.setNotificationHandler(
  z.object({
    method: z.literal('notifications/claude/channel/permission_request'),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string(),
    }),
  }),
  async ({ params }) => {
    console.error(`[EchoChannel] Permission request ${params.request_id}: ${params.tool_name}`);
    // In a real implementation, forward to external user for approval
  }
);

// Handle channel messages (from notifications/claude/channel)
server.setNotificationHandler(
  z.object({
    method: z.literal('notifications/claude/channel'),
    params: z.object({
      content: z.string(),
      meta: z.object({
        chat_id: z.string(),
        message_id: z.string(),
        user: z.string(),
        ts: z.string(),
      }),
    }),
  }),
  async ({ params }) => {
    console.error(`[EchoChannel] Channel message from ${params.meta.user}: ${params.content}`);

    // Forward to claudecodeui for processing
    try {
      await fetch(`${API_ENDPOINT}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SERVICE_TOKEN}`,
        },
        body: JSON.stringify({
          message: params.content,
          channelSource: CHANNEL_NAME,
          externalChatId: params.meta.chat_id,
          externalSenderId: params.meta.user,
          externalMessageId: params.meta.message_id,
        }),
      });
    } catch (error) {
      console.error('[EchoChannel] Failed to forward channel message:', error);
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[EchoChannel] Connected to claudecodeui');

  // Keep alive
  process.stdin.on('end', () => {
    console.error('[EchoChannel] Stdin closed, shutting down');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[EchoChannel] Fatal error:', error);
  process.exit(1);
});
