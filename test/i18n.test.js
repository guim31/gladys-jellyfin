// -----------------------------------------------------------------------------
// Translation guard: every text shown by Gladys exists in the four languages
// of its interface (en, fr, de, es), none is empty or too long, and German
// keeps the informal register ("du") of the other translations.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { LANGUAGES, MESSAGES, TEXTS } from '../src/i18n.js';

const EXPECTED = ['de', 'en', 'es', 'fr'];
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));

// Formal German pronouns, capitalized: "Sie", "Ihr", "Ihre"...
const FORMAL_GERMAN = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;

// Manifest properties holding a localized object (never a plain string).
const LOCALIZED_KEYS = new Set(['label', 'description', 'placeholder']);

/** Longest text allowed for a localized object of the manifest, by path. */
function maxLength(path) {
  if (path === 'description') {
    return 100; // store card: 100 characters at most per language
  }
  return path.endsWith('.label') ? 40 : 400;
}

/**
 * Every localized object of the manifest, with its path.
 * An object is localized as soon as it carries one language key.
 */
function localizedObjects(node, path = '', found = []) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => localizedObjects(child, `${path}[${i}]`, found));
  } else if (node && typeof node === 'object') {
    if (EXPECTED.some((lang) => lang in node)) {
      found.push({ path, value: node });
      return found;
    }
    for (const [key, child] of Object.entries(node)) {
      localizedObjects(child, path ? `${path}.${key}` : key, found);
    }
  }
  return found;
}

function checkLocalized(value, where, max) {
  assert.deepEqual(Object.keys(value).sort(), EXPECTED, `${where}: languages`);
  for (const lang of EXPECTED) {
    const text = value[lang];
    assert.equal(typeof text, 'string', `${where}.${lang}: not a string`);
    assert.ok(text.trim().length > 0, `${where}.${lang}: empty`);
    assert.ok(text.length <= max, `${where}.${lang}: ${text.length} > ${max} characters`);
  }
  assert.doesNotMatch(value.de, FORMAL_GERMAN, `${where}.de: formal "Sie/Ihr" register`);
}

test('the manifest has localized objects to check', () => {
  // Guard against a walker that silently finds nothing.
  assert.ok(localizedObjects(manifest).length > 100);
});

test('every localized object of the manifest has en, fr, de and es', () => {
  for (const { path, value } of localizedObjects(manifest)) {
    checkLocalized(value, path, maxLength(path));
  }
});

test('no label, description or placeholder of the manifest is a plain string', () => {
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (LOCALIZED_KEYS.has(key)) {
          assert.equal(typeof child, 'object', `${path}.${key} must be localized`);
        }
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(manifest, 'manifest');
});

test('the language setting offers exactly the languages of the code', () => {
  const field = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(field.options.map((o) => o.value).sort(), [...LANGUAGES].sort());
  assert.deepEqual([...LANGUAGES].sort(), EXPECTED);
});

test('the text table of the code has every key in every language', () => {
  assert.deepEqual(Object.keys(TEXTS).sort(), EXPECTED);
  const keys = Object.keys(TEXTS.en).sort();
  for (const lang of EXPECTED) {
    assert.deepEqual(Object.keys(TEXTS[lang]).sort(), keys, `TEXTS.${lang}: keys`);
    for (const [key, entry] of Object.entries(TEXTS[lang])) {
      const samples = typeof entry === 'function' ? [entry(1), entry(12)] : [entry];
      for (const text of samples) {
        const where = `TEXTS.${lang}.${key}`;
        assert.equal(typeof text, 'string', where);
        assert.ok(text.trim().length > 0, `${where}: empty`);
        // Feature names, badges and widget labels: short.
        assert.ok(text.length <= 60, `${where}: ${text.length} > 60 characters`);
        if (lang === 'de') {
          assert.doesNotMatch(text, FORMAL_GERMAN, `${where}: formal "Sie/Ihr" register`);
        }
      }
    }
  }
});

test('the widget buttons keep short labels', () => {
  for (const lang of EXPECTED) {
    for (const key of ['play', 'pause', 'stop', 'next']) {
      const label = TEXTS[lang][key];
      assert.ok(label.length <= 12, `TEXTS.${lang}.${key} "${label}" is too long for a button`);
    }
  }
});

test('every message sent to Gladys has en, fr, de and es', () => {
  assert.ok(Object.keys(MESSAGES).length > 0);
  for (const [key, entry] of Object.entries(MESSAGES)) {
    const value =
      typeof entry === 'function'
        ? entry(
            key === 'connected'
              ? { name: 'Home', label: 'Jellyfin', version: '10.11.0', libraries: 3, players: 2 }
              : 'Jellyfin',
          )
        : entry;
    checkLocalized(value, `MESSAGES.${key}`, 400);
  }
});

test('no localized object is written outside src/i18n.js', async () => {
  // A stray { en, fr } literal in the code would escape the checks above.
  const files = ['../index.js'];
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) {
        await walk(`${path}/`);
      } else if (path.endsWith('.js') && !path.endsWith('/i18n.js')) {
        files.push(path);
      }
    }
  };
  await walk('../src/');
  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(source, /\b(en|fr|de|es):\s*['"`]/, `${file}: text outside src/i18n.js`);
    assert.doesNotMatch(source, /language === '(en|fr|de|es)'/, `${file}: inline language choice`);
  }
});
