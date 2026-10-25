// -----------------------------------------------------------------------------
// The catalog of the Gladys 5.3 music panel (manifest `music`): browse,
// search, play, and the bytes of the artworks. Read on demand from the
// server's library, never stored. Everything comes back as MediaItems whose
// `id` is `<kind>:<server item id>` (`album:9a8e…`, `track:6f6a…`), opaque to
// Gladys and carried back by a play command and by the `music.play-media`
// scene action; our own root folders use `gladys:`. Library item ids are
// derived from the file paths by the server: they survive a rescan.
//
// What the server gives (checked on Jellyfin 12.2 with jellyfin-web):
//   - `/Items` pages itself (`StartIndex`, `Limit`, `TotalRecordCount`);
//   - a playlist's items are only listed on behalf of a user (`UserId`):
//     the catalog is read as the user signed in on the player, else as the
//     first administrator;
//   - an unknown id in `ArtistIds` is ignored (the whole library comes back):
//     only ids read from the server are ever passed;
//   - `/Sessions/{id}/Playing` (`PlayNow`, `PlayNext`, `PlayLast`) carries
//     item ids in the query string: containers are expanded here into their
//     tracks (an app is not required to expand an album itself), at most
//     MAX_PLAY_ITEMS of them so the request line stays short.
//
// The queue is NOT offered: jellyfin-web reports its play queue late (only
// at the next track) and has no "play the n-th item" command — replaying
// the queue from an index resets repeat and loses the shuffle order.
// -----------------------------------------------------------------------------

import { artworkKey, MUSIC_MEDIA_TYPES } from '@gladysassistant/integration-sdk';
import { TICKS_PER_SECOND } from './media/api.js';
import { texts, localizedError } from './i18n.js';

/** Our root folders: no server item id contains ':'. */
export const ROOTS = {
  albums: 'gladys:albums',
  artists: 'gladys:artists',
  playlists: 'gladys:playlists',
};

/** MediaItem kind of each server item type, and back. */
const KIND_OF_TYPE = {
  Audio: MUSIC_MEDIA_TYPES.TRACK,
  MusicAlbum: MUSIC_MEDIA_TYPES.ALBUM,
  MusicArtist: MUSIC_MEDIA_TYPES.ARTIST,
  Playlist: MUSIC_MEDIA_TYPES.PLAYLIST,
};
const TYPE_OF_KIND = Object.fromEntries(Object.entries(KIND_OF_TYPE).map(([t, k]) => [k, t]));

/** Tracks sent in one play command at most (item ids in the query string). */
export const MAX_PLAY_ITEMS = 150;

/** Artwork sizes asked from the server (px): the player frame, a list row. */
export const ARTWORK_SIZE = { player: 400, list: 128 };

/** Bytes of an artwork the core accepts. */
export const MAX_ARTWORK_BYTES = 300 * 1024;

const MAX_ARTWORKS = 1000;
const MAX_TEXT = 200;
const PLAY_COMMANDS = { replace: 'PlayNow', next: 'PlayNext', append: 'PlayLast' };
const TRACK_ORDER = 'ParentIndexNumber,IndexNumber,SortName';

const clip = (value) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_TEXT) : null;

/**
 * `<kind>:<id>` of a MediaItem id, or null for anything else.
 * @param {unknown} id
 * @returns {{ kind: string, itemId: string }|null}
 */
export function parseMediaId(id) {
  const match = /^(track|album|artist|playlist):([0-9a-zA-Z-]{1,64})$/.exec(String(id ?? ''));
  return match ? { kind: match[1], itemId: match[2] } : null;
}

export class MusicCatalog {
  /**
   * @param {import('./monitor.js').MediaMonitor} monitor
   */
  constructor(monitor) {
    this.monitor = monitor;
    /** @type {Map<string, { itemId: string, tag: string, size: number }>} by artwork key */
    this.artworks = new Map();
    /** @type {string|null} First administrator, the fallback user of the catalog. */
    this.adminUserId = null;
  }

  get api() {
    return this.monitor.api;
  }

  get language() {
    return this.monitor.config.language;
  }

  // --- Artwork -------------------------------------------------------------------

  /**
   * URL of an artwork at a size, recorded so its key can be served. The key
   * is the SDK's (`artworkKey(url)`): the image tag is in the URL, so the
   * key changes when the image does.
   * @param {{ itemId: string, tag: string }|null} artwork
   * @param {number} size
   * @returns {string|null}
   */
  artworkUrl(artwork, size) {
    if (!artwork) {
      return null;
    }
    const url =
      `${this.api.baseUrl}/Items/${encodeURIComponent(artwork.itemId)}/Images/Primary` +
      `?tag=${encodeURIComponent(artwork.tag)}&maxWidth=${size}&maxHeight=${size}`;
    const key = artworkKey(url);
    this.artworks.delete(key);
    this.artworks.set(key, { itemId: artwork.itemId, tag: artwork.tag, size });
    while (this.artworks.size > MAX_ARTWORKS) {
      this.artworks.delete(this.artworks.keys().next().value);
    }
    return url;
  }

  /**
   * onMusicGetArtwork: the bytes of a recorded artwork, as JPEG resized by
   * the server, with the API key (the default handler of the SDK would send
   * none: Jellyfin 12 refuses the legacy authentication).
   * @param {string} key
   * @returns {Promise<string>} Raw base64.
   */
  async artwork(key) {
    const artwork = this.artworks.get(key);
    if (!artwork) {
      throw new Error(`Unknown artwork ${key}`);
    }
    let size = artwork.size;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const bytes = await this.api.getImage(artwork.itemId, 'Primary', size, size);
      if (!bytes) {
        throw new Error(`No artwork for ${artwork.itemId}`);
      }
      if (bytes.length <= MAX_ARTWORK_BYTES) {
        return bytes.toString('base64');
      }
      size = Math.round(size * 0.7);
    }
    throw new Error(`Artwork of ${artwork.itemId} too large`);
  }

  // --- Browse and search -------------------------------------------------------

  /**
   * onMusicBrowse: our root folders, then the library.
   * @param {{ external_id: string }} device
   * @param {{ parentId: string|null, offset: number, limit: number }} options
   */
  async browse(device, { parentId, offset = 0, limit = 50 }) {
    const userId = await this.userOf(device);
    if (!parentId) {
      const t = texts(this.language);
      const roots = [
        [ROOTS.albums, t.folderAlbums],
        [ROOTS.artists, t.folderArtists],
        [ROOTS.playlists, t.folderPlaylists],
      ].map(([id, title]) => ({
        id,
        type: MUSIC_MEDIA_TYPES.FOLDER,
        title,
        browsable: true,
        playable: false,
      }));
      return { items: roots.slice(offset, offset + limit), total: roots.length };
    }

    const page = { UserId: userId, StartIndex: offset, Limit: limit, EnableUserData: false };
    let answer;
    if (parentId === ROOTS.albums) {
      answer = await this.api.queryItems({
        ...page,
        Recursive: true,
        IncludeItemTypes: 'MusicAlbum',
        SortBy: 'SortName',
      });
    } else if (parentId === ROOTS.artists) {
      answer = await this.api.queryItems({ ...page, SortBy: 'SortName' }, '/Artists/AlbumArtists');
    } else if (parentId === ROOTS.playlists) {
      answer = await this.api.queryItems({
        ...page,
        Recursive: true,
        IncludeItemTypes: 'Playlist',
        MediaTypes: 'Audio',
        SortBy: 'SortName',
      });
    } else {
      const media = parseMediaId(parentId);
      if (!media || media.kind === MUSIC_MEDIA_TYPES.TRACK) {
        throw localizedError('notBrowsable', this.language);
      }
      answer = await this.api.queryItems({ ...page, ...this.childrenQuery(media) });
    }
    return { items: answer.items.map((item) => this.toMediaItem(item)), total: answer.total };
  }

  /**
   * What a container holds: an album's tracks, an artist's albums, a
   * playlist's items (in the playlist's order).
   * @param {{ kind: string, itemId: string }} media
   */
  childrenQuery(media) {
    if (media.kind === MUSIC_MEDIA_TYPES.ALBUM) {
      return {
        ParentId: media.itemId,
        Recursive: true,
        IncludeItemTypes: 'Audio',
        SortBy: TRACK_ORDER,
      };
    }
    if (media.kind === MUSIC_MEDIA_TYPES.ARTIST) {
      return {
        ArtistIds: media.itemId,
        Recursive: true,
        IncludeItemTypes: 'MusicAlbum',
        SortBy: 'ProductionYear,SortName',
      };
    }
    return { ParentId: media.itemId };
  }

  /**
   * onMusicSearch: tracks, albums, artists and playlists by name.
   * @param {{ external_id: string }} device
   * @param {{ query: string, type: string|null, limit: number }} options
   */
  async search(device, { query, type, limit = 20 }) {
    const userId = await this.userOf(device);
    const types = type ? TYPE_OF_KIND[type] : Object.keys(KIND_OF_TYPE).join(',');
    if (!types) {
      // radio, folder: nothing of the kind in the library.
      return { items: [] };
    }
    const answer = await this.api.queryItems({
      UserId: userId,
      searchTerm: query,
      Recursive: true,
      IncludeItemTypes: types,
      Limit: limit,
      EnableUserData: false,
    });
    return { items: answer.items.map((item) => this.toMediaItem(item)) };
  }

  /**
   * A server item as a MediaItem. Never dropped: an item of an unexpected
   * type stays as a neutral row (the panel pages by rows received).
   * @param {object} item - Raw server item.
   */
  toMediaItem(item) {
    const kind = KIND_OF_TYPE[item?.Type];
    const id = String(item?.Id ?? '');
    const title = clip(item?.Name) ?? (id || '?');
    if (!kind || !id) {
      return {
        id: `other:${id || 'unknown'}`,
        type: MUSIC_MEDIA_TYPES.TRACK,
        title,
        browsable: false,
        playable: false,
      };
    }
    const own = item.ImageTags?.Primary ? { itemId: id, tag: item.ImageTags.Primary } : null;
    const album =
      item.AlbumId && item.AlbumPrimaryImageTag
        ? { itemId: String(item.AlbumId), tag: item.AlbumPrimaryImageTag }
        : null;
    const artists =
      Array.isArray(item.Artists) && item.Artists.length > 0 ? item.Artists.join(', ') : null;
    const artwork = this.artworkUrl(
      kind === MUSIC_MEDIA_TYPES.TRACK ? (album ?? own) : own,
      ARTWORK_SIZE.list,
    );
    const isTrack = kind === MUSIC_MEDIA_TYPES.TRACK;
    const runTime = Number(item.RunTimeTicks);
    return {
      id: `${kind}:${id}`,
      type: kind,
      title,
      subtitle: isTrack
        ? clip(artists ?? item.AlbumArtist)
        : kind === MUSIC_MEDIA_TYPES.ALBUM
          ? clip(item.AlbumArtist ?? artists)
          : null,
      duration: isTrack && runTime > 0 ? Math.round(runTime / TICKS_PER_SECOND) : null,
      artwork_key: artwork ? artworkKey(artwork) : null,
      browsable: !isTrack,
      playable: true,
    };
  }

  // --- Play ------------------------------------------------------------------------

  /**
   * onMusicPlay (and the `music.play-media` scene action): play a track, an
   * album, an artist or a playlist on the player — now, next, or at the end
   * of its queue.
   * @param {{ external_id: string }} device
   * @param {{ id: string, type?: string }} media
   * @param {'replace'|'next'|'append'} mode
   */
  async play(device, media, mode = 'replace') {
    const session = this.monitor.controllableSession(device?.external_id);
    const command = PLAY_COMMANDS[mode];
    if (!command) {
      throw localizedError('badValue', this.language);
    }
    const parsed = parseMediaId(media?.id);
    if (!parsed) {
      throw localizedError('notPlayable', this.language);
    }
    const ids = await this.tracksOf(parsed, session.userId ?? (await this.fallbackUser()));
    if (ids.length === 0) {
      throw localizedError('emptyMedia', this.language);
    }
    await this.api.playItems(session.sessionId, ids, command);
    this.monitor.logPlay(session, `${parsed.kind} ${parsed.itemId}`, mode, ids.length);
  }

  /**
   * Track ids of a media, in playing order (MAX_PLAY_ITEMS at most).
   * @param {{ kind: string, itemId: string }} media
   * @param {string|null} userId
   */
  async tracksOf(media, userId) {
    if (media.kind === MUSIC_MEDIA_TYPES.TRACK) {
      return [media.itemId];
    }
    const query = {
      UserId: userId,
      Limit: MAX_PLAY_ITEMS,
      EnableUserData: false,
      EnableImages: false,
    };
    if (media.kind === MUSIC_MEDIA_TYPES.ARTIST) {
      Object.assign(query, {
        ArtistIds: media.itemId,
        Recursive: true,
        IncludeItemTypes: 'Audio',
        SortBy: `ProductionYear,Album,${TRACK_ORDER}`,
      });
    } else if (media.kind === MUSIC_MEDIA_TYPES.ALBUM) {
      Object.assign(query, this.childrenQuery(media));
    } else {
      // A playlist, in its own order.
      Object.assign(query, { ParentId: media.itemId, IncludeItemTypes: 'Audio' });
    }
    const { items } = await this.api.queryItems(query);
    return items.filter((item) => item?.Id).map((item) => String(item.Id));
  }

  // --- Internals -------------------------------------------------------------------

  /**
   * The user the catalog is read as: the one signed in on the player, else
   * the first administrator. Also checks the device is a player.
   * @param {{ external_id: string }} device
   */
  async userOf(device) {
    const session = this.monitor.playerSession(device?.external_id);
    return session?.userId ?? (await this.fallbackUser());
  }

  async fallbackUser() {
    if (!this.adminUserId) {
      this.adminUserId = await this.api.getAdminUserId();
    }
    return this.adminUserId;
  }
}
