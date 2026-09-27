// -----------------------------------------------------------------------------
// Scene triggers: playback transitions (pure functions, unit-tested).
//
// The player devices already carry a "playback state" (0/1) any scene can
// watch, but a state cannot tell a pause from a stop, nor a movie from a song.
// The four triggers declared in the manifest can: "a MOVIE starts on the
// living room TV" dims the lights, "it is PAUSED" brings them back up.
//
// Each successive session snapshot (poll or socket push) is compared with the
// previous one, player by player: one event per transition, never one per
// snapshot. The first snapshot after a (re)connection only sets the baseline —
// a restart of the integration must not replay "playback started" for
// everything already playing.
// -----------------------------------------------------------------------------

import { formatTitle, mediaCategory, truncate } from './media/sessions.js';

/** Trigger keys, declared in the manifest `scene_triggers` (forever: never rename). */
export const SCENE_TRIGGER = {
  STARTED: 'playback_started',
  PAUSED: 'playback_paused',
  RESUMED: 'playback_resumed',
  STOPPED: 'playback_stopped',
};

/**
 * Playback snapshot of one player, the minimum a transition needs.
 * @param {{ state: string, item: { id: string }|null }} session
 * @returns {{ itemId: string, paused: boolean }|null} null when idle.
 */
export function playbackOf(session) {
  if (!session?.item) {
    return null;
  }
  return { itemId: session.item.id, paused: session.state === 'paused' };
}

/**
 * Transitions between two snapshots.
 * @param {Map<string, { itemId: string, paused: boolean }>} previous - By player key.
 * @param {Map<string, { itemId: string, paused: boolean }>} current - By player key.
 * @returns {Array<{ trigger: string, key: string }>}
 */
export function diffPlayback(previous, current) {
  const events = [];
  for (const [key, now] of current) {
    const before = previous.get(key);
    if (!before || before.itemId !== now.itemId) {
      // A new media on an idle player, or the next one in a queue (next
      // episode, next track): a new start either way.
      events.push({ trigger: SCENE_TRIGGER.STARTED, key });
      if (now.paused) {
        events.push({ trigger: SCENE_TRIGGER.PAUSED, key });
      }
    } else if (!before.paused && now.paused) {
      events.push({ trigger: SCENE_TRIGGER.PAUSED, key });
    } else if (before.paused && !now.paused) {
      events.push({ trigger: SCENE_TRIGGER.RESUMED, key });
    }
  }
  for (const key of previous.keys()) {
    if (!current.has(key)) {
      events.push({ trigger: SCENE_TRIGGER.STOPPED, key });
    }
  }
  return events;
}

/**
 * Flat event data (≤ 30 keys, primitives only). `player` and `media_type`
 * are the filters of the manifest; the others are the variables the scene
 * actions can use ({{triggerEvent.data.title}}).
 * @param {string} playerExternalId - The player device external id.
 * @param {object} session - Normalized session (the last one seen for a stop).
 * @param {string} playerName - Device name, as shown in Gladys.
 */
export function buildEventData(playerExternalId, session, playerName) {
  const item = session.item;
  return {
    player: playerExternalId,
    media_type: mediaCategory(item),
    title: truncate(formatTitle(item), 200),
    name: truncate(item?.name ?? '', 200),
    series_name: truncate(item?.seriesName ?? '', 200),
    user: session.userName,
    player_name: playerName,
  };
}
