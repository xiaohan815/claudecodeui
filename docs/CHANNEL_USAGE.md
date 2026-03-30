# Channel 功能使用指南

## 快速开始

### 1. 安装依赖

首先安装 MCP SDK（Model Context Protocol）：

```bash
npm install @modelcontextprotocol/sdk zod
```

### 2. 启动 claudecodeui

```bash
npm run start
```

### 3. 打开 Channel 管理页面

1. 打开浏览器访问 `http://localhost:23003`（或你配置的端口）
2. 登录后点击左下角的 **设置**（Settings）
3. 在左侧菜单中找到 **Channels** 标签

## 使用内置的 Echo Channel（示例）

### 安装 Echo Channel

1. 在 Channels 页面点击 **Install Channel**
2. 输入 GitHub URL: `examples/echo-channel`（本地路径）或你自己的 channel 仓库
3. 点击 **Install**

### 启用 Channel

1. 在 channel 列表中找到 **Echo Channel**
2. 点击 **Enable** 按钮
3. 状态变为 **running** 表示启动成功

### 测试 Channel

Echo Channel 是一个演示用的 channel，它会：
- 接收消息
- 通过 Service Token 调用 claudecodeui API
- 将消息转发给当前激活的 AI Provider

你可以通过 API 测试：

```bash
# 获取 Service Token（需要从 channel 进程中获取，或通过日志查看）
# 然后调用 API
curl -X POST http://localhost:23003/api/chat/stream \
  -H "Authorization: Bearer <service_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello from Echo Channel",
    "channelSource": "echo-channel",
    "externalChatId": "test-chat-001"
  }'
```

## 开发自己的 Channel

### Channel 文件结构

```
my-channel/
├── manifest.json          # Channel 元数据
├── server.js             # MCP 服务器实现
├── package.json          # 依赖声明
└── README.md             # 说明文档
```

### manifest.json

```json
{
  "name": "my-channel",
  "displayName": "My Channel",
  "version": "0.1.0",
  "description": "我的自定义 Channel",
  "type": "channel",
  "entry": "server.js",
  "server": "server.js"
}
```

**重要字段说明：**
- `type`: 必须是 `"channel"`
- `server`: 服务器启动脚本路径
- `entry`: 前端入口（channel 通常不需要前端，但可以复用）

### server.js 基本结构

```javascript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// 从环境变量获取配置
const SERVICE_TOKEN = process.env.CHANNEL_SERVICE_TOKEN;
const API_ENDPOINT = process.env.CHANNEL_API_ENDPOINT;
const CHANNEL_NAME = process.env.CHANNEL_NAME;

// 创建 MCP 服务器
const server = new Server(
  { name: CHANNEL_NAME, version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},              // 声明 channel 能力
        'claude/channel/permission': {},    // 声明权限转发能力（可选）
      },
    },
  }
);

// 定义工具：接收外部消息
server.setRequestHandler(
  z.object({
    method: z.literal('tools/call'),
    params: z.object({
      name: z.literal('receive_message'),
      arguments: z.object({
        sender_id: z.string(),
        chat_id: z.string(),
        text: z.string(),
      }),
    }),
  }),
  async ({ params }) => {
    const { sender_id, chat_id, text } = params.arguments;

    console.error(`[${CHANNEL_NAME}] Received: ${text}`);

    // 调用 claudecodeui API
    const response = await fetch(`${API_ENDPOINT}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_TOKEN}`,
      },
      body: JSON.stringify({
        message: text,
        channelSource: CHANNEL_NAME,
        externalChatId: chat_id,
        externalSenderId: sender_id,
      }),
    });

    return {
      content: [{ type: 'text', text: 'Message forwarded' }],
    };
  }
);

// 处理 AI 响应通知
server.setNotificationHandler(
  z.object({
    method: z.literal('notifications/channel/response'),
    params: z.object({
      content: z.string(),
      chat_id: z.string().optional(),
    }),
  }),
  async ({ params }) => {
    console.error(`[${CHANNEL_NAME}] AI response: ${params.content}`);
    // 发送回外部消息源
  }
);

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[${CHANNEL_NAME}] Connected to claudecodeui`);
```

### 与外部服务集成

以 Telegram Bot 为例：

```javascript
import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);

// 接收 Telegram 消息
bot.on('text', async (ctx) => {
  const message = {
    sender_id: ctx.from.id.toString(),
    chat_id: ctx.chat.id.toString(),
    text: ctx.message.text,
  };

  // 调用 receive_message 工具
  await server.notification({
    method: 'tools/call',
    params: {
      name: 'receive_message',
      arguments: message,
    },
  });
});

bot.launch();
```

## API 端点

### Channel 管理 API

所有 API 都需要 JWT 认证（除了 health check）。

#### 列出所有 Channels

```http
GET /api/channels
Authorization: Bearer <jwt_token>

Response:
{
  "channels": [
    {
      "name": "echo-channel",
      "displayName": "Echo Channel",
      "version": "0.1.0",
      "enabled": true,
      "status": "running"
    }
  ]
}
```

#### 安装 Channel

```http
POST /api/channels/install
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "url": "https://github.com/user/my-channel"
}
```

#### 启用 Channel

```http
POST /api/channels/:name/enable
Authorization: Bearer <jwt_token>
```

#### 禁用 Channel

```http
POST /api/channels/:name/disable
Authorization: Bearer <jwt_token>
```

#### 获取访问控制列表

```http
GET /api/channels/:name/access
Authorization: Bearer <jwt_token>

Response:
{
  "access": [
    {
      "senderId": "+1234567890",
      "senderType": "user",
      "policy": "allow",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

#### 添加发送者到白名单

```http
POST /api/channels/:name/access
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "senderId": "+1234567890",
  "senderType": "user",
  "policy": "allow"
}
```

### 使用 Service Token 调用 API

Channel 启动时会从环境变量获取 `CHANNEL_SERVICE_TOKEN`，用这个 token 调用 API：

```javascript
const response = await fetch('http://localhost:23003/api/chat/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.CHANNEL_SERVICE_TOKEN}`,
  },
  body: JSON.stringify({
    message: 'Hello',
    channelSource: process.env.CHANNEL_NAME,
    externalChatId: 'chat-001',
  }),
});
```

## 访问控制模式

Channel 支持三种访问控制模式：

### 1. Allowlist 模式（默认）

- 只有白名单中的发送者可以与 AI 交互
- 新发送者的消息会被丢弃
- 适合：个人使用，只与信任的人交互

### 2. Pairing 模式

- 新发送者需要输入配对码才能使用
- Channel 会自动发送配对码给新发送者
- 发送者回复配对码后被添加到白名单
- 适合：需要控制谁能使用，但允许新用户加入

### 3. Disabled 模式

- Channel 完全禁用
- 所有消息都被丢弃
- 适合：临时关闭 channel

在 Channels 管理页面的 **Access Control** 面板中配置白名单。

## 环境变量

Channel 启动时可用的环境变量：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `CHANNEL_SERVICE_TOKEN` | Service Token，用于 API 认证 | eyJhbGciOiJIUzI1NiIs... |
| `CHANNEL_API_ENDPOINT` | claudecodeui API 地址 | http://localhost:23003/api |
| `CHANNEL_NAME` | Channel 名称 | my-channel |
| `NODE_ENV` | Node 环境 | production |
| `HOME` | 用户主目录 | /Users/username |

## 调试技巧

### 1. 查看日志

Channel 的日志输出到 stderr，在 claudecodeui 后端日志中查看：

```bash
npm run start
```

### 2. 手动测试 API

```bash
# 获取 Service Token（从 channel 进程中）
# 然后测试 API 调用
curl -X POST http://localhost:23003/api/chat/stream \
  -H "Authorization: Bearer <service_token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"test"}'
```

### 3. 查看 Channel 状态

在 Channels 管理页面可以看到：
- Channel 运行状态
- 启用的 Channels 列表
- 访问控制白名单

### 4. 重启 Channel

如果 Channel 出现问题：

1. 在 Channels 页面点击 **Disable**
2. 等待几秒
3. 点击 **Enable**

或点击 **Restart** 按钮。

## 常见问题

### Q: Channel 安装失败？

检查：
- manifest.json 格式是否正确
- `type` 字段必须是 `"channel"`
- server.js 是否有执行权限

### Q: Channel 启动后没有响应？

检查：
- 查看后端日志是否有错误
- 确认 Service Token 是否正确获取
- 确认 API 调用是否成功

### Q: 如何支持多个 Provider（Claude/Cursor/Codex/Gemini）？

Channel 不需要关心底层 Provider。通过 claudecodeui API 调用会自动路由到当前激活的 Provider。

### Q: 如何在 Channel 中使用外部服务 API（如 Telegram Bot）？

在 channel 的 package.json 中添加依赖：

```json
{
  "dependencies": {
    "telegraf": "^4.x"
  }
}
```

然后在 server.js 中引入并使用。

### Q: Channel 可以存储数据吗？

可以，Channel 可以：
- 使用本地文件存储（在 channel 目录中）
- 使用数据库（如果需要）
- 使用 claudecodeui 的数据库（通过 API）

建议 Channel 自己管理状态，不要依赖 claudecodeui。

## 参考实现

- **Echo Channel**: `examples/echo-channel/` - 最简示例
- **iMessage Channel**: 参考 `claude-plugins-official/external_plugins/imessage/` - 完整实现

## 贡献

欢迎贡献新的 Channel 实现！可以参考 iMessage Channel 的设计模式。
