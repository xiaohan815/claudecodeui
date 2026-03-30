# Echo Channel - Example Channel Plugin

这是一个用于 claudecodeui 的示例 Channel 插件，展示了如何实现一个外部消息渠道。

## 什么是 Channel?

Channel 是 claudecodeui 的外部消息渠道功能，允许用户通过以下方式与 AI 助手交互：

- **iMessage** - 通过 iMessage 应用
- **Telegram** - 通过 Telegram Bot
- **Discord** - 通过 Discord Bot
- **飞书** - 通过飞书机器人
- **Slack** - 通过 Slack App
- 任何其他消息平台

## Channel 工作原理

```
外部消息 → Channel MCP Server → claudecodeui API → AI Provider → Channel → 外部消息源
```

1. Channel 是一个独立的 MCP (Model Context Protocol) 服务器
2. Channel 通过 stdio 与 claudecodeui 通信
3. Channel 使用 Service Token 调用 claudecodeui API
4. AI 响应通过 WebSocket 和 MCP 通知返回给 Channel

## 文件结构

```
echo-channel/
├── manifest.json      # Channel 元数据
├── server.js          # MCP 服务器实现
└── README.md          # 说明文档
```

## manifest.json

```json
{
  "name": "echo-channel",
  "displayName": "Echo Channel",
  "version": "0.1.0",
  "description": "示例 channel 插件",
  "type": "channel",       // 必须是 "channel"
  "entry": "server.js",
  "server": "server.js"     // 服务器脚本入口
}
```

## server.js 核心结构

### 1. 连接 MCP

```javascript
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const server = new Server({ name: 'echo-channel', version: '0.1.0' }, {
  capabilities: {
    tools: {},
    experimental: {
      'claude/channel': {},        // 声明 channel 能力
      'claude/channel/permission': {}  // 声明权限转发能力
    }
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 2. 接收外部消息

Channel 需要实现自己的方式来接收外部消息（轮询、Webhook 等）。

收到消息后，调用 claudecodeui API：

```javascript
const response = await fetch(`${API_ENDPOINT}/chat/stream`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_TOKEN}`  // 从环境变量获取
  },
  body: JSON.stringify({
    message: messageText,
    channelSource: CHANNEL_NAME,
    externalChatId: chatId,
    externalSenderId: senderId
  })
});
```

### 3. 接收 AI 响应

```javascript
server.setNotificationHandler(
  z.object({
    method: z.literal('notifications/channel/response'),
    params: z.object({ content: z.string(), chat_id: z.string() })
  }),
  async ({ params }) => {
    // 发送回外部消息源
    await sendToExternalService(params.chat_id, params.content);
  }
);
```

### 4. 访问控制

使用 claudecodeui 提供的访问控制功能：

```javascript
// Gate 检查
const result = gate({
  channelName: CHANNEL_NAME,
  senderId: senderId,
  chatId: chatId,
  isGroup: false,
  text: messageText,
  policy: 'allowlist'  // 'allowlist' | 'pairing' | 'disabled'
});

if (result.action === 'drop') {
  // 忽略消息
  return;
}

if (result.action === 'pair') {
  // 发送配对码
  await sendToExternalService(chatId, `Pairing code: ${result.code}`);
  return;
}
```

## 环境变量

claudecodeui 启动 Channel 时会提供以下环境变量：

| 变量名 | 说明 |
|--------|------|
| `CHANNEL_SERVICE_TOKEN` | Service Token，用于 API 认证 |
| `CHANNEL_API_ENDPOINT` | claudecodeui API 地址 |
| `CHANNEL_NAME` | Channel 名称 |

## 安装 Channel

1. 将 Channel 代码推送到 GitHub
2. 在 claudecodeui 设置页面 → Channels → Install Channel
3. 输入 GitHub URL: `username/repo`
4. 启用 Channel

## 开发参考

参考实现：`claude-plugins-official/external_plugins/imessage/`

完整的 iMessage Channel 实现，包括：
- chat.db 轮询
- AppleScript 发送消息
- 访问控制（allowlist/pairing）
- 权限请求转发
- 附件处理

## 技术栈

- **MCP SDK**: `@modelcontextprotocol/sdk`
- **传输**: stdio (标准输入输出)
- **认证**: JWT Service Token
- **API**: REST API + WebSocket

## 注意事项

1. Channel 必须通过 stdio 与 claudecodeui 通信
2. Channel 需要使用提供的 Service Token 进行 API 调用
3. Channel 应该处理自己的状态持久化（如果需要）
4. 遵循 MCP 协议规范
5. 注意安全性（访问控制、输入验证等）

## 常见问题

### Q: Channel 和 Plugin 有什么区别？

A:
- **Plugin**: 前端扩展，添加新的 UI 标签页
- **Channel**: 后端 MCP 服务器，连接外部消息源

### Q: 如何调试 Channel？

A:
1. 使用 `console.error()` 输出日志（stdout 用于 MCP 通信）
2. 查看 claudecodeui 后端日志
3. 使用 MCP inspector 工具

### Q: Channel 可以使用 HTTP 而不是 stdio 吗？

A: 目前 claudecodeui 只支持 stdio 模式的 Channel，以确保与 Claude Code 原生 channel 的兼容性。

### Q: 如何支持多个 Provider（Claude/Cursor/Codex/Gemini）？

A: Channel 不需要关心底层 Provider。通过 claudecodeui API 调用会自动路由到当前激活的 Provider。

## 许可证

MIT
