import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const wranglerFile = resolve(process.cwd(), 'wrangler.toml')
const content = readFileSync(wranglerFile, 'utf8')
const lines = content.split('\n')

const forbiddenPatterns = [
  'replace-with-',
  '00000000000000000000000000000000',
  '00000000-0000-0000-0000-000000000000',
]

const violations = []

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index]
  for (const pattern of forbiddenPatterns) {
    if (line.includes(pattern)) {
      violations.push({
        lineNumber: index + 1,
        line,
        pattern,
      })
    }
  }
}

if (violations.length > 0) {
  console.error('Found placeholder bindings in app/wrangler.toml:')
  for (const violation of violations) {
    console.error(
      `  line ${violation.lineNumber}: contains "${violation.pattern}" -> ${violation.line.trim()}`
    )
  }
  process.exit(1)
}

console.log('app/wrangler.toml bindings look deploy-safe.')
