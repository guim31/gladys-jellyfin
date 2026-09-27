// -----------------------------------------------------------------------------
// Real-time socket of a Jellyfin / Emby server.
//
// Subscribing with `SessionsStart` makes the server push the COMPLETE session
// list (the `/Sessions` payload) within ~1.5 s of every change: play, pause,
// volume, a player connecting... The monitor processes those pushes exactly
// like a poll result, so the socket only makes things faster: when it is down,
// the fallback poll of index.js keeps everything working.
//
// Differences between the two servers (verified on Jellyfin 10.11 / 12.1 and
// Emby 4.10):
//   - path: `/socket` (Jellyfin) vs `/embywebsocket` (Emby);
//   - authentication: Jellyfin reads the `Authorization` header of the
//     upgrade request (its `?api_key=` is disabled by default since 12.0);
//     Emby only binds the socket through `?api_key=` in the query string.
//   - keep-alive: Jellyfin announces `ForceKeepAlive` (seconds) and closes
//     a socket that stays silent; answering `KeepAlive` at half that period
//     suits both.
// -----------------------------------------------------------------------------

import WebSocket from 'ws';
import { createLogger } from '@gladysassistant/integration-sdk';
import { SERVER_KIND, CLIENT_DEVICE_ID } from './api.js';

const logger = createLogger({ name: 'media-socket' });

// Push interval requested from the server ("initial delay, interval" in ms).
const SESSIONS_SUBSCRIPTION = '0,1500';
const DEFAULT_KEEP_ALIVE_SECONDS = 30;
const RECONNECT_BASE_DELAY_MS = 5_000;
const RECONNECT_MAX_DELAY_MS = 60_000;

export class ServerSocket {
  /**
   * @param {import('./api.js').MediaServerApi} api - Detected API client.
   * @param {{ allowSelfSigned?: boolean, onSessions: (sessions: object[]) => void,
   *   onLibraryChanged?: () => void, onStatus?: (open: boolean) => void }} handlers
   */
  constructor(api, handlers) {
    this.api = api;
    this.handlers = handlers;
    this.ws = null;
    this.stopped = true;
    this.keepAliveTimer = null;
    this.reconnectTimer = null;
    this.failures = 0;
  }

  /** True while the socket is connected. */
  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Build the socket URL (the API key only appears here for Emby). */
  url() {
    const base = this.api.baseUrl.replace(/^http/i, 'ws');
    const query = new URLSearchParams({ deviceId: CLIENT_DEVICE_ID });
    if (this.api.kind === SERVER_KIND.EMBY) {
      query.set('api_key', this.api.apiKey);
      return `${base}/embywebsocket?${query}`;
    }
    return `${base}/socket?${query}`;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearKeepAlive();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on('error', () => {});
      this.ws.terminate();
      this.ws = null;
    }
  }

  connect() {
    if (this.stopped) {
      return;
    }
    const ws = new WebSocket(this.url(), {
      headers: { Authorization: this.api.authorizationHeader() },
      handshakeTimeout: 10_000,
      rejectUnauthorized: !this.handlers.allowSelfSigned,
    });
    this.ws = ws;

    ws.on('open', () => {
      this.failures = 0;
      logger.info('Real-time socket connected');
      ws.send(JSON.stringify({ MessageType: 'SessionsStart', Data: SESSIONS_SUBSCRIPTION }));
      this.armKeepAlive(DEFAULT_KEEP_ALIVE_SECONDS * 2);
      this.handlers.onStatus?.(true);
    });

    ws.on('message', (raw) => this.handleMessage(raw));

    ws.on('unexpected-response', (_req, res) => {
      // The socket is optional (the poll carries on): one warning, no stack.
      logger.warn(`Real-time socket refused (HTTP ${res.statusCode}), polling only for now`);
      ws.terminate();
    });

    ws.on('error', (err) => {
      logger.debug(`Real-time socket error: ${err.message}`);
    });

    ws.on('close', () => {
      this.clearKeepAlive();
      if (this.ws === ws) {
        this.ws = null;
      }
      this.handlers.onStatus?.(false);
      this.scheduleReconnect();
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (message?.MessageType) {
      case 'Sessions':
        if (Array.isArray(message.Data)) {
          this.handlers.onSessions(message.Data);
        }
        break;
      case 'ForceKeepAlive':
        this.armKeepAlive(Number(message.Data) || DEFAULT_KEEP_ALIVE_SECONDS * 2);
        break;
      case 'LibraryChanged':
        this.handlers.onLibraryChanged?.();
        break;
      default:
        break;
    }
  }

  /**
   * Send `KeepAlive` at half the server timeout.
   * @param {number} timeoutSeconds
   */
  armKeepAlive(timeoutSeconds) {
    this.clearKeepAlive();
    const periodMs = Math.max(5, timeoutSeconds / 2) * 1_000;
    this.keepAliveTimer = setInterval(() => {
      if (this.isOpen) {
        this.ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
      }
    }, periodMs);
  }

  clearKeepAlive() {
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** this.failures);
    this.failures += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
