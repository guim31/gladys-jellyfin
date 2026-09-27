// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the integration modules rely on:
//   - externalIds(type, platformId)  -> { device, feature(key) }
//   - publishState / publishStates   -> record calls so tests can assert them
//   - publishSceneEvent              -> record calls so tests can assert them
//   - requestWidgetRefresh           -> record calls so tests can assert them
// This lets us test the wiring logic (discovery payloads, dispatch, state
// publication, scene events) without a running Gladys server.
// -----------------------------------------------------------------------------

export function createFakeGladys() {
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
