# AGENTS.md

本文件为 Codex (Codex.ai/code) 提供在操作此代码仓库时的指导。

## 项目概述

CloudCLI UI (claudecodeui) 是一个面向 AI 编程助手（Codex、Cursor CLI、Codex、Gemini CLI）的 Web 界面。它提供了功能完整的界面，包括聊天、文件浏览器、Git 集成、Shell 终端和会话管理。

**技术栈：** React 18 + Vite + Tailwind CSS + Express + node-pty + SQLite

## 开发命令

```bash
# 安装依赖（需要 Node.js 22+）
npm install

# 开发模式 - 同时运行前端（Vite）和后端（Express）
npm run dev

# 单独启动服务
npm run client    # 仅启动 Vite 开发服务器（端口 25373）
npm run server    # 仅启动 Express 后端（端口 23003）

# 生产构建
npm run build     # 通过 Vite 创建 dist/ 目录

# 代码检查
npm run lint      # ESLint，包含 TypeScript、React 和 Tailwind 规则
npm run lint:fix  # 自动修复代码检查问题
npm run typecheck # 仅进行 TypeScript 类型检查

# 生产环境启动
npm start         # 构建后启动服务
npm run preview   # 预览生产构建
```

## 项目架构

### 前端（`src/`）
- **Vite** 开发服务器将 `/api` 和 WebSocket 路径代理到 Express 后端
- **入口：** `main.jsx` → `App.tsx`
- **组件：** 按功能组织在 `components/` 目录（chat、file-tree、git-panel、shell、settings 等）
- **状态：** `contexts/` 中的 React Context 提供者，用于认证、项目、会话、主题
- **Hooks：** `hooks/` 中的自定义 hook，用于 API 调用、WebSocket、文件操作
- **类型：** `types/` 中的 TypeScript 定义
- **国际化：** `i18n/` 中的翻译文件（英文、俄文、韩文、中文、日文）

### 后端（`server/`）
- **入口：** `index.js` - Express + WebSocketServer + node-pty 终端
- **路由：** `routes/` - API 端点，用于 git、auth、MCP、cursor、codex、gemini、projects、settings、taskmaster
- **CLI 集成：** `Codex-sdk.js`、`cursor-cli.js`、`openai-codex.js`、`gemini-cli.js` - 生成和管理 AI CLI 进程
- **数据库：** `database/db.js` - SQLite，用于会话名称、认证令牌、用户设置
- **文件监听：** 自动发现 `~/.Codex`、`~/.cursor/chats`、`~/.codex/sessions`、`~/.gemini` 中的会话

### 共享（`shared/`）
- `modelConstants.js` - 所有提供商的集中式模型定义（Codex、Cursor、Codex、Gemini）

### 插件（`plugins/`）
- 动态插件系统，允许自定义标签页，带有前端 UI 和可选的 Node.js 后端
- 从 git 仓库加载插件，通过设置 > 插件安装

## 关键配置文件

| 文件 | 用途 |
|------|---------|
| `vite.config.js` | Vite 开发服务器、代理规则、构建代码块 |
| `tailwind.config.js` | Tailwind，使用自定义 CSS 变量进行主题设置 |
| `eslint.config.js` | ESLint，包含 TypeScript、React hooks、导入排序、Tailwind |
| `tsconfig.json` | TypeScript 配置（ES2020、React JSX、bundler 解析） |
| `.env.example` | 环境变量模板（PORT、HOST、DATABASE_PATH） |

## 环境变量

- `PORT` - 后端服务端口（默认：23003）
- `VITE_PORT` - 前端开发服务器端口（默认：25373）
- `HOST` - 绑定地址（默认：0.0.0.0）
- `DATABASE_PATH` - 自定义 SQLite 数据库位置
- `CONTEXT_WINDOW` / `VITE_CONTEXT_WINDOW` - 每个会话的最大令牌数（默认：160000）

## 代码模式

### API 路由
路由位于 `server/routes/`，在 `server/index.js` 中挂载。使用 Express router 模式和异步处理器。

### WebSocket 事件
后端通过 `broadcastProgress()`、`broadcastSessionUpdate()` 等向连接的客户端广播事件。前端通过 `useWebSocket` hook 接收。

### 数据库
通过 `better-sqlite3` 使用 SQLite。通过 `server/database/` 中的数据库模块访问。在 `server/index.js` 中初始化。

### 组件结构
组件使用 Tailwind 和 CSS 变量进行主题设置（通过 `dark:` 类实现深色/浅色模式）。图标来自 `lucide-react`。

### 提交规范
遵循 [Conventional Commits](https://conventionalcommits.org/)：
- `feat:` - 新功能
- `fix:` - Bug 修复
- `refactor:` - 代码变更，不涉及功能或修复
- `docs:` - 文档
- `style:` - CSS/格式化
- `chore:` - 维护/依赖

## 重要说明

- **node-pty：** 需要编译的原生模块。Postinstall 脚本运行 `scripts/fix-node-pty.js`
- **Lint-staged：** 通过 husky 在暂存文件上自动运行 ESLint
- **发布：** 使用 `release-it` 和 conventional changelog。运行 `npm run release`
