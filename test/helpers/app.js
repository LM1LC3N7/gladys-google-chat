// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys (the wiring of index.js), a scripted
// Google Chat (fake fetch), a memory /data and a virtual clock.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { GoogleChatApp } from '../../src/app.js';
import { registerHandlers } from '../../src/handlers.js';
import { createMemoryStore } from '../../src/store.js';
import { settle, testClock } from './clock.js';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TOKEN = 'Zq9sEcReTtOkEn-1234567890abcdefXYZ%3D';
export const KEY = 'AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI';
export const urlOf = (space = 'AAAAdefault', token = TOKEN) =>
  `https://chat.googleapis.com/v1/spaces/${space}/messages?key=${KEY}&token=${token}`;
export const DEFAULT_URL = urlOf();
export const USER_URL = urlOf('AAAAuser1', 'UsErToKeN-secret-abcdef%3D');

/** A memory logger: every line, to look for secrets. */
export function memoryLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push(
        `${level} ${args.map((a) => (a instanceof Error ? `${a.message}` : String(a))).join(' ')}`,
      );
  return { lines, debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const posted = (space = 'AAAAdefault') => json({ name: `spaces/${space}/messages/m1.m1` });

/** An error as fetch raises it, `code` in its cause. */
export function netError(code) {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error(code), { code });
  return err;
}

/**
 * Google Chat: `answer(call)` -> a Response, an Error (thrown), 'hang' (never
 * answers until the request is aborted) or a promise of those. Every call is
 * kept: `{ url, body, headers, at }`.
 */
export function createChat(clock, answer = () => posted()) {
  const chat = { calls: [], answer };
  chat.fetch = async (url, init) => {
    const call = {
      url,
      body: JSON.parse(init.body),
      headers: init.headers,
      redirect: init.redirect,
      at: clock.monotonic(),
    };
    chat.calls.push(call);
    const result = await chat.answer(call, chat.calls.length);
    if (result === 'hang') {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      });
    }
    if (result instanceof Error) throw result;
    return result;
  };
  return chat;
}

export async function setup({
  config = { webhook_url: DEFAULT_URL, max_per_hour: 60 },
  store = createMemoryStore(),
  clock = testClock({ start: Date.UTC(2026, 10, 14, 10, 0, 0) }),
  answer,
  connect = true,
  random,
} = {}) {
  const gladys = createFakeGladys({ selector: 'google-chat', config });
  const logger = memoryLogger();
  const chat = createChat(clock, answer);
  const app = new GoogleChatApp({
    gladys,
    store,
    fetch: chat.fetch,
    logger,
    timers: clock.timers,
    now: clock.now,
    monotonic: clock.monotonic,
    ...(random ? { random } : {}),
  });
  registerHandlers(gladys, app, logger);
  const ctx = { gladys, app, chat, clock, store, logger };
  if (connect) {
    await gladys.connect();
    await settle();
  }
  return ctx;
}

/** Everything a secret must never reach: logs, statuses, /data. */
export function everythingSaid({ gladys, logger, store }) {
  return [
    ...logger.lines,
    JSON.stringify(gladys.fake.connectionStatuses),
    JSON.stringify(gladys.fake.wsMessages),
    JSON.stringify(store.data ?? {}),
  ].join('\n');
}

/** Waits (bounded, in turns of the event loop) for a condition. */
export async function until(check, rounds = 200) {
  for (let i = 0; i < rounds; i += 1) {
    if (check()) return;
    await settle(1);
  }
  throw new Error('condition never met');
}
