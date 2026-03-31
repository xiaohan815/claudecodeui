/**
 * Feishu / Lark Channel — Browser-side control panel
 * Pure ES Module, no external dependencies.
 * Loaded by PluginTabContent via Blob URL in the browser.
 */

const CHANNEL_NAME = "feishu-channel";

const PROVIDERS = [
  { id: "claude", label: "Claude Code", sub: "by Anthropic", icon: "✦" },
  { id: "cursor", label: "Cursor", sub: "AI 代码编辑器", icon: "◈" },
  { id: "codex", label: "Codex", sub: "by OpenAI", icon: "⬡" },
  { id: "gemini", label: "Gemini", sub: "by Google", icon: "✦" },
];

// Fallback models if API fails
const FALLBACK_MODELS = {
  claude: [
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
    { value: "opusplan", label: "Opus Plan" },
    { value: "sonnet[1m]", label: "Sonnet [1M]" },
  ],
  cursor: [
    { value: "auto", label: "Auto" },
    { value: "sonnet-4.5", label: "Claude 4.5 Sonnet" },
    { value: "gpt-5.2-high", label: "GPT-5.2 High" },
    { value: "gemini-3-pro", label: "Gemini 3 Pro" },
  ],
  codex: [
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "o3", label: "O3" },
    { value: "o4-mini", label: "O4-mini" },
  ],
  gemini: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
};

const FALLBACK_DEFAULTS = {
  claude: "sonnet",
  cursor: "auto",
  codex: "gpt-5.4",
  gemini: "gemini-2.5-flash",
};

// ─── Auth helper ─────────────────────────────────────────────────────────────
function apiFetch(url, options = {}) {
  const token = localStorage.getItem("auth-token");
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
function buildStyles(isDark) {
  const surface = isDark ? "#1a1a1c" : "#ffffff";
  const border = isDark ? "#2e2e32" : "#e4e4e7";
  const text = isDark ? "#e8e8ea" : "#18181b";
  const muted = isDark ? "#71717a" : "#71717a";
  const accent = "#3b82f6";
  const accentBg = isDark ? "#1e3a5f" : "#eff6ff";
  const danger = isDark ? "#7f1d1d" : "#fee2e2";
  const dangerTxt = isDark ? "#fca5a5" : "#dc2626";
  const success = "#22c55e";
  const inputBg = isDark ? "#27272a" : "#f4f4f5";
  const skyBg = isDark ? "rgba(14,165,233,0.08)" : "rgba(14,165,233,0.05)";
  const skyBorder = isDark ? "rgba(14,165,233,0.25)" : "rgba(14,165,233,0.2)";

  return `
    .fsc-wrap { display:flex; flex-direction:column; gap:20px; padding:24px; max-width:700px; margin:0 auto; font-family:system-ui,-apple-system,sans-serif; color:${text}; }
    .fsc-card { background:${surface}; border:1px solid ${border}; border-radius:12px; padding:20px; }

    /* Status bar */
    .fsc-status { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }
    .fsc-status-left { display:flex; align-items:center; gap:10px; }
    .fsc-status-dot { width:8px; height:8px; border-radius:50%; background:${muted}; flex-shrink:0; }
    .fsc-status-dot.running { background:${success}; box-shadow:0 0 6px ${success}66; }
    .fsc-status-dot.error   { background:${dangerTxt}; }
    .fsc-status-name { font-size:15px; font-weight:600; }
    .fsc-status-badge { font-size:11px; color:${muted}; background:${inputBg}; padding:2px 8px; border-radius:99px; }
    .fsc-status-actions { display:flex; gap:8px; }

    /* Section label */
    .fsc-label { font-size:12px; font-weight:500; color:${muted}; text-transform:uppercase; letter-spacing:.05em; margin-bottom:10px; }

    /* Provider cards */
    .fsc-providers { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
    .fsc-provider-card { display:flex; flex-direction:column; align-items:center; gap:6px; padding:12px 8px; border:1.5px solid ${border}; border-radius:10px; cursor:pointer; transition:border-color .15s,background .15s; background:${isDark ? "#202024" : "#fafafa"}; }
    .fsc-provider-card:hover { border-color:${accent}66; background:${accentBg}; }
    .fsc-provider-card.active { border-color:${accent}; background:${accentBg}; }
    .fsc-provider-icon { font-size:22px; line-height:1; }
    .fsc-provider-name { font-size:12px; font-weight:600; text-align:center; }
    .fsc-provider-sub  { font-size:10px; color:${muted}; text-align:center; line-height:1.2; }

    /* Model row */
    .fsc-row { display:flex; align-items:center; gap:12px; margin-top:14px; }
    .fsc-row-label { font-size:13px; color:${muted}; white-space:nowrap; min-width:36px; }
    select.fsc-select { flex:1; background:${inputBg}; border:1px solid ${border}; border-radius:7px; padding:7px 10px; font-size:13px; color:${text}; outline:none; cursor:pointer; }
    select.fsc-select:focus { border-color:${accent}; }

    /* Directory section */
    .fsc-dir-wrap { display:flex; flex-direction:column; gap:8px; }
    .fsc-dir-hint { font-size:11px; color:${muted}; margin-top:2px; }
    .fsc-input { width:100%; background:${inputBg}; border:1px solid ${border}; border-radius:7px; padding:8px 10px; font-size:13px; color:${text}; outline:none; box-sizing:border-box; }
    .fsc-input:focus { border-color:${accent}; }
    .fsc-input-mono { font-family:monospace; }
    .fsc-dir-tabs { display:flex; gap:0; border:1px solid ${border}; border-radius:7px; overflow:hidden; margin-bottom:4px; width:fit-content; }
    .fsc-dir-tab { padding:5px 14px; font-size:12px; cursor:pointer; background:transparent; border:none; color:${muted}; transition:background .12s,color .12s; }
    .fsc-dir-tab.active { background:${accent}; color:#fff; }

    /* Feishu settings card */
    .fsc-feishu-card { background:${skyBg}; border:1px solid ${skyBorder}; border-radius:12px; padding:20px; }
    .fsc-feishu-title { font-size:14px; font-weight:600; color:${text}; }
    .fsc-feishu-subtitle { font-size:12px; color:${muted}; margin-top:3px; }
    .fsc-secret-badge { display:inline-block; font-size:11px; padding:2px 8px; border-radius:99px; background:${inputBg}; color:${muted}; margin-top:6px; border:1px solid ${border}; }
    .fsc-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:16px; }
    .fsc-grid-full { grid-column:1 / -1; }
    .fsc-field-label { font-size:12px; font-weight:500; color:${muted}; margin-bottom:5px; }
    .fsc-chat-types { display:flex; gap:10px; margin-top:4px; flex-wrap:wrap; }
    .fsc-chat-type-label { display:flex; align-items:center; gap:6px; font-size:13px; color:${text}; background:${inputBg}; border:1px solid ${border}; border-radius:99px; padding:5px 12px; cursor:pointer; user-select:none; transition:border-color .15s; }
    .fsc-chat-type-label:hover { border-color:${accent}66; }
    .fsc-chat-type-label input[type=checkbox] { accent-color:${accent}; width:14px; height:14px; cursor:pointer; }

    /* Save button */
    .fsc-actions { display:flex; justify-content:flex-end; gap:8px; }
    .fsc-btn { padding:8px 18px; border-radius:7px; font-size:13px; font-weight:500; border:none; cursor:pointer; transition:opacity .15s; }
    .fsc-btn:disabled { opacity:.45; cursor:default; }
    .fsc-btn-primary { background:${accent}; color:#fff; }
    .fsc-btn-primary:not(:disabled):hover { opacity:.85; }
    .fsc-btn-ghost { background:${inputBg}; color:${text}; border:1px solid ${border}; }
    .fsc-btn-ghost:not(:disabled):hover { border-color:${accent}; color:${accent}; }
    .fsc-btn-danger { background:${danger}; color:${dangerTxt}; border:1px solid ${dangerTxt}44; }
    .fsc-btn-danger:not(:disabled):hover { opacity:.8; }

    /* Toast */
    .fsc-toast { position:fixed; bottom:24px; right:24px; padding:10px 18px; border-radius:8px; font-size:13px; font-weight:500; background:${surface}; border:1px solid ${border}; box-shadow:0 4px 16px #0006; z-index:9999; animation:fsc-fadein .2s ease; }
    .fsc-toast.ok  { border-color:${success}; color:${success}; }
    .fsc-toast.err { border-color:${dangerTxt}; color:${dangerTxt}; }
    @keyframes fsc-fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  `;
}

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  status: "loading",
  provider: "claude",
  model: "sonnet",
  cwd: "",
  dirMode: "project",
  _cwdFromConfig: false,
  projects: [],
  saving: false,
  // Feishu-specific
  appId: "",
  appSecretInput: "",
  hasAppSecret: false,
  domain: "feishu",
  botName: "",
  allowedChatTypes: ["p2p"],
  // Loaded from API
  models: null,
  modelDefaults: null,
};

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = `fsc-toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function escAttr(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Render ──────────────────────────────────────────────────────────────────
function render(container, isDark) {
  const s = state;

  const statusLabel =
    s.status === "running"
      ? "running"
      : s.status === "stopped"
        ? "stopped"
        : s.status === "error"
          ? "error"
          : "…";

  const modelsForProvider =
    (s.models && s.models[s.provider]) || FALLBACK_MODELS[s.provider] || [];

  const modelOptions = modelsForProvider
    .map(
      (m) =>
        `<option value="${escAttr(m.value)}" ${m.value === s.model ? "selected" : ""}>${escAttr(m.label)}</option>`,
    )
    .join("");

  const providerCards = PROVIDERS.map(
    (p) => `
    <div class="fsc-provider-card ${s.provider === p.id ? "active" : ""}" data-provider="${p.id}">
      <span class="fsc-provider-icon">${p.icon}</span>
      <span class="fsc-provider-name">${p.label}</span>
      <span class="fsc-provider-sub">${p.sub}</span>
    </div>
  `,
  ).join("");

  const projectOptions = s.projects
    .map((p) => {
      const val = p.fullPath || p.path;
      return `<option value="${escAttr(val)}" ${val === s.cwd ? "selected" : ""}>${escAttr(p.displayName)}  (${escAttr(val)})</option>`;
    })
    .join("");

  const dirSection =
    s.dirMode === "project"
      ? `<select class="fsc-select fsc-cwd-select">
         <option value="">— 选择项目 —</option>
         ${projectOptions}
       </select>`
      : `<input class="fsc-input fsc-input-mono fsc-cwd-input" type="text" placeholder="/Users/..." value="${escAttr(s.cwd)}" />`;

  const p2pChecked = s.allowedChatTypes.includes("p2p");
  const groupChecked = s.allowedChatTypes.includes("group");

  container.innerHTML = `
    <div class="fsc-wrap">

      <!-- Status card -->
      <div class="fsc-card">
        <div class="fsc-status">
          <div class="fsc-status-left">
            <div class="fsc-status-dot ${s.status}"></div>
            <span class="fsc-status-name">Feishu Channel</span>
            <span class="fsc-status-badge">${statusLabel}</span>
          </div>
          <div class="fsc-status-actions">
            ${
              s.status === "running"
                ? `<button class="fsc-btn fsc-btn-ghost fsc-btn-restart">重启</button>
                 <button class="fsc-btn fsc-btn-danger fsc-btn-stop">停止</button>`
                : `<button class="fsc-btn fsc-btn-primary fsc-btn-start">启动</button>`
            }
          </div>
        </div>
      </div>

      <!-- Provider + Model card -->
      <div class="fsc-card">
        <div class="fsc-label">AI 助手</div>
        <div class="fsc-providers">${providerCards}</div>
        <div class="fsc-row">
          <span class="fsc-row-label">模型</span>
          <select class="fsc-select fsc-model-select">${modelOptions}</select>
        </div>
      </div>

      <!-- Working directory card -->
      <div class="fsc-card">
        <div class="fsc-label">工作目录</div>
        <div class="fsc-dir-wrap">
          <div class="fsc-dir-tabs">
            <button class="fsc-dir-tab ${s.dirMode === "project" ? "active" : ""}" data-mode="project">从项目选择</button>
            <button class="fsc-dir-tab ${s.dirMode === "manual" ? "active" : ""}" data-mode="manual">手动输入</button>
          </div>
          ${dirSection}
          <div class="fsc-dir-hint">Claude 将在此目录下执行文件操作</div>
        </div>
      </div>

      <!-- Feishu / Lark settings -->
      <div class="fsc-feishu-card">
        <div class="fsc-feishu-title">飞书 / Lark 配置</div>
        <div class="fsc-feishu-subtitle">填写飞书开放平台的应用凭据，用于长连接模式接收消息。</div>
        <span class="fsc-secret-badge">${s.hasAppSecret ? "✓ App Secret 已保存" : "⚠ App Secret 未设置"}</span>

        <div class="fsc-grid">
          <div>
            <div class="fsc-field-label">App ID</div>
            <input class="fsc-input fsc-appid-input" type="text"
              placeholder="cli_xxx"
              value="${escAttr(s.appId)}"
              autocomplete="off" />
          </div>
          <div>
            <div class="fsc-field-label">App Secret</div>
            <input class="fsc-input fsc-appsecret-input" type="password"
              placeholder="${s.hasAppSecret ? "留空则保留现有 Secret" : "输入 App Secret"}"
              value="${escAttr(s.appSecretInput)}"
              autocomplete="new-password" />
          </div>
          <div>
            <div class="fsc-field-label">域名</div>
            <select class="fsc-select fsc-domain-select" style="flex:none;width:100%">
              <option value="feishu" ${s.domain === "feishu" ? "selected" : ""}>Feishu（中国大陆）</option>
              <option value="lark"   ${s.domain === "lark" ? "selected" : ""}>Lark（国际版）</option>
            </select>
          </div>
          <div>
            <div class="fsc-field-label">机器人名称（可选）</div>
            <input class="fsc-input fsc-botname-input" type="text"
              placeholder="用于群聊 @ 识别"
              value="${escAttr(s.botName)}" />
          </div>
          <div class="fsc-grid-full">
            <div class="fsc-field-label">允许的会话类型</div>
            <div class="fsc-chat-types">
              <label class="fsc-chat-type-label">
                <input type="checkbox" class="fsc-chat-p2p" ${p2pChecked ? "checked" : ""} />
                私聊
              </label>
              <label class="fsc-chat-type-label">
                <input type="checkbox" class="fsc-chat-group" ${groupChecked ? "checked" : ""} />
                群聊（被 @ 时响应）
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Save -->
      <div class="fsc-actions">
        <button class="fsc-btn fsc-btn-primary fsc-btn-save" ${s.saving ? "disabled" : ""}>
          ${s.saving ? "保存中…" : "保存配置"}
        </button>
      </div>

    </div>
  `;

  attachEvents(container, isDark);
}

// ─── Events ──────────────────────────────────────────────────────────────────
function attachEvents(container, isDark) {
  // Provider cards
  container.querySelectorAll(".fsc-provider-card").forEach((card) => {
    card.addEventListener("click", () => {
      const p = card.dataset.provider;
      state.provider = p;
      state.model =
        (state.modelDefaults && state.modelDefaults[p]) ||
        FALLBACK_DEFAULTS[p] ||
        "";
      render(container, isDark);
    });
  });

  // Model selector
  const modelSel = container.querySelector(".fsc-model-select");
  if (modelSel)
    modelSel.addEventListener("change", (e) => {
      state.model = e.target.value;
    });

  // Dir mode tabs
  container.querySelectorAll(".fsc-dir-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dirMode = btn.dataset.mode;
      render(container, isDark);
    });
  });

  // Dir project select
  const cwdSel = container.querySelector(".fsc-cwd-select");
  if (cwdSel)
    cwdSel.addEventListener("change", (e) => {
      state.cwd = e.target.value;
    });

  // Dir manual input
  const cwdInput = container.querySelector(".fsc-cwd-input");
  if (cwdInput)
    cwdInput.addEventListener("input", (e) => {
      state.cwd = e.target.value;
    });

  // Feishu fields
  const appIdEl = container.querySelector(".fsc-appid-input");
  if (appIdEl)
    appIdEl.addEventListener("input", (e) => {
      state.appId = e.target.value;
    });

  const appSecretEl = container.querySelector(".fsc-appsecret-input");
  if (appSecretEl)
    appSecretEl.addEventListener("input", (e) => {
      state.appSecretInput = e.target.value;
    });

  const domainEl = container.querySelector(".fsc-domain-select");
  if (domainEl)
    domainEl.addEventListener("change", (e) => {
      state.domain = e.target.value;
    });

  const botNameEl = container.querySelector(".fsc-botname-input");
  if (botNameEl)
    botNameEl.addEventListener("input", (e) => {
      state.botName = e.target.value;
    });

  const p2pEl = container.querySelector(".fsc-chat-p2p");
  if (p2pEl) p2pEl.addEventListener("change", () => toggleChatType("p2p"));

  const groupEl = container.querySelector(".fsc-chat-group");
  if (groupEl)
    groupEl.addEventListener("change", () => toggleChatType("group"));

  // Action buttons
  const saveBtn = container.querySelector(".fsc-btn-save");
  if (saveBtn)
    saveBtn.addEventListener("click", () => saveConfig(container, isDark));

  const startBtn = container.querySelector(".fsc-btn-start");
  if (startBtn)
    startBtn.addEventListener("click", () =>
      channelAction("enable", container, isDark),
    );

  const stopBtn = container.querySelector(".fsc-btn-stop");
  if (stopBtn)
    stopBtn.addEventListener("click", () =>
      channelAction("disable", container, isDark),
    );

  const restartBtn = container.querySelector(".fsc-btn-restart");
  if (restartBtn)
    restartBtn.addEventListener("click", () =>
      channelAction("restart", container, isDark),
    );
}

function toggleChatType(type) {
  const has = state.allowedChatTypes.includes(type);
  state.allowedChatTypes = has
    ? state.allowedChatTypes.filter((t) => t !== type)
    : [...state.allowedChatTypes, type];
}

// ─── API actions ─────────────────────────────────────────────────────────────
async function saveConfig(container, isDark) {
  state.saving = true;
  render(container, isDark);

  try {
    const payload = {
      cwd: state.cwd.trim() || null,
      provider: state.provider,
      model: state.model.trim() || null,
      appId: state.appId.trim(),
      domain: state.domain,
      botName: state.botName.trim() || null,
      allowedChatTypes: state.allowedChatTypes,
    };
    if (state.appSecretInput.trim()) {
      payload.appSecret = state.appSecretInput.trim();
    }

    const res = await apiFetch(`/api/channels/${CHANNEL_NAME}/config`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "保存失败");
    }

    const data = await res.json();
    const nextCfg = data.config || {};
    // Update hasAppSecret from response, or infer from what we just sent
    state.hasAppSecret =
      nextCfg.hasAppSecret ?? (state.hasAppSecret || !!payload.appSecret);
    state.appSecretInput = "";
    state._cwdFromConfig = !!state.cwd;
    showToast("配置已保存 ✓", "ok");
  } catch (e) {
    showToast(e.message || "保存失败", "err");
  } finally {
    state.saving = false;
    render(container, isDark);
  }
}

async function channelAction(action, container, isDark) {
  try {
    const res = await apiFetch(`/api/channels/${CHANNEL_NAME}/${action}`, {
      method: "POST",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `${action} 失败`);
    }
    showToast("操作成功", "ok");
    await loadStatus();
    render(container, isDark);
  } catch (e) {
    showToast(e.message || `${action} 失败`, "err");
  }
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const res = await apiFetch(`/api/channels/${CHANNEL_NAME}`);
    if (res.ok) {
      const data = await res.json();
      state.status = data.channel?.status || "stopped";
    } else {
      state.status = "error";
    }
  } catch {
    state.status = "error";
  }
}

async function loadConfig() {
  try {
    const res = await apiFetch(`/api/channels/${CHANNEL_NAME}/config`);
    if (!res.ok) return;
    const data = await res.json();
    const cfg = data.config || {};

    state.provider = cfg.provider || "claude";
    state.model =
      cfg.model ||
      (state.modelDefaults && state.modelDefaults[state.provider]) ||
      FALLBACK_DEFAULTS[state.provider] ||
      "sonnet";
    state.cwd = cfg.cwd || "";
    state._cwdFromConfig = !!cfg.cwd;
    state.dirMode = "project";

    // Feishu-specific
    state.appId = cfg.appId || "";
    state.hasAppSecret = !!cfg.hasAppSecret;
    state.domain = cfg.domain || "feishu";
    state.botName = cfg.botName || "";
    state.allowedChatTypes =
      Array.isArray(cfg.allowedChatTypes) && cfg.allowedChatTypes.length > 0
        ? cfg.allowedChatTypes
        : ["p2p"];
  } catch {}
}

async function loadProjects() {
  try {
    const res = await apiFetch("/api/projects");
    if (!res.ok) return;
    const data = await res.json();
    state.projects = (Array.isArray(data) ? data : data.projects || []).map(
      (p) => ({
        displayName: p.displayName || p.name,
        path: p.path,
        fullPath: p.fullPath || p.path,
      }),
    );
  } catch {}
}

async function loadModels() {
  try {
    const res = await apiFetch("/api/channels/models");
    if (!res.ok) return;
    const data = await res.json();
    state.models = data.models;
    state.modelDefaults = data.defaults;
  } catch (e) {
    console.warn(
      "[FeishuChannel] Failed to load models from API, using fallback:",
      e,
    );
  }
}

// ─── Entry points ─────────────────────────────────────────────────────────────
export async function mount(container, api) {
  // Inject stylesheet once per page lifetime
  let styleEl = document.getElementById("fsc-styles");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "fsc-styles";
    document.head.appendChild(styleEl);
  }

  const isDark = api.context.theme === "dark";
  styleEl.textContent = buildStyles(isDark);

  // Show loading placeholder
  container.innerHTML = `
    <div class="fsc-wrap">
      <div class="fsc-card" style="text-align:center;color:#71717a;padding:40px">加载中…</div>
    </div>
  `;

  // Load all data in parallel (models first so defaults are ready for loadConfig)
  await Promise.all([loadModels(), loadStatus(), loadProjects()]);
  await loadConfig(); // after models so modelDefaults is populated

  // Default to current project's path if no cwd was saved
  if (!state._cwdFromConfig && api.context.project) {
    state.cwd = api.context.project.path || "";
  }

  render(container, isDark);

  // Re-render when theme or selected project changes
  api.onContextChange((ctx) => {
    const dark = ctx.theme === "dark";
    styleEl.textContent = buildStyles(dark);
    if (!state._cwdFromConfig && ctx.project) {
      state.cwd = ctx.project.path || "";
    }
    render(container, dark);
  });
}

export function unmount(container) {
  container.innerHTML = "";
  const styleEl = document.getElementById("fsc-styles");
  if (styleEl) styleEl.remove();
}
