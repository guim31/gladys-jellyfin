// -----------------------------------------------------------------------------
// Device: PLAYER
//
// One device per player (TV app, phone, web browser...) seen by the server —
// the equivalent of a Home Assistant `media_player` entity. Same feature set
// as the Plex integration: playback controls use the MUSIC feature family
// (the one the Gladys dashboard "Music" widget understands) completed with the
// TELEVISION push buttons MUSIC lacks (stop, seek back/forward):
//
//   controls: play, pause, stop, previous, next, rewind, forward, volume, mute
//   sensors : playback state (0/1), now playing title, remaining minutes,
//             "in intro" and "in credits" binary markers (automation-friendly:
//             bring the lights back up when the credits start rolling).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { texts } from '../i18n.js';
import { SERVER_LABEL } from '../media/api.js';

const DEVICE_TYPE = 'player';

export const PLAYER_FEATURE = {
  PLAY: 'play',
  PAUSE: 'pause',
  STOP: 'stop',
  PREVIOUS: 'previous',
  NEXT: 'next',
  REWIND: 'rewind',
  FORWARD: 'forward',
  VOLUME: 'volume',
  MUTE: 'mute',
  PLAYBACK_STATE: 'playback-state',
  NOW_PLAYING: 'now-playing',
  REMAINING: 'remaining',
  IN_INTRO: 'intro',
  IN_CREDITS: 'credits',
};

/**
 * Push-button features -> playstate command of the server
 * (`POST /Sessions/{id}/Playing/{command}`). PLAY is resolved at run time
 * (see the monitor): Unpause when paused, nothing to do otherwise.
 */
export const PLAYER_PLAYSTATE_COMMANDS = {
  [PLAYER_FEATURE.PAUSE]: 'Pause',
  [PLAYER_FEATURE.STOP]: 'Stop',
  [PLAYER_FEATURE.PREVIOUS]: 'PreviousTrack',
  [PLAYER_FEATURE.NEXT]: 'NextTrack',
  [PLAYER_FEATURE.REWIND]: 'Rewind',
  [PLAYER_FEATURE.FORWARD]: 'FastForward',
};

/**
 * External ids of a player device.
 * @param {object} gladys - SDK instance.
 * @param {string} key - Player key (hash of its DeviceId, see sessions.js).
 */
export function playerExternalIds(gladys, key) {
  return gladys.externalIds(DEVICE_TYPE, key);
}

/**
 * Player key of a device external id ("ext:<selector>:player:<key>"), or null
 * for another device.
 * @param {string} externalId
 * @returns {string|null}
 */
export function extractPlayerKey(externalId) {
  const marker = `:${DEVICE_TYPE}:`;
  const index = String(externalId).indexOf(marker);
  if (index === -1) {
    return null;
  }
  const rest = externalId.slice(index + marker.length);
  return /^[0-9a-f]{16}$/.test(rest) ? rest : null;
}

/**
 * Feature key of a player feature external id, or null when the external id
 * belongs to another device.
 * @param {string} featureExternalId
 * @param {{ device: string }} ids - The player's external ids.
 * @returns {string|null}
 */
export function playerFeatureKey(featureExternalId, ids) {
  const prefix = `${ids.device}:`;
  return featureExternalId.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}

/**
 * Name of a player device: "Jellyfin - Living room TV (Jellyfin Android TV)".
 * @param {'jellyfin'|'emby'} kind
 * @param {{ deviceName: string, client: string }} player
 */
export function playerDeviceName(kind, player) {
  const client = player.client && player.client !== player.deviceName ? ` (${player.client})` : '';
  return `${SERVER_LABEL[kind]} - ${player.deviceName}${client}`;
}

/**
 * Build the discovery payload of one player device.
 * @param {object} gladys - SDK instance.
 * @param {'jellyfin'|'emby'} kind
 * @param {{ key: string, deviceName: string, client: string }} player
 * @param {'fr'|'en'} language
 */
export function buildPlayerDevice(gladys, kind, player, language) {
  const t = texts(language);
  const ids = playerExternalIds(gladys, player.key);
  const pushButton = (key, name, category, type) => ({
    name,
    external_id: ids.feature(key),
    category,
    type,
    min: 1,
    max: 1,
    read_only: false,
    has_feedback: false,
    keep_history: false,
  });
  const sensor = (key, name, category, type, extra = {}) => ({
    name,
    external_id: ids.feature(key),
    category,
    type,
    min: 0,
    max: 1,
    read_only: true,
    has_feedback: false,
    keep_history: false,
    ...extra,
  });

  const { MUSIC, TELEVISION } = DEVICE_FEATURE_TYPES;
  const C = DEVICE_FEATURE_CATEGORIES;

  return {
    name: playerDeviceName(kind, player),
    external_id: ids.device,
    should_poll: false,
    features: [
      pushButton(PLAYER_FEATURE.PLAY, t.play, C.MUSIC, MUSIC.PLAY),
      pushButton(PLAYER_FEATURE.PAUSE, t.pause, C.MUSIC, MUSIC.PAUSE),
      pushButton(PLAYER_FEATURE.STOP, t.stop, C.TELEVISION, TELEVISION.STOP),
      pushButton(PLAYER_FEATURE.PREVIOUS, t.previous, C.MUSIC, MUSIC.PREVIOUS),
      pushButton(PLAYER_FEATURE.NEXT, t.next, C.MUSIC, MUSIC.NEXT),
      pushButton(PLAYER_FEATURE.REWIND, t.rewind, C.TELEVISION, TELEVISION.REWIND),
      pushButton(PLAYER_FEATURE.FORWARD, t.forward, C.TELEVISION, TELEVISION.FORWARD),
      {
        name: t.volume,
        external_id: ids.feature(PLAYER_FEATURE.VOLUME),
        category: C.MUSIC,
        type: MUSIC.VOLUME,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      },
      {
        name: t.mute,
        external_id: ids.feature(PLAYER_FEATURE.MUTE),
        category: C.TELEVISION,
        type: TELEVISION.VOLUME_MUTE,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
        keep_history: false,
      },
      sensor(PLAYER_FEATURE.PLAYBACK_STATE, t.playbackState, C.MUSIC, MUSIC.PLAYBACK_STATE),
      // min/max are meaningless for a text state but the Gladys device model
      // requires them on every feature (NOT NULL columns).
      sensor(PLAYER_FEATURE.NOW_PLAYING, t.nowPlaying, C.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT),
      sensor(
        PLAYER_FEATURE.REMAINING,
        t.remaining,
        C.DURATION,
        DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        {
          unit: DEVICE_FEATURE_UNITS.MINUTES,
          max: 100_000,
        },
      ),
      sensor(PLAYER_FEATURE.IN_INTRO, t.inIntro, C.INPUT, DEVICE_FEATURE_TYPES.INPUT.BINARY),
      sensor(PLAYER_FEATURE.IN_CREDITS, t.inCredits, C.INPUT, DEVICE_FEATURE_TYPES.INPUT.BINARY),
    ],
  };
}
