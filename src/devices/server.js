// -----------------------------------------------------------------------------
// Device: MEDIA SERVER
//
// One device for the Jellyfin / Emby server itself, carrying the monitoring
// sensors:
//   - number of active playbacks;
//   - number of playbacks being transcoded (the ones that load the CPU);
//   - a one-line "now playing" summary (who watches what, where);
//   - one item-count sensor per library (plus episodes for TV show libraries
//     and tracks for music libraries), optional via `library_sensors`.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { texts } from '../i18n.js';
import { SERVER_LABEL } from '../media/api.js';

const DEVICE_TYPE = 'server';

export const SERVER_FEATURE = {
  ACTIVE_STREAMS: 'active-streams',
  TRANSCODE_SESSIONS: 'transcode-sessions',
  NOW_PLAYING: 'now-playing',
};

/**
 * What each kind of library counts: its main item type, and an optional
 * second counter (episodes of a TV library, tracks of a music library).
 * Libraries of another kind count their files (`IsFolder=false`).
 */
export const LIBRARY_COUNTERS = {
  movies: { main: ['Movie'] },
  tvshows: { main: ['Series'], extra: { kind: 'episodes', types: ['Episode'] } },
  music: { main: ['MusicAlbum'], extra: { kind: 'tracks', types: ['Audio'] } },
  musicvideos: { main: ['MusicVideo'] },
  boxsets: { main: ['BoxSet'] },
  books: { main: ['Book', 'AudioBook'] },
};

/**
 * External ids of the server device.
 * @param {object} gladys - SDK instance.
 * @param {string} serverId - Stable server identifier.
 */
export function serverExternalIds(gladys, serverId) {
  return gladys.externalIds(DEVICE_TYPE, serverId);
}

/**
 * Feature key of a library counter.
 * @param {{ id: string }} library
 * @param {'count'|'episodes'|'tracks'} kind
 */
export function libraryFeatureKey(library, kind) {
  return `library-${sanitizeKey(library.id)}-${kind}`;
}

/**
 * Library ids are 32 hex characters on Jellyfin, small integers on Emby:
 * keep them id-safe anyway.
 * @param {string} value
 */
function sanitizeKey(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Build the discovery payload of the server device.
 * @param {object} gladys - SDK instance.
 * @param {{ kind: 'jellyfin'|'emby', id: string, name: string }} server
 * @param {Array<{ id: string, name: string, collectionType: string }>} libraries
 * @param {{ library_sensors: boolean, language: 'fr'|'en' }} config
 */
export function buildServerDevice(gladys, server, libraries, config) {
  const t = texts(config.language);
  const ids = serverExternalIds(gladys, server.id);
  const counterFeature = (key, name, max = 100) => ({
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    min: 0,
    max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  });

  const features = [
    counterFeature(SERVER_FEATURE.ACTIVE_STREAMS, t.activeStreams),
    counterFeature(SERVER_FEATURE.TRANSCODE_SESSIONS, t.transcodes),
    {
      name: t.nowPlaying,
      external_id: ids.feature(SERVER_FEATURE.NOW_PLAYING),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      // min/max are meaningless for a text state but the Gladys device model
      // requires them on every feature (NOT NULL columns).
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    },
  ];

  if (config.library_sensors) {
    for (const library of libraries) {
      features.push(counterFeature(libraryFeatureKey(library, 'count'), library.name, 1_000_000));
      const extra = LIBRARY_COUNTERS[library.collectionType]?.extra;
      if (extra) {
        features.push(
          counterFeature(
            libraryFeatureKey(library, extra.kind),
            `${library.name} (${t[extra.kind]})`,
            1_000_000,
          ),
        );
      }
    }
  }

  // No `poll_frequency` here: Gladys only accepts a closed list of fast
  // frequencies (1 s to 1 min) for device polling, and every state of this
  // integration is pushed from its own loops (see index.js).
  return {
    name: `${SERVER_LABEL[server.kind]} - ${server.name || 'Server'}`,
    external_id: ids.device,
    should_poll: false,
    features,
  };
}
