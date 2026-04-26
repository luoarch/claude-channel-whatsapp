# WhatsApp — Access & Delivery

A WhatsApp Business number is publicly addressable. Anyone with the number can send a message, and without a gate those would flow straight into your assistant session. The access model described here decides who gets through.

By default, a DM from an unknown sender triggers **pairing**: the server replies with a 6-character code and drops the message. You run `/whatsapp:access pair <code>` from your assistant session to approve them. Once approved, their messages pass through.

All state lives in `~/.claude/channels/whatsapp/access.json`. The `/whatsapp:access` skill commands edit this file; the server re-reads it on every inbound message, so changes take effect without a restart.

## At a glance

| | |
| --- | --- |
| Default policy | `pairing` |
| Sender ID | E.164 phone without `+` (e.g. `15551234567`) |
| Group key | WhatsApp group ID (e.g. `120363041234567890@g.us`) |
| Inbound transport | Webhook POST from Meta to your server |
| Outbound transport | WhatsApp Cloud API (Graph API) |
| Config file | `~/.claude/channels/whatsapp/access.json` |

## DM policies

`dmPolicy` controls how messages from senders not on the allowlist are handled.

| Policy | Behavior |
| --- | --- |
| `pairing` (default) | Reply with a pairing code, drop the message. Approve with `/whatsapp:access pair <code>`. |
| `allowlist` | Drop silently. No reply. Useful once your contacts are captured and you don't want to advertise the number. |
| `disabled` | Drop everything, including allowlisted users and groups. |

```
/whatsapp:access policy allowlist
```

## Phone numbers

WhatsApp identifies senders by their E.164 phone number. The server normalizes inbound numbers to digits-only (no `+`, no spaces). The allowlist stores the same format.

Pairing captures the phone automatically. To add someone manually:

```
/whatsapp:access allow 15551234567
/whatsapp:access remove 15551234567
```

Set `WHATSAPP_PHONE_REGION=BR` to enable Brazilian DDD9 matching — numbers with and without the optional 9th digit (e.g. `5511987654321` vs `551187654321`) match each other. Without this flag, comparison is exact-string.

## Groups

Groups are off by default. Opt each one in individually.

```
/whatsapp:access group add 120363041234567890@g.us
```

WhatsApp group IDs end in `@g.us`. To find one, send a test message to the group from your WABA, then look at the `from` field in the inbound webhook payload (or check `~/.claude/channels/whatsapp/messages.db`).

With the default `requireMention: true`, the server forwards a message only when it matches one of your `mentionPatterns` or quotes a previous bot message. Pass `--no-mention` to forward every group message, or `--allow phone1,phone2` to restrict which members can trigger it.

```
/whatsapp:access group add 120363041234567890@g.us --no-mention
/whatsapp:access group add 120363041234567890@g.us --allow 15551234567,15559876543
/whatsapp:access group rm 120363041234567890@g.us
```

## Mention detection

In groups with `requireMention: true`, any of the following triggers the bot:

- A reply to one of the bot's previous messages
- A match against any case-insensitive regex in `mentionPatterns`

```
/whatsapp:access set mentionPatterns '["^hey claude\\b", "\\bassistant\\b"]'
```

## Delivery

Configure outbound behavior with `/whatsapp:access set <key> <value>`.

**`textChunkLimit`** sets the split threshold for long replies. WhatsApp's text body limit is **4096 characters**; default is 4000 to leave headroom.

**`chunkMode`** chooses the split strategy: `length` cuts exactly at the limit; `newline` prefers paragraph boundaries.

```
/whatsapp:access set textChunkLimit 3500
/whatsapp:access set chunkMode newline
```

## Skill reference

| Command | Effect |
| --- | --- |
| `/whatsapp:access` | Print current state: policy, allowlist, pending pairings, enabled groups. |
| `/whatsapp:access pair a4f91c` | Approve pairing code `a4f91c`. Adds the sender to `allowFrom` and sends a confirmation. |
| `/whatsapp:access deny a4f91c` | Discard a pending code. The sender is not notified. |
| `/whatsapp:access allow 15551234567` | Add a phone directly (digits only, no `+`). |
| `/whatsapp:access remove 15551234567` | Remove from the allowlist. |
| `/whatsapp:access policy allowlist` | Set `dmPolicy`. Values: `pairing`, `allowlist`, `disabled`. |
| `/whatsapp:access group add 120363...@g.us` | Enable a group. Flags: `--no-mention`, `--allow phone1,phone2`. |
| `/whatsapp:access group rm 120363...@g.us` | Disable a group. |
| `/whatsapp:access set textChunkLimit 3500` | Set a config key: `textChunkLimit`, `chunkMode`, `mentionPatterns`. |

## Config file

`~/.claude/channels/whatsapp/access.json`. Absent file is equivalent to `pairing` policy with empty lists, so the first DM triggers pairing.

```jsonc
{
  // Handling for DMs from senders not in allowFrom.
  "dmPolicy": "pairing",

  // E.164 phones (digits only, no +) allowed to DM.
  "allowFrom": ["15551234567"],

  // Groups the server is active in. Empty object = DM-only.
  "groups": {
    "120363041234567890@g.us": {
      // true: respond only to mentions/replies (regex match against mentionPatterns).
      "requireMention": true,
      // Restrict triggers to these senders. Empty = any member (subject to requireMention).
      "allowFrom": []
    }
  },

  // Case-insensitive regexes that count as a mention in groups.
  "mentionPatterns": ["^hey claude\\b"],

  // Pending pairing requests, keyed by 6-char code.
  "pending": {},

  // Split threshold. WhatsApp rejects > 4096.
  "textChunkLimit": 4000,

  // length = cut at limit. newline = prefer paragraph boundaries.
  "chunkMode": "newline"
}
```
