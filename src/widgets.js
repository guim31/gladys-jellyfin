// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+), content builders — pure functions.
//
//   - now_playing  : who watches what, where, with the posters (a row per
//                    playback) and two live tiles bound to the server sensors;
//   - latest_media : the posters of the latest additions (movies, series,
//                    albums), new episodes grouped by series;
//   - player       : ONE player, as a remote: the artwork of what it plays,
//                    title, state, remaining time and the playback buttons.
//
// Posters are served by the integration (the browser never loads a
// third-party URL): a content only carries image KEYS, resolved through
// onWidgetGetImage. The core caches an image one hour by key, so the key
// embeds the image tag of the server — it changes when the artwork changes.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { texts } from './i18n.js';
import { SERVER_KIND } from './media/api.js';
import { formatTitle, episodeCode, mediaCategory, MEDIA_TYPE, truncate } from './media/sessions.js';

/** Widget keys, declared in the manifest `widgets` (forever: never rename). */
export const WIDGET = {
  NOW_PLAYING: 'now_playing',
  LATEST_MEDIA: 'latest_media',
  PLAYER: 'player',
};

/** Item types fetched for each `kind` setting of the latest_media widget. */
export const LATEST_KINDS = {
  all: ['Movie', 'Episode'],
  movies: ['Movie'],
  series: ['Episode'],
  music: ['MusicAlbum'],
};

const MAX_LIST_ITEMS = 8;
const MAX_GRID_ITEMS = 12;

/**
 * Poster of an item: the series poster for an episode, the album cover for
 * a track, the item's own image otherwise. Null when no image is known.
 * @param {ReturnType<import('./media/sessions.js').normalizeItem>} item
 * @returns {{ itemId: string, tag: string, imageType: 'Primary' }|null}
 */
export function artworkOf(item) {
  if (!item) {
    return null;
  }
  const primary = (itemId, tag) => ({ itemId, tag, imageType: 'Primary' });
  if (item.type === 'Episode' && item.seriesId && item.seriesImageTag) {
    return primary(item.seriesId, item.seriesImageTag);
  }
  if (item.albumId && item.albumImageTag) {
    return primary(item.albumId, item.albumImageTag);
  }
  if (item.imageTag) {
    return primary(item.id, item.imageTag);
  }
  return null;
}

/**
 * Landscape art for the 16:9 frame of the player widget: the item's fan art,
 * the series fan art for an episode, or the episode still (a 16:9 screenshot).
 * Null when none exists — the caller then shows the poster, contained.
 * @param {ReturnType<import('./media/sessions.js').normalizeItem>} item
 * @returns {{ itemId: string, tag: string, imageType: 'Backdrop'|'Primary' }|null}
 */
export function backdropOf(item) {
  if (!item) {
    return null;
  }
  if (item.backdropTag) {
    return { itemId: item.id, tag: item.backdropTag, imageType: 'Backdrop' };
  }
  if (item.parentBackdropItemId && item.parentBackdropTag) {
    return {
      itemId: item.parentBackdropItemId,
      tag: item.parentBackdropTag,
      imageType: 'Backdrop',
    };
  }
  if (item.type === 'Episode' && item.imageTag) {
    return { itemId: item.id, tag: item.imageTag, imageType: 'Primary' };
  }
  return null;
}

/**
 * Image key of an artwork (`^[a-z0-9][a-z0-9-]{0,63}$`).
 * @param {{ itemId: string, tag: string, imageType?: string }} artwork
 */
export function imageKey(artwork) {
  const safe = (value) =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const prefix = artwork.imageType === 'Backdrop' ? 'backdrop' : 'poster';
  return `${prefix}-${safe(artwork.itemId).slice(0, 40)}-${safe(artwork.tag).slice(0, 12) || 'x'}`;
}

/**
 * Web client link to an item — https only (the widget contract refuses the
 * others), so only for a server published over https.
 * @param {{ baseUrl: string, kind: string, serverId: string }} server
 * @param {string} itemId
 * @returns {Array<{ url: string, label: object }>}
 */
export function itemLinks(server, itemId) {
  if (!server.baseUrl.startsWith('https://')) {
    return [];
  }
  const id = encodeURIComponent(itemId);
  const serverId = encodeURIComponent(server.serverId);
  const url =
    server.kind === SERVER_KIND.JELLYFIN
      ? `${server.baseUrl}/web/#/details?id=${id}&serverId=${serverId}`
      : `${server.baseUrl}/web/index.html#!/item?id=${id}&serverId=${serverId}`;
  const label = server.kind === SERVER_KIND.JELLYFIN ? 'Jellyfin' : 'Emby';
  return [{ url, label: { en: `Open in ${label}`, fr: `Ouvrir dans ${label}` } }];
}

/**
 * Content of the now_playing widget.
 * @param {{ sessions: Array<object>, streamsFeature: string, transcodesFeature: string,
 *   language: string, register: (artwork: object) => string }} input
 *   `register` records an artwork and returns its image key.
 */
export function buildNowPlayingContent({
  sessions,
  streamsFeature,
  transcodesFeature,
  language,
  register,
}) {
  const t = texts(language);
  const components = [
    { type: 'value', device_feature: streamsFeature, label: t.streams, icon: 'play-circle' },
    { type: 'value', device_feature: transcodesFeature, label: t.transcoding, icon: 'cpu' },
  ];
  const playing = sessions.filter((session) => session.item).slice(0, MAX_LIST_ITEMS);
  if (playing.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t.nothingPlaying });
    return { ttl_seconds: 60, components };
  }
  components.push({
    type: 'card-list',
    display: 'list',
    items: playing.map((session) => {
      const artwork = artworkOf(session.item);
      const who = [session.userName, session.deviceName].filter(Boolean).join(` ${t.on} `);
      let badge = { text: t.playing, color: WIDGET_COLORS.SUCCESS };
      if (session.state === 'paused') {
        badge = { text: t.paused, color: WIDGET_COLORS.WARNING };
      } else if (session.transcoding) {
        badge = { text: t.transcoding, color: WIDGET_COLORS.INFO };
      }
      return compact({
        title: truncate(formatTitle(session.item), 60),
        subtitle: truncate(who, 60),
        image: artwork ? register(artwork) : undefined,
        badge,
        description: session.item.overview ? truncate(session.item.overview, 2000) : undefined,
      });
    }),
  });
  return { ttl_seconds: 30, components };
}

/**
 * Group the latest items for the poster grid: a movie or an album is one
 * card, the new episodes of a series share one card.
 * @param {Array<ReturnType<import('./media/sessions.js').normalizeItem>>} items - Newest first.
 * @param {number} [max]
 */
export function groupLatestItems(items, max = MAX_GRID_ITEMS) {
  const cards = [];
  const bySeries = new Map();
  for (const item of items) {
    if (item.type === 'Episode' && item.seriesId) {
      const existing = bySeries.get(item.seriesId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      if (cards.length >= max) {
        continue;
      }
      const card = { kind: 'series', item, count: 1 };
      bySeries.set(item.seriesId, card);
      cards.push(card);
    } else if (cards.length < max) {
      cards.push({ kind: 'item', item, count: 1 });
    }
  }
  return cards;
}

/**
 * Content of the latest_media widget.
 * @param {{ items: Array<object>, language: string, server: object,
 *   register: (artwork: object) => string }} input
 */
export function buildLatestContent({ items, language, server, register }) {
  const t = texts(language);
  const cards = groupLatestItems(items);
  if (cards.length === 0) {
    return {
      ttl_seconds: 900,
      components: [{ type: 'text', variant: 'body', text: t.nothingNew }],
    };
  }
  return {
    ttl_seconds: 900,
    components: [
      {
        type: 'card-list',
        display: 'grid',
        items: cards.map(({ kind, item, count }) => {
          const artwork = artworkOf(item);
          if (kind === 'series') {
            return compact({
              title: truncate(item.seriesName || item.name, 60),
              subtitle: t.newEpisodes(count),
              image: artwork ? register(artwork) : undefined,
              links: itemLinks(server, item.seriesId),
            });
          }
          const subtitle =
            item.type === 'MusicAlbum'
              ? item.albumArtist || item.artists[0] || t.album
              : item.year
                ? String(item.year)
                : undefined;
          return compact({
            title: truncate(item.name, 60),
            subtitle,
            // The grid shows the date INSTEAD of the subtitle: only when
            // there is nothing better to say.
            date: subtitle ? undefined : (item.dateCreated ?? undefined),
            image: artwork ? register(artwork) : undefined,
            description: item.overview ? truncate(item.overview, 2000) : undefined,
            links: itemLinks(server, item.id),
          });
        }),
      },
    ],
  };
}

/**
 * Drop the undefined fields and the empty link lists of a card.
 * @param {Record<string, unknown>} card
 */
function compact(card) {
  return Object.fromEntries(
    Object.entries(card).filter(
      ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  );
}

/**
 * Two lines describing an item for the player widget: the main name
 * (heading, ≤ 40) and what completes it (caption, ≤ 80).
 * @param {ReturnType<import('./media/sessions.js').normalizeItem>} item
 */
export function describeItem(item) {
  if (item.type === 'Episode' && item.seriesName) {
    return {
      heading: item.seriesName,
      caption: [episodeCode(item), item.name].filter(Boolean).join(' · '),
    };
  }
  if (mediaCategory(item) === MEDIA_TYPE.MUSIC) {
    return {
      heading: item.name,
      caption: [item.artists[0] || item.albumArtist, item.album].filter(Boolean).join(' · '),
    };
  }
  return { heading: item.name, caption: item.year ? String(item.year) : '' };
}

/**
 * Content of the player widget: one player, as a remote.
 * @param {{ session: object|null, playerName: string, featureOf: (key: string) => string,
 *   language: string, register: (artwork: object) => string, followed?: boolean }} input
 *   `featureOf` gives the external id of one of the player's features;
 *   `followed` is set when no player was picked and the widget follows the
 *   current playback.
 */
export function buildPlayerContent({
  session,
  playerName,
  featureOf,
  language,
  register,
  followed = false,
}) {
  const t = texts(language);
  if (followed && !session?.item) {
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: t.nothingPlaying }],
    };
  }
  if (!session?.item) {
    return {
      ttl_seconds: 60,
      components: [
        { type: 'text', variant: 'heading', text: truncate(playerName, 40) },
        {
          type: 'text',
          variant: 'body',
          text: session ? t.nothingPlaying : t.playerOffline,
        },
      ],
    };
  }
  const { item } = session;
  const { heading, caption } = describeItem(item);
  const paused = session.state === 'paused';
  const landscape = backdropOf(item);
  const poster = artworkOf(item);
  const components = [{ type: 'text', variant: 'heading', text: truncate(heading, 40) }];
  if (caption) {
    components.push({ type: 'text', variant: 'caption', text: truncate(caption, 80) });
  }
  components.push({
    type: 'value',
    device_feature: featureOf('remaining'),
    label: t.remaining,
    icon: 'clock',
  });
  if (landscape || poster) {
    components.push({
      type: 'image',
      key: register(landscape ?? poster),
      alt: truncate(formatTitle(item), 80),
      // Fan art fills the 16:9 frame; a portrait poster or a square cover is
      // shown whole.
      fit: landscape ? 'cover' : 'contain',
    });
  }
  const status = [
    {
      label: t.state,
      value: paused ? t.paused : session.transcoding ? t.transcoding : t.playing,
      color: paused ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
  ];
  if (session.userName) {
    status.push({ label: t.user, value: truncate(session.userName, 40) });
  }
  if (followed) {
    // No player picked: the widget follows whatever plays, so say where.
    status.push({ label: t.player, value: truncate(session.deviceName, 40) });
  }
  components.push({ type: 'status', items: status });
  components.push(
    paused
      ? {
          type: 'button',
          label: t.play,
          icon: 'play',
          style: 'primary',
          device_feature: featureOf('play'),
          value: 1,
        }
      : {
          type: 'button',
          label: t.pause,
          icon: 'pause',
          style: 'primary',
          device_feature: featureOf('pause'),
          value: 1,
        },
    {
      type: 'button',
      label: t.stop,
      icon: 'square',
      style: 'secondary',
      device_feature: featureOf('stop'),
      value: 1,
    },
    {
      type: 'button',
      label: t.next,
      icon: 'skip-forward',
      style: 'secondary',
      device_feature: featureOf('next'),
      value: 1,
    },
  );
  return { ttl_seconds: 30, components };
}
