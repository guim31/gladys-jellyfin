// -----------------------------------------------------------------------------
// Session payloads, trimmed from real answers of Jellyfin 12.1 and Emby 4.10
// (`GET /Sessions`), with the fields the integration reads.
// -----------------------------------------------------------------------------

import { CLIENT_DEVICE_ID } from '../../src/media/api.js';

export const TV_DEVICE_ID = 'dGl2aXR2LWxpdmluZy1yb29tLWFuZHJvaWR0dg==';
export const PHONE_DEVICE_ID = 'phone-1234';

/** A controllable TV app playing a movie. */
export function tvSession(overrides = {}) {
  return {
    Id: 'session-tv-1',
    DeviceId: TV_DEVICE_ID,
    DeviceName: 'Living room TV',
    Client: 'Jellyfin Android TV',
    UserName: 'alice',
    SupportsRemoteControl: true,
    SupportedCommands: ['SetVolume', 'Mute', 'Unmute', 'ToggleMute', 'DisplayMessage'],
    NowPlayingItem: {
      Id: '0c19a6f54d50d8bbbba00f8f4325de45',
      Name: 'Big Buck Bunny',
      Type: 'Movie',
      MediaType: 'Video',
      ProductionYear: 2008,
      RunTimeTicks: 6_000_000_000,
      ImageTags: { Primary: '8280d87905731335f4956a7af5054441' },
      Overview: 'A giant rabbit takes revenge.',
    },
    PlayState: {
      PositionTicks: 1_200_000_000,
      IsPaused: false,
      IsMuted: false,
      VolumeLevel: 80,
      PlayMethod: 'DirectPlay',
    },
    ...overrides,
  };
}

/** The same TV, connected but idle. */
export function idleTvSession(overrides = {}) {
  const session = tvSession(overrides);
  delete session.NowPlayingItem;
  session.PlayState = { IsPaused: false, IsMuted: false, VolumeLevel: 80 };
  return session;
}

/** A phone app, not remote-controllable, transcoding an episode. */
export function phoneEpisodeSession(overrides = {}) {
  return {
    Id: 'session-phone-1',
    DeviceId: PHONE_DEVICE_ID,
    DeviceName: 'Pixel 8',
    Client: 'Jellyfin Android',
    UserName: 'bob',
    SupportsRemoteControl: false,
    NowPlayingItem: {
      Id: '9fa15c031164950ba990333134d4c7f9',
      Name: 'Earthfall',
      Type: 'Episode',
      MediaType: 'Video',
      SeriesName: 'Pioneer One',
      SeriesId: '4def373444fc7a79b4592aed4ffe492e',
      SeriesPrimaryImageTag: '381ddb4f270478c3d121e95a1d480ece',
      ParentIndexNumber: 1,
      IndexNumber: 2,
      RunTimeTicks: 3_000_000_000,
      ImageTags: { Primary: 'f379437e6ac81691bf5fa0c8eeebebc5' },
    },
    PlayState: { PositionTicks: 0, IsPaused: true, IsMuted: false, PlayMethod: 'Transcode' },
    ...overrides,
  };
}

/** A web dashboard: neither playing nor controllable -> not a player. */
export function dashboardSession() {
  return {
    Id: 'session-web-1',
    DeviceId: 'firefox-dashboard',
    DeviceName: 'Firefox',
    Client: 'Jellyfin Web',
    UserName: 'admin',
    SupportsRemoteControl: false,
    PlayState: {},
  };
}

/** The session the servers create for this integration's own API calls. */
export function ownSession() {
  return {
    Id: 'session-gladys',
    DeviceId: CLIENT_DEVICE_ID,
    DeviceName: 'Gladys',
    Client: 'Gladys Assistant',
    SupportsRemoteControl: false,
    PlayState: {},
  };
}
