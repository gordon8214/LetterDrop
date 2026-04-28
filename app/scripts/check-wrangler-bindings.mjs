import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { forbiddenPatterns, requiredBindings } from './wrangler-definitions.mjs'

const wranglerFile = resolve(process.cwd(), 'wrangler.toml')

if (!existsSync(wranglerFile)) {
  console.error(
    'wrangler.toml not found. Copy the template first:\n' +
    '  cp wrangler.example.toml wrangler.toml'
  )
  process.exit(1)
}

const content = readFileSync(wranglerFile, 'utf8')
const lines = content.split('\n')

const missing = []
const violations = []

for (const { key, label } of requiredBindings) {
  if (!content.includes(key)) {
    missing.push(label)
  }
}

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

if (missing.length > 0) {
  console.error('app/wrangler.toml is missing required bindings:')
  for (const label of missing) {
    console.error(`  - ${label}`)
  }
  process.exit(1)
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
