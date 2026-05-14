import os from 'os';
import { WebSocket } from 'ws';

const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_INTERVAL_MS = 5_000;
const HTTP_REQUEST_TIMEOUT_MS = 60_000;
const MAX_PENDING_WS_MESSAGES = 100;

function normalizeMobileUrl(rawUrl) {
    if (!rawUrl) return null;
    try {
        const url = new URL(rawUrl);
        url.pathname = url.pathname.replace(/\/+$/, '');
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return null;
    }
}

function buildTunnelUrl(mobileUrl) {
    const url = new URL(mobileUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/tunnel`;
    return url.toString();
}

function normalizeBaseUrl(rawUrl) {
    const url = new URL(rawUrl);
    return url.toString().replace(/\/$/, '');
}

function safeServerId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function getServerId(localBaseUrl) {
    return safeServerId(process.env.MOBILE_SERVER_ID || `${os.hostname()}-${new URL(localBaseUrl).port || '80'}`);
}

function getServerName(localBaseUrl) {
    return process.env.MOBILE_SERVER_NAME || os.hostname() || new URL(localBaseUrl).host;
}

function getClientInfo() {
    return {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        pid: process.pid,
        cwd: process.cwd(),
        mobileServerIdEnv: process.env.MOBILE_SERVER_ID || '',
        mobileServerNameEnv: process.env.MOBILE_SERVER_NAME || '',
    };
}

function createLocalFetchUrl(localBaseUrl, requestPath) {
    const base = new URL(localBaseUrl);
    const url = new URL(requestPath || '/', base);
    return url.toString();
}

async function handleHttpRequest(ws, localBaseUrl, payload, context) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_REQUEST_TIMEOUT_MS);

    try {
        const headers = { ...(payload.headers || {}) };
        delete headers.host;
        delete headers.connection;
        delete headers['content-length'];
        delete headers['accept-encoding'];

        const body = payload.bodyBase64 ? Buffer.from(payload.bodyBase64, 'base64') : undefined;
        const fetchUrl = createLocalFetchUrl(localBaseUrl, payload.path);
        const response = await fetch(fetchUrl, {
            method: payload.method || 'GET',
            headers,
            body: payload.method === 'GET' || payload.method === 'HEAD' ? undefined : body,
            redirect: 'manual',
            signal: controller.signal,
        });

        const responseBuffer = Buffer.from(await response.arrayBuffer());
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        ws.send(JSON.stringify({
            type: 'http-response',
            serverId: context.serverId,
            requestId: payload.requestId,
            status: response.status,
            headers: responseHeaders,
            bodyBase64: responseBuffer.toString('base64'),
        }));
    } catch (error) {
        ws.send(JSON.stringify({
            type: 'http-error',
            requestId: payload.requestId,
            error: error.message || 'Local request failed',
        }));
    } finally {
        clearTimeout(timeout);
    }
}

function createLocalWebSocket(localBaseUrl, socketId, requestPath, tunnelWs) {
    const base = new URL(localBaseUrl);
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const targetUrl = new URL(requestPath || '/ws', base);
    const upstream = new WebSocket(targetUrl);
    const pendingMessages = [];
    const stats = {
        browserMessages: 0,
        upstreamMessages: 0,
        startedAt: Date.now(),
    };

    upstream.on('open', () => {
        console.log('[MobileTunnel] local ws opened', {
            socketId,
            path: requestPath,
        });
        tunnelWs.send(JSON.stringify({ type: 'ws-open', socketId }));
        while (pendingMessages.length > 0 && upstream.readyState === WebSocket.OPEN) {
            upstream.send(pendingMessages.shift());
        }
    });

    upstream.on('message', (data) => {
        stats.upstreamMessages += 1;
        if (stats.upstreamMessages === 1) {
            console.log('[MobileTunnel] local ws first upstream message', {
                socketId,
                path: requestPath,
                bytes: Buffer.from(data).length,
            });
        }
        tunnelWs.send(JSON.stringify({
            type: 'ws-message',
            socketId,
            bodyBase64: Buffer.from(data).toString('base64'),
        }));
    });

    upstream.on('close', () => {
        console.log('[MobileTunnel] local ws closed', {
            socketId,
            path: requestPath,
            durationMs: Date.now() - stats.startedAt,
            browserMessages: stats.browserMessages,
            upstreamMessages: stats.upstreamMessages,
        });
        tunnelWs.send(JSON.stringify({ type: 'ws-close', socketId }));
    });

    upstream.on('error', (error) => {
        tunnelWs.send(JSON.stringify({
            type: 'ws-error',
            socketId,
            error: error.message || 'Local websocket error',
        }));
    });

    upstream.enqueueOrSend = (data) => {
        stats.browserMessages += 1;
        if (stats.browserMessages === 1) {
            console.log('[MobileTunnel] local ws first browser message', {
                socketId,
                path: requestPath,
                bytes: Buffer.from(data).length,
            });
        }
        if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data);
            return;
        }

        if (upstream.readyState === WebSocket.CONNECTING) {
            if (pendingMessages.length >= MAX_PENDING_WS_MESSAGES) {
                pendingMessages.shift();
            }
            pendingMessages.push(data);
        }
    };

    return upstream;
}

export function startMobileTunnel({ localBaseUrl }) {
    const mobileUrl = normalizeMobileUrl(process.env.MOBILE_URL || process.env.CLAUDECODEUI_MOBILE_URL);
    if (!mobileUrl) {
        return;
    }

    const normalizedLocalBaseUrl = normalizeBaseUrl(localBaseUrl);
    const tunnelUrl = buildTunnelUrl(mobileUrl);
    const serverId = getServerId(normalizedLocalBaseUrl);
    const serverName = getServerName(normalizedLocalBaseUrl);
    const sharedToken = process.env.MOBILE_SHARED_TOKEN || '';

    let ws = null;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    const upstreamSockets = new Map();

    const cleanup = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }

        for (const socket of upstreamSockets.values()) {
            try {
                socket.close();
            } catch {
                // Ignore close errors.
            }
        }
        upstreamSockets.clear();
    };

    const scheduleReconnect = () => {
        cleanup();
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, RECONNECT_INTERVAL_MS);
    };

    const connect = () => {
        try {
            ws = new WebSocket(tunnelUrl);
        } catch (error) {
            console.warn('[MobileTunnel] Failed to create websocket:', error.message);
            scheduleReconnect();
            return;
        }

        ws.on('open', () => {
            const clientInfo = getClientInfo();
            console.log(`[MobileTunnel] Connected to ${mobileUrl}`, {
                serverId,
                serverName,
                localBaseUrl: normalizedLocalBaseUrl,
                hostname: clientInfo.hostname,
                platform: clientInfo.platform,
                cwd: clientInfo.cwd,
            });
            ws.send(JSON.stringify({
                type: 'register',
                id: serverId,
                name: serverName,
                localBaseUrl: normalizedLocalBaseUrl,
                clientInfo,
                token: sharedToken,
            }));

            heartbeatTimer = setInterval(() => {
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'heartbeat' }));
                }
            }, HEARTBEAT_INTERVAL_MS);
        });

        ws.on('message', (raw) => {
            let payload;
            try {
                payload = JSON.parse(raw.toString());
            } catch {
                return;
            }

            if (payload.type === 'registered') {
                console.log(`[MobileTunnel] Registered as ${payload.id}`);
                return;
            }

            if (payload.type === 'register-error') {
                console.warn('[MobileTunnel] Register failed:', payload.error);
                return;
            }

            if (payload.type === 'http-request') {
                if (payload.serverId && payload.serverId !== serverId) {
                    console.warn('[MobileTunnel] Ignoring request for mismatched server id', {
                        expected: serverId,
                        received: payload.serverId,
                        requestId: payload.requestId,
                        path: payload.path,
                    });
                    ws.send(JSON.stringify({
                        type: 'http-error',
                        requestId: payload.requestId,
                        error: `Tunnel server id mismatch: expected ${serverId}, received ${payload.serverId}`,
                    }));
                    return;
                }
                void handleHttpRequest(ws, normalizedLocalBaseUrl, payload, { serverId, serverName });
                return;
            }

            if (payload.type === 'ws-connect') {
                if (payload.serverId && payload.serverId !== serverId) {
                    console.warn('[MobileTunnel] Ignoring websocket for mismatched server id', {
                        expected: serverId,
                        received: payload.serverId,
                        socketId: payload.socketId,
                        path: payload.path,
                    });
                    ws.send(JSON.stringify({
                        type: 'ws-error',
                        socketId: payload.socketId,
                        error: `Tunnel server id mismatch: expected ${serverId}, received ${payload.serverId}`,
                    }));
                    return;
                }
                const upstream = createLocalWebSocket(normalizedLocalBaseUrl, payload.socketId, payload.path, ws);
                upstreamSockets.set(payload.socketId, upstream);
                return;
            }

            if (payload.type === 'ws-message') {
                const upstream = upstreamSockets.get(payload.socketId);
                upstream?.enqueueOrSend?.(Buffer.from(payload.bodyBase64 || '', 'base64'));
                return;
            }

            if (payload.type === 'ws-close') {
                const upstream = upstreamSockets.get(payload.socketId);
                upstreamSockets.delete(payload.socketId);
                if (upstream) upstream.close();
            }
        });

        ws.on('close', () => {
            console.warn('[MobileTunnel] Disconnected, retrying soon');
            scheduleReconnect();
        });

        ws.on('error', (error) => {
            console.warn('[MobileTunnel] WebSocket error:', error.message);
        });
    };

    connect();
}
