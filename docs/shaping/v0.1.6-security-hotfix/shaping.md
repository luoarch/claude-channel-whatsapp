# Shaping — v0.1.6 Security Hotfix Release

## §0 Status TOC

| # | Section | Status | Notes |
|---|---|---|---|
| 1 | Micro feature | ✓ | v0.1.6 security hotfix bundle (6 issues) |
| 2 | Problem | ✓ | 6 v0.1.6 blockers from security review 2026-04-27 |
| 3 | Outcome | ✓ | All 6 blockers closed; marketplace gate unblocked |
| 4 | Why now | ✓ | Pre-marketplace approval; pre-CVE distribution |
| 5 | Monorepo scan | ✓ | Single-file server.ts; consumers = skills + downstream installs |
| 6 | Requirements | ✓ | Per-issue acceptance criteria (revised round 1) |
| 7 | Candidate shapes | ✓ | Single release vs sequential point releases |
| 8 | Selected shape | ✓ | One v0.1.6 release, 6 PRs in order |
| 9 | Appetite | ✓ | 1 week; circuit breaker delays to v0.1.7-rc1 if #15 slips |
| 10 | In-scope / Out-of-scope | ✓ | 6 issues in; 7 issues tagged no-go for v0.1.6 |
| 11 | Rabbit holes | ✓ | 3 risks (R4, R6 dropped); R1/R3 manual probe; R2 inline; R5 design+probe |
| 12 | S-DROP-G | ✓ | All 6 dimensions decided |
| 13 | Cutover decision | ✓ | A (narrow fits) — each PR atomic, no compat |
| 14 | Pair shaping | ✓ | Async — Reinaldo reviews PRs, Luo drafts |
| 15 | Breadboard | ✓ | Hot paths: uploadMedia, downloadAndSaveMedia, reply, permission relay |
| 16 | Build scopes | ✓ | 6 ordered PRs, V1=PR5+PR1+PR2+PR3+PR4 |
| 17 | Gate verification | ✓ | All gates pass (round 1 revisions applied) |
| 18 | Bet | ✓ | go (Reinaldo approved 2026-04-29 PR #16; #15 redesigned) |
| 19 | Pre-build TL | ○ | |
| 20 | Current status | ○ | |
| 21 | Validation evidence | ○ | |
| 22 | Gate verification (live) | ○ | |
| 23 | Close summary | ○ | |
| 24 | Write-back | ○ | |
| 25 | Post-build TL | ○ | |

**Legend:** `○` not started · `◐` in progress · `✓` complete

**Siblings:** evidence.md · spikes/

**Context (from §18):**
- risk class: **high** (security surface, pre-distribution; SSOT-equivalent change for permission relay protocol)
- blast radius: 1 service, ~120 LOC, 3 skills (access/configure/pair) untouched but read consumers; downstream = anyone who installs from marketplace
- cutover decision: A (narrow fits)
- appetite time-box: 1 week (5 working days)

---

## §1 Micro feature

Ship **v0.1.6** of `riasistemas/claude-channel-whatsapp` as a **security hotfix release** bundling 6 fixes that close all v0.1.6 blockers identified in the external security review on 2026-04-27.

This is technically a program of 6 atomic patches. They are bundled into one release because:
- They share the same release vehicle (single-file plugin, single npm-style install).
- None depends on another behaviorally — they touch disjoint code paths.
- The marketplace gate is **all-or-nothing**: 1 unfixed critical = blocked.
- Partial release (e.g., v0.1.6 with #1 fixed, v0.1.7 with #2) leaves a known-vulnerable version in the wild for longer than necessary.

Treating it as one MF lets us shape the **release** as the bet, while §16 slices the work into ordered PRs.

---

## §2 Problem

`v0.1.5` ships to anyone who installs from the marketplace. Once distributed, each unfixed critical becomes a CVE-class issue with public exposure. Today the plugin contains:

- **#1 RCE-equivalent**: `execSync` with shell-concatenated `curl` lets attacker-controlled file paths reach the shell (`server.ts:665-673`); `ACCESS_TOKEN` also leaks via `argv` (visible to any process on the host with `ps`).
- **#2 Arbitrary FS write**: WhatsApp document `filename` (attacker-controlled) flows untouched to `writeFileSync(join(MEDIA_DIR, filename))` (`server.ts:551, 1353`). `../../.ssh/authorized_keys` planting demonstrated.
- **#3 Supply-chain unpinned**: `bun.lock` is gitignored and `bun install` runs on every start without `--frozen-lockfile`; caret-ranged deps (`^1.0.0` MCP SDK, `^3.23.8` Zod). A compromised registry response on plugin restart is unsigned and unbounded.
- **#4 Outbound access check is a no-op**: `if (!allowed && access.dmPolicy !== 'disabled') { /* comment, no return */ }` (`server.ts:1034-1041`). The `react` tool has no check at all. Effect: `reply` and `react` send to any phone number Claude chooses, regardless of allowlist.
- **#5 Arbitrary file exfil**: `reply.files: string[]` accepts any absolute path; each is uploaded to Graph API via `uploadMedia` (`server.ts:1080`). Prompt-injection chain: attacker injects content → Claude calls `reply` with `files=["/Users/x/.ssh/id_ed25519"]` → file lands in attacker's WhatsApp.
- **#15 Permission relay leaks secrets**: `tool_input` (`input_preview` slice 0–300) and `pattern` are sent to `PERMISSION_TARGET` (`server.ts:923, 929-930`); `pattern` regex (`server.ts:809-830`) tokenizes Bash commands by whitespace, so `STRIPE_KEY="sk_live_..."` becomes the pattern key — secret persists in `pendingPermissions` and `sessionAllowPatterns` and is echoed back to the user's WhatsApp on "Always".

These are not theoretical. #1, #2, #4, #5 are exploitable today by any inbound message; #15 leaks every time a Bash permission is requested with a secret in `argv`.

---

## §3 Outcome

**Observable success metrics**:

1. All 6 GitHub issues (#1, #2, #3, #4, #5, #15) closed via PR-merge with `Fixes #N` reference.
2. `package.json` bumped to `0.1.6`; `CHANGELOG.md` documents the security entries.
3. **Reproducibility evidence**: `bun install --frozen-lockfile` succeeds from a clean clone (proves #3).
4. **Behavioral evidence per fix** (see §16 evidence_plan and `evidence.md`):
   - #1: `uploadMedia` sends a file with `;` and `$(...)` in its path without spawning a shell — strace/dtruss shows zero `child_process` invocation; token absent from `ps -ef`.
   - #2: filename `../../etc/passwd` from a WhatsApp document gets rejected at the boundary; `realpathSync` of the saved path is inside `MEDIA_DIR`.
   - #4: `reply` with `chat_id` of a non-allowlisted phone returns `isError: true` with reason `not in outbound allowlist` (and `react` does the same).
   - #5: `reply.files=["/Users/x/.ssh/id_ed25519"]` is rejected; `reply.files=["./media/foo.pdf"]` succeeds.
   - #15: permission relay body contains no `pattern` literal and no `input_preview` for non-Bash tools; `sessionAllowPatterns` stores hashes (`sha256` truncated 16 hex), not literal patterns.
5. **Marketplace re-submission**: Reinaldo confirms the plugin passes Anthropic's pre-distribution review.

The metric that closes the bet: **GitHub Releases shows v0.1.6 tagged, all 6 issues closed, and CHANGELOG entry is human-readable**.

---

## §4 Why now

- **Pre-marketplace gate**: v0.1.5 has not yet shipped to the catalog. Fixing pre-distribution avoids CVE filing, version-deprecation churn, and downstream-install rollback. This window closes the moment Reinaldo gets approval.
- **Public review trail**: 9 issues already have cross-reference comments anchored to anthropics/claude-plugins-official commit `0742692` (posted 2026-04-29). The "why" is documented and Reinaldo signed off on the audit. Delaying the implementation phase strands the analysis.
- **Internal-friend leverage**: review-to-fix latency is hours, not weeks. Cost of doing it now ≈ cost of doing it later, but blast radius grows daily once distributed.

---

## §5 Monorepo scan

**Important**: this repo is a single-file MCP server (`server.ts`, 1578 LOC). There is no `<SSOT_PKG>`. The "monorepo scan" here is a **call-graph + consumer scan** of the touched surfaces inside `server.ts` plus the `skills/` directory and downstream installation surfaces.

### Touched surfaces and consumers

#### Surface 1: `uploadMedia(filePath, mimeType)` — `server.ts:661-677`
Consumers (call sites):
- `server.ts:1083` (`reply` tool, file dispatch loop)

Impact: replacing `execSync+curl` with `fetch+FormData` changes the call shape's success/error path. Currently throws on `data.id` missing; we keep that contract. **No skill imports** this function.

#### Surface 2: `downloadAndSaveMedia(mediaId, fallbackName)` — `server.ts:528-563`
Consumers:
- `server.ts:1356` (inbound webhook, document/image/video/audio auto-download)

Impact: filename sanitization at line 551 only affects the saved file path. The returned `filePath` is later included in `notifications/claude/channel` content — Claude reads it via the standard `Read` tool. Sanitized filenames must remain readable strings (no empty/null after sanitization → fallback to `${mediaId}.${ext}`).

#### Surface 3: `reply` and `react` tool handlers — `server.ts:1026-1130` (reply), look up `react` in handler switch
Consumers:
- MCP client (Claude Code itself); contract is published via `ListToolsRequestSchema` response.
- Skills under `skills/` (read-only consumers — they invoke the tools through Claude, not directly).

Impact: introducing `assertSendable(phone)` adds an `isError: true` failure mode. Claude must surface this naturally; no skill change needed because skills already handle `isError`. Adding `reply.files` allowlist enforcement may break a current legitimate flow if Claude is sending files from outside `MEDIA_DIR` — **needs probe** (see §11 R5).

#### Surface 4: Permission relay protocol — `server.ts:878-960`, `server.ts:1290-1344`
Consumers:
- MCP client (Claude Code) sends `notifications/claude/channel/permission_request`; we reply with `notifications/claude/channel/permission` (`behavior: allow|deny`).
- WhatsApp `PERMISSION_TARGET` receives the rendered body (interactive buttons or text).
- `pendingPermissions` Map (`server.ts:806`) and `sessionAllowPatterns` Set (referenced 1308) — internal state.

Impact: dropping `input_preview` and `pattern` from the **outbound body** is one-sided — Claude doesn't see the body. The `behavior` reply contract is unchanged. Hashing the pattern internally is also one-sided. **The MCP protocol surface does not change.** The user-visible WhatsApp message format does change (no more "🔁 *Always* = auto-approve Bash:git for this session") — replaced with "🔁 *Always* = auto-approve this kind of request".

#### Surface 5: Package install / lockfile
Consumers:
- Anyone running `bun install` from a checkout (currently: regenerates lockfile, fetches latest within caret).
- `package.json` `start` script: `bun install --no-summary && bun server.ts` runs on every plugin start.
- Marketplace installer (downstream) — reads `package.json`, runs `bun install` itself.

Impact: committing `bun.lock` and using `--frozen-lockfile` makes installs deterministic. **Side effect**: a malicious registry response cannot inject a different version. **Risk**: lockfile drift during dev — must document `bun install --no-frozen-lockfile` for intentional updates.

### Surfaces NOT touched (verified)

- `verifyWebhookSignature` (HMAC) — kept as-is; constant-time compare is a strength.
- `chmodSync 0o600/0o700` on state dirs — kept.
- PID lockfile + orphan watchdog — kept.
- `skills/access`, `skills/configure`, `skills/pair`, `skills/whatsapp` — no changes; they read access.json which we don't restructure.
- `verifyChannelToken`, `normalizePhone`, `chatIdFromPhone`, `phoneFromChatId` — kept.

### Constraints already present

- Bun runtime ≥ 1.3 (per `@types/bun ^1.3.10`).
- MCP SDK contract for permission notifications is fixed; we control only what we pack into `description` and `body`.
- WhatsApp Cloud API: interactive button body limit 1024 chars (already handled at `server.ts:932`).

### Unknowns flagged for spikes

- **U1**: Does `Bun.file()` + `FormData` work end-to-end against Graph API for upload? (Bun's FormData implementation has had quirks.) → spike before PR1 lands.
- **U2**: Does `realpathSync` on a not-yet-created file throw or return the parent? → trivial spike.
- **U3**: What does Claude's behavior look like when `reply` returns `isError: true` due to `assertSendable` rejection? Does it gracefully retry with a different phone or hang? → integration probe.

---

## §6 Requirements

Per issue, the acceptance criteria for v0.1.6:

**#1 — Command injection**
- No `child_process` import in `uploadMedia`.
- `ACCESS_TOKEN` does not appear in `process.argv` of any spawned process during upload.
- Files with shell metacharacters in their path (`; $ \` & |`) upload successfully.

**#2 — Path traversal**
- `filename` from WhatsApp message body is `path.basename`'d before use.
- Final saved path passes `realpathSync(saved).startsWith(realpathSync(MEDIA_DIR))`.
- Filenames that resolve outside `MEDIA_DIR` (or contain `..`, null bytes, or absolute path prefixes) are replaced with `${mediaId}.${ext}` and a warning is logged.

**#3 — Supply chain**
- `bun.lock` removed from `.gitignore` and committed.
- `package.json` `start` script uses `--frozen-lockfile`.
- README documents how to update deps intentionally.

**#4 — Outbound access**
- `reply` and `react` both call `assertSendable(phone)` which throws when phone is not in the effective allowlist (self_phone OR access.allowFrom OR — only for `reply` — recently-inbound chat within last 5 min).
- Throwing causes the MCP tool result to be `isError: true` with reason in text content.

**#5 — File exfil (canonical-aligned)**
- Adopt canonical `assertSendable(f: string)` from `tg.ts:131-145` / `im.ts:225-239`.
- Threat model **matches canonical**: Claude can `Read+paste` arbitrary file contents anyway, so blocking arbitrary user paths gains nothing. The actual leak we close is the **server's own state directory** (access.json, lockfile, db, downloaded-media metadata) being shipped as documents.
- Behavior (matches `tg.ts:135-145` carve-out pattern): block paths inside `realpath(STATE_DIR)` **except** `realpath(MEDIA_DIR)`. WhatsApp's downloaded-media flow legitimately re-forwards inbound media (e.g., user sends image → Claude forwards to another contact in same chat), so `MEDIA_DIR` is the equivalent of telegram's `inbox` carve-out. Throw `refusing to send channel state: ${f}` otherwise.
- No new env var. No user-path allowlist. No flow regression for legitimate Claude file sends.

**#15 — Permission relay leak (natural-language body + secret sanitizer)**

Reinaldo's chosen direction (PR #16 review 2026-04-29, replaces options C and D):

- **3 buttons stay** (Allow / Always / Cancelar) — within Cloud API hard limit, no list-message needed, no extra "Show" affordance.
- **Body content replaced**: instead of `tool_name` + `description` + `input_preview` slice (current leak surface), render a **natural-language description** of what's being approved, generated heuristically from `tool_name` + the structured `description` field MCP already provides.
  - Examples: "Aprovar execução de comando de busca em arquivos do projeto" instead of `grep -E '...'`; "Aprovar criação de issue no GitHub do repo X" instead of `gh issue create --body ...`.
  - The `description` field at `server.ts:884` is generated by Claude itself per the MCP permission protocol — it's already meant to be human-readable. We render it directly and drop `input_preview` from the body entirely.
- **Secret sanitizer at render time**: any string in the rendered body that matches secret patterns is masked with `***`. Defense-in-depth in case `description` contains a token (Claude can generate sloppy descriptions).
- **`permissionPattern()` stays unchanged** for session-allow matching but its output never reaches the body. No hashing needed under this design — patterns are in-memory only and never cross the WhatsApp surface. Drops the round-1 hashing complexity.
- **"Always" ack**: `🔁 ${request_id} (auto-approve added)` — no pattern echoed (same as before).

Rationale (Reinaldo's words, paraphrased): "Always" is premise, not optional; Deny ≡ Cancelar so 4th button is redundant; the actual fix is making the body itself safe to look at, not gating visibility behind another click.

Sanitizer patterns to catch (initial set; expandable):
- Generic token shapes: `sk_live_…`, `sk_test_…`, `pk_…`, `xoxb-…`, `ghp_…`, `gho_…`, `github_pat_…`, `Bearer\s+[\w.-]+`, `AKIA[0-9A-Z]{16}`
- Env-var assignments: `[A-Z][A-Z0-9_]+=(["'])?[^"'\s]{8,}\1?` → mask the value
- High-entropy fallback: `[A-Za-z0-9+/=_-]{32,}` (long opaque strings)
- Brazilian PII: CPF (`\d{3}\.\d{3}\.\d{3}-\d{2}`), CNPJ (`\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}`)
- Replacement: full match → `***`

---

## §7 Candidate shapes

### Shape A: One release, 6 ordered PRs (recommended)
- Each PR = one issue, atomic, mergeable independently.
- Release tag cut once all 6 land.
- Pro: easy review, clean revert per fix, parallel review possible.
- Con: 6 review rounds; if Reinaldo is slow on one PR, release stalls.

### Shape B: One mega-PR
- Single PR with all 6 fixes.
- Pro: one review, atomic ship.
- Con: ~120 LOC + lockfile; review burden compounds; revert means losing all fixes; failure mode of one fix blocks 5 others.

### Shape C: Sequential point releases (v0.1.6 → v0.1.10)
- Ship #1 as v0.1.6, #2 as v0.1.7, etc.
- Pro: each release is minimal.
- Con: 5 unnecessary release cycles; v0.1.6 with only #1 fixed still has 5 known criticals → marketplace gate stays closed → defeats the purpose.

### Fit check (with consumer impact from §5)

| | A | B | C |
|---|---|---|---|
| Closes marketplace gate atomically | yes | yes | **no** |
| Per-fix revert possible | yes | no | yes |
| Review burden distributed | yes | concentrated | distributed |
| Risk of one fix blocking others | low | high | high |
| Consumer (skill) churn | none | none | none |
| Downstream-install impact | one bump | one bump | five bumps |

**Selected: Shape A.**

---

## §8 Selected shape

**One v0.1.6 release. Six PRs, ordered. Tag and ship when all merged.**

PR order (rationale in §16):
1. PR5 — `bun.lock` + `--frozen-lockfile` (#3) — base for reproducible CI on the rest.
2. PR1 — uploadMedia rewrite (#1) — highest severity, isolated scope.
3. PR2 — filename sanitization (#2) — disjoint from PR1.
4. PR3 — `assertSendable` for `reply` and `react` (#4 + #5) — single shared helper, two tools.
5. PR4 — permission relay scrub (#15) — touches the most-trafficked surface; goes after the rest are stable so its review can focus.
6. PR6 — `activeTask` TTL (#6) — opt-in for v0.1.6, cuttable if circuit breaker fires.

After all merge: bump `version` in `package.json`, update `CHANGELOG.md`, tag `v0.1.6`, push.

---

## §9 Appetite

- **Time-box**: 5 working days (1 calendar week).
- **Circuit breaker**:
  - If EOD day 4 and PR4 (#15) not merged → drop PR6 (#6) entirely (defer to v0.2.0); focus remaining day on PR4.
  - If EOD day 5 and PR4 not merged → **delay release** to `v0.1.7-rc1`. Do not ship v0.1.6 with #15 open — §3 outcome explicitly requires all 6 closed, and memory tags #15 as v0.1.6 blocker. Tag the merged work as `v0.1.6-rc1` (pre-release) and treat the slip as a one-week extension.
- **Why this time-box is enough**: total LOC ≈ 130 (PR4 with sanitizer + render is ~50 LOC; rest as before); canonical patterns from Anthropic plugins reduce design time to near-zero; review latency is the bottleneck, not implementation.
- **Must-fit items**: #1, #2, #3, #4, #5, #15 (all 6 blockers — none droppable per §3 outcome).
- **First cuts if exceeded**: drop PR6 (#6, already optional). After that, no further cuts available — slip the release tag instead.

---

## §10 In-scope / Out-of-scope

### In-scope
- #1 command injection in `uploadMedia` (server.ts:661-677)
- #2 path traversal in `downloadAndSaveMedia` filename + caller (server.ts:551, 1353-1356)
- #3 supply-chain lockfile + `--frozen-lockfile`
- #4 dead `if` block in `reply` outbound check + missing check in `react` (server.ts:1034-1041)
- #5 `reply.files` path validation (server.ts:1080)
- #15 permission relay body scrub + internal pattern hash (server.ts:809, 923, 929-930, 1308)
- #6 `activeTask` TTL (best-effort, cuttable)
- `package.json` version bump to `0.1.6`
- `CHANGELOG.md` security section
- README note on `bun install --no-frozen-lockfile` for intentional dep updates

### Out-of-scope
- [no-go] **Refactor server.ts into modules** — single-file is a deliberate architectural choice; refactoring during a security release multiplies review load.
- [no-go] **Change MCP protocol surface** — the `notifications/claude/channel/permission` reply contract is invariant.
- [no-go] **Restructure `access.json` schema** — out of scope for security release.
- [no-go] **Add new tools** (e.g., `whoami`, `transcribe`) — release is hotfix-only.
- [no-go] **Change `skills/`** — read-only consumers; no change needed.
- #7 webhook body cap → v0.2.0
- #8 hostname pin → v0.2.0
- #9 randomBytes for pairing codes → v0.2.0 (low severity)
- #10 pattern granularity → v0.2.x
- #11 pushName sanitization → v0.2.x
- #12 zod validate webhook payload → v0.2.0
- #13 dead code cleanup + PRIVACY.md gap → v0.2.x
- #14 tracking issue → close after release ships

---

## §11 Rabbit holes / hidden risks

### R1 — Bun's FormData against Graph API may have quirks (#1)
- **Category**: external integration
- **Per-consumer impact**: only `uploadMedia` call site (`server.ts:1083`) is `affects`.
- **Evidence (pre-bet)**: two-layer plan, both at PR1 review time (no deferral):
  1. **Fixture-based unit**: mock `fetch` and assert FormData parts (`messaging_product`, `file`, `type`) — proves the request-shape is correct independent of Graph behavior.
  2. **Manual probe**: PR1 author runs `bun server.ts` against Reinaldo's own production WhatsApp Business number (which the plugin already has via `ACCESS_TOKEN` + `PHONE_NUMBER_ID` env vars), uploads a 1-byte test `.txt` and a real `.ogg` voice note. PR description includes Graph response IDs as evidence. This is a self-test, not a sandbox — same operational pattern Reinaldo already uses to dogfood the plugin.
- **Fallback if Bun.FormData fails**: build multipart manually via `Buffer.concat` + boundary string. Either way, zero `child_process` — fix #1 is satisfied.
- **Layer (TPG)**: static (typecheck via existing CI) + unit (fixture) + manual probe

### R2 — `realpathSync` on not-yet-created path (#2)
- **Category**: file-system semantics
- **Per-consumer impact**: `downloadAndSaveMedia` (`server.ts:551`) is `affects`.
- **Evidence (pre-bet)**: `spikes/spike-realpath-nonexistent.ts` — confirms `realpathSync` throws `ENOENT` for non-existent paths but works on parent. Strategy: `realpathSync(MEDIA_DIR)` once at startup, then `path.resolve(realMediaDir, basename(filename))` and assert `startsWith(realMediaDir + path.sep)`. Status: **complete** (trivial, will be inline-validated).
- **Layer**: unit

### R3 — Phone-allowlist gate for `reply`/`react` is RIA-original (#4)
- **Category**: behavior regression + design-without-canonical
- **Per-consumer impact**: `reply` (`server.ts:1026`) and `react` are `affects`. Skills are `does-not-affect` (they call via MCP and handle `isError`).
- **Important**: contrary to round-1 framing, **neither telegram nor imessage has a phone-allowlist gate** for outbound. Telegram derives `chat_id` from update context (no free-form phone parameter); iMessage uses the chat the user is in. WhatsApp's `reply.chat_id: string` is free-form, so this is a **WhatsApp-specific surface** and the fix is RIA-original. PR comments on issue #4 should be amended to reflect this — the cross-reference to telegram L135-145 was incorrect (that's the file-path validator, not phone gate).
- **Design**: helper `assertSendablePhone(phone, mode: 'reply'|'react')` returns true if any of:
  - `normalizePhone(phone) === SELF_PHONE`
  - `access.allowFrom` includes phone
  - `lastInboundByChat` has a fresh entry for this phone (≤ 600s, aligned with the existing eviction at `server.ts:1437-1440`)
  
  Both `reply` and `react` use the same logic — no mode asymmetry. The recent-inbound allowance is the **explicit conversational intent** the original code at `server.ts:1034-1041` documented but never enforced. Strict-only would break the prospect-message flow (someone messages once, Claude can't react/reply without the operator pre-allowlisting).
- **Evidence (pre-bet)**: design captured in §16 PR3 done criteria with truth table. Manual probe deferred to PR3 review (Claude calls `reply` with non-allowlisted phone, observe `isError` surfaces gracefully). Tracking issue → file as GH issue with `type:follow-up`.
- **Layer**: unit + manual probe at PR review

### R4 — withdrawn
Round-1 audit determined the original R4 (`reply.files` allowlist breaks legitimate flows) was based on a misread of canonical pattern. New design (per #5 acceptance) blocks only `STATE_DIR` egress (with `MEDIA_DIR` carve-out) — accepts arbitrary user paths exactly as canonical does. No regression risk. R4 dropped.

### R5 — Natural-language body must be informative enough to decide (#15)
- **Category**: UX validation
- **Per-consumer impact**: Reinaldo (the permission approver) needs to understand what's being approved without seeing the raw command.
- **Evidence (pre-bet)**: design captured in §6 (sanitizer + render rules) + §16 PR4 done criteria. Manual probe at PR4 review covers the empirical question.
- **Status**: complete (design) — Reinaldo signed off on the approach in PR #16 review 2026-04-29.
- **Mitigation if `description` proves uninformative**: PR4 manual probe surfaces this. Fallbacks: augment renderer with a `tool_name`-specific decorator; loosen sanitizer to let non-secret flags through; ledger a follow-up to evolve renderer in v0.2.x without re-opening the leak.
- **Layer**: manual probe at PR4 review

### Anti-pattern lens (TPG)

- ✅ "All tests pass" with no integration proof — **applies**: this repo has no `bun:test` harness, only typecheck CI. Mitigation: each PR ships with manual probe documented in PR body + Graph response IDs (for PR1) or grep audit (for PR2/PR4). GH follow-up issue (`type:follow-up`, label `testing`): "establish bun:test harness for v0.2.x".
- ✅ Heavy mocks with no real dependency validation — **applies via R1**: PR1's fixture-based unit is mocks-only; mitigated by manual probe against Reinaldo's own number at PR review.
- ❌ No migration testing for schema changes — N/A, no schema change.
- ❌ No retry/idempotency proof — N/A, no new retries introduced.
- ✅ Live dependency in production without synthetic checks — **applies**: WhatsApp Cloud API is live; hash change in #15 means in-memory `sessionAllowPatterns` is invalidated on restart (one-time, documented in CHANGELOG). No synthetic check infra exists; out-of-scope to add for v0.1.6.
- ✅ Existing CI status — **CI exists** (`.github/workflows/ci.yml`: typecheck via `bunx tsc --noEmit`); green as of 2026-04-26. PR5 verifies post-lockfile-commit that `bun install --frozen-lockfile` actually enforces (today it tolerates missing lockfile silently, defeating the supply-chain protection it implies).

---

## §12 S-DROP-G

- **Security / AuthZ**: addressed. All 6 fixes are security work. AuthZ surface (`assertSendable`) becomes consistent across `reply` + `react`. Token leak (#1 argv) and secret leak (#15 pattern) closed. No new credentials introduced.
- **Data / Migration**: N/A — no schema or persisted data structure changes. **Justification**: `pendingPermissions` and `sessionAllowPatterns` are in-memory and reset every restart; storing hashes instead of patterns is a runtime change with no backfill.
- **Resilience / Rollback**: addressed. Each PR is revertable via `git revert <sha>`. Hard-cutover (no compat path) means rollback = revert + re-tag. **Kill switch**: none required — the fixes don't add hot paths or external integrations beyond what already exists.
- **Observability**: addressed. Outcome metric: GitHub Releases tag `v0.1.6` exists + 6 issues closed. Per-fix evidence in CHANGELOG + PR descriptions. **No new metrics or dashboards** (this plugin emits structured logs to stderr; sufficient for hotfix release). **Logs**: all `log()` calls already structured; PR4 must verify `log()` of permission-relay events does not contain pattern/input_preview literals.
- **Platform / Infra**: addressed. No new env vars except optional `WHATSAPP_FILE_ALLOWLIST` (R4). No new infra. Deploy = restart plugin (Bun process). No orchestration impact.
- **Governance / Ownership**: addressed. Owner = Reinaldo (repo owner). Luo = drafter. **Kill-the-bet view**: yes — Reinaldo can choose to ship v0.1.5 to a private/RIA-only marketplace and skip the marketplace gate. That kills v0.1.6 as a public release MF but the fixes still belong in `main`. Recorded as a valid `no-bet` outcome on the *public-marketplace* axis.

---

## §13 Cutover decision

### Triggers hit: **none**

- Updating consumers fits appetite: ✓ (only consumer per surface is the plugin itself; skills are read-only).
- All consumers internal: ✓ (no external owners — this is a single-team repo).
- No frozen/legacy area touched.
- Atomic completion generates 0 successor MFs (the v0.2.0/v0.2.x work is independent, not a continuation of cutover).
- No unavoidable compat path: each fix is hard-cutover, no flags, no dual-write.

### Decision: **A (narrow fits)**

Each PR is its own atomic cutover within the release. The release itself is one cutover (v0.1.5 → v0.1.6).

**Justification**: hotfixes don't have compat paths by definition. There's no "v1 vs v2" runtime branching — the old vulnerable code is replaced and gone. The only "compat" concern is the one-time invalidation of `sessionAllowPatterns` on restart (R5 anti-pattern lens), which is documented in CHANGELOG and is operationally trivial (user re-approves "Always" once after upgrade).

No ADR required. No ledger entry for cutover.

---

## §14 Pair shaping

- **Triggered**: yes (security/privacy implication; appetite ≥ 1 week)
- **Triggers matched**: security/privacy/compliance implication; appetite = 1w
- **Decision**: async — Reinaldo reviews PRs sequentially, Luo drafts and addresses comments. Synchronous pair shaping not required because the design space is already constrained by canonical Anthropic patterns and the cross-reference comments on each issue.
- **Key decisions documented**: see §6 acceptance criteria + §11 mitigations.

---

## §15 Breadboard

Hot paths affected by this release:

```
┌─ inbound webhook ───┐
│                     │
│  WhatsApp →         │
│  verifyHmac →       │
│  parseMsg →         │
│  downloadAndSaveMedia ──[#2 sanitize filename]── notify Claude
│                     │
└─────────────────────┘

┌─ Claude tool calls ─┐
│                     │
│  reply ──[#4 assertSendable] ──[#5 validate files]── sendText/uploadMedia ──[#1 fetch+FormData]──→ Graph API
│  react ──[#4 assertSendable] ─────────────────────── sendReaction
│                     │
└─────────────────────┘

┌─ permission relay ──┐
│                     │
│  Claude → permission_request → renderBody ──[#15 drop pattern+input_preview]──→ WhatsApp
│  WhatsApp → button → permission reply ──[#15 hash internally]──→ sessionAllowPatterns
│                     │
└─────────────────────┘

┌─ install / start ───┐
│                     │
│  bun install --frozen-lockfile [#3]  ──→  bun server.ts
│                     │
└─────────────────────┘

┌─ activeTask (#6, opt) ┐
│                       │
│  inbound → set activeTask  ──[TTL 5min]──→ permission attribution
│                       │
└───────────────────────┘
```

What changes vs current:
- `uploadMedia` body replaced; same call signature (`filePath`, `mimeType`).
- `downloadAndSaveMedia` filename sanitized at line 551.
- `reply` and `react` gain `assertSendable` at handler entry; `reply` also validates `files`.
- `permissionPattern` output still computed for internal hashing; not surfaced in body.
- `package.json` start command + `.gitignore` change.

Affordances added: none user-facing. The WhatsApp permission body becomes slightly shorter and less informative (intentional).

---

## §16 Build scopes

### PR5 — `bun.lock` + `--frozen-lockfile` enforcement (#3)

- **Objective**: deterministic install on every plugin start AND in CI; lockfile under VCS; verify enforcement is active (today CI tolerates missing lockfile silently).
- **Files**: `.gitignore`, `package.json`, new `bun.lock` (committed), `.github/workflows/ci.yml` (verify it actually fails on lockfile drift), `README.md` ("Updating dependencies" section).
- **Dependencies**: none (first PR).
- **Risk focus**: enforcement verification (currently green CI is misleading — `--frozen-lockfile` without committed lockfile is no-op).
- **Done criteria**:
  - `bun.lock` removed from `.gitignore` and committed.
  - `package.json` start = `"bun install --frozen-lockfile --no-summary && bun server.ts"`.
  - Clean clone + `bun install --frozen-lockfile` succeeds and produces zero lockfile diff.
  - **Enforcement probe** (in PR description): intentionally bump a caret-ranged dep in `package.json` *without* updating `bun.lock`, push to a throwaway branch, observe CI fail with frozen-lockfile mismatch error. Revert the test bump before merge. Proves the CI guard actually works post-commit.
  - README "Updating dependencies" section: explains `bun update` then commit `bun.lock`.
- **change_type**: `other` (config/build/CI)
- **required_test_layers**: `[static]` (typecheck) + enforcement probe documented above
- **evidence_plan**: clean-clone test + enforcement probe; both captured in PR description.
- **deferred_layers**: none
- **V1**: yes (must be first — un-breaks the supply-chain guard CI claims to provide)

### PR1 — uploadMedia rewrite (#1)

- **Objective**: remove `child_process` from `uploadMedia`; use `fetch` + `FormData`.
- **Files**: `server.ts:661-677`.
- **Dependencies**: PR5 merged (so CI/install is reproducible during review).
- **Risk focus**: R1 (Bun FormData against Graph API).
- **Done criteria**:
  - No `import('child_process')` anywhere in the file (grep: `child_process` returns 0 hits).
  - `uploadMedia` uses `fetch(${GRAPH_API}/${PHONE_NUMBER_ID}/media, { method: 'POST', headers: { Authorization: 'Bearer ' + ACCESS_TOKEN }, body: formData })`.
  - Returns same shape: `{ id }` or throws.
  - Manual probe: upload an `.ogg` and a `.pdf` succeeds; `ps -ef` during upload shows no `curl` invocation.
- **change_type**: `new-integration` (replacing existing)
- **required_test_layers**: `[static, unit, contract]`
- **evidence_plan**:
  - static: typecheck passes
  - unit: mock `fetch`, assert FormData shape contains `messaging_product`, `file`, `type` parts
  - contract: spike-bun-formdata-graph against sandbox or recorded fixture
- **deferred_layers**: contract may be `manual probe` if no sandbox token (see R1 / FU-2026-100)
- **V1**: yes

### PR2 — filename sanitization (#2)

- **Objective**: prevent path traversal via WhatsApp document filename.
- **Files**: `server.ts:551` (sanitize at boundary), `server.ts:1353-1356` (fallback name extraction).
- **Dependencies**: PR5 merged.
- **Risk focus**: R2 (realpath semantics).
- **Done criteria**:
  - At module load, **after** `mkdirSync(MEDIA_DIR, ...)` at `server.ts:193`, add `const REAL_MEDIA_DIR = realpathSync(MEDIA_DIR)`. Placement order matters — `realpathSync` on a non-existent dir throws `ENOENT`; the existing `mkdirSync(..., { recursive: true })` at L193 guarantees the dir exists before this call.
  - In `downloadAndSaveMedia`: `const safe = path.basename(filename)`; if `safe` empty or starts with `.` only or contains null byte → fallback to `${mediaId}.${ext}`.
  - `const filePath = path.join(REAL_MEDIA_DIR, safe)`; assert `path.resolve(filePath).startsWith(REAL_MEDIA_DIR + path.sep)` else throw.
  - Inbound handler: same sanitization applied to `fallbackName` regex extraction at L1353-1356.
- **change_type**: `new-rule`
- **required_test_layers**: `[static, unit]`
- **evidence_plan**:
  - unit: filename `../../etc/passwd`, `/tmp/x`, `\0foo`, `..`, ` ` (whitespace), unicode, normal — all classified correctly.
- **deferred_layers**: none
- **V1**: yes

### PR3 — outbound gates: phone (#4) + file path (#5)

- **Objective**: gate outbound at the tool-handler boundary on two axes — destination phone and file path.
- **Files**: `server.ts` (handler switch — locate `reply` and `react`); add `assertSendablePhone(phone)` (RIA-original) and `assertSendable(f)` (canonical-aligned with `tg.ts:135-145`).
- **Dependencies**: PR5 merged. Independent of PR1/PR2 (different code paths).
- **Risk focus**: R3.
- **Done criteria**:
  - **Phone gate (`assertSendablePhone`)** — used by both `reply` and `react`, no mode asymmetry. Throws `Error("not in outbound allowlist: ${phone}")` unless any of:
    - `normalizePhone(phone) === SELF_PHONE`
    - `access.allowFrom` includes `normalizePhone(phone)`
    - `lastInboundByChat` has entry for the chat-id with `ts` within **600s** (aligned with the existing eviction window at `server.ts:1437-1440`)
  - **File gate (`assertSendable`)** — canonical-aligned, used by `reply.files` only. Throws `Error("refusing to send channel state: ${f}")` if `realpathSync(f).startsWith(realpathSync(STATE_DIR) + sep)` AND **not** under `realpathSync(MEDIA_DIR) + sep` (carve-out for legitimate inbound-media re-forwarding). Non-existent paths or symlink errors → `try/catch return` (matches canonical) — `statSync` later in the upload flow will surface a real error.
  - Both gates throw at handler entry; error becomes `{ content: [{type:'text', text: err.message}], isError: true }`.
  - The dead `if` block at `server.ts:1034-1041` is removed (replaced by `assertSendablePhone`); single-path gate satisfied.
- **change_type**: `new-rule`
- **required_test_layers**: `[static, unit, manual probe]`
- **evidence_plan**:
  - static: typecheck via existing CI.
  - unit (fixture-based, runnable manually until `bun:test` harness exists): `assertSendablePhone` truth table (4 cases: self / allowFrom / recent-inbound / none); `assertSendable(f)` cases (`~/.ssh/id_ed25519`, `${STATE_DIR}/access.json`, `${MEDIA_DIR}/foo.pdf`, `/tmp/x`, symlink → STATE_DIR escape).
  - manual probe at PR review: Claude session sends `reply` to non-allowlisted phone; observe `isError` surfaces gracefully without plugin lockup.
- **deferred_layers**: none (was integration; downgraded to manual probe at PR review)
- **V1**: yes

### PR4 — permission body: natural-language render + secret sanitizer (#15)

- **Objective**: stop leaking `input_preview` slice and `pattern` literal in WhatsApp body; render a human-readable description and sanitize any residual secrets at render time. Keep 3 buttons (Allow / Always / Cancelar) — UX preserved.
- **Files**: `server.ts:889-960` (relay handler — replace body construction), `server.ts:806` (`pendingPermissions` value type — drop pattern field), new helpers `renderPermissionBody()` and `sanitizeSecrets()`.
- **Dependencies**: PR5 merged. Independent of PR1-3.
- **Risk focus**: R5 (UX validation — Reinaldo confirms natural-language body is informative enough to make Allow/Always decisions).
- **Done criteria**:
  - **Body construction** (`renderPermissionBody({ tool_name, description, ... })`):
    - Drop `input_preview` from body entirely (no Bash carve-out, no preview slice).
    - Drop `pattern` literal from body (the "Always" line says `🔁 *Always* = auto-approve este tipo de solicitação`, no pattern).
    - Render `description` as the primary user-facing text. `description` comes from MCP permission_request schema (`server.ts:884`), generated by Claude per the protocol — meant to be human-readable.
    - Apply `sanitizeSecrets(text)` to the assembled body before sending.
  - **Sanitizer (`sanitizeSecrets(text: string): string`)**:
    - Regex-based replace; full match → `***`.
    - Patterns (initial set): `sk_(live|test)_[\w]+`, `pk_[\w]+`, `xoxb-[\w-]+`, `ghp_[\w]+`, `gho_[\w]+`, `github_pat_[\w]+`, `Bearer\s+[\w.-]+`, `AKIA[0-9A-Z]{16}`, `[A-Z][A-Z0-9_]+=["']?[^"'\s]{8,}["']?`, `[A-Za-z0-9+/=_-]{32,}` (high-entropy), `\d{3}\.\d{3}\.\d{3}-\d{2}` (CPF), `\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}` (CNPJ).
    - Order matters: structured patterns first (specific tokens), high-entropy generic last (catches the rest without over-masking).
  - **`pendingPermissions` value**: `{ tool_name, description }` — drop `pattern` (no longer flows to body, only used internally during permissionPattern() compute).
  - **`sessionAllowPatterns`**: stays as `Set<string>` of plain pattern strings. No hashing needed (patterns never cross WhatsApp surface in this design). Round-1 hashing-as-mitigation collapsed.
  - **"Always" ack**: `🔁 ${request_id}` — no pattern echoed (unchanged from current behavior in this regard, just removing the `(${pending.pattern})` suffix at `server.ts:1309`).
  - **Grep audit (in PR description)**: `rg 'input_preview' server.ts` output shows zero occurrences flowing to outbound `sendInteractiveButtons`/`sendText`. `rg 'pattern' server.ts` output shows pattern only in `permissionPattern()` compute, `pendingPermissions.set/get` for `permAction === 'always'` lookup at `server.ts:1306`, and `sessionAllowPatterns.has/add` — none reach body.
- **change_type**: `new-rule`
- **required_test_layers**: `[static, unit, manual probe]`
- **evidence_plan**:
  - static: typecheck via existing CI.
  - unit (fixture script in PR body): `sanitizeSecrets` truth table covering each pattern + a "no false positive on normal text" check. Assert body rendering for a Bash request with `description = "Run sed -i to update STRIPE_KEY=sk_live_xxx in config"` produces a body with no occurrence of `sk_live` or `STRIPE_KEY=sk_live`.
  - manual probe at PR review: Reinaldo triggers a few representative permission requests (Bash git, Bash curl with secret env, Edit, Write) and confirms the rendered bodies are (a) informative enough to decide Allow vs Cancelar without seeing the raw command, (b) leak-free.
- **deferred_layers**: none
- **V1**: yes

### R6 — withdrawn
Round-1 audit added R6 (3-button limit) under the assumption PR4 needed a 4th "Show" affordance. Reinaldo's revised direction keeps 3 buttons (Allow / Always / Cancelar) and replaces the body content instead — no list-message needed, no Show button. Constraint no longer applies.

### PR6 — `activeTask` TTL (#6)

- **Objective**: prevent permission misattribution by expiring `activeTask` after 5 min.
- **Files**: `server.ts:1429-1435` (set `expiresAt`), `server.ts:912-919` (check expiry before reading), small `setInterval` for cleanup.
- **Dependencies**: PR5 merged.
- **Risk focus**: low.
- **Done criteria**:
  - `activeTask = { ..., expiresAt: Date.now() + 300_000 }`.
  - Read sites check `if (activeTask && activeTask.expiresAt > Date.now())`; expired → treat as "Internal work".
  - Cleanup `setInterval` clears expired entry every 60s.
- **change_type**: `new-rule`
- **required_test_layers**: `[static, unit]`
- **evidence_plan**: unit with frozen clock.
- **deferred_layers**: none
- **V1**: **no** — first cut if circuit breaker fires.

---

## §17 Gate verification (pre-bet)

- **SSOT**: pass — N/A in this repo (single-file, no shared package). Touched surfaces are local types in `server.ts`; consumers (skills) read via MCP not import.
- **Single path**: pass — every fix replaces the vulnerable code; no flags, no dual-write, no v1/v2 branching. Cutover decision §13 = A.
- **Type safety**: pass — no `any` introduced; `unknown` only in webhook JSON parse where it already lives + zod-validated downstream (out-of-scope for v0.1.6 per #12). Existing `as any` casts at `server.ts:540, 655, 674, 701` are pre-existing and out of scope (#13).
- **S-DROP-G**: all 6 dimensions decided in §12 — yes.
- **Monorepo scan**: every consumer mapped in §5 — yes.
- **Cutover decision**: recorded in §13 as A — yes.
- **Evidence-backed**: yes — R1 has fixture + manual probe (no deferral); R2 inline-validated; R3 design + manual probe at PR review; R4 withdrawn (canonical analysis dropped the original concern); R5 design decision; R6 PR4 manual probe at review.
- **Test matrix**: each scope has change_type + required_test_layers + evidence_plan. Layer claims are consistent with available infra: `static` = existing CI typecheck; `unit` = fixture-based scripts in PR body (no `bun:test` harness yet — GH follow-up issue tracks this for v0.2.x); `manual probe` = PR review checklist.
- **Follow-up tracking**: GH Issues with label `type:follow-up` (no separate ledger file). Round-1 follow-ups to file: (a) "establish bun:test harness for v0.2.x", (b) PR3 review probe (Claude session with non-allowlisted phone), (c) PR1 manual probe (Reinaldo's number self-test).

**All gates pass.**

---

## §18 Bet

- **Decision**: **go**.
- **Reason**: Reinaldo approved the bet via PR #16 review on 2026-04-29, with one design redirection on #15 (replace options C/D with: keep 3 buttons, transform body to natural language, sanitize secrets at render time). All other 5 PRs proceed as planned. Probe path for PR1 confirmed (+55 61 98559-8585).
- **Approver**: Reinaldo (repo owner) via comment on `riasistemas/claude-channel-whatsapp#16`.
- **Timestamp**: 2026-04-29.
- **shaping_commit_sha**: to be recorded at commit of the post-approval revisions (this edit + the §6/§16/§11 PR4 updates reflecting the new direction).

### Context payload

- **Blast radius**:
  - Consumers touched: 1 (the plugin itself; skills read-only)
  - Services touched: 1
  - Tenants affected: every downstream install of the plugin (post-marketplace)
  - SSOT-package change: no (no SSOT package in this repo)
- **Risk class**: **high**
  - Reason: pre-distribution security work; authZ surface change in #4; integration with external WhatsApp Cloud API in PR1.
- **S-DROP-G summary**:
  - S: addressed — entire release is security work
  - D: N/A — no schema change
  - R: addressed — revert-and-retag rollback
  - O: GitHub Releases tag + 6 closed issues + CHANGELOG
  - P: addressed — no infra change
  - G: owner = Reinaldo
- **Appetite**: 1w; circuit breaker = drop PR6, then slip release to v0.1.7-rc1 (verbatim §9)
- **Pair shaping**: async (per §14)
- **Cutover decision**: A (narrow fits) (per §13)
- **PR sequence**: PR5 → PR1 → PR2 → PR3 → PR4 → PR6 (confirmed by Reinaldo)
- **PR1 probe target**: +55 61 98559-8585 (Reinaldo's WhatsApp Business)

---

## §19–25

Pending `/build` (post-bet). Will be filled by `/build` and `/tl` skills.

---

## Reinaldo's decisions (PR #16 review 2026-04-29)

1. **Go-ahead** — bet = `go`; sequence confirmed: PR5 → PR1 → PR2 → PR3 → PR4 → PR6.
2. **#15 redesign** — discard options (C) and (D); keep 3 buttons (Allow / Always / Cancelar), transform body to natural-language description + secret sanitizer at render time. Rationale: 3-button limit is hard, "Always" is premise not optional, Deny ≡ Cancelar. Codified in §6 and §16 PR4.
3. **PR1 probe target** confirmed: +55 61 98559-8585.
4. **Labels & milestone**: Reinaldo to create or delegate to repo admin team. PRs can land without them initially (will be tagged retroactively).
5. **PR6 priority**: keep optional in V1 (cuttable per §9 circuit breaker).
6. **PR comment amendment on issue #4**: deferred — non-blocking; can be addressed during PR3 review if useful, otherwise left as-is.
