#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Development tool: a fake, remote-controllable Jellyfin / Emby player.
//
// Signs in as a real user, advertises itself as a controllable client (the way
// the TV apps do), then pretends to play whatever it is told: it reports its
// playback state to the server and obeys the remote-control commands the
// integration sends (pause, stop, volume, display message...). It lets the
// whole command path be tested end to end without a TV at hand.
//
// Usage:
//   node tools/fake-player.mjs --url http://192.168.1.20:8096 \
//     --user admin --password secret [--name "Fake TV"] [--device-id fake-tv] \
//     [--play <itemId>]
//
// Interactive commands on stdin: play <itemId> | pause | unpause | stop | quit
// -----------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import WebSocket from 'ws';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    user: { type: 'string' },
    password: { type: 'string', default: '' },
    name: { type: 'string', default: 'Fake TV' },
    'device-id': { type: 'string', default: 'gladys-fake-player' },
    play: { type: 'string' },
  },
});

if (!args.url || !args.user) {
  console.error(
    'Usage: fake-player.mjs --url <server> --user <name> --password <pw> [--play <itemId>]',
  );
  process.exit(2);
}

const base = args.url.replace(/\/+$/, '');
const TICKS_PER_SECOND = 10_000_000;
let token = null;

function authHeader() {
  const parts = [
    `Client="Fake Player"`,
    `Device="${args.name}"`,
    `DeviceId="${args['device-id']}"`,
    `Version="1.0.0"`,
  ];
  if (token) {
    parts.push(`Token="${token}"`);
  }
  return `MediaBrowser ${parts.join(', ')}`;
}

async function api(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      'X-Emby-Authorization': authHeader(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status} ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const state = {
  item: null, // { Id, Name, RunTimeTicks }
  positionTicks: 0,
  paused: false,
  muted: false,
  volume: 100,
  playSessionId: null,
};

function log(...parts) {
  console.log(new Date().toISOString().slice(11, 19), ...parts);
}

function progressBody(eventName) {
  return {
    ItemId: state.item.Id,
    MediaSourceId: state.item.Id,
    PlaySessionId: state.playSessionId,
    PositionTicks: Math.round(state.positionTicks),
    IsPaused: state.paused,
    IsMuted: state.muted,
    VolumeLevel: state.volume,
    PlayMethod: 'DirectPlay',
    CanSeek: true,
    EventName: eventName,
  };
}

async function play(itemId, startTicks = 0) {
  if (state.item) {
    await stop();
  }
  const item = await api('GET', `/Items?Ids=${encodeURIComponent(itemId)}&Fields=RunTimeTicks`);
  const found = item?.Items?.[0];
  if (!found) {
    log(`play: unknown item ${itemId}`);
    return;
  }
  state.item = found;
  state.positionTicks = startTicks;
  state.paused = false;
  state.playSessionId = randomUUID().replace(/-/g, '');
  await api('POST', '/Sessions/Playing', progressBody('play'));
  log(`playing "${found.Name}" (${found.Type})`);
}

async function report(eventName) {
  if (state.item) {
    await api('POST', '/Sessions/Playing/Progress', progressBody(eventName));
  }
}

async function stop() {
  if (!state.item) {
    return;
  }
  await api('POST', '/Sessions/Playing/Stopped', progressBody('stop'));
  log(`stopped "${state.item.Name}"`);
  state.item = null;
}

async function handlePlaystate(data) {
  const command = data.Command;
  log(`<- Playstate ${command}${data.SeekPositionTicks ? ` ${data.SeekPositionTicks}` : ''}`);
  switch (command) {
    case 'Pause':
      state.paused = true;
      return report('pause');
    case 'Unpause':
      state.paused = false;
      return report('unpause');
    case 'PlayPause':
      state.paused = !state.paused;
      return report(state.paused ? 'pause' : 'unpause');
    case 'Stop':
      return stop();
    case 'Seek':
      state.positionTicks = Number(data.SeekPositionTicks ?? 0);
      return report('timeupdate');
    case 'Rewind':
      state.positionTicks = Math.max(0, state.positionTicks - 10 * TICKS_PER_SECOND);
      return report('timeupdate');
    case 'FastForward':
      state.positionTicks += 30 * TICKS_PER_SECOND;
      return report('timeupdate');
    case 'NextTrack':
    case 'PreviousTrack':
      state.positionTicks = 0;
      return report('timeupdate');
    default:
      return undefined;
  }
}

async function handleGeneralCommand(data) {
  const name = data.Name;
  const argsOf = data.Arguments ?? {};
  log(`<- GeneralCommand ${name} ${JSON.stringify(argsOf)}`);
  switch (name) {
    case 'SetVolume':
      state.volume = Number(argsOf.Volume);
      return report('volumechange');
    case 'Mute':
      state.muted = true;
      return report('volumechange');
    case 'Unmute':
      state.muted = false;
      return report('volumechange');
    case 'ToggleMute':
      state.muted = !state.muted;
      return report('volumechange');
    case 'DisplayMessage':
      log(`   MESSAGE: [${argsOf.Header ?? ''}] ${argsOf.Text ?? ''}`);
      return undefined;
    default:
      return undefined;
  }
}

async function main() {
  const info = await api('GET', '/System/Info/Public');
  const isJellyfin = /jellyfin/i.test(info.ProductName ?? '');
  log(`server ${info.ServerName} ${info.ProductName ?? 'Emby'} ${info.Version}`);

  const auth = await api('POST', '/Users/AuthenticateByName', {
    Username: args.user,
    Pw: args.password,
  });
  token = auth.AccessToken;
  log(`signed in as ${auth.User.Name}, session ${auth.SessionInfo?.Id}`);

  await api('POST', '/Sessions/Capabilities/Full', {
    PlayableMediaTypes: ['Video', 'Audio'],
    SupportedCommands: [
      'SetVolume',
      'Mute',
      'Unmute',
      'ToggleMute',
      'VolumeUp',
      'VolumeDown',
      'DisplayMessage',
    ],
    SupportsMediaControl: true,
    SupportsPersistentIdentifier: true,
  });

  const wsPath = isJellyfin ? '/socket' : '/embywebsocket';
  // Emby only binds the socket to the session through the query string.
  const wsQuery = new URLSearchParams({ deviceId: args['device-id'] });
  if (!isJellyfin) {
    wsQuery.set('api_key', token);
  }
  const wsUrl = `${base.replace(/^http/, 'ws')}${wsPath}?${wsQuery}`;
  const ws = new WebSocket(wsUrl, {
    headers: { Authorization: authHeader(), 'X-Emby-Authorization': authHeader() },
  });
  let keepAlive = null;
  ws.on('open', () => {
    log(`websocket open (${wsPath})`);
    keepAlive = setInterval(() => ws.send(JSON.stringify({ MessageType: 'KeepAlive' })), 30_000);
  });
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const run = {
      Playstate: () => handlePlaystate(message.Data),
      GeneralCommand: () => handleGeneralCommand(message.Data),
      Play: () => play(message.Data.ItemIds[0], Number(message.Data.StartPositionTicks ?? 0)),
    }[message.MessageType];
    if (run) {
      run().catch((err) => log(`command failed: ${err.message}`));
    } else if (!['KeepAlive', 'ForceKeepAlive'].includes(message.MessageType)) {
      log(`<- ${message.MessageType}`);
    }
  });
  ws.on('close', (code) => {
    log(`websocket closed (${code})`);
    clearInterval(keepAlive);
  });
  ws.on('error', (err) => log(`websocket error: ${err.message}`));

  // Playback clock + periodic progress report, like a real player.
  setInterval(() => {
    if (state.item && !state.paused) {
      state.positionTicks += 5 * TICKS_PER_SECOND;
      if (state.item.RunTimeTicks && state.positionTicks >= state.item.RunTimeTicks) {
        stop().catch(() => {});
        return;
      }
    }
    report('timeupdate').catch((err) => log(`progress failed: ${err.message}`));
  }, 5_000);

  if (args.play) {
    await play(args.play);
  }

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const [cmd, arg] = line.trim().split(/\s+/);
    const actions = {
      play: () => play(arg),
      pause: () => handlePlaystate({ Command: 'Pause' }),
      unpause: () => handlePlaystate({ Command: 'Unpause' }),
      stop: () => stop(),
      quit: async () => {
        await stop();
        process.exit(0);
      },
    };
    actions[cmd]?.().catch((err) => log(`${cmd} failed: ${err.message}`));
  });

  const shutdown = async () => {
    await stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
