// -----------------------------------------------------------------------------
// The app through the SDK's fake Gladys: Gladys messages, the scene action,
// the Test button, the guards (refused URL, pauses, hourly cap, one message a
// second per space, dedupe), /data, the config read again, the secrets.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleChatApp } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import { settle, testClock } from './helpers/clock.js';
import {
  DEFAULT_URL,
  HOUR,
  KEY,
  MINUTE,
  SECOND,
  TOKEN,
  USER_URL,
  everythingSaid,
  json,
  netError,
  posted,
  setup,
  until,
  urlOf,
} from './helpers/app.js';

const msg = (text) => ({ text, file: null });
const lastStatus = (gladys) => gladys.fake.connectionStatuses.at(-1);

test('a Gladys message is posted once to the user space, in the Chat syntax', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const ack = await ctx.gladys.fake.sendMessage(
    { webhook_url: USER_URL },
    msg('**Alarm** in [cam](https://x.example/a)'),
  );
  assert.equal(ack.success, true);
  assert.equal(ctx.chat.calls.length, 1);
  const [call] = ctx.chat.calls;
  assert.equal(call.url, USER_URL);
  assert.deepEqual(call.body, { text: '*Alarm* in <https://x.example/a|cam>' });
  assert.match(
    call.headers['User-Agent'],
    /^gladys-google-chat\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/LM1LC3N7\/gladys-google-chat\)$/,
  );
  assert.equal(call.headers['Content-Type'], 'application/json; charset=UTF-8');
  assert.equal(call.redirect, 'manual');
});

test('an invalid or foreign URL: nothing sent, the error names no URL', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const bad = [
    '',
    'not a url',
    DEFAULT_URL.replace('https:', 'http:'),
    DEFAULT_URL.replace('chat.googleapis.com', 'chat.googleapis.com.evil.example'),
    DEFAULT_URL.replace('chat.googleapis.com', 'chat.googleapis.com:8443'),
    DEFAULT_URL.replace('https://', 'https://user:pw@'),
    `${DEFAULT_URL}&threadKey=x`,
    `${DEFAULT_URL}&key=other`,
    DEFAULT_URL.replace('/messages', '/messages/x'),
    `${DEFAULT_URL}%0d%0aX-Injected: 1`,
    `${DEFAULT_URL}\r\nX: 1`,
    `${DEFAULT_URL}#frag`,
  ];
  for (const url of bad) {
    const ack = await ctx.gladys.fake.sendMessage({ webhook_url: url }, msg('hello'));
    assert.equal(ack.success, false, url);
    assert.doesNotMatch(ack.error, /token=|Zq9s|evil|AAAAdefault/, url);
  }
  assert.equal(ctx.chat.calls.length, 0);
});

test('an empty message (an image alone): nothing sent, said', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const ack = await ctx.gladys.fake.sendMessage(
    { webhook_url: USER_URL },
    { text: '  ', file: 'image/jpg;base64,AAAA' },
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /empty/);
  assert.equal(ctx.chat.calls.length, 0);
  assert.ok(ctx.logger.lines.some((l) => /image is not sent/.test(l)));
});

test('a 401: nothing posted, the URL refused for good (fingerprint in /data), lifted by Test or a new URL', async (t) => {
  const ctx = await setup({ answer: () => json({ error: {} }, 401) });
  t.after(() => ctx.app.stop());
  const first = await ctx.gladys.fake.sendMessage({ webhook_url: DEFAULT_URL }, msg('one'));
  assert.equal(first.success, false);
  assert.match(first.error, /refused the webhook URL \(HTTP 401/);
  await until(() => lastStatus(ctx.gladys).connected === false);
  assert.match(lastStatus(ctx.gladys).message.en, /refused the webhook URL \(HTTP 401\)/);
  // Not tried again by a message nor a scene, an hour later included.
  await ctx.clock.advance(HOUR);
  const again = await ctx.gladys.fake.sendMessage({ webhook_url: DEFAULT_URL }, msg('two'));
  assert.match(again.error, /refused this webhook URL earlier/);
  const scene = await ctx.gladys.fake.sceneAction('post_message', { text: 'three' });
  assert.equal(scene.success, false);
  assert.equal(ctx.chat.calls.length, 1);
  // Kept as a salted fingerprint only.
  const refused = Object.keys(ctx.store.data.refused);
  assert.equal(refused.length, 1);
  assert.match(refused[0], /^[0-9a-f]{2}$/, '8 bits only');
  // A restart keeps it (same /data).
  const store = ctx.store;
  await ctx.app.stop();
  const next = await setup({ store, answer: () => posted() });
  t.after(() => next.app.stop());
  await until(() => next.app.loaded);
  const blocked = await next.gladys.fake.sendMessage({ webhook_url: DEFAULT_URL }, msg('four'));
  assert.equal(blocked.success, false);
  assert.equal(next.chat.calls.length, 0);
  // Another URL is always tried.
  const other = await next.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('five'));
  assert.equal(other.success, true);
  assert.equal(next.chat.calls.length, 1);
  // The Test button tries the refused URL again; its success lifts the refusal.
  const ack = await next.gladys.fake.action('test_webhook');
  assert.match(ack.data.en ?? ack.data.message?.en ?? JSON.stringify(ack.data), /posted/);
  assert.equal(next.chat.calls.length, 2);
  assert.deepEqual(Object.keys(next.store.data.refused), []);
  await next.clock.advance(2 * SECOND);
  const after = await next.gladys.fake.sendMessage({ webhook_url: DEFAULT_URL }, msg('six'));
  assert.equal(after.success, true);
  await until(() => lastStatus(next.gladys).connected === true);
});

test('403 and 404 are refusals too; a 400 is not (the next message goes)', async (t) => {
  for (const status of [403, 404]) {
    const ctx = await setup({ answer: () => json({}, status) });
    await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('a'));
    await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('b'));
    assert.equal(ctx.chat.calls.length, 1, String(status));
    await ctx.app.stop();
  }
  const ctx = await setup({ answer: () => json({}, 400) });
  t.after(() => ctx.app.stop());
  const a = await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('a'));
  assert.match(a.error, /rejected the message \(HTTP 400\)/);
  await ctx.clock.advance(2 * SECOND);
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('a'));
  assert.equal(ctx.chat.calls.length, 2, 'not refused, and the dedupe forgot the failed one');
});

test('a 429: nothing sent again, the space paused (Retry-After), kept across a restart', async (t) => {
  let n = 0;
  const ctx = await setup({
    answer: () => ((n += 1) === 1 ? json({}, 429, { 'retry-after': '300' }) : posted()),
  });
  t.after(() => ctx.app.stop());
  const first = await ctx.gladys.fake.sendMessage({ webhook_url: DEFAULT_URL }, msg('one'));
  assert.equal(first.success, false);
  assert.match(first.error, /too many requests/);
  await until(() => /slow down/.test(lastStatus(ctx.gladys).message?.en ?? ''));
  await ctx.clock.advance(4 * MINUTE);
  const paused = await ctx.gladys.fake.sendMessage({ webhook_url: DEFAULT_URL }, msg('two'));
  assert.match(paused.error, /slow down for this space: nothing sent for 1 more min/);
  // Another space is not paused.
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'))).success,
    true,
  );
  assert.equal(ctx.chat.calls.length, 2);
  // A restart within the pause keeps it.
  const store = ctx.store;
  assert.equal(Object.keys(store.data.pauses).length, 1);
  await ctx.app.stop();
  const clock = testClock({ start: Date.UTC(2026, 10, 14, 10, 4, 30) });
  const next = await setup({ store, clock });
  t.after(() => next.app.stop());
  await until(() => next.app.loaded);
  assert.equal(
    (await next.gladys.fake.sendMessage({ webhook_url: DEFAULT_URL }, msg('three'))).success,
    false,
  );
  assert.equal(next.chat.calls.length, 0);
  await next.clock.advance(MINUTE);
  assert.equal(
    (await next.gladys.fake.sendMessage({ webhook_url: DEFAULT_URL }, msg('four'))).success,
    true,
  );
  // The status came back by itself at the end of the pause.
  assert.equal(lastStatus(next.gladys).connected, true);
});

test('pauses without Retry-After: 1 min, then doubling, bounded to 6 h; reset by a success', async (t) => {
  let mode = 429;
  const ctx = await setup({ answer: () => (mode === 429 ? json({}, 429) : posted()) });
  t.after(() => ctx.app.stop());
  const pauses = [];
  for (let i = 0; i < 12; i += 1) {
    await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg(`m${i}`));
    pauses.push(ctx.app.pauses.get(ctx.app.pauses.keys().next().value).due - ctx.clock.monotonic());
    await ctx.clock.advance(pauses.at(-1) + 10);
  }
  const minutes = pauses.map((p) => Math.round(p / MINUTE));
  assert.deepEqual(minutes, [1, 2, 4, 8, 16, 32, 64, 128, 256, 360, 360, 360]);
  // A Retry-After far away is bounded too.
  mode = 'ok';
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('ok'));
  assert.equal(ctx.app.backoffs.size, 0);
});

test('a Retry-After beyond 6 h is bounded to 6 h; under 1 min raised to 1 min', async (t) => {
  for (const [header, expected] of [
    ['999999', 6 * 60],
    ['3', 1],
  ]) {
    const ctx = await setup({ answer: () => json({}, 429, { 'retry-after': header }) });
    await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'));
    const [pause] = ctx.app.pauses.values();
    assert.equal(Math.round((pause.due - ctx.clock.monotonic()) / MINUTE), expected);
    await ctx.app.stop();
  }
  t.diagnostic('bounded');
});

test('a 5xx: maybe posted, never sent again, the space paused', async (t) => {
  const ctx = await setup({ answer: () => json({}, 503) });
  t.after(() => ctx.app.stop());
  const ack = await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('once'));
  assert.equal(ack.success, true, 'maybe posted: not an error for Gladys');
  await ctx.clock.advance(10 * MINUTE);
  assert.equal(ctx.chat.calls.length, 1);
  assert.ok(ctx.logger.lines.some((l) => /HTTP 503, maybe posted, not sent again/.test(l)));
  // The same text a little later: the dedupe keeps it (it may be in the space).
  const scene = await setup({ answer: () => json({}, 500) });
  t.after(() => scene.app.stop());
  const out = await scene.gladys.fake.sceneAction('post_message', { text: 'x' });
  assert.equal(out.success, false);
  assert.match(out.error, /may or may not be posted; it is not sent again/);
  assert.equal(scene.chat.calls.length, 1);
});

test('no answer: Gladys gets its ack within 3.5 s, the request is never sent again', async (t) => {
  const ctx = await setup({ answer: () => 'hang' });
  t.after(() => ctx.app.stop());
  const started = ctx.clock.monotonic();
  let acked;
  const ack = ctx.gladys.fake
    .sendMessage({ webhook_url: USER_URL }, msg('slow'))
    .then((a) => (acked = a));
  await ctx.clock.advance(3400);
  assert.equal(acked, undefined);
  await ctx.clock.advance(200);
  await ack;
  assert.equal(acked.success, true);
  assert.ok(ctx.clock.monotonic() - started < 4000);
  // The request times out later: logged, not sent again.
  await ctx.clock.advance(10 * SECOND);
  await ctx.app.idle();
  assert.equal(ctx.chat.calls.length, 1);
  assert.ok(
    ctx.logger.lines.some((l) => /no answer \(timeout\); maybe posted, not sent again/.test(l)),
  );
});

test('the scene action waits for the answer: a timeout says "maybe posted", never retried', async (t) => {
  const ctx = await setup({ answer: () => 'hang' });
  t.after(() => ctx.app.stop());
  const out = ctx.gladys.fake.sceneAction('post_message', { text: 'x' });
  await ctx.clock.advance(11 * SECOND);
  const ack = await out;
  assert.equal(ack.success, false);
  assert.match(
    ack.error,
    /without an answer from Google Chat: the message may be posted; it is not sent again/,
  );
  assert.equal(ctx.chat.calls.length, 1);
});

test('Google unreachable before sending (DNS, refused, certificate): nothing sent, said', async (t) => {
  for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'CERT_HAS_EXPIRED']) {
    const ctx = await setup({ answer: () => netError(code) });
    const ack = await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'));
    assert.equal(ack.success, false, code);
    assert.match(ack.error, /could not be reached.*nothing sent/);
    assert.equal(ctx.chat.calls.length, 1);
    await ctx.app.stop();
  }
  const ctx = await setup({ answer: () => netError('ECONNRESET') });
  t.after(() => ctx.app.stop());
  const ack = await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'));
  assert.equal(ack.success, true, 'a reset after sending: maybe posted');
  assert.equal(ctx.chat.calls.length, 1);
});

test('the hourly cap: all spaces, Test included; refused beyond, back after the hour; kept across a restart', async (t) => {
  const ctx = await setup({ config: { webhook_url: DEFAULT_URL, max_per_hour: 3 } });
  t.after(() => ctx.app.stop());
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('1'))).success,
    true,
  );
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: urlOf('AAAAother') }, msg('2'))).success,
    true,
  );
  await ctx.gladys.fake.action('test_webhook');
  const over = await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('4'));
  assert.match(over.error, /cap of 3 messages per hour is reached: nothing sent/);
  assert.equal(ctx.chat.calls.length, 3);
  // Restarted 10 min later: the cap still counts the three.
  const store = ctx.store;
  await ctx.app.stop();
  const clock = testClock({ start: Date.UTC(2026, 10, 14, 10, 10, 0) });
  const next = await setup({ store, clock, config: { webhook_url: DEFAULT_URL, max_per_hour: 3 } });
  t.after(() => next.app.stop());
  await until(() => next.app.loaded);
  assert.equal(
    (await next.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('5'))).success,
    false,
  );
  await next.clock.advance(51 * MINUTE);
  assert.equal(
    (await next.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('6'))).success,
    true,
  );
  assert.equal(next.chat.calls.length, 1);
});

test('a date ahead in /data is not valid (a clock set back does not block for hours)', async (t) => {
  const store = createMemoryStore({
    salt: '0123456789abcdef0123456789abcdef',
    sends: [Date.UTC(2026, 10, 14, 12, 0, 0), Date.UTC(2026, 10, 14, 12, 0, 1)],
    pauses: {},
    refused: {},
  });
  const ctx = await setup({ store, config: { webhook_url: DEFAULT_URL, max_per_hour: 2 } });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'))).success,
    true,
  );
});

test('one message a second per space: the next waits its slot, a burst beyond 2 s is refused', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const acks = [1, 2, 3, 4].map((i) =>
    ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg(`m${i}`)),
  );
  // Another space is not held up by this one.
  const other = ctx.gladys.fake.sendMessage({ webhook_url: urlOf('AAAAother') }, msg('o'));
  await ctx.clock.advance(3 * SECOND);
  const results = await Promise.all(acks);
  await other;
  assert.deepEqual(
    results.map((r) => r.success),
    [true, true, true, false],
  );
  assert.match(results[3].error, /one a second\): nothing sent/);
  const own = ctx.chat.calls.filter((c) => c.url === USER_URL).map((c) => c.at);
  assert.equal(own.length, 3);
  for (let i = 1; i < own.length; i += 1)
    assert.ok(own[i] - own[i - 1] >= 1100, `gap ${own[i] - own[i - 1]}`);
  const otherCall = ctx.chat.calls.find((c) => c.url !== USER_URL);
  assert.ok(otherCall.at - own[0] < 10, 'the other space went at once');
});

test('the same text to the same space within 15 s: posted once (users sharing a space)', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const a = ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('Backup failed'));
  const b = ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('Backup failed'));
  await ctx.clock.advance(2 * SECOND);
  assert.equal((await a).success, true);
  assert.equal((await b).success, true);
  assert.equal(ctx.chat.calls.length, 1);
  await ctx.clock.advance(14 * SECOND);
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('Backup failed'));
  assert.equal(ctx.chat.calls.length, 2);
});

test('scene action: default space, thread key, outputs; no default space or a bad key: nothing sent', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const ack = await ctx.gladys.fake.sceneAction('post_message', {
    text: 'Door',
    thread_key: 'alarm',
  });
  assert.equal(ack.success, true);
  assert.deepEqual(ack.data.outputs, {
    posted: true,
    deduplicated: false,
    message_name: 'spaces/AAAAdefault/messages/m1.m1',
  });
  const [call] = ctx.chat.calls;
  assert.equal(call.url, `${DEFAULT_URL}&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`);
  assert.deepEqual(call.body, { text: 'Door', thread: { threadKey: 'alarm' } });
  const bad = await ctx.gladys.fake.sceneAction('post_message', {
    text: 'x',
    thread_key: 'a b\r\n',
  });
  assert.equal(bad.success, false);
  await ctx.gladys.fake.configUpdated({ max_per_hour: 60 });
  const none = await ctx.gladys.fake.sceneAction('post_message', { text: 'y' });
  assert.match(none.error, /no default space/);
  assert.equal(ctx.chat.calls.length, 1);
  assert.match(lastStatus(ctx.gladys).message.en, /without a default space/);
  assert.equal(lastStatus(ctx.gladys).connected, true);
});

test('the Test button: no default space, an invalid one, then a post', async (t) => {
  const ctx = await setup({ config: { max_per_hour: 60 } });
  t.after(() => ctx.app.stop());
  const none = await ctx.gladys.fake.action('test_webhook');
  assert.match(JSON.stringify(none.data), /no default space/);
  await ctx.gladys.fake.configUpdated({ webhook_url: 'https://example.com/hook' });
  const invalid = await ctx.gladys.fake.action('test_webhook');
  assert.match(JSON.stringify(invalid.data), /must start with https:\/\/chat\.googleapis\.com/);
  assert.equal(lastStatus(ctx.gladys).connected, false);
  await ctx.gladys.fake.configUpdated({ webhook_url: DEFAULT_URL });
  const ok = await ctx.gladys.fake.action('test_webhook');
  assert.match(JSON.stringify(ok.data), /Message posted in the space/);
  assert.match(ctx.chat.calls[0].body.text, /Gladys test message.*Message de test de Gladys/);
  assert.equal(ctx.chat.calls.length, 1);
  assert.match(lastStatus(ctx.gladys).message.en, /last message to the default space was posted/);
});

test('getConfig() failing in connected: status said, read again (spaced), then ready', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  // A second app on the same Gladys, never configured: its reads fail twice.
  const app = new GoogleChatApp({
    gladys: ctx.gladys,
    store: createMemoryStore(),
    fetch: ctx.chat.fetch,
    logger: ctx.logger,
    timers: ctx.clock.timers,
    now: ctx.clock.now,
    monotonic: ctx.clock.monotonic,
  });
  t.after(() => app.stop());
  ctx.app.stop();
  const real = ctx.gladys.getConfig.bind(ctx.gladys);
  let fails = 2;
  let reads = 0;
  ctx.gladys.getConfig = async () => {
    reads += 1;
    if (fails > 0) {
      fails -= 1;
      throw Object.assign(new Error('boom'), { status: 503 });
    }
    return real();
  };
  await app.connected();
  assert.match(lastStatus(ctx.gladys).message.en, /configuration could not be read/);
  assert.equal(lastStatus(ctx.gladys).connected, false);
  // Without its config: no default space, nothing sent.
  await assert.rejects(app.postMessage({ text: 'x' }), /no default space/);
  // Read again after 5 s, then 10 s (spaced), never faster.
  await ctx.clock.advance(4900);
  assert.equal(reads, 1);
  await ctx.clock.advance(200);
  assert.equal(reads, 2);
  await ctx.clock.advance(9800);
  assert.equal(reads, 2);
  await ctx.clock.advance(300);
  assert.equal(reads, 3);
  await until(() => lastStatus(ctx.gladys).connected === true);
  assert.match(lastStatus(ctx.gladys).message.en, /default space is set/);
  const out = app.postMessage({ text: 'x' });
  assert.equal((await out).posted, true);
  // A later reconnection whose read fails keeps the config read before.
  fails = 1;
  await app.connected();
  assert.equal(lastStatus(ctx.gladys).connected, true);
  await ctx.clock.advance(10 * SECOND);
  assert.equal(reads, 5);
});

test('/data unreadable: messages go on, nothing written; read again on its timer, then kept', async (t) => {
  const store = createMemoryStore({
    salt: '0123456789abcdef0123456789abcdef',
    refused: {},
    pauses: {},
    sends: [],
  });
  store.unreadable = true;
  const ctx = await setup({ store, answer: () => json({}, 401) });
  t.after(() => ctx.app.stop());
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'));
  assert.equal(store.saves, 0, '/data never overwritten while unreadable');
  assert.equal(ctx.chat.calls.length, 1);
  // Refused in memory all the same.
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('y'));
  assert.equal(ctx.chat.calls.length, 1);
  store.unreadable = false;
  await ctx.clock.advance(10 * SECOND);
  await until(() => ctx.app.loaded);
  assert.ok(store.saves >= 1);
  assert.equal(store.data.salt, '0123456789abcdef0123456789abcdef', 'the salt kept');
  assert.equal(Object.keys(store.data.refused).length, 1);
});

test('/data hanging: one read at a time, messages never wait for it', async (t) => {
  const store = createMemoryStore();
  store.hang = true;
  const ctx = await setup({ store });
  t.after(() => ctx.app.stop());
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'))).success,
    true,
  );
  await ctx.clock.advance(MINUTE);
  assert.equal(store.loads, 1, 'never a second read beside a hung one');
});

test('save() failing: logged, the message still goes', async (t) => {
  const store = createMemoryStore();
  store.failSave = true;
  const ctx = await setup({ store });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'))).success,
    true,
  );
  await settle();
  assert.ok(ctx.logger.lines.some((l) => /\/data not written \(Error\)/.test(l)));
});

test('the URLs, keys and tokens never reach a log, a status, an ack or /data', async (t) => {
  const answers = [
    json({}, 401),
    json({}, 429),
    json({}, 503),
    'hang',
    netError('ENOTFOUND'),
    json({}, 400),
    posted(),
  ];
  let i = 0;
  const ctx = await setup({ answer: () => answers[i++ % answers.length] });
  t.after(() => ctx.app.stop());
  const spaces = ['AAAA1', 'AAAA2', 'AAAA3', 'AAAA4', 'AAAA5', 'AAAA6', 'AAAA7'];
  for (const space of spaces) {
    const sent = ctx.gladys.fake.sendMessage({ webhook_url: urlOf(space) }, msg(`to ${space}`));
    await ctx.clock.advance(11 * SECOND);
    await sent;
  }
  await ctx.gladys.fake.sceneAction('post_message', { text: 'x' });
  const dup1 = ctx.gladys.fake.sendMessage({ webhook_url: urlOf('AAAAdup') }, msg('dup'));
  const dup2 = ctx.gladys.fake.sendMessage({ webhook_url: urlOf('AAAAdup') }, msg('dup'));
  await ctx.clock.advance(11 * SECOND);
  await dup1;
  await dup2;
  await ctx.gladys.fake.action('test_webhook');
  await ctx.gladys.fake.configUpdated({ webhook_url: `${DEFAULT_URL}&x=1` });
  await ctx.gladys.fake.action('test_webhook');
  await ctx.app.idle();
  const said = everythingSaid(ctx);
  for (const secret of [TOKEN, KEY, 'Zq9sEcReT', 'token=', 'key=', 'chat.googleapis.com/v1']) {
    assert.ok(!said.includes(secret), secret);
  }
  assert.ok(said.includes('space #'), 'spaces are named by a short fingerprint');
  assert.ok(said.includes('Same message to space #'), 'the dedupe line was written');
  for (const space of [...spaces, 'AAAAdefault', 'AAAAdup'])
    assert.ok(!said.includes(space), space);
});

test('stop: a message waiting its slot is not sent, no timer left, nothing after', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const first = ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('1'));
  const second = ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('2'));
  await settle();
  await ctx.app.stop();
  assert.equal((await first).success, true);
  const ack = await second;
  assert.equal(ack.success, false);
  assert.match(ack.error, /stopping: nothing sent/);
  assert.equal(ctx.chat.calls.length, 1);
  assert.equal(ctx.clock.pending, 0, 'no timer left');
  await ctx.clock.advance(HOUR);
  assert.equal(ctx.chat.calls.length, 1);
});

test('nothing is sent on its own: connecting, config saved, time passing', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  await ctx.gladys.fake.configUpdated({ webhook_url: DEFAULT_URL, max_per_hour: 10 });
  await ctx.clock.advance(24 * HOUR);
  assert.equal(ctx.chat.calls.length, 0);
  assert.equal(ctx.clock.pending, 0);
});

test('a status is published once per change (not on every message)', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const before = ctx.gladys.fake.connectionStatuses.length;
  for (let i = 0; i < 5; i += 1) {
    await ctx.gladys.fake.sceneAction('post_message', { text: `m${i}` });
    await ctx.clock.advance(2 * SECOND);
  }
  assert.equal(ctx.gladys.fake.connectionStatuses.length, before + 1);
});

test('a reply from an older connection never sets the status', async (t) => {
  const ctx = await setup({ connect: false });
  t.after(() => ctx.app.stop());
  let release;
  const real = ctx.gladys.getConfig.bind(ctx.gladys);
  let calls = 0;
  ctx.gladys.getConfig = async () => {
    calls += 1;
    if (calls === 1) {
      await new Promise((r) => (release = r));
      return { webhook_url: 'https://bad.example/' };
    }
    return real();
  };
  const app = ctx.app;
  const first = app.connected();
  await settle();
  await app.connected();
  release();
  await first;
  assert.equal(lastStatus(ctx.gladys).connected, true);
  assert.ok(app instanceof GoogleChatApp);
});

test('a timer firing early never lets a message leave before its slot', async (t) => {
  const clock = testClock({ start: Date.UTC(2026, 10, 14, 10, 0, 0) });
  // Timers that fire 10 % early, as a coarse clock may.
  const early = {
    ...clock,
    timers: {
      ...clock.timers,
      setTimeout: (fn, ms, ...args) => clock.timers.setTimeout(fn, ms * 0.9, ...args),
    },
  };
  const ctx = await setup({ clock: early });
  t.after(() => ctx.app.stop());
  const a = ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('a'));
  const b = ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('b'));
  await clock.advance(3 * SECOND);
  await a;
  await b;
  const [first, second] = ctx.chat.calls.map((c) => c.at);
  assert.ok(second - first >= 1100, `gap ${second - first}`);
});

test('a message waiting its slot is not sent when the one before it got a 429', async (t) => {
  const ctx = await setup({ answer: () => json({}, 429) });
  t.after(() => ctx.app.stop());
  const a = ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('a'));
  const b = ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('b'));
  await ctx.clock.advance(3 * SECOND);
  assert.equal((await a).success, false);
  const second = await b;
  assert.match(second.error, /slow down for this space/);
  assert.equal(ctx.chat.calls.length, 1);
  // Nothing posted: the cap does not count the one never sent.
  assert.equal(ctx.app.sends.length, 1);
});

test('a pause kept in /data is capped to 6 h (a far date is not trusted)', async (t) => {
  const salt = '0123456789abcdef0123456789abcdef';
  const probe = await setup({ store: createMemoryStore({ salt }) });
  await until(() => probe.app.loaded);
  const fp = probe.app.fingerprint('space', 'AAAAuser1');
  await probe.app.stop();
  const store = createMemoryStore({
    salt,
    pauses: { [fp]: { until: Date.UTC(2026, 10, 20), backoff: 60_000 } },
    refused: {},
    sends: [],
  });
  const ctx = await setup({ store });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('a'))).success,
    false,
  );
  await ctx.clock.advance(6 * HOUR + SECOND);
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('b'))).success,
    true,
  );
});

test('stop cuts a request waiting for its answer (no hang, nothing left)', async (t) => {
  const ctx = await setup({ answer: () => 'hang' });
  t.after(() => ctx.app.stop());
  const sent = ctx.app.deliver(USER_URL, 'x');
  await settle();
  assert.equal(ctx.chat.calls.length, 1);
  let timer;
  const stopped = await Promise.race([
    ctx.app.stop().then(() => 'stopped'),
    new Promise((resolve) => (timer = setTimeout(() => resolve('hung'), 10_000))),
  ]);
  clearTimeout(timer);
  assert.equal(stopped, 'stopped');
  assert.equal((await sent).kind, 'unconfirmed');
  assert.equal(ctx.clock.pending, 0);
});

// --- Review r1: spaces shared by webhooks, dedupe outcome, 8-bit fingerprints --

const SHARED_A = urlOf('AAAAshared', 'TokenOfWebhookA-1%3D');
const SHARED_B = urlOf('AAAAshared', 'TokenOfWebhookB-2%3D');

test('two webhooks of one Google space share its slot and its pause', async (t) => {
  let n = 0;
  const ctx = await setup({
    answer: () => ((n += 1) === 2 ? json({}, 429) : posted('AAAAshared')),
  });
  t.after(() => ctx.app.stop());
  const a = ctx.gladys.fake.sendMessage({ webhook_url: SHARED_A }, msg('a'));
  const b = ctx.gladys.fake.sendMessage({ webhook_url: SHARED_B }, msg('b'));
  await ctx.clock.advance(3 * SECOND);
  assert.equal((await a).success, true);
  assert.equal((await b).success, false, 'the 429');
  const [first, second] = ctx.chat.calls.map((c) => c.at);
  assert.ok(second - first >= 1100, 'one slot for the space, whatever the webhook');
  // The 429 on webhook B pauses webhook A too: same space.
  const c = await ctx.gladys.fake.sendMessage({ webhook_url: SHARED_A }, msg('c'));
  assert.match(c.error, /slow down for this space/);
  assert.equal(ctx.chat.calls.length, 2);
  // A refusal stays per webhook (its token).
});

test('a 401 on one webhook of a space does not refuse its other webhooks', async (t) => {
  let n = 0;
  const ctx = await setup({
    answer: () => ((n += 1) === 1 ? json({}, 401) : posted('AAAAshared')),
  });
  t.after(() => ctx.app.stop());
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: SHARED_A }, msg('a'))).success,
    false,
  );
  await ctx.clock.advance(2 * SECOND);
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: SHARED_B }, msg('b'))).success,
    true,
  );
});

test('the same text through two webhooks of one space: posted once', async (t) => {
  const ctx = await setup({ answer: () => posted('AAAAshared') });
  t.after(() => ctx.app.stop());
  const a = ctx.gladys.fake.sendMessage({ webhook_url: SHARED_A }, msg('Backup failed'));
  const b = ctx.gladys.fake.sendMessage({ webhook_url: SHARED_B }, msg('Backup failed'));
  await ctx.clock.advance(2 * SECOND);
  assert.equal((await a).success, true);
  assert.equal((await b).success, true);
  assert.equal(ctx.chat.calls.length, 1);
});

test('a duplicate takes the outcome of the first: a 429 fails both, nothing said posted', async (t) => {
  const ctx = await setup({ answer: () => json({}, 429) });
  t.after(() => ctx.app.stop());
  const one = ctx.gladys.fake.sceneAction('post_message', { text: 'Door open' });
  const two = ctx.gladys.fake.sceneAction('post_message', { text: 'Door open' });
  const three = ctx.gladys.fake.sendMessage({ webhook_url: DEFAULT_URL }, msg('Door open'));
  await ctx.clock.advance(2 * SECOND);
  assert.equal((await one).success, false);
  assert.equal((await two).success, false);
  assert.match((await two).error, /too many requests/);
  assert.equal((await three).success, false);
  assert.equal(ctx.chat.calls.length, 1);
});

test('a duplicate after a posted message says "already posted" (posted true, deduplicated true)', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const one = await ctx.gladys.fake.sceneAction('post_message', { text: 'Door open' });
  assert.deepEqual(one.data.outputs, {
    posted: true,
    deduplicated: false,
    message_name: 'spaces/AAAAdefault/messages/m1.m1',
  });
  await ctx.clock.advance(3 * SECOND);
  const two = await ctx.gladys.fake.sceneAction('post_message', { text: 'Door open' });
  assert.deepEqual(two.data.outputs, {
    posted: true,
    deduplicated: true,
    message_name: 'spaces/AAAAdefault/messages/m1.m1',
  });
  // Another thread key is another message.
  const three = await ctx.gladys.fake.sceneAction('post_message', {
    text: 'Door open',
    thread_key: 'garage',
  });
  assert.equal(three.data.outputs.posted, true);
  assert.equal(ctx.chat.calls.length, 2);
  // The Test button clicked twice within 15 s says it too.
  await ctx.clock.advance(2 * SECOND);
  const test1 = await ctx.gladys.fake.action('test_webhook');
  await ctx.clock.advance(2 * SECOND);
  const test2 = await ctx.gladys.fake.action('test_webhook');
  assert.match(JSON.stringify(test1.data), /Message posted/);
  assert.match(JSON.stringify(test2.data), /Already posted/);
});

test('maybe posted (no answer, 5xx): the same text within 15 s is not sent again', async () => {
  for (const answer of ['hang', json({}, 502)]) {
    const ctx = await setup({ answer: () => answer });
    const first = ctx.app.deliver(USER_URL, 'Smoke');
    await ctx.clock.advance(11 * SECOND);
    const kind = (await first).kind;
    assert.ok(['unconfirmed', 'serverError'].includes(kind), kind);
    // 5xx pauses the space; no answer does not: the dedupe alone holds it back.
    ctx.app.pauses.clear();
    const again = await ctx.app.deliver(USER_URL, 'Smoke');
    assert.equal(again.kind, kind);
    assert.equal(again.duplicate, true);
    assert.equal(ctx.chat.calls.length, 1, kind);
    await ctx.app.stop();
  }
});

test('a 429 pause is in /data at once (a restart right after keeps it)', async (t) => {
  const ctx = await setup({ answer: () => json({}, 429, { 'retry-after': '600' }) });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  const saves = ctx.store.saves;
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'));
  await settle();
  assert.ok(ctx.store.saves >= saves + 2, 'saved before sending and after the 429');
  const [fp] = Object.keys(ctx.store.data.pauses);
  assert.match(fp, /^[0-9a-f]{2}$/);
  const end = ctx.store.data.pauses[fp].until;
  assert.ok(Math.abs(end - Date.UTC(2026, 10, 14, 10, 10, 0)) < 1000, '600 s later');
});

test('the status comes back by itself at the end of a pause of the default space', async (t) => {
  const ctx = await setup({ answer: () => json({}, 429, { 'retry-after': '120' }) });
  t.after(() => ctx.app.stop());
  await ctx.gladys.fake.sceneAction('post_message', { text: 'x' });
  await until(() => lastStatus(ctx.gladys).connected === false);
  await ctx.clock.advance(119 * SECOND);
  assert.equal(lastStatus(ctx.gladys).connected, false);
  await ctx.clock.advance(2 * SECOND);
  assert.equal(lastStatus(ctx.gladys).connected, true);
  assert.equal(ctx.chat.calls.length, 1);
});

test('the Forget button: a refused contact URL is tried again by its next message', async (t) => {
  let n = 0;
  const ctx = await setup({ answer: () => ((n += 1) === 1 ? json({}, 403) : posted('AAAAuser1')) });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('a'));
  await ctx.clock.advance(2 * SECOND);
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('b'))).success,
    false,
  );
  const ack = await ctx.gladys.fake.action('forget_refused');
  assert.match(JSON.stringify(ack.data), /1 refused webhook URL/);
  assert.deepEqual(ctx.store.data.refused, {});
  assert.equal(ctx.chat.calls.length, 1, 'the click sends nothing');
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('c'))).success,
    true,
  );
});

test('/data never confirms a URL: its salt and 8-bit fingerprint match many candidates', async (t) => {
  const ctx = await setup({ answer: () => json({}, 401) });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('x'));
  await settle();
  const { salt, refused } = ctx.store.data;
  const [fp] = Object.keys(refused);
  const { createHmac, randomBytes } = await import('node:crypto');
  let matches = 0;
  for (let i = 0; i < 4096; i += 1) {
    const candidate = urlOf('AAAAuser1', randomBytes(12).toString('hex'));
    const guess = createHmac('sha256', salt).update(`url:${candidate}`).digest('hex').slice(0, 2);
    if (guess === fp) matches += 1;
  }
  assert.ok(matches > 3, `${matches} candidates match: the fingerprint confirms none`);
});

test('a message without text (an image alone, text undefined): nothing sent', async (t) => {
  const ctx = await setup();
  t.after(() => ctx.app.stop());
  const ack = await ctx.gladys.fake.sendMessage(
    { webhook_url: USER_URL },
    { file: 'image/jpg;base64,AA' },
  );
  assert.match(ack.error, /empty/);
  assert.equal(ctx.chat.calls.length, 0);
});

test('the scene action with an invalid default URL gives the reason', async (t) => {
  const ctx = await setup({ config: { webhook_url: 'https://example.com/x' } });
  t.after(() => ctx.app.stop());
  const ack = await ctx.gladys.fake.sceneAction('post_message', { text: 'x' });
  assert.match(
    ack.error,
    /Default space: the webhook URL must start with https:\/\/chat\.googleapis\.com/,
  );
});

test('/data unreadable: refusals, pauses and the cap learnt meanwhile are kept in memory', async (t) => {
  const store = createMemoryStore();
  store.unreadable = true;
  let n = 0;
  const ctx = await setup({
    store,
    config: { webhook_url: DEFAULT_URL, max_per_hour: 3 },
    answer: () => [json({}, 401), json({}, 429), posted()][n++] ?? posted(),
  });
  t.after(() => ctx.app.stop());
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('a'));
  await ctx.gladys.fake.sendMessage({ webhook_url: urlOf('AAAAp') }, msg('b'));
  await ctx.gladys.fake.sendMessage({ webhook_url: urlOf('AAAAq') }, msg('c'));
  assert.equal(
    (await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('d'))).success,
    false,
  );
  assert.match(
    (await ctx.gladys.fake.sendMessage({ webhook_url: urlOf('AAAAp') }, msg('e'))).error,
    /slow down/,
  );
  assert.match(
    (await ctx.gladys.fake.sendMessage({ webhook_url: urlOf('AAAAr') }, msg('f'))).error,
    /cap of 3/,
  );
  assert.equal(ctx.chat.calls.length, 3);
  assert.equal(store.saves, 0);
});

// --- Review r2: marks of /data taken back at first use, status per space ---

const KNOWN_SALT = '0123456789abcdef0123456789abcdef';
const fpOf = async (kind, value) => {
  const { createHmac } = await import('node:crypto');
  return createHmac('sha256', KNOWN_SALT).update(`${kind}:${value}`).digest('hex').slice(0, 2);
};
/** A URL of `space` whose 8-bit fingerprint is `fp` (another token than `avoid`). */
async function colliding(space, fp, avoid) {
  for (let i = 0; ; i += 1) {
    const url = urlOf(space, `CollideTok${i}`);
    if (url !== avoid && (await fpOf('url', url)) === fp) return url;
  }
}

test('a mark of /data: held back at first use (maybe another URL), lifted by Forget, gone from /data', async (t) => {
  const refusedA = urlOf('AAAAuser1', 'RevokedToken-A');
  const fp = await fpOf('url', refusedA);
  const B = await colliding('AAAAuser1', fp, refusedA);
  const store = createMemoryStore({
    salt: KNOWN_SALT,
    refused: { [fp]: { status: 401, at: 1 } },
    pauses: {},
    sends: [],
  });
  const ctx = await setup({ store, answer: () => posted('AAAAuser1') });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  const held = await ctx.gladys.fake.sendMessage({ webhook_url: B }, msg('a'));
  assert.equal(held.success, false);
  assert.match(
    held.error,
    /same fingerprint as this one was refused .* before the restart \(HTTP 401\); it may be another URL/,
  );
  assert.equal(ctx.chat.calls.length, 0);
  const ack = await ctx.gladys.fake.action('forget_refused');
  assert.match(JSON.stringify(ack.data), /forgotten/);
  await settle();
  assert.deepEqual(ctx.store.data.refused, {}, 'the mark is gone from /data');
  assert.equal((await ctx.gladys.fake.sendMessage({ webhook_url: B }, msg('b'))).success, true);
});

test('Forget clears a mark of /data not yet taken by any URL', async (t) => {
  const store = createMemoryStore({
    salt: KNOWN_SALT,
    refused: { ab: { status: 403, at: 1 } },
    pauses: {},
    sends: [],
  });
  const ctx = await setup({ store });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  await ctx.gladys.fake.action('forget_refused');
  await settle();
  assert.deepEqual(ctx.store.data.refused, {});
  assert.equal(ctx.app.keptRefused.size, 0);
});

test('the default URL: a mark taken at first use after a restart (Test lifts it), never by a URL saved during the run', async (t) => {
  const fp = await fpOf('url', DEFAULT_URL);
  const store = createMemoryStore({
    salt: KNOWN_SALT,
    refused: { [fp]: { status: 404, at: 1 } },
    pauses: {},
    sends: [],
  });
  const ctx = await setup({ store, config: { max_per_hour: 60 } });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  // Saved during the run: never inherits the mark.
  await ctx.gladys.fake.configUpdated({ webhook_url: DEFAULT_URL });
  assert.equal(lastStatus(ctx.gladys).connected, true);
  assert.equal((await ctx.gladys.fake.sceneAction('post_message', { text: 'x' })).success, true);

  // Read at the start (a restart): the first use takes the mark.
  const store2 = createMemoryStore({
    salt: KNOWN_SALT,
    refused: { [fp]: { status: 404, at: 1 } },
    pauses: {},
    sends: [],
  });
  const next = await setup({ store: store2 });
  t.after(() => next.app.stop());
  await until(() => next.app.loaded);
  await until(() => lastStatus(next.gladys).connected === false);
  assert.match(
    lastStatus(next.gladys).message.en,
    /same fingerprint was refused by Google Chat before the restart \(HTTP 404\)/,
  );
  const out = await next.gladys.fake.sceneAction('post_message', { text: 'x' });
  assert.match(out.error, /it may be another URL/);
  const ok = await next.gladys.fake.action('test_webhook');
  assert.match(JSON.stringify(ok.data), /Message posted/);
  assert.equal(lastStatus(next.gladys).connected, true);
});

test('a lone "<" never cuts a long text short', () => {
  return import('../src/format.js').then(({ toChatText }) => {
    const out = toChatText(`${'x'.repeat(100)} a < b ${'y'.repeat(5000)}`);
    assert.equal(Array.from(out).length, 4096);
  });
});

test('the status of the default space follows a pause set through another webhook of its space', async (t) => {
  const other = urlOf('AAAAdefault', 'AnotherWebhookToken');
  const ctx = await setup({ answer: () => json({}, 429, { 'retry-after': '120' }) });
  t.after(() => ctx.app.stop());
  assert.equal(lastStatus(ctx.gladys).connected, true);
  await ctx.gladys.fake.sendMessage({ webhook_url: other }, msg('x'));
  await until(() => lastStatus(ctx.gladys).connected === false);
  assert.match(lastStatus(ctx.gladys).message.en, /slow down/);
});

test('two spaces on one 8-bit pause fingerprint: /data keeps the longer pause', async (t) => {
  const fpA = await fpOf('space', 'AAAAuser1');
  let other;
  for (let i = 0; ; i += 1) {
    if ((await fpOf('space', `AAAAp${i}`)) === fpA) {
      other = `AAAAp${i}`;
      break;
    }
  }
  const store = createMemoryStore({ salt: KNOWN_SALT, refused: {}, pauses: {}, sends: [] });
  let n = 0;
  const ctx = await setup({
    store,
    answer: () => json({}, 429, { 'retry-after': (n += 1) === 1 ? '3600' : '120' }),
  });
  t.after(() => ctx.app.stop());
  await until(() => ctx.app.loaded);
  await ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, msg('a'));
  await ctx.gladys.fake.sendMessage({ webhook_url: urlOf(other) }, msg('b'));
  await settle();
  const kept = ctx.store.data.pauses[fpA];
  assert.ok(
    Math.abs(kept.until - Date.UTC(2026, 10, 14, 11, 0, 0)) < 1000,
    'the hour, not the 2 min',
  );
});
