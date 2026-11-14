# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `communication`, send only
(`messaging.receive: false`), Node.js 22+, ESM, no build step, sandboxed Docker
container, `@gladysassistant/integration-sdk` 0.16. It posts Gladys messages
in Google Chat spaces through incoming webhooks: per user (`contact_schema`,
`onSendMessage`), and in a default space (scene action, Test button).
Unofficial. Nothing is received, nothing is polled.

## Commands

```bash
npm install
npm test                                  # node --test (or gi test)
npm run lint && npm run format:check
memcap node scripts/mutants.mjs           # mutation check, one mutant at a time
```

## Architecture

```
index.js          SDK wiring only (src/handlers.js)
src/app.js        GoogleChatApp: config read (retried), deliver() and its guards
                  (refused URL, pause, dedupe, hourly cap, slot per space),
                  /data, status, Test, scene action, Gladys messages
src/chat.js       the only network access: one POST, outcome classified (pure)
src/config.js     config and webhook URL check (pure)
src/format.js     Markdown -> Google Chat syntax, 4,096 characters (pure)
src/i18n.js       every user text, en/fr
src/store.js      /data/state.json
```

## Rules

- **Never sent twice.** No retry anywhere: 5xx and no answer are "maybe
  posted". A 429/5xx pauses the space; 401/403/404 refuse the URL until it
  changes or the Test button succeeds.
- **The webhook URL is a secret**: checked strictly (https,
  chat.googleapis.com, `/v1/spaces/<id>/messages`, `key` and `token` only),
  never logged, never in a status, an error or /data (a salted fingerprint
  only); logs name a space `space #xxxxxx`.
- **Nothing sent on its own**: only a Gladys message, a scene or a click.
- **Gladys acks a message within 5 s**: answer within 3.5 s, never wait
  without bound (queue wait bounded, /data never awaited on the path).
- Decisions on the monotonic clock; the wall clock only dates /data.
- Keys are forever: config, contact, action and scene keys, outputs.
- Bilingual texts (en/fr), CHANGELOG `[Unreleased]`, versions by the Release
  workflow only.
