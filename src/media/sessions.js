// -----------------------------------------------------------------------------
// Session normalization (pure functions, unit-tested).
//
// `/Sessions` (and the real-time `Sessions` socket message, same payload)
// lists every client the server has seen recently: the TV and phone apps, but
// also web dashboards and API clients — this integration included. Only two
// kinds are PLAYERS worth a Gladys device: the ones that accept remote control
// (a TV app, even idle) and the ones currently playing something.
//
// Players are identified by their DeviceId, the only identifier that survives
// a reconnection (the session Id changes every time). It is hashed into the
// Gladys external id: web clients use long base64 DeviceIds full of '=', '/'
// and '+'.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { CLIENT_DEVICE_ID, TICKS_PER_SECOND } from './api.js';

/** Media categories, as exposed to scenes (keys are forever: never rename). */
export const MEDIA_TYPE = {
  MOVIE: 'movie',
  EPISODE: 'episode',
  MUSIC: 'music',
  LIVE_TV: 'live_tv',
  VIDEO: 'video',
  OTHER: 'other',
};

const LIVE_TV_TYPES = new Set([
  'TvChannel',
  'LiveTvChannel',
  'LiveTvProgram',
  'Program',
  'Recording',
]);
const MUSIC_TYPES = new Set(['Audio', 'AudioBook']);

/**
 * Stable, id-safe key of a player, derived from its DeviceId.
 * @param {string} deviceId
 * @returns {string} 16 hex characters.
 */
export function playerKey(deviceId) {
  return createHash('sha256').update(String(deviceId)).digest('hex').slice(0, 16);
}

/**
 * Normalize one raw session, or null when it is not usable (no DeviceId, or
 * the session this integration creates itself by calling the API).
 * @param {object} raw - Session as returned by the server.
 */
export function normalizeSession(raw) {
  if (!raw || !raw.DeviceId || !raw.Id || raw.DeviceId === CLIENT_DEVICE_ID) {
    return null;
  }
  const playState = raw.PlayState ?? {};
  const item = normalizeItem(raw.NowPlayingItem);
  const volume = Number(playState.VolumeLevel);
  return {
    sessionId: String(raw.Id),
    deviceId: String(raw.DeviceId),
    key: playerKey(raw.DeviceId),
    deviceName: raw.DeviceName || raw.Client || String(raw.DeviceId),
    client: raw.Client || '',
    userName: raw.UserName || '',
    controllable: raw.SupportsRemoteControl === true,
    supportedCommands: Array.isArray(raw.SupportedCommands) ? raw.SupportedCommands : [],
    item,
    state: item ? (playState.IsPaused ? 'paused' : 'playing') : 'idle',
    positionTicks: Number(playState.PositionTicks) || 0,
    volume: Number.isFinite(volume) && playState.VolumeLevel !== null ? volume : null,
    muted: playState.IsMuted === true,
    transcoding: playState.PlayMethod === 'Transcode',
  };
}

/**
 * Keep what the integration uses from a `NowPlayingItem` (or a library item).
 * @param {object|undefined} raw
 */
export function normalizeItem(raw) {
  if (!raw || !raw.Id) {
    return null;
  }
  return {
    id: String(raw.Id),
    name: raw.Name ?? '',
    type: raw.Type ?? '',
    mediaType: raw.MediaType ?? '',
    seriesName: raw.SeriesName ?? '',
    seriesId: raw.SeriesId ? String(raw.SeriesId) : null,
    seriesImageTag: raw.SeriesPrimaryImageTag ?? null,
    season: Number.isInteger(raw.ParentIndexNumber) ? raw.ParentIndexNumber : null,
    episode: Number.isInteger(raw.IndexNumber) ? raw.IndexNumber : null,
    year: Number.isInteger(raw.ProductionYear) ? raw.ProductionYear : null,
    artists: Array.isArray(raw.Artists) ? raw.Artists : [],
    albumArtist: raw.AlbumArtist ?? '',
    album: raw.Album ?? '',
    albumId: raw.AlbumId ? String(raw.AlbumId) : null,
    albumImageTag: raw.AlbumPrimaryImageTag ?? null,
    imageTag: raw.ImageTags?.Primary ?? raw.PrimaryImageTag ?? null,
    runTimeTicks: Number(raw.RunTimeTicks) || 0,
    overview: raw.Overview ?? '',
    dateCreated: raw.DateCreated ?? null,
  };
}

/**
 * A session deserves a player device: it accepts remote control, or it is
 * playing something right now.
 * @param {ReturnType<typeof normalizeSession>} session
 */
export function isPlayerSession(session) {
  return Boolean(session) && (session.controllable || session.item !== null);
}

/**
 * Media category of an item, for the scene filters.
 * @param {ReturnType<typeof normalizeItem>} item
 * @returns {string} One of MEDIA_TYPE.
 */
export function mediaCategory(item) {
  if (!item) {
    return MEDIA_TYPE.OTHER;
  }
  if (item.type === 'Movie') {
    return MEDIA_TYPE.MOVIE;
  }
  if (item.type === 'Episode') {
    return MEDIA_TYPE.EPISODE;
  }
  if (LIVE_TV_TYPES.has(item.type)) {
    return MEDIA_TYPE.LIVE_TV;
  }
  if (MUSIC_TYPES.has(item.type) || item.mediaType === 'Audio') {
    return MEDIA_TYPE.MUSIC;
  }
  if (item.mediaType === 'Video') {
    return MEDIA_TYPE.VIDEO;
  }
  return MEDIA_TYPE.OTHER;
}

/**
 * One-line title of an item: "Movie (2008)", "Series - S01E02 - Title",
 * "Artist - Track".
 * @param {ReturnType<typeof normalizeItem>} item
 */
export function formatTitle(item) {
  if (!item) {
    return '';
  }
  if (item.type === 'Episode' && item.seriesName) {
    const code = episodeCode(item);
    return [item.seriesName, code, item.name].filter(Boolean).join(' - ');
  }
  if (mediaCategory(item) === MEDIA_TYPE.MUSIC) {
    const artist = item.artists[0] || item.albumArtist;
    return artist ? `${artist} - ${item.name}` : item.name;
  }
  if (item.type === 'Movie' && item.year) {
    return `${item.name} (${item.year})`;
  }
  return item.name;
}

/**
 * "S01E02", or '' when the numbering is unknown.
 * @param {ReturnType<typeof normalizeItem>} item
 */
export function episodeCode(item) {
  if (item.season === null || item.episode === null) {
    return '';
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `S${pad(item.season)}E${pad(item.episode)}`;
}

/**
 * Whole minutes left in the media being played (0 when unknown).
 * @param {ReturnType<typeof normalizeSession>} session
 */
export function remainingMinutes(session) {
  const runTime = session.item?.runTimeTicks ?? 0;
  if (runTime <= 0) {
    return 0;
  }
  const left = Math.max(0, runTime - session.positionTicks);
  return Math.ceil(left / TICKS_PER_SECOND / 60);
}

/**
 * True when the play position falls inside a marker of the given type.
 * @param {Array<{ type: string, start: number, end: number }>} markers
 * @param {'intro'|'credits'} type
 * @param {number} positionTicks
 */
export function isInMarker(markers, type, positionTicks) {
  return markers.some(
    (marker) => marker.type === type && positionTicks >= marker.start && positionTicks < marker.end,
  );
}

/** Longest text state published (the summary of a busy server is capped). */
export const MAX_TEXT_LENGTH = 250;

/**
 * "who watches what, where" summary of every active playback.
 * @param {Array<ReturnType<typeof normalizeSession>>} sessions
 * @returns {string} '' when nothing plays.
 */
export function buildActivitySummary(sessions) {
  const parts = sessions
    .filter((session) => session.item)
    .map((session) => {
      const who = session.userName ? `${session.userName}: ` : '';
      const paused = session.state === 'paused' ? ' [pause]' : '';
      return `${who}${formatTitle(session.item)} (${session.deviceName})${paused}`;
    });
  return truncate(parts.join(' | '), MAX_TEXT_LENGTH);
}

/**
 * @param {string} text
 * @param {number} max
 */
export function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
