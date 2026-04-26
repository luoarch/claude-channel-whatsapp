# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] — 2026-04-26

### Fixed

- README still described the Quick Setup pairing flow as the default, but
  the actual default has been `allowlist` since 0.1.1. Quick Setup now
  shows `/whatsapp:access allow <phone>` as the recommended path and
  documents `pairing` as an opt-in customer-support flow.
- README's "Access control" quick reference said `Default policy is
  pairing`. Updated to `allowlist`.
- Replaced a hardcoded example phone number in a `phoneFromChatId` code
  comment with a generic `<E164>` placeholder.

### Removed

- Roadmap-style "What you don't get (yet)" section — collapsed into a
  shorter, neutral "What you don't get" list. The ambition statements
  (Embedded Signup / hosted v0.2) didn't belong in a current-version
  README.

## [0.1.4] — 2026-04-26

### Added

- **`unhandledRejection` and `uncaughtException` handlers**. The server
  now logs unhandled errors instead of dying silently, matching the
  pattern used by the telegram channel plugin.
- **`SIGHUP` shutdown handler**.
- **Orphan watchdog** that polls every 5 s for parent-PID change or a
  destroyed/ended stdin pipe and self-terminates. Catches the case where
  Claude Code dies hard without sending SIGTERM (the existing PID
  lockfile only handles new sessions; the watchdog handles long
  idle gaps where no new session arrives).

### Changed

- `plugin.json` description and keywords trimmed to match the telegram
  pattern. Marketing copy moved to the README.
- README "About" section reduced to a neutral "Maintainer" line.

## [0.1.3] — 2026-04-26

### Removed

- **Groq Whisper inbound transcription**. The plugin no longer auto-
  transcribes inbound audio. Audio messages are still downloaded and
  the local file path is forwarded to the assistant via `meta.file_path`,
  so a downstream tool or skill can transcribe if needed. Rationale:
  channel plugins (telegram, discord, imessage) do not process content
  upstream — they forward raw and let the assistant decide. Removing
  Groq aligns this plugin with that pattern, drops a third-party
  dependency, and reduces configuration surface. The `GROQ_API_KEY`
  env var is no longer recognized.

### Changed

- Audio inbound is now downloaded to `MEDIA_DIR` like other media types,
  so `meta.file_path` is populated and the assistant can `Read` it.

## [0.1.2] — 2026-04-26

### Documentation

- **`allowProspects` flag**: documented in `ACCESS.md` (escape-hatch section
  + JSON schema) and in the `/whatsapp:access` skill. Toggle with
  `/whatsapp:access set allowProspects true`. When true, unknown senders
  pass through tagged `relationship: "prospect"`, bypassing both
  `allowlist` drop and `pairing` codes. Useful for inbound sales / lead
  capture.
- **Permission relay**: documented as opt-in in `README` via
  `WHATSAPP_PERMISSION_TARGET` env var. Forwards Claude Code's permission
  prompts to a configured phone as a WhatsApp interactive message with
  three buttons (✅ Allow / 🔁 Always / ❌ Deny). Text fallback
  (`yes XXXXX` / `always XXXXX` / `no XXXXX`) also accepted. Replies
  honored only from the configured target. Validated in production
  internally before this release.

## [0.1.1] — 2026-04-26

### Added

- **Pairing flow**: `gate()` now returns a `pair` action when `dmPolicy` is
  `pairing` and an unknown sender writes in. The server generates a 6-char
  code, persists it in `access.pending` with a 1h TTL, and sends a message
  back to the sender with the code so the operator can run
  `/whatsapp:access pair <code>` to approve them.
- **`checkApprovals()`**: 5s poll over `~/.claude/channels/whatsapp/approved/`.
  When `/whatsapp:access pair` drops a marker, the server sends the new
  contact a "✅ Paired!" confirmation and removes the marker.
- **File-type dispatch in `reply` tool**: attachments are routed by
  extension. `.ogg`/`.opus` → voice note (`voice: true` forced — required
  for waveform/play-button rendering). `.jpg`/`.jpeg`/`.png`/`.webp` →
  inline image. Everything else → document.
- **Webhook receive log**: every inbound `POST /webhook` now logs
  `webhook received (N bytes)` to aid debugging.

### Changed

- **Default `dmPolicy` is now `allowlist`** instead of `pairing`. WhatsApp
  uses the sender's phone number as the ID (unlike Telegram/Discord opaque
  IDs), so operators already know who to allow. Pairing remains available
  but is opt-in to avoid the per-stranger outbound message cost.

### Fixed

- **`parseWebhookPayload`** expected `payload.body.entry` (legacy CF Worker
  envelope shape). Meta sends `payload.entry` directly, so the parser
  silently returned `[]` and no inbound messages were processed. Bug
  surfaced when migrating from R2-polling inbound to direct HTTP webhook.

## [0.1.0] — 2026-04-26

### Added

- Initial public release.
- HTTP webhook receiver (`Bun.serve` on `WHATSAPP_PORT`, default `3789`) with
  Meta verification (`GET /webhook`) and HMAC-SHA256 signature validation
  (`POST /webhook`).
- Outbound via WhatsApp Cloud API (Graph v24.0): text, images, documents,
  audio (voice notes), reactions, replies-to.
- Three MCP tools: `reply`, `react`, `chat_messages`.
- Two skills: `/whatsapp:configure` (credentials, status, lockdown guidance),
  `/whatsapp:access` (pairing, allowlist, group policy).
- SQLite-backed message history at `~/.claude/channels/whatsapp/messages.db`.
- Optional inbound audio transcription via Groq Whisper (`GROQ_API_KEY`).
- Brazilian DDD9 matching heuristics behind `WHATSAPP_PHONE_REGION=BR`.
- Configurable timezone for `local_time` annotations (`WHATSAPP_TIMEZONE`).
- PID lockfile to prevent zombie instances across session restarts.
