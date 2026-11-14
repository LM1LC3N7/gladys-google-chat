// -----------------------------------------------------------------------------
// Fixed values: keys shared with the manifest, limits and delays.
// -----------------------------------------------------------------------------

export const VERSION = '0.1.0';
export const USER_AGENT = `gladys-google-chat/${VERSION} (+https://github.com/LM1LC3N7/gladys-google-chat)`;

export const ACTIONS = { TEST: 'test_webhook', FORGET: 'forget_refused' };
export const SCENE_ACTIONS = { POST: 'post_message' };

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** Gladys waits 5 s for the ack of a message: answer well before. */
export const SEND_BUDGET = 3500;
/** A message whose turn in its space comes later than this is not queued. */
export const QUEUE_WAIT_MAX = 2300;
/** Google Chat: one message per second per space (shared by its webhooks). */
export const SPACE_GAP = 1100;
/** One request: connection, sending and answer. */
export const HTTP_TIMEOUT = 10 * SECOND;
/** The answer of Google is a small JSON (the message name): read at most this. */
export const MAX_RESPONSE_BYTES = 64 * 1024;
/** Gladys texts are 4,096 characters at most: never more is posted. */
export const MAX_TEXT = 4096;
/** Thread keys: Google accepts an arbitrary string, kept short and plain. */
export const MAX_THREAD_KEY = 64;

/** The cap of messages per hour (all spaces together), set in the config. */
export const RATE_DEFAULT = 60;
export const RATE_MIN = 1;
export const RATE_MAX = 600;
export const RATE_WINDOW = HOUR;

/** Same text to the same Google space within this delay: posted once (shared spaces). */
export const DEDUPE_WINDOW = 15 * SECOND;

/** Pauses after a 429 or a 5xx: Retry-After when given, bounded. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;

/** getConfig() failing: retried for ever, spaced up to this. */
export const CONFIG_RETRY_MIN = 5 * SECOND;
export const CONFIG_RETRY_MAX = 5 * MINUTE;
/** /data unreadable: read again on this period, one read at a time. */
export const STORE_RETRY = 10 * SECOND;
/** A read of /data that hangs is given up after this (read again later). */
export const STORE_READ_TIMEOUT = 5 * SECOND;
