# Jellyfin & Emby integration for Gladys Assistant

External integration connecting a [Jellyfin](https://jellyfin.org) or
[Emby](https://emby.media) media server to
[Gladys Assistant](https://gladysassistant.com), built on the official
[JavaScript SDK](https://github.com/GladysAssistant/integration-sdk-js) and the
[integration template](https://github.com/GladysAssistant/integration-template-js).
One integration covers both servers: Jellyfin is a fork of Emby and they still
share the API it needs; the server kind is detected at connection time.

Checked on real servers: **Jellyfin 10.11.11 and 12.1.0, Emby 4.10.0.40**.

## Features

| Surface               | What                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server device         | Active playbacks, transcoded playbacks, "now playing" summary, one item counter per library (+ episodes / tracks)                                                                                                                                             |
| One device per player | Play / Pause / Stop / Previous / Next / Rewind / Forward, volume, mute (with the state the player reports), playback state (Music widget compatible), title, remaining time, intro/credits                                                                    |
| Scene triggers        | `playback_started`, `playback_paused`, `playback_resumed`, `playback_stopped` — filtered by player and media type (movie, episode, music, live TV…)                                                                                                           |
| Scene actions         | `display_message` (a message over the movie: "someone is at the door"), `play_media` (search the library and play the best match, shuffled or not)                                                                                                            |
| Dashboard widgets     | `now_playing` (who watches what, where, with the posters), `player` (the current playback — or one chosen player — as a remote: fan art or cover, title, state, remaining time, buttons), `latest_media` (poster grid of the latest movies, series or albums) |

Playback is followed in **real time**: the server's socket pushes the full
session list within ~1.5 s of any change, and a fallback poll (15 s, or 60 s
while the socket is up) keeps things working behind a reverse proxy that does
not forward WebSockets.

User documentation (rehosted by Gladys on the Configuration screen):
[English](./docs/en.md) · [Français](./docs/fr.md).

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no server logic)
├─ src/
│  ├─ monitor.js                     # MediaMonitor: state, publication, commands, scene actions, widgets
│  ├─ scene-events.js                # playback transitions -> scene triggers (pure)
│  ├─ widgets.js                     # widget content builders (pure)
│  ├─ i18n.js                        # fr/en texts
│  ├─ config.js                      # config defaults + normalization
│  ├─ media/
│  │  ├─ api.js                      # Jellyfin / Emby HTTP API client
│  │  ├─ socket.js                   # real-time socket (+ keep-alive, reconnect)
│  │  └─ sessions.js                 # session normalization (pure)
│  └─ devices/
│     ├─ server.js                   # server device (activity + library sensors)
│     └─ player.js                   # player devices (controls + playback sensors)
├─ tools/fake-player.mjs             # a fake remote-controllable player, for tests without a TV
├─ docs/                             # user documentation (en/fr)
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
└─ test/                             # unit tests (node --test, no framework)
```

## How it talks to the server

- **Authentication**: every call carries
  `Authorization: MediaBrowser Client=…, DeviceId=…, Token="<api key>"` — the
  one method both servers accept. Jellyfin 12 disables the legacy
  `X-Emby-Token` header and `?api_key=` parameter by default; Emby ignores
  Jellyfin's `?ApiKey=`.
- **Real-time socket**: `/socket` (Jellyfin, key in the upgrade request
  header) or `/embywebsocket` (Emby, which only binds the socket through
  `?api_key=`), then `SessionsStart` to receive the session list on every
  change. `KeepAlive` is sent at half the `ForceKeepAlive` period.
- **Players**: from `/Sessions`, keyed by the hash of their `DeviceId` (the
  session id changes on every reconnection). A session is a player when it
  accepts remote control or is playing something; web dashboards and the
  integration's own session are skipped.
- **Commands**: `POST /Sessions/{id}/Playing/{Pause|Unpause|Stop|…}`,
  `POST /Sessions/{id}/Command` (`SetVolume`, `Mute`, `Unmute`),
  `POST /Sessions/{id}/Message`, `POST /Sessions/{id}/Playing?playCommand=…`.
- **Libraries**: `/Library/VirtualFolders`, counts through
  `/Items?ParentId=…&Limit=0` (`TotalRecordCount`, nothing downloaded).
- **Intro/credits**: Jellyfin media segments (`/MediaSegments/{id}`, from a
  segment provider plugin such as Chapter Segments Provider), Emby chapter
  markers (`IntroStart`, `IntroEnd`, `CreditsStart`).
- **A refused API key stops every loop** until a new key is saved: a reverse
  proxy running fail2ban (SWAG's `nginx-unauthorized` jail bans on any 401)
  would otherwise ban the house.

## Try it without a TV

`tools/fake-player.mjs` signs in as a user, advertises itself as a
controllable player and obeys the remote-control commands:

```bash
node tools/fake-player.mjs --url http://192.168.1.20:8096 --user me --password secret \
  --name "Fake TV" --play <itemId>
# then type on stdin: pause | unpause | stop | play <itemId> | quit
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="jellyfin" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its sandboxed container. The SDK reads them
automatically.

## Quality checks

```bash
npm run format:check   # Prettier: is everything formatted?
npm run lint           # ESLint: catch real mistakes
npm test               # Unit tests, via the built-in `node --test` runner
```

The same three checks run on every push and pull request
(see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Publish

1. Make sure the repository is public and carries the GitHub topic
   `gladys-assistant-integration` (the decentralized indexer finds the
   integration through that topic).
2. Release from the GitHub UI: **Actions → Release → Run workflow** (patch /
   minor / major). The workflow bumps the version everywhere, pushes the tag
   and builds the multi-arch image to `ghcr.io`.
3. Validate locally anytime with `npx github:GladysAssistant/integration-store .`

## License

Apache-2.0
