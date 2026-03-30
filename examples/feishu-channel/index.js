const styles = `
  .feishu-channel-root {
    min-height: 100%;
    padding: 28px;
    color: #e5eefc;
    background:
      radial-gradient(circle at top left, rgba(59, 130, 246, 0.22), transparent 30%),
      radial-gradient(circle at bottom right, rgba(168, 85, 247, 0.16), transparent 28%),
      linear-gradient(160deg, #07111f 0%, #111d35 58%, #0a1325 100%);
    font-family: "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif;
  }

  .feishu-channel-shell {
    max-width: 880px;
    margin: 0 auto;
    display: grid;
    gap: 20px;
  }

  .feishu-channel-hero,
  .feishu-channel-grid > div {
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 20px;
    background: rgba(15, 23, 42, 0.74);
    backdrop-filter: blur(16px);
    box-shadow: 0 20px 70px rgba(2, 6, 23, 0.35);
  }

  .feishu-channel-hero {
    padding: 28px;
    display: grid;
    gap: 14px;
  }

  .feishu-channel-kicker {
    width: fit-content;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(96, 165, 250, 0.14);
    color: #93c5fd;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 12px;
    font-weight: 600;
  }

  .feishu-channel-title {
    margin: 0;
    font-size: 32px;
    line-height: 1.08;
    font-weight: 700;
  }

  .feishu-channel-copy {
    margin: 0;
    max-width: 680px;
    color: rgba(226, 232, 240, 0.8);
    font-size: 15px;
    line-height: 1.7;
  }

  .feishu-channel-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .feishu-channel-badge {
    padding: 8px 12px;
    border-radius: 12px;
    background: rgba(15, 118, 110, 0.2);
    color: #99f6e4;
    font-size: 13px;
  }

  .feishu-channel-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }

  .feishu-channel-grid > div {
    padding: 20px;
    display: grid;
    gap: 10px;
  }

  .feishu-channel-grid h3 {
    margin: 0;
    font-size: 16px;
    color: #f8fafc;
  }

  .feishu-channel-grid p {
    margin: 0;
    font-size: 14px;
    color: rgba(226, 232, 240, 0.72);
    line-height: 1.65;
  }
`;

export function mount(container) {
  const root = document.createElement("div");
  root.className = "feishu-channel-root";
  root.innerHTML = `
    <style>${styles}</style>
    <div class="feishu-channel-shell">
      <section class="feishu-channel-hero">
        <div class="feishu-channel-kicker">Feishu / Lark Channel</div>
        <h1 class="feishu-channel-title">把飞书机器人直接接进 claudecodeui</h1>
        <p class="feishu-channel-copy">
          这个 channel 通过飞书长连接模式接收消息，并把文本与图片消息转发给当前 channel 绑定的 AI provider。
          运行参数请到 Settings → Channels 中配置。
        </p>
        <div class="feishu-channel-badges">
          <span class="feishu-channel-badge">长连接事件订阅</span>
          <span class="feishu-channel-badge">文本消息</span>
          <span class="feishu-channel-badge">图片消息</span>
          <span class="feishu-channel-badge">按 channel 隔离配置</span>
        </div>
      </section>
      <section class="feishu-channel-grid">
        <div>
          <h3>配置入口</h3>
          <p>填写 App ID、App Secret、域名、机器人名称和允许的会话类型。</p>
        </div>
        <div>
          <h3>消息接入</h3>
          <p>支持私聊文本与图片；若启用群聊，则按被 @ 的消息进入 AI 会话。</p>
        </div>
        <div>
          <h3>会话隔离</h3>
          <p>工作目录、模型、provider 与飞书平台参数都按 channel 名称独立保存。</p>
        </div>
      </section>
    </div>
  `;
  container.replaceChildren(root);
}

export function unmount(container) {
  container.replaceChildren();
}
