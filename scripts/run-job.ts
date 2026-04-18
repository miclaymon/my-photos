#!/usr/bin/env tsx
/**
 * CLI script to run a background job directly.
 *
 * Usage:
 *   npm run jobs:run -- <job-name> [library-id] [--reprocess]
 *
 * Job names:
 *   object-detection   Detect objects via COCO-SSD
 *   face-grouping      Detect + cluster faces via face-api
 *   ocr                Extract text via Tesseract
 *
 * Examples:
 *   npm run jobs:run -- object-detection
 *   npm run jobs:run -- object-detection some-library-uuid
 *   npm run jobs:run -- face-grouping some-library-uuid --reprocess
 *   npm run jobs:run -- ocr
 */

// Load environment variables from .env before anything else
import { readFileSync, existsSync } from 'fs'
const envPath = new URL('../.env', import.meta.url).pathname
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

import '../server/db/index'          // initialise DB + run migrations
import { runJobSync } from '../server/jobs'
import type { JobName }              from '../server/jobs'

const VALID_JOBS: JobName[] = ['object-detection', 'face-grouping', 'ocr']

const args      = process.argv.slice(2)
const jobName   = args[0] as JobName | undefined
const libraryId = args.find(a => !a.startsWith('--') && a !== jobName) ?? undefined
const reprocess = args.includes('--reprocess')

if (!jobName || !VALID_JOBS.includes(jobName)) {
  console.error(`\nUsage: npm run jobs:run -- <job-name> [library-id] [--reprocess]`)
  console.error(`\nValid jobs: ${VALID_JOBS.join(', ')}\n`)
  process.exit(1)
}

console.log(`\n▶  Starting job: ${jobName}`)
if (libraryId)  console.log(`   Library: ${libraryId}`)
if (reprocess)  console.log(`   Reprocessing already-processed items`)
console.log()

const tick = setInterval(() => {
  process.stdout.write('.')
}, 2000)

try {
  const status = await runJobSync(jobName, { libraryId, reprocess })

  clearInterval(tick)
  console.log('\n')
  console.log('✓  Job complete')
  console.log(`   Processed: ${status.processed} / ${status.total}`)
  console.log(`   Errors:    ${status.errors}`)
  if (status.lastError) console.log(`   Last error: ${status.lastError}`)
  if (status.startedAt && status.finishedAt) {
    const ms = status.finishedAt.getTime() - status.startedAt.getTime()
    console.log(`   Duration:  ${(ms / 1000).toFixed(1)}s`)
  }
  console.log()
} catch (err) {
  clearInterval(tick)
  console.error('\n✗  Job failed:', err)
  process.exit(1)
}

process.exit(0)
