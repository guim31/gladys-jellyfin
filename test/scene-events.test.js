import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPlayback, playbackOf, buildEventData, SCENE_TRIGGER } from '../src/scene-events.js';
import { normalizeSession } from '../src/media/sessions.js';
import { tvSession, phoneEpisodeSession, idleTvSession } from './fixtures/sessions.js';

const snap = (entries) => new Map(Object.entries(entries));
const triggers = (events) => events.map((e) => `${e.trigger}:${e.key}`);

test('playbackOf: null when idle', () => {
  assert.equal(playbackOf(normalizeSession(idleTvSession())), null);
  assert.deepEqual(playbackOf(normalizeSession(tvSession())), {
    itemId: '0c19a6f54d50d8bbbba00f8f4325de45',
    paused: false,
  });
});

test('start, pause, resume, stop: one event per transition', () => {
  const playing = { itemId: 'a', paused: false };
  const paused = { itemId: 'a', paused: true };
  assert.deepEqual(triggers(diffPlayback(snap({}), snap({ tv: playing }))), [
    `${SCENE_TRIGGER.STARTED}:tv`,
  ]);
  assert.deepEqual(triggers(diffPlayback(snap({ tv: playing }), snap({ tv: paused }))), [
    `${SCENE_TRIGGER.PAUSED}:tv`,
  ]);
  assert.deepEqual(triggers(diffPlayback(snap({ tv: paused }), snap({ tv: playing }))), [
    `${SCENE_TRIGGER.RESUMED}:tv`,
  ]);
  assert.deepEqual(triggers(diffPlayback(snap({ tv: playing }), snap({}))), [
    `${SCENE_TRIGGER.STOPPED}:tv`,
  ]);
});

test('an unchanged snapshot fires nothing (socket pushes repeat the list)', () => {
  const playing = { itemId: 'a', paused: false };
  assert.deepEqual(diffPlayback(snap({ tv: playing }), snap({ tv: { ...playing } })), []);
});

test('the next episode is a new start, without a stop in between', () => {
  assert.deepEqual(
    triggers(
      diffPlayback(
        snap({ tv: { itemId: 'e1', paused: false } }),
        snap({ tv: { itemId: 'e2', paused: false } }),
      ),
    ),
    [`${SCENE_TRIGGER.STARTED}:tv`],
  );
});

test('a media that shows up already paused fires start then pause', () => {
  assert.deepEqual(triggers(diffPlayback(snap({}), snap({ tv: { itemId: 'a', paused: true } }))), [
    `${SCENE_TRIGGER.STARTED}:tv`,
    `${SCENE_TRIGGER.PAUSED}:tv`,
  ]);
});

test('players are independent', () => {
  const events = diffPlayback(
    snap({ tv: { itemId: 'a', paused: false }, phone: { itemId: 'b', paused: false } }),
    snap({ tv: { itemId: 'a', paused: true }, kitchen: { itemId: 'c', paused: false } }),
  );
  assert.deepEqual(triggers(events).sort(), [
    `${SCENE_TRIGGER.PAUSED}:tv`,
    `${SCENE_TRIGGER.STARTED}:kitchen`,
    `${SCENE_TRIGGER.STOPPED}:phone`,
  ]);
});

test('buildEventData: flat, primitives only, filters and variables', () => {
  const data = buildEventData(
    'ext:jellyfin:player:abc',
    normalizeSession(phoneEpisodeSession()),
    'Jellyfin - Pixel 8',
  );
  assert.deepEqual(data, {
    player: 'ext:jellyfin:player:abc',
    media_type: 'episode',
    title: 'Pioneer One - S01E02 - Earthfall',
    name: 'Earthfall',
    series_name: 'Pioneer One',
    user: 'bob',
    player_name: 'Jellyfin - Pixel 8',
  });
  for (const value of Object.values(data)) {
    assert.ok(['string', 'number', 'boolean'].includes(typeof value));
  }
  assert.ok(Object.keys(data).length <= 30);
});
