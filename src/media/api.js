// -----------------------------------------------------------------------------
// Jellyfin / Emby HTTP API client.
//
// Jellyfin is a 2018 fork of Emby: both servers still share the REST API this
// integration needs (sessions, remote control, libraries, items, images). The
// differences that matter, all verified on Jellyfin 10.11 and 12.1 and on
// Emby 4.10:
//
//   - authentication: the `Authorization: MediaBrowser ..., Token="<key>"`
//     header is the ONE method both accept. Jellyfin 12 disables the legacy
//     ones by default (`X-Emby-Token`, `?api_key=`), Emby ignores `?ApiKey=`;
//   - identification: only Jellyfin reports a `ProductName` in
//     `/System/Info/Public`;
//   - real-time socket path and intro/credits markers (see socket.js and
//     getMarkers below).
//
// Every request carries the same client identity (DeviceId): the servers list
// the API key's calls as a session of their own, and the monitor recognizes
// and skips it by that id.
// -----------------------------------------------------------------------------

export const SERVER_KIND = {
  JELLYFIN: 'jellyfin',
  EMBY: 'emby',
};

/** Human label of each server kind (device names, messages). */
export const SERVER_LABEL = {
  [SERVER_KIND.JELLYFIN]: 'Jellyfin',
  [SERVER_KIND.EMBY]: 'Emby',
};

/** Media positions and durations are expressed in 100 ns ticks. */
export const TICKS_PER_SECOND = 10_000_000;

/** Client identity announced to the server (it shows in its device list). */
export const CLIENT_NAME = 'Gladys Assistant';
export const CLIENT_DEVICE_NAME = 'Gladys';
export const CLIENT_DEVICE_ID = 'gladys-assistant-integration';

const REQUEST_TIMEOUT_MS = 10_000;

// Commands get a shorter budget: Gladys expects the acknowledgement of a
// device command within 5 s.
const COMMAND_TIMEOUT_MS = 4_000;

/** The server refused the API key (HTTP 401 / 403). */
export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Any other HTTP error, with its status. */
export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class MediaServerApi {
  /**
   * @param {{ server_url: string, api_key: string, allow_self_signed?: boolean }} config
   * @param {{ version?: string }} [options]
   */
  constructor(config, { version = '1.0.0' } = {}) {
    this.baseUrl = config.server_url;
    this.apiKey = config.api_key;
    this.version = version;
    /** @type {'jellyfin'|'emby'|null} Known after detect(). */
    this.kind = null;
    if (config.allow_self_signed && this.baseUrl.startsWith('https://')) {
      // Native fetch offers no per-request TLS option. The integration runs
      // alone in its sandboxed container and only ever talks to the media
      // server (the Gladys host API is plain http), so relaxing TLS
      // verification process-wide is acceptable here.
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  /** Value of the `Authorization` header (see the file header). */
  authorizationHeader() {
    return (
      `MediaBrowser Client="${CLIENT_NAME}", Device="${CLIENT_DEVICE_NAME}", ` +
      `DeviceId="${CLIENT_DEVICE_ID}", Version="${this.version}", Token="${this.apiKey}"`
    );
  }

  /**
   * Perform one request and return the parsed JSON (null for an empty body),
   * or the raw bytes when `binary` is set.
   * @param {string} method
   * @param {string} path - API path, starting with '/'.
   * @param {{ query?: Record<string, unknown>, body?: object, timeoutMs?: number,
   *   binary?: boolean, auth?: boolean }} [options]
   */
  async request(method, path, options = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null) {
        continue;
      }
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    const headers = { Accept: options.binary ? 'image/*' : 'application/json' };
    if (options.auth !== false) {
      headers.Authorization = this.authorizationHeader();
    }
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err.cause?.code ?? err.cause?.message ?? err.message;
      throw new Error(`server unreachable at ${this.baseUrl} (${reason})`, { cause: err });
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`API key refused by the server (HTTP ${response.status})`);
    }
    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status} on ${method} ${path}`, response.status);
    }
    if (options.binary) {
      return {
        contentType: response.headers.get('content-type') ?? '',
        bytes: Buffer.from(await response.arrayBuffer()),
      };
    }
    const text = await response.text();
    if (text.length === 0) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      // A reverse proxy error page, a web client answering instead of the API...
      throw new Error(
        `unexpected answer on ${path}: this address does not look like a Jellyfin or Emby server`,
      );
    }
  }

  /**
   * Identify the server without credentials: Jellyfin or Emby, name, version.
   * @returns {Promise<{ kind: 'jellyfin'|'emby', id: string, name: string, version: string }>}
   */
  async detect() {
    const info = await this.request('GET', '/System/Info/Public', { auth: false });
    if (!info || typeof info !== 'object' || !info.Id || !info.Version) {
      throw new Error('this address does not look like a Jellyfin or Emby server');
    }
    this.kind = /jellyfin/i.test(info.ProductName ?? '') ? SERVER_KIND.JELLYFIN : SERVER_KIND.EMBY;
    return { kind: this.kind, id: info.Id, name: info.ServerName ?? '', version: info.Version };
  }

  /**
   * Authenticated server information: also validates the API key.
   * @returns {Promise<object>}
   */
  getSystemInfo() {
    return this.request('GET', '/System/Info');
  }

  /** Every session the server knows (players, web clients, API clients). */
  async getSessions() {
    const sessions = await this.request('GET', '/Sessions');
    return Array.isArray(sessions) ? sessions : [];
  }

  /** The libraries ("virtual folders") of the server. */
  async getLibraries() {
    const folders = await this.request('GET', '/Library/VirtualFolders');
    return (Array.isArray(folders) ? folders : [])
      .filter((folder) => folder.ItemId)
      .map((folder) => ({
        id: String(folder.ItemId),
        name: folder.Name ?? String(folder.ItemId),
        collectionType: folder.CollectionType ?? 'mixed',
      }));
  }

  /**
   * Count the items of a library without downloading them (`Limit=0`).
   * @param {string} parentId - Library id.
   * @param {{ types?: string[], isFolder?: boolean }} filter
   * @returns {Promise<number>}
   */
  async countItems(parentId, { types, isFolder } = {}) {
    const data = await this.request('GET', '/Items', {
      query: {
        ParentId: parentId,
        Recursive: true,
        IncludeItemTypes: types,
        IsFolder: isFolder,
        Limit: 0,
      },
    });
    return Number(data?.TotalRecordCount ?? 0);
  }

  /**
   * Episodes of a series, in watching order.
   * @param {string} seriesId
   * @param {{ startItemId?: string, limit?: number }} [range] - From an episode
   *   (included), and how many.
   */
  async getEpisodes(seriesId, { startItemId, limit } = {}) {
    const data = await this.request('GET', `/Shows/${encodeURIComponent(seriesId)}/Episodes`, {
      query: { StartItemId: startItemId, Limit: limit, EnableImages: false, EnableUserData: false },
    });
    return data?.Items ?? [];
  }

  /**
   * Most recently added items.
   * @param {string[]} types - Item types (Movie, Episode, MusicAlbum...).
   * @param {number} limit
   */
  async getLatestItems(types, limit) {
    const data = await this.request('GET', '/Items', {
      query: {
        Recursive: true,
        IncludeItemTypes: types,
        SortBy: 'DateCreated',
        SortOrder: 'Descending',
        Fields: 'Overview,DateCreated,ProductionYear,PrimaryImageAspectRatio',
        Limit: limit,
      },
    });
    return data?.Items ?? [];
  }

  /**
   * Search the library by name.
   * @param {string} term
   * @param {string[]} types
   * @param {number} [limit]
   */
  async searchItems(term, types, limit = 20) {
    const data = await this.request('GET', '/Items', {
      query: {
        searchTerm: term,
        Recursive: true,
        IncludeItemTypes: types,
        Fields: 'ProductionYear',
        Limit: limit,
      },
    });
    return data?.Items ?? [];
  }

  /**
   * Image of an item, resized server-side to fit a widget.
   * @param {string} itemId
   * @param {'Primary'|'Backdrop'} imageType - Poster / cover, or 16:9 fan art.
   * @param {number} maxWidth
   * @returns {Promise<Buffer|null>} JPEG bytes, or null when the item has no such image.
   */
  async getImage(itemId, imageType, maxWidth) {
    const path = `/Items/${encodeURIComponent(itemId)}/Images/${imageType}${imageType === 'Backdrop' ? '/0' : ''}`;
    try {
      const { bytes } = await this.request('GET', path, {
        query: { maxWidth, quality: 80, format: 'Jpg' },
        binary: true,
      });
      return bytes;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Intro and credits markers of an item, as tick ranges.
   *
   *   - Jellyfin (10.10+): media segments, produced by a segment provider
   *     plugin (Intro Skipper, Chapter Segments Provider...). None without one.
   *   - Emby: chapter markers (`IntroStart`, `IntroEnd`, `CreditsStart`) set by
   *     its intro detection.
   *
   * @param {string} itemId
   * @param {number} [runTimeTicks] - Media duration, closes the credits range.
   * @returns {Promise<Array<{ type: 'intro'|'credits', start: number, end: number }>>}
   */
  async getMarkers(itemId, runTimeTicks) {
    if (this.kind === SERVER_KIND.JELLYFIN) {
      const data = await this.request('GET', `/MediaSegments/${encodeURIComponent(itemId)}`);
      return parseJellyfinSegments(data?.Items ?? []);
    }
    const data = await this.request('GET', '/Items', {
      query: { Ids: itemId, Fields: 'Chapters' },
    });
    return parseEmbyChapterMarkers(data?.Items?.[0]?.Chapters ?? [], runTimeTicks);
  }

  // --- Remote control ---------------------------------------------------------

  /**
   * Playback command: Pause, Unpause, PlayPause, Stop, NextTrack,
   * PreviousTrack, Rewind, FastForward, Seek.
   * @param {string} sessionId
   * @param {string} command
   * @param {Record<string, unknown>} [query]
   */
  sendPlaystate(sessionId, command, query) {
    return this.request('POST', `/Sessions/${encodeURIComponent(sessionId)}/Playing/${command}`, {
      query,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  }

  /**
   * General command: SetVolume, Mute, Unmute, ToggleMute...
   * @param {string} sessionId
   * @param {string} name
   * @param {Record<string, string>} [args]
   */
  sendGeneralCommand(sessionId, name, args = {}) {
    return this.request('POST', `/Sessions/${encodeURIComponent(sessionId)}/Command`, {
      body: { Name: name, Arguments: args },
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  }

  /**
   * Show a message on the player's screen.
   * @param {string} sessionId
   * @param {{ header: string, text: string, timeoutMs: number }} message
   */
  sendMessage(sessionId, { header, text, timeoutMs }) {
    return this.request('POST', `/Sessions/${encodeURIComponent(sessionId)}/Message`, {
      body: { Header: header, Text: text, TimeoutMs: timeoutMs },
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  }

  /**
   * Ask a player to play items.
   * @param {string} sessionId
   * @param {string[]} itemIds
   * @param {'PlayNow'|'PlayShuffle'|'PlayNext'|'PlayLast'} playCommand
   */
  playItems(sessionId, itemIds, playCommand = 'PlayNow') {
    return this.request('POST', `/Sessions/${encodeURIComponent(sessionId)}/Playing`, {
      query: { playCommand, itemIds },
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  }
}

/**
 * Jellyfin media segments -> markers. `Outro` is Jellyfin's name for the
 * end credits.
 * @param {Array<{ Type: string, StartTicks: number, EndTicks: number }>} segments
 */
export function parseJellyfinSegments(segments) {
  const types = { Intro: 'intro', Outro: 'credits' };
  return segments
    .filter((segment) => types[segment.Type] && Number.isFinite(Number(segment.StartTicks)))
    .map((segment) => ({
      type: types[segment.Type],
      start: Number(segment.StartTicks),
      end: Number(segment.EndTicks),
    }));
}

/**
 * Emby chapter markers -> markers. An intro runs from IntroStart to IntroEnd;
 * the credits from CreditsStart to the end of the media.
 * @param {Array<{ MarkerType?: string, StartPositionTicks: number }>} chapters
 * @param {number} [runTimeTicks]
 */
export function parseEmbyChapterMarkers(chapters, runTimeTicks) {
  const find = (type) => chapters.find((chapter) => chapter.MarkerType === type);
  const markers = [];
  const introStart = find('IntroStart');
  const introEnd = find('IntroEnd');
  if (introStart && introEnd) {
    markers.push({
      type: 'intro',
      start: Number(introStart.StartPositionTicks),
      end: Number(introEnd.StartPositionTicks),
    });
  }
  const creditsStart = find('CreditsStart');
  if (creditsStart) {
    markers.push({
      type: 'credits',
      start: Number(creditsStart.StartPositionTicks),
      end: Number(runTimeTicks) || Number.MAX_SAFE_INTEGER,
    });
  }
  return markers;
}
