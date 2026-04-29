# Evidence — v0.1.6 Security Hotfix

This MF tracks follow-ups via **GitHub Issues** with label `type:follow-up`, not a separate ledger file. Issue numbers will be filled when Reinaldo creates the labels.

## Risk → Evidence map

### R1: Bun's FormData against Graph API may have quirks
- Category: external integration
- Layer (TPG): static (CI typecheck) + unit (fixture mock) + manual probe
- Evidence type: fixture-based mock + self-test against Reinaldo's production number
- Location: PR1 description (fixture + Graph response IDs from manual probe)
- Result: **complete-at-PR-review** (no deferral)
- Status: **complete (plan)**
- Notes: fallback to manual multipart via `Buffer.concat` if `Bun.file()+FormData` misbehaves. Both paths satisfy #1 (no `child_process`).

### R2: realpathSync placement vs MEDIA_DIR creation
- Category: file-system semantics
- Layer (TPG): static
- Evidence type: code ordering (PR2 places `realpathSync(MEDIA_DIR)` after `mkdirSync(MEDIA_DIR)` at `server.ts:193`)
- Location: §16 PR2 done criteria
- Result: passed
- Status: **complete**
- Notes: `mkdirSync(..., { recursive: true })` is idempotent and runs at module load before any handler. `realpathSync` after this point is safe.

### R3: Phone-allowlist gate is RIA-original (no canonical reference)
- Category: behavior regression + design-without-canonical
- Layer (TPG): unit (fixture truth table) + manual probe at PR review
- Evidence type: design + Claude session probe
- Location: §16 PR3 done criteria + truth table
- Result: passed (design)
- Status: **complete (design)** + manual probe at PR3 review
- Notes: shape Round 1 falsely cited `tg.ts:135-145` as canonical for phone gate; that's actually a file-path validator. Neither telegram nor imessage has a phone gate (their addressing models don't expose free-form chat_id). PR3 design is RIA-original. Recency window aligned to existing `lastInboundByChat` 600s eviction (`server.ts:1437-1440`). No mode asymmetry between `reply` and `react`.

### R4: WITHDRAWN
- Round 1 audit established that the original concern (`reply.files` allowlist breaks legitimate flows) was based on a misread of canonical pattern. New design (per #5 acceptance) blocks only `STATE_DIR` egress with `MEDIA_DIR` carve-out — accepts arbitrary user paths, matching `tg.ts:131-145` threat model exactly. No regression risk.

### R5: "Always" UX vs leak — three options weighed (C6)
- Category: UX-vs-security trade-off
- Layer (TPG): manual probe at PR4 review
- Evidence type: design decision pending Reinaldo
- Location: §16 PR4 + Open questions for Reinaldo
- Result: passed (design captured; Reinaldo confirms C or D)
- Status: **complete (design)** — implementation choice pending C6
- Notes: default = (C) Telegram-style click-to-expand. (D) drops "Always" entirely and is simpler.

### R6: WhatsApp interactive button row max 3 buttons
- Category: external integration constraint
- Layer (TPG): manual probe at PR4 review
- Evidence type: WhatsApp Cloud API doc reference + visual UI check
- Location: §16 PR4 + R6 entry in §11
- Result: passed (design with two viable renderers)
- Status: **complete (plan)**
- Notes: option C needs 4 affordances; either use list message (10 rows) or fall back to 3 buttons + text-reply trigger ("show ${request_id}").

## TPG anti-pattern lens — surfaced risks

- **No `bun:test` harness**: typecheck CI exists; unit assertions ship as fixture-based scripts in PR body until harness is established. GH follow-up issue (label `type:follow-up`, `testing`): "establish bun:test harness for v0.2.x".
- **CI claims `--frozen-lockfile` but lockfile not committed**: misleading green. PR5 fixes by committing the lockfile + intentional drift probe to verify CI fails on lockfile mismatch post-commit.
- **Live dep without synthetic check**: WhatsApp Cloud API is live; PR1 mitigated by R1 self-test against Reinaldo's number; PR4 hash change invalidates in-memory `sessionAllowPatterns` once on upgrade — documented in CHANGELOG.

## GitHub follow-ups to file (replacing prior FU-2026-NNN ledger entries)

1. **`testing/bun-test-harness`** — Establish `bun:test` so post-v0.1.6 PRs ship spec-first tests instead of fixture scripts. Owner: Reinaldo. Target: v0.2.x.
2. **`security/pr3-claude-session-probe`** — Manual probe at PR3 review: Claude calls `reply` to non-allowlisted phone, confirm `isError` surfaces gracefully without lockup. Owner: Reinaldo (review). Target: PR3 merge.
3. **`security/pr1-graph-self-test`** — Manual probe at PR1 review: upload 1-byte text + real `.ogg` to Reinaldo's own number, capture Graph response IDs in PR description. Owner: Luo (drafter). Target: PR1 merge.
4. **`security/pr4-show-button-render`** — Manual probe at PR4 review: confirm 4-option list-message renders correctly on Reinaldo's WhatsApp client; if not, fall back to 3-button + text-reply trigger. Owner: Reinaldo (review). Target: PR4 merge.

## Round-1 audit changes (this evidence file replaces the prior version)

- Removed FU-2026-100..103 (formal ledger) → replaced by GH issue follow-ups above.
- R4 withdrawn (canonical analysis showed file allowlist was over-restrictive).
- R6 added (WhatsApp interactive UI constraint surfaced by C6 design choice).
- R1 un-deferred (manual probe via Reinaldo's production number is acceptable evidence; no sandbox needed).
- R3 reframed: RIA-original, not "ported from telegram L135-145".
