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
//   sensors : now playing title, remaining minutes, "in intro" and "in
//             credits" binary markers (automation-friendly: bring the lights
//             back up when the credits start rolling).
//
// Gladys 5.3 music player (capabilities/music.md): the playback state is
// writable (0 pause, 1 play, 2 stop), and the "now playing" features title,
// artist, album, artwork, duration, position (writable: a seek), shuffle and
// repeat are published by `publishNowPlaying` with `nowPlayingOf()` below.
// The external ids of the features published before 5.3 never change:
// `playback-state` (passed through `featureExternalIds`), `volume` and `mute`
// (converted from television/volume_mute to music/mute by "Update" in
// Discover). The new ones follow the SDK's `${device}:${type}` convention.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
} from '@gladysassistant/integration-sdk';
import { texts } from '../i18n.js';
import { SERVER_LABEL, TICKS_PER_SECOND } from '../media/api.js';
import { REPEAT_MODES } from '../media/sessions.js';

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
  // Gladys 5.3: keys equal to the music types (`${device}:${type}`).
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  ARTWORK: 'artwork',
  DURATION: 'duration',
  POSITION: 'position',
  SHUFFLE: 'shuffle',
  REPEAT: 'repeat',
};

/** Upper bound of the duration and position features (seconds). */
export const MAX_SECONDS = 86_400;

/** Repeat mode of the server -> MUSIC_REPEAT_MODE, and back. */
export const REPEAT_TO_GLADYS = {
  RepeatNone: MUSIC_REPEAT_MODE.OFF,
  RepeatAll: MUSIC_REPEAT_MODE.ALL,
  RepeatOne: MUSIC_REPEAT_MODE.ONE,
};
export const REPEAT_FROM_GLADYS = Object.fromEntries(
  REPEAT_MODES.map((mode) => [REPEAT_TO_GLADYS[mode], mode]),
);

/**
 * `featureExternalIds` of publishNowPlaying: the playback state kept its
 * pre-5.3 id; every other type follows `${device}:${type}`.
 * @param {{ feature: (key: string) => string }} ids - The player's external ids.
 */
export function nowPlayingFeatureIds(ids) {
  return { playback_state: ids.feature(PLAYER_FEATURE.PLAYBACK_STATE) };
}

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
 * @param {'fr'|'en'|'de'|'es'} language
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

  // A writable music feature: the player confirms every write (has_feedback).
  const control = (key, name, type, max, extra = {}) => ({
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.MUSIC,
    type,
    min: 0,
    max,
    read_only: false,
    has_feedback: true,
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
      // television/volume_mute before 0.4: same id, converted by "Update".
      control(PLAYER_FEATURE.MUTE, t.mute, MUSIC.MUTE, 1),
      // Read-only 0/1 before 0.4: same id, now writable (2 = stop).
      control(PLAYER_FEATURE.PLAYBACK_STATE, t.playbackState, MUSIC.PLAYBACK_STATE, 2),
      // min/max are meaningless for a text state but the Gladys device model
      // requires them on every feature (NOT NULL columns).
      sensor(PLAYER_FEATURE.TITLE, t.title, C.MUSIC, MUSIC.TITLE, { max: 0 }),
      sensor(PLAYER_FEATURE.ARTIST, t.artist, C.MUSIC, MUSIC.ARTIST, { max: 0 }),
      sensor(PLAYER_FEATURE.ALBUM, t.albumName, C.MUSIC, MUSIC.ALBUM, { max: 0 }),
      sensor(PLAYER_FEATURE.ARTWORK, t.artwork, C.MUSIC, MUSIC.ARTWORK, { max: 0 }),
      sensor(PLAYER_FEATURE.DURATION, t.duration, C.MUSIC, MUSIC.DURATION, {
        unit: DEVICE_FEATURE_UNITS.SECONDS,
        max: MAX_SECONDS,
      }),
      control(PLAYER_FEATURE.POSITION, t.position, MUSIC.POSITION, MAX_SECONDS, {
        unit: DEVICE_FEATURE_UNITS.SECONDS,
      }),
      control(PLAYER_FEATURE.SHUFFLE, t.shuffle, MUSIC.SHUFFLE, 1),
      control(PLAYER_FEATURE.REPEAT, t.repeat, MUSIC.REPEAT, MUSIC_REPEAT_MODE.ONE),
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

const seconds = (ticks) => Math.max(0, Math.floor((Number(ticks) || 0) / TICKS_PER_SECOND));

/**
 * Title, artist and album lines of an item, whatever its kind: a track
 * (title / artists / album), an episode (title / series / season), a movie
 * or a channel (its name alone).
 * @param {ReturnType<import('../media/sessions.js').normalizeItem>} item
 */
export function describeItem(item) {
  if (item.type === 'Episode') {
    return { title: item.name, artist: item.seriesName, album: item.seasonName };
  }
  const artists = item.artists.length > 0 ? item.artists.join(', ') : item.albumArtist;
  return { title: item.name, artist: artists, album: item.album };
}

/**
 * The snapshot given to publishNowPlaying (Gladys 5.3). Nothing loaded, or
 * the player gone: IDLE and the texts cleared explicitly (an absent key means
 * "unchanged"). Shuffle, repeat, volume and mute only when the app reports
 * them. The position is the server's (Jellyfin extrapolates it between two
 * reports of the app): the SDK republishes it on a state or title change, or
 * a drift of more than 3 s — never every second.
 * @param {object|null} session - Normalized session (the state expected after
 *   a command applied, see MediaMonitor.effective).
 * @param {(item: object) => string|null} artworkUrl
 */
export function nowPlayingOf(session, artworkUrl) {
  const item = session?.item ?? null;
  if (!item) {
    const snapshot = {
      playback_state: MUSIC_PLAYBACK_STATE.IDLE,
      title: '',
      artist: '',
      album: '',
      artwork_url: null,
      duration: 0,
      position: 0,
    };
    return session ? { ...snapshot, ...audioOf(session) } : snapshot;
  }
  return {
    playback_state:
      session.state === 'paused' ? MUSIC_PLAYBACK_STATE.PAUSED : MUSIC_PLAYBACK_STATE.PLAYING,
    ...describeItem(item),
    artwork_url: artworkUrl(item),
    // 0 for live TV: the music box shows "Live".
    duration: Math.min(MAX_SECONDS, seconds(item.runTimeTicks)),
    position: seconds(session.positionTicks),
    ...audioOf(session),
  };
}

/** Shuffle, repeat, volume and mute of a session, when the app reports them. */
function audioOf(session) {
  const values = {};
  if (session.shuffle !== null && session.shuffle !== undefined) {
    values.shuffle = session.shuffle ? 1 : 0;
  }
  if (session.repeat) {
    values.repeat = REPEAT_TO_GLADYS[session.repeat];
  }
  if (session.volume !== null && session.volume !== undefined) {
    values.volume = session.volume;
  }
  values.mute = session.muted ? 1 : 0;
  return values;
}
