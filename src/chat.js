// -----------------------------------------------------------------------------
// One POST to a Google Chat incoming webhook, its outcome classified. Never
// retried here: a message that may have been posted is never sent twice.
//
//   posted       200, the message is in the space (its `name` when readable)
//   rateLimited  429: nothing posted, Google asks to slow down
//   refused      401, 403, 404: the URL is refused (token revoked, webhook
//                deleted, webhooks turned off by the Workspace admin)
//   rejected     another 4xx, a redirect: nothing posted
//   serverError  5xx: maybe posted, maybe not (never sent again)
//   unconfirmed  no answer (timeout, connection cut): maybe posted
//   notSent      the connection never opened (DNS, refused, certificate)
//
// The URL is never logged, never put in an error: callers get a kind only.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_RESPONSE_BYTES, USER_AGENT } from './constants.js';

/** Errors raised before a byte of the request could leave. */
const BEFORE_SENDING = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

const NAME = /^spaces\/[A-Za-z0-9_-]{1,128}\/messages\/[A-Za-z0-9_.-]{1,128}$/;

/** The body, at most `max` bytes (a larger one is cut, never read whole). */
export async function readBounded(response, max = MAX_RESPONSE_BYTES) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Retry-After in ms: seconds, or an HTTP date compared to the `Date` header of
 * the same answer (never to our clock). Undefined when not readable.
 */
export function retryAfterMs(headers) {
  const value = headers?.get?.('retry-after')?.trim();
  if (!value) return undefined;
  if (/^\d{1,7}$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  const now = Date.parse(headers.get('date') ?? '');
  if (!Number.isFinite(at) || !Number.isFinite(now)) return undefined;
  return Math.max(0, at - now);
}

/**
 * POST `{ text, thread? }` to the webhook. Resolves an outcome, never throws.
 */
export async function postMessage({
  fetch,
  url,
  text,
  threadKey,
  timeout = HTTP_TIMEOUT,
  timers = { setTimeout, clearTimeout },
  stopSignal,
}) {
  // One deadline for the whole exchange (answer and body), on the given timers;
  // the integration stopping cuts it too.
  const controller = new AbortController();
  const timer = timers.setTimeout(
    () => controller.abort(new DOMException('no answer in time', 'TimeoutError')),
    timeout,
  );
  const onStop = () => controller.abort(new DOMException('stopping', 'AbortError'));
  stopSignal?.addEventListener('abort', onStop);
  try {
    if (stopSignal?.aborted) return { kind: 'notSent', reason: 'stopping' };
    return await exchange({ fetch, url, text, threadKey, signal: controller.signal });
  } finally {
    timers.clearTimeout(timer);
    stopSignal?.removeEventListener('abort', onStop);
  }
}

async function exchange({ fetch, url, text, threadKey, signal }) {
  const body = { text };
  let target = url;
  if (threadKey) {
    body.thread = { threadKey };
    target = `${url}&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`;
  }
  let response;
  try {
    response = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body),
      // A redirect is not followed: the token never goes anywhere else.
      redirect: 'manual',
      signal,
    });
  } catch (err) {
    const code = err?.cause?.code ?? err?.code;
    if (BEFORE_SENDING.has(code)) return { kind: 'notSent', reason: code };
    const timedOut = signal.aborted || err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { kind: 'unconfirmed', reason: timedOut ? 'timeout' : (code ?? 'network') };
  }
  const status = response.status;
  if (status >= 200 && status < 300) {
    const raw = await readBounded(response);
    let name;
    try {
      name = JSON.parse(raw ?? '')?.name;
    } catch {
      // posted all the same: the status is the proof
    }
    return {
      kind: 'posted',
      status,
      name: typeof name === 'string' && NAME.test(name) ? name : undefined,
    };
  }
  // Nothing else of the answer is needed: never read whole.
  response.body?.cancel?.().catch(() => {});
  if (status === 429)
    return { kind: 'rateLimited', status, retryAfter: retryAfterMs(response.headers) };
  if (status === 401 || status === 403 || status === 404) return { kind: 'refused', status };
  if (status >= 500)
    return { kind: 'serverError', status, retryAfter: retryAfterMs(response.headers) };
  return { kind: 'rejected', status };
}
