# iMessage Channel — 工作目录 & Provider 选择 实现计划

> **实际运行环境（重要）**
>
> | 项目 | 路径 |
> |------|------|
> | 实际 DB 文件 | `~/.cloudcli/auth.db`（由 `DATABASE_PATH` 环境变量指定） |
> | 插件安装目录 | `~/.claude-code-ui/plugins/imessage-channel/` |
> | 服务端口 | `23003` |
>
> ⚠️ `claudecodeui/server/database/auth.db` 是空文件，不是运行时使用的 DB。
> 调试时用 `lsof -p <PID> | grep auth.db` 确认实际路径。

## 背景 & 问题

### 问题 1：Channel Tab 报错
当前 `manifest.json` 中 `"entry": "server.js"`，指向的是 Node.js MCP 后端代码。
`PluginTabContent` 把这个文件用 Blob URL 在浏览器里 dynamic import，浏览器无法识别
`@modelcontextprotocol/sdk/server/index.js` 这类裸模块路径，直接崩掉。

### 问题 2：工作目录硬编码
`server/routes/channels.js` `/message` 路由：
```js
const cwd = projectPath || os.homedir();  // 永远是 /Users/xhm5
```
没有持久化配置，无法切换。

### 问题 3：Provider 硬编码
`/message` 路由只调用 `queryClaudeSDK`，无法使用 Cursor / Codex / Gemini。
而 UI 的新建会话界面已经支持 4 个 provider，channel 侧完全缺失这层分发。

---

## 目标

1. 修复 iMessage Channel tab 报错，改为展示功能性的控制面板
2. 支持在面板内切换**工作目录**（从已有项目列表选，或手动输入）
3. 支持在面板内切换 **AI Provider**（Claude Code / Cursor / Codex / Gemini）
4. 支持选择对应 **Model**（随 provider 联动）
5. 配置持久化，重启服务后生效

---

## 方案 A：Plugin Tab 控制面板（本次实现）

### 整体架构

```
浏览器 (PluginTabContent)
  └── 动态 import ~/.claude-code-ui/plugins/imessage-channel/index.js
        └── 纯 ES Module，无框架依赖
              ├── fetch /api/channels/imessage-channel/config  (GET/POST)
              ├── fetch /api/projects                          (拉项目列表)
              └── fetch /api/channels/imessage-channel        (查 running 状态)

服务端 (channels.js /message)
  └── 读 channelConfigDb.getConfig(channelName)
        ├── provider === 'claude'  → queryClaudeSDK
        ├── provider === 'cursor'  → spawnCursor
        ├── provider === 'codex'   → queryCodex
        └── provider === 'gemini'  → spawnGemini
```

---

## 文件变更清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `server/database/db.js` | 改 | 新增 channel_config 表迁移 + channelConfigDb 对象 |
| `server/routes/channels.js` | 改 | Config CRUD 补全 + /message provider 分发 |
| `~/.claude-code-ui/plugins/imessage-channel/index.js` | 新建 | 浏览器端控制面板 |
| `~/.claude-code-ui/plugins/imessage-channel/manifest.json` | 改 | entry 从 server.js 改为 index.js |

> 注意：后两个文件在运行时目录 `~/.claude-code-ui/plugins/imessage-channel/`，
> 不是代码仓库里的 `external_plugins/imessage/`。

---

## Phase 1：后端

### 1.1 `server/database/db.js` — 新增 channel_config 表

在 `runMigrations` 函数中添加：

```sql
CREATE TABLE IF NOT EXISTS channel_config (
  channel_name TEXT PRIMARY KEY,
  cwd          TEXT,
  provider     TEXT NOT NULL DEFAULT 'claude',
  model        TEXT,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

新增 `channelConfigDb` 对象，导出以下方法：

| 方法 | 说明 |
|------|------|
| `getConfig(channelName)` | 返回 `{cwd, provider, model}`，不存在则返回默认值 |
| `setConfig(channelName, {cwd, provider, model})` | UPSERT |

### 1.2 `server/routes/channels.js` — Config 路由补全 + provider 分发

**新增 import：**
```js
import { spawnCursor } from '../cursor-cli.js';
import { spawnGemini } from '../gemini-cli.js';
import { queryCodex } from '../openai-codex.js';
import { channelConfigDb } from '../database/db.js';
```

**`GET /:name/config`** — 返回 DB 中存储的完整配置：
```json
{
  "config": {
    "cwd": "/Users/xhm5/work/xcloud501",
    "provider": "claude",
    "model": "sonnet"
  }
}
```

**`POST /:name/config`** — 接收并持久化 `{cwd, provider, model}`

**`POST /message`** — 替换硬编码 `queryClaudeSDK`：
```js
const config = channelConfigDb.getConfig(channelName);
const cwd      = config.cwd || projectPath || os.homedir();
const provider = config.provider || 'claude';
const model    = config.model   || undefined;

// Session 续接：Claude 使用已有 sessionId，其他 provider 暂不续接
const sessionId = provider === 'claude'
  ? channelSessionsDb.getSession(channelName, externalChatId) || undefined
  : undefined;

if (provider === 'claude') {
  queryClaudeSDK(message, { cwd, sessionId, model, permissionMode: 'bypassPermissions', ... }, writer)
} else if (provider === 'cursor') {
  spawnCursor(message, { cwd, model, skipPermissions: true }, writer)
} else if (provider === 'codex') {
  queryCodex(message, { cwd, model, permissionMode: 'bypassPermissions' }, writer)
} else if (provider === 'gemini') {
  spawnGemini(message, { cwd, model, skipPermissions: true }, writer)
}
```

---

## Phase 2：前端 — 浏览器端控制面板

### 2.1 `index.js` — 纯 ES Module，无依赖

**核心约束：**
- 不能有裸模块 import（浏览器 Blob URL 加载，无 bundler）
- 通过 `localStorage.getItem('auth-token')` 获取鉴权 token
- 直接 `fetch` 主服务 API，不走 `api.rpc`（channel 类型无 HTTP server）
- 适配 light/dark 主题（通过 `api.context.theme`）

**UI 布局（参考新建会话对话框风格）：**

```
┌─────────────────────────────────────────────────────────────┐
│  🟢 iMessage Channel  running              [重启] [停止]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  AI 助手                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │✓ Claude  │  │  Cursor  │  │  Codex   │  │  Gemini  │  │
│  │  Code    │  │          │  │          │  │          │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│                                                             │
│  模型          [ Sonnet ▾ ]                                 │
│                                                             │
│  ─────────────────────────────────────────────────────      │
│                                                             │
│  工作目录                                                    │
│  ┌──────────────────────────────────────────────┐          │
│  │ 📁 xcloud501  /Users/xhm5/work/xcloud501  ▾ │          │
│  └──────────────────────────────────────────────┘          │
│  ── 或手动输入 ──────────────────────────────────          │
│  [ /Users/xhm5/                              ]             │
│                                                             │
│  Claude 将在此目录下执行文件操作                              │
│                                                             │
│                                     [保存配置]              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  访问控制                                                    │
│  策略: allowlist   已授权联系人: 1   [查看详情 →]            │
└─────────────────────────────────────────────────────────────┘
```

**导出接口：**
```js
export function mount(container, api) { ... }
export function unmount(container) { ... }
```

**数据流：**
1. `mount` 调用时：
   - `GET /api/channels/imessage-channel` → 获取 running 状态
   - `GET /api/channels/imessage-channel/config` → 填充当前配置
   - `GET /api/projects` → 填充工作目录下拉列表
2. 用户修改 provider/model/cwd → 本地 state 更新，UI 联动
3. 点击「保存配置」→ `POST /api/channels/imessage-channel/config`
4. `api.onContextChange` → theme 变化时重新应用样式

### 2.2 `manifest.json` 变更

```json
{
  "entry": "index.js"   // 原来是 "server.js"
}
```

---

---

## 调试记录 & 已踩的坑

### 坑 1：下拉列表为空
`/api/projects` 直接返回数组 `[...]`，不是 `{ projects: [...] }`。
`index.js` 里需要用 `Array.isArray(data) ? data : (data.projects || [])` 处理。

### 坑 2：session resume 覆盖 cwd
旧 session 是在 `/Users/xhm5`（homedir）下创建的。Claude SDK `resume` 模式会沿用
原 session 的 cwd，新传入的 cwd 被忽略。

**修复**：`POST /:name/config` 保存时，若 cwd 或 provider 有变化，自动调用
`channelSessionsDb.clearAllSessions(name)` 清掉旧 sessions。

手动清除命令（一次性）：
```bash
sqlite3 ~/.cloudcli/auth.db "DELETE FROM channel_sessions WHERE channel_name='imessage-channel';"
```

### 坑 3：projectPath 优先级错误（根本原因）
`imessage-channel/server.js` 每条消息都在 body 里携带：
```js
// server.js line 264
projectPath: PROJECT_PATH,   // = process.env.IMESSAGE_PROJECT_PATH || homedir()
```
`PROJECT_PATH` 默认是 `homedir()` = `/Users/xhm5`，每次都非空。

`channels.js` 原来的写法：
```js
const cwd = projectPath || config.cwd || os.homedir();  // ❌ config.cwd 永远跳过
```

**修复**：调换优先级，用户显式配置优先：
```js
const cwd = config.cwd || projectPath || os.homedir();  // ✅
```

---

## 实现顺序

```
Step 1  server/database/db.js          — channel_config 表 + channelConfigDb
Step 2  server/routes/channels.js      — Config 路由 + provider 分发
Step 3  imessage-channel/index.js      — 浏览器控制面板
Step 4  imessage-channel/manifest.json — 修正 entry
```

每次修改服务端文件（`db.js`、`channels.js`）后需要**重启 claudecodeui 主服务**才能生效。
仅重启 iMessage Channel（MCP server）不够，那只重启了消息轮询进程。

---

## 已知限制 & 后续优化

| 项目 | 当前版本 | 后续 |
|------|----------|------|
| Session 续接 | 仅 Claude 支持 | 可为每个 provider 单独存 session |
| 权限控制 | 三个 provider 均用 bypassPermissions | 可暴露权限模式选项 |
| 访问控制面板 | 只读展示 | 可在面板内直接管理 allowlist |
| 多 channel 支持 | imessage-channel 专用 | index.js 可改为通用 channel panel 模板 |
```

Now let me implement the code. I'll proceed in order.