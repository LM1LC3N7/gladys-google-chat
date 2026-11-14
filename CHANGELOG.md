# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Gladys messages in Google Chat: each user pastes the incoming webhook URL of
  their space in "My account" (send only; Google Workspace Business or
  Enterprise).
- The "Post in Google Chat" scene action (default space, optional thread key)
  and a Test button.
- Markdown turned into the Google Chat syntax; texts cut at 4,096 characters.
- Never sent twice: no retry; pauses on 429/5xx (kept across restarts); a
  refused URL is not used again until it changes or the Test button succeeds.
- A cap of messages per hour (60 by default), one message every 1.1 s per
  Google space (shared by its webhooks), the same text to the same space
  within 15 s posted once (the duplicate takes the first one's outcome).
- A "Forget the refused webhook URLs" button.
- Mentions typed in a text (`<users/all>`) never notify the space.

[Unreleased]: https://github.com/LM1LC3N7/gladys-google-chat/commits/main
