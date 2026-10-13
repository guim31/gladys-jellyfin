// -----------------------------------------------------------------------------
// The whole integration (src/app.js) against the fake Gladys of the SDK: the
// media server API and the real-time socket are in-memory stand-ins.
//
// Covers what no module test can see: no state depends on the core polling
// the devices (Gladys #3198), and the logs stay quiet in normal operation.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../src/app.js';
import { MediaMonitor } from '../src/monitor.js';
import { playerKey } from '../src/media/sessions.js';
import { playerExternalIds, PLAYER_FEATURE } from '../src/devices/player.js';
import { tvSession, idleTvSession, TV_DEVICE_ID } from './fixtures/sessions.js';
import { captureLogs } from './helpers/logs.js';

const API_KEY = 'secret-api-key-0123456789';
const TV_KEY = playerKey(TV_DEVICE_ID);

const pausedTvSession = () =>
  tvSession({ PlayState: { ...tvSession().PlayState, IsPaused: true } });

const waitFor = async (predicate, timeoutMs = 3000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timeout');
    }
    await new Promise((r) => setTimeout(r, 5));
  }
};

/**
 * Start the integration on a fake Gladys, with a fake media server.
 * @param {import('node:test').TestContext} t
 * @param {{ detectError?: Error }} [options]
 */
async function start(t, { detectError } = {}) {
  const server = {
    sessions: [tvSession()],
    sessionsError: null,
    detectError: detectError ?? null,
    calls: { detect: 0, sessions: 0, libraries: 0 },
  };
  const sockets = [];
  const gladys = createFakeGladys({
    config: { server_url: 'http://nas:8096', api_key: API_KEY, language: 'en' },
  });
  const app = createApp(gladys, {
    version: '1.0.0',
    pollTickMs: 20,
    pollWithSocketMs: 40,
    retryDelayMs: 20,
    createMonitor: (config) => {
      const monitor = new MediaMonitor(gladys, config, { version: '1.0.0' });
      Object.assign(monitor.api, {
        detect: async () => {
          server.calls.detect += 1;
          if (server.detectError) {
            throw server.detectError;
          }
          monitor.api.kind = 'jellyfin';
          return { kind: 'jellyfin', id: 'srv1', name: 'NAS', version: '12.1.0' };
        },
        getSystemInfo: async () => ({ Id: 'srv1', ServerName: 'NAS', Version: '12.1.0' }),
        getLibraries: async () => {
          server.calls.libraries += 1;
          return [{ id: 'lib1', name: 'Films', collectionType: 'movies' }];
        },
        countItems: async () => 3,
        getSessions: async () => {
          server.calls.sessions += 1;
          if (server.sessionsError) {
            throw server.sessionsError;
          }
          return server.sessions;
        },
        getMarkers: async () => [],
      });
      return monitor;
    },
    createSocket: (_api, handlers) => {
      const socket = { handlers, isOpen: false, start() {}, stop() {} };
      sockets.push(socket);
      return socket;
    },
  });
  t.after(() => app.stop());
  await gladys.connect();
  return { gladys, app, server, sockets };
}

test('no state depends on Gladys polling the devices (Gladys #3198)', async (t) => {
  const { gladys, server } = await start(t);
  const devices = gladys.fake.discoveredDevices;
  assert.equal(devices.length, 2, 'server + TV');
  for (const device of devices) {
    // 5.2.0 never polls these, and never polls a device already created
    // without should_poll: the integration must not need it.
    assert.equal(device.should_poll, false, device.name);
    assert.equal(device.poll_frequency, undefined, device.name);
  }
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });

  const playback = playerExternalIds(gladys, TV_KEY).feature(PLAYER_FEATURE.PLAYBACK_STATE);
  assert.equal(gladys.fake.lastState(playback), 1);

  // The own loop picks the pause up, without any onPoll call.
  server.sessions = [pausedTvSession()];
  await waitFor(() => gladys.fake.lastState(playback) === 0);

  // The onPoll fallback is harmless: an ack and a session refresh.
  const before = server.calls.sessions;
  assert.deepEqual(await gladys.fake.poll(devices[1]), { success: true });
  server.sessions = [tvSession()];
  await waitFor(() => server.calls.sessions > before && gladys.fake.lastState(playback) === 1);
});

test('a normal cycle writes nothing above debug, and never the API key', async (t) => {
  const logs = captureLogs(t);
  const { gladys, server, sockets } = await start(t);
  // Startup: lifecycle lines only, in info.
  assert.ok(logs.at('INFO').some((line) => line.includes('Connected to Jellyfin server "NAS"')));
  assert.deepEqual(logs.at('WARN'), []);
  assert.deepEqual(logs.at('ERROR'), []);
  logs.clear();

  // Pause, resume, stop, through the poll and through socket pushes; a
  // library change; several poll ticks.
  const playback = playerExternalIds(gladys, TV_KEY).feature(PLAYER_FEATURE.PLAYBACK_STATE);
  server.sessions = [pausedTvSession()];
  await waitFor(() => gladys.fake.lastState(playback) === 0);
  server.sessions = [tvSession()];
  sockets[0].handlers.onSessions(server.sessions);
  await waitFor(() => gladys.fake.lastState(playback) === 1);
  server.sessions = [idleTvSession()];
  sockets[0].handlers.onSessions(server.sessions);
  await waitFor(() => gladys.fake.sceneEvents.some((event) => event.key === 'playback_stopped'));
  sockets[0].handlers.onLibraryChanged();
  const polls = server.calls.sessions;
  await waitFor(() => server.calls.sessions >= polls + 3);

  assert.ok(gladys.fake.sceneEvents.length >= 3, 'scene events fired');
  assert.ok(logs.at('DEBUG').length > 0, 'the detail is still there in debug');
  assert.deepEqual(logs.loud(), [], 'nothing in info, warn or error');
  for (const line of logs.lines) {
    assert.ok(!line.includes(API_KEY), line);
  }
});

test('a server lost then back: one warning, one recovery line, not one per attempt', async (t) => {
  const logs = captureLogs(t);
  const { gladys, server } = await start(t);
  logs.clear();

  server.sessionsError = new Error('server unreachable at http://nas:8096 (ECONNREFUSED)');
  const calls = server.calls.sessions;
  await waitFor(() => server.calls.sessions >= calls + 5);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(logs.at('WARN').length, 1, logs.loud().join('\n'));
  assert.match(logs.at('WARN')[0], /Session refresh failed: server unreachable/);

  server.sessionsError = null;
  await waitFor(() => gladys.fake.connectionStatus.connected === true);
  await waitFor(() => logs.at('INFO').length === 1);
  assert.match(logs.at('INFO')[0], /Session refresh works again/);
  assert.equal(logs.at('WARN').length, 1);
  assert.deepEqual(logs.at('ERROR'), []);
  for (const line of logs.lines) {
    assert.ok(!line.includes(API_KEY), line);
  }
});

test('a server down at startup: one error, retries in debug, one line when reached', async (t) => {
  const logs = captureLogs(t);
  const { gladys, app, server } = await start(t, {
    detectError: new Error('server unreachable at http://nas:8096 (ECONNREFUSED)'),
  });
  await waitFor(() => server.calls.detect >= 4);
  assert.equal(app.monitor, null);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(logs.at('ERROR').length, 1, logs.loud().join('\n'));

  server.detectError = null;
  await waitFor(() => gladys.fake.connectionStatus.connected === true);
  assert.equal(logs.at('ERROR').length, 1);
  assert.equal(
    logs.at('INFO').filter((line) => line.includes('Connected to Jellyfin server')).length,
    1,
  );
});

test('a failed user action is logged once as a warning, without the API key', async (t) => {
  const logs = captureLogs(t);
  const { gladys } = await start(t);
  logs.clear();
  const device = gladys.fake.discoveredDevices[1];
  const feature = device.features.find((f) => !f.read_only);
  t.mock.method(MediaMonitor.prototype, 'handleSetValue', async () => {
    throw new Error('HTTP 500');
  });
  const ack = await gladys.fake.setValue(device, feature, 1);
  assert.equal(ack.success, false);
  assert.equal(logs.at('WARN').length, 1);
  assert.match(logs.at('WARN')[0], /Command .* failed: HTTP 500/);
  for (const line of logs.lines) {
    assert.ok(!line.includes(API_KEY), line);
  }
});

test('a new configuration that fails is logged again, not hidden in debug', async (t) => {
  const logs = captureLogs(t);
  const { gladys, server } = await start(t, { detectError: new Error('ECONNREFUSED') });
  await waitFor(() => server.calls.detect >= 3);
  assert.equal(logs.at('ERROR').length, 1, 'retries in debug');
  server.detectError = new Error('ENOTFOUND');
  await gladys.fake.configUpdated({ server_url: 'http://nsa:8096', api_key: API_KEY });
  await waitFor(() => logs.at('ERROR').length === 2);
  assert.match(logs.at('ERROR')[1], /ENOTFOUND/);
});
