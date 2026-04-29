# Shaping — PR4 (#15) permission body scrub + secret sanitizer

This is a **sub-shape** of the v0.1.6 program. Inherits monorepo scan, cutover, S-DROP-G summary, governance, and overall risk class from `../shaping.md`. Adds the implementation-level decisions PR4 specifically needs that the program shape only sketches.

## §0 Status TOC

| # | Section | Status | Notes |
|---|---|---|---|
| 1 | Micro feature | ✓ | PR4 of v0.1.6: scrub permission relay body |
| 2 | Problem | ✓ | input_preview + pattern leak via WhatsApp body (server.ts:923, 929-930) |
| 3 | Outcome | ✓ | rg 'input_preview\|sk_live\|STRIPE_KEY' on rendered body returns 0 |
| 4 | Why now | ✓ | last v0.1.6 blocker; release tag depends on it |
| 5 | Monorepo scan | ✓ | inherits parent §5; specific surface scanned below |
| 6 | Requirements | ✓ | render rules + sanitizer regex set + pattern internalization |
| 7 | Candidate shapes | ✓ | 1 chosen — Reinaldo's pivot in #16 |
| 8 | Selected shape | ✓ | inline natural-language body + sanitizer + 3 buttons unchanged |
| 9 | Appetite | ✓ | 1.5 days inside the v0.1.6 program week |
| 10 | In/Out scope | ✓ | sanitizer regex set scoped; no renderer-per-tool yet |
| 11 | Rabbit holes | ✓ | 4 risks; sanitizer over/under-mask is the live one |
| 12 | S-DROP-G | ✓ | inherits parent; PR4 specifics noted |
| 13 | Cutover | ✓ | A (atomic with the rest of v0.1.6) |
| 14 | Pair shaping | ✓ | held async — Reinaldo's #16 pivot replaced parent options C/D |
| 15 | Breadboard | ✓ | one inline render fn + sanitizer fn |
| 16 | Build scopes | ✓ | single scope; lives entirely in PR4 |
| 17 | Gate verification | ✓ | passes |
| 18 | Bet | ✓ | go (inherits parent §18 go; this sub-shape locks impl details) |
| 19 | Pre-build TL | ○ | |
| 20 | Current status | ○ | |
| 21 | Validation evidence | ○ | |
| 22 | Gate verification (live) | ○ | |
| 23 | Close summary | ○ | |
| 24 | Write-back | ○ | |
| 25 | Post-build TL | ○ | |

**Legend:** `○` not started · `◐` in progress · `✓` complete

**Siblings:** evidence.md · spikes/

**Inherits from:** `docs/shaping/v0.1.6-security-hotfix/shaping.md`

**Context (from §18):**
- risk class: high (parent)
- blast radius: 1 file (server.ts), permission relay surface only
- cutover: A
- appetite: 1.5 days within parent week

---

## §1 Micro feature

In the WhatsApp permission relay handler (server.ts:888-940), stop sending `input_preview` and the derived `pattern` literal to the user's WhatsApp. Add a secret-pattern sanitizer that runs over the rendered body before send. Keep the 3 existing interactive buttons unchanged. Match Reinaldo's design pivot from PR #16 review on 2026-04-29.

## §2 Problem

`server.ts:923` prepends `\\`${input_preview.slice(0, 300)}\\`` to the body for `tool_name === 'Bash'`. `input_preview` is the raw `tool_input` JSON string emitted by the MCP permission_request — it contains every secret the Bash command line carries (`STRIPE_KEY="sk_live_..." curl ...`).

`server.ts:930` echoes the `pattern` string in the "Always" line. The pattern computation at `server.ts:809-830` tokenizes Bash by whitespace into `[^\s|;&]+`, so an env-var assignment like `STRIPE_KEY="sk_live_..."` becomes the entire first token — pattern = `Bash:STRIPE_KEY="sk_live_..."`. The literal lands in the WhatsApp body and is also persisted in `pendingPermissions` (L903) and `sessionAllowPatterns` (L1308).

`server.ts:946-948` (text fallback) also leaks because it builds on `trimmedBody`.

## §3 Outcome

Observable success metrics, in priority order:

1. **Grep audit on a synthetic worst-case body**: render the permission body for a Bash request with `description = "Run sed to update STRIPE_KEY=sk_live_xyz123abc"` and `input_preview = '{"command":"sed -i s/old/sk_live_xyz123abc/ .env"}'`. Assert: `grep -E 'sk_live|STRIPE_KEY=sk_|input_preview|preview:' rendered_body.txt` returns 0 matches. Captured in PR description.
2. **Sanitizer fixture**: 12+ cases (canonical token shapes + env-var + high-entropy fallback + CPF/CNPJ + negative cases — normal text not over-masked) all pass.
3. **Live probe**: Reinaldo runs through 4-5 representative permission requests against +55 61 98559-8585; rendered bodies are informative enough to decide Allow/Always/Cancelar, leak-free.
4. **Issue #15 closes** via PR-merge with `Fixes #15`.

## §4 Why now

PR4 is the last v0.1.6 blocker. Without it, §3 of the parent shape (all 6 issues closed) cannot be true. Per parent §9, if PR4 doesn't merge by EOD day 5, the release slips to `v0.1.7-rc1`.

## §5 Monorepo scan

Inherits parent §5 wholesale for context. Surfaces this PR specifically touches:

### Touched surface 1: `permission_request` handler — `server.ts:878-955`

**Mutations:**
- L890 `permissionPattern(...)` — kept; output never reaches body (was reaching via L930)
- L903 `pendingPermissions.set(request_id, { pattern, tool_name, description })` — `pattern` field stays (used internally for "Always" lookup at L1306)
- L921-923 `preview` variable — removed entirely
- L925-931 `body` template — rewritten
- L946-948 text fallback — uses sanitized body (already does, since it's based on `trimmedBody`; just confirm it inherits the new render)

**Consumers (call graph):**
- Single producer of permission body content: this handler.
- `sendInteractiveButtons` at L935 — consumes `trimmedBody` (verbatim).
- `sendText` at L949 — consumes `${trimmedBody}\n\n...` text fallback.
- `pendingPermissions.get` at L1306 (reply handler) — consumes `pattern` field for "Always" matching.
- `sessionAllowPatterns.has(pattern)` at L893 — auto-allow lookup.
- `sessionAllowPatterns.add(pending.pattern)` at L1308 — when user picks "Always".

**No external consumer of these strings.** Body is one-way to WhatsApp; `pattern` stays in-process.

### Touched surface 2: `pendingPermissions` Map type — `server.ts:801-806`

**Current type**: `{ pattern: string; tool_name: string; description: string }`. Stays as-is.

The original v0.1.6 program shape proposed renaming `pattern → patternHash` (sha256 truncated). Reinaldo's pivot makes that unnecessary because patterns no longer cross the WhatsApp surface — `pendingPermissions` is in-process memory only. Hashing was a mitigation for the body leak; with the body leak closed at the render layer, hashing has no security benefit and would only add code.

### Touched surface 3: `sessionAllowPatterns` Set — `server.ts:796`

Stays as `Set<string>`. Same argument as surface 2.

### Touched surface 4: `INTERNAL_PATH_MARKERS` and `resolveInboundForPermission` — `server.ts:836-871`

**Not touched** by PR4. They're attribution helpers (who is the conversation about), not body content. PR4 leaves them alone.

### Constraints already present
- WhatsApp interactive body limit: 1024 chars (L924 comment, L932 trim).
- Existing 3-button structure: `perm_allow_${id}`, `perm_always_${id}`, `perm_deny_${id}` (L935-939). Button IDs unchanged.

### Unknowns
- **U1**: How long can `description` actually be? The MCP protocol says it's a string; in practice Claude generates 1-3 sentences (~50-300 chars). Sanitizer running over a 200-char `description` is trivially fast. **Resolved**.
- **U2**: Does sanitizer over-mask common Bash flags like `--token-file`? Mitigation: regex anchors specifically target known token shapes; `--token-file` has no value-shaped suffix on its own. **Resolved by fixture coverage**.

---

## §6 Requirements

### R-1: Drop `input_preview` from body
- The `preview` variable at L921-923 is removed entirely. No carve-out for Bash, no truncation, no hidden expansion. The decision is "always suppress."

### R-2: Drop `pattern` literal from body
- The `🔁 *Always* = auto-approve ${pattern}` line at L930 becomes:
  - `🔁 *Always* = auto-approve este tipo de solicitação`
- Static phrase. No interpolation of pattern, tool_name internals, or any computed string.

### R-3: Sanitizer pass before send
- Function `sanitizeSecrets(text: string): string` runs over the **assembled body** before `sendInteractiveButtons` and before the text fallback. Mutates only the visible string.
- Internal state (`pendingPermissions`, `sessionAllowPatterns`, `permissionPattern` output) is **not** sanitized — no need; it doesn't cross the surface.
- Replacement: full match → `***`.
- Patterns in priority order (specific first, generic last):

| Pattern | Regex | Notes |
|---|---|---|
| Stripe live | `/sk_live_[A-Za-z0-9_]+/g` | |
| Stripe test | `/sk_test_[A-Za-z0-9_]+/g` | |
| Stripe public | `/pk_(live|test)_[A-Za-z0-9_]+/g` | |
| Slack bot | `/xox[baprs]-[A-Za-z0-9-]+/g` | |
| GitHub PAT | `/(ghp_|gho_|github_pat_)[A-Za-z0-9_]+/g` | |
| AWS key | `/AKIA[0-9A-Z]{16}/g` | |
| Bearer token | `/Bearer\s+[A-Za-z0-9._-]+/gi` | preserves "Bearer" word, masks the value |
| OpenAI/Anthropic | `/sk-(ant-)?[A-Za-z0-9_-]{20,}/g` | covers `sk-...` and `sk-ant-...` |
| Env-var assignment | `/\b[A-Z][A-Z0-9_]*=("[^"]{8,}"|'[^']{8,}'|[^\s'"`;&|]{8,})/g` | masks the value, keeps `KEY=` |
| Brazilian CPF | `/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g` | |
| Brazilian CNPJ | `/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g` | |
| High-entropy fallback | `/\b[A-Za-z0-9+/=_-]{32,}\b/g` | catches base64ish blobs ≥32 chars |

Order matters because the high-entropy regex would otherwise eat structured tokens. Apply specific regexes first, then env-var, then high-entropy.

### R-4: 3 buttons stay (Allow / Always / Cancelar)
- `perm_allow_${id}`, `perm_always_${id}`, `perm_deny_${id}` button IDs unchanged. Reply handler at L1280-1344 unchanged.
- Title strings: revisit only if Reinaldo wants Portuguese ("Permitir / Sempre / Cancelar") instead of English. Default = leave as-is to keep diff minimal.

### R-5: "Always" ack message stays
- `${emoji} ${request_id}${ackSuffix}` at L1330 stays. The `ackSuffix` at L1309 (`(${pending.pattern})`) is **removed**: ack becomes just `${emoji} ${request_id}`.

### R-6: Text fallback inherits sanitization
- The fallback at L946-948 builds `${trimmedBody}\n\n` plus instructions. Since `trimmedBody` is already sanitized (R-3 runs on the assembled body before trim), no additional sanitization needed. Verify in fixture.

---

## §7 Candidate shapes

The program shape originally listed C (Telegram-style click-to-expand) and D (drop "Always"). Both **discarded** by Reinaldo in PR #16 review (2026-04-29) for these reasons:
- C: 4 buttons exceeds Cloud API's 3-button limit; list-message renders as a separate menu screen on some clients (UX regression).
- D: removes a feature ("Always") Reinaldo considers premise, not optional.

Reinaldo's pivot ("E"): keep 3 buttons, transform the body content. This sub-shape locks E.

No alternative E-flavor is in the running. One was briefly considered: render the body via an LLM call ("ask Claude to summarize the action in PT-BR"). **Rejected**: adds latency, dependency, cost, and a new prompt-injection surface. Heuristic + sanitizer is sufficient.

## §8 Selected shape

**E (locked)**: drop `input_preview`, drop `pattern` literal, render `description` as the user-facing line, run sanitizer over the assembled body, keep 3 buttons. Single inline render, no per-tool decorator yet (deferred to v0.2.x if Reinaldo's probe finds class of tool calls ambiguous).

---

## §9 Appetite

- **Time-box**: 1.5 days inside the v0.1.6 program week (parent §9). Implementation ~50 LOC, fixture ~30 LOC.
- **Circuit breaker**: if the sanitizer fixture cannot reach 12/12 by EOD day 1.5, drop the high-entropy and env-var patterns from R-3 (keep the structured token shapes only), document the gap as `type:follow-up` issue, and ship. Structured-token coverage closes the headline `STRIPE_KEY="sk_live_..."` case; high-entropy is belt-and-suspenders.
- **Must-fit**: R-1, R-2, R-3 (at least structured tokens), R-4, R-5, R-6.
- **First cut**: high-entropy + env-var regexes from R-3.

## §10 In-scope / Out-of-scope

### In-scope
- Edit body construction at server.ts:921-932
- Edit "Always" ack at server.ts:1308-1310
- Add `sanitizeSecrets` helper near other helpers (~L189 area)
- Wire sanitizer into both `sendInteractiveButtons` body and text-fallback body

### Out-of-scope
- [no-go] **Modify MCP permission_request schema** — protocol invariant; we control only what we render.
- [no-go] **Hash `pattern` or `pendingPermissions` values** — was original program design; collapsed by Reinaldo's pivot. No security benefit when patterns don't cross the surface.
- [no-go] **LLM-rendered body** — adds latency, dependency, prompt-injection surface.
- [no-go] **Per-tool renderer** — start with single inline render. If R5 surfaces ambiguity, ledger it for v0.2.x.
- [no-go] **Translate button titles to PT-BR** — diff minimization; cosmetic, can ship in a future MF.
- Webhook validation hardening (#12), pushName sanitization (#11), pattern granularity (#10) — all v0.2.x already in parent §10.

---

## §11 Rabbit holes

### R-PR4-1 — Sanitizer over-masking legitimate content
- Category: regression / UX
- Per-consumer impact: WhatsApp body — the only consumer.
- Evidence (pre-bet): `evidence.md` fixture covers negative cases ("git status", "rm -rf /tmp/foo", "sed -i 's/a/b/' file.txt") to assert no `***` appears in the rendered body for benign content. **Status: complete (designed)** — will be runnable spike before/at PR4 build time.
- Mitigation: regex order (specific first); env-var regex requires uppercase + underscore prefix and value ≥8 chars to avoid false hits like `RUN=1`; high-entropy requires ≥32 alphanumeric, which a typical command flag doesn't reach.
- Layer: unit fixture

### R-PR4-2 — Sanitizer under-masking known threats
- Category: security
- Evidence (pre-bet): fixture covers each pattern in R-3 with a representative example. **Status: complete (designed)**.
- Mitigation: priority-ordered regex list. Env-var assignment regex catches the headline `STRIPE_KEY="sk_live_xxx"` case via TWO regexes (Stripe-live AND env-var) — overlapping coverage.
- Anti-pattern lens (TPG): "Heavy mocks with no real dependency validation" applies — fixture is mocks-only. Mitigated by Reinaldo's manual probe at review (R5 from parent).
- Layer: unit fixture + manual probe

### R-PR4-3 — `description` field exposed without preview is uninformative
- Category: UX
- Per-consumer impact: Reinaldo (the only permission approver).
- Evidence: parent shape §11 R5 covers this; manual probe at PR4 review answers empirically.
- Mitigation: if a class of tool calls renders ambiguously, ledger v0.2.x renderer enhancement. PR4 doesn't pre-solve.
- Layer: manual probe at PR4 review

### R-PR4-4 — Body length blows past 1020 chars after sanitizer
- Category: integration constraint
- Sanitizer typically *shortens* (replaces long secrets with `***`). But CPF/CNPJ replacements net +1 char (`123.456.789-00` → `***`, 16→3 chars saved; net negative). Env-var: `STRIPE_KEY="sk_live_xxx_long_token"` → `STRIPE_KEY=***` (saves chars). High-entropy: same.
- Net effect: sanitizer shortens or holds steady. The existing trim at L932 (`body.length > 1020 ? body.slice(0, 1017) + '...' : body`) keeps protection regardless.
- Evidence: trivial — assert sanitizer output `.length <= input.length` for all fixture cases.
- Status: **complete (math)** — no additional spike needed.

### Anti-pattern lens (TPG)
- ✅ "All tests pass" with no real integration proof — applies; fixture is mocks-only. Mitigated by Reinaldo's manual probe.
- ❌ E2E used as substitute for lower layers — N/A.
- ❌ No migration testing — N/A.
- ❌ No retry/idempotency proof — N/A; permission relay is fire-and-forget; idempotency lives at MCP layer.
- ✅ Live dependency without synthetic check — applies; WhatsApp is live. Same mitigation as parent.

---

## §12 S-DROP-G

Inherits parent. PR4-specific notes:

- **Security**: addressed — entire fix is a security regression. Drops two leak vectors. **Sanitizer is defense-in-depth**, not the primary mitigation; the primary fix is dropping `input_preview` from body construction.
- **Data**: N/A — `pendingPermissions` and `sessionAllowPatterns` stay in-memory; `pattern` field type unchanged; on plugin restart, in-memory state resets. No migration.
- **Resilience / Rollback**: revert single PR. No flag, no kill switch (sanitizer is in the hot path of permission relay; if it has a bug, log+pass-through is safer than refusing to send).
  - **Subtle decision**: if `sanitizeSecrets` itself throws (e.g., catastrophic regex backtrack on adversarial input), do we (a) let it bubble and the relay fail, or (b) catch and send the unsanitized body? PR4 implementation: **(a) let it bubble** — failing closed is safer than leaking; Claude will see a permission_request that never got an answer and timeout per its own logic. Document this in the helper.
- **Observability**: PR-description grep audit + manual probe. No new metric (parent §12 covers).
- **Platform**: no infra change.
- **Governance**: owner = Reinaldo. Kill-the-bet view: not applicable — this PR is the program closer.

---

## §13 Cutover decision

**A (narrow fits)**. Inherits parent. No compat shim, no flag.

Triggers:
- Updating consumers fits appetite: ✓ (single file; consumers all in-process)
- All consumers internal: ✓
- No frozen/legacy area touched
- Atomic completion generates 0 successor MFs (issue #10 pattern granularity, #11 pushName sanitization are independent v0.2.x items, not continuations)

No ADR required.

## §14 Pair shaping

**Held async** via PR #16 review (2026-04-29). Reinaldo's pivot is recorded in the comment on #16. No live session needed. The pivot replaced parent's options C/D with the current locked design E.

## §15 Breadboard

Hot path:

```
Claude → permission_request (MCP) → handler (server.ts:888)
                                       │
                                       ├── computes pattern (in-process only)
                                       ├── checks sessionAllowPatterns (auto-allow)
                                       ├── stores in pendingPermissions
                                       │
                                       ├── builds body:
                                       │     ┌── header line ("🔐 Permission required")
                                       │     ├── contextLine (whose convo / internal)
                                       │     ├── tool_name line ("🛠 *Bash*")
                                       │     ├── description (Claude's prose)
                                       │     ├── (NO preview, NO pattern literal)
                                       │     └── "Always" generic line
                                       │
                                       ├── trim to 1020 chars
                                       │
                                       ├── sanitizeSecrets(body) ← NEW
                                       │
                                       └── sendInteractiveButtons(target, sanitized, [3 btns])
                                            └── on failure: sendText(target, sanitized + reply hint)
```

What changes vs current:
- `preview` variable removed (was at L921-923)
- "Always" line static (was templated with `${pattern}`)
- `sanitizeSecrets` called once on `trimmedBody` before send and before fallback text construction
- "Always" ack at L1330: `(${pending.pattern})` suffix removed

What stays:
- `permissionPattern` function unchanged
- `pendingPermissions` shape unchanged
- `sessionAllowPatterns` Set unchanged
- 3-button structure unchanged
- Reply handler at L1280-1344 unchanged
- Text fallback structure unchanged (just inherits sanitized body)

## §16 Build scopes

Single scope — the whole PR is one atomic change.

### Scope: PR4 — body scrub + sanitizer

- **Objective**: render permission body without leaking `input_preview` or `pattern`; defense-in-depth via sanitizer.
- **Files**: `server.ts` only — handler at L888-955, ack at L1308-1310, new `sanitizeSecrets` helper near other helpers.
- **Dependencies**: PR5 (#3, merged); PR1/PR2/PR3 not strictly required (they touch disjoint code paths) but rebasing onto main with all of them present is cleaner.
- **Risk focus**: R-PR4-1 (over-mask) and R-PR4-2 (under-mask).
- **Done criteria** (observable behavior):
  - The handler renders a body that contains **no** occurrence of `input_preview`, the `pattern` string, the literal `tool_input`, or any of the test-fixture secret strings (`sk_live_xyz123abc`, `STRIPE_KEY=sk_live_xyz123abc`, `Bearer xyz...`, AKIA*, ghp_*, etc.) when given inputs containing those.
  - The body still contains `description`, the tool_name decorator, the contextLine, and the `🔁 *Always* = auto-approve este tipo de solicitação` line.
  - The text fallback at L946-948 also contains no leaked secrets (verified via second fixture case).
  - The "Always" ack at L1330 sends `${emoji} ${request_id}` with no parenthesized suffix.
  - PR description grep audit: `rg 'input_preview' server.ts` returns 0 lines flowing to outbound `sendInteractiveButtons` or `sendText`. `rg 'sk_live|sk_test|ghp_|AKIA' rendered-fixture-output.txt` returns 0 matches.
- **change_type**: `new-rule`
- **required_test_layers**: `[static, unit (fixture), manual probe]`
- **evidence_plan**:
  - **static**: typecheck passes via existing CI.
  - **unit (fixture)**: see `evidence.md` for the 12+ canonical token cases + 5 negative cases. Spike script lives at `spikes/sanitize-fixture.ts`, runnable with `bun run`.
  - **manual probe at review**: Reinaldo triggers ~5 representative permission requests (Bash with secret env, Bash with normal git command, Edit, Write, Bash with file path that includes a CPF in name) and confirms (a) bodies are leak-free, (b) bodies are informative enough to decide.
- **deferred_layers**: none (no `bun:test` harness; tracked in parent's `type:follow-up` for v0.2.x).
- **V1**: yes.

---

## §17 Gate verification (pre-bet)

- **SSOT**: pass — N/A in this repo.
- **Single path**: pass — full replacement, no flag, no compat. Cutover §13 = A.
- **Type safety**: pass — `sanitizeSecrets(text: string): string`, no `any`, no blind cast.
- **S-DROP-G**: addressed (parent + PR4-specific notes in §12).
- **Monorepo scan**: PR4 surfaces all enumerated, all consumers in-process.
- **Cutover**: A, recorded.
- **Evidence-backed**: R-PR4-1, R-PR4-2 have fixture in `evidence.md`; R-PR4-3 deferred to manual probe (parent ledger entry FU-2026-101 covers it); R-PR4-4 resolved by math.
- **Test matrix**: scope has change_type + layers + evidence_plan.
- **Follow-up tracking**: GH issues with `type:follow-up` label (parent convention).

All gates pass.

## §18 Bet

- **Decision**: **go**.
- **Reason**: parent §18 already records `go`; this sub-shape locks the implementation specifics that round-1 TL of the parent left at design level. No new decision — just ratification of Reinaldo's PR #16 pivot at build-spec resolution.
- **Approver**: Reinaldo via comment on `riasistemas/claude-channel-whatsapp#16`, 2026-04-29.
- **Timestamp**: 2026-04-29.
- **shaping_commit_sha**: to be recorded at commit of this sub-shape.

### Context payload
- **Blast radius**: 1 file (server.ts), permission relay handler + ack site only; ~70 LOC including helper.
- **Risk class**: **high** (parent inheritance — security-class change to permission relay).
- **S-DROP-G summary**: see §12.
- **Appetite**: 1.5 days within parent week.
- **Pair shaping**: async (PR #16).
- **Cutover**: A.
- **Probe target**: same as parent — Reinaldo's number for live verification.

---

## §19–25
Filled by `/build` and `/tl` post-handoff.
