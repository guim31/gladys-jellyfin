// -----------------------------------------------------------------------------
// Wiring of the Jellyfin & Emby integration: SDK events -> MediaMonitor
// (src/monitor.js) and the real-time socket (src/media/socket.js).
//
// createApp() registers every handler on the SDK instance it receives, so the
// same code runs in production (index.js passes a real GladysIntegration) and
// in the tests (the fake Gladys of @gladysassistant/integration-sdk/testing).
//
// On connection it contacts the media server, publishes the devices and starts
// its own refresh loops. No device asks Gladys to poll it (`should_poll:
// false`): every state comes from these loops, never from the core scheduler.
//   - the socket pushes the session list on every change;
//   - the fallback session poll runs every 15 s while the socket is down,
//     once a minute while it is up;
//   - the library counters are refreshed every `poll_frequency` seconds.
//
// Logs: info is kept for the lifecycle (start, server reached or lost, user
// actions); a normal refresh cycle writes nothing above debug, and a failure
// repeated at every attempt is logged once, then once when it recovers.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, isConfigured } from './config.js';
import { MediaMonitor } from './monitor.js';
import { ServerSocket } from './media/socket.js';
import { AuthError } from './media/api.js';
import { WIDGET } from './widgets.js';
import { MESSAGES } from './i18n.js';
import { FailureLog } from './failure-log.js';

const logger = createLogger({ name: 'jellyfin' });

const NOT_CONNECTED_ERROR = 'Jellyfin / Emby server not connected';

// Consecutive session refresh failures before Gladys shows the server as lost.
const FAILURES_BEFORE_LOST = 3;

/**
 * Register the integration on an SDK instance.
 * @param {object} gladys - GladysIntegration (or the fake Gladys of the SDK).
 * @param {{ version?: string, pollTickMs?: number, pollWithSocketMs?: number,
 *   retryDelayMs?: number, createMonitor?: Function, createSocket?: Function }} [options]
 *   The factories and delays are only overridden by the tests.
 */
export function createApp(gladys, options = {}) {
  const {
    version = '0.0.0',
    // Fallback poll of the sessions: every 15 s while the real-time socket is
    // down, once a minute while it is up (the socket pushes every change).
    pollTickMs = 15_000,
    pollWithSocketMs = 60_000,
    // Retry delay after a failed initialization (server down, network...).
    retryDelayMs = 60_000,
    createMonitor = (config) => new MediaMonitor(gladys, config, { version }),
    createSocket = (api, handlers) => new ServerSocket(api, handlers),
  } = options;

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
  let initFailing = false;
  /** Increments on every initialize(): only the newest run may publish. */
  let initGeneration = 0;

  const sessionFailures = new FailureLog(logger, 'Session refresh');
  const libraryFailures = new FailureLog(logger, 'Library refresh');

  const refreshLibraries = (target) =>
    target
      .refreshLibraries()
      .then(() => libraryFailures.ok())
      .catch((err) => libraryFailures.fail(err.message));

  // --- Discovery: Gladys asks for the list of devices ------------------------
  gladys.onScanRequest(async () => {
    if (!monitor) {
      logger.warn('onScanRequest ignored: the server is not connected yet');
      return;
    }
    await monitor.refreshSessions().catch(() => {});
    logger.info(`onScanRequest -> publishing ${monitor.players.size + 1} devices`);
    await gladys.publishDiscoveredDevices(monitor.buildDevices());
  });

  // --- Command: the user acts on a controllable feature ----------------------
  // The monitor logs the command it sends: one info line per user action.
  gladys.onSetValue(async (device, feature, value) => {
    logger.debug(`onSetValue <- ${feature.external_id} = ${value}`);
    if (!monitor) {
      throw new Error(NOT_CONNECTED_ERROR);
    }
    await monitor.handleSetValue(device, feature, value);
  });

  // --- Device created: the user added a discovered device --------------------
  // The states published while the device did not exist in Gladys were
  // dropped, and the deduplication would never resend them: forget what was
  // published for this device and refresh everything right away.
  gladys.onDeviceCreated(async (device) => {
    logger.info(`onDeviceCreated <- ${device.external_id}`);
    if (!monitor) {
      return;
    }
    monitor.resetPublicationCache(device.external_id);
    monitor.scheduleSessionRefresh();
    await refreshLibraries(monitor);
  });

  // --- Polling ----------------------------------------------------------------
  // Every device is published with `should_poll: false`: the core never calls
  // this (Gladys 5.2.0 only polls `should_poll: true` devices, see Gladys
  // #3198). Kept as a harmless fallback: it only asks for a session refresh.
  gladys.onPoll(async () => {
    monitor?.scheduleSessionRefresh();
  });

  // --- Manifest actions: buttons in the Configuration screen -----------------
  gladys.onAction('test_connection', async () => {
    const testConfig = normalizeConfig(await gladys.getConfig());
    if (!isConfigured(testConfig)) {
      return MESSAGES.notConfigured;
    }
    const testMonitor = createMonitor(testConfig);
    try {
      await testMonitor.init();
    } catch (err) {
      if (err instanceof AuthError) {
        return MESSAGES.authRefused;
      }
      throw err;
    }
    const { name, version: serverVersion } = testMonitor.server;
    const libraries = testMonitor.libraries.length;
    const players = testMonitor.players.size;
    return MESSAGES.connected({
      name,
      label: testMonitor.label,
      version: serverVersion,
      libraries,
      players,
    });
  });

  gladys.onAction('scan_players', async () => {
    if (!monitor) {
      return MESSAGES.notConfigured;
    }
    await monitor.refreshSessions();
    await gladys.publishDiscoveredDevices(monitor.buildDevices());
    return MESSAGES.playersKnown(monitor.players.size);
  });

  // --- Scene actions ----------------------------------------------------------
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

  // --- Dashboard widgets ------------------------------------------------------
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

  gladys.onWidgetGet(WIDGET.PLAYER, async ({ settings, language }) => {
    if (!monitor) {
      return { components: [] };
    }
    return monitor.playerContent(language, settings?.player);
  });

  gladys.onWidgetAction(WIDGET.PLAYER, async (actionKey, params) => {
    if (!monitor) {
      throw new Error(NOT_CONNECTED_ERROR);
    }
    await monitor.widgetAction(actionKey, params);
  });

  gladys.onWidgetGetImage(async (imageKey) => {
    if (!monitor) {
      throw new Error(NOT_CONNECTED_ERROR);
    }
    return monitor.widgetImage(imageKey);
  });

  // --- Configuration updated by the user -------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('onConfigUpdated -> new configuration received');
    config = normalizeConfig(newConfig);
    // The server address or key may have changed: rebuild everything.
    await initialize();
  });

  // --- Connection lifecycle --------------------------------------------------
  gladys.on('connected', async () => {
    config = normalizeConfig(await gladys.getConfig());
    await initialize();
  });

  gladys.on('disconnected', () => {
    stopLoops();
  });

  /**
   * (Re)connect to the media server, publish the devices and start the
   * refresh loops. Reports the application-level connection status either way.
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
      await gladys.setConnectionStatus(false, MESSAGES.notConfigured).catch(() => {});
      return;
    }

    try {
      const nextMonitor = createMonitor(config);
      await nextMonitor.init();
      if (isStale()) {
        nextMonitor.stop();
        return;
      }
      monitor = nextMonitor;
      initFailing = false;

      // Publish the devices (idempotent upsert by external_id).
      await gladys.publishDiscoveredDevices(monitor.buildDevices());
      await refreshLibraries(monitor);
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
        initFailing = false;
        logger.error(`Initialization failed: ${err.message}`);
        await gladys.setConnectionStatus(false, MESSAGES.authRefused).catch(() => {});
        return;
      }
      // A server switched off for the night retries every minute: one line
      // for the first failure, the next ones in debug; the "Connected to"
      // line of the monitor marks the recovery.
      if (initFailing) {
        logger.debug(`Initialization still failing: ${err.message} (new attempt in 1 min)`);
      } else {
        initFailing = true;
        logger.error(
          `Initialization failed: ${err.message} (new attempt every minute, next failures in debug only)`,
        );
      }
      await gladys.setConnectionStatus(false, MESSAGES.unreachable(err.message)).catch(() => {});
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!isStale()) {
          initialize();
        }
      }, retryDelayMs);
    }
  }

  /** Start the real-time socket, the fallback session poll and the library poll. */
  function startLoops() {
    const current = monitor;
    socket = createSocket(current.api, {
      allowSelfSigned: config.allow_self_signed,
      onSessions: (sessions) => {
        handleSessions(current.applySessions(sessions));
      },
      onLibraryChanged: () => {
        refreshLibraries(current);
        current.requestWidgetRefresh(WIDGET.LATEST_MEDIA);
      },
    });
    socket.start();

    lastPollAt = Date.now();
    pollInterval = setInterval(() => {
      const interval = socket?.isOpen ? pollWithSocketMs : pollTickMs;
      if (Date.now() - lastPollAt >= interval - Math.min(1_000, pollTickMs / 2)) {
        lastPollAt = Date.now();
        handleSessions(current.refreshSessions());
      }
    }, pollTickMs);

    libraryInterval = setInterval(() => refreshLibraries(current), config.poll_frequency * 1_000);
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
      if (consecutiveFailures >= FAILURES_BEFORE_LOST) {
        await gladys.setConnectionStatus(true).catch(() => {});
      }
      consecutiveFailures = 0;
      sessionFailures.ok();
    } catch (err) {
      if (err instanceof AuthError) {
        // The key was revoked: stop everything until a new one is saved.
        logger.error(`Session refresh refused: ${err.message}`);
        stopLoops();
        await gladys.setConnectionStatus(false, MESSAGES.authRefused).catch(() => {});
        return;
      }
      consecutiveFailures += 1;
      sessionFailures.fail(err.message);
      if (consecutiveFailures === FAILURES_BEFORE_LOST) {
        await gladys.setConnectionStatus(false, MESSAGES.contactLost(err.message)).catch(() => {});
      }
    }
  }

  return {
    /** The monitor of the connected server (null until reached). */
    get monitor() {
      return monitor;
    },
    /** Stop every loop and timer (graceful shutdown, tests). */
    stop() {
      initGeneration += 1;
      stopLoops();
      monitor?.stop();
    },
  };
}
