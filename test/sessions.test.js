import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSession,
  isPlayerSession,
  mediaCategory,
  formatTitle,
  remainingMinutes,
  isInMarker,
  buildActivitySummary,
  playerKey,
  MEDIA_TYPE,
  MAX_TEXT_LENGTH,
} from '../src/media/sessions.js';
import {
  tvSession,
  idleTvSession,
  phoneEpisodeSession,
  dashboardSession,
  ownSession,
  TV_DEVICE_ID,
} from './fixtures/sessions.js';

test('normalizeSession keeps what the integration needs', () => {
  const session = normalizeSession(tvSession());
  assert.equal(session.sessionId, 'session-tv-1');
  assert.equal(session.deviceId, TV_DEVICE_ID);
  assert.equal(session.key, playerKey(TV_DEVICE_ID));
  assert.equal(session.state, 'playing');
  assert.equal(session.volume, 80);
  assert.equal(session.muted, false);
  assert.equal(session.transcoding, false);
  assert.equal(session.controllable, true);
  assert.equal(session.item.name, 'Big Buck Bunny');
});

test('the player key is stable, id-safe and hides the raw DeviceId', () => {
  const key = playerKey(TV_DEVICE_ID);
  assert.match(key, /^[0-9a-f]{16}$/);
  assert.equal(playerKey(TV_DEVICE_ID), key);
  assert.notEqual(playerKey('another-device'), key);
});

test('paused, idle and transcoding sessions', () => {
  assert.equal(normalizeSession(phoneEpisodeSession()).state, 'paused');
  assert.equal(normalizeSession(phoneEpisodeSession()).transcoding, true);
  const idle = normalizeSession(idleTvSession());
  assert.equal(idle.state, 'idle');
  assert.equal(idle.item, null);
});

test('a session without volume reports null, not 0', () => {
  assert.equal(normalizeSession(phoneEpisodeSession()).volume, null);
});

test('the integration own session and incomplete sessions are dropped', () => {
  assert.equal(normalizeSession(ownSession()), null);
  assert.equal(normalizeSession({ Id: 'x' }), null);
  assert.equal(normalizeSession(null), null);
});

test('players: controllable apps (even idle) and anything playing', () => {
  assert.ok(isPlayerSession(normalizeSession(tvSession())));
  assert.ok(isPlayerSession(normalizeSession(idleTvSession())));
  assert.ok(isPlayerSession(normalizeSession(phoneEpisodeSession())));
  assert.ok(!isPlayerSession(normalizeSession(dashboardSession())));
  assert.ok(!isPlayerSession(null));
});

test('mediaCategory maps the item types to the scene filter values', () => {
  const cat = (Type, MediaType) => mediaCategory({ type: Type, mediaType: MediaType });
  assert.equal(cat('Movie', 'Video'), MEDIA_TYPE.MOVIE);
  assert.equal(cat('Episode', 'Video'), MEDIA_TYPE.EPISODE);
  assert.equal(cat('Audio', 'Audio'), MEDIA_TYPE.MUSIC);
  assert.equal(cat('AudioBook', 'Audio'), MEDIA_TYPE.MUSIC);
  assert.equal(cat('TvChannel', 'Video'), MEDIA_TYPE.LIVE_TV);
  assert.equal(cat('MusicVideo', 'Video'), MEDIA_TYPE.VIDEO);
  assert.equal(cat('Photo', 'Photo'), MEDIA_TYPE.OTHER);
  assert.equal(mediaCategory(null), MEDIA_TYPE.OTHER);
});

test('formatTitle: movie with year, episode code, artist - track', () => {
  assert.equal(formatTitle(normalizeSession(tvSession()).item), 'Big Buck Bunny (2008)');
  assert.equal(
    formatTitle(normalizeSession(phoneEpisodeSession()).item),
    'Pioneer One - S01E02 - Earthfall',
  );
  assert.equal(
    formatTitle({ name: 'La', type: 'Audio', mediaType: 'Audio', artists: ['Test Artist'] }),
    'Test Artist - La',
  );
  assert.equal(
    formatTitle({
      name: 'Pilot',
      type: 'Episode',
      seriesName: 'Show',
      season: null,
      episode: null,
      artists: [],
    }),
    'Show - Pilot',
  );
  assert.equal(formatTitle(null), '');
});

test('remainingMinutes rounds up and never goes negative', () => {
  // 600 s runtime, position 120 s -> 480 s left = 8 min.
  assert.equal(remainingMinutes(normalizeSession(tvSession())), 8);
  const overrun = normalizeSession(
    tvSession({ PlayState: { PositionTicks: 7_000_000_000, IsPaused: false } }),
  );
  assert.equal(remainingMinutes(overrun), 0);
  const noRuntime = normalizeSession(
    tvSession({ NowPlayingItem: { Id: 'live', Name: 'Live', Type: 'TvChannel' } }),
  );
  assert.equal(remainingMinutes(noRuntime), 0);
});

test('isInMarker: start included, end excluded', () => {
  const markers = [
    { type: 'intro', start: 0, end: 300 },
    { type: 'credits', start: 2400, end: 3000 },
  ];
  assert.ok(isInMarker(markers, 'intro', 0));
  assert.ok(!isInMarker(markers, 'intro', 300));
  assert.ok(isInMarker(markers, 'credits', 2500));
  assert.ok(!isInMarker(markers, 'credits', 100));
  assert.ok(!isInMarker([], 'intro', 0));
});

test('buildActivitySummary: who, what, where, paused flag, capped length', () => {
  const summary = buildActivitySummary([
    normalizeSession(tvSession()),
    normalizeSession(phoneEpisodeSession()),
    normalizeSession(idleTvSession({ DeviceId: 'idle', Id: 'idle' })),
  ]);
  assert.equal(
    summary,
    'alice: Big Buck Bunny (2008) (Living room TV) | bob: Pioneer One - S01E02 - Earthfall (Pixel 8) [pause]',
  );
  assert.equal(buildActivitySummary([]), '');
  const many = Array.from({ length: 20 }, (_, i) =>
    normalizeSession(tvSession({ Id: `s${i}`, DeviceId: `d${i}` })),
  );
  assert.ok(buildActivitySummary(many).length <= MAX_TEXT_LENGTH);
});
