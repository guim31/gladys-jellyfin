# Jellyfin & Emby

Control the players of your **Jellyfin** or **Emby** server from Gladys, see
what is being watched around the house, and run scenes when playback
starts, pauses or stops — the classic "dim the lights when the movie
starts".

Works with Jellyfin 10.9 and later (checked on 10.11, 12.1 and 12.2) and with Emby
(checked on 4.10). The integration detects which server it talks to.

## Setup

1. **Create an API key** for Gladys on your server:
   - Jellyfin: **Dashboard > API Keys > +**, name it "Gladys";
   - Emby: **Settings > Advanced > API Keys > New API Key**.
2. In the **Configuration** tab of the integration, fill in:
   - the **server URL**, port included (for example
     `http://192.168.1.20:8096`). An https address behind a reverse proxy
     works too; you may paste the address from your browser, `/web/...` is
     removed automatically;
   - the **API key** created in step 1.
3. Save, then click **Test the connection**.
4. The devices show up in the **Discovery** tab.

A player (TV app, phone, browser) only shows up while it is **connected** to
the server: open the app on the TV, then click **Look for players**. A player
you added stays in Gladys even when it is off.

## What you get

**The server**: number of active playbacks, number of transcoded playbacks
(the ones that load the CPU), a "who watches what, where" summary, and one
counter per library (plus episodes for TV shows and tracks for music). The
counters can be turned off in the configuration.

**Each player**: what it plays (title, artist, album, artwork, duration,
position), play, pause, stop, previous, next, rewind, forward, volume, mute,
shuffle, repeat, playback state, a one-line "now playing" text, remaining
time, and two **"in intro"** and **"in credits"** flags.

The intro and credits flags need the server to know those parts:

- Jellyfin (10.10 and later): install a media segment provider, for example the official
  **Chapter Segments Provider** plugin (it reads chapters named "Intro",
  "Credits"...) or the **Intro Skipper** plugin;
- Emby: Emby's intro and credits detection.

Without them, both flags stay at 0.

## Music player of Gladys 5.3

Add the **Music** widget to a dashboard and pick a Jellyfin or Emby player:
it shows the artwork, the title, the artist and the album of what plays —
for an episode, the episode, the series and the season; for a movie, its
title — with a progress bar you can drag to seek, play/pause, previous,
next, shuffle, repeat, volume and mute.

The magnifier of the widget opens the **music library** of the server:
albums, artists and playlists (those of the user signed in on the player),
and a search. A tap plays a track, an album, an artist or a playlist on the
player; the other gesture of the panel adds it after the current track or at
the end of the queue. The same picker serves the **Play music on a speaker**
action of Gladys scenes. The play queue itself is not shown: the Jellyfin apps report
it late and cannot jump to one of its items.

Good to know:

- the player must be **connected** to the server and accept remote control
  (TV apps, the web client) to play something; browsing works anyway;
- the **playback state** reads 0 (paused), 1 (playing) or 2 (stopped: nothing
  playing). Before version 0.4 a stopped player read 0;
- **a player added before version 0.4**: open the **Discovery** tab of the
  integration and click **Update** on it. It keeps its name, room, scenes and
  dashboards, and gets the new features. Until then, the mute button keeps
  toggling as before;
- shuffle and repeat depend on the app (Jellyfin Web and the TV apps accept
  them); the integration says so when an app refuses;
- requires Gladys 5.3 or later.

## Scenes

Four triggers: **Playback started**, **Playback paused**, **Playback
resumed**, **Playback stopped**. Each one can be narrowed to one player and
to media types (movie, episode, music, live TV...). The `title`, `name`,
`series_name`, `media_type`, `user` and `player_name` variables are available
to the following actions.

Example: _Playback started, player "Living room TV", type Movie_ → dim the
living room; _Playback paused_ on the same player → lights back on.

Two scene actions:

- **Display a message on a player** — for example "Someone is at the door"
  over the movie;
- **Play a media on a player** — searches the library for a title (movie,
  series, album, artist, playlist...) and plays it, shuffled if you like.
  The title played is available to the rest of the scene.

Gladys 5.3 also offers its own **Play music on a speaker** action: pick the
player, then an album, an artist, a playlist or a track in the library.

The player must be connected to the server to receive a message or a media.

## Dashboard widgets

The **Music** widget of Gladys comes first (see above). The integration also
brings three widgets of its own:

- **Now playing**: who watches what, where, with the posters.
- **Player**: the current playback as a remote — the artwork (or the movie
  fan art), title, state, remaining time, and the play/pause, stop and next
  buttons. Leave the "Player" setting empty to follow whatever is playing, or
  pick a player to follow that one only.
- **Latest additions**: posters of the movies, series or albums added
  lately, new episodes grouped by series.

## Troubleshooting

- **"The server refused the API key"**: the key was deleted or badly copied.
  Create a new one and save it. The integration deliberately stops calling
  the server while the key is refused: a reverse proxy running fail2ban
  could otherwise ban your address.
- **A button does nothing**: not every app accepts remote control. TV apps
  and the web client do; some mobile apps do not. "Next" and "Previous" on an
  episode play the neighbour episode, which works even on apps without a play
  queue (Swiftfin).
- **The message does not show up**: it depends on the app. Jellyfin Web and
  Jellyfin for Android TV show it; Swiftfin (Apple TV, iOS) does not handle
  it yet, and the official iOS app does not show it during video playback.
- **The button does not change state right away**: the buttons of the
  "Player" widget show the expected state as soon as the command is sent,
  then the app confirms it (some take a few seconds).
- **The Music widget says the player did not respond**: the app did not
  confirm the command within 15 seconds. Some apps report the volume, mute,
  shuffle and repeat only every few seconds; an app that does not accept
  remote control never confirms.
- **The new features are missing on a player**: click **Update** on it in
  the Discovery tab of the integration (players added before version 0.4).
- **Updates are slow**: the integration follows playback in real time over a
  WebSocket. If your reverse proxy does not forward WebSockets, it falls back
  to polling every 15 seconds.
- The integration logs can be read from the Gladys interface.
