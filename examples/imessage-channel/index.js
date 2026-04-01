/**
 * iMessage Channel — Browser-side control panel
 * Pure ES Module, no external dependencies.
 * Loaded by PluginTabContent via Blob URL in the browser.
 */

const CHANNEL_NAME = "imessage-channel";

const PROVIDERS = [
  { id: "claude", label: "Claude Code", sub: "by Anthropic", icon: "✦" },
  { id: "cursor", label: "Cursor", sub: "AI Code Editor", icon: "◈" },
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

  return `
    .imc-wrap { display:flex; flex-direction:column; gap:20px; padding:24px; max-width:700px; margin:0 auto; font-family:system-ui,-apple-system,sans-serif; color:${text}; }
    .imc-card { background:${surface}; border:1px solid ${border}; border-radius:12px; padding:20px; }

    /* Status bar */
    .imc-status { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }
    .imc-status-left { display:flex; align-items:center; gap:10px; }
    .imc-status-dot { width:8px; height:8px; border-radius:50%; background:${muted}; flex-shrink:0; }
    .imc-status-dot.running { background:${success}; box-shadow:0 0 6px ${success}66; }
    .imc-status-dot.error   { background:${dangerTxt}; }
    .imc-status-name { font-size:15px; font-weight:600; }
    .imc-status-badge { font-size:11px; color:${muted}; background:${inputBg}; padding:2px 8px; border-radius:99px; }
    .imc-status-actions { display:flex; gap:8px; }

    /* Section label */
    .imc-label { font-size:12px; font-weight:500; color:${muted}; text-transform:uppercase; letter-spacing:.05em; margin-bottom:10px; }

    /* Provider cards */
    .imc-providers { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
    .imc-provider-card { display:flex; flex-direction:column; align-items:center; gap:6px; padding:12px 8px; border:1.5px solid ${border}; border-radius:10px; cursor:pointer; transition:border-color .15s,background .15s; background:${isDark ? "#202024" : "#fafafa"}; }
    .imc-provider-card:hover { border-color:${accent}66; background:${accentBg}; }
    .imc-provider-card.active { border-color:${accent}; background:${accentBg}; }
    .imc-provider-icon { font-size:22px; line-height:1; }
    .imc-provider-name { font-size:12px; font-weight:600; text-align:center; }
    .imc-provider-sub  { font-size:10px; color:${muted}; text-align:center; line-height:1.2; }

    /* Model row */
    .imc-row { display:flex; align-items:center; gap:12px; margin-top:14px; }
    .imc-row-label { font-size:13px; color:${muted}; white-space:nowrap; min-width:36px; }
    select.imc-select { flex:1; background:${inputBg}; border:1px solid ${border}; border-radius:7px; padding:7px 10px; font-size:13px; color:${text}; outline:none; cursor:pointer; }
    select.imc-select:focus { border-color:${accent}; }

    /* Directory section */
    .imc-dir-wrap { display:flex; flex-direction:column; gap:8px; }
    .imc-dir-hint { font-size:11px; color:${muted}; margin-top:2px; }
    .imc-input { width:100%; background:${inputBg}; border:1px solid ${border}; border-radius:7px; padding:8px 10px; font-size:13px; color:${text}; outline:none; box-sizing:border-box; }
    .imc-input:focus { border-color:${accent}; }
    .imc-input-mono { font-family:monospace; }
    .imc-dir-tabs { display:flex; gap:0; border:1px solid ${border}; border-radius:7px; overflow:hidden; margin-bottom:4px; width:fit-content; }
    .imc-dir-tab { padding:5px 14px; font-size:12px; cursor:pointer; background:transparent; border:none; color:${muted}; transition:background .12s,color .12s; }
    .imc-dir-tab.active { background:${accent}; color:#fff; }

    /* Save button */
    .imc-actions { display:flex; justify-content:flex-end; gap:8px; }
    .imc-btn { padding:8px 18px; border-radius:7px; font-size:13px; font-weight:500; border:none; cursor:pointer; transition:opacity .15s; }
    .imc-btn:disabled { opacity:.45; cursor:default; }
    .imc-btn-primary { background:${accent}; color:#fff; }
    .imc-btn-primary:not(:disabled):hover { opacity:.85; }
    .imc-btn-ghost { background:${inputBg}; color:${text}; border:1px solid ${border}; }
    .imc-btn-ghost:not(:disabled):hover { border-color:${accent}; color:${accent}; }
    .imc-btn-danger { background:${danger}; color:${dangerTxt}; border:1px solid ${dangerTxt}44; }
    .imc-btn-danger:not(:disabled):hover { opacity:.8; }

    /* PTY advanced card */
    .imc-pty-card { background:${isDark ? "rgba(139,92,246,0.08)" : "rgba(139,92,246,0.05)"}; border:1px solid ${isDark ? "rgba(139,92,246,0.25)" : "rgba(139,92,246,0.18)"}; border-radius:12px; padding:20px; }
    .imc-pty-title { font-size:14px; font-weight:600; color:${text}; }
    .imc-pty-subtitle { font-size:12px; color:${muted}; margin-top:3px; margin-bottom:14px; }
    .imc-pty-check-label { display:flex; align-items:flex-start; gap:10px; cursor:pointer; }
    .imc-pty-check-label input[type=checkbox] { accent-color:${accent}; width:15px; height:15px; margin-top:2px; flex-shrink:0; cursor:pointer; }
    .imc-pty-check-name { font-size:13px; font-weight:500; color:${text}; }
    .imc-pty-check-desc { font-size:12px; color:${muted}; margin-top:3px; line-height:1.5; }
    .imc-pty-timeout-row { display:flex; align-items:center; gap:10px; margin-top:14px; margin-left:25px; }
    .imc-pty-timeout-row .imc-field-label { margin-bottom:0; white-space:nowrap; }
    .imc-input-number { width:72px; background:${inputBg}; border:1px solid ${border}; border-radius:7px; padding:6px 10px; font-size:13px; color:${text}; outline:none; }
    .imc-input-number:focus { border-color:${accent}; }
    .imc-pty-timeout-hint { font-size:11px; color:${muted}; }
    .imc-field-label { font-size:12px; font-weight:500; color:${muted}; margin-bottom:5px; }

    /* Access Control card */
    .imc-access-card { background:${isDark ? "rgba(59,130,246,0.08)" : "rgba(59,130,246,0.05)"}; border:1px solid ${isDark ? "rgba(59,130,246,0.25)" : "rgba(59,130,246,0.18)"}; border-radius:12px; padding:20px; }
    .imc-access-title { font-size:14px; font-weight:600; color:${text}; display:flex; align-items:center; gap:8px; }
    .imc-access-subtitle { font-size:12px; color:${muted}; margin-top:3px; margin-bottom:14px; }
    .imc-access-add { display:flex; gap:8px; margin-bottom:16px; }
    .imc-access-add input { flex:1; }
    .imc-access-list-title { font-size:13px; font-weight:500; color:${text}; margin-bottom:8px; display:flex; align-items:center; gap:6px; }
    .imc-access-list { display:flex; flex-direction:column; gap:6px; }
    .imc-access-item { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:${inputBg}; border:1px solid ${border}; border-radius:7px; }
    .imc-access-sender { font-size:13px; color:${text}; font-family:monospace; }
    .imc-access-remove { padding:4px 10px; font-size:11px; background:transparent; border:1px solid ${border}; border-radius:5px; color:${dangerTxt}; cursor:pointer; transition:background .15s; }
    .imc-access-remove:hover { background:${danger}; }
    .imc-access-empty { text-align:center; padding:20px; color:${muted}; font-size:13px; }

    /* Toast */
    .imc-toast { position:fixed; bottom:24px; right:24px; padding:10px 18px; border-radius:8px; font-size:13px; font-weight:500; background:${surface}; border:1px solid ${border}; box-shadow:0 4px 16px #0006; z-index:9999; animation:imc-fadein .2s ease; }
    .imc-toast.ok  { border-color:${success}; color:${success}; }
    .imc-toast.err { border-color:${dangerTxt}; color:${dangerTxt}; }
    @keyframes imc-fadein { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
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
  // PTY advanced
  usePersistentPty: false,
  ptyIdleTimeoutMinutes: 30,
  // Access control
  allowedSenders: [],
  newSenderId: "",
  // Loaded from API
  models: null,
  modelDefaults: null,
};

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = `imc-toast ${type}`;
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
    <div class="imc-provider-card ${s.provider === p.id ? "active" : ""}" data-provider="${p.id}">
      <span class="imc-provider-icon">${p.icon}</span>
      <span class="imc-provider-name">${p.label}</span>
      <span class="imc-provider-sub">${p.sub}</span>
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
      ? `<select class="imc-select imc-cwd-select">
         <option value="">— Select Project —</option>
         ${projectOptions}
       </select>`
      : `<input class="imc-input imc-input-mono imc-cwd-input" type="text" placeholder="/Users/..." value="${escAttr(s.cwd)}" />`;

  container.innerHTML = `
    <div class="imc-wrap">

      <!-- Status card -->
      <div class="imc-card">
        <div class="imc-status">
          <div class="imc-status-left">
            <div class="imc-status-dot ${s.status}"></div>
            <span class="imc-status-name">iMessage Channel</span>
            <span class="imc-status-badge">${statusLabel}</span>
          </div>
          <div class="imc-status-actions">
            ${
              s.status === "running"
                ? `<button class="imc-btn imc-btn-ghost imc-btn-restart">Restart</button>
                 <button class="imc-btn imc-btn-danger imc-btn-stop">Stop</button>`
                : `<button class="imc-btn imc-btn-primary imc-btn-start">Start</button>`
            }
          </div>
        </div>
      </div>

      <!-- Provider + Model card -->
      <div class="imc-card">
        <div class="imc-label">AI Assistant</div>
        <div class="imc-providers">${providerCards}</div>
        <div class="imc-row">
          <span class="imc-row-label">Model</span>
          <select class="imc-select imc-model-select">${modelOptions}</select>
        </div>
      </div>

      <!-- Working directory card -->
      <div class="imc-card">
        <div class="imc-label">Working Directory</div>
        <div class="imc-dir-wrap">
          <div class="imc-dir-tabs">
            <button class="imc-dir-tab ${s.dirMode === "project" ? "active" : ""}" data-mode="project">From Project</button>
            <button class="imc-dir-tab ${s.dirMode === "manual" ? "active" : ""}" data-mode="manual">Manual Input</button>
          </div>
          ${dirSection}
          <div class="imc-dir-hint">Claude will execute file operations in this directory</div>
        </div>
      </div>

      <!-- Advanced / PTY settings (Claude only) -->
      ${
        s.provider === "claude"
          ? `
      <div class="imc-pty-card">
        <div class="imc-pty-title">Advanced Settings</div>
        <div class="imc-pty-subtitle">Claude performance optimization options</div>
        <label class="imc-pty-check-label">
          <input type="checkbox" class="imc-pty-checkbox" ${s.usePersistentPty ? "checked" : ""} />
          <div>
            <div class="imc-pty-check-name">Persistent PTY Mode</div>
            <div class="imc-pty-check-desc">Maintain a background Claude process for each conversation, reducing startup overhead per message. Conversation history stays in memory without reloading from disk.</div>
          </div>
        </label>
        ${
          s.usePersistentPty
            ? `
        <div class="imc-pty-timeout-row">
          <span class="imc-field-label">Idle Timeout (minutes)</span>
          <input class="imc-input-number imc-pty-timeout-input" type="number" min="1" max="120" value="${s.ptyIdleTimeoutMinutes}" />
          <span class="imc-pty-timeout-hint">Background process auto-destroys after inactivity</span>
        </div>
        `
            : ""
        }
      </div>
      `
          : ""
      }

      <!-- Access Control -->
      <div class="imc-access-card">
        <div class="imc-access-title">
          <span>🛡️</span>
          <span>Access Control</span>
        </div>
        <div class="imc-access-subtitle">Add sender IDs to the allowlist</div>
        
        <div class="imc-access-add">
          <input 
            class="imc-input imc-sender-input" 
            type="text" 
            placeholder="Phone number, email, or chat ID" 
            value="${escAttr(s.newSenderId)}" 
          />
          <button class="imc-btn imc-btn-primary imc-btn-add-sender">Add</button>
        </div>

        <div class="imc-access-list-title">
          <span>👥</span>
          <span>Allowed Senders (${s.allowedSenders.length})</span>
        </div>
        
        ${
          s.allowedSenders.length > 0
            ? `<div class="imc-access-list">
              ${s.allowedSenders
                .map(
                  (sender) => `
                <div class="imc-access-item">
                  <span class="imc-access-sender">${escAttr(sender.senderId)}</span>
                  <button class="imc-access-remove" data-sender="${escAttr(sender.senderId)}">Remove</button>
                </div>
              `,
                )
                .join("")}
            </div>`
            : `<div class="imc-access-empty">No senders in allowlist</div>`
        }
      </div>

      <!-- Save -->
      <div class="imc-actions">
        <button class="imc-btn imc-btn-primary imc-btn-save" ${s.saving ? "disabled" : ""}>
          ${s.saving ? "Saving…" : "Save Configuration"}
        </button>
      </div>

    </div>
  `;

  attachEvents(container, isDark);
}

// ─── Events ──────────────────────────────────────────────────────────────────
function attachEvents(container, isDark) {
  // Provider cards
  container.querySelectorAll(".imc-provider-card").forEach((card) => {
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
  const modelSel = container.querySelector(".imc-model-select");
  if (modelSel)
    modelSel.addEventListener("change", (e) => {
      state.model = e.target.value;
    });

  // Dir mode tabs
  container.querySelectorAll(".imc-dir-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.dirMode = btn.dataset.mode;
      render(container, isDark);
    });
  });

  // Dir project select
  const cwdSel = container.querySelector(".imc-cwd-select");
  if (cwdSel)
    cwdSel.addEventListener("change", (e) => {
      state.cwd = e.target.value;
    });

  // Dir manual input
  const cwdInput = container.querySelector(".imc-cwd-input");
  if (cwdInput)
    cwdInput.addEventListener("input", (e) => {
      state.cwd = e.target.value;
    });

  // PTY advanced
  const ptyCheckbox = container.querySelector(".imc-pty-checkbox");
  if (ptyCheckbox)
    ptyCheckbox.addEventListener("change", (e) => {
      state.usePersistentPty = e.target.checked;
      render(container, isDark);
    });

  const ptyTimeoutEl = container.querySelector(".imc-pty-timeout-input");
  if (ptyTimeoutEl)
    ptyTimeoutEl.addEventListener("input", (e) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v))
        state.ptyIdleTimeoutMinutes = Math.max(1, Math.min(120, v));
    });

  // Access control
  const senderInput = container.querySelector(".imc-sender-input");
  if (senderInput)
    senderInput.addEventListener("input", (e) => {
      state.newSenderId = e.target.value;
    });

  const addSenderBtn = container.querySelector(".imc-btn-add-sender");
  if (addSenderBtn)
    addSenderBtn.addEventListener("click", () => addSender(container, isDark));

  container.querySelectorAll(".imc-access-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const senderId = btn.dataset.sender;
      removeSender(senderId, container, isDark);
    });
  });

  // Action buttons
  const saveBtn = container.querySelector(".imc-btn-save");
  if (saveBtn)
    saveBtn.addEventListener("click", () => saveConfig(container, isDark));

  const startBtn = container.querySelector(".imc-btn-start");
  if (startBtn)
    startBtn.addEventListener("click", () =>
      channelAction("enable", container, isDark),
    );

  const stopBtn = container.querySelector(".imc-btn-stop");
  if (stopBtn)
    stopBtn.addEventListener("click", () =>
      channelAction("disable", container, isDark),
    );

  const restartBtn = container.querySelector(".imc-btn-restart");
  if (restartBtn)
    restartBtn.addEventListener("click", () =>
      channelAction("restart", container, isDark),
    );
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
      usePersistentPty: state.usePersistentPty,
      ptyIdleTimeoutMinutes: state.ptyIdleTimeoutMinutes,
    };

    const res = await apiFetch(`/api/channels/${CHANNEL_NAME}/config`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Save failed");
    }

    const data = await res.json();
    state._cwdFromConfig = !!state.cwd;
    showToast("Configuration saved ✓", "ok");
  } catch (e) {
    showToast(e.message || "Save failed", "err");
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
      throw new Error(err.error || `${action} failed`);
    }
    showToast("Operation successful", "ok");
    await loadStatus();
    render(container, isDark);
  } catch (e) {
    showToast(e.message || `${action} failed`, "err");
  }
}

async function addSender(container, isDark) {
  const senderId = state.newSenderId.trim();
  if (!senderId) {
    showToast("Please enter a sender ID", "err");
    return;
  }

  try {
    const res = await apiFetch(`/api/channels/${CHANNEL_NAME}/access`, {
      method: "POST",
      body: JSON.stringify({ senderId, policy: "allow" }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to add sender");
    }

    state.newSenderId = "";
    await loadAccessList();
    render(container, isDark);
    showToast("Sender added ✓", "ok");
  } catch (e) {
    showToast(e.message || "Failed to add sender", "err");
  }
}

async function removeSender(senderId, container, isDark) {
  try {
    const res = await apiFetch(
      `/api/channels/${CHANNEL_NAME}/access/${encodeURIComponent(senderId)}`,
      { method: "DELETE" },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to remove sender");
    }

    await loadAccessList();
    render(container, isDark);
    showToast("Sender removed ✓", "ok");
  } catch (e) {
    showToast(e.message || "Failed to remove sender", "err");
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

    // PTY advanced
    state.usePersistentPty = !!cfg.usePersistentPty;
    state.ptyIdleTimeoutMinutes = cfg.ptyIdleTimeoutMinutes || 30;
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
      "[iMessageChannel] Failed to load models from API, using fallback:",
      e,
    );
  }
}

async function loadAccessList() {
  try {
    const res = await apiFetch(`/api/channels/${CHANNEL_NAME}/access`);
    if (!res.ok) return;
    const data = await res.json();
    state.allowedSenders = data.access || [];
  } catch (e) {
    console.warn("[iMessageChannel] Failed to load access list:", e);
    state.allowedSenders = [];
  }
}

// ─── Entry points ─────────────────────────────────────────────────────────────
export async function mount(container, api) {
  // Inject stylesheet once per page lifetime
  let styleEl = document.getElementById("imc-styles");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "imc-styles";
    document.head.appendChild(styleEl);
  }

  const isDark = api.context.theme === "dark";
  styleEl.textContent = buildStyles(isDark);

  // Show loading placeholder
  container.innerHTML = `
    <div class="imc-wrap">
      <div class="imc-card" style="text-align:center;color:#71717a;padding:40px">Loading…</div>
    </div>
  `;

  // Load all data in parallel (models first so defaults are ready for loadConfig)
  await Promise.all([loadModels(), loadStatus(), loadProjects(), loadAccessList()]);
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
  const styleEl = document.getElementById("imc-styles");
  if (styleEl) styleEl.remove();
}
