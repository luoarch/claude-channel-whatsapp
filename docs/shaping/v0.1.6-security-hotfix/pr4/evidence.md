# Evidence — PR4 (#15)

## Risk → Evidence map

### R-PR4-1: Sanitizer over-masking benign content
- Category: regression / UX
- Layer: unit fixture
- Evidence type: spike script `spikes/sanitize-fixture.ts`
- Status: **complete (designed)** — script ships with the PR
- Negative cases (must come through unchanged or with minimal change):
  - `git status` → `git status`
  - `rm -rf /tmp/foo` → `rm -rf /tmp/foo`
  - `sed -i 's/old/new/' file.txt` → `sed -i 's/old/new/' file.txt`
  - `Run npm install in apps/api` → unchanged
  - `RUN=1 bun test` → unchanged (env-var value <8 chars, doesn't trigger)

### R-PR4-2: Sanitizer under-masking known threats
- Category: security
- Layer: unit fixture
- Evidence type: spike script `spikes/sanitize-fixture.ts`
- Status: **complete (designed)** — script ships with the PR
- Positive cases (must be fully `***`-masked):

| Input | Pattern | Why it must be caught |
|---|---|---|
| `STRIPE_KEY="sk_live_xyz123abc456def789"` | env-var + Stripe-live | the headline case from #15 |
| `export GITHUB_TOKEN=ghp_aBcDeFgHiJkLmNoP1234567890qrstuvwx` | env-var + GitHub | env-var with token value |
| `Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyJ9.abc` | Bearer | JWT-shaped bearer |
| `aws_access_key_id=AKIAIOSFODNN7EXAMPLE` | AWS | AWS key shape |
| `pk_test_TYooMQauvdEDq54NiTphI7jx` | Stripe-public | |
| `sk-ant-api03-Lq...long...token` | OpenAI/Anthropic | Anthropic API key shape |
| `xoxb-1234-5678-abcdef` | Slack bot | |
| `123.456.789-00` | CPF | Brazilian PII |
| `12.345.678/0001-90` | CNPJ | Brazilian PII |
| `bGFyZ2VfYmFzZTY0X2VuY29kZWRfc2VjcmV0X2RhdGE=` | high-entropy | base64 ≥32 chars (catch-all) |
| `password: hunter2supersecretpassword` | env-var-style | non-uppercase env-var → high-entropy fallback catches `hunter2supersecretpassword` if ≥32, else not — note: 26 chars; **expected: not caught by either regex**; documented as known limitation |
| `SECRET_TOKEN='abc123XYZ_long_value_12345'` | env-var | regex requires uppercase + underscore + ≥8 chars value |

The "password: hunter2..." case is documented as a known limitation: lowercase keys with short values miss both regexes. Acceptable trade-off for v0.1.6; future MF could add `(?i)pass(word)?\s*[:=]` heuristic.

### R-PR4-3: `description` informativeness
- Category: UX
- Layer: manual probe at PR4 review
- Status: deferred to live probe (parent FU-2026-101 covers)

### R-PR4-4: Body length post-sanitizer
- Category: integration constraint
- Layer: math + assertion
- Status: **complete** — sanitizer monotonically shortens or holds steady; existing trim at L932 protects the 1020-char invariant either way.

## TPG anti-pattern lens
- "All tests pass" with no real integration proof: applies; mitigated by Reinaldo's manual probe at review.
- Live dependency without synthetic check: applies; same mitigation as parent.

## Follow-up issues to file (post-PR4)
1. Address `password: hunter2...`-style lowercase secrets in v0.2.x sanitizer evolution.
2. Consider per-tool renderer if R-PR4-3 manual probe finds class of tool calls ambiguous.
