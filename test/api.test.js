import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  MediaServerApi,
  AuthError,
  HttpError,
  SERVER_KIND,
  CLIENT_DEVICE_ID,
  parseJellyfinSegments,
  parseEmbyChapterMarkers,
} from '../src/media/api.js';

// A local HTTP server standing in for Jellyfin / Emby: it records every
// request and answers from a per-path table.
let server;
let baseUrl;
const requests = [];
let routes = {};

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      requests.push({
        method: req.method,
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
      });
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) {
        res.writeHead(404).end();
        return;
      }
      const { status = 200, json, text, bytes, type } = route;
      if (bytes) {
        res.writeHead(status, { 'Content-Type': type ?? 'image/jpeg' }).end(bytes);
      } else if (json !== undefined) {
        res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
      } else {
        res.writeHead(status).end(text ?? '');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function api() {
  requests.length = 0;
  return new MediaServerApi({ server_url: baseUrl, api_key: 'secret-key' }, { version: '1.2.3' });
}

test('detect: Jellyfin reports a ProductName, Emby does not', async () => {
  routes = {
    'GET /System/Info/Public': {
      json: { Id: 'jf1', ServerName: 'NAS', Version: '12.1.0', ProductName: 'Jellyfin Server' },
    },
  };
  const client = api();
  assert.deepEqual(await client.detect(), {
    kind: SERVER_KIND.JELLYFIN,
    id: 'jf1',
    name: 'NAS',
    version: '12.1.0',
  });
  // The public endpoint is called without credentials.
  assert.equal(requests[0].headers.authorization, undefined);

  routes = {
    'GET /System/Info/Public': { json: { Id: 'em1', ServerName: 'NAS', Version: '4.10.0.40' } },
  };
  const emby = api();
  assert.equal((await emby.detect()).kind, SERVER_KIND.EMBY);
  assert.equal(emby.kind, SERVER_KIND.EMBY);
});

test('detect rejects an address that is not a media server', async () => {
  routes = { 'GET /System/Info/Public': { text: '<html>router login</html>' } };
  await assert.rejects(api().detect(), /does not look like a Jellyfin or Emby server/);
  routes = { 'GET /System/Info/Public': { json: { hello: 'world' } } };
  await assert.rejects(api().detect(), /does not look like/);
});

test('every authenticated call carries the MediaBrowser Authorization header', async () => {
  routes = { 'GET /System/Info': { json: { Id: 'jf1' } } };
  await api().getSystemInfo();
  const header = requests[0].headers.authorization;
  assert.match(header, /^MediaBrowser /);
  assert.match(header, /Token="secret-key"/);
  assert.match(header, new RegExp(`DeviceId="${CLIENT_DEVICE_ID}"`));
  assert.match(header, /Version="1\.2\.3"/);
  // Never the legacy methods Jellyfin 12 refuses.
  assert.equal(requests[0].headers['x-emby-token'], undefined);
  assert.equal(requests[0].query.get('api_key'), null);
});

test('401 and 403 become AuthError, other failures HttpError', async () => {
  routes = { 'GET /System/Info': { status: 401 } };
  await assert.rejects(api().getSystemInfo(), AuthError);
  routes = { 'GET /System/Info': { status: 403 } };
  await assert.rejects(api().getSystemInfo(), AuthError);
  routes = { 'GET /System/Info': { status: 500 } };
  await assert.rejects(
    api().getSystemInfo(),
    (err) => err instanceof HttpError && err.status === 500,
  );
});

test('an unreachable server gives a readable error', async () => {
  const client = new MediaServerApi({ server_url: 'http://127.0.0.1:1', api_key: 'k' });
  await assert.rejects(client.getSessions(), /server unreachable at http:\/\/127\.0\.0\.1:1/);
});

test('libraries: id, name, collection type', async () => {
  routes = {
    'GET /Library/VirtualFolders': {
      json: [
        { Name: 'Films', CollectionType: 'movies', ItemId: 'abc' },
        { Name: 'Mixed', ItemId: 7 },
        { Name: 'Broken' },
      ],
    },
  };
  assert.deepEqual(await api().getLibraries(), [
    { id: 'abc', name: 'Films', collectionType: 'movies' },
    { id: '7', name: 'Mixed', collectionType: 'mixed' },
  ]);
});

test('countItems asks for a count only (Limit=0)', async () => {
  routes = { 'GET /Items': { json: { Items: [], TotalRecordCount: 42 } } };
  const client = api();
  assert.equal(await client.countItems('lib1', { types: ['Series'] }), 42);
  const { query } = requests[0];
  assert.equal(query.get('Limit'), '0');
  assert.equal(query.get('ParentId'), 'lib1');
  assert.equal(query.get('Recursive'), 'true');
  assert.equal(query.get('IncludeItemTypes'), 'Series');
  assert.equal(query.get('IsFolder'), null);
  await client.countItems('lib1', { isFolder: false });
  assert.equal(requests[1].query.get('IsFolder'), 'false');
});

test('remote control: playstate, general command, message, play', async () => {
  routes = {
    'POST /Sessions/s1/Playing/Pause': { status: 204 },
    'POST /Sessions/s1/Command': { status: 204 },
    'POST /Sessions/s1/Message': { status: 204 },
    'POST /Sessions/s1/Playing': { status: 204 },
  };
  const client = api();
  await client.sendPlaystate('s1', 'Pause');
  await client.sendGeneralCommand('s1', 'SetVolume', { Volume: '40' });
  await client.sendMessage('s1', { header: 'Gladys', text: 'Hello', timeoutMs: 5000 });
  await client.playItems('s1', ['i1', 'i2'], 'PlayShuffle');
  assert.deepEqual(JSON.parse(requests[1].body), {
    Name: 'SetVolume',
    Arguments: { Volume: '40' },
  });
  assert.deepEqual(JSON.parse(requests[2].body), {
    Header: 'Gladys',
    Text: 'Hello',
    TimeoutMs: 5000,
  });
  assert.equal(requests[3].query.get('playCommand'), 'PlayShuffle');
  assert.equal(requests[3].query.get('itemIds'), 'i1,i2');
});

test('getImage: poster or fan art, bytes or null when the item has none', async () => {
  routes = {
    'GET /Items/i1/Images/Primary': { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
    'GET /Items/i1/Images/Backdrop/0': { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe1]) },
  };
  const client = api();
  const bytes = await client.getImage('i1', 'Primary', 300);
  assert.deepEqual([...bytes], [0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(requests[0].query.get('maxWidth'), '300');
  assert.equal(requests[0].query.get('format'), 'Jpg');
  assert.deepEqual([...(await client.getImage('i1', 'Backdrop', 800))], [0xff, 0xd8, 0xff, 0xe1]);
  assert.equal(await client.getImage('missing', 'Primary', 300), null);
});

test('getMarkers: media segments on Jellyfin, chapter markers on Emby', async () => {
  routes = {
    'GET /MediaSegments/m1': {
      json: {
        Items: [
          { Type: 'Intro', StartTicks: 0, EndTicks: 300 },
          { Type: 'Recap', StartTicks: 300, EndTicks: 400 },
          { Type: 'Outro', StartTicks: 2400, EndTicks: 3000 },
        ],
      },
    },
    'GET /Items': {
      json: {
        Items: [
          {
            Chapters: [
              { StartPositionTicks: 0, MarkerType: 'Chapter' },
              { StartPositionTicks: 100, MarkerType: 'IntroStart' },
              { StartPositionTicks: 500, MarkerType: 'IntroEnd' },
              { StartPositionTicks: 2500, MarkerType: 'CreditsStart' },
            ],
          },
        ],
      },
    },
  };
  const jellyfin = api();
  jellyfin.kind = SERVER_KIND.JELLYFIN;
  assert.deepEqual(await jellyfin.getMarkers('m1', 3000), [
    { type: 'intro', start: 0, end: 300 },
    { type: 'credits', start: 2400, end: 3000 },
  ]);
  const emby = api();
  emby.kind = SERVER_KIND.EMBY;
  assert.deepEqual(await emby.getMarkers('m1', 3000), [
    { type: 'intro', start: 100, end: 500 },
    { type: 'credits', start: 2500, end: 3000 },
  ]);
  assert.equal(requests[0].query.get('Ids'), 'm1');
  assert.equal(requests[0].query.get('Fields'), 'Chapters');
});

test('marker parsers ignore what they do not know', () => {
  assert.deepEqual(parseJellyfinSegments([{ Type: 'Commercial', StartTicks: 1, EndTicks: 2 }]), []);
  // An intro start without its end is not a range.
  assert.deepEqual(
    parseEmbyChapterMarkers([{ MarkerType: 'IntroStart', StartPositionTicks: 5 }]),
    [],
  );
  // Credits without a known runtime run to the end.
  const [credits] = parseEmbyChapterMarkers([
    { MarkerType: 'CreditsStart', StartPositionTicks: 9 },
  ]);
  assert.equal(credits.end, Number.MAX_SAFE_INTEGER);
});
