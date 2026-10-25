// -----------------------------------------------------------------------------
// The Gladys 5.3 music player: the features of a player, its "now playing"
// published through publishNowPlaying, the writable music features, and the
// music panel (browse, search, play, artwork) — the whole integration against
// the fake Gladys of the SDK, the media server replaced by an in-memory
// library trimmed from Jellyfin 12.2 answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { artworkKey, validateMediaItems } from '@gladysassistant/integration-sdk';
import { createApp } from '../src/app.js';
import { MediaMonitor } from '../src/monitor.js';
import { normalizeItem, normalizeSession, playerKey } from '../src/media/sessions.js';
import { nowPlayingOf, playerExternalIds } from '../src/devices/player.js';
import { ROOTS, MAX_PLAY_ITEMS, parseMediaId } from '../src/catalog.js';
import {
  tvSession,
  idleTvSession,
  phoneEpisodeSession,
  webMusicSession,
  WEB_DEVICE_ID,
  TV_DEVICE_ID,
} from './fixtures/sessions.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const WEB = `ext:test-integration:player:${playerKey(WEB_DEVICE_ID)}`;
const TV = `ext:test-integration:player:${playerKey(TV_DEVICE_ID)}`;
const USER = '8a5a9bd4ba2a40f197c74f8ba411b90e';

// A small library: one album of two tracks, its artist, a playlist.
const ALBUM = {
  Id: '2db65fbcc73067a649fdb580d543a502',
  Name: 'Pastel Noise',
  Type: 'MusicAlbum',
  AlbumArtist: 'Nina Pulse',
  ImageTags: { Primary: 'c04940b9d225b1e3f865790c837205b7' },
};
const track = (id, name) => ({
  Id: id,
  Name: name,
  Type: 'Audio',
  RunTimeTicks: 400_000_000,
  Artists: ['Nina Pulse'],
  AlbumArtist: 'Nina Pulse',
  AlbumId: ALBUM.Id,
  AlbumPrimaryImageTag: ALBUM.ImageTags.Primary,
  ImageTags: {},
});
const TRACKS = [
  track('6a96a19ae4de2882eff18700da6bdb34', 'Feeling Good'),
  track('3717c5c77ec2fb7142f6ed2d29268792', 'Sinnerman'),
];
const ARTIST = { Id: '6d72f864fd67376b3b3dbb222294202b', Name: 'Nina Pulse', Type: 'MusicArtist' };
const PLAYLIST = { Id: '58b0a3c9770f0847f7ef17b78702bdf8', Name: 'Evening Mix', Type: 'Playlist' };

/**
 * Start the integration on a fake Gladys, with a fake media server.
 * @param {import('node:test').TestContext} t
 * @param {{ sessions?: object[] }} [options]
 */
async function start(t, { sessions = [webMusicSession(), tvSession()] } = {}) {
  const server = { sessions, calls: [], queries: [], images: {} };
  const gladys = createFakeGladys({
    config: { server_url: 'http://nas:8096', api_key: 'k', language: 'fr' },
  });
  const app = createApp(gladys, {
    version: '1.0.0',
    pollTickMs: 60_000,
    pollWithSocketMs: 60_000,
    createMonitor: (config) => {
      const monitor = new MediaMonitor(gladys, config, { version: '1.0.0' });
      Object.assign(monitor.api, {
        kind: 'jellyfin',
        detect: async () => ({ kind: 'jellyfin', id: 'srv1', name: 'NAS', version: '12.2.0' }),
        getSystemInfo: async () => ({ Id: 'srv1', ServerName: 'NAS', Version: '12.2.0' }),
        getLibraries: async () => [{ id: 'lib1', name: 'Music', collectionType: 'music' }],
        countItems: async () => 3,
        getSessions: async () => server.sessions,
        getMarkers: async () => [],
        getAdminUserId: async () => 'admin-user',
        queryItems: async (query, path = '/Items') => {
          server.queries.push({ path, ...query });
          if (path === '/Artists/AlbumArtists') {
            return { items: [ARTIST], total: 1 };
          }
          if (query.searchTerm) {
            return { items: [TRACKS[1], ALBUM, ARTIST], total: 3 };
          }
          if (query.IncludeItemTypes === 'MusicAlbum') {
            return { items: [ALBUM], total: 1 };
          }
          if (query.IncludeItemTypes === 'Playlist') {
            return { items: [PLAYLIST], total: 1 };
          }
          if (query.ParentId === PLAYLIST.Id) {
            return { items: [TRACKS[1], { Id: 'x1', Name: 'A film', Type: 'Movie' }], total: 2 };
          }
          return { items: TRACKS, total: TRACKS.length };
        },
        getImage: async (itemId, type, width, height) => {
          server.calls.push(['image', itemId, width, height]);
          return server.images[width] ?? Buffer.from('jpeg');
        },
        sendPlaystate: async (sessionId, command, query) =>
          server.calls.push(['playstate', sessionId, command, query]),
        sendGeneralCommand: async (sessionId, name, args) =>
          server.calls.push(['command', sessionId, name, args]),
        playItems: async (sessionId, ids, command) =>
          server.calls.push(['play', sessionId, ids, command]),
      });
      return monitor;
    },
    createSocket: (_api, handlers) => ({ handlers, isOpen: false, start() {}, stop() {} }),
  });
  t.after(() => app.stop());
  await gladys.connect();
  const device = (externalId) =>
    gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  return { gladys, server, device };
}

test('manifest: the music panel without the queue, append, Gladys 5.3', () => {
  assert.deepEqual(manifest.music, { browse: true, search: true, queue: false, append: true });
  assert.match(manifest.gladys_version, />=\s*5\.3\.0/);
});

test('now playing of a track: one batch, the pre-5.3 ids kept', async (t) => {
  const { gladys } = await start(t);
  const last = (key) => gladys.fake.lastState(`${WEB}:${key}`);
  assert.equal(last('playback-state'), 1, 'the playback state keeps its id');
  assert.equal(gladys.fake.lastState(`${WEB}:playback_state`), undefined);
  assert.equal(last('title'), 'Feeling Good');
  assert.equal(last('artist'), 'Nina Pulse');
  assert.equal(last('album'), 'Pastel Noise');
  assert.equal(last('duration'), 40);
  assert.equal(last('position'), 3);
  assert.equal(last('shuffle'), 0);
  assert.equal(last('repeat'), 0);
  assert.equal(last('volume'), 100);
  assert.equal(last('mute'), 1);
  // The album cover, at the size of the player frame, behind a key.
  const url =
    'http://nas:8096/Items/2db65fbcc73067a649fdb580d543a502/Images/Primary' +
    '?tag=c04940b9d225b1e3f865790c837205b7&maxWidth=400&maxHeight=400';
  assert.equal(last('artwork'), artworkKey(url));
  // Every music state of the player in one POST /state.
  const batch = gladys.fake
    .bodies('POST', '/state')
    .find((body) => body.states.some((s) => s.device_feature_external_id === `${WEB}:title`));
  const types = batch.states.map((s) => s.device_feature_external_id.split(':').pop()).sort();
  assert.deepEqual(types, [
    'album',
    'artist',
    'artwork',
    'duration',
    'mute',
    'playback-state',
    'position',
    'repeat',
    'shuffle',
    'title',
    'volume',
  ]);
});

test('now playing of a movie, an episode, nothing', () => {
  const url = () => 'http://nas/art';
  const movie = nowPlayingOf(normalizeSession(tvSession()), url);
  assert.deepEqual(
    [movie.title, movie.artist, movie.album, movie.duration, movie.position],
    ['Big Buck Bunny', '', '', 600, 120],
  );
  assert.equal(movie.shuffle, undefined, 'not reported by the app: not published');
  const episode = nowPlayingOf(
    normalizeSession(
      phoneEpisodeSession({
        NowPlayingItem: { ...phoneEpisodeSession().NowPlayingItem, SeasonName: 'Season 1' },
      }),
    ),
    url,
  );
  assert.deepEqual(
    [episode.title, episode.artist, episode.album],
    ['Earthfall', 'Pioneer One', 'Season 1'],
  );
  const idle = nowPlayingOf(normalizeSession(idleTvSession()), url);
  assert.deepEqual(idle, {
    playback_state: 2,
    title: '',
    artist: '',
    album: '',
    artwork_url: null,
    duration: 0,
    position: 0,
    volume: 80,
    mute: 0,
  });
  assert.equal(nowPlayingOf(null, url).playback_state, 2);
  const paused = normalizeSession(
    webMusicSession({
      PlayState: { ...webMusicSession().PlayState, IsPaused: true, RepeatMode: 'RepeatOne' },
    }),
  );
  assert.deepEqual(
    [nowPlayingOf(paused, url).playback_state, nowPlayingOf(paused, url).repeat],
    [0, 2],
  );
  const shuffled = webMusicSession({
    PlayState: { ...webMusicSession().PlayState, PlaybackOrder: 'Shuffle' },
  });
  assert.equal(nowPlayingOf(normalizeSession(shuffled), url).shuffle, 1);
  const emby = webMusicSession({ PlayState: { ShuffleMode: 'Shuffle', RepeatMode: 'RepeatAll' } });
  assert.deepEqual(
    [
      nowPlayingOf(normalizeSession(emby), url).shuffle,
      nowPlayingOf(normalizeSession(emby), url).repeat,
    ],
    [1, 1],
  );
  assert.equal(normalizeItem({ Id: 'a', Name: 'x', SeasonName: 'S1' }).seasonName, 'S1');
});

test('the writable music features drive the session', async (t) => {
  const { gladys, server } = await start(t);
  const web = gladys.fake.discoveredDevices.find((d) => d.external_id === WEB);
  const feature = (key) => web.features.find((f) => f.external_id === `${WEB}:${key}`);
  const set = (key, value) => gladys.fake.setValue(web, feature(key), value);
  const ok = { success: true };

  assert.deepEqual(await set('playback-state', 0), ok);
  assert.deepEqual(await set('playback-state', 1), ok);
  assert.deepEqual(await set('playback-state', 2), ok);
  assert.deepEqual(await set('position', 25), ok);
  assert.deepEqual(await set('shuffle', 1), ok);
  assert.deepEqual(await set('shuffle', 0), ok);
  assert.deepEqual(await set('repeat', 1), ok);
  assert.deepEqual(await set('repeat', 2), ok);
  assert.deepEqual(await set('repeat', 0), ok);
  assert.deepEqual(await set('mute', 0), ok);
  const session = 'c563a9ad26baf4ad7f14203b5a89951f';
  assert.deepEqual(server.calls, [
    ['playstate', session, 'Pause', undefined],
    ['playstate', session, 'Unpause', undefined],
    ['playstate', session, 'Stop', undefined],
    ['playstate', session, 'Seek', { SeekPositionTicks: 250_000_000 }],
    ['command', session, 'SetShuffleQueue', { ShuffleMode: 'Shuffle' }],
    ['command', session, 'SetShuffleQueue', { ShuffleMode: 'Sorted' }],
    ['command', session, 'SetRepeatMode', { RepeatMode: 'RepeatAll' }],
    ['command', session, 'SetRepeatMode', { RepeatMode: 'RepeatOne' }],
    ['command', session, 'SetRepeatMode', { RepeatMode: 'RepeatNone' }],
    ['command', session, 'Unmute', undefined],
  ]);

  const refused = await set('playback-state', 3);
  assert.equal(refused.success, false);
  assert.match(refused.error, /n'est pas acceptée/);
});

test('refused, with a reason: nothing loaded, no seek, an app without shuffle', async (t) => {
  const { gladys, server } = await start(t, {
    sessions: [
      idleTvSession({ SupportedCommands: ['SetVolume'] }),
      webMusicSession({ PlayState: { ...webMusicSession().PlayState, CanSeek: false } }),
    ],
  });
  const devices = gladys.fake.discoveredDevices;
  const set = (externalId, key, value) => {
    const device = devices.find((d) => d.external_id === externalId);
    const feature = device.features.find((f) => f.external_id === `${externalId}:${key}`);
    return gladys.fake.setValue(device, feature, value);
  };
  assert.match((await set(TV, 'playback-state', 1)).error, /Rien n'est chargé sur Living room TV/);
  assert.match((await set(TV, 'position', 10)).error, /Rien n'est chargé/);
  assert.match((await set(TV, 'shuffle', 1)).error, /n'accepte pas l'aléatoire/);
  assert.match((await set(TV, 'repeat', 1)).error, /n'accepte pas la répétition/);
  assert.match((await set(WEB, 'position', 10)).error, /ne peut pas se déplacer/);
  assert.deepEqual(server.calls, [], 'nothing sent to the server');
});

test('a player updated in Discover gets everything again', async (t) => {
  const { gladys, device } = await start(t);
  const count = () =>
    gladys.fake.states.filter((s) => s.device_feature_external_id === `${WEB}:title`).length;
  assert.equal(count(), 1);
  await gladys.fake.deviceUpdated(device(WEB));
  const deadline = Date.now() + 2000;
  while (count() < 2 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(count(), 2, 'the title is published again after the update');
});

test('browse: the root folders, the library, rows never dropped', async (t) => {
  const { gladys, server, device } = await start(t);
  const browse = async (parentId, offset = 0, limit = 50) => {
    const ack = await gladys.fake.musicBrowse(device(WEB), { parentId, offset, limit });
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(validateMediaItems(ack.data.items).dropped ?? [], []);
    return ack.data;
  };

  const root = await browse(null);
  assert.deepEqual(
    root.items.map((item) => [item.id, item.title, item.type, item.browsable, item.playable]),
    [
      [ROOTS.albums, 'Albums', 'folder', true, false],
      [ROOTS.artists, 'Artistes', 'folder', true, false],
      [ROOTS.playlists, 'Listes de lecture', 'folder', true, false],
    ],
  );
  assert.equal(root.total, 3);
  assert.deepEqual((await browse(null, 1, 1)).items.length, 1);

  const albums = await browse(ROOTS.albums, 0, 20);
  assert.deepEqual(albums.items[0], {
    id: `album:${ALBUM.Id}`,
    type: 'album',
    title: 'Pastel Noise',
    subtitle: 'Nina Pulse',
    duration: null,
    artwork_key: artworkKey(
      `http://nas:8096/Items/${ALBUM.Id}/Images/Primary?tag=${ALBUM.ImageTags.Primary}&maxWidth=128&maxHeight=128`,
    ),
    browsable: true,
    playable: true,
  });
  // Read as the user signed in on the player, one page.
  assert.deepEqual(
    [server.queries.at(-1).UserId, server.queries.at(-1).StartIndex, server.queries.at(-1).Limit],
    [USER, 0, 20],
  );

  const tracks = await browse(`album:${ALBUM.Id}`);
  assert.deepEqual(
    tracks.items.map((item) => [
      item.id,
      item.type,
      item.subtitle,
      item.duration,
      item.playable,
      item.browsable,
    ]),
    [
      [`track:${TRACKS[0].Id}`, 'track', 'Nina Pulse', 40, true, false],
      [`track:${TRACKS[1].Id}`, 'track', 'Nina Pulse', 40, true, false],
    ],
  );
  assert.equal(server.queries.at(-1).ParentId, ALBUM.Id);

  const artists = await browse(ROOTS.artists);
  assert.equal(artists.items[0].id, `artist:${ARTIST.Id}`);
  assert.equal(server.queries.at(-1).path, '/Artists/AlbumArtists');
  await browse(`artist:${ARTIST.Id}`);
  assert.equal(server.queries.at(-1).ArtistIds, ARTIST.Id);

  const playlists = await browse(ROOTS.playlists);
  assert.equal(playlists.items[0].id, `playlist:${PLAYLIST.Id}`);
  const items = await browse(`playlist:${PLAYLIST.Id}`);
  assert.equal(items.items.length, 2, 'a movie in a playlist stays as a neutral row');
  assert.deepEqual([items.items[1].playable, items.items[1].browsable], [false, false]);

  const leaf = await gladys.fake.musicBrowse(device(WEB), { parentId: `track:${TRACKS[0].Id}` });
  assert.equal(leaf.success, false);
});

test('browse an offline player: read as the first administrator', async (t) => {
  const { gladys, server, device } = await start(t, { sessions: [tvSession()] });
  const tv = device(TV);
  server.sessions = [];
  await gladys.fake.musicBrowse(tv, { parentId: ROOTS.playlists });
  assert.equal(server.queries.at(-1).UserId, 'admin-user');
  const server_ = gladys.fake.discoveredDevices.find((d) => !d.external_id.includes(':player:'));
  assert.equal((await gladys.fake.musicBrowse(server_, {})).success, false, 'not a player');
});

test('search: by name, filtered by type', async (t) => {
  const { gladys, server, device } = await start(t);
  const ack = await gladys.fake.musicSearch(device(WEB), { query: 'sinner', limit: 10 });
  assert.equal(ack.success, true);
  assert.deepEqual(
    ack.data.items.map((item) => item.type),
    ['track', 'album', 'artist'],
  );
  assert.deepEqual(validateMediaItems(ack.data.items).dropped ?? [], []);
  assert.deepEqual(
    [
      server.queries.at(-1).searchTerm,
      server.queries.at(-1).IncludeItemTypes,
      server.queries.at(-1).Limit,
    ],
    ['sinner', 'Audio,MusicAlbum,MusicArtist,Playlist', 10],
  );
  await gladys.fake.musicSearch(device(WEB), { query: 'x', type: 'album' });
  assert.equal(server.queries.at(-1).IncludeItemTypes, 'MusicAlbum');
  const radios = await gladys.fake.musicSearch(device(WEB), { query: 'x', type: 'radio' });
  assert.deepEqual(radios.data, { items: [] });
});

test('play: a track, a container expanded into its tracks, now / next / at the end', async (t) => {
  const { gladys, server, device } = await start(t);
  const play = (id, mode) => gladys.fake.musicPlay(device(WEB), { id, type: 'album' }, mode);
  const session = 'c563a9ad26baf4ad7f14203b5a89951f';

  assert.equal((await play(`track:${TRACKS[0].Id}`, 'replace')).success, true);
  assert.equal((await play(`album:${ALBUM.Id}`, 'next')).success, true);
  assert.equal((await play(`playlist:${PLAYLIST.Id}`, 'append')).success, true);
  assert.deepEqual(
    server.calls.filter((call) => call[0] === 'play'),
    [
      ['play', session, [TRACKS[0].Id], 'PlayNow'],
      ['play', session, TRACKS.map((tr) => tr.Id), 'PlayNext'],
      ['play', session, [TRACKS[1].Id, 'x1'], 'PlayLast'],
    ],
  );
  assert.equal(server.queries.at(-1).Limit, MAX_PLAY_ITEMS);
  assert.equal(server.queries.at(-1).IncludeItemTypes, 'Audio');
  await play(`artist:${ARTIST.Id}`, 'replace');
  assert.equal(server.queries.at(-1).ArtistIds, ARTIST.Id);

  assert.match((await play(ROOTS.albums, 'replace')).error, /Ouvrez ce dossier/);
  assert.match((await play('spotify:track:1', 'replace')).error, /Ouvrez ce dossier/);
});

test('play: a player that is offline or not remote-controllable is refused', async (t) => {
  const { gladys, server, device } = await start(t, {
    sessions: [webMusicSession({ SupportsRemoteControl: false }), tvSession()],
  });
  const media = { id: `track:${TRACKS[0].Id}`, type: 'track' };
  assert.match(
    (await gladys.fake.musicPlay(device(WEB), media)).error,
    /ne se pilote pas à distance/,
  );
  server.sessions = [];
  const tv = device(TV);
  await gladys.fake.scanRequest();
  assert.match((await gladys.fake.musicPlay(tv, media)).error, /not connected/);
  assert.equal(server.calls.filter((call) => call[0] === 'play').length, 0);
});

test('artwork: served with the API key, resized by the server, shrunk until it fits', async (t) => {
  const { gladys, server } = await start(t);
  const key = gladys.fake.lastState(`${WEB}:artwork`);
  const ack = await gladys.fake.musicGetArtwork(key);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.calls.at(-1), ['image', ALBUM.Id, 400, 400]);

  server.images[400] = Buffer.alloc(400 * 1024);
  await gladys.fake.musicGetArtwork(key);
  assert.deepEqual(server.calls.at(-1), ['image', ALBUM.Id, 280, 280]);

  const unknown = await gladys.fake.musicGetArtwork('art-000000000000');
  assert.equal(unknown.success, false);
});

test('media ids: parsed, anything else refused', () => {
  assert.deepEqual(parseMediaId('album:9a8e'), { kind: 'album', itemId: '9a8e' });
  assert.deepEqual(parseMediaId('track:12345'), { kind: 'track', itemId: '12345' }, 'Emby ids');
  assert.equal(parseMediaId('gladys:albums'), null);
  assert.equal(parseMediaId('album:../x'), null);
  assert.equal(parseMediaId(undefined), null);
  assert.equal(playerExternalIds(createFakeGladys(), 'k').device.includes(':player:'), true);
});
