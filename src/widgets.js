// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+), content builders — pure functions.
//
//   - now_playing  : who watches what, where, with the posters (a row per
//                    playback) and two live tiles bound to the server sensors;
//   - latest_media : the posters of the latest additions (movies, series,
//                    albums), new episodes grouped by series.
//
// Posters are served by the integration (the browser never loads a
// third-party URL): a content only carries image KEYS, resolved through
// onWidgetGetImage. The core caches an image one hour by key, so the key
// embeds the image tag of the server — it changes when the artwork changes.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { texts } from './i18n.js';
import { SERVER_KIND } from './media/api.js';
import { formatTitle, truncate } from './media/sessions.js';

/** Widget keys, declared in the manifest `widgets` (forever: never rename). */
export const WIDGET = {
  NOW_PLAYING: 'now_playing',
  LATEST_MEDIA: 'latest_media',
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
 * Artwork of an item: the series poster for an episode, the album cover for
 * a track, the item's own image otherwise. Null when no image is known.
 * @param {ReturnType<import('./media/sessions.js').normalizeItem>} item
 * @returns {{ itemId: string, tag: string }|null}
 */
export function artworkOf(item) {
  if (!item) {
    return null;
  }
  if (item.type === 'Episode' && item.seriesId && item.seriesImageTag) {
    return { itemId: item.seriesId, tag: item.seriesImageTag };
  }
  if (item.albumId && item.albumImageTag) {
    return { itemId: item.albumId, tag: item.albumImageTag };
  }
  if (item.imageTag) {
    return { itemId: item.id, tag: item.imageTag };
  }
  return null;
}

/**
 * Image key of an artwork (`^[a-z0-9][a-z0-9-]{0,63}$`).
 * @param {{ itemId: string, tag: string }} artwork
 */
export function imageKey(artwork) {
  const safe = (value) =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  return `poster-${safe(artwork.itemId).slice(0, 40)}-${safe(artwork.tag).slice(0, 12) || 'x'}`;
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
              date: item.dateCreated ?? undefined,
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
            date: item.dateCreated ?? undefined,
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
