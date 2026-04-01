# 插件部署指南

## 插件文件位置

claudecodeui 使用插件系统，插件文件存在于两个不同的位置：

### 1. 开发源码位置

```
claudecodeui/examples/
├── feishu-channel/
│   ├── index.js          ← 开发和修改这里的文件
│   ├── server.js
│   ├── manifest.json
│   ├── icon.svg
│   └── ...
└── imessage-channel/
    └── ...
```

**用途**：
- 开发和测试插件代码
- 纳入 Git 版本控制
- 作为插件的"源代码"

**特点**：
- 修改这里的文件不会立即生效
- 需要同步到实际运行位置

### 2. 实际运行位置

```
~/.claude-code-ui/plugins/
├── feishu-channel/
│   ├── index.js          ← 服务器实际读取的文件
│   ├── server.js
│   ├── manifest.json
│   ├── icon.svg
│   └── ...
└── imessage-channel/
    └── ...
```

**用途**：
- 服务器从这里加载插件
- 通过 `/api/plugins/:name/assets/*` API 提供给浏览器
- 用户安装插件后的实际位置

**特点**：
- 修改这里的文件会立即生效（刷新浏览器后）
- 不纳入 Git 版本控制
- 每个用户/系统独立

## 为什么有两个位置？

这是一个标准的"开发 vs 生产"分离模式：

1. **开发源码**（`examples/`）：
   - 开发者在这里编写和测试代码
   - 可以使用 Git 进行版本控制
   - 可以分享给其他开发者

2. **实际运行**（`~/.claude-code-ui/plugins/`）：
   - 用户安装插件后的位置
   - 服务器从这里加载
   - 类似于 npm 的 `node_modules/`

## 部署流程

### 场景 1：开发时修改插件

当你修改了 `examples/feishu-channel/index.js` 后：

```bash
# 1. 同步到实际运行位置
cp examples/feishu-channel/index.js ~/.claude-code-ui/plugins/feishu-channel/index.js

# 2. 验证文件已更新
ls -l ~/.claude-code-ui/plugins/feishu-channel/index.js

# 3. 在浏览器中硬刷新
# Mac: Cmd + Shift + R
# Windows/Linux: Ctrl + Shift + R
```

### 场景 2：修改多个文件

```bash
# 同步整个插件目录
cp -r examples/feishu-channel/* ~/.claude-code-ui/plugins/feishu-channel/

# 注意：这会覆盖所有文件，包括用户配置
```

### 场景 3：重新安装插件

如果你想完全重新安装插件：

```bash
# 1. 在 UI 中卸载插件
# Settings → Channels → 选择 feishu-channel → Uninstall

# 2. 重新安装（从本地路径）
# Settings → Channels → Install Channel
# 输入：/path/to/claudecodeui/examples/feishu-channel

# 或者使用相对路径
# 输入：./examples/feishu-channel
```

### 场景 4：从 Git 安装的插件

如果插件是从 Git 仓库安装的：

```bash
# 在 UI 中点击"更新"按钮
# Settings → Channels → 选择插件 → Update

# 这会从 Git 拉取最新代码并重新安装
```

## 自动化部署脚本

创建一个部署脚本来简化流程：

```bash
#!/bin/bash
# deploy-plugin.sh

PLUGIN_NAME="feishu-channel"
SOURCE_DIR="examples/$PLUGIN_NAME"
TARGET_DIR="$HOME/.claude-code-ui/plugins/$PLUGIN_NAME"

echo "Deploying $PLUGIN_NAME..."

# 检查源目录是否存在
if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: Source directory not found: $SOURCE_DIR"
  exit 1
fi

# 创建目标目录（如果不存在）
mkdir -p "$TARGET_DIR"

# 复制文件
cp -r "$SOURCE_DIR"/* "$TARGET_DIR/"

echo "✓ Deployed successfully!"
echo "  Source: $SOURCE_DIR"
echo "  Target: $TARGET_DIR"
echo ""
echo "Next steps:"
echo "  1. Refresh your browser (Cmd+Shift+R or Ctrl+Shift+R)"
echo "  2. Check the plugin in the UI"
```

使用方法：

```bash
# 给脚本添加执行权限
chmod +x deploy-plugin.sh

# 运行脚本
./deploy-plugin.sh
```

## 验证部署

### 1. 检查文件是否存在

```bash
ls -la ~/.claude-code-ui/plugins/feishu-channel/
```

### 2. 检查文件内容

```bash
# 检查是否包含特定代码
grep "持久化终端" ~/.claude-code-ui/plugins/feishu-channel/index.js

# 查看文件修改时间
stat ~/.claude-code-ui/plugins/feishu-channel/index.js
```

### 3. 检查服务器日志

启动服务器时，查看是否有插件加载的日志：

```
[Plugins] Scanning plugins directory: /Users/xxx/.claude-code-ui/plugins
[Plugins] Found plugin: feishu-channel
```

### 4. 测试 API

```bash
# 获取插件列表
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:23003/api/plugins

# 获取插件文件
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:23003/api/plugins/feishu-channel/assets/index.js \
  | grep "持久化终端"
```

### 5. 浏览器测试

1. 打开开发者工具（F12）
2. 切换到 Network 标签
3. 勾选"Disable cache"
4. 刷新页面
5. 查找 `index.js` 请求
6. 检查响应内容是否包含最新代码

## 常见问题

### Q1: 修改了代码但浏览器看不到变化

**原因**：浏览器缓存了旧版本的 `index.js`

**解决**：
```bash
# 1. 确认文件已同步
grep "你的新代码" ~/.claude-code-ui/plugins/feishu-channel/index.js

# 2. 硬刷新浏览器
# Mac: Cmd + Shift + R
# Windows/Linux: Ctrl + Shift + R

# 3. 或者使用无痕模式
```

### Q2: 同步后服务器报错

**原因**：文件权限问题或语法错误

**解决**：
```bash
# 检查文件权限
ls -l ~/.claude-code-ui/plugins/feishu-channel/index.js

# 检查语法错误
node --check ~/.claude-code-ui/plugins/feishu-channel/index.js
```

### Q3: 插件目录不存在

**原因**：插件未安装

**解决**：
```bash
# 创建目录
mkdir -p ~/.claude-code-ui/plugins/feishu-channel

# 复制所有文件
cp -r examples/feishu-channel/* ~/.claude-code-ui/plugins/feishu-channel/

# 或者在 UI 中安装插件
```

### Q4: 修改了 manifest.json 但不生效

**原因**：manifest.json 在插件加载时读取，需要重启服务器

**解决**：
```bash
# 1. 同步文件
cp examples/feishu-channel/manifest.json ~/.claude-code-ui/plugins/feishu-channel/

# 2. 重启服务器
# Ctrl+C 停止
npm start
```

### Q5: 多个开发者协作时的同步问题

**建议**：
1. 将 `examples/` 目录纳入 Git 版本控制
2. 每个开发者在本地部署到自己的 `~/.claude-code-ui/plugins/`
3. 使用部署脚本自动化同步过程

## 生产环境部署

### 方法 1：从 Git 安装

```bash
# 1. 将插件推送到 Git 仓库
git add examples/feishu-channel/
git commit -m "Update feishu-channel plugin"
git push

# 2. 在生产环境的 UI 中安装
# Settings → Channels → Install Channel
# 输入 Git URL: https://github.com/your-repo/claudecodeui
```

### 方法 2：手动部署

```bash
# 在生产服务器上
cd /path/to/claudecodeui
cp -r examples/feishu-channel/* ~/.claude-code-ui/plugins/feishu-channel/

# 重启服务
pm2 restart claudecodeui
# 或
systemctl restart claudecodeui
```

### 方法 3：使用 CI/CD

```yaml
# .github/workflows/deploy-plugin.yml
name: Deploy Plugin

on:
  push:
    paths:
      - 'examples/feishu-channel/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Deploy to production
        run: |
          scp -r examples/feishu-channel/* \
            user@server:~/.claude-code-ui/plugins/feishu-channel/
          
          ssh user@server 'pm2 restart claudecodeui'
```

## 最佳实践

1. **开发时**：
   - 在 `examples/` 目录修改代码
   - 使用部署脚本同步到 `~/.claude-code-ui/plugins/`
   - 提交代码到 Git

2. **测试时**：
   - 使用无痕模式避免缓存问题
   - 检查浏览器控制台的错误信息
   - 验证 API 返回的文件内容

3. **生产环境**：
   - 使用 Git 安装插件（便于更新）
   - 或者使用自动化部署脚本
   - 监控服务器日志

4. **版本控制**：
   - 只将 `examples/` 纳入 Git
   - 不要提交 `~/.claude-code-ui/` 目录
   - 使用 `.gitignore` 排除用户数据

## 相关文件

- `server/utils/plugin-loader.js` - 插件加载器实现
- `server/routes/plugins.js` - 插件 API 路由
- `src/components/plugins/view/PluginTabContent.tsx` - 插件 UI 加载器
