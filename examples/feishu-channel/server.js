#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as Lark from "@larksuiteoapi/node-sdk";

const SERVICE_TOKEN = process.env.CHANNEL_SERVICE_TOKEN;
const API_ENDPOINT = process.env.CHANNEL_API_ENDPOINT || "http://localhost:23003/api";
const CHANNEL_NAME = process.env.CHANNEL_NAME || "feishu-channel";
const APP_ID = process.env.FEISHU_APP_ID || "";
const APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const BOT_NAME = process.env.FEISHU_BOT_NAME || "";
const ALLOWED_CHAT_TYPES = parseAllowedChatTypes(
  process.env.FEISHU_ALLOWED_CHAT_TYPES,
);
const OPEN_BASE = normalizeOpenBase(process.env.FEISHU_DOMAIN || "feishu");
const TOKEN_REFRESH_BUFFER_MS = 60_000;
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
const RESPONSE_CHUNK_LIMIT = 1800;
const processedMessages = new Map();
const inFlightChats = new Map();
const tokenCache = {
  value: null,
  expiresAt: 0,
};

let wsClient = null;
let websocketStarted = false;
let lastEventAt = null;
let shuttingDown = false;

if (!SERVICE_TOKEN) {
  process.stderr.write("[Feishu] CHANNEL_SERVICE_TOKEN not set — exiting\n");
  process.exit(1);
}

if (!APP_ID || !APP_SECRET) {
  process.stderr.write(
    "[Feishu] Missing App ID or App Secret. Configure feishu-channel in Settings → Channels before enabling it.\n",
  );
  process.exit(1);
}

process.on("unhandledRejection", (error) => {
  process.stderr.write(`[Feishu] unhandledRejection: ${error?.stack || error}\n`);
});

process.on("uncaughtException", (error) => {
  process.stderr.write(`[Feishu] uncaughtException: ${error?.stack || error}\n`);
});

setInterval(() => {
  const now = Date.now();
  for (const [messageId, timestamp] of processedMessages) {
    if (now - timestamp > DUPLICATE_WINDOW_MS) {
      processedMessages.delete(messageId);
    }
  }
}, 60_000).unref();

function normalizeOpenBase(domainValue) {
  const normalized = String(domainValue || "feishu").trim().toLowerCase();
  if (normalized === "lark") {
    return "https://open.larksuite.com";
  }
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized.replace(/\/+$/, "");
  }
  return "https://open.feishu.cn";
}

function parseAllowedChatTypes(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || '["p2p"]');
    if (!Array.isArray(parsed)) {
      return ["p2p"];
    }
    const normalized = parsed.filter((value) => value === "p2p" || value === "group");
    return normalized.length > 0 ? normalized : ["p2p"];
  } catch {
    return ["p2p"];
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripBotAddressing(text) {
  if (!text) {
    return "";
  }

  let normalized = text.trim();
  if (BOT_NAME) {
    normalized = normalized.replace(
      new RegExp(`^@?${escapeRegExp(BOT_NAME)}[,:：\\s-]*`, "i"),
      "",
    );
  }
  return normalized.trim();
}

function markMessageProcessed(messageId) {
  if (!messageId) {
    return false;
  }
  if (processedMessages.has(messageId)) {
    return true;
  }
  processedMessages.set(messageId, Date.now());
  return false;
}

async function getTenantAccessToken(forceRefresh = false) {
  if (
    !forceRefresh &&
    tokenCache.value &&
    tokenCache.expiresAt - TOKEN_REFRESH_BUFFER_MS > Date.now()
  ) {
    return tokenCache.value;
  }

  const response = await fetch(`${OPEN_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: APP_ID,
      app_secret: APP_SECRET,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(
      `[Feishu] Failed to fetch tenant access token (${response.status}): ${payload?.msg || response.statusText}`,
    );
  }

  tokenCache.value = payload.tenant_access_token;
  tokenCache.expiresAt = Date.now() + Number(payload.expire || 0) * 1000;
  return tokenCache.value;
}

async function feishuRawFetch(urlPath, init = {}, allowRetry = true) {
  const token = await getTenantAccessToken();
  const response = await fetch(`${OPEN_BASE}${urlPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  if (response.status === 401 && allowRetry) {
    await getTenantAccessToken(true);
    return feishuRawFetch(urlPath, init, false);
  }

  return response;
}

async function feishuJsonFetch(urlPath, init = {}) {
  const response = await feishuRawFetch(urlPath, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.code !== 0) {
    throw new Error(
      `[Feishu] API request failed (${response.status}) ${urlPath}: ${payload?.msg || response.statusText}`,
    );
  }
  return payload.data || {};
}

function parseMessageContent(rawContent) {
  try {
    return JSON.parse(rawContent || "{}");
  } catch {
    return {};
  }
}

function extractTextMessage(event) {
  const content = parseMessageContent(event?.message?.content);
  return stripBotAddressing(content.text || "");
}

function hasMention(event, text) {
  if (Array.isArray(event?.message?.mentions) && event.message.mentions.length > 0) {
    return true;
  }
  return Boolean(BOT_NAME && text && text.includes(BOT_NAME));
}

async function downloadImageAttachment(event) {
  const content = parseMessageContent(event?.message?.content);
  const imageKey = content.image_key;
  const messageId = event?.message?.message_id;

  if (!imageKey || !messageId) {
    return [];
  }

  const response = await feishuRawFetch(
    `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(imageKey)}?type=image`,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `[Feishu] Failed to download image resource (${response.status}): ${body || response.statusText}`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type") || "image/png";
  return [
    {
      data: `data:${mimeType};base64,${buffer.toString("base64")}`,
    },
  ];
}

function chunkText(text) {
  if (text.length <= RESPONSE_CHUNK_LIMIT) {
    return [text];
  }

  const chunks = [];
  let remaining = text;
  while (remaining.length > RESPONSE_CHUNK_LIMIT) {
    const paragraphBreak = remaining.lastIndexOf("\n\n", RESPONSE_CHUNK_LIMIT);
    const lineBreak = remaining.lastIndexOf("\n", RESPONSE_CHUNK_LIMIT);
    const spaceBreak = remaining.lastIndexOf(" ", RESPONSE_CHUNK_LIMIT);
    const cut =
      paragraphBreak > RESPONSE_CHUNK_LIMIT / 2
        ? paragraphBreak
        : lineBreak > RESPONSE_CHUNK_LIMIT / 2
          ? lineBreak
          : spaceBreak > 0
            ? spaceBreak
            : RESPONSE_CHUNK_LIMIT;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\s+/, "");
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

async function sendText(chatId, text) {
  const response = await feishuJsonFetch("/open-apis/im/v1/messages?receive_id_type=chat_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
      uuid: crypto.randomUUID(),
    }),
  });
  
  // Return the message_id for later updates
  return response.message_id;
}

async function updateMessage(messageId, text) {
  await feishuJsonFetch(`/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
  });
}

async function sendReply(chatId, text) {
  const chunks = chunkText(text.trim());
  for (const chunk of chunks) {
    await sendText(chatId, chunk);
  }
}

async function sendToAI({ chatId, senderId, text, images }) {
  // Remove the in-flight check - let PTY handle queueing
  // if (inFlightChats.get(chatId)) {
  //   process.stderr.write(`[Feishu] Skipping ${chatId} — previous request in flight\n`);
  //   return;
  // }

  // inFlightChats.set(chatId, true);
  
  // Send "processing" message first
  let processingMessageId = null;
  try {
    processingMessageId = await sendText(chatId, "🤖 正在思考中...");
    process.stderr.write(`[Feishu] Sent processing message: ${processingMessageId}\n`);
  } catch (error) {
    process.stderr.write(`[Feishu] Failed to send processing message: ${error.message}\n`);
  }
  
  try {
    const response = await fetch(`${API_ENDPOINT}/channels/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_TOKEN}`,
      },
      body: JSON.stringify({
        message: text,
        externalChatId: chatId,
        externalSenderId: senderId,
        images,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      process.stderr.write(
        `[Feishu] Channel API error ${response.status}: ${body || response.statusText}\n`,
      );
      
      // Update processing message with error
      if (processingMessageId) {
        await updateMessage(processingMessageId, "❌ AI 服务暂时不可用，请稍后重试。");
      } else {
        await sendText(chatId, "❌ AI 服务暂时不可用，请稍后重试。");
      }
      return;
    }

    const payload = await response.json();
    const reply = String(payload.content || "").trim();
    if (!reply) {
      process.stderr.write(`[Feishu] Empty AI response for ${chatId}\n`);
      if (processingMessageId) {
        await updateMessage(processingMessageId, "❌ AI 返回了空响应");
      }
      return;
    }

    // Update processing message with final result
    if (processingMessageId) {
      const chunks = chunkText(reply);
      // Update the first chunk to the processing message
      await updateMessage(processingMessageId, chunks[0]);
      // Send remaining chunks as new messages
      for (let i = 1; i < chunks.length; i++) {
        await sendText(chatId, chunks[i]);
      }
    } else {
      // Fallback: send as new messages
      await sendReply(chatId, reply);
    }
  } catch (error) {
    process.stderr.write(`[Feishu] sendToAI error: ${error.message}\n`);
    try {
      if (processingMessageId) {
        await updateMessage(processingMessageId, "❌ AI 服务暂时不可用，请稍后重试。");
      } else {
        await sendText(chatId, "❌ AI 服务暂时不可用，请稍后重试。");
      }
    } catch {
    }
  }
  // finally {
  //   inFlightChats.delete(chatId);
  // }
}

async function handleIncomingEvent(event) {
  const messageId = event?.message?.message_id;
  if (!messageId || markMessageProcessed(messageId)) {
    return;
  }

  if (event?.sender?.sender_type === "app") {
    return;
  }

  const chatType = event?.message?.chat_type || "unknown";
  const isGroup = chatType !== "p2p";
  if (!ALLOWED_CHAT_TYPES.includes(isGroup ? "group" : "p2p")) {
    return;
  }

  const messageType = event?.message?.message_type;
  if (messageType !== "text" && messageType !== "image") {
    return;
  }

  const text = messageType === "text" ? extractTextMessage(event) : "";
  if (isGroup && !hasMention(event, text)) {
    return;
  }

  const images = messageType === "image" ? await downloadImageAttachment(event) : [];
  const senderId =
    event?.sender?.sender_id?.open_id ||
    event?.sender?.sender_id?.user_id ||
    event?.sender?.sender_id?.union_id ||
    "unknown";
  const chatId = event?.message?.chat_id;

  if (!chatId) {
    return;
  }

  lastEventAt = new Date().toISOString();
  await sendToAI({
    chatId,
    senderId,
    text,
    images,
  });
}

function startWebsocket() {
  if (websocketStarted) {
    return;
  }

  wsClient = new Lark.WSClient({
    appId: APP_ID,
    appSecret: APP_SECRET,
    domain: OPEN_BASE,
    loggerLevel: Lark.LoggerLevel.info,
  });

  wsClient.start({
    eventDispatcher: new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data) => {
        try {
          await handleIncomingEvent(data);
        } catch (error) {
          process.stderr.write(`[Feishu] Event handling failed: ${error.message}\n`);
        }
      },
    }),
  });

  websocketStarted = true;
}

const mcp = new Server(
  { name: "feishu-channel", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
      experimental: { "claude/channel": {} },
    },
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "status",
      description: "Show current Feishu channel runtime status.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name !== "status") {
      return {
        content: [
          { type: "text", text: `Unknown tool: ${request.params.name}` },
        ],
        isError: true,
      };
    }

    const tokenState =
      tokenCache.value && tokenCache.expiresAt > Date.now()
        ? `cached until ${new Date(tokenCache.expiresAt).toISOString()}`
        : "not cached";
    const text =
      `channel: ${CHANNEL_NAME}\n` +
      `domain: ${OPEN_BASE}\n` +
      `allowedChatTypes: ${ALLOWED_CHAT_TYPES.join(", ")}\n` +
      `botName: ${BOT_NAME || "(not set)"}\n` +
      `websocket: ${websocketStarted ? "running" : "stopped"}\n` +
      `token: ${tokenState}\n` +
      `lastEventAt: ${lastEventAt || "(none yet)"}`;

    return {
      content: [{ type: "text", text }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  process.stderr.write("[Feishu] Shutting down\n");
  try {
    wsClient?.stop?.();
  } catch {
  }
  process.exit(0);
}

process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startWebsocket();
await mcp.connect(new StdioServerTransport());
process.stderr.write("[Feishu] MCP server ready — waiting for Feishu events\n");
