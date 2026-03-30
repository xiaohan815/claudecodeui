# Channel 功能测试指南

## 当前状态

✅ **Echo Channel 已成功安装并启动**
- Channel 名称: echo-channel
- 状态: running (运行中)
- 你的手机号 (+86 18701307152) 已添加到白名单

## 如何测试

### 方法 1: 通过 API 直接测试

Channel 暴露了一个 HTTP API，可以直接发送测试消息：

```bash
# 获取 Service Token
curl http://localhost:23003/api/channels/echo-channel/token \
  -H "Authorization: Bearer <你的登录token>"

# 使用 Service Token 发送消息
curl -X POST http://localhost:23003/api/chat/stream \
  -H "Authorization: Bearer <service_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello from Echo Channel!",
    "channelSource": "echo-channel",
    "externalChatId": "test-chat-001",
    "externalSenderId": "+86 18701307152"
  }'
```

### 方法 2: 模拟 MCP 调用

Channel 通过 MCP 协议暴露了两个工具：
- `receive_message`: 接收外部消息并转发给 AI
- `send_message`: 发送 AI 响应回外部源

可以通过以下方式测试 MCP 工具调用（需要开发测试脚本）。

### 方法 3: 开发真实的 Channel

Echo Channel 只是一个演示，要真正接收外部消息（如 Telegram、飞书），需要：

1. **Telegram Channel**: 使用 Telegraf 库监听 Telegram 消息
2. **飞书 Channel**: 使用飞书 Bot SDK 接收消息
3. **短信 Channel**: 使用 Twilio/其他短信服务提供商

#### Channel 开发模板

创建一个新的 Channel 目录结构：
```
my-channel/
├── manifest.json          # Channel 元数据
├── server.js             # MCP 服务器实现
├── package.json          # 依赖
└── README.md             # 说明
```

**manifest.json:**
```json
{
  "name": "my-channel",
  "displayName": "My Channel",
  "version": "0.1.0",
  "description": "描述",
  "type": "channel",
  "entry": "server.js",
  "server": "server.js"
}
```

**server.js 基本结构:**
```javascript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const SERVICE_TOKEN = process.env.CHANNEL_SERVICE_TOKEN;
const API_ENDPOINT = process.env.CHANNEL_API_ENDPOINT;
const CHANNEL_NAME = process.env.CHANNEL_NAME;

const server = new Server({ name: CHANNEL_NAME, version: '0.1.0' }, {
  capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
});

// 注册工具
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'receive_message',
    description: 'Receive message',
    inputSchema: { type: 'object', properties: { sender_id: { type: 'string' }, text: { type: 'string' } }, required: ['sender_id', 'text'] },
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'receive_message') {
    // 转发到 claudecodeui API
    const response = await fetch(`${API_ENDPOINT}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_TOKEN}` },
      body: JSON.stringify({
        message: request.params.arguments.text,
        channelSource: CHANNEL_NAME,
        externalSenderId: request.params.arguments.sender_id,
      }),
    });
    return { content: [{ type: 'text', text: 'Forwarded' }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## 工作原理

```
外部消息源 (Telegram/飞书/短信)
    ↓
Channel MCP Server (独立进程)
    ↓ (Service Token 认证)
claudecodeui API (/api/chat/stream)
    ↓
AI Provider (Claude/Cursor/Codex/Gemini)
    ↓
WebSocket 广播
    ↓
Channel MCP Server (通过 notification)
    ↓
外部消息源 (发送回复)
```

## 下一步

如果要测试真实场景，可以：
1. 开发一个 Telegram Bot Channel
2. 或者开发一个飞书 Bot Channel
3. 使用 webhook 接收外部消息并转发给 claudecodeui

Echo Channel 的主要价值是演示了完整的 Channel 架构，真正的生产使用需要根据具体平台开发对应的 Channel 实现。
