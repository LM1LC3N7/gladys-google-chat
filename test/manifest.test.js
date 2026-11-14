// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code (config defaults, action, scene action, per-user field), so a
// key renamed on one side only fails here. No version is pinned: only its
// shape and its agreement across files. When the Gladys clone is on the
// machine, the core's own manifest validation runs on it too.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from '../src/config.js';
import {
  ACTIONS,
  RATE_DEFAULT,
  RATE_MAX,
  RATE_MIN,
  SCENE_ACTIONS,
  VERSION,
} from '../src/constants.js';
import { TEXTS } from '../src/i18n.js';

const CORE = '/home/claude/code/Gladys/server';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');
const field = (key) => manifest.config_schema.find((f) => f.key === key);

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics, the version agreeing everywhere, never pinned', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'communication');
  assert.deepEqual(manifest.messaging, { receive: false }, 'send only');
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.equal(manifest.countries, undefined, 'Google Workspace is worldwide');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.name, 'gladys-google-chat');
  assert.equal(lock.name, pkg.name);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(VERSION, pkg.version, 'the User-Agent carries the version');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-google-chat:${manifest.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-google-chat\//,
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['notifications']);
  assert.equal(manifest.keywords, undefined);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@gladysassistant/integration-sdk']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300);
    assert.match(docs, /never been tested with a real|jamais été testée avec un vrai/i);
    assert.match(docs, /Business|Enterprise/);
  }
});

test('every text is in English and French; sections within their limits', () => {
  for (const [path, entry] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(entry[lang]?.trim(), `${path} needs ${lang}`);
  }
  for (const section of [...manifest.config_schema, ...manifest.contact_schema].filter(
    (f) => f.type === 'section',
  )) {
    for (const lang of ['en', 'fr']) assert.ok(section.description[lang].length <= 1000);
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
  // Google Workspace Business or Enterprise is said where the user sets it up.
  for (const lang of ['en', 'fr']) {
    assert.match(field('intro').description[lang], /Business.*Enterprise/);
    assert.match(manifest.contact_schema[0].description[lang], /Business.*Enterprise/);
  }
});

test('no key starts with gladys_; secrets without default; nothing said encrypted', () => {
  for (const f of [...manifest.config_schema, ...manifest.contact_schema]) {
    assert.doesNotMatch(f.key, /^gladys_/);
    if (f.type === 'secret') {
      assert.equal(f.default, undefined, f.key);
      assert.equal(f.placeholder, undefined, f.key);
      for (const lang of ['en', 'fr']) {
        assert.match(f.description[lang], /Google Chat/);
        assert.match(f.description[lang], /never shown again|jamais réaffichée/);
      }
    }
  }
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /chiffré|chiffrée|chiffrement|encrypt|hachage/i, file);
  }
});

test('the config: defaults of the manifest are those of the code', () => {
  assert.equal(field('webhook_url').type, 'secret');
  assert.equal(field('webhook_url').required, false);
  const max = field('max_per_hour');
  assert.equal(max.default, RATE_DEFAULT);
  assert.equal(max.min, RATE_MIN);
  assert.equal(max.max, RATE_MAX);
  assert.deepEqual(DEFAULTS, { webhook_url: '', max_per_hour: max.default });
  assert.deepEqual(
    manifest.config_schema.map((f) => f.key),
    ['intro', 'webhook_url', 'max_per_hour'],
  );
});

test('the per-user field is the one the code reads', () => {
  const [section, url] = manifest.contact_schema;
  assert.equal(section.type, 'section');
  assert.deepEqual([url.key, url.type, url.required], ['webhook_url', 'secret', true]);
  assert.ok(app.includes('contact?.webhook_url'));
});

test('the action and the scene action are those the code handles; no device, no receiving', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  assert.ok(handlers.includes('onAction(ACTIONS.TEST'));
  assert.ok(handlers.includes('onAction(ACTIONS.FORGET'));
  assert.ok(handlers.includes('onSceneAction(SCENE_ACTIONS.POST'));
  assert.ok(handlers.includes('onSendMessage('));
  for (const a of [...manifest.actions, ...manifest.scene_actions]) {
    assert.ok(a.timeout_seconds >= 15 && a.timeout_seconds <= 120, a.key);
  }
  const [scene] = manifest.scene_actions;
  // The 15 s dedupe is said where the scene is built.
  for (const lang of ['en', 'fr']) assert.match(scene.description[lang], /15 s/);
  assert.match(read('README.md'), /15 s/);
  assert.deepEqual(
    scene.fields.map((f) => f.key),
    ['text', 'thread_key'],
  );
  assert.ok(app.includes('fields.text') && app.includes('fields.thread_key'));
  assert.deepEqual(
    scene.outputs.map((o) => [o.key, o.type]),
    [
      ['posted', 'boolean'],
      ['deduplicated', 'boolean'],
      ['message_name', 'string'],
    ],
  );
  for (const forbidden of [
    'onSetValue',
    'onPoll',
    'onScanRequest',
    'publishMessage',
    'linkContact',
    'onWebhook',
  ]) {
    assert.ok(!handlers.includes(forbidden) && !app.includes(forbidden), forbidden);
  }
  assert.equal(manifest.webhooks, undefined);
  assert.equal(manifest.scene_triggers, undefined);
});

test('no supported_options anywhere (no device): the core rules hold vacuously', () => {
  assert.ok(!JSON.stringify(manifest).includes('supported_options'));
});

test('the core accepts the manifest (its own validation, when the clone is here)', (t) => {
  const path = `${CORE}/lib/external-integration/externalIntegration.validateManifest.js`;
  if (!existsSync(path)) {
    t.skip('no Gladys clone');
    return;
  }
  // In a child process with its own directory: loading the core opens a
  // DuckDB file in the current directory.
  const dir = mkdtempSync(join(tmpdir(), 'gchat-core-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manifestPath = fileURLToPath(
    new URL('../gladys-assistant-integration.json', import.meta.url),
  );
  const script = `const { validateManifest } = require(${JSON.stringify(path)});
    validateManifest(require(${JSON.stringify(manifestPath)})); console.log('VALID');`;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.match(out, /VALID/);
});

test('every runtime text exists in both languages, same placeholders', () => {
  for (const [key, entry] of Object.entries(TEXTS)) {
    assert.deepEqual(Object.keys(entry).sort(), ['en', 'fr'], key);
    const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(names(entry.fr), names(entry.en), key);
  }
});
