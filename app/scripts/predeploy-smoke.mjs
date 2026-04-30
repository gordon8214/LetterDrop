import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { execFile as execFileCallback } from 'node:child_process'

const execFile = promisify(execFileCallback)
const wranglerBin = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const requiredSecrets = [
  'ADMIN_API_TOKEN',
  'NOTIFICATION_SHARED_SECRET',
  'TURNSTILE_SECRET_KEY',
  'UNSUBSCRIBE_SIGNING_SECRET',
  'SES_SNS_WEBHOOK_TOKEN',
]

function parseArgs(argv) {
  const args = { env: process.env.WRANGLER_ENV ?? '', database: process.env.D1_DATABASE_NAME ?? '' }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--env') {
      args.env = argv[index + 1] ?? ''
      index += 1
    } else if (token === '--database') {
      args.database = argv[index + 1] ?? ''
      index += 1
    }
  }
  return args
}

function inferDatabaseNameFromWrangler() {
  const wranglerToml = readFileSync(resolve(process.cwd(), 'wrangler.toml'), 'utf8')
  const match = wranglerToml.match(/database_name\s*=\s*"([^"]+)"/)
  return match?.[1] ?? ''
}

function parseJson(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) {
    return null
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    const jsonStart = trimmed.search(/[\[{]/)
    if (jsonStart === -1) {
      throw new Error(`Unable to parse JSON output: ${trimmed}`)
    }
    return JSON.parse(trimmed.slice(jsonStart))
  }
}

async function runWranglerJson(args, envName) {
  const envArgs = envName ? ['--env', envName] : []
  const { stdout, stderr } = await execFile(wranglerBin, ['wrangler', ...args, ...envArgs], {
    cwd: process.cwd(),
    env: process.env,
  })

  if (stderr.trim()) {
    console.error(stderr.trim())
  }

  return parseJson(stdout)
}

function unwrapRows(result) {
  if (!result) {
    return []
  }

  if (Array.isArray(result)) {
    for (const entry of result) {
      if (entry && typeof entry === 'object' && Array.isArray(entry.results)) {
        return entry.results
      }
    }
    return result
  }

  if (typeof result === 'object' && Array.isArray(result.results)) {
    return result.results
  }

  return []
}

async function checkSecrets(envName) {
  const secretsResult = await runWranglerJson(['secret', 'list', '--format', 'json'], envName)
  const secrets = Array.isArray(secretsResult) ? secretsResult : []
  const secretNames = new Set(secrets.map((secret) => String(secret.name ?? '')))
  const missing = requiredSecrets.filter((name) => !secretNames.has(name))

  if (missing.length > 0) {
    throw new Error(`Missing required Worker secrets: ${missing.join(', ')}`)
  }
}

async function queryD1(databaseName, envName, sql) {
  const result = await runWranglerJson(
    ['d1', 'execute', databaseName, '--remote', '--command', sql, '--json'],
    envName
  )
  return unwrapRows(result)
}

async function checkMigrations(databaseName, envName) {
  const abuseEventTables = await queryD1(
    databaseName,
    envName,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='AbuseEvent'"
  )
  if (abuseEventTables.length === 0) {
    throw new Error(
      'Missing AbuseEvent table. Apply db/20260223_add_abuse_event_table.sql before deploy.'
    )
  }

  const suppressionEventTables = await queryD1(
    databaseName,
    envName,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='SuppressionEvent'"
  )
  if (suppressionEventTables.length === 0) {
    throw new Error(
      'Missing SuppressionEvent table. Apply db/20260428_add_suppression_event_table.sql before deploy.'
    )
  }

  const subscriberColumns = await queryD1(databaseName, envName, "PRAGMA table_info('Subscriber')")
  const subscriberColumnNames = new Set(subscriberColumns.map((column) => String(column.name ?? '')))
  const missingColumns = [
    'first_name',
    'last_name',
    'subscribed_at',
    'unsubscribed_at',
    'deleted_at',
  ].filter((column) => !subscriberColumnNames.has(column))

  if (missingColumns.length > 0) {
    throw new Error(
      `Missing Subscriber columns: ${missingColumns.join(', ')}. Apply the pending db migrations before deploy.`
    )
  }

  const sendColumns = await queryD1(databaseName, envName, "PRAGMA table_info('NewsletterSend')")
  const sendColumnNames = new Set(sendColumns.map((column) => String(column.name ?? '')))
  const missingSendColumns = [
    'sending_count',
    'retrying_count',
    'fanout_queued_count',
    'content_file_name',
    'text_file_name',
    'from_name',
    'fanout_snapshot_at',
    'fanout_cursor_email',
    'fanout_completed_at',
  ].filter((column) => !sendColumnNames.has(column))

  if (missingSendColumns.length > 0) {
    throw new Error(
      `Missing NewsletterSend columns: ${missingSendColumns.join(', ')}. Apply db/20260429_add_scalable_send_fanout.sql before deploy.`
    )
  }

  const indexes = await queryD1(
    databaseName,
    envName,
    `SELECT name FROM sqlite_master
     WHERE type = 'index'
       AND name IN (
         'idx_subscriber_newsletter_snapshot_email',
         'idx_newsletter_send_recipient_status_email',
         'idx_newsletter_send_recipient_email'
       )`
  )
  const indexNames = new Set(indexes.map((index) => String(index.name ?? '')))
  const missingIndexes = [
    'idx_subscriber_newsletter_snapshot_email',
    'idx_newsletter_send_recipient_status_email',
    'idx_newsletter_send_recipient_email',
  ].filter((index) => !indexNames.has(index))

  if (missingIndexes.length > 0) {
    throw new Error(
      `Missing D1 indexes: ${missingIndexes.join(', ')}. Apply db/20260429_add_scalable_send_fanout.sql before deploy.`
    )
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const databaseName = options.database || inferDatabaseNameFromWrangler()

  if (!databaseName) {
    throw new Error(
      'Unable to determine D1 database name. Pass --database <name> or set D1_DATABASE_NAME.'
    )
  }

  await checkSecrets(options.env)
  await checkMigrations(databaseName, options.env)
  console.log('Predeploy smoke checks passed: required secrets and D1 migrations are in place.')
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Predeploy smoke check failed: ${message}`)
  process.exit(1)
})
