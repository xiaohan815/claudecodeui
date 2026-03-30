# Channel 开发指南

> 参考分支：`feature/channel-support`  
> 写给开发下一个 channel（Telegram / Discord / Slack / WhatsApp 等）的开发者，
> 读完这篇文档即可直接动手，不用再看其他背景材料。

---

## 1. 什么是 Channel

Channel 是通过**外部消息平台**（iMessage、Telegram 等）与 claudecodeui 里 AI 交互的插件。
用户在外部平台发消息 → Channel 进程收到 → 调用 claudecodeui API → 把 AI 回复发回去。

```
外部平台用户
    │  发消息
    ▼
Channel MCP Server（child process，node server.js）
    │  POST /api/channels/message  + Service Token
    ▼
claudecodeui  →  Claude / Cursor / Codex / Gemini
    │  { content, sessionId }
    ▼
Channel MCP Server
    │  调平台 API 发送
    ▼
外部平台用户收到回复
```

Channel 对 AI Provider 无感知——底层用哪个 Provider 由 claudecodeui 决定。

---

## 2. 架构速览

### 2.1 已有的服务端基础设施（不用改）

| 文件 | 作用 |
|------|------|
| `server/channels/token-manager.js` | 生成 / 验证 / 撤销 Service Token（365d JWT） |
| `server/channels/channel-manager.js` | Channel 生命周期：启动 / 停止 / 重启 / enable/disable |
| `server/channels/mcp-manager.js` | MCP stdio 客户端，连接 channel 进程 |
| `server/channels/access-control.js` | gate() 访问控制（allowlist / pairing / disabled） |
| `server/channels/channel-bridge.js` | WebSocket ↔ MCP 通知桥接 |
| `server/channels/index.js` | 统一 re-export |
| `server/routes/channels.js` | REST API `/api/channels/*` |
| `server/database/db.js` | `channelTokenDb` / `channelAccessDb` / `channelSessionsDb` |
| `server/middleware/auth.js` | `authenticateToken` 支持 Service Token |

### 2.2 数据库表（已创建，随 migration 自动建）

```sql
-- Channel 服务令牌
channel_service_tokens (token_id, channel_name, token, expires_at, is_revoked)

-- 访问控制白名单
channel_access (channel_name, sender_id, sender_type, policy)

-- 外部 chat_id ↔ Claude sessionId 映射
channel_sessions (channel_name, external_chat_id, session_id)
```

---

## 3. 核心 API：POST /api/channels/message

这是 channel 进程与 AI 通信的唯一入口。

**请求**

```
POST http://localhost:23003/api/channels/message
Authorization: Bearer <CHANNEL_SERVICE_TOKEN>
Content-Type: application/json

{
  "message":          "用户发的文字",
  "externalChatId":   "平台的 chat/channel/room ID（用于会话追踪）",
  "externalSenderId": "发送者 ID（可选，用于日志）",
  "projectPath":      "/Users/xxx/myproject"  // 可选，AI 工作目录，默认 ~
}
```

**成功响应**

```json
{
  "content": "AI 的回复文字",
  "sessionId": "claude-session-abc123"
}
```

> `sessionId` 会被服务端自动存入 `channel_sessions`。
> 下次同一 `externalChatId` 发来消息时，服务端自动恢复该 session，保持对话连续性。
> **Channel 进程不需要自己维护 sessionId。**

**错误响应**

| HTTP | 含义 |
|------|------|
| 400 | `message` 或 `externalChatId` 缺失 |
| 403 | Token 无效或不是 Service Token |
| 500 | AI 查询失败或超时（5 分钟超时） |

---

## 4. Channel 环境变量

claudecodeui 启动 channel 进程时自动注入：

| 变量 | 值 | 说明 |
|------|----|------|
| `CHANNEL_SERVICE_TOKEN` | `eyJ...` | 调用 `/api/channels/message` 的 JWT |
| `CHANNEL_API_ENDPOINT` | `http://localhost:23003/api` | API base URL |
| `CHANNEL_NAME` | `my-channel` | 当前 channel 名称 |

---

## 5. 开发新 Channel：三个文件

Channel 是一个独立的 Node.js 包，放在 `examples/<name>-channel/` 或任意本地路径，通过 UI 安装进 `~/.claude-code-ui/plugins/`。

### 5.1 manifest.json

```json
{
  "name": "my-channel",
  "displayName": "My Channel",
  "version": "0.1.0",
  "description": "一句话说这个 channel 做什么",
  "type": "channel",
  "entry": "server.js",
  "server": "server.js",
  "icon": "MessageSquare",
  "slot": "tab",
  "permissions": []
}
```

必须字段：`name`、`type: "channel"`、`server`

### 5.2 package.json

```json
{
  "name": "claudecodeui-my-channel",
  "version": "0.1.0",
  "type": "module",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
```

**必须是 `"type": "module"`**（ESM），否则 `import` 语法会报错。

### 5.3 server.js 最小模板

```js
#!/usr/bin/env node
/**
 * My Channel for claudecodeui
 * 
 * 1. 从外部平台接收消息（webhook / polling / bot SDK）
 * 2. 调 /api/channels/message 发给 AI
 * 3. 把 AI 回复发回外部平台
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// ── 环境变量（由 claudecodeui 注入）─────────────────────────────────────────
const SERVICE_TOKEN = process.env.CHANNEL_SERVICE_TOKEN;
const API_ENDPOINT  = process.env.CHANNEL_API_ENDPOINT || 'http://localhost:23003/api';
const CHANNEL_NAME  = process.env.CHANNEL_NAME || 'my-channel';

if (!SERVICE_TOKEN) {
  process.stderr.write('[MyChannel] CHANNEL_SERVICE_TOKEN not set — exiting\n');
  process.exit(1);
}

process.on('unhandledRejection', err => process.stderr.write(`[MyChannel] ${err}\n`));
process.on('uncaughtException',  err => process.stderr.write(`[MyChannel] ${err}\n`));

// ── 发消息给 AI ───────────────────────────────────────────────────────────────
// chatId   — 外部平台的会话 ID（同一 chatId 复用 Claude session）
// senderId — 发送者 ID（仅用于日志）
// text     — 用户消息文字
async function sendToAI(chatId, senderId, text) {
  const res = await fetch(`${API_ENDPOINT}/channels/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_TOKEN}`,
    },
    body: JSON.stringify({
      message:          text,
      externalChatId:   chatId,
      externalSenderId: senderId,
    }),
  });

  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const { content } = await res.json();
  return content; // AI 回复的纯文字
}

// ── 外部平台监听（以 Telegram 为例，换成你的平台 SDK）─────────────────────────
// import { Telegraf } from 'telegraf';
// const bot = new Telegraf(process.env.BOT_TOKEN);
// bot.on('text', async ctx => {
//   const reply = await sendToAI(
//     String(ctx.chat.id),
//     String(ctx.from.id),
//     ctx.message.text
//   );
//   await ctx.reply(reply);
// });
// bot.launch();

// ── MCP Server（让 claudecodeui 管理进程生命周期）─────────────────────────────
const mcp = new Server(
  { name: CHANNEL_NAME, version: '0.1.0' },
  { capabilities: { tools: {}, experimental: { 'claude/channel': {} } } }
);

// 可选：暴露管理工具（status / configure 等）
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
mcp.setRequestHandler(CallToolRequestSchema, async req => ({
  content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
  isError: true,
}));

// ── 优雅关闭 ─────────────────────────────────────────────────────────────────
let shutting = false;
function shutdown() {
  if (shutting) return; shutting = true;
  process.stderr.write('[MyChannel] Shutting down\n');
  process.exit(0);
}
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await mcp.connect(new StdioServerTransport());
process.stderr.write(`[MyChannel] Ready\n`);
```

---

## 6. 访问控制（复用 gate()）

`server/channels/access-control.js` 已实现三种模式。

| 模式 | 行为 |
|------|------|
| `allowlist`（默认） | 只有在 `/api/channels/:name/access` 里加过白名单的 sender 才能通过 |
| `pairing` | 新 sender 收到配对码，验证后自动加入白名单 |
| `disabled` | 所有消息丢弃 |

channel 进程**不需要自己实现 gate()**——直接调 `GET /api/channels/:name/access` 查白名单，或把 senderId 作为参数传给后端，让后端做判断（已在 `/api/channels/message` handler 里按 `channelSource` 区分）。

若需要 channel 进程自己判断（如离线模式），可读取 `~/.claude-code-ui/channels/<name>/access.json`：

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["+15551234567", "user@example.com"],
  "pending": {}
}
```

---

## 7. 安装与测试流程

```bash
# 1. 开发完毕，进 claudecodeui UI
Settings → Channels → Install Channel
# 输入本地绝对路径，如：
/Users/xhm5/work/cc_research/claudecodeui/examples/my-channel

# 2. Enable（UI 点击 or API）
curl -X POST http://localhost:23003/api/channels/my-channel/enable \
  -H "Authorization: Bearer <jwt>"

# 3. 获取 service token 手动测试
TOKEN=$(curl -s http://localhost:23003/api/channels/my-channel/token \
  -H "Authorization: Bearer <jwt>" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

curl -X POST http://localhost:23003/api/channels/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello","externalChatId":"test-1","externalSenderId":"dev"}'
# 预期: {"content":"AI reply...","sessionId":"abc..."}

# 4. 第二条消息复用同一 session
curl -X POST http://localhost:23003/api/channels/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"what was my first message?","externalChatId":"test-1","externalSenderId":"dev"}'
# AI 应该说出 "hello"
```

---

## 8. 参考实现对比

| 特性 | iMessage | Telegram（你的下一个） |
|------|----------|----------------------|
| 消息获取 | 轮询 `chat.db`（SQLite） | Telegram Bot API（webhook 或 polling） |
| 消息发送 | `osascript` AppleScript | `ctx.reply()` / Bot API |
| 依赖 | `better-sqlite3` | `telegraf` 或 `grammy` |
| 平台限制 | macOS + Full Disk Access | 需要 Bot Token，跨平台 |
| 自聊检测 | 读 `message.account` | 不需要（bot 账号单独存在） |
| 访问控制 | 自实现 gate() | 可复用 server 端 gate() |
| 配置文件 | `~/.claude-code-ui/channels/imessage/access.json` | `~/.claude-code-ui/channels/telegram/access.json` |

### iMessage 特有逻辑（Telegram 不需要）

- **Full Disk Access** 检测
- **`parseAttributedBody()`**（解析 macOS attributedBody blob）
- **自地址检测**（`SELF` set，从 `message.account` 读）
- **Echo 过滤**（防止处理自己发出的消息）
- **AppleScript 发送**（`spawnSync('osascript', ...)`）
- **`approved/` 目录轮询**（配对确认机制）

---

## 9. 关键注意事项

### sender ID 大小写必须统一

`allowFrom` 里存的是**小写**，gate 检查时也需要用 `senderId.toLowerCase()` 比对。
否则大写/混合大小写的 handle ID 会被 allowlist 漏判。

### externalChatId 是会话追踪的唯一 key

同一外部会话（如 Telegram chat_id）必须每次传相同的 `externalChatId`，
claudecodeui 据此从 `channel_sessions` 查找对应 Claude sessionId，保持上下文连续。

### 并发请求去重

同一 chatId 同时收到多条消息时，后一条可能在前一条 AI 还没回复时到达。
建议用 `Map<chatId, Promise>` 或队列做串行化（iMessage 实现里用了 `inFlight` Map）。

### 5 分钟 AI 超时

`/api/channels/message` 的超时是 5 分钟。
如果外部平台有更短的 webhook 超时（如 Telegram 60s），需要先回复 "思考中..."，
等 AI 响应后再发第二条消息。

### MCP Server 的必要性

Channel 进程必须是 MCP Server，claudecodeui 通过 stdio 连接它，用于：
- **生命周期管理**（enable/disable/restart）
- **健康检测**（`listTools` 轮询）
- **暴露管理工具**（status / allow / pair 等可选）

如果不做 MCP Server，claudecodeui 无法管理进程。

---

## 10. 文件变更速查（本次 PR 改了什么）

### 新增文件

```
server/channels/
  access-control.js   — gate() 访问控制
  channel-bridge.js   — WebSocket ↔ MCP 桥接
  channel-manager.js  — Channel 生命周期
  index.js            — 统一导出
  mcp-manager.js      — MCP stdio 客户端
  token-manager.js    — Service Token 生成/验证

server/routes/channels.js         — /api/channels/* REST API（含 /message 端点）

examples/echo-channel/            — 最简示例 channel
examples/imessage-channel/        — iMessage channel 完整实现

docs/CHANNEL_USAGE.md             — 用户使用说明
docs/CHANNEL_TESTING.md           — 测试说明
docs/plans/2026-03-30-imessage-channel.md  — 实施方案（归档）
docs/CHANNEL_DEV_GUIDE.md         — 本文档
```

### 修改文件

| 文件 | 改动内容 |
|------|---------|
| `server/middleware/auth.js` | `authenticateToken` 支持 Service Token；设置 `req.isServiceRequest` / `req.channelSource` |
| `server/database/db.js` | 新增 `channel_service_tokens` / `channel_access` / `channel_sessions` 三表；`channelTokenDb` / `channelAccessDb` / `channelSessionsDb` 操作对象 |
| `server/index.js` | 启动时调 `initializeChannelBridge()` + `startEnabledChannels()`；关闭时 `stopAllChannels()` |
| `server/utils/plugin-loader.js` | `ALLOWED_TYPES` 加入 `'channel'` |
| `src/components/settings/view/Settings.tsx` | 注册 Channels 设置标签页 |
| `src/components/settings/view/SettingsSidebar.tsx` | 侧边栏加 Channels 入口 |
| `src/components/settings/types/types.ts` | 加 Channels 相关类型 |
| `src/i18n/locales/*/settings.json` | 各语言加 Channels 相关文案 |
| `src/components/settings/view/tabs/channels-settings/ChannelsSettingsTab.tsx` | Channels UI 组件 |

---

## 11. 快速 Checklist（开发新 channel 时对照）

- [ ] `manifest.json` 里 `"type": "channel"` 且 `"server"` 字段指向入口文件
- [ ] `package.json` 里 `"type": "module"` + 依赖齐全
- [ ] `server.js` 里读取 `CHANNEL_SERVICE_TOKEN` / `CHANNEL_API_ENDPOINT` / `CHANNEL_NAME`
- [ ] `SERVICE_TOKEN` 为空时 `process.exit(1)`
- [ ] 调用 `POST /api/channels/message` 时每次传相同的 `externalChatId`
- [ ] 并发同一 chatId 的消息做串行化（inFlight 或队列）
- [ ] 服务端用 `senderId.toLowerCase()` 统一大小写
- [ ] 实现了 MCP Server（`ListToolsRequest` / `CallToolRequest` handler）
- [ ] 监听 `process.stdin.on('end')` / `SIGTERM` / `SIGINT` 做优雅关闭
- [ ] 本地测试：用 `curl POST /api/channels/message` 确认 `{ content, sessionId }` 返回正常
- [ ] 第二条同 chatId 消息测试：AI 能记住上一条消息内容
