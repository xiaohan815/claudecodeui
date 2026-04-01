# 持久化 PTY 功能故障排查

## 问题：主页面看不到"持久化终端模式"

### 步骤 1：确认文件已更新

```bash
# 检查 index.js 是否包含 PTY 代码
grep "持久化终端" examples/feishu-channel/index.js

# 应该看到：
# <div class="fsc-pty-check-name">持久化终端模式（Persistent PTY）</div>
```

### 步骤 2：完全重启服务器

```bash
# 1. 停止当前服务器
# 按 Ctrl+C

# 2. 确认进程已停止
ps aux | grep "node.*server"
# 如果还有进程在运行，手动 kill

# 3. 重新启动
npm start

# 或者使用开发模式（推荐）
npm run dev
```

### 步骤 3：清除浏览器缓存

**方法 1：硬刷新**
- Mac: `Cmd + Shift + R`
- Windows/Linux: `Ctrl + Shift + R`

**方法 2：清除缓存并硬刷新**
1. 打开浏览器开发者工具（F12）
2. 右键点击刷新按钮
3. 选择"清空缓存并硬性重新加载"

**方法 3：无痕模式**
- 打开无痕/隐私浏览窗口
- 访问 http://localhost:23003
- 重新登录并查看

### 步骤 4：检查 Provider 选择

PTY 设置只在选择 **Claude Code** provider 时显示。

1. 进入 Feishu Channel 标签页
2. 在"AI 助手"区块，确认选择的是 **Claude Code**（不是 Cursor/Codex/Gemini）
3. 向下滚动，应该能看到紫色的"高级设置"卡片

### 步骤 5：检查浏览器控制台

1. 按 F12 打开开发者工具
2. 切换到 Console 标签
3. 查看是否有 JavaScript 错误
4. 特别注意是否有 `[Plugin:feishu-channel]` 相关的错误

### 步骤 6：手动测试 API

```bash
# 测试插件文件是否可访问
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:23003/api/plugins/feishu-channel/assets/index.js \
  | grep "持久化终端"

# 应该能看到相关代码
```

### 步骤 7：检查文件时间戳

```bash
# 查看文件最后修改时间
ls -l examples/feishu-channel/index.js

# 应该显示最近的时间（今天）
```

### 步骤 8：强制重新加载插件

在浏览器中：

1. 打开开发者工具（F12）
2. 切换到 Network 标签
3. 勾选"Disable cache"
4. 刷新页面
5. 查找 `index.js` 请求
6. 检查响应内容是否包含"持久化终端"

### 步骤 9：检查服务器日志

启动服务器时，查看控制台输出：

```
[INFO] App Installation: /path/to/claudecodeui
[INFO] Database: server/database/auth.db
...
Database migrations completed successfully
```

应该看到数据库迁移成功的消息。

### 步骤 10：直接访问文件

在浏览器中访问：
```
http://localhost:23003/api/plugins/feishu-channel/assets/index.js
```

查看返回的 JavaScript 代码，搜索"持久化终端"，应该能找到。

## 常见问题

### Q1: 我选择了 Claude 但还是看不到

**A**: 检查是否有 JavaScript 错误阻止了渲染。打开控制台查看。

### Q2: 我清除了缓存还是看不到

**A**: 尝试无痕模式，或者换一个浏览器测试。

### Q3: API 返回的文件没有 PTY 代码

**A**: 服务器可能缓存了旧文件。尝试：
```bash
# 停止服务器
# 删除可能的缓存
rm -rf node_modules/.cache
# 重启
npm start
```

### Q4: 我用的是生产模式（npm start）

**A**: 生产模式不会影响 `examples/` 目录下的文件。这些文件是直接从磁盘读取的，不经过 Vite 构建。

## 最终解决方案

如果以上都不行，尝试完全重置：

```bash
# 1. 停止服务器
# Ctrl+C

# 2. 清理所有缓存
rm -rf node_modules/.cache
rm -rf dist/
rm -rf .vite/

# 3. 重新安装依赖（可选）
# npm install

# 4. 重新构建
npm run build

# 5. 启动
npm start

# 6. 在浏览器中
# - 清除所有缓存
# - 关闭所有标签页
# - 重新打开 http://localhost:23003
```

## 验证成功

当你看到以下内容时，说明功能已正常工作：

```
┌─ 高级设置 ──────────────────────────────────────────┐
│  Claude 性能优化选项                                 │
│                                                      │
│  ☐ 持久化终端模式（Persistent PTY）                 │
│     为每个对话维持一个后台 Claude 进程，减少每轮     │
│     对话的启动开销。对话历史常驻内存，无需每次从     │
│     磁盘重载。                                       │
│                                                      │
│     [当勾选后会显示]                                 │
│     空闲超时（分钟）[30]                             │
│     后台进程在无活动后自动销毁                       │
└──────────────────────────────────────────────────────┘
```

## 需要帮助？

如果以上步骤都无法解决问题，请提供：

1. 浏览器控制台的完整错误信息
2. 服务器启动时的完整日志
3. `curl` 测试 API 的返回结果
4. 浏览器 Network 标签中 `index.js` 请求的详细信息
