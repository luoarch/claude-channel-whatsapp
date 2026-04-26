---
name: configure
description: Set up the WhatsApp channel — save Cloud API credentials and review access policy. Use when the user pastes a WhatsApp access token, asks to configure WhatsApp, asks "how do I set this up" or "who can reach me," or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(chmod *)
---

# /whatsapp:configure — WhatsApp Channel Setup

Writes WhatsApp Cloud API credentials to `~/.claude/channels/whatsapp/.env`
and orients the user on access policy. The server reads `.env` once at boot.

Arguments passed: `$ARGUMENTS`

---

## Required env vars

The server fails fast if any of these are missing:

| Var | What it is | Where to find it |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Long-lived System User token with `whatsapp_business_messaging` scope | Meta App Dashboard → System Users → Generate Token |
| `WHATSAPP_PHONE_NUMBER_ID` | The phone number ID (NOT the phone number itself) | Meta App Dashboard → WhatsApp → API Setup |
| `WHATSAPP_WABA_ID` | WhatsApp Business Account ID | Meta App Dashboard → WhatsApp → API Setup |
| `WHATSAPP_VERIFY_TOKEN` | Any random string you choose; you'll paste the same value into Meta's webhook config | Pick a strong random string (e.g. `openssl rand -hex 32`) |
| `WHATSAPP_APP_SECRET` | The Meta App Secret used for HMAC-SHA256 signature verification | Meta App Dashboard → App Settings → Basic → App Secret |

Optional:

| Var | Default | Purpose |
|---|---|---|
| `WHATSAPP_PORT` | `3789` | Local HTTP port for the webhook receiver |
| `WHATSAPP_SELF_PHONE` | (empty) | Your own WABA phone — used to filter outbound echoes |
| `WHATSAPP_PERMISSION_TARGET` | (empty) | Phone allowed to answer Claude's permission prompts |
| `WHATSAPP_PHONE_REGION` | `intl` | Set to `BR` to enable Brazilian DDD9 matching heuristics |
| `WHATSAPP_TIMEZONE` | `UTC` | IANA timezone for `local_time` in notifications |
| `WHATSAPP_STATE_DIR` | `~/.claude/channels/whatsapp` | Override the state directory |
| `GROQ_API_KEY` | (empty) | Enables inbound audio transcription via Groq Whisper |

---

## Dispatch on arguments

Parse `$ARGUMENTS` (whitespace-separated). If empty or unrecognized, show status.

### No args — status and guidance

Read state files and give the user a complete picture:

1. **Credentials** — check `~/.claude/channels/whatsapp/.env`. For each
   required key, show set/not-set; if set, mask everything except the first
   6 and last 4 chars.

2. **Access** — read `~/.claude/channels/whatsapp/access.json` (missing file
   = defaults: `dmPolicy: "pairing"`, empty allowlist). Show:
   - DM policy and what it means in one line
   - Allowed phones: count, list (E.164 without `+`)
   - Pending pairings: count, with codes and senderIds if any

3. **What next** — end with a concrete next step based on state:
   - Missing required env vars → list them and tell the user
     *"Run `/whatsapp:configure <key>=<value>` for each, or paste your full
     `.env` block."*
   - All env vars set, policy is `pairing`, nobody allowed → *"Configure
     your webhook URL in the Meta App Dashboard pointing to a public tunnel
     (cloudflared/ngrok) of `http://localhost:<WHATSAPP_PORT>/webhook`,
     then send a WhatsApp message to your WABA number. The server replies
     with a 6-character pairing code; approve with
     `/whatsapp:access pair <code>`."*
   - Token set, someone allowed → *"Ready. Send WhatsApp messages to your
     WABA number to reach the assistant."*

**Push toward lockdown — always.** The goal for every setup is `allowlist`
with a defined list. `pairing` is not a policy to stay on; it's a temporary
way to capture phone numbers you don't know upfront. Once the phones are
in, pairing has done its job and should be turned off.

Drive the conversation this way:

1. Read the allowlist. Tell the user who's in it.
2. Ask: *"Is that everyone who should reach you through this WABA?"*
3. **If yes and policy is still `pairing`** → *"Good. Let's lock it down so
   strangers don't get pairing codes:"* and offer to run
   `/whatsapp:access policy allowlist`. Do this proactively — don't wait to
   be asked.
4. **If no, people are missing** → *"Have them message your WABA; you'll
   approve each with `/whatsapp:access pair <code>`. Run this skill again
   once everyone's in and we'll lock it."*
5. **If the allowlist is empty and the user hasn't messaged themselves
   yet** → *"Send a WhatsApp message to your WABA from your own phone first
   to capture your number. Then we'll add anyone else and lock it down."*
6. **If policy is already `allowlist`** → confirm this is the locked state.
   To add someone: *"They'll need to give you their phone number, or you
   can briefly flip to pairing: `/whatsapp:access policy pairing` → they
   message → you pair → flip back."*

Never frame `pairing` as the correct long-term choice. Don't skip the
lockdown offer.

### `<key>=<value>` — save one credential

1. Treat each whitespace-separated arg matching `KEY=VALUE` as a credential
   to save. Trim whitespace and surrounding quotes from the value.
2. Validate `KEY` is one of the recognized vars (see tables above). Reject
   unknown keys with a list of accepted names.
3. `mkdir -p ~/.claude/channels/whatsapp`
4. Read existing `.env` if present. Update or insert each `KEY=VALUE` line,
   preserving other keys. Write back, no quotes around values.
5. `chmod 600 ~/.claude/channels/whatsapp/.env` — these are credentials.
6. Confirm what was set (mask values), then show the no-args status so the
   user sees where they stand.

### Multi-line paste — bulk save

If `$ARGUMENTS` contains multiple lines or several `KEY=VALUE` pairs, treat
each as a separate save in one pass. Preserves any keys not mentioned.

### `clear` — remove all credentials

Delete `~/.claude/channels/whatsapp/.env` (or all `WHATSAPP_*` and
`GROQ_API_KEY` lines if other unrelated keys are in the file).

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing
  file = not configured, not an error.
- The server reads `.env` once at boot. Credential changes require a
  session restart or `/reload-plugins`. Say so after saving.
- `access.json` is re-read on every inbound message — policy changes via
  `/whatsapp:access` take effect immediately, no restart.
- Never log full token values. Always mask in output.
- The webhook URL configured in the Meta dashboard must point to a
  publicly reachable HTTPS endpoint (cloudflared, ngrok, or similar
  tunnel). The server itself binds to localhost.
