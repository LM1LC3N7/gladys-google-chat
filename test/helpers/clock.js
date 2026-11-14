// -----------------------------------------------------------------------------
// Clocks for the app (taken by injection), from gladys-testkit: a virtual one
// (testClock: nothing fires by itself, every read moves 1 µs) and the real one
// sped up (realClock).
// -----------------------------------------------------------------------------

/** Lets pending promises and I/O callbacks run (a few turns of the event loop). */
export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

const handle = (id) => ({
  id,
  ref() {
    return this;
  },
  unref() {
    return this;
  },
  hasRef: () => true,
});

/**
 * A virtual clock: nothing fires by itself. Every read of `now()` (wall,
 * epoch ms) or `monotonic()` moves the time on by `step` (1 µs): a decision
 * reading the clock twice sees it move, as on a real clock. `advance(ms)`
 * fires every timer due on the way, in order, WITHOUT awaiting the promise a
 * callback returns (as Node does), with a turn of the event loop between two.
 */
export function testClock({ start = Date.UTC(2026, 0, 1), step = 0.001 } = {}) {
  let t = 0;
  let seq = 0;
  const pending = new Map();
  const read = () => (t += step);
  const add = (fn, ms, args, every) => {
    const h = handle((seq += 1));
    const delay = Math.max(0, Number(ms) || 0);
    pending.set(h, { fn, args, at: t + delay, seq, every: every ? Math.max(1, delay) : 0 });
    return h;
  };
  const remove = (h) => pending.delete(h);
  const clock = {
    now: () => start + read(),
    monotonic: () => read(),
    /** Virtual ms since the start, without moving the clock. */
    get elapsed() {
      return t;
    },
    get pending() {
      return pending.size;
    },
    timers: {
      setTimeout: (fn, ms, ...args) => add(fn, ms, args, false),
      setInterval: (fn, ms, ...args) => add(fn, ms, args, true),
      clearTimeout: remove,
      clearInterval: remove,
    },
    async advance(ms) {
      // The app may still be on its way to setting a timer: let it first.
      await settle();
      const target = t + ms;
      for (let guard = 0; guard < 100_000; guard += 1) {
        let next;
        for (const [h, timer] of pending) {
          if (
            timer.at <= target &&
            (!next || timer.at < next[1].at || (timer.at === next[1].at && timer.seq < next[1].seq))
          ) {
            next = [h, timer];
          }
        }
        if (!next) break;
        const [h, timer] = next;
        t = Math.max(t, timer.at);
        if (timer.every) timer.at += timer.every;
        else pending.delete(h);
        timer.fn(...timer.args);
        await settle(1);
      }
      t = Math.max(t, target);
      await settle(1);
    },
  };
  return clock;
}

/**
 * The real clock sped up `speed` times: `now()` and `monotonic()` in
 * simulated ms, timers shortened by `speed`. `close()` clears the timers
 * still pending; `timersSet` counts the timers the app asked for.
 */
export function realClock({ speed = 1 } = {}) {
  const p0 = performance.now();
  const w0 = Date.now();
  const live = new Set();
  const wrap =
    (set, clear, repeat) =>
    (fn, ms, ...args) => {
      clock.timersSet += 1;
      const h = set(
        () => {
          if (!repeat) live.delete(h);
          fn(...args);
        },
        Math.max(0, Number(ms) || 0) / speed,
      );
      live.add(h);
      return h;
    };
  const clear = (h) => {
    live.delete(h);
    clearTimeout(h);
  };
  const clock = {
    speed,
    timersSet: 0,
    now: () => w0 + (performance.now() - p0) * speed,
    monotonic: () => performance.now() * speed,
    timers: {
      setTimeout: wrap(setTimeout, clearTimeout, false),
      setInterval: wrap(setInterval, clearInterval, true),
      clearTimeout: clear,
      clearInterval: clear,
    },
    /** Waits `ms` simulated ms (real ms divided by speed). */
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms / speed)),
    close() {
      for (const h of live) clearTimeout(h);
      live.clear();
    },
  };
  return clock;
}
