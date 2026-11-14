// -----------------------------------------------------------------------------
// The webhook URL check (only chat.googleapis.com, its two parameters, no
// control character) and the configuration numbers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseWebhookUrl, threadKeyOf } from '../src/config.js';
import { RATE_DEFAULT } from '../src/constants.js';
import { DEFAULT_URL, KEY, TOKEN } from './helpers/app.js';

test('a Google Chat webhook URL is accepted, rebuilt from its parts', () => {
  assert.deepEqual(parseWebhookUrl(DEFAULT_URL), { url: DEFAULT_URL });
  assert.deepEqual(parseWebhookUrl(`  ${DEFAULT_URL}\n`), { url: DEFAULT_URL });
  const swapped = `https://chat.googleapis.com/v1/spaces/AAAAdefault/messages?token=${TOKEN}&key=${KEY}`;
  assert.deepEqual(parseWebhookUrl(swapped), { url: DEFAULT_URL });
});

test('anything else is refused with a code, never the URL', () => {
  const cases = {
    emptyUrl: ['', '   ', undefined, null, 42],
    badUrl: ['not a url', `${DEFAULT_URL}\u0007`, `${DEFAULT_URL}\r\nX: 1`, 'x'.repeat(3000)],
    notGoogleChat: [
      DEFAULT_URL.replace('https:', 'http:'),
      DEFAULT_URL.replace('chat.googleapis.com', 'evil.example'),
      DEFAULT_URL.replace('chat.googleapis.com', 'chat.googleapis.com.evil.example'),
      DEFAULT_URL.replace('chat.googleapis.com', 'chat.googleapis.com:444'),
      DEFAULT_URL.replace('https://', 'https://u:p@'),
      DEFAULT_URL.replace('/v1/', '/v2/'),
      DEFAULT_URL.replace('AAAAdefault', '../x'),
      DEFAULT_URL.replace('AAAAdefault', 'a.b'),
      DEFAULT_URL.replace('/messages', '/members'),
      `${DEFAULT_URL}#x`,
    ],
    badUrlParams: [
      DEFAULT_URL.split('&')[0],
      `${DEFAULT_URL}&threadKey=a`,
      `${DEFAULT_URL}&messageReplyOption=REPLY_MESSAGE_OR_FAIL`,
      `${DEFAULT_URL}&key=again`,
      DEFAULT_URL.replace(TOKEN, ''),
      DEFAULT_URL.replace(TOKEN, 'a%0Db'),
      DEFAULT_URL.replace(TOKEN, 'a b'),
      DEFAULT_URL.replace(TOKEN, 'a"b'),
    ],
  };
  for (const [code, urls] of Object.entries(cases)) {
    for (const url of urls) {
      const out = parseWebhookUrl(url);
      assert.equal(out.error, code, String(url));
      assert.equal(out.url, undefined);
    }
  }
});

test('the configuration: defaults, bounds, empty and decimal values', () => {
  assert.deepEqual(DEFAULTS, { webhook_url: '', max_per_hour: RATE_DEFAULT });
  assert.deepEqual(normalizeConfig(), { webhook: null, maxPerHour: 60 });
  assert.equal(normalizeConfig({ max_per_hour: '' }).maxPerHour, 60, "'' is not 0");
  assert.equal(normalizeConfig({ max_per_hour: null }).maxPerHour, 60);
  assert.equal(normalizeConfig({ max_per_hour: 0 }).maxPerHour, 1);
  assert.equal(normalizeConfig({ max_per_hour: -5 }).maxPerHour, 1);
  assert.equal(normalizeConfig({ max_per_hour: 99999 }).maxPerHour, 600);
  assert.equal(normalizeConfig({ max_per_hour: 2.5 }).maxPerHour, 60);
  assert.equal(normalizeConfig({ max_per_hour: ' 12 ' }).maxPerHour, 12);
  assert.equal(normalizeConfig({ max_per_hour: 'ten' }).maxPerHour, 60);
  assert.deepEqual(normalizeConfig({ webhook_url: DEFAULT_URL }).webhook, { url: DEFAULT_URL });
  assert.deepEqual(normalizeConfig({ webhook_url: 'nope' }).webhook, { error: 'badUrl' });
  assert.equal(normalizeConfig({ webhook_url: '  ' }).webhook, null);
});

test('thread keys: plain and short, or refused (null); empty is none', () => {
  assert.equal(threadKeyOf(' alarm-1 '), 'alarm-1');
  assert.equal(threadKeyOf(''), undefined);
  assert.equal(threadKeyOf(undefined), undefined);
  assert.equal(threadKeyOf('a b'), null);
  assert.equal(threadKeyOf('a\r\nb'), null);
  assert.equal(threadKeyOf('x'.repeat(65)), null);
  assert.equal(threadKeyOf('x'.repeat(64)), 'x'.repeat(64));
});
