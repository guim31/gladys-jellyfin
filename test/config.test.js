import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeConfig,
  normalizeServerUrl,
  isConfigured,
  DEFAULT_CONFIG,
} from '../src/config.js';

test('defaults when nothing is configured', () => {
  const config = normalizeConfig();
  assert.equal(config.server_url, '');
  assert.equal(config.api_key, '');
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(config.library_sensors, true);
  assert.equal(config.allow_self_signed, false);
  assert.equal(config.language, 'fr');
  assert.equal(isConfigured(config), false);
});

test('the server URL is cleaned the way users paste it', () => {
  assert.equal(normalizeServerUrl('192.168.1.20:8096'), 'http://192.168.1.20:8096');
  assert.equal(normalizeServerUrl(' http://nas:8096/ '), 'http://nas:8096');
  assert.equal(
    normalizeServerUrl('https://jellyfin.example.com/web/#/home.html'),
    'https://jellyfin.example.com',
  );
  assert.equal(normalizeServerUrl('http://nas:8096/web/index.html#!/home'), 'http://nas:8096');
  // A sub-path deployment (reverse proxy /jellyfin) is kept.
  assert.equal(
    normalizeServerUrl('https://example.com/jellyfin/web/'),
    'https://example.com/jellyfin',
  );
  assert.equal(normalizeServerUrl(''), '');
  assert.equal(normalizeServerUrl(undefined), '');
});

test('numbers and booleans may arrive as strings from the form', () => {
  const config = normalizeConfig({
    server_url: 'nas:8096',
    api_key: ' key ',
    poll_frequency: '120',
    library_sensors: 'false',
    allow_self_signed: 'true',
    language: 'en',
  });
  assert.equal(config.api_key, 'key');
  assert.equal(config.poll_frequency, 120);
  assert.equal(config.library_sensors, false);
  assert.equal(config.allow_self_signed, true);
  assert.equal(config.language, 'en');
  assert.equal(isConfigured(config), true);
});

test('the library interval is clamped, an empty value falls back to the default', () => {
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
  assert.equal(normalizeConfig({ poll_frequency: '' }).poll_frequency, 300);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 300);
});

test('an unknown language falls back to French', () => {
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
});
