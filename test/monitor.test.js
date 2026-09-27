import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { MediaMonitor, pickBestMatch, foldTitle } from '../src/monitor.js';
import { normalizeConfig } from '../src/config.js';
import { normalizeItem, playerKey } from '../src/media/sessions.js';
import { AuthError } from '../src/media/api.js';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  tvSession,
  idleTvSession,
  phoneEpisodeSession,
  dashboardSession,
  ownSession,
  TV_DEVICE_ID,
} from './fixtures/sessions.js';

const TV_KEY = playerKey(TV_DEVICE_ID);
const TV = `ext:jellyfin:player:${TV_KEY}`;

/**
 * A monitor whose API client is replaced by an in-memory fake: `calls`
 * records every remote-control request.
 */
function createMonitor({ sessions = [tvSession()], configOverrides = {} } = {}) {
  const gladys = createFakeGladys();
  const monitor = new MediaMonitor(
    gladys,
    normalizeConfig({ server_url: 'http://nas:8096', api_key: 'k', ...configOverrides }),
  );
  const calls = [];
  const fake = {
    sessions,
    libraries: [
      { id: 'lib1', name: 'Films', collectionType: 'movies' },
      { id: 'lib2', name: 'Séries', collectionType: 'tvshows' },
      { id: 'lib3', name: 'Photos', collectionType: 'photos' },
    ],
    counts: { Movie: 3, Series: 1, Episode: 12, files: 40 },
    markers: [],
    search: [],
    images: {},
  };
  Object.assign(monitor.api, {
    kind: 'jellyfin',
    detect: async () => ({ kind: 'jellyfin', id: 'srv1', name: 'NAS', version: '12.1.0' }),
    getSystemInfo: async () => ({ Id: 'srv1', ServerName: 'NAS', Version: '12.1.0' }),
    getLibraries: async () => fake.libraries,
    getSessions: async () => fake.sessions,
    countItems: async (_id, { types, isFolder }) =>
      isFolder === false ? fake.counts.files : fake.counts[types[0]],
    getMarkers: async () => fake.markers,
    searchItems: async (term, types) => {
      calls.push(['search', term, types]);
      return fake.search;
    },
    getLatestItems: async () => [],
    getImage: async (itemId, imageType, width) => {
      calls.push(['image', itemId, width, imageType]);
      return fake.images[width] ?? null;
    },
    sendPlaystate: async (sessionId, command) => calls.push(['playstate', sessionId, command]),
    sendGeneralCommand: async (sessionId, name, args) =>
      calls.push(['command', sessionId, name, args]),
    sendMessage: async (sessionId, message) => calls.push(['message', sessionId, message]),
    playItems: async (sessionId, ids, command) => calls.push(['play', sessionId, ids, command]),
  });
  return { gladys, monitor, calls, fake };
}

test('init: server identity, libraries, players from the sessions', async () => {
  const { monitor } = createMonitor({
    sessions: [tvSession(), phoneEpisodeSession(), dashboardSession(), ownSession()],
  });
  await monitor.init();
  assert.equal(monitor.server.id, 'srv1');
  assert.equal(monitor.label, 'Jellyfin');
  assert.equal(monitor.players.size, 2, 'dashboard and own session are not players');
  const devices = monitor.buildDevices();
  assert.equal(devices.length, 3);
  assert.equal(devices[0].name, 'Jellyfin - NAS');
});

test('init propagates a refused API key', async () => {
  const { monitor } = createMonitor();
  monitor.api.getSystemInfo = async () => {
    throw new AuthError('refused');
  };
  await assert.rejects(monitor.init(), AuthError);
});

test('playback states are published, then only what changes', async () => {
  const { gladys, monitor, fake } = createMonitor();
  await monitor.init();
  assert.equal(gladys.lastState(`${TV}:playback-state`), 1);
  assert.equal(gladys.lastState(`${TV}:remaining`), 8);
  assert.equal(gladys.lastState(`${TV}:volume`), 80);
  assert.equal(gladys.lastState(`${TV}:mute`), 0);
  assert.equal(gladys.lastText(`${TV}:now-playing`), 'Big Buck Bunny (2008)');
  assert.equal(gladys.lastState(':active-streams'), 1);
  assert.equal(
    gladys.lastText('server:srv1:now-playing'),
    'alice: Big Buck Bunny (2008) (Living room TV)',
  );

  gladys.reset();
  await monitor.refreshSessions();
  assert.equal(gladys.published.length, 0, 'identical snapshot -> nothing republished');
  assert.equal(gladys.textStates.length, 0);

  fake.sessions = [idleTvSession()];
  await monitor.refreshSessions();
  assert.equal(gladys.lastState(`${TV}:playback-state`), 0);
  assert.equal(gladys.lastState(`${TV}:remaining`), 0);
  assert.equal(gladys.lastText(`${TV}:now-playing`), 'Rien en lecture');
  assert.equal(gladys.lastState(':active-streams'), 0);
});

test('a player that disconnects is published idle', async () => {
  const { gladys, monitor, fake } = createMonitor();
  await monitor.init();
  fake.sessions = [];
  await monitor.refreshSessions();
  assert.equal(gladys.lastState(`${TV}:playback-state`), 0);
  assert.equal(monitor.players.size, 1, 'a known player stays known');
});

test('the first snapshot is a baseline, the next ones fire scene events', async () => {
  const { gladys, monitor, fake } = createMonitor();
  await monitor.init();
  assert.equal(gladys.sceneEvents.length, 0, 'no replay of what was already playing');

  fake.sessions = [tvSession({ PlayState: { PositionTicks: 1_300_000_000, IsPaused: true } })];
  await monitor.refreshSessions();
  fake.sessions = [];
  await monitor.refreshSessions();

  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.key),
    ['playback_paused', 'playback_stopped'],
  );
  const stopped = gladys.sceneEvents[1].data;
  assert.equal(stopped.player, TV);
  assert.equal(stopped.media_type, 'movie');
  assert.equal(stopped.title, 'Big Buck Bunny (2008)', 'a stop describes what was playing');
  assert.equal(stopped.player_name, 'Jellyfin - Living room TV (Jellyfin Android TV)');
  assert.ok(gladys.widgetRefreshes.includes('now_playing'));
});

test('concurrent pushes are processed one at a time (no duplicate events)', async () => {
  const { gladys, monitor } = createMonitor({ sessions: [] });
  await monitor.init();
  const playing = [tvSession()];
  await Promise.all([monitor.applySessions(playing), monitor.applySessions(playing)]);
  assert.deepEqual(
    gladys.sceneEvents.map((e) => e.key),
    ['playback_started'],
  );
});

test('a new player is reported so the caller republishes the devices', async () => {
  const { monitor } = createMonitor({ sessions: [] });
  await monitor.init();
  assert.equal(await monitor.applySessions([phoneEpisodeSession()]), true);
  assert.equal(await monitor.applySessions([phoneEpisodeSession()]), false);
});

test('commands: playstate, volume, mute toggle from the reported state', async () => {
  const { gladys, monitor, calls } = createMonitor();
  await monitor.init();
  const device = { external_id: TV };
  const feature = (key) => ({ external_id: `${TV}:${key}` });

  await monitor.handleSetValue(device, feature('pause'), 1);
  await monitor.handleSetValue(device, feature('play'), 1);
  await monitor.handleSetValue(device, feature('stop'), 1);
  await monitor.handleSetValue(device, feature('next'), 1);
  await monitor.handleSetValue(device, feature('previous'), 1);
  await monitor.handleSetValue(device, feature('forward'), 1);
  await monitor.handleSetValue(device, feature('rewind'), 1);
  await monitor.handleSetValue(device, feature('volume'), 142);
  await monitor.handleSetValue(device, feature('mute'), 1);
  monitor.stop();

  assert.deepEqual(calls, [
    ['playstate', 'session-tv-1', 'Pause'],
    ['playstate', 'session-tv-1', 'Unpause'],
    ['playstate', 'session-tv-1', 'Stop'],
    ['playstate', 'session-tv-1', 'NextTrack'],
    ['playstate', 'session-tv-1', 'PreviousTrack'],
    ['playstate', 'session-tv-1', 'FastForward'],
    ['playstate', 'session-tv-1', 'Rewind'],
    ['command', 'session-tv-1', 'SetVolume', { Volume: '100' }],
    ['command', 'session-tv-1', 'Mute', undefined],
  ]);
  assert.equal(gladys.lastState(`${TV}:volume`), 100);
  assert.equal(gladys.lastState(`${TV}:mute`), 1);
});

test('mute unmutes a muted player', async () => {
  const { monitor, calls } = createMonitor({
    sessions: [tvSession({ PlayState: { IsMuted: true, IsPaused: false, VolumeLevel: 10 } })],
  });
  await monitor.init();
  await monitor.handleSetValue({ external_id: TV }, { external_id: `${TV}:mute` }, 1);
  monitor.stop();
  assert.deepEqual(calls[0], ['command', 'session-tv-1', 'Unmute', undefined]);
});

test('a command to a disconnected player explains what to do', async () => {
  const { monitor, fake } = createMonitor();
  await monitor.init();
  fake.sessions = [];
  await monitor.refreshSessions();
  await assert.rejects(
    monitor.handleSetValue({ external_id: TV }, { external_id: `${TV}:pause` }, 1),
    /Living room TV is not connected to the Jellyfin server right now/,
  );
  await assert.rejects(
    monitor.handleSetValue({ external_id: 'ext:jellyfin:server:srv1' }, { external_id: 'x' }, 1),
    /Not a player device/,
  );
});

test('display_message: defaults, bounds, unsupported players', async () => {
  const { monitor, calls, fake } = createMonitor();
  await monitor.init();
  await monitor.displayMessage({ player: TV, text: ' Ding dong ', header: '', duration: 999 });
  assert.deepEqual(calls[0], [
    'message',
    'session-tv-1',
    { header: 'Gladys', text: 'Ding dong', timeoutMs: 300_000 },
  ]);

  fake.sessions = [tvSession({ SupportedCommands: ['SetVolume'] })];
  await monitor.refreshSessions();
  await assert.rejects(
    monitor.displayMessage({ player: TV, text: 'x' }),
    /cannot display messages/,
  );
});

test('play_media: best match, shuffle, not found', async () => {
  const { monitor, calls, fake } = createMonitor();
  await monitor.init();
  fake.search = [
    { Id: 'a1', Name: 'Tears of Steel (Soundtrack)', Type: 'MusicAlbum' },
    { Id: 'm1', Name: 'Tears of Steel', Type: 'Movie', ProductionYear: 2012 },
  ];
  const result = await monitor.playMedia({ player: TV, query: 'tears of steel', shuffle: 'true' });
  monitor.stop();
  assert.deepEqual(result, { title: 'Tears of Steel (2012)' });
  assert.deepEqual(calls.at(-1), ['play', 'session-tv-1', ['m1'], 'PlayShuffle']);
  assert.equal(calls[0][1], 'tears of steel');

  await monitor.playMedia({ player: TV, query: 'x', media_type: 'album' });
  monitor.stop();
  assert.deepEqual(calls.at(-2)[2], ['MusicAlbum']);

  fake.search = [];
  await assert.rejects(monitor.playMedia({ player: TV, query: 'nope' }), /Nothing named "nope"/);
  await assert.rejects(monitor.playMedia({ player: TV, query: '  ' }), /Nothing to search/);
});

test('pickBestMatch: exact title, then prefix, then type order, then first result', () => {
  const items = [
    { id: '1', name: 'Amélie extras', type: 'Movie' },
    { id: '2', name: 'Amelie', type: 'Audio' },
    { id: '3', name: 'Amélie', type: 'Movie' },
  ];
  const types = ['Movie', 'Audio'];
  assert.equal(pickBestMatch(items, 'amelie', types).id, '3');
  assert.equal(pickBestMatch(items, 'amélie ext', types).id, '1');
  assert.equal(pickBestMatch(items, 'zzz', types).id, '1');
  assert.equal(pickBestMatch([], 'x', types), null);
  assert.equal(foldTitle("L'Été  meurtrier!"), 'l ete meurtrier');
});

test('library counters per library kind', async () => {
  const { gladys, monitor } = createMonitor();
  await monitor.init();
  await monitor.refreshLibraries();
  assert.equal(gladys.lastState('library-lib1-count'), 3);
  assert.equal(gladys.lastState('library-lib2-count'), 1);
  assert.equal(gladys.lastState('library-lib2-episodes'), 12);
  assert.equal(gladys.lastState('library-lib3-count'), 40);
});

test('intro/credits markers follow the play position', async () => {
  const { gladys, monitor, fake } = createMonitor({ sessions: [] });
  fake.markers = [
    { type: 'intro', start: 0, end: 300_000_000 },
    { type: 'credits', start: 5_000_000_000, end: 6_000_000_000 },
  ];
  await monitor.init();
  await monitor.applySessions([tvSession({ PlayState: { PositionTicks: 100_000_000 } })]);
  assert.equal(gladys.lastState(`${TV}:intro`), 1);
  assert.equal(gladys.lastState(`${TV}:credits`), 0);
  await monitor.applySessions([tvSession({ PlayState: { PositionTicks: 5_500_000_000 } })]);
  assert.equal(gladys.lastState(`${TV}:intro`), 0);
  assert.equal(gladys.lastState(`${TV}:credits`), 1);
});

test('a device created in Gladys gets its states again', async () => {
  const { gladys, monitor } = createMonitor();
  await monitor.init();
  gladys.reset();
  monitor.resetPublicationCache(TV);
  await monitor.refreshSessions();
  assert.equal(gladys.lastState(`${TV}:playback-state`), 1);
  assert.equal(gladys.lastState(':active-streams'), undefined, 'other devices untouched');
});

test('widget images: registered keys only, shrunk until they fit', async () => {
  const { monitor, calls, fake } = createMonitor();
  await monitor.init();
  const content = monitor.nowPlayingContent('fr');
  const key = content.components.find((c) => c.type === 'card-list').items[0].image;
  fake.images = { 300: Buffer.alloc(400 * 1024, 1), 210: Buffer.from([0xff, 0xd8, 0xff]) };
  const b64 = await monitor.widgetImage(key);
  assert.deepEqual([...Buffer.from(b64, 'base64')], [0xff, 0xd8, 0xff]);
  assert.deepEqual(
    calls.filter((c) => c[0] === 'image').map((c) => [c[2], c[3]]),
    [
      [300, 'Primary'],
      [210, 'Primary'],
    ],
  );
  await assert.rejects(monitor.widgetImage('poster-unknown-x'), /Unknown image/);
});

test('player widget: the chosen player as a remote', async () => {
  const { monitor } = createMonitor();
  await monitor.init();
  const content = monitor.playerContent('fr', TV);
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Big Buck Bunny');
  const pause = content.components.find((c) => c.type === 'button' && c.icon === 'pause');
  assert.equal(pause.device_feature, `${TV}:pause`);
  const image = content.components.find((c) => c.type === 'image');
  assert.match(image.key, /^poster-/);
  assert.equal(image.fit, 'contain', 'a portrait poster is shown whole');
  const status = content.components.find((c) => c.type === 'status');
  assert.ok(!status.items.some((i) => i.label === 'Lecteur'), 'the player is known: no row');

  monitor.sessions.clear();
  const offline = monitor.playerContent('fr', TV);
  assert.equal(offline.components[1].text, "Ce lecteur n'est pas connecté au serveur.");
});

test('player widget without a player (or with the server): follows the playback', async () => {
  const { monitor } = createMonitor({
    sessions: [phoneEpisodeSession(), tvSession()],
  });
  await monitor.init();
  for (const setting of [undefined, '', 'ext:jellyfin:server:srv1']) {
    const content = monitor.playerContent('fr', setting);
    assert.deepEqual(validateWidgetContent(content), []);
    // The paused phone comes first, but a playing session wins.
    assert.equal(content.components[0].text, 'Big Buck Bunny');
    const status = content.components.find((c) => c.type === 'status');
    assert.deepEqual(status.items.at(-1), { label: 'Lecteur', value: 'Living room TV' });
    const pause = content.components.find((c) => c.type === 'button' && c.icon === 'pause');
    assert.equal(pause.device_feature, `${TV}:pause`);
  }
  monitor.sessions.clear();
  const idle = monitor.playerContent('fr', undefined);
  assert.deepEqual(idle.components, [
    { type: 'text', variant: 'body', text: "Rien n'est en cours de lecture." },
  ]);
});

test('player widget: a player created in Gladys but not seen yet keeps its name', async () => {
  const { gladys, monitor } = createMonitor({ sessions: [] });
  const bedroom = 'ext:jellyfin:player:0123456789abcdef';
  gladys.devices = [{ external_id: bedroom, name: 'Jellyfin - Chambre' }];
  await monitor.init();
  const content = monitor.playerContent('fr', bedroom);
  assert.equal(content.components[0].text, 'Jellyfin - Chambre');
  assert.equal(content.components[1].text, "Ce lecteur n'est pas connecté au serveur.");
});

test('normalizeItem tolerates partial items', () => {
  assert.equal(normalizeItem({ Id: 5 }).id, '5');
  assert.equal(normalizeItem({}), null);
});
