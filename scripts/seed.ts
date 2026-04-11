/**
 * Usage: npm run db:seed -- <email> <password>
 *
 * Creates the initial user account. Run this once after `npm run db:migrate`.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Hash } from '@adonisjs/hash'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { users } from '../server/db/schema.js'

const [email, password] = process.argv.slice(2)

if (!email || !password) {
  console.error('Usage: npm run db:seed -- <email> <password>')
  process.exit(1)
}

const dbPath = resolve(process.env.DATABASE_PATH ?? './data/photos.db')
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
const db = drizzle(sqlite)

// Use the same scrypt hasher as nuxt-auth-utils
const hash = new Hash(new Scrypt({}))
const passwordHash = await hash.make(password)

await db.insert(users).values({ email: email.toLowerCase(), passwordHash })

console.log(`Created user: ${email}`)
sqlite.close()
