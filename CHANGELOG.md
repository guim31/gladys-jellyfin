# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. Versions up to
0.3.0 are described in the GitHub Releases of the repository.

## [Unreleased]

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

### Changed

- Quieter logs: a normal refresh cycle, a scene event or a real-time socket
  reconnection no longer writes a line in the integration logs. A media server
  switched off or unreachable is reported once, then once when it is back,
  instead of once every 15 seconds (or every minute at startup); the same for
  a real-time socket refused by a reverse proxy, which warned at every
  reconnection attempt.
- Integration SDK 0.15 and dependencies updated.

### Fixed

- A command, scene action or widget action that fails is logged as a warning
  (it left no trace in the logs). After a configuration change, a failure of
  the new configuration is logged again instead of only in debug.
