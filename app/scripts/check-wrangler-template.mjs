import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { requiredBindings, realValuePatterns } from './wrangler-definitions.mjs'

const templateFile = resolve(process.cwd(), 'wrangler.example.toml')
const content = readFileSync(templateFile, 'utf8')

// Check that all required bindings are present
const missing = []

for (const { key, label } of requiredBindings) {
  if (!content.includes(key)) {
    missing.push(label)
  }
}

if (missing.length > 0) {
  console.error('wrangler.example.toml is missing required bindings:')
  for (const label of missing) {
    console.error(`  - ${label}`)
  }
  process.exit(1)
}

// Check that the template does NOT contain real resource IDs
const leaked = []

for (const pattern of realValuePatterns) {
  const match = content.match(pattern)
  if (match) {
    leaked.push(match[0])
  }
}

if (leaked.length > 0) {
  console.error('wrangler.example.toml appears to contain real resource IDs:')
  for (const value of leaked) {
    console.error(`  - ${value}`)
  }
  process.exit(1)
}

console.log('wrangler.example.toml has all required bindings and no real IDs.')
