import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { buildServerDevice, libraryFeatureKey, SERVER_FEATURE } from '../src/devices/server.js';
import {
  buildPlayerDevice,
  extractPlayerKey,
  playerFeatureKey,
  playerExternalIds,
  playerDeviceName,
  PLAYER_FEATURE,
} from '../src/devices/player.js';

const server = { kind: 'jellyfin', id: 'srv1', name: 'NAS' };
const libraries = [
  { id: 'aa11', name: 'Films', collectionType: 'movies' },
  { id: 'bb22', name: 'Séries', collectionType: 'tvshows' },
  { id: 'cc33', name: 'Musique', collectionType: 'music' },
  { id: '7', name: 'Vidéos perso', collectionType: 'homevideos' },
];
const player = {
  key: '0123456789abcdef',
  deviceName: 'Living room TV',
  client: 'Jellyfin Android TV',
};

// Columns of t_device_feature that are NOT NULL in the Gladys database: a
// missing one makes "Add to Gladys" fail with HTTP 422.
const REQUIRED_FEATURE_COLUMNS = [
  'name',
  'external_id',
  'category',
  'type',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
];

function assertValidDevice(device) {
  assert.ok(device.name);
  assert.ok(device.external_id);
  assert.equal(device.should_poll, false, 'every state is pushed: never polled by Gladys');
  assert.equal(device.poll_frequency, undefined);
  const ids = new Set();
  for (const feature of device.features) {
    for (const column of REQUIRED_FEATURE_COLUMNS) {
      assert.notEqual(feature[column], undefined, `${feature.external_id}: ${column} is required`);
      assert.notEqual(feature[column], null, `${feature.external_id}: ${column} is required`);
    }
    assert.ok(feature.external_id.startsWith(`${device.external_id}:`));
    assert.ok(!ids.has(feature.external_id), `duplicate ${feature.external_id}`);
    ids.add(feature.external_id);
  }
}

test('server device: activity sensors + one counter per library', () => {
  const gladys = createFakeGladys();
  const device = buildServerDevice(gladys, server, libraries, {
    library_sensors: true,
    language: 'fr',
  });
  assertValidDevice(device);
  assert.equal(device.name, 'Jellyfin - NAS');
  const keys = device.features.map((f) => f.external_id.split(':').pop());
  assert.deepEqual(keys, [
    SERVER_FEATURE.ACTIVE_STREAMS,
    SERVER_FEATURE.TRANSCODE_SESSIONS,
    SERVER_FEATURE.NOW_PLAYING,
    'library-aa11-count',
    'library-bb22-count',
    'library-bb22-episodes',
    'library-cc33-count',
    'library-cc33-tracks',
    'library-7-count',
  ]);
  const names = device.features.map((f) => f.name);
  assert.ok(names.includes('Séries (épisodes)'));
  assert.ok(names.includes('Musique (morceaux)'));
  assert.ok(names.includes('Lectures en cours'));
});

test('server device without library sensors, in English', () => {
  const gladys = createFakeGladys();
  const device = buildServerDevice(gladys, { ...server, kind: 'emby' }, libraries, {
    library_sensors: false,
    language: 'en',
  });
  assertValidDevice(device);
  assert.equal(device.name, 'Emby - NAS');
  assert.equal(device.features.length, 3);
  assert.equal(device.features[0].name, 'Active streams');
});

test('library feature keys are id-safe', () => {
  assert.equal(libraryFeatureKey({ id: 'AB-12_x' }, 'count'), 'library-ab12x-count');
});

test('player device: controls, sensors, localized names', () => {
  const gladys = createFakeGladys();
  const device = buildPlayerDevice(gladys, 'jellyfin', player, 'fr');
  assertValidDevice(device);
  assert.equal(device.name, 'Jellyfin - Living room TV (Jellyfin Android TV)');
  const byKey = Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
  assert.deepEqual(Object.keys(byKey).sort(), Object.values(PLAYER_FEATURE).sort());
  assert.equal(byKey.play.name, 'Lecture');
  assert.equal(byKey.volume.min, 0);
  assert.equal(byKey.volume.max, 100);
  assert.equal(byKey.volume.read_only, false);
  assert.equal(byKey['playback-state'].read_only, true);
  assert.equal(byKey.remaining.unit, 'minutes');
  assert.equal(buildPlayerDevice(gladys, 'jellyfin', player, 'en').features[0].name, 'Play');
});

test('player device name does not repeat the client', () => {
  assert.equal(
    playerDeviceName('emby', { deviceName: 'Emby Web', client: 'Emby Web' }),
    'Emby - Emby Web',
  );
  assert.equal(playerDeviceName('emby', { deviceName: 'Chrome', client: '' }), 'Emby - Chrome');
});

test('player ids round-trip', () => {
  const gladys = createFakeGladys();
  const ids = playerExternalIds(gladys, player.key);
  assert.equal(extractPlayerKey(ids.device), player.key);
  assert.equal(playerFeatureKey(ids.feature('pause'), ids), 'pause');
  assert.equal(playerFeatureKey('ext:jellyfin:server:srv1:now-playing', ids), null);
  assert.equal(extractPlayerKey('ext:jellyfin:server:srv1'), null);
  assert.equal(extractPlayerKey('ext:jellyfin:player:not-a-key'), null);
});
