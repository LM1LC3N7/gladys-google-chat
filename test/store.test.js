// -----------------------------------------------------------------------------
// The real /data store, in a temporary directory: mode 0600, a torn or foreign
// file set aside as `.bad`, a file too large or a directory = unreadable
// (never overwritten), the last save wins.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore, StoreUnreadable } from '../src/store.js';

async function dir(t) {
  const path = await mkdtemp(join(tmpdir(), 'gchat-store-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('missing file: empty; saved with mode 0600, read back', async (t) => {
  const path = await dir(t);
  const store = new FileStore({ dir: path, name: 'state.json' });
  assert.deepEqual(await store.load(), {});
  await store.save({ salt: 'a', sends: [1] });
  assert.equal((await stat(join(path, 'state.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await store.load(), { salt: 'a', sends: [1] });
});

test('a torn file and a foreign JSON are set aside as .bad, never overwritten in place', async (t) => {
  const path = await dir(t);
  const file = join(path, 'state.json');
  const store = new FileStore({ dir: path, name: 'state.json' });
  await writeFile(file, '{"salt": "ab');
  assert.deepEqual(await store.load(), {});
  assert.equal(await readFile(`${file}.bad`, 'utf8'), '{"salt": "ab');
  await writeFile(file, '[1,2]');
  assert.deepEqual(await store.load(), {});
  assert.equal(await readFile(`${file}.bad`, 'utf8'), '[1,2]');
});

test('too large, or a directory: unreadable (not empty)', async (t) => {
  const path = await dir(t);
  const store = new FileStore({ dir: path, name: 'state.json' });
  await writeFile(join(path, 'state.json'), `"${'x'.repeat(2 * 1024 * 1024)}"`);
  await assert.rejects(store.load(), StoreUnreadable);
  const other = new FileStore({ dir: path, name: 'sub' });
  await mkdir(join(path, 'sub'));
  await assert.rejects(other.load(), StoreUnreadable);
});

test('saves one after the other: the last one lands last', async (t) => {
  const path = await dir(t);
  const store = new FileStore({ dir: path, name: 'state.json' });
  await Promise.all([1, 2, 3, 4, 5].map((n) => store.save({ n })));
  await store.flush();
  assert.deepEqual(await store.load(), { n: 5 });
});
