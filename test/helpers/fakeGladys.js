// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the integration modules rely on:
//   - externalIds(type, platformId)  -> { device, feature(key) }
//   - publishState / publishStates   -> record calls so tests can assert them
//   - publishSceneEvent              -> record calls so tests can assert them
//   - requestWidgetRefresh           -> record calls so tests can assert them
//   - publishNowPlaying              -> the SDK's per-device diff (without the
//                                       position extrapolation), recorded as
//                                       states and texts like the others
// This lets us test the wiring logic (discovery payloads, dispatch, state
// publication, scene events) without a running Gladys server.
// -----------------------------------------------------------------------------

import { artworkKey } from '@gladysassistant/integration-sdk';

const STRING_TYPES = ['title', 'artist', 'album', 'artwork'];

export function createFakeGladys() {
  const nowPlaying = new Map();
  const published = [];
  const textStates = [];
  const sceneEvents = [];
  const widgetRefreshes = [];

  return {
    published,
    textStates,
    sceneEvents,
    widgetRefreshes,

    externalIds(type, platformId) {
      const device = `ext:jellyfin:${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      if (typeof state === 'object' && state !== null && state.text !== undefined) {
        textStates.push({ featureExternalId, text: state.text });
      } else {
        published.push({ featureExternalId, state });
      }
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
    },

    async publishNowPlaying(deviceExternalId, values, { featureExternalIds = {} } = {}) {
      const previous = nowPlaying.get(deviceExternalId) ?? {};
      const next = { ...previous };
      for (const [key, raw] of Object.entries(values)) {
        const type = key === 'artwork_url' ? 'artwork' : key;
        const value = key === 'artwork_url' ? (raw ? artworkKey(raw) : '') : raw;
        if (previous[type] === value) {
          continue;
        }
        next[type] = value;
        const featureExternalId = featureExternalIds[type] ?? `${deviceExternalId}:${type}`;
        if (STRING_TYPES.includes(type)) {
          textStates.push({ featureExternalId, text: value });
        } else {
          published.push({ featureExternalId, state: value });
        }
      }
      nowPlaying.set(deviceExternalId, next);
    },

    forgetPublishedStates(externalId) {
      nowPlaying.delete(externalId);
    },

    async publishSceneEvent(key, data) {
      sceneEvents.push({ key, data });
    },

    async requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },

    /** Last numeric state published for a feature external id suffix. */
    lastState(suffix) {
      const found = published.filter((p) => p.featureExternalId.endsWith(suffix)).at(-1);
      return found?.state;
    },

    /** Last text published for a feature external id suffix. */
    lastText(suffix) {
      const found = textStates.filter((p) => p.featureExternalId.endsWith(suffix)).at(-1);
      return found?.text;
    },

    reset() {
      published.length = 0;
      textStates.length = 0;
      sceneEvents.length = 0;
      widgetRefreshes.length = 0;
    },
  };
}
