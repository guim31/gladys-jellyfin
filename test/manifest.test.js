// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { SCENE_TRIGGER } from '../src/scene-events.js';
import { WIDGET, LATEST_KINDS } from '../src/widgets.js';
import { MEDIA_TYPE } from '../src/media/sessions.js';
import { PLAY_MEDIA_TYPES } from '../src/monitor.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const indexSource = await read('../index.js');
const packageJson = JSON.parse(await read('../package.json'));

test('every manifest action, scene action and widget has a registered handler', () => {
  for (const action of manifest.actions) {
    assert.ok(indexSource.includes(`onAction('${action.key}'`), `action "${action.key}"`);
  }
  for (const action of manifest.scene_actions) {
    assert.ok(
      indexSource.includes(`onSceneAction('${action.key}'`),
      `scene action "${action.key}"`,
    );
  }
  const widgetKeys = manifest.widgets.map((w) => w.key).sort();
  assert.deepEqual(widgetKeys, Object.values(WIDGET).sort());
  for (const key of Object.keys(WIDGET)) {
    assert.ok(indexSource.includes(`onWidgetGet(WIDGET.${key}`), `widget ${key}`);
  }
});

test('the scene triggers fired by the code are the declared ones', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGER).sort(),
  );
  for (const trigger of manifest.scene_triggers) {
    const mediaType = trigger.fields.find((f) => f.key === 'media_type');
    assert.deepEqual(
      mediaType.options.map((o) => o.value).sort(),
      Object.values(MEDIA_TYPE).sort(),
      `${trigger.key}: media_type options`,
    );
    assert.ok(
      trigger.fields.every((f) => f.required === false),
      'filters are optional',
    );
  }
});

test('the option lists match what the code understands', () => {
  const play = manifest.scene_actions.find((a) => a.key === 'play_media');
  const mediaType = play.fields.find((f) => f.key === 'media_type');
  assert.deepEqual(
    mediaType.options.map((o) => o.value).sort(),
    Object.keys(PLAY_MEDIA_TYPES).sort(),
  );
  const latest = manifest.widgets.find((w) => w.key === 'latest_media');
  assert.deepEqual(
    latest.settings[0].options.map((o) => o.value).sort(),
    Object.keys(LATEST_KINDS).sort(),
  );
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('number fields use whole min and default values', () => {
  // Gladys renders them as <input type="number" min max> WITHOUT step: the
  // browser then only accepts min + k, so a decimal min or default would
  // make the form refuse valid values.
  const fields = [
    ...manifest.config_schema,
    ...manifest.scene_actions.flatMap((a) => a.fields),
    ...manifest.widgets.flatMap((w) => w.settings ?? []),
  ];
  for (const field of fields.filter((f) => f.type === 'number')) {
    for (const bound of ['min', 'max', 'default']) {
      if (field[bound] !== undefined) {
        assert.ok(Number.isInteger(field[bound]), `${field.key}.${bound} must be an integer`);
      }
    }
  }
});

test('store constraints: descriptions, versions, image, labels', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length <= 100, `description.${lang} is ${text.length} characters (max 100)`);
  }
  assert.equal(manifest.version, packageJson.version, 'manifest and package versions');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`), 'image tag = version');
  assert.match(manifest.gladys_version, />=\s*5\.1\.0/, 'widgets and scene declarations need 5.1');
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, `widget label "${text}"`);
    }
    for (const text of Object.values(widget.description ?? {})) {
      assert.ok(text.length <= 100, `widget description "${text}"`);
    }
  }
  for (const key of [...manifest.scene_triggers, ...manifest.scene_actions].map((d) => d.key)) {
    assert.match(key, /^[a-z0-9_]{1,40}$/);
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the user documentation exists in both languages', async () => {
  for (const lang of ['en', 'fr']) {
    const doc = await read(`../docs/${lang}.md`);
    assert.ok(doc.length >= 300, `docs/${lang}.md is too short for the store`);
  }
});
