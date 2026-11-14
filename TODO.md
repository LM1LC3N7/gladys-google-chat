# TODO

## Before announcing

- [ ] Review r1 (high: cloud webhook, send only).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic at publication only.
- [ ] Store field not set in the manifest: `keywords` (Google Chat, Google
      Workspace, webhook, notification, alerte, message).

## To watch

- [ ] Never tested with a real Google Chat space (no Workspace Business
      account here): the request and the answers follow Google's
      documentation (2026-11-14).
- [ ] Google documents no maximum text length for a webhook message: the
      text is cut at 4,096 characters, Gladys' own limit.
- [ ] Google may also reject more than one webhook request a second per
      space: SPACE_GAP is 1.1 s.
- [ ] Images (message.file) are not sent: a webhook posts text, a card image
      needs a public URL. Revisit if Gladys offers one.

## Decisions

- Version 0.1.0 set by hand (package.json, lock, manifest, docker_image).
- `type: "communication"`, `messaging.receive: false`, `gladys_version:
">=5.1.0"`: send only, per-user identity through `contact_schema` (one
  webhook URL per user); no `countries` (Workspace is worldwide).
- A default space in the config for the scene action and the Test button;
  the scene action never takes a URL (a scene field is not a secret).
- Never sent again: 5xx and no answer count as "maybe posted"; a 429 or 5xx
  pauses the space (Retry-After, else 1 min doubling to 6 h); 401/403/404
  refuse the URL (8-bit salted fingerprint in /data) until it changes, the
  Forget button or the Test
  button succeeds. A 400 is not a refusal of the URL.
- Hourly cap (60 by default, 1 to 600) over all spaces, Test included,
  counted at the reservation (a message that may have left counts), kept in
  /data; beyond it, a message is refused, never queued.
- One message every 1.1 s per Google space; a message is refused when its turn is
  more than 2.3 s away (Gladys acks a message within 5 s; the integration
  answers within 3.5 s).
- Markdown converted to the classic Chat syntax (`*bold*`, `<url|text>`);
  the body sent is `{ text }` (plus `thread` with a thread key), nothing else.
- Fingerprints in /data are 8 bits (2 hex), salted (review r1): a collision
  after a restart holds back a new URL until the Forget button; tolerated.
- Pauses, slots and dedupe per Google space (`spaces/<id>`, shared by its
  webhooks); refusals per webhook URL (its token).
- A duplicate within 15 s waits for the first message and takes its outcome;
  after a posted one, the scene action answers `posted: false`,
  `deduplicated: true`.
- Mentions typed in a text (`<users/…>`) are turned into plain `@…`.
