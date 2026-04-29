/**
 * Spike: validate the sanitizeSecrets design proposed in PR4 shaping.md §6.
 * Runnable with `bun run sanitize-fixture.ts`. Exits 0 on all-pass.
 *
 * This is exploratory — it proves the regex set works before /build writes
 * the production helper. The shape locks the regex order and patterns; build
 * may keep this verbatim or rewrite it as proper `bun:test`.
 */

const PATTERNS: Array<[RegExp, string]> = [
  // Specific token shapes (highest priority — match before env-var/high-entropy)
  [/sk_live_[A-Za-z0-9_]+/g, '***'],
  [/sk_test_[A-Za-z0-9_]+/g, '***'],
  [/pk_(live|test)_[A-Za-z0-9_]+/g, '***'],
  [/xox[baprs]-[A-Za-z0-9-]+/g, '***'],
  [/(ghp_|gho_|github_pat_)[A-Za-z0-9_]+/g, '***'],
  [/AKIA[0-9A-Z]{16}/g, '***'],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***'],
  [/sk-(ant-)?[A-Za-z0-9_-]{20,}/g, '***'],

  // Brazilian PII
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '***'],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '***'],

  // Env-var assignments (uppercase key + value ≥8 chars)
  [/\b[A-Z][A-Z0-9_]*=("[^"]{8,}"|'[^']{8,}'|[^\s'"`;&|]{8,})/g, (m: string) => m.split('=')[0] + '=***'],

  // High-entropy fallback (≥32 alphanumeric/+/=/_/-)
  [/\b[A-Za-z0-9+/=_-]{32,}\b/g, '***'],
]

function sanitizeSecrets(text: string): string {
  let out = text
  for (const [re, replacer] of PATTERNS) {
    if (typeof replacer === 'string') {
      out = out.replace(re, replacer)
    } else {
      out = out.replace(re, replacer as (m: string) => string)
    }
  }
  return out
}

type Case = { name: string; input: string; expectMasked: string[]; expectKept?: string[] }

const POSITIVE: Case[] = [
  { name: 'Stripe live in env-var', input: 'STRIPE_KEY="sk_live_xyz123abc456def789"', expectMasked: ['sk_live_xyz123abc456def789', 'STRIPE_KEY="sk_live_xyz123abc456def789"'] },
  { name: 'GitHub PAT in env-var', input: 'export GITHUB_TOKEN=ghp_aBcDeFgHiJkLmNoP1234567890qrstuvwx', expectMasked: ['ghp_aBcDeFgHiJkLmNoP1234567890qrstuvwx'] },
  { name: 'Bearer JWT', input: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyJ9.abcdef', expectMasked: ['eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyJ9.abcdef'] },
  { name: 'AWS key', input: 'aws_access_key_id=AKIAIOSFODNN7EXAMPLE', expectMasked: ['AKIAIOSFODNN7EXAMPLE'] },
  { name: 'Stripe public', input: 'pk_test_TYooMQauvdEDq54NiTphI7jx', expectMasked: ['pk_test_TYooMQauvdEDq54NiTphI7jx'] },
  { name: 'Anthropic API key', input: 'ANTHROPIC_API_KEY=sk-ant-api03-LqXXXXXXXXXXXXXXXXXXXXXXXXXXXX', expectMasked: ['sk-ant-api03-LqXXXXXXXXXXXXXXXXXXXXXXXXXXXX'] },
  { name: 'Slack bot token', input: 'token: xoxb-1234-5678-abcdef-something', expectMasked: ['xoxb-1234-5678-abcdef-something'] },
  { name: 'CPF', input: 'CPF do cliente: 123.456.789-00', expectMasked: ['123.456.789-00'] },
  { name: 'CNPJ', input: 'CNPJ: 12.345.678/0001-90', expectMasked: ['12.345.678/0001-90'] },
  { name: 'High-entropy base64', input: 'token: bGFyZ2VfYmFzZTY0X2VuY29kZWRfc2VjcmV0X2RhdGE=', expectMasked: ['bGFyZ2VfYmFzZTY0X2VuY29kZWRfc2VjcmV0X2RhdGE'] },
  { name: 'Generic env-var with value ≥8', input: "SECRET_TOKEN='abc123XYZ_long_value_12345'", expectMasked: ["SECRET_TOKEN='abc123XYZ_long_value_12345'"] },
  { name: 'env-var unquoted long', input: 'API_KEY=somethingsupersecret', expectMasked: ['somethingsupersecret'] },
]

const NEGATIVE: Case[] = [
  { name: 'plain git command', input: 'git status', expectMasked: [], expectKept: ['git status'] },
  { name: 'plain rm command', input: 'rm -rf /tmp/foo', expectMasked: [], expectKept: ['rm -rf /tmp/foo'] },
  { name: 'sed inline edit', input: "sed -i 's/old/new/' file.txt", expectMasked: [], expectKept: ["sed -i 's/old/new/'"] },
  { name: 'instruction prose', input: 'Run npm install in apps/api', expectMasked: [], expectKept: ['Run npm install in apps/api'] },
  { name: 'short env-var (RUN=1)', input: 'RUN=1 bun test', expectMasked: [], expectKept: ['RUN=1 bun test'] },
  { name: 'short hex', input: 'commit abc123def456', expectMasked: [], expectKept: ['commit abc123def456'] },
]

let pass = 0, fail = 0

console.log('=== POSITIVE (must be masked) ===')
for (const c of POSITIVE) {
  const out = sanitizeSecrets(c.input)
  const allMasked = c.expectMasked.every((s) => !out.includes(s))
  console.log(`${allMasked ? 'PASS' : 'FAIL'}  ${c.name.padEnd(38)}  ${c.input}  →  ${out}`)
  if (allMasked) pass++; else fail++
}

console.log('\n=== NEGATIVE (must NOT be masked) ===')
for (const c of NEGATIVE) {
  const out = sanitizeSecrets(c.input)
  const noMaskApplied = !out.includes('***')
  const keptAllExpected = (c.expectKept ?? []).every((s) => out.includes(s))
  const ok = noMaskApplied && keptAllExpected
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(38)}  ${c.input}  →  ${out}`)
  if (ok) pass++; else fail++
}

console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail > 0 ? 1 : 0)
