// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined` or badly-typed values.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  server_url: '',
  api_key: '',
  poll_frequency: 300, // seconds, how often library statistics are refreshed
  library_sensors: true,
  allow_self_signed: false,
  language: 'fr', // names of the devices and features ('fr' | 'en')
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    server_url: normalizeServerUrl(raw.server_url),
    api_key: String(raw.api_key ?? DEFAULT_CONFIG.api_key).trim(),
    poll_frequency: clampNumber(raw.poll_frequency, DEFAULT_CONFIG.poll_frequency, 60, 3600),
    // Booleans may arrive as strings from a form.
    library_sensors: raw.library_sensors !== false && raw.library_sensors !== 'false',
    allow_self_signed: raw.allow_self_signed === true || raw.allow_self_signed === 'true',
    language: raw.language === 'en' ? 'en' : DEFAULT_CONFIG.language,
  };
}

/**
 * Clean the server URL typed by the user: trimmed, scheme added when missing
 * (http, the default of both servers on the LAN), no trailing slash (every
 * API path starts with '/'), and no `/web` suffix — the address users copy
 * from their browser bar is the web client's, not the API base.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeServerUrl(value) {
  let url = String(value ?? '').trim();
  if (url.length === 0) {
    return '';
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  // Drop what follows the web client path (#/home.html...), then the path itself.
  url = url.replace(/#.*$/, '').replace(/\/+$/, '');
  url = url.replace(/\/web(\/index\.html)?$/i, '');
  return url.replace(/\/+$/, '');
}

/**
 * True when the config carries enough information to reach a server.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function isConfigured(config) {
  return config.server_url.length > 0 && config.api_key.length > 0;
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}
