<br />

# Feishu Channel 实现计划

> **目标**
> 基于现有 iMessage channel 架构，为 claudecodeui 增加一个可运行的 Feishu/Lark channel：接收飞书 Bot 文本消息，转发到 `/api/channels/message`，再把 AI 回复发回飞书会话。

## 实现范围

- [ ] 复用现有 Channel 生命周期、Service Token、会话映射与 `/api/channels/message`
- [ ] 新增 `examples/feishu-channel/` 独立插件包
- [ ] 支持 Feishu 长连接事件订阅（WebSocket）收消息
- [ ] 支持机器人回发文本消息
- [ ] 提供浏览器可加载的插件入口，避免 `entry: server.js` 崩溃
- [ ] 修正宿主启动边界，避免 channel 被通用 plugin server 重复拉起
- [ ] 补充使用文档与最小验证步骤

## 设计假设

- 第一版支持文本消息和图片消息；附件、卡片、文件与更复杂的富文本可以后续再补。
- 第一版优先支持私聊与机器人可接收的消息场景；群聊先按“被 @ 的文本或图片消息”处理。
- 飞书凭据通过配置页面填写并由服务端持久化，不要求用户手动维护环境变量。
- 国际化租户通过 `FEISHU_DOMAIN=lark` 切换域名；默认走飞书中国站域名。

## 复用 iMessage Channel 的部分

- 保留 “独立 Node.js MCP 子进程 + 调 `/api/channels/message`” 主链路。
- 保留 `externalChatId` → Claude session 自动续接机制。
- 保留宿主注入的 `CHANNEL_SERVICE_TOKEN`、`CHANNEL_API_ENDPOINT`、`CHANNEL_NAME`。
- 不复用 iMessage 专属的 `chat.db` 轮询、AppleScript 发送、macOS 权限与本地 access 文件。

## 目标文件

| 文件                                                                            | 动作 | 说明                                  |
| ----------------------------------------------------------------------------- | -- | ----------------------------------- |
| `server/utils/plugin-process-manager.js`                                      | 修改 | 跳过 `type: "channel"` 的通用 server 自启动 |
| `examples/feishu-channel/manifest.json`                                       | 新建 | Channel 元数据，指向浏览器入口与后端入口            |
| `examples/feishu-channel/package.json`                                        | 新建 | Feishu channel 依赖与脚本                |
| `examples/feishu-channel/server.js`                                           | 新建 | Feishu WebSocket 事件监听、消息转发、消息回发     |
| `examples/feishu-channel/index.js`                                            | 新建 | 浏览器可加载的插件入口或说明面板                    |
| `server/database/db.js`                                                       | 修改 | 增加 Feishu channel 配置/凭据持久化          |
| `server/routes/channels.js`                                                   | 修改 | 增加 Feishu channel 配置读取/保存接口         |
| `src/components/settings/view/tabs/channels-settings/ChannelsSettingsTab.tsx` | 修改 | 在配置页中编辑 Feishu 参数                   |
| `docs/CHANNEL_USAGE.md` 或独立文档                                                 | 修改 | 配置飞书应用、配置页面使用方式、安装与验证               |

## 配置页面方案

宿主运行时变量继续复用：

- `CHANNEL_SERVICE_TOKEN`
- `CHANNEL_API_ENDPOINT`
- `CHANNEL_NAME`

Feishu 相关配置不再要求用户通过环境变量提供，而是放到 Channel 配置页面中填写并持久化：

- `appId`
- `appSecret`
- `domain`：可选，国际版填 `lark`
- `botName`：可选，仅用于日志或展示
- `allowedChatTypes`：控制首版只放行 `p2p` 或同时支持 `group`

### 存储策略

- `CHANNEL_*` 仍由宿主在启动 channel 进程时运行时注入。
- Feishu 配置由设置页提交到服务端，并由服务端持久化，不要求用户手动编辑 `.env`。
- `appSecret` 作为敏感字段采用“可写不可回显”策略：前端保存时提交，读取配置时只返回是否已设置，不直接回传明文。
- channel 启动时由宿主从已保存的 Feishu 配置中读取，再注入给 `examples/feishu-channel/server.js` 使用。
- `cwd`、`provider`、`model` 继续保持按 `channel_name` 隔离存储：iMessage 和 Feishu 可以各自配置不同的工作目录与模型，互不影响。
- Feishu 自身新增的 `appId`、`appSecret`、`domain`、`botName`、`allowedChatTypes` 也应只归属于 `feishu-channel`，不影响其他 channel。

### 接口方向

- 复用或扩展 `GET/POST /api/channels/:name/config`
- 非敏感字段直接返回
- 敏感字段返回 `hasAppSecret: true|false`
- 如有必要，可拆分为普通配置与凭据配置两个接口，避免把 secret 混入通用响应体

## Feishu Channel 架构

```text
Feishu Event WS
   └─ 收到 im.message.receive_v1
        └─ 解析文本/图片消息
             └─ standardize(chatId, senderId, text, images, projectPath?)
                  └─ POST /api/channels/message
                       └─ claudecodeui 选择 provider + 续接 session
                            └─ 返回 { content, sessionId }
                                 └─ 调飞书发送消息接口回复原会话
```

### 会话映射

- `externalChatId` 使用 Feishu `chat_id`
- `externalSenderId` 使用 `open_id` 或 `user_id`，优先稳定可用字段
- 群聊场景保持按 `chat_id` 续接，确保同一群上下文连续

### 事件过滤

- 仅处理 `im.message.receive_v1`
- 处理 `message_type === "text"` 与 `message_type === "image"`
- 过滤机器人自己发出的消息
- 图片消息需先通过 Feishu 资源接口下载，再按多模态输入转发给支持图片的 provider
- 群聊仅在被 @ 或命令前缀命中时转发，避免噪音

## 分阶段计划

### Phase 1：修正宿主边界

- [ ] 在 `startEnabledPluginServers()` 中跳过 `plugin.type === "channel"`
- [ ] 确认 channel 仅由 `channel-manager` 启动
- [ ] 验证不会再期待 channel 输出通用 plugin 的 ready JSON

### Phase 2：搭建 Feishu 插件骨架

- [ ] 新建 `manifest.json`
- [ ] 新建 `package.json`
- [ ] 新建浏览器入口 `index.js`
- [ ] 新建 `server.js`，初始化 MCP stdio server

### Phase 3：实现配置页与服务端配置持久化

- [ ] 扩展数据库中的 channel 配置结构，支持 Feishu 参数
- [ ] 新增 Feishu 配置读写接口
- [ ] 在 Channels 设置页增加 Feishu 配置表单
- [ ] 对 `appSecret` 做只写与掩码展示
- [ ] 在 channel 启动时把已保存的 Feishu 配置注入子进程

### Phase 4：实现飞书接入

- [ ] 封装飞书 access token 获取与缓存
- [ ] 建立长连接事件订阅
- [ ] 解析飞书文本与图片消息体
- [ ] 下载飞书图片资源并转换为可传给 AI 的输入
- [ ] 调用 `/api/channels/message`
- [ ] 调用飞书发消息接口回发文本
- [ ] 增加基础错误日志、重连与重复消息保护

### Phase 5：文档与验证

- [ ] 写清飞书应用创建步骤、权限与事件订阅项
- [ ] 写清配置页字段与安装步骤
- [ ] 本地启动后验证启用、收消息、回消息、重启恢复

## 关键实现要点

### 1. manifest 设计

- `type` 必须为 `channel`
- `server` 指向 `server.js`
- `entry` 指向浏览器可加载的 `index.js`
- 不把 Node-only 代码暴露给前端动态导入

### 2. Feishu SDK 选择

- 优先采用直接 HTTP 调用，减少额外 SDK 不确定性
- 若仓库已有稳定 Feishu SDK 再评估复用；当前计划默认不依赖未验证第三方 SDK

### 3. 发送到 AI 的适配层

建议抽象为：

```js
sendToAI({
  chatId,
  senderId,
  text,
  projectPath
})
```

这样可以最大化复用 iMessage channel 的内部组织方式，只替换“平台接入层”。

### 4. 飞书凭据管理

- 本次改为“配置页填写 + 服务端持久化 + 启动时注入子进程”
- `appSecret` 不在前端读取接口中明文返回
- 配置保存后允许单独更新或清空 secret，避免每次改普通字段都重复填写

## 需要对齐的飞书平台配置

- 创建企业自建应用
- 开启 Bot 能力
- 申请消息读写相关权限
- 事件订阅选择长连接模式
- 订阅 `im.message.receive_v1`
- 国际版租户需切换 `lark` 域名

## 风险与规避

### 风险 1：Channel 被重复启动

- 现状通用 plugin server 启动器会扫描所有带 `server` 的插件
- 通过在宿主层跳过 `type: "channel"` 规避重复拉起和误报错

### 风险 2：浏览器入口崩溃

- `entry` 当前是 manifest 必填项
- 通过单独的 `index.js` 占位面板规避把 Node 代码导入到浏览器

### 风险 3：飞书事件重复投递

- 需要用 `message_id` 做最近窗口去重
- 对同一 chat 可串行处理，避免重复回复

### 风险 4：群聊噪音

- 首版仅处理私聊或显式 @ 机器人消息
- 其余消息直接忽略

## 验证计划

- 启动 claudecodeui，确认启用任一 channel（包括 Feishu / iMessage）后都只有一条对应的 channel 进程
- 检查 channel 日志，确认成功建立飞书长连接
- 从私聊向机器人发送文本，验证能收到 AI 回复
- 在同一会话连续发送两条消息，验证上下文续接正常
- 重启宿主后再次收发，验证自动重连与恢复
- 验证未配置 Feishu 必填参数时，配置页提示与启动失败信息明确

## 交付结果

完成后应具备以下能力：

- 本地安装 `examples/feishu-channel` 并启用
- 使用飞书 Bot 接收文本并回发 AI 回复
- 复用现有 `/api/channels/message` 与 session 映射
- 不再出现 channel 被通用 plugin server 重复启动的问题
