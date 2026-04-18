/**
 * Patches @tensorflow/tfjs-node dist files to remove calls to the deprecated
 * util.isNullOrUndefined() function, which was removed in Node.js v25.
 *
 * Replacement: (x == null)  — same semantics as isNullOrUndefined(x).
 *
 * This runs automatically after `npm install` via the postinstall hook.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = dirname(fileURLToPath(import.meta.url))

const FILES = [
  '../node_modules/@tensorflow/tfjs-node/dist/kernels/TopK.js',
  '../node_modules/@tensorflow/tfjs-node/dist/nodejs_kernel_backend.js',
]

const PATTERN = /\(0, util_1\.isNullOrUndefined\)\(([^)]+)\)/g
const REPLACEMENT = '($1 == null)'

let patched = 0

for (const rel of FILES) {
  const file = join(__dirname, rel)
  if (!existsSync(file)) continue

  const original = readFileSync(file, 'utf8')
  const updated  = original.replace(PATTERN, REPLACEMENT)

  if (updated !== original) {
    writeFileSync(file, updated, 'utf8')
    const count = (original.match(PATTERN) ?? []).length
    console.log(`  patched ${file.split('/').slice(-3).join('/')} (${count} occurrences)`)
    patched++
  }
}

if (patched === 0) {
  // Already patched or not installed yet — either is fine
}
