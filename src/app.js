// -----------------------------------------------------------------------------
// The integration: Gladys messages, the scene action and the Test button all
// go through `deliver()`, which decides, in this order, with ONE reading of
// the monotonic clock:
//
//   URL checked -> text not empty -> URL not refused before -> Google space
//   not paused -> same text to that space within 15 s: the first message's
//   outcome -> hourly cap -> a slot in the space (one message every 1.1 s, a
//   short wait at most)
//
// then posts ONCE. A "space" is the Google space (`spaces/<id>`), shared by
// all its webhooks: Google's one-a-second limit and its 429 are per space. A
// refusal (401/403/404) is per webhook URL (its token). Nothing is ever sent
// again on its own: a 429 or a 5xx pauses the space, a refused URL is not used
// until it changes, the Test button succeeds or the Forget button is clicked.
// /data keeps 8-bit salted fingerprints only. Nothing is sent without a Gladys
// message, a scene or a click: no polling, no receiving.
//
// Clocks: `monotonic` decides (pauses, cap, slots, dedupe); `now` (wall) only
// dates what /data keeps, brought back onto the monotonic clock at load.
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { postMessage } from './chat.js';
import { normalizeConfig, parseWebhookUrl, threadKeyOf } from './config.js';
import {
  CONFIG_RETRY_MAX,
  CONFIG_RETRY_MIN,
  DEDUPE_WINDOW,
  MINUTE,
  PAUSE_MAX,
  PAUSE_MIN,
  QUEUE_WAIT_MAX,
  RATE_WINDOW,
  SEND_BUDGET,
  SPACE_GAP,
  STORE_READ_TIMEOUT,
  STORE_RETRY,
} from './constants.js';
import { toChatText } from './format.js';
import { TEXTS, en, t } from './i18n.js';

const defaultTimers = { setTimeout, clearTimeout };

/** Outcomes after which the message may be in the space. */
const MAYBE_POSTED = new Set(['posted', 'serverError', 'unconfirmed']);
/** Outcomes after which nothing is in the space for sure. */
const NOTHING_POSTED = new Set(['blocked', 'refused', 'rejected', 'rateLimited', 'notSent']);

/** Fingerprints kept in /data: 8 bits (2 hex), salted. */
const FP_HEX = 2;
const FP = /^[0-9a-f]{2}$/;

/** A message refused before anything left. */
const notSent = (reason, values = {}) => ({ kind: 'blocked', reason, values });

const minutesOf = (ms) => Math.max(1, Math.ceil(ms / MINUTE));

/** "Default space: <why the URL is not valid>", in both languages. */
function invalidText(code) {
  const reason = t(code);
  return {
    en: TEXTS.defaultInvalid.en.replace('{reason}', reason.en),
    fr: TEXTS.defaultInvalid.fr.replace('{reason}', reason.fr),
  };
}

/** The text of an outcome, `{ en, fr }`. */
export function describe(outcome) {
  if (outcome.kind === 'blocked') return t(outcome.reason, outcome.values);
  if (outcome.kind === 'duplicate') return t('duplicate');
  if (outcome.kind === 'rateLimited')
    return t('rateLimited', { minutes: minutesOf(outcome.pauseMs) });
  return t(outcome.kind, { status: outcome.status });
}

/** A pause kept in /data: valid only with a wall date in the past and an end ahead. */
function keptPause(entry, now, mono) {
  if (!entry || typeof entry !== 'object') return undefined;
  const { until, backoff } = entry;
  if (!Number.isFinite(until) || !Number.isFinite(backoff)) return undefined;
  const left = Math.min(until - now, PAUSE_MAX);
  if (left <= 0) return undefined;
  return {
    due: mono + left,
    until: now + left,
    backoff: Math.min(Math.max(backoff, PAUSE_MIN), PAUSE_MAX),
  };
}

export class GoogleChatApp {
  constructor({
    gladys,
    store,
    fetch = (...args) => globalThis.fetch(...args),
    logger = createLogger({ name: 'google-chat' }),
    timers = defaultTimers,
    now = Date.now,
    monotonic = () => performance.now(),
    random = randomBytes,
  }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.logger = logger;
    this.timers = timers;
    this.now = now;
    this.monotonic = monotonic;
    this.random = random;
    // Log labels of the spaces: a short salted fingerprint, never the URL.
    this.runSalt = random(16);

    this.config = normalizeConfig();
    this.configRead = false;
    this.generation = 0;
    this.stopped = false;
    this.configTimer = undefined;
    this.statusTimer = undefined;
    this.configDelay = CONFIG_RETRY_MIN;
    this.lastStatus = undefined;
    this.lastDefaultOutcome = undefined;

    // What /data holds, once read (`loaded`); never written before.
    this.loaded = false;
    this.reading = false;
    this.storeTimer = undefined;
    this.salt = undefined;
    /** fingerprint -> { status, at } of the URLs refused, read from /data. */
    this.keptRefused = new Map();
    /** fingerprint -> { due, until, backoff }, read from /data. */
    this.keptPauses = new Map();

    // The same, learnt since the start (memory only, kept even when /data is unreadable).
    /** url -> { status, at } (a refusal is per webhook URL: its token) */
    this.refused = new Map();
    /**
     * URLs that never take a mark of /data: used once already in this run
     * (they took theirs then), or configured during this run.
     */
    this.seen = new Set();
    /** Google space id -> { due, until, backoff } */
    this.pauses = new Map();
    /** Google space id -> backoff of the last pause, reset by a posted message */
    this.backoffs = new Map();
    /** Monotonic times of the messages of the last hour, all spaces. */
    this.sends = [];
    /** Google space id -> { next (monotonic slot), recent: Map<textHash, { at, job }>, sleepers } */
    this.spaces = new Map();
    /** The deliveries in flight (tests and shutdown wait for them). */
    this.inflight = new Set();
    /** Aborted by stop(): cuts a request still waiting for its answer. */
    this.stopper = new AbortController();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Every connection to Gladys: the config read (retried for ever), then start. */
  async connected() {
    if (this.stopped) this.stopper = new AbortController();
    this.stopped = false;
    this.generation += 1;
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    this.configDelay = CONFIG_RETRY_MIN;
    this.lastStatus = undefined;
    this.loadStore();
    await this.readConfig(this.generation);
  }

  async readConfig(generation) {
    let raw;
    try {
      raw = await this.gladys.getConfig();
    } catch (err) {
      if (generation !== this.generation || this.stopped) return;
      this.logger.warn(
        `Configuration unreadable (${err?.status ?? err?.name ?? 'error'}): read again later`,
      );
      if (!this.configRead) await this.setStatus(false, t('configUnreadable'), generation);
      const delay = this.configDelay;
      this.configDelay = Math.min(this.configDelay * 2, CONFIG_RETRY_MAX);
      this.configTimer = this.timers.setTimeout(() => {
        this.configTimer = undefined;
        if (generation === this.generation && !this.stopped) {
          this.readConfig(generation).catch((e) =>
            this.logger.error(`Config retry failed (${e?.name})`),
          );
        }
      }, delay);
      return;
    }
    if (generation !== this.generation || this.stopped) return;
    this.configDelay = CONFIG_RETRY_MIN;
    await this.applyConfig(raw, generation);
  }

  /** onConfigUpdated: the complete new values. */
  async configUpdated(raw) {
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = undefined;
    // A default URL saved during this run is new: it never inherits a mark of /data.
    const url = normalizeConfig(raw).webhook?.url;
    if (url && url !== this.config.webhook?.url && !this.refused.has(url)) this.seen.add(url);
    await this.applyConfig(raw, this.generation);
  }

  async applyConfig(raw, generation) {
    const previous = this.config.webhook?.url;
    this.config = normalizeConfig(raw);
    this.configRead = true;
    if (this.config.webhook?.url !== previous) this.lastDefaultOutcome = undefined;
    this.logger.info(
      `Configuration: default space ${this.config.webhook ? (this.config.webhook.url ? this.label(this.config.webhook.space) : 'invalid') : 'none'}, ${this.config.maxPerHour} messages per hour at most`,
    );
    await this.refreshStatus(generation);
  }

  async stop() {
    this.stopped = true;
    this.generation += 1;
    this.timers.clearTimeout(this.configTimer);
    this.timers.clearTimeout(this.storeTimer);
    this.timers.clearTimeout(this.statusTimer);
    this.statusTimer = undefined;
    this.configTimer = undefined;
    this.storeTimer = undefined;
    for (const space of this.spaces.values()) {
      for (const wake of space.sleepers) wake();
    }
    this.stopper.abort();
    await Promise.allSettled([...this.inflight]);
    await this.store?.flush?.();
  }

  /** Resolves once every delivery started so far is over. */
  async idle() {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  // --- /data -------------------------------------------------------------------

  /** Reads /data once; unreadable or slow: read again on its own timer, one read at a time. */
  loadStore() {
    if (this.loaded || this.reading || this.stopped || !this.store) return;
    this.reading = true;
    let settled = false;
    const read = this.store.load();
    const giveUp = this.timers.setTimeout(() => {
      if (settled) return;
      this.logger.warn('/data is slow to read: messages go on, /data read again later');
      this.scheduleStoreRead();
    }, STORE_READ_TIMEOUT);
    read.then(
      (data) => {
        settled = true;
        this.reading = false;
        this.timers.clearTimeout(giveUp);
        if (this.stopped) return;
        this.applyStore(data);
      },
      (err) => {
        settled = true;
        this.reading = false;
        this.timers.clearTimeout(giveUp);
        if (this.stopped) return;
        this.logger.warn(
          `${err?.message ?? '/data unreadable'}: nothing written to it, read again in 10 s`,
        );
        this.scheduleStoreRead();
      },
    );
  }

  scheduleStoreRead() {
    if (this.storeTimer || this.stopped) return;
    this.storeTimer = this.timers.setTimeout(() => {
      this.storeTimer = undefined;
      // A read still pending (a hung volume): never a second one beside it.
      if (this.reading) this.scheduleStoreRead();
      else this.loadStore();
    }, STORE_RETRY);
  }

  applyStore(data) {
    const now = this.now();
    const mono = this.monotonic();
    const salt =
      typeof data.salt === 'string' && /^[0-9a-f]{32}$/.test(data.salt) ? data.salt : undefined;
    this.salt = salt ?? this.random(16).toString('hex');
    if (salt) {
      for (const [fp, entry] of Object.entries(data.refused ?? {})) {
        if (FP.test(fp) && Number.isInteger(entry?.status)) {
          this.keptRefused.set(fp, { status: entry.status, at: entry.at });
        }
      }
      for (const [fp, entry] of Object.entries(data.pauses ?? {})) {
        const pause = FP.test(fp) ? keptPause(entry, now, mono) : undefined;
        if (pause) this.keptPauses.set(fp, pause);
      }
    }
    // The messages of the last hour: a date ahead of now is not valid.
    for (const at of Array.isArray(data.sends) ? data.sends : []) {
      if (Number.isFinite(at) && at <= now && now - at < RATE_WINDOW)
        this.sends.push(mono - (now - at));
    }
    this.sends.sort((a, b) => a - b);
    this.loaded = true;
    this.save();
    this.refreshStatus(this.generation).catch(() => {});
  }

  /**
   * A salted fingerprint of 8 bits (2 hex): about one URL in 256 shares it, so
   * /data and its salt never confirm a candidate URL. Collisions are tolerated:
   * they only matter after a restart, and the "Forget" button clears them.
   */
  fingerprint(kind, value) {
    return this.salt
      ? createHmac('sha256', this.salt).update(`${kind}:${value}`).digest('hex').slice(0, FP_HEX)
      : undefined;
  }

  /** Writes /data in the background: never awaited on the path of a message. */
  save() {
    if (!this.loaded || !this.store) return;
    const now = this.now();
    const mono = this.monotonic();
    const refused = Object.fromEntries(this.keptRefused);
    for (const [url, entry] of this.refused) refused[this.fingerprint('url', url)] = entry;
    const pauses = {};
    const keep = (fp, p) => {
      if (p.due > mono && !(pauses[fp]?.until > p.until)) {
        pauses[fp] = { until: p.until, backoff: p.backoff };
      }
    };
    for (const [fp, p] of this.keptPauses) keep(fp, p);
    for (const [space, p] of this.pauses) keep(this.fingerprint('space', space), p);
    const sends = this.sends
      .filter((at) => at > mono - RATE_WINDOW)
      .map((at) => Math.round(now - (mono - at)));
    Promise.resolve()
      .then(() => this.store.save({ salt: this.salt, refused, pauses, sends }))
      .catch((err) => this.logger.warn(`/data not written (${err?.code ?? err?.name ?? 'error'})`));
  }

  // --- State of a URL and of a space -------------------------------------------------

  /** Log label of a Google space: a short fingerprint salted per run, never its id. */
  label(space) {
    return `space #${createHmac('sha256', this.runSalt).update(space).digest('hex').slice(0, 6)}`;
  }

  /**
   * A URL refused (401/403/404): the exact URL in memory. A mark of /data (an
   * 8-bit fingerprint, kept from before the restart) is taken back only at the
   * first use of a URL in this run, never by a URL configured during it; such
   * a mark may come from another URL sharing the fingerprint (`kept: true`).
   */
  refusalOf(url) {
    const own = this.refused.get(url);
    if (own || this.seen.has(url) || !this.salt) return own;
    this.seen.add(url);
    const kept = this.keptRefused.get(this.fingerprint('url', url));
    if (!kept) return undefined;
    const inherited = { status: kept.status, at: kept.at, kept: true };
    this.refused.set(url, inherited);
    return inherited;
  }

  /** Why a refused URL is not used: refused by Google, or a mark of /data. */
  static refusalReason(refusal) {
    return refusal.kept
      ? notSent('refusedKept', { status: refusal.status })
      : notSent('refusedEarlier', { status: refusal.status });
  }

  clearRefusal(url) {
    const had = this.refused.delete(url);
    const fp = this.fingerprint('url', url);
    if ((fp && this.keptRefused.delete(fp)) || had) this.save();
  }

  /** The pause of a Google space still running at `mono`, or undefined. */
  pauseOf(space, mono) {
    const own = this.pauses.get(space);
    const kept = this.salt ? this.keptPauses.get(this.fingerprint('space', space)) : undefined;
    const due = Math.max(own?.due ?? -Infinity, kept?.due ?? -Infinity);
    return due > mono ? { due } : undefined;
  }

  pause(space, retryAfter, mono) {
    const previous = this.backoffs.get(space) ?? 0;
    const backoff = Math.min(PAUSE_MAX, previous ? previous * 2 : PAUSE_MIN);
    const ms = Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, retryAfter ?? backoff));
    this.backoffs.set(space, backoff);
    this.pauses.set(space, { due: mono + ms, until: this.now() + ms, backoff });
    return ms;
  }

  spaceOf(space) {
    let entry = this.spaces.get(space);
    if (!entry) {
      entry = { next: -Infinity, recent: new Map(), sleepers: new Set() };
      this.spaces.set(space, entry);
    }
    return entry;
  }

  // --- Sending ------------------------------------------------------------------

  /**
   * Posts `markdown` to the webhook `rawUrl` once, or tells why not.
   * Resolves an outcome (see chat.js, plus `blocked` and `duplicate`); never throws.
   * `force`: a click on Test may try again a URL refused before.
   */
  deliver(rawUrl, markdown, { threadKey, force = false } = {}) {
    const job = this.deliverNow(rawUrl, markdown, { threadKey, force });
    this.inflight.add(job);
    job.finally(() => this.inflight.delete(job)).catch(() => {});
    return job;
  }

  async deliverNow(rawUrl, markdown, { threadKey, force }) {
    if (this.stopped) return notSent('stopped');
    const parsed = parseWebhookUrl(rawUrl);
    if (parsed.error) return notSent(parsed.error);
    const { url, space: spaceId } = parsed;
    const text = toChatText(markdown);
    if (!text) return notSent('emptyText');
    const label = this.label(spaceId);

    const mono = this.monotonic();
    const refusal = this.refusalOf(url);
    if (refusal && !force) return GoogleChatApp.refusalReason(refusal);
    const paused = this.pauseOf(spaceId, mono);
    if (paused) return notSent('paused', { minutes: minutesOf(paused.due - mono) });
    const space = this.spaceOf(spaceId);
    const hash = createHash('sha256')
      .update(text)
      .update('\u0000')
      .update(threadKey ?? '')
      .digest('hex');
    for (const [key, entry] of space.recent) {
      if (entry.at <= mono - DEDUPE_WINDOW) space.recent.delete(key);
    }
    const earlier = space.recent.get(hash);
    if (earlier) {
      // The same text to the same space within 15 s (users sharing a space):
      // never sent twice, and never "posted" before the first one is.
      this.logger.info(
        `Same message to ${label} less than 15 s ago: the first one's outcome is used`,
      );
      const first = await earlier.job;
      return first.kind === 'posted'
        ? { kind: 'duplicate', name: first.name }
        : { ...first, duplicate: true };
    }
    while (this.sends.length && this.sends[0] <= mono - RATE_WINDOW) this.sends.shift();
    if (this.sends.length >= this.config.maxPerHour) {
      return notSent('capReached', { max: this.config.maxPerHour });
    }
    const slot = Math.max(mono, space.next);
    if (slot - mono > QUEUE_WAIT_MAX) return notSent('spaceBusy');

    // Reserved: the cap counts it, the slot is taken, the dedupe knows it.
    space.next = slot + SPACE_GAP;
    this.sends.push(slot);
    const job = this.transmit({ url, spaceId, space, slot, mono, text, threadKey, force, label });
    const entry = { at: slot, job };
    space.recent.set(hash, entry);
    const outcome = await job;
    // Nothing posted: the dedupe forgets it (a later identical message may go).
    if (!MAYBE_POSTED.has(outcome.kind) && space.recent.get(hash) === entry) {
      space.recent.delete(hash);
    }
    return outcome;
  }

  async transmit({ url, spaceId, space, slot, mono, text, threadKey, force, label }) {
    const release = () => {
      const i = this.sends.lastIndexOf(slot);
      if (i >= 0) this.sends.splice(i, 1);
    };
    if (slot > mono) {
      // A timer may fire a hair early: never before the slot.
      for (let left = slot - mono; left > 0 && !this.stopped; left = slot - this.monotonic()) {
        await this.sleep(space, left);
      }
      // Things may have changed while waiting: an earlier message refused or paused.
      const later = this.monotonic();
      const refusedNow = this.refusalOf(url);
      const pausedNow = this.pauseOf(spaceId, later);
      if (this.stopped || (refusedNow && !force) || pausedNow) {
        release();
        if (this.stopped) return notSent('stopped');
        if (pausedNow) return notSent('paused', { minutes: minutesOf(pausedNow.due - later) });
        return GoogleChatApp.refusalReason(refusedNow);
      }
    }

    this.save();
    const outcome = await postMessage({
      fetch: this.fetch,
      url,
      text,
      threadKey,
      timers: this.timers,
      stopSignal: this.stopper.signal,
    });
    const after = this.monotonic();
    switch (outcome.kind) {
      case 'posted':
        this.backoffs.delete(spaceId);
        if (force) this.clearRefusal(url);
        this.logger.info(`Message posted to ${label}`);
        break;
      case 'rateLimited':
      case 'serverError': {
        outcome.pauseMs = this.pause(spaceId, outcome.retryAfter, after);
        this.save();
        this.logger.warn(
          `${label}: HTTP ${outcome.status}, ${outcome.kind === 'serverError' ? 'maybe posted, not sent again' : 'nothing posted'}; paused ${minutesOf(outcome.pauseMs)} min`,
        );
        break;
      }
      case 'refused':
        this.refused.set(url, { status: outcome.status, at: this.now() });
        this.save();
        this.logger.warn(
          `${label}: webhook URL refused (HTTP ${outcome.status}); nothing sent to it until it changes`,
        );
        break;
      case 'rejected':
        this.logger.warn(`${label}: message rejected (HTTP ${outcome.status}), nothing posted`);
        break;
      case 'unconfirmed':
        this.logger.warn(`${label}: no answer (${outcome.reason}); maybe posted, not sent again`);
        break;
      default:
        this.logger.warn(`${label}: Google Chat unreachable (${outcome.reason}), nothing sent`);
    }
    if (url === this.config.webhook?.url || spaceId === this.config.webhook?.space) {
      if (url === this.config.webhook?.url) this.lastDefaultOutcome = outcome.kind;
      this.refreshStatus(this.generation).catch(() => {});
    }
    return outcome;
  }

  /** Waits `ms` on the injected timers; woken (early) by stop(). */
  sleep(space, ms) {
    return new Promise((resolve) => {
      const done = () => {
        this.timers.clearTimeout(timer);
        space.sleepers.delete(done);
        resolve();
      };
      const timer = this.timers.setTimeout(done, ms);
      space.sleepers.add(done);
    });
  }

  // --- The ways in -----------------------------------------------------------------

  /**
   * onSendMessage: Gladys sends a message to a user; `contact` is their
   * "My account" values. Answered within 3.5 s (Gladys waits 5 s): a message
   * still without an answer then goes on, its outcome logged. Throws only
   * when nothing was posted for sure (Gladys logs it); never sent again.
   */
  async sendMessage(contact, message) {
    if (message?.file) {
      this.logger.info(
        'An image came with the message: webhooks post text only, the image is not sent',
      );
    }
    const job = this.deliver(contact?.webhook_url, message?.text ?? '', {});
    let timer;
    const budget = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(undefined), SEND_BUDGET);
    });
    const outcome = await Promise.race([job, budget]);
    this.timers.clearTimeout(timer);
    if (!outcome) {
      this.logger.info(
        'Message sent, Google Chat has not answered yet: its outcome will be logged',
      );
      return;
    }
    if (NOTHING_POSTED.has(outcome.kind)) throw new Error(describe(outcome).en);
  }

  /** Scene action: posts to the default space, waits for the answer of Google. */
  async postMessage(fields = {}) {
    const webhook = this.config.webhook;
    if (!webhook) throw new Error(en('noDefault'));
    if (webhook.error) throw new Error(invalidText(webhook.error).en);
    const threadKey = threadKeyOf(fields.thread_key);
    if (threadKey === null) {
      throw new Error('Thread key: letters, digits and . _ : - only, 64 at most; nothing sent.');
    }
    const outcome = await this.deliver(webhook.url, fields.text ?? '', { threadKey });
    if (outcome.kind === 'posted') {
      return { posted: true, deduplicated: false, message_name: outcome.name ?? '' };
    }
    if (outcome.kind === 'duplicate') {
      // The message is in the space (posted by the first one): a fallback scene
      // branching on `posted` must not fire.
      return { posted: true, deduplicated: true, message_name: outcome.name ?? '' };
    }
    throw new Error(describe(outcome).en);
  }

  /** The Test button: one test message to the default space (a click may retry a refused URL). */
  async test() {
    if (!this.configRead) return t('configUnreadable');
    if (!this.config.webhook) return t('noDefault');
    if (this.config.webhook.error) return invalidText(this.config.webhook.error);
    const stamp = new Date(this.now()).toISOString().slice(0, 16).replace('T', ' ');
    const text = `${en('testText')} / ${t('testText').fr} (${stamp} UTC)`;
    const outcome = await this.deliver(this.config.webhook.url, text, { force: true });
    return describe(outcome);
  }

  /** The "Forget" button: every refused URL is tried again by its next message. */
  forgetRefused() {
    const count = this.refused.size + this.keptRefused.size;
    this.refused.clear();
    this.keptRefused.clear();
    this.save();
    this.refreshStatus(this.generation).catch(() => {});
    this.logger.info(`Refused webhook URLs forgotten (${count})`);
    return t('forgotten', { count });
  }

  // --- Status -------------------------------------------------------------------------

  async setStatus(connected, message, generation = this.generation) {
    if (generation !== this.generation || this.stopped) return;
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) =>
        this.logger.warn(`setConnectionStatus failed (${err?.status ?? err?.name ?? 'error'})`),
      );
  }

  async refreshStatus(generation = this.generation) {
    if (!this.configRead) return;
    const webhook = this.config.webhook;
    if (!webhook) return this.setStatus(true, t('readyNoDefault'), generation);
    if (webhook.error) return this.setStatus(false, invalidText(webhook.error), generation);
    const refusal = this.refusalOf(webhook.url);
    if (refusal)
      return this.setStatus(
        false,
        t(refusal.kept ? 'defaultRefusedKept' : 'defaultRefused', { status: refusal.status }),
        generation,
      );
    const mono = this.monotonic();
    const paused = this.pauseOf(webhook.space, mono);
    if (paused) {
      // The status comes back by itself when the pause ends.
      this.timers.clearTimeout(this.statusTimer);
      this.statusTimer = this.timers.setTimeout(
        () => {
          this.statusTimer = undefined;
          this.refreshStatus(generation).catch(() => {});
        },
        paused.due - mono + 1,
      );
      return this.setStatus(
        false,
        t('defaultPaused', { minutes: minutesOf(paused.due - mono) }),
        generation,
      );
    }
    return this.setStatus(
      true,
      t(this.lastDefaultOutcome === 'posted' ? 'lastPosted' : 'ready'),
      generation,
    );
  }
}
