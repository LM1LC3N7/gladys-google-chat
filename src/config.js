// -----------------------------------------------------------------------------
// The configuration (manifest `config_schema`) and the webhook URLs, normalized
// and checked. A webhook URL is a secret (its `token` lets anyone post in the
// space): it is checked strictly here, so nothing but chat.googleapis.com is
// ever called, and it never appears in a log, a status, /data or an error.
// -----------------------------------------------------------------------------

import { RATE_DEFAULT, RATE_MAX, RATE_MIN } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  webhook_url: '',
  max_per_hour: RATE_DEFAULT,
};

const HOST = 'chat.googleapis.com';
const SPACE = /^\/v1\/spaces\/([A-Za-z0-9_-]{1,128})\/messages$/;
const PARAM = /^[A-Za-z0-9_.%=-]{1,512}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Checks a webhook URL. Resolves `{ url, space }` (the URL rebuilt from its
 * checked parts, and the id of the Google space, shared by its webhooks) or
 * `{ error }`, a code of i18n.js (`emptyUrl`, `badUrl`, `notGoogleChat`,
 * `badUrlParams`): never the URL itself.
 */
export function parseWebhookUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return { error: 'emptyUrl' };
  if (text.length > 2048 || CONTROL.test(text)) return { error: 'badUrl' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { error: 'badUrl' };
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    return { error: 'notGoogleChat' };
  }
  const space = SPACE.exec(url.pathname);
  if (!space) return { error: 'notGoogleChat' };
  const keys = [...url.searchParams.keys()];
  const key = url.searchParams.get('key');
  const token = url.searchParams.get('token');
  if (
    keys.length !== 2 ||
    !keys.includes('key') ||
    !keys.includes('token') ||
    !PARAM.test(key ?? '') ||
    !PARAM.test(token ?? '')
  ) {
    return { error: 'badUrlParams' };
  }
  // Rebuilt with the raw (still encoded) values: `token` often ends in `%3D`.
  const raw = Object.fromEntries(
    url.search
      .slice(1)
      .split('&')
      .map((pair) => {
        const at = pair.indexOf('=');
        return [pair.slice(0, at), pair.slice(at + 1)];
      }),
  );
  if (!PARAM.test(raw.key ?? '') || !PARAM.test(raw.token ?? '')) return { error: 'badUrlParams' };
  return {
    url: `https://${HOST}/v1/spaces/${space[1]}/messages?key=${raw.key}&token=${raw.token}`,
    space: space[1],
  };
}

/** A whole number within bounds, or the default (an empty field, a decimal, a text). */
function integerIn(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** `{ webhook: { url, space } | { error } | null, maxPerHour }`. */
export function normalizeConfig(raw = {}) {
  const text = typeof raw?.webhook_url === 'string' ? raw.webhook_url.trim() : '';
  return {
    webhook: text ? parseWebhookUrl(text) : null,
    maxPerHour: integerIn(raw?.max_per_hour, RATE_MIN, RATE_MAX, RATE_DEFAULT),
  };
}

/** A thread key: plain characters only, or none. */
export function threadKeyOf(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return undefined;
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(text) ? text : null;
}
