#!/usr/bin/env node
/**
 * iMessage Channel for claudecodeui
 *
 * Reads ~/Library/Messages/chat.db for new messages (requires Full Disk Access).
 * Sends AI responses via osascript → Messages.app.
 *
 * Environment variables (injected by claudecodeui):
 *   CHANNEL_SERVICE_TOKEN  — JWT service token for API authentication
 *   CHANNEL_API_ENDPOINT   — Base URL, e.g. http://localhost:23003/api
 *   CHANNEL_NAME           — "imessage-channel"
 *
 * Optional:
 *   IMESSAGE_PROJECT_PATH  — Working directory for the AI session (default: ~)
 *   IMESSAGE_APPEND_SIGNATURE — "true" (default) | "false"
 *   IMESSAGE_STATE_DIR     — Dir for access.json (default: ~/.claude-code-ui/channels/imessage)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVICE_TOKEN = process.env.CHANNEL_SERVICE_TOKEN;
const API_ENDPOINT  = process.env.CHANNEL_API_ENDPOINT || 'http://localhost:23003/api';
const CHANNEL_NAME  = process.env.CHANNEL_NAME || 'imessage-channel';
const PROJECT_PATH  = process.env.IMESSAGE_PROJECT_PATH || homedir();
const APPEND_SIG    = process.env.IMESSAGE_APPEND_SIGNATURE !== 'false';
const SIGNATURE     = '\n\nSent via claudecodeui';
const CHAT_DB       = join(homedir(), 'Library', 'Messages', 'chat.db');
const STATE_DIR     = process.env.IMESSAGE_STATE_DIR
                      ?? join(homedir(), '.claude-code-ui', 'channels', 'imessage');
const ACCESS_FILE   = join(STATE_DIR, 'access.json');
const APPROVED_DIR  = join(STATE_DIR, 'approved');

if (!SERVICE_TOKEN) {
  process.stderr.write('[iMessage] CHANNEL_SERVICE_TOKEN not set — exiting\n');
  process.exit(1);
}

process.on('unhandledRejection', err => process.stderr.write(`[iMessage] unhandledRejection: ${err}\n`));
process.on('uncaughtException',  err => process.stderr.write(`[iMessage] uncaughtException: ${err}\n`));

// ─── SQLite ───────────────────────────────────────────────────────────────────

let db;
try {
  db = new Database(CHAT_DB, { readonly: true });
  db.prepare('SELECT ROWID FROM message LIMIT 1').get(); // probe for Full Disk Access
} catch (err) {
  process.stderr.write(
    `[iMessage] Cannot open ${CHAT_DB}: ${err.message}\n` +
    `  Grant Full Disk Access to your terminal in:\n` +
    `  System Settings → Privacy & Security → Full Disk Access\n`
  );
  process.exit(1);
}

// Apple Core Data epoch: 2001-01-01 UTC
function parseAttributedBody(blob) {
  if (!blob) return null;
  const buf = Buffer.from(blob);
  let i = buf.indexOf('NSString');
  if (i < 0) return null;
  i += 8;
  while (i < buf.length && buf[i] !== 0x2b) i++;
  if (i >= buf.length) return null;
  i++;
  let len;
  const b = buf[i++];
  if (b === 0x81)      { len = buf[i];               i += 1; }
  else if (b === 0x82) { len = buf.readUInt16LE(i);  i += 2; }
  else if (b === 0x83) { len = buf.readUIntLE(i, 3); i += 3; }
  else                 { len = b; }
  if (i + len > buf.length) return null;
  return buf.toString('utf8', i, i + len);
}

function messageText(r) {
  return r.text ?? parseAttributedBody(r.attributedBody) ?? '';
}

const qWatermark = db.prepare('SELECT MAX(ROWID) AS max FROM message');

const qPoll = db.prepare(`
  SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.date, m.is_from_me,
         m.cache_has_attachments, h.id AS handle_id, c.guid AS chat_guid, c.style AS chat_style
  FROM message m
  JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  JOIN chat c ON c.ROWID = cmj.chat_id
  LEFT JOIN handle h ON h.ROWID = m.handle_id
  WHERE m.ROWID > ?
  ORDER BY m.ROWID ASC
`);

// Detect your own iMessage addresses at boot
const SELF = new Set();
{
  const norm = s => (/^[A-Za-z]:/.test(s) ? s.slice(2) : s).toLowerCase();
  for (const { addr } of db.prepare(
    `SELECT DISTINCT account AS addr FROM message WHERE is_from_me=1 AND account IS NOT NULL AND account!='' LIMIT 50`
  ).all()) SELF.add(norm(addr));
  for (const { addr } of db.prepare(
    `SELECT DISTINCT last_addressed_handle AS addr FROM chat WHERE last_addressed_handle IS NOT NULL AND last_addressed_handle!='' LIMIT 50`
  ).all()) SELF.add(norm(addr));
}
process.stderr.write(`[iMessage] Self-chat addresses: ${[...SELF].join(', ') || '(none)'}\n`);

// ─── Access control ───────────────────────────────────────────────────────────

function defaultAccess() {
  return { dmPolicy: 'allowlist', allowFrom: [], pending: {} };
}

function readAccess() {
  try {
    const raw = readFileSync(ACCESS_FILE, 'utf8');
    const p = JSON.parse(raw);
    return {
      dmPolicy:  p.dmPolicy  ?? 'allowlist',
      allowFrom: p.allowFrom ?? [],
      pending:   p.pending   ?? {},
    };
  } catch (err) {
    if (err.code === 'ENOENT') return defaultAccess();
    try { renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`); } catch {}
    return defaultAccess();
  }
}

function saveAccess(a) {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = ACCESS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, ACCESS_FILE);
}

function gate({ senderId, chatGuid, isGroup }) {
  const a = readAccess();
  if (a.dmPolicy === 'disabled') return { action: 'drop' };
  if (!isGroup) {
    if (a.allowFrom.includes(senderId.toLowerCase())) return { action: 'deliver' };
    if (a.dmPolicy === 'allowlist')     return { action: 'drop' };
    // pairing mode
    const now = Date.now();
    let changed = false;
    for (const [code, p] of Object.entries(a.pending)) {
      if (p.expiresAt < now) { delete a.pending[code]; changed = true; }
    }
    if (changed) saveAccess(a);
    for (const [code, p] of Object.entries(a.pending)) {
      if (p.senderId === senderId.toLowerCase()) {
        if ((p.replies ?? 1) >= 2) return { action: 'drop' };
        p.replies = (p.replies ?? 1) + 1;
        saveAccess(a);
        return { action: 'pair', code, isResend: true };
      }
    }
    if (Object.keys(a.pending).length >= 3) return { action: 'drop' };
    const code = randomBytes(3).toString('hex');
    a.pending[code] = {
      senderId: senderId.toLowerCase(), chatId: chatGuid,
      createdAt: now,
      expiresAt: now + 60 * 60 * 1000,
      replies: 1,
    };
    saveAccess(a);
    return { action: 'pair', code, isResend: false };
  }
  return { action: 'drop' }; // groups not supported yet
}

function checkApprovals() {
  let files;
  try { files = readdirSync(APPROVED_DIR); } catch { return; }
  for (const senderId of files) {
    const file = join(APPROVED_DIR, senderId);
    let chatGuid;
    try { chatGuid = readFileSync(file, 'utf8').trim(); } catch { rmSync(file, { force: true }); continue; }
    if (!chatGuid) { rmSync(file, { force: true }); continue; }
    const err = sendText(chatGuid, 'Paired! Say hi to your assistant.');
    if (err) process.stderr.write(`[iMessage] Approval confirm failed: ${err}\n`);
    rmSync(file, { force: true });
  }
}
setInterval(checkApprovals, 5000).unref();

// ─── Sending via AppleScript ──────────────────────────────────────────────────

const SEND_SCRIPT = `on run argv
  tell application "Messages" to send (item 1 of argv) to chat id (item 2 of argv)
end run`;

const ECHO_WINDOW_MS = 15000;
const echo = new Map();
function echoKey(raw) { return raw.trim().replace(/\s+/g, ' ').slice(0, 120); }
function trackEcho(chatGuid, key) {
  const now = Date.now();
  for (const [k, t] of echo) if (now - t > ECHO_WINDOW_MS) echo.delete(k);
  echo.set(`${chatGuid}\x00${echoKey(key)}`, now);
}
function consumeEcho(chatGuid, key) {
  const k = `${chatGuid}\x00${echoKey(key)}`;
  const t = echo.get(k);
  if (!t || Date.now() - t > ECHO_WINDOW_MS) return false;
  echo.delete(k);
  return true;
}

function sendText(chatGuid, text) {
  const res = spawnSync('osascript', ['-', text, chatGuid], {
    input: SEND_SCRIPT, encoding: 'utf8',
  });
  if (res.status !== 0) return res.stderr.trim() || `osascript exit ${res.status}`;
  trackEcho(chatGuid, text);
  return null;
}

const MAX_CHUNK = 10000;
function chunkText(text) {
  if (text.length <= MAX_CHUNK) return [text];
  const out = [];
  let rest = text;
  while (rest.length > MAX_CHUNK) {
    const para  = rest.lastIndexOf('\n\n', MAX_CHUNK);
    const line  = rest.lastIndexOf('\n',   MAX_CHUNK);
    const space = rest.lastIndexOf(' ',    MAX_CHUNK);
    const cut = para > MAX_CHUNK / 2 ? para : line > MAX_CHUNK / 2 ? line : space > 0 ? space : MAX_CHUNK;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

// ─── API call to claudecodeui ─────────────────────────────────────────────────

const inFlight = new Map(); // chatGuid → true (prevent concurrent requests per chat)

async function sendToAI(chatGuid, senderId, text) {
  if (inFlight.get(chatGuid)) {
    process.stderr.write(`[iMessage] Skipping ${chatGuid.slice(-20)} — previous request in flight\n`);
    return;
  }
  inFlight.set(chatGuid, true);
  try {
    const res = await fetch(`${API_ENDPOINT}/channels/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_TOKEN}`,
      },
      body: JSON.stringify({
        message:          text,
        externalChatId:   chatGuid,
        externalSenderId: senderId,
        projectPath:      PROJECT_PATH,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      process.stderr.write(`[iMessage] API error ${res.status}: ${body}\n`);
      sendText(chatGuid, `(Error: AI returned ${res.status})`);
      return;
    }

    const data = await res.json();
    const reply = (data.content || '').trim();

    if (!reply) {
      process.stderr.write(`[iMessage] Empty AI response for ${chatGuid.slice(-20)}\n`);
      return;
    }

    const chunks = chunkText(reply);
    if (APPEND_SIG && chunks.length > 0) chunks[chunks.length - 1] += SIGNATURE;
    for (let i = 0; i < chunks.length; i++) {
      const err = sendText(chatGuid, chunks[i]);
      if (err) {
        process.stderr.write(`[iMessage] Send chunk ${i + 1}/${chunks.length} failed: ${err}\n`);
        break;
      }
    }
  } catch (err) {
    process.stderr.write(`[iMessage] sendToAI error: ${err.message}\n`);
    sendText(chatGuid, '(Error: could not reach AI)');
  } finally {
    inFlight.delete(chatGuid);
  }
}

// ─── Inbound polling ──────────────────────────────────────────────────────────

let watermark = qWatermark.get()?.max ?? 0;
process.stderr.write(`[iMessage] Watching ${CHAT_DB} (watermark=${watermark})\n`);

function poll() {
  let rows;
  try { rows = qPoll.all(watermark); } catch (err) {
    process.stderr.write(`[iMessage] Poll error: ${err.message}\n`); return;
  }
  for (const r of rows) {
    watermark = r.rowid;
    handleInbound(r);
  }
}

function handleInbound(r) {
  if (!r.chat_guid || r.chat_style == null) return;

  const isGroup = r.chat_style === 43; // 45=DM, 43=group
  const text = messageText(r);

  if (!text) return; // skip attachment-only messages
  if (r.is_from_me) return;
  if (!r.handle_id)  return;

  const sender = r.handle_id;
  const isSelf = !isGroup && SELF.has(sender.toLowerCase());

  if (isSelf && consumeEcho(r.chat_guid, text)) return;

  if (!isSelf) {
    const result = gate({ senderId: sender, chatGuid: r.chat_guid, isGroup });
    if (result.action === 'drop') return;
    if (result.action === 'pair') {
      const lead = result.isResend ? 'Still pending' : 'Pairing required';
      const err = sendText(
        r.chat_guid,
        `${lead} — run in claudecodeui:\n/imessage-channel pair ${result.code}`
      );
      if (err) process.stderr.write(`[iMessage] Pairing code send failed: ${err}\n`);
      return;
    }
  }

  sendToAI(r.chat_guid, sender, text).catch(err =>
    process.stderr.write(`[iMessage] sendToAI unhandled: ${err.message}\n`)
  );
}

setInterval(poll, 1000).unref();

// ─── MCP Server ───────────────────────────────────────────────────────────────

const mcp = new Server(
  { name: 'imessage-channel', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: { 'claude/channel': {} },
    },
  }
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'status',
      description: 'Show current iMessage channel access config (dmPolicy, allowFrom, pending pairings).',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'allow',
      description: 'Add a phone number or Apple ID email to the iMessage allowlist.',
      inputSchema: {
        type: 'object',
        properties: { senderId: { type: 'string', description: '+15551234567 or user@icloud.com' } },
        required: ['senderId'],
      },
    },
    {
      name: 'pair',
      description: 'Approve a pairing code shown to a sender under pairing mode.',
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string', description: '6-char hex code' } },
        required: ['code'],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = req.params.arguments ?? {};
  try {
    switch (req.params.name) {
      case 'status': {
        const a = readAccess();
        const text =
          `dmPolicy: ${a.dmPolicy}\n` +
          `allowFrom (${a.allowFrom.length}): ${a.allowFrom.join(', ') || '(empty)'}\n` +
          `pending pairings: ${Object.keys(a.pending).length}\n` +
          `selfAddresses: ${[...SELF].join(', ') || '(none detected)'}`;
        return { content: [{ type: 'text', text }] };
      }
      case 'allow': {
        const id = (args.senderId ?? '').trim().toLowerCase();
        if (!id) throw new Error('senderId required');
        const a = readAccess();
        if (!a.allowFrom.includes(id)) { a.allowFrom.push(id); saveAccess(a); }
        return { content: [{ type: 'text', text: `Added ${id} to allowlist` }] };
      }
      case 'pair': {
        const code = (args.code ?? '').trim().toLowerCase();
        const a = readAccess();
        const entry = a.pending[code];
        if (!entry) return { content: [{ type: 'text', text: `No pending pairing for code "${code}"` }] };
        if (Date.now() > entry.expiresAt) {
          delete a.pending[code]; saveAccess(a);
          return { content: [{ type: 'text', text: `Code "${code}" has expired` }] };
        }
        if (!a.allowFrom.includes(entry.senderId)) a.allowFrom.push(entry.senderId);
        delete a.pending[code];
        saveAccess(a);
        mkdirSync(APPROVED_DIR, { recursive: true });
        writeFileSync(join(APPROVED_DIR, entry.senderId), entry.chatId);
        return { content: [{ type: 'text', text: `Paired! ${entry.senderId} added to allowlist.` }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

// ─── Shutdown ─────────────────────────────────────────────────────────────────

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write('[iMessage] Shutting down\n');
  try { db.close(); } catch {}
  process.exit(0);
}
process.stdin.on('end',   shutdown);
process.stdin.on('close', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

await mcp.connect(new StdioServerTransport());
process.stderr.write('[iMessage] MCP server ready — polling chat.db\n');
