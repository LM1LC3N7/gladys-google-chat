// -----------------------------------------------------------------------------
// One POST to the webhook, against a real local HTTP server: the outcome
// kinds, the bounded answer, Retry-After, a redirect never followed.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { postMessage, readBounded, retryAfterMs } from '../src/chat.js';

/** A local server; `handle(req, res, body)`. Requests kept. */
async function server(handle) {
  const requests = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handle(req, res, body);
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return {
    requests,
    url: `${base}/v1/spaces/AAAA/messages?key=k&token=t`,
    close: () => {
      srv.closeAllConnections();
      return new Promise((r) => srv.close(r));
    },
  };
}

test('200: posted, the name read; the request as Google wants it', async (t) => {
  const srv = await server((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: 'spaces/AAAA/messages/x.y', thread: { name: 'z' } }));
  });
  t.after(() => srv.close());
  const out = await postMessage({ fetch, url: srv.url, text: 'hé', threadKey: 'k1' });
  assert.deepEqual(out, { kind: 'posted', status: 200, name: 'spaces/AAAA/messages/x.y' });
  const [req] = srv.requests;
  assert.equal(req.method, 'POST');
  assert.equal(
    req.url,
    '/v1/spaces/AAAA/messages?key=k&token=t&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD',
  );
  assert.equal(req.headers['content-type'], 'application/json; charset=UTF-8');
  assert.deepEqual(JSON.parse(req.body), { text: 'hé', thread: { threadKey: 'k1' } });
});

test('200 with a huge or odd body: posted all the same, never read whole', async (t) => {
  const srv = await server((req, res) => {
    res.writeHead(200);
    res.write('x'.repeat(100 * 1024));
    // Never ends: the reader must stop at the bound, not wait.
  });
  t.after(() => srv.close());
  const out = await postMessage({ fetch, url: srv.url, text: 'a', timeout: 5000 });
  assert.equal(out.kind, 'posted');
  assert.equal(out.name, undefined);
});

test('the status kinds', async (t) => {
  let status = 429;
  let headers = {};
  const srv = await server((req, res) => {
    res.writeHead(status, headers);
    res.end('{}');
  });
  t.after(() => srv.close());
  const kinds = {};
  for (const s of [301, 400, 401, 403, 404, 413, 429, 500, 503]) {
    status = s;
    headers = s === 301 ? { location: 'http://127.0.0.1:1/elsewhere' } : {};
    kinds[s] = (await postMessage({ fetch, url: srv.url, text: 'a' })).kind;
  }
  assert.deepEqual(kinds, {
    301: 'rejected',
    400: 'rejected',
    401: 'refused',
    403: 'refused',
    404: 'refused',
    413: 'rejected',
    429: 'rateLimited',
    500: 'serverError',
    503: 'serverError',
  });
  // The redirect was not followed.
  assert.ok(srv.requests.every((r) => r.url.startsWith('/v1/spaces/')));
});

test('no answer: unconfirmed (timeout); a refused port: notSent', async (t) => {
  const srv = await server(() => {});
  t.after(() => srv.close());
  const slow = await postMessage({ fetch, url: srv.url, text: 'a', timeout: 200 });
  assert.deepEqual(slow, { kind: 'unconfirmed', reason: 'timeout' });
  const closed = await server(() => {});
  const url = closed.url;
  await closed.close();
  const refused = await postMessage({ fetch, url, text: 'a', timeout: 2000 });
  assert.deepEqual(refused, { kind: 'notSent', reason: 'ECONNREFUSED' });
});

test('stopping cuts a request waiting for its answer', async (t) => {
  const srv = await server(() => {});
  t.after(() => srv.close());
  const stopper = new AbortController();
  const out = postMessage({
    fetch,
    url: srv.url,
    text: 'a',
    timeout: 30_000,
    stopSignal: stopper.signal,
  });
  setTimeout(() => stopper.abort(), 50);
  assert.equal((await out).kind, 'unconfirmed');
  const already = await postMessage({ fetch, url: srv.url, text: 'a', stopSignal: stopper.signal });
  assert.equal(already.kind, 'notSent');
});

test('Retry-After: seconds, or a date against the Date of the answer (never our clock)', () => {
  const h = (o) => new Headers(o);
  assert.equal(retryAfterMs(h({ 'retry-after': '120' })), 120_000);
  assert.equal(
    retryAfterMs(
      h({ 'retry-after': 'Sat, 14 Nov 2026 10:05:00 GMT', date: 'Sat, 14 Nov 2026 10:00:00 GMT' }),
    ),
    300_000,
  );
  assert.equal(retryAfterMs(h({ 'retry-after': 'Sat, 14 Nov 2026 10:05:00 GMT' })), undefined);
  assert.equal(retryAfterMs(h({ 'retry-after': 'soon' })), undefined);
  assert.equal(retryAfterMs(h({ 'retry-after': '-1' })), undefined);
  assert.equal(retryAfterMs(h({})), undefined);
});

test('readBounded: 64 KB by default', async () => {
  assert.equal((await readBounded(new Response('x'.repeat(64 * 1024)))).length, 64 * 1024);
  assert.equal(await readBounded(new Response('x'.repeat(64 * 1024 + 1))), null);
});

test('a message name not in the Google form is not passed on', async (t) => {
  let body = { name: 'spaces/AAAA/messages/../../x' };
  const srv = await server((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  t.after(() => srv.close());
  assert.equal((await postMessage({ fetch, url: srv.url, text: 'a' })).name, undefined);
  body = { name: `spaces/AAAA/messages/${'a'.repeat(200)}` };
  assert.equal((await postMessage({ fetch, url: srv.url, text: 'a' })).name, undefined);
  body = { name: 'spaces/AAAA/messages/ok.1' };
  assert.equal(
    (await postMessage({ fetch, url: srv.url, text: 'a' })).name,
    'spaces/AAAA/messages/ok.1',
  );
});

test('readBounded: at most the bound', async () => {
  assert.equal(await readBounded(new Response('abc'), 3), 'abc');
  assert.equal(await readBounded(new Response('abcd'), 3), null);
  assert.equal(await readBounded(new Response(null)), '');
});
