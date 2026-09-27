// -----------------------------------------------------------------------------
// MediaMonitor: the state of ONE Jellyfin / Emby server and everything
// published to Gladys.
//
// It owns the API client, the libraries, the players known so far and their
// latest sessions. index.js wires the SDK events and the socket to it:
//   - init()             : first contact (identity, API key check, libraries,
//                          players);
//   - buildDevices()     : discovery payload (server device + player devices);
//   - applySessions(raw) : process a session list (poll OR socket push):
//                          publish playback states, fire scene triggers;
//   - refreshLibraries() : poll the library item counts;
//   - handleSetValue()   : run a user command on a player;
//   - displayMessage() / playMedia() : the scene actions;
//   - nowPlayingContent() / latestContent() / widgetImage() : the widgets.
//
// States are deduplicated before publishing: the socket pushes the full
// session list every time anything changes, most values are unchanged.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { MediaServerApi } from './media/api.js';
import {
  normalizeSession,
  normalizeItem,
  isPlayerSession,
  formatTitle,
  remainingMinutes,
  isInMarker,
  buildActivitySummary,
  truncate,
  MAX_TEXT_LENGTH,
} from './media/sessions.js';
import {
  buildServerDevice,
  serverExternalIds,
  libraryFeatureKey,
  LIBRARY_COUNTERS,
  SERVER_FEATURE,
} from './devices/server.js';
import {
  buildPlayerDevice,
  playerExternalIds,
  playerFeatureKey,
  extractPlayerKey,
  playerDeviceName,
  PLAYER_FEATURE,
  PLAYER_PLAYSTATE_COMMANDS,
} from './devices/player.js';
import { diffPlayback, playbackOf, buildEventData } from './scene-events.js';
import {
  WIDGET,
  LATEST_KINDS,
  buildNowPlayingContent,
  buildLatestContent,
  imageKey,
} from './widgets.js';
import { texts } from './i18n.js';

const logger = createLogger({ name: 'media-monitor' });

// Media that can carry intro/credits markers.
const MARKER_ITEM_TYPES = new Set(['Movie', 'Episode']);
const MARKER_CACHE_MAX_ENTRIES = 100;

// Poster width requested from the server: a list thumbnail or a grid poster
// renders under 300 px, and the core refuses anything over 300 KB.
const POSTER_WIDTH = 300;
const MAX_WIDGET_IMAGE_BYTES = 300 * 1024;
const MAX_REGISTERED_IMAGES = 200;

/** Item types searched by the play_media scene action, per `media_type` field. */
export const PLAY_MEDIA_TYPES = {
  any: ['Movie', 'Series', 'MusicAlbum', 'Playlist', 'MusicArtist', 'Episode', 'Audio'],
  movie: ['Movie'],
  series: ['Series'],
  episode: ['Episode'],
  album: ['MusicAlbum'],
  artist: ['MusicArtist'],
  playlist: ['Playlist'],
  song: ['Audio'],
};

export class MediaMonitor {
  /**
   * @param {object} gladys - SDK instance.
   * @param {ReturnType<import('./config.js').normalizeConfig>} config
   * @param {{ version?: string }} [options]
   */
  constructor(gladys, config, options = {}) {
    this.gladys = gladys;
    this.config = config;
    this.api = new MediaServerApi(config, options);
    /** @type {{ kind: string, id: string, name: string, version: string }|null} */
    this.server = null;
    this.libraries = [];
    /** @type {Map<string, { key: string, deviceId: string, deviceName: string, client: string }>} */
    this.players = new Map();
    /** @type {Map<string, object>} Latest session of each connected player, by player key. */
    this.sessions = new Map();
    /** @type {Map<string, { itemId: string, paused: boolean }>} Playback snapshot, by player key. */
    this.playback = new Map();
    this.hasBaseline = false;
    /** @type {Map<string, Array<object>>} Intro/credits markers by item id. */
    this.markerCache = new Map();
    /** @type {Map<string, number|string>} Last published value by feature external id. */
    this.lastPublished = new Map();
    /** @type {Map<string, { itemId: string, tag: string }>} Artwork by widget image key. */
    this.artworks = new Map();
    this.refreshTimer = null;
    // Session lists are processed one at a time: a poll and a socket push
    // arriving together must not interleave (duplicate scene events).
    this.queue = Promise.resolve();
  }

  /**
   * First contact with the server. Throws when it is unreachable, is not a
   * Jellyfin/Emby server, or refuses the API key (AuthError).
   */
  async init() {
    const detected = await this.api.detect();
    // Authenticated call: validates the API key before anything else.
    const info = await this.api.getSystemInfo();
    this.server = {
      kind: detected.kind,
      id: String(info?.Id ?? detected.id),
      name: info?.ServerName ?? detected.name,
      version: info?.Version ?? detected.version,
    };
    logger.info(
      `Connected to ${this.label} server "${this.server.name}" (v${this.server.version})`,
    );
    this.libraries = await this.api.getLibraries();
    await this.applySessions(await this.api.getSessions());
  }

  /** "Jellyfin" or "Emby". */
  get label() {
    return this.server?.kind === 'jellyfin' ? 'Jellyfin' : 'Emby';
  }

  /** Server description for the widget links. */
  get serverRef() {
    return { baseUrl: this.api.baseUrl, kind: this.server.kind, serverId: this.server.id };
  }

  /** Discovery payload: the server device + one device per known player. */
  buildDevices() {
    const devices = [buildServerDevice(this.gladys, this.server, this.libraries, this.config)];
    for (const player of this.players.values()) {
      devices.push(buildPlayerDevice(this.gladys, this.server.kind, player, this.config.language));
    }
    return devices;
  }

  /** Poll the session list and process it. */
  async refreshSessions() {
    return this.applySessions(await this.api.getSessions());
  }

  /**
   * Process a session list (a poll result or a socket push).
   * @param {Array<object>} rawSessions
   * @returns {Promise<boolean>} True when a never-seen player appeared (the
   *   caller should republish the discovered devices).
   */
  applySessions(rawSessions) {
    const run = this.queue.then(() => this.processSessions(rawSessions));
    // Keep the chain alive whatever happens to this run.
    this.queue = run.catch(() => {});
    return run;
  }

  async processSessions(rawSessions) {
    const sessions = rawSessions.map(normalizeSession).filter(isPlayerSession);

    let newPlayers = false;
    for (const session of sessions) {
      newPlayers = this.rememberPlayer(session) || newPlayers;
    }
    const previousSessions = this.sessions;
    this.sessions = new Map(sessions.map((session) => [session.key, session]));

    await this.publishPlaybackStates(sessions);
    await this.fireSceneEvents(previousSessions);
    return newPlayers;
  }

  /**
   * Publish the states of every player and of the server device.
   * @param {Array<object>} sessions - Normalized player sessions.
   */
  async publishPlaybackStates(sessions) {
    const t = texts(this.config.language);
    const states = [];
    const textStates = [];

    for (const player of this.players.values()) {
      const ids = playerExternalIds(this.gladys, player.key);
      const session = this.sessions.get(player.key);
      const item = session?.item ?? null;
      const markers = item ? await this.getMarkers(item) : [];
      const position = session?.positionTicks ?? 0;

      this.collectIfChanged(
        states,
        ids.feature(PLAYER_FEATURE.PLAYBACK_STATE),
        session?.state === 'playing' ? 1 : 0,
      );
      this.collectIfChanged(
        states,
        ids.feature(PLAYER_FEATURE.REMAINING),
        item ? remainingMinutes(session) : 0,
      );
      this.collectIfChanged(
        states,
        ids.feature(PLAYER_FEATURE.IN_INTRO),
        item && isInMarker(markers, 'intro', position) ? 1 : 0,
      );
      this.collectIfChanged(
        states,
        ids.feature(PLAYER_FEATURE.IN_CREDITS),
        item && isInMarker(markers, 'credits', position) ? 1 : 0,
      );
      if (session && session.volume !== null) {
        this.collectIfChanged(states, ids.feature(PLAYER_FEATURE.VOLUME), session.volume);
      }
      if (session) {
        this.collectIfChanged(states, ids.feature(PLAYER_FEATURE.MUTE), session.muted ? 1 : 0);
      }
      textStates.push([
        ids.feature(PLAYER_FEATURE.NOW_PLAYING),
        item ? truncate(formatTitle(item), MAX_TEXT_LENGTH) : t.idle,
      ]);
    }

    const serverIds = serverExternalIds(this.gladys, this.server.id);
    const active = sessions.filter((session) => session.item);
    this.collectIfChanged(states, serverIds.feature(SERVER_FEATURE.ACTIVE_STREAMS), active.length);
    this.collectIfChanged(
      states,
      serverIds.feature(SERVER_FEATURE.TRANSCODE_SESSIONS),
      active.filter((session) => session.transcoding).length,
    );
    textStates.push([
      serverIds.feature(SERVER_FEATURE.NOW_PLAYING),
      buildActivitySummary(active) || t.idle,
    ]);

    if (states.length > 0) {
      await this.gladys.publishStates(states);
    }
    for (const [featureExternalId, text] of textStates) {
      await this.publishTextIfChanged(featureExternalId, text);
    }
  }

  /**
   * Compare the playback of every player with the previous snapshot and fire
   * the matching scene triggers (see scene-events.js).
   * @param {Map<string, object>} previousSessions - Sessions of the previous snapshot.
   */
  async fireSceneEvents(previousSessions) {
    const current = new Map();
    for (const [key, session] of this.sessions) {
      const playback = playbackOf(session);
      if (playback) {
        current.set(key, playback);
      }
    }
    const events = this.hasBaseline ? diffPlayback(this.playback, current) : [];
    this.playback = current;
    this.hasBaseline = true;
    if (events.length === 0) {
      return;
    }

    for (const { trigger, key } of events) {
      // A stopped player may have vanished from the list: describe the media
      // it was playing in the previous snapshot.
      const session = this.sessions.get(key)?.item
        ? this.sessions.get(key)
        : previousSessions.get(key);
      const player = this.players.get(key);
      if (!session?.item || !player) {
        continue;
      }
      const data = buildEventData(
        playerExternalIds(this.gladys, key).device,
        session,
        playerDeviceName(this.server.kind, player),
      );
      logger.info(`Scene event ${trigger}: ${data.title} on ${player.deviceName}`);
      await this.gladys.publishSceneEvent(trigger, data).catch((err) => {
        // Older Gladys (no scene declarations) or rate limit: never fatal.
        logger.debug(`publishSceneEvent(${trigger}) failed: ${err.message}`);
      });
    }
    this.requestWidgetRefresh(WIDGET.NOW_PLAYING);
  }

  /** Ask the dashboards to re-pull a widget now (never fatal). */
  requestWidgetRefresh(key) {
    if (typeof this.gladys.requestWidgetRefresh !== 'function') {
      return;
    }
    Promise.resolve()
      .then(() => this.gladys.requestWidgetRefresh(key))
      .catch((err) => logger.debug(`requestWidgetRefresh(${key}) failed: ${err.message}`));
  }

  /** Poll the item counts of every library and publish them. */
  async refreshLibraries() {
    if (!this.config.library_sensors) {
      return;
    }
    this.libraries = await this.api.getLibraries();
    const serverIds = serverExternalIds(this.gladys, this.server.id);
    const states = [];
    for (const library of this.libraries) {
      const counters = LIBRARY_COUNTERS[library.collectionType];
      const count = counters
        ? await this.api.countItems(library.id, { types: counters.main })
        : await this.api.countItems(library.id, { isFolder: false });
      this.collectIfChanged(states, serverIds.feature(libraryFeatureKey(library, 'count')), count);
      if (counters?.extra) {
        const extra = await this.api.countItems(library.id, { types: counters.extra.types });
        this.collectIfChanged(
          states,
          serverIds.feature(libraryFeatureKey(library, counters.extra.kind)),
          extra,
        );
      }
    }
    if (states.length > 0) {
      await this.gladys.publishStates(states);
    }
  }

  // --- Commands ----------------------------------------------------------------

  /**
   * The current session of a player device, or a clear error.
   * @param {string} deviceExternalId
   */
  sessionOf(deviceExternalId) {
    const key = extractPlayerKey(deviceExternalId);
    if (!key) {
      throw new Error(`Not a player device: ${deviceExternalId}`);
    }
    const session = this.sessions.get(key);
    if (!session) {
      const name = this.players.get(key)?.deviceName ?? 'This player';
      throw new Error(
        `${name} is not connected to the ${this.label} server right now: open the app on it first.`,
      );
    }
    return session;
  }

  /**
   * Run a user command on a player device.
   * @param {{ external_id: string }} device
   * @param {{ external_id: string }} feature
   * @param {number} value
   */
  async handleSetValue(device, feature, value) {
    const session = this.sessionOf(device.external_id);
    const ids = playerExternalIds(this.gladys, session.key);
    const key = playerFeatureKey(feature.external_id, ids);

    if (key === PLAYER_FEATURE.PLAY) {
      await this.api.sendPlaystate(session.sessionId, 'Unpause');
    } else if (PLAYER_PLAYSTATE_COMMANDS[key]) {
      await this.api.sendPlaystate(session.sessionId, PLAYER_PLAYSTATE_COMMANDS[key]);
    } else if (key === PLAYER_FEATURE.VOLUME) {
      const volume = Math.max(0, Math.min(100, Math.round(Number(value))));
      await this.api.sendGeneralCommand(session.sessionId, 'SetVolume', { Volume: String(volume) });
      await this.publishNow(feature.external_id, volume);
    } else if (key === PLAYER_FEATURE.MUTE) {
      // Gladys renders mute as a push button (it always sends 1): the feature
      // behaves as a TOGGLE of the state the player reports.
      const muted = !session.muted;
      await this.api.sendGeneralCommand(session.sessionId, muted ? 'Mute' : 'Unmute');
      await this.publishNow(feature.external_id, muted ? 1 : 0);
    } else {
      throw new Error(`No command handler for ${feature.external_id}`);
    }
    logger.info(`Command ${key} sent to ${session.deviceName}`);

    // The socket pushes the new state within ~1.5 s; the refresh covers a
    // server whose socket is down.
    this.scheduleSessionRefresh(1_500);
  }

  /**
   * Scene action: show a message on a player's screen.
   * @param {{ player: string, text: string, header?: string, duration?: number }} fields
   */
  async displayMessage(fields) {
    const session = this.sessionOf(fields.player);
    if (
      session.supportedCommands.length > 0 &&
      !session.supportedCommands.includes('DisplayMessage')
    ) {
      throw new Error(`${session.deviceName} cannot display messages (${session.client}).`);
    }
    const seconds = Math.max(1, Math.min(300, Math.round(Number(fields.duration) || 10)));
    await this.api.sendMessage(session.sessionId, {
      header: String(fields.header ?? '').trim() || 'Gladys',
      text: String(fields.text ?? '').trim(),
      timeoutMs: seconds * 1_000,
    });
    logger.info(`Message displayed on ${session.deviceName}`);
  }

  /**
   * Scene action: search the library and play the best match on a player.
   * @param {{ player: string, query: string, media_type?: string, shuffle?: boolean }} fields
   * @returns {Promise<{ title: string }>}
   */
  async playMedia(fields) {
    const session = this.sessionOf(fields.player);
    const query = String(fields.query ?? '').trim();
    if (!query) {
      throw new Error('Nothing to search: the "Title" field is empty.');
    }
    const types = PLAY_MEDIA_TYPES[fields.media_type] ?? PLAY_MEDIA_TYPES.any;
    const results = (await this.api.searchItems(query, types)).map(normalizeItem).filter(Boolean);
    const best = pickBestMatch(results, query, types);
    if (!best) {
      throw new Error(`Nothing named "${query}" in the ${this.label} library.`);
    }
    const shuffle = fields.shuffle === true || fields.shuffle === 'true';
    await this.api.playItems(session.sessionId, [best.id], shuffle ? 'PlayShuffle' : 'PlayNow');
    const title = formatTitle(best);
    logger.info(`Playing "${title}" on ${session.deviceName}`);
    this.scheduleSessionRefresh(2_000);
    return { title };
  }

  // --- Widgets -----------------------------------------------------------------

  /**
   * Record an artwork and return its widget image key.
   * @param {{ itemId: string, tag: string }} artwork
   */
  registerArtwork(artwork) {
    const key = imageKey(artwork);
    this.artworks.delete(key);
    this.artworks.set(key, artwork);
    while (this.artworks.size > MAX_REGISTERED_IMAGES) {
      this.artworks.delete(this.artworks.keys().next().value);
    }
    return key;
  }

  /**
   * Content of the now_playing widget.
   * @param {string} language
   */
  nowPlayingContent(language) {
    const serverIds = serverExternalIds(this.gladys, this.server.id);
    return buildNowPlayingContent({
      sessions: [...this.sessions.values()],
      streamsFeature: serverIds.feature(SERVER_FEATURE.ACTIVE_STREAMS),
      transcodesFeature: serverIds.feature(SERVER_FEATURE.TRANSCODE_SESSIONS),
      language,
      register: (artwork) => this.registerArtwork(artwork),
    });
  }

  /**
   * Content of the latest_media widget.
   * @param {string} language
   * @param {string} [kind] - `kind` setting of the widget instance.
   */
  async latestContent(language, kind) {
    const types = LATEST_KINDS[kind] ?? LATEST_KINDS.all;
    // Episodes come in batches: over-fetch so grouping them by series still
    // fills the grid.
    const raw = await this.api.getLatestItems(types, 60);
    return buildLatestContent({
      items: raw.map(normalizeItem).filter(Boolean),
      language,
      server: this.serverRef,
      register: (artwork) => this.registerArtwork(artwork),
    });
  }

  /**
   * Raw base64 of a widget image.
   * @param {string} key - Image key of a content built by this monitor.
   */
  async widgetImage(key) {
    const artwork = this.artworks.get(key);
    if (!artwork) {
      throw new Error(`Unknown image ${key}`);
    }
    let width = POSTER_WIDTH;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const bytes = await this.api.getPrimaryImage(artwork.itemId, width);
      if (!bytes) {
        throw new Error(`No artwork for ${artwork.itemId}`);
      }
      if (bytes.length <= MAX_WIDGET_IMAGE_BYTES) {
        return bytes.toString('base64');
      }
      width = Math.round(width * 0.7);
    }
    throw new Error(`Artwork of ${artwork.itemId} too large`);
  }

  // --- Internals ---------------------------------------------------------------

  /**
   * Coalesce refresh requests.
   * @param {number} [delayMs]
   */
  scheduleSessionRefresh(delayMs = 500) {
    if (this.refreshTimer) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshSessions().catch((err) => logger.warn(`Session refresh failed: ${err.message}`));
    }, delayMs);
  }

  /** Stop the pending timers (disconnection, shutdown). */
  stop() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  /**
   * Track a player seen in a session.
   * @param {object} session - Normalized player session.
   * @returns {boolean} True when the player was never seen before.
   */
  rememberPlayer(session) {
    const known = this.players.get(session.key);
    if (known) {
      // Names may change (a renamed device): keep the freshest.
      known.deviceName = session.deviceName;
      known.client = session.client;
      return false;
    }
    this.players.set(session.key, {
      key: session.key,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      client: session.client,
    });
    logger.info(`New player discovered: ${session.deviceName} (${session.client})`);
    return true;
  }

  /**
   * Intro/credits markers of an item (cached per item, failures included).
   * @param {ReturnType<typeof normalizeItem>} item
   */
  async getMarkers(item) {
    if (!MARKER_ITEM_TYPES.has(item.type)) {
      return [];
    }
    if (!this.markerCache.has(item.id)) {
      let markers = [];
      try {
        markers = await this.api.getMarkers(item.id, item.runTimeTicks);
      } catch (err) {
        logger.debug(`Marker fetch failed for ${item.id}: ${err.message}`);
      }
      this.markerCache.set(item.id, markers);
      while (this.markerCache.size > MARKER_CACHE_MAX_ENTRIES) {
        this.markerCache.delete(this.markerCache.keys().next().value);
      }
    }
    return this.markerCache.get(item.id);
  }

  /**
   * Forget the last published values, so the next refresh republishes
   * everything. Called when a device is created in Gladys: the states
   * published while it did not exist yet were dropped.
   * @param {string} [externalIdPrefix] - Only forget the features of this device.
   */
  resetPublicationCache(externalIdPrefix) {
    if (!externalIdPrefix) {
      this.lastPublished.clear();
      return;
    }
    for (const key of this.lastPublished.keys()) {
      if (key.startsWith(`${externalIdPrefix}:`)) {
        this.lastPublished.delete(key);
      }
    }
  }

  /** Append a numeric state to the batch only when it changed. */
  collectIfChanged(states, featureExternalId, value) {
    if (this.lastPublished.get(featureExternalId) === value) {
      return;
    }
    this.lastPublished.set(featureExternalId, value);
    states.push({ device_feature_external_id: featureExternalId, state: value });
  }

  /** Publish a numeric state right away (command feedback). */
  async publishNow(featureExternalId, value) {
    this.lastPublished.set(featureExternalId, value);
    await this.gladys.publishState(featureExternalId, value);
  }

  /** Publish a text state only when it changed. */
  async publishTextIfChanged(featureExternalId, text) {
    if (this.lastPublished.get(featureExternalId) === text) {
      return;
    }
    this.lastPublished.set(featureExternalId, text);
    await this.gladys.publishState(featureExternalId, { text });
  }
}

/**
 * Accent- and case-insensitive form of a title, for matching.
 * @param {string} value
 */
export function foldTitle(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Best search result for a query: an exact title first, then a title that
 * starts with the query, then the server's first result — ties broken by the
 * order of the requested types (a movie before a track of the same name).
 * @param {Array<ReturnType<typeof normalizeItem>>} results
 * @param {string} query
 * @param {string[]} types - Requested item types, preferred first.
 */
export function pickBestMatch(results, query, types) {
  if (results.length === 0) {
    return null;
  }
  const wanted = foldTitle(query);
  const rank = (item) => {
    const index = types.indexOf(item.type);
    return index === -1 ? types.length : index;
  };
  const byType = [...results].sort((a, b) => rank(a) - rank(b));
  return (
    byType.find((item) => foldTitle(item.name) === wanted) ??
    byType.find((item) => foldTitle(item.name).startsWith(wanted)) ??
    results[0]
  );
}
