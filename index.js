// -----------------------------------------------------------------------------
// Entry point of the Jellyfin & Emby integration for Gladys Assistant.
//
// Role of this file: wire the SDK to the MediaMonitor (src/monitor.js) and to
// the real-time socket (src/media/socket.js). It holds no server logic itself:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. on connection, contacts the media server, publishes the devices and
//      starts the refresh loops (socket push + fallback poll + libraries).
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, isConfigured } from './src/config.js';
import { MediaMonitor } from './src/monitor.js';
import { ServerSocket } from './src/media/socket.js';
import { AuthError } from './src/media/api.js';
import { WIDGET } from './src/widgets.js';

const manifest = JSON.parse(
  readFileSync(new URL('./gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const gladys = new GladysIntegration();

// Fallback poll of the sessions: every 15 s while the real-time socket is
// down, once a minute while it is up (the socket pushes every change).
const POLL_TICK_MS = 15_000;
const POLL_WITH_SOCKET_MS = 60_000;
// Retry delay after a failed initialization (server down, network...).
const RETRY_DELAY_MS = 60_000;

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

/** @type {MediaMonitor|null} Present once the server has been reached. */
let monitor = null;
/** @type {ServerSocket|null} */
let socket = null;
let pollInterval = null;
let libraryInterval = null;
let retryTimer = null;
let lastPollAt = 0;
let consecutiveFailures = 0;

/** Increments on every initialize(): only the newest run may publish. */
let initGeneration = 0;

const NOT_CONFIGURED_MESSAGE = {
  en: 'Fill in the server URL and API key in the configuration.',
  fr: "Renseignez l'URL du serveur et la clé d'API dans la configuration.",
};

const AUTH_REFUSED_MESSAGE = {
  en: 'The server refused the API key. Create a new one (Dashboard > API Keys) and save it here.',
  fr: "Le serveur refuse la clé d'API. Créez-en une nouvelle (Tableau de bord > Clés API) et enregistrez-la ici.",
};

const NOT_CONNECTED_ERROR = 'Jellyfin / Emby server not connected';

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  if (!monitor) {
    logger.warn('onScanRequest ignored: the server is not connected yet');
    return;
  }
  await monitor.refreshSessions().catch(() => {});
  logger.info(`onScanRequest -> publishing ${monitor.players.size + 1} devices`);
  await gladys.publishDiscoveredDevices(monitor.buildDevices());
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  if (!monitor) {
    throw new Error(NOT_CONNECTED_ERROR);
  }
  await monitor.handleSetValue(device, feature, value);
});

// --- Device created: the user added a discovered device --------------------
// The states published while the device did not exist in Gladys were dropped,
// and the deduplication would never resend them: forget what was published
// for this device and refresh everything right away.
gladys.onDeviceCreated(async (device) => {
  logger.info(`onDeviceCreated <- ${device.external_id}`);
  if (!monitor) {
    return;
  }
  monitor.resetPublicationCache(device.external_id);
  monitor.scheduleSessionRefresh();
  await monitor.refreshLibraries().catch((err) => {
    logger.warn(`Library refresh after device creation failed: ${err.message}`);
  });
});

// --- Polling ------------------------------------------------------------------
// No device declares a Gladys poll_frequency: every state is pushed by the
// integration's own loops (see startLoops), so onPoll is intentionally not
// registered.

// --- Manifest actions: buttons in the Configuration screen -------------------
gladys.onAction('test_connection', async () => {
  const testConfig = normalizeConfig(await gladys.getConfig());
  if (!isConfigured(testConfig)) {
    return NOT_CONFIGURED_MESSAGE;
  }
  const testMonitor = new MediaMonitor(gladys, testConfig, { version: manifest.version });
  try {
    await testMonitor.init();
  } catch (err) {
    if (err instanceof AuthError) {
      return AUTH_REFUSED_MESSAGE;
    }
    throw err;
  }
  const { name, version } = testMonitor.server;
  const libraries = testMonitor.libraries.length;
  const players = testMonitor.players.size;
  return {
    en: `Connected to "${name}" (${testMonitor.label} ${version}): ${libraries} libraries, ${players} players connected.`,
    fr: `Connecté à « ${name} » (${testMonitor.label} ${version}) : ${libraries} bibliothèques, ${players} lecteurs connectés.`,
  };
});

gladys.onAction('scan_players', async () => {
  if (!monitor) {
    return NOT_CONFIGURED_MESSAGE;
  }
  await monitor.refreshSessions();
  await gladys.publishDiscoveredDevices(monitor.buildDevices());
  return {
    en: `${monitor.players.size} players known. New ones appear in the Discovery tab.`,
    fr: `${monitor.players.size} lecteurs connus. Les nouveaux apparaissent dans l'onglet Découverte.`,
  };
});

// --- Scene actions ------------------------------------------------------------
gladys.onSceneAction('display_message', async (fields) => {
  if (!monitor) {
    throw new Error(NOT_CONNECTED_ERROR);
  }
  await monitor.displayMessage(fields);
});

gladys.onSceneAction('play_media', async (fields) => {
  if (!monitor) {
    throw new Error(NOT_CONNECTED_ERROR);
  }
  return monitor.playMedia(fields);
});

// --- Dashboard widgets --------------------------------------------------------
gladys.onWidgetGet(WIDGET.NOW_PLAYING, async ({ language }) => {
  if (!monitor) {
    return { components: [] };
  }
  return monitor.nowPlayingContent(language);
});

gladys.onWidgetGet(WIDGET.LATEST_MEDIA, async ({ settings, language }) => {
  if (!monitor) {
    return { components: [] };
  }
  return monitor.latestContent(language, settings?.kind);
});

gladys.onWidgetGetImage(async (imageKey) => {
  if (!monitor) {
    throw new Error(NOT_CONNECTED_ERROR);
  }
  return monitor.widgetImage(imageKey);
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // The server address or key may have changed: rebuild everything.
  await initialize();
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  config = normalizeConfig(await gladys.getConfig());
  await initialize();
});

gladys.on('disconnected', () => {
  stopLoops();
});

/**
 * (Re)connect to the media server, publish the devices and start the refresh
 * loops. Reports the application-level connection status either way.
 */
async function initialize() {
  // Saving the config fires onConfigUpdated while `connected` may still be
  // initializing: only the newest run is allowed to publish anything.
  const generation = ++initGeneration;
  const isStale = () => generation !== initGeneration;

  stopLoops();
  monitor?.stop();
  monitor = null;

  if (!isConfigured(config)) {
    logger.info('Waiting for the configuration (server URL + API key)');
    await gladys.setConnectionStatus(false, NOT_CONFIGURED_MESSAGE).catch(() => {});
    return;
  }

  try {
    const nextMonitor = new MediaMonitor(gladys, config, { version: manifest.version });
    await nextMonitor.init();
    if (isStale()) {
      nextMonitor.stop();
      return;
    }
    monitor = nextMonitor;

    // Publish the devices (idempotent upsert by external_id).
    await gladys.publishDiscoveredDevices(monitor.buildDevices());
    await monitor.refreshLibraries().catch((err) => {
      logger.warn(`Initial library refresh failed: ${err.message}`);
    });
    if (isStale()) {
      return;
    }
    startLoops();
    consecutiveFailures = 0;
    await gladys.setConnectionStatus(true);
  } catch (err) {
    if (isStale()) {
      return;
    }
    if (err instanceof AuthError) {
      // Never insist with a refused key: a reverse proxy with fail2ban
      // (SWAG's nginx-unauthorized jail...) would ban the house. Wait for
      // the user to save a new key.
      logger.error(`Initialization failed: ${err.message}`);
      await gladys.setConnectionStatus(false, AUTH_REFUSED_MESSAGE).catch(() => {});
      return;
    }
    logger.error(`Initialization failed: ${err.message} (new attempt in 1 min)`);
    await gladys
      .setConnectionStatus(false, {
        en: `Cannot reach the server: ${err.message}`,
        fr: `Impossible de joindre le serveur : ${err.message}`,
      })
      .catch(() => {});
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!isStale()) {
        initialize();
      }
    }, RETRY_DELAY_MS);
  }
}

/**
 * Start the real-time socket, the fallback session poll and the library poll.
 */
function startLoops() {
  const current = monitor;
  socket = new ServerSocket(current.api, {
    allowSelfSigned: config.allow_self_signed,
    onSessions: (sessions) => {
      handleSessions(current.applySessions(sessions));
    },
    onLibraryChanged: () => {
      current
        .refreshLibraries()
        .catch((err) => logger.warn(`Library refresh failed: ${err.message}`));
      current.requestWidgetRefresh(WIDGET.LATEST_MEDIA);
    },
  });
  socket.start();

  lastPollAt = Date.now();
  pollInterval = setInterval(() => {
    const interval = socket?.isOpen ? POLL_WITH_SOCKET_MS : POLL_TICK_MS;
    if (Date.now() - lastPollAt >= interval - 1_000) {
      lastPollAt = Date.now();
      handleSessions(current.refreshSessions());
    }
  }, POLL_TICK_MS);

  libraryInterval = setInterval(() => {
    current.refreshLibraries().catch((err) => {
      logger.warn(`Library refresh failed: ${err.message}`);
    });
  }, config.poll_frequency * 1_000);
}

function stopLoops() {
  clearInterval(pollInterval);
  pollInterval = null;
  clearInterval(libraryInterval);
  libraryInterval = null;
  clearTimeout(retryTimer);
  retryTimer = null;
  socket?.stop();
  socket = null;
}

/**
 * Outcome of a session refresh (poll or push): republish the devices when a
 * new player appeared, track the connection health.
 * @param {Promise<boolean>} refresh
 */
async function handleSessions(refresh) {
  try {
    const newPlayers = await refresh;
    if (newPlayers && monitor) {
      // A never-seen player connected: offer it in the Discovery tab.
      await gladys.publishDiscoveredDevices(monitor.buildDevices());
    }
    if (consecutiveFailures >= 3) {
      await gladys.setConnectionStatus(true).catch(() => {});
    }
    consecutiveFailures = 0;
  } catch (err) {
    if (err instanceof AuthError) {
      // The key was revoked: stop everything until a new one is saved.
      logger.error(`Session refresh refused: ${err.message}`);
      stopLoops();
      await gladys.setConnectionStatus(false, AUTH_REFUSED_MESSAGE).catch(() => {});
      return;
    }
    consecutiveFailures += 1;
    logger.warn(`Session refresh failed (${consecutiveFailures}): ${err.message}`);
    if (consecutiveFailures === 3) {
      await gladys
        .setConnectionStatus(false, {
          en: `Lost contact with the server: ${err.message}`,
          fr: `Contact perdu avec le serveur : ${err.message}`,
        })
        .catch(() => {});
    }
  }
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopLoops();
  monitor?.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info(`Starting the Jellyfin & Emby integration v${manifest.version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
