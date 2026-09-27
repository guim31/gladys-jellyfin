import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  artworkOf,
  imageKey,
  itemLinks,
  groupLatestItems,
  buildNowPlayingContent,
  buildLatestContent,
} from '../src/widgets.js';
import { normalizeSession, normalizeItem } from '../src/media/sessions.js';
import { tvSession, phoneEpisodeSession } from './fixtures/sessions.js';

const IMAGE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const register = (artwork) => imageKey(artwork);

test('artwork: series poster for an episode, album cover for a track, own image else', () => {
  assert.deepEqual(artworkOf(normalizeSession(phoneEpisodeSession()).item), {
    itemId: '4def373444fc7a79b4592aed4ffe492e',
    tag: '381ddb4f270478c3d121e95a1d480ece',
  });
  assert.deepEqual(
    artworkOf(
      normalizeItem({ Id: 't1', Type: 'Audio', AlbumId: 'al1', AlbumPrimaryImageTag: 'tg' }),
    ),
    { itemId: 'al1', tag: 'tg' },
  );
  assert.deepEqual(artworkOf(normalizeSession(tvSession()).item), {
    itemId: '0c19a6f54d50d8bbbba00f8f4325de45',
    tag: '8280d87905731335f4956a7af5054441',
  });
  assert.equal(artworkOf(normalizeItem({ Id: 'x', Type: 'Movie' })), null);
  assert.equal(artworkOf(null), null);
});

test('image keys match the widget contract, whatever the ids look like', () => {
  for (const artwork of [
    { itemId: '0c19a6f54d50d8bbbba00f8f4325de45', tag: '8280d87905731335f4956a7af5054441' },
    { itemId: '22', tag: '2c584a7d246e72f45209c65dca5a300a_639261286662320927' },
    { itemId: 'A-B_C', tag: '' },
  ]) {
    assert.match(imageKey(artwork), IMAGE_KEY);
  }
  // A new artwork tag gives a new key (the core caches images by key).
  assert.notEqual(imageKey({ itemId: '1', tag: 'aaa' }), imageKey({ itemId: '1', tag: 'bbb' }));
});

test('links only for an https server, pointing at the right web client', () => {
  assert.deepEqual(
    itemLinks({ baseUrl: 'http://nas:8096', kind: 'jellyfin', serverId: 's' }, 'i'),
    [],
  );
  const [jellyfin] = itemLinks(
    { baseUrl: 'https://jf.example.com', kind: 'jellyfin', serverId: 's' },
    'i',
  );
  assert.equal(jellyfin.url, 'https://jf.example.com/web/#/details?id=i&serverId=s');
  const [emby] = itemLinks(
    { baseUrl: 'https://emby.example.com', kind: 'emby', serverId: 's' },
    'i',
  );
  assert.equal(emby.url, 'https://emby.example.com/web/index.html#!/item?id=i&serverId=s');
});

test('now_playing: live tiles + one row per playback, valid content', () => {
  const content = buildNowPlayingContent({
    sessions: [normalizeSession(tvSession()), normalizeSession(phoneEpisodeSession())],
    streamsFeature: 'ext:x:server:s:active-streams',
    transcodesFeature: 'ext:x:server:s:transcode-sessions',
    language: 'fr',
    register,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const list = content.components.find((c) => c.type === 'card-list');
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].title, 'Big Buck Bunny (2008)');
  assert.equal(list.items[0].subtitle, 'alice sur Living room TV');
  assert.equal(list.items[0].badge.text, 'Lecture');
  assert.equal(list.items[1].badge.text, 'Pause');
  assert.match(list.items[0].image, IMAGE_KEY);
});

test('now_playing: transcoding badge, then an empty state when nothing plays', () => {
  const transcoding = normalizeSession(
    tvSession({ PlayState: { PositionTicks: 0, IsPaused: false, PlayMethod: 'Transcode' } }),
  );
  const content = buildNowPlayingContent({
    sessions: [transcoding],
    streamsFeature: 'a',
    transcodesFeature: 'b',
    language: 'en',
    register,
  });
  assert.equal(content.components[2].items[0].badge.text, 'Transcoding');

  const empty = buildNowPlayingContent({
    sessions: [],
    streamsFeature: 'a',
    transcodesFeature: 'b',
    language: 'en',
    register,
  });
  assert.deepEqual(validateWidgetContent(empty), []);
  assert.equal(empty.components.at(-1).text, 'Nothing is playing right now.');
});

const episode = (id, seriesId, seriesName) =>
  normalizeItem({
    Id: id,
    Name: `Episode ${id}`,
    Type: 'Episode',
    SeriesId: seriesId,
    SeriesName: seriesName,
    SeriesPrimaryImageTag: `tag${seriesId}`,
    DateCreated: '2026-09-27T17:34:58.0000000Z',
  });
const movie = (id, name, year) =>
  normalizeItem({
    Id: id,
    Name: name,
    Type: 'Movie',
    ProductionYear: year,
    ImageTags: { Primary: `tag${id}` },
    Overview: 'Plot.',
  });

test('latest additions: new episodes grouped by series, newest first', () => {
  const cards = groupLatestItems([
    episode('e3', 's1', 'Pioneer One'),
    movie('m1', 'Sintel', 2010),
    episode('e2', 's1', 'Pioneer One'),
    episode('e1', 's1', 'Pioneer One'),
    episode('x1', 's2', 'Other'),
  ]);
  assert.deepEqual(
    cards.map((c) => [c.kind, c.item.id, c.count]),
    [
      ['series', 'e3', 3],
      ['item', 'm1', 1],
      ['series', 'x1', 1],
    ],
  );
});

test('latest additions: the grid is capped, episodes of a listed series still count', () => {
  const items = [episode('e1', 's1', 'Show')];
  for (let i = 0; i < 15; i += 1) {
    items.push(movie(`m${i}`, `Movie ${i}`, 2000 + i));
  }
  items.push(episode('e0', 's1', 'Show'));
  const cards = groupLatestItems(items);
  assert.equal(cards.length, 12);
  assert.equal(cards[0].count, 2);
});

test('latest_media content is valid, localized and linked over https', () => {
  const content = buildLatestContent({
    items: [
      episode('e2', 's1', 'Pioneer One'),
      episode('e1', 's1', 'Pioneer One'),
      movie('m1', 'Sintel', 2010),
    ],
    language: 'fr',
    server: { baseUrl: 'https://jf.example.com', kind: 'jellyfin', serverId: 'srv' },
    register,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const [series, film] = content.components[0].items;
  assert.equal(series.title, 'Pioneer One');
  assert.equal(series.subtitle, '2 nouveaux épisodes');
  assert.equal(film.subtitle, '2010');
  assert.equal(film.description, 'Plot.');
  assert.equal(film.links.length, 1);

  const empty = buildLatestContent({
    items: [],
    language: 'en',
    server: { baseUrl: 'http://nas', kind: 'emby', serverId: 's' },
    register,
  });
  assert.deepEqual(validateWidgetContent(empty), []);
  assert.equal(empty.components[0].text, 'Nothing added recently.');
});
