// -----------------------------------------------------------------------------
// Entry point of the Jellyfin & Emby integration for Gladys Assistant.
//
// Role of this file: create the SDK instance and hand it to createApp()
// (src/app.js), which registers every handler and drives the MediaMonitor and
// the real-time socket. It holds no server logic itself.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// LOG_LEVEL=debug shows the detail of every refresh cycle.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const manifest = JSON.parse(
  readFileSync(new URL('./gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const gladys = new GladysIntegration();
const app = createApp(gladys, { version: manifest.version });

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  app.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info(`Starting the Jellyfin & Emby integration v${manifest.version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
