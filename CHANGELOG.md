# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
