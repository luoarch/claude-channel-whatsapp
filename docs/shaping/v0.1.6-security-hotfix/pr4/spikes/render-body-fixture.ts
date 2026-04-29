/**
 * Spike: validate the render-body + sanitizer pipeline for PR4 (#15).
 * Exercises the production rules from sub-shape §6 against a worst-case
 * Bash request whose input_preview contains a Stripe live key.
 *
 * The helpers below mirror the production design that will land in
 * server.ts. This spike fails-as-a-unit if any contract is violated.
 */

// ── Sanitizer (mirrors production design from §6) ──────────────────────

const PATTERNS: Array<[RegExp, string | ((m: string) => string)]> = [
  [/sk_live_[A-Za-z0-9_]+/g, '***'],
  [/sk_test_[A-Za-z0-9_]+/g, '***'],
  [/pk_(live|test)_[A-Za-z0-9_]+/g, '***'],
  [/xox[baprs]-[A-Za-z0-9-]+/g, '***'],
  [/(ghp_|gho_|github_pat_)[A-Za-z0-9_]+/g, '***'],
  [/AKIA[0-9A-Z]{16}/g, '***'],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***'],
  [/sk-(ant-)?[A-Za-z0-9_-]{20,}/g, '***'],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '***'],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '***'],
  [/\b[A-Z][A-Z0-9_]*=("[^"]{8,}"|'[^']{8,}'|[^\s'"`;&|]{8,})/g, (m) => m.split('=')[0] + '=***'],
  [/\b[A-Za-z0-9+/=_-]{32,}\b/g, '***'],
]

function sanitizeSecrets(text: string): string {
  let out = text
  for (const [re, replacer] of PATTERNS) {
    out = typeof replacer === 'string'
      ? out.replace(re, replacer)
      : out.replace(re, replacer)
  }
  return out
}

// ── Render (mirrors production design from §6) ─────────────────────────

interface RenderInput {
  request_id: string
  tool_name: string
  description: string
  contextLine: string
}

function renderPermissionBody(p: RenderInput): string {
  const body =
    `🔐 *Permission required*\n\n` +
    p.contextLine +
    `🛠  *${p.tool_name}*\n` +
    `📝 ${p.description}\n\n` +
    `🔁 *Always* = auto-approve este tipo de solicitação\n` +
    `_ID: ${p.request_id}_`
  const trimmed = body.length > 1020 ? body.slice(0, 1017) + '...' : body
  return sanitizeSecrets(trimmed)
}

// ── Tests ──────────────────────────────────────────────────────────────

type Assert = { name: string; check: boolean }
const asserts: Assert[] = []

function expect(name: string, check: boolean) {
  asserts.push({ name, check })
}

// Worst-case Bash request: description references a secret env var,
// input_preview (the JSON tool_input) carries the actual token.
const worstCase: RenderInput = {
  request_id: 'abcde',
  tool_name: 'Bash',
  description: 'Run sed -i to update STRIPE_KEY=sk_live_xyz123abc456def789ghi in .env',
  contextLine: '👤 During conversation with *+5561985598585*\n_Task: wa_123_\n\n',
}

const body = renderPermissionBody(worstCase)
console.log('--- Rendered body (worst case):')
console.log(body)
console.log('---')

// Done-criteria assertions from sub-shape §16
expect('R-1: body has no occurrence of "input_preview"', !body.includes('input_preview'))
expect('R-1: body has no occurrence of "tool_input"', !body.includes('tool_input'))
expect('R-2: body has no Bash:* pattern literal', !/Bash:[A-Za-z]/.test(body))
expect('R-2: "Always" line is the generic phrase', body.includes('🔁 *Always* = auto-approve este tipo de solicitação'))
expect('R-3: sk_live token is masked', !body.includes('sk_live_xyz123abc456def789ghi'))
expect('R-3: STRIPE_KEY assignment value is masked (env-var regex)', !/STRIPE_KEY=sk_live/.test(body))
expect('Body still has tool_name decorator', body.includes('🛠  *Bash*'))
expect('Body still has contextLine', body.includes('During conversation with *+5561985598585*'))
expect('Body still has request_id (for user reference)', body.includes('abcde'))
expect('Body still has the description with secret masked', body.includes('Run sed -i to update STRIPE_KEY='))
expect('Body length within Cloud API 1024 limit', body.length <= 1024)

// Coverage of all sanitizer pattern families on a synthetic body
const allPatterns = renderPermissionBody({
  request_id: 'xyzab',
  tool_name: 'Bash',
  description: [
    'STRIPE_KEY="sk_live_xyz123abc"',
    'GITHUB_TOKEN=ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyJ9.abcdef',
    'aws_access_key_id=AKIAIOSFODNN7EXAMPLE',
    'Anthropic key sk-ant-api03-LqXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    'Slack xoxb-1234-5678-abcdef-something',
    'CPF 123.456.789-00',
    'CNPJ 12.345.678/0001-90',
    'random base64 bGFyZ2VfYmFzZTY0X2VuY29kZWRfc2VjcmV0X2RhdGE=',
  ].join(' / '),
  contextLine: '⚙️ _Internal work_\n\n',
})

for (const leak of [
  'sk_live_xyz123abc',
  'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
  'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMyJ9.abcdef',
  'AKIAIOSFODNN7EXAMPLE',
  'sk-ant-api03-LqXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'xoxb-1234-5678-abcdef-something',
  '123.456.789-00',
  '12.345.678/0001-90',
  'bGFyZ2VfYmFzZTY0X2VuY29kZWRfc2VjcmV0X2RhdGE',
]) {
  expect(`Sanitizer masks ${leak.slice(0, 24)}...`, !allPatterns.includes(leak))
}

// Negative: a benign Bash command renders normally
const benign = renderPermissionBody({
  request_id: 'qwert',
  tool_name: 'Bash',
  description: 'Run git status to see local changes',
  contextLine: '⚙️ _Internal work_\n\n',
})
expect('Benign body unchanged by sanitizer', benign.includes('git status') && !benign.includes('***'))

// Print results
let pass = 0, fail = 0
for (const { name, check } of asserts) {
  console.log(`${check ? 'PASS' : 'FAIL'}  ${name}`)
  if (check) pass++; else fail++
}
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail > 0 ? 1 : 0)
