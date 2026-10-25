# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]

### Added

- **Music player of Gladys 5.3**: each Jellyfin / Emby player now shows in the
  new Music widget of the dashboard with the artwork, the title, the artist and
  the album of what it plays (for an episode: the episode, the series and the
  season; for a movie: its title), a progress bar you can drag to seek,
  shuffle, repeat and mute. New features on the player device: title, artist,
  album, artwork, duration, position (writable: a seek), shuffle and repeat.
- **Music panel of the widget**: browse the music library (albums, artists,
  playlists of the user signed in on the player), search it, and play a track,
  an album, an artist or a playlist on the player — now, next, or at the end of
  its queue. The same picker serves the new scene action of Gladys "Play a
  media". The play queue itself is not shown: the Jellyfin apps report it too
  late and cannot jump to one of its items.
- Artwork served by the integration, resized by the media server.

### Changed

- **Requires Gladys 5.3.0.**
- The playback state is now writable (pause, play, stop) and reads **2
  (stopped) when nothing is playing**, instead of 0: a scene waiting for "= 0"
  no longer starts when a player stops, only when it pauses.
- The mute feature becomes a music mute (on/off) instead of a TV push button
  that toggled; volume and mute are confirmed by the player's next report.
- Players already added to Gladys get the new features with **Update** in the
  Discover tab of the integration (same device, same scenes). Until then, the
  mute button keeps toggling as before. The "Now playing" text feature stays,
  for the scenes and dashboards that use it (it duplicates the new title).
- Integration SDK 0.16.

## [0.3.3] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [0.3.2] - 2026-10-13

### Fixed

- A command, scene action or widget action that fails is logged as a warning
  (it left no trace in the logs). After a configuration change, a failure of
  the new configuration is logged again instead of only in debug.

## [0.3.1] - 2026-10-13

### Changed

- Quieter logs: a normal refresh cycle, a scene event or a real-time socket
  reconnection no longer writes a line in the integration logs. A media server
  switched off or unreachable is reported once, then once when it is back,
  instead of once every 15 seconds (or every minute at startup); the same for
  a real-time socket refused by a reverse proxy, which warned at every
  reconnection attempt.
- Integration SDK 0.15 and dependencies updated.
