// -----------------------------------------------------------------------------
// On the real clock (sped up 10 times): the messages of one space leave one
// slot apart (1.1 s, never earlier), and a Gladys message without an answer is
// acked within its 3.5 s budget. Wide margins: late under load, never early.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realClock } from './helpers/clock.js';
import { USER_URL, setup } from './helpers/app.js';

const SPEED = 10;

test('real clock: one space, three messages, 1.1 s apart (0.9..1.5 x)', async (t) => {
  const clock = realClock({ speed: SPEED });
  const ctx = await setup({ clock });
  t.after(async () => {
    await ctx.app.stop();
    clock.close();
  });
  const acks = ['a', 'b', 'c'].map((text) =>
    ctx.gladys.fake.sendMessage({ webhook_url: USER_URL }, { text, file: null }),
  );
  const results = await Promise.all(acks);
  assert.deepEqual(
    results.map((r) => r.success),
    [true, true, true],
  );
  const at = ctx.chat.calls.map((c) => c.at);
  assert.equal(at.length, 3);
  for (let i = 1; i < at.length; i += 1) {
    const gap = at[i] - at[i - 1];
    assert.ok(gap >= 0.9 * 1100 && gap <= 1.5 * 1100 + 2000, `gap ${Math.round(gap)} ms`);
    // Google's limit is one a second: the 1.1 s slot leaves room for the jitter of a request.
    assert.ok(gap >= 1000, `never under a second: ${Math.round(gap)} ms`);
  }
});

test('real clock: no answer, the ack comes at 3.5 s (not before, well before 5 s)', async (t) => {
  const clock = realClock({ speed: SPEED });
  const ctx = await setup({ clock, answer: () => 'hang' });
  t.after(async () => {
    await ctx.app.stop();
    clock.close();
  });
  const started = clock.monotonic();
  const ack = await ctx.gladys.fake.sendMessage(
    { webhook_url: USER_URL },
    { text: 'x', file: null },
  );
  const took = clock.monotonic() - started;
  assert.equal(ack.success, true);
  assert.ok(took >= 3500 - 1 && took < 4900, `acked after ${Math.round(took)} ms`);
  assert.equal(ctx.chat.calls.length, 1);
});
