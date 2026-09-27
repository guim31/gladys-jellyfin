import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { ServerSocket } from '../src/media/socket.js';
import { MediaServerApi, SERVER_KIND } from '../src/media/api.js';

// A local WebSocket server standing in for the real-time socket of the media
// server: it records the upgrade requests and the messages it receives.
let wss;
let port;
const upgrades = [];
const received = [];
let onConnection = () => {};

before(async () => {
  wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.on('listening', resolve));
  port = wss.address().port;
  wss.on('connection', (ws, req) => {
    upgrades.push({ url: req.url, authorization: req.headers.authorization });
    ws.on('message', (raw) => received.push(JSON.parse(raw.toString())));
    onConnection(ws);
  });
});

after(() => wss.close());

function apiOf(kind) {
  const api = new MediaServerApi({ server_url: `http://127.0.0.1:${port}`, api_key: 'the-key' });
  api.kind = kind;
  return api;
}

const waitFor = async (predicate, timeoutMs = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('Jellyfin: /socket, key in the Authorization header only, sessions subscription', async () => {
  upgrades.length = 0;
  received.length = 0;
  const pushes = [];
  onConnection = (ws) => {
    ws.send(JSON.stringify({ MessageType: 'ForceKeepAlive', Data: 60 }));
    ws.send(JSON.stringify({ MessageType: 'Sessions', Data: [{ Id: 's1' }] }));
  };
  const socket = new ServerSocket(apiOf(SERVER_KIND.JELLYFIN), {
    onSessions: (sessions) => pushes.push(sessions),
  });
  socket.start();
  await waitFor(() => pushes.length === 1 && received.length === 1);
  assert.ok(socket.isOpen);
  assert.match(upgrades[0].url, /^\/socket\?deviceId=gladys-assistant-integration$/);
  assert.match(upgrades[0].authorization, /Token="the-key"/);
  assert.deepEqual(received[0], { MessageType: 'SessionsStart', Data: '0,1500' });
  assert.deepEqual(pushes[0], [{ Id: 's1' }]);
  socket.stop();
  assert.ok(!socket.isOpen);
});

test('Emby: /embywebsocket with the key in the query string', async () => {
  upgrades.length = 0;
  onConnection = () => {};
  let opened = false;
  const socket = new ServerSocket(apiOf(SERVER_KIND.EMBY), {
    onSessions: () => {},
    onStatus: (open) => (opened = open),
  });
  socket.start();
  await waitFor(() => opened);
  const url = new URL(upgrades[0].url, 'http://x');
  assert.equal(url.pathname, '/embywebsocket');
  assert.equal(url.searchParams.get('api_key'), 'the-key');
  assert.equal(url.searchParams.get('deviceId'), 'gladys-assistant-integration');
  socket.stop();
});

test('library changes are forwarded, junk is ignored', async () => {
  let libraryChanges = 0;
  const pushes = [];
  onConnection = (ws) => {
    ws.send('not json');
    ws.send(JSON.stringify({ MessageType: 'Sessions', Data: 'not a list' }));
    ws.send(JSON.stringify({ MessageType: 'LibraryChanged', Data: {} }));
  };
  const socket = new ServerSocket(apiOf(SERVER_KIND.JELLYFIN), {
    onSessions: (sessions) => pushes.push(sessions),
    onLibraryChanged: () => (libraryChanges += 1),
  });
  socket.start();
  await waitFor(() => libraryChanges === 1);
  assert.equal(pushes.length, 0);
  socket.stop();
});

test('the socket reconnects after the server closes it', async () => {
  let connections = 0;
  onConnection = (ws) => {
    connections += 1;
    if (connections === 1) {
      ws.close();
    }
  };
  const socket = new ServerSocket(apiOf(SERVER_KIND.JELLYFIN), { onSessions: () => {} });
  // Speed the backoff up for the test.
  socket.scheduleReconnect = function scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 20);
  };
  socket.start();
  await waitFor(() => connections === 2);
  socket.stop();
});

test('a refused upgrade does not throw, and stop() cancels the retry', async () => {
  const socket = new ServerSocket(
    (() => {
      const api = new MediaServerApi({ server_url: 'http://127.0.0.1:1', api_key: 'k' });
      api.kind = SERVER_KIND.JELLYFIN;
      return api;
    })(),
    { onSessions: () => {} },
  );
  socket.start();
  await new Promise((r) => setTimeout(r, 100));
  socket.stop();
  assert.equal(socket.reconnectTimer, null);
});
