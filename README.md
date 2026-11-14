# gladys-google-chat

Unofficial [Gladys Assistant](https://gladysassistant.com) integration: Gladys
messages and alerts in a **Google Chat** space, through an **incoming
webhook**. Send only. Not affiliated with Google.

- Each Gladys user pastes the webhook URL of their space in "My account" and
  receives there the messages Gladys sends them (scenes, system messages,
  answers of the assistant).
- A scene action "Post in Google Chat" posts in a default space, optionally in
  a thread.
- Needs a **Google Workspace Business or Enterprise** account whose
  administrator allows incoming webhooks.
- Never sends a message twice, never retries on its own; a cap of messages per
  hour (60 by default), one message every 1.1 s per Google space (shared by
  its webhooks), pauses on 429/5xx.
- The same text to the same Google space within 15 s is posted once: a
  duplicate gets the outcome of the first message (a failure stays a
  failure); the scene action then answers `posted: false`,
  `deduplicated: true`.
- A URL refused by Google (401/403/404) is not used again until it changes,
  the Test button succeeds (default space) or the "Forget the refused webhook
  URLs" button is clicked.
- The webhook URL is a secret: never logged, never in the status nor `/data`.

Never tested with a real Google Chat space: written from Google's
documentation, tested against simulated answers.

User guide: [English](docs/en.md) · [Français](docs/fr.md).

## Development

```bash
npm install
npm test                         # node --test
npm run lint && npm run format:check
memcap node scripts/mutants.mjs  # mutation check (scripts/mutants.json)
npm run cover                    # regenerate cover.png (800 x 534)
```

See [CLAUDE.md](CLAUDE.md) for the architecture and the rules.

## License

Apache-2.0, see [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Google Chat and Google
Workspace are trademarks of Google LLC.
