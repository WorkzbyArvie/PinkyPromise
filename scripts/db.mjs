/**
 * Shared helpers for the local DB tooling (never deployed).
 *
 * `pg` forbids calling connect() twice on one Client instance, so a retry has
 * to build a FRESH client each attempt. Supabase's transaction-mode pooler
 * (port 6543) drops idle connections aggressively, which makes retries
 * genuinely necessary rather than theoretical.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env parser — avoids a dependency. Real env vars always win. */
export async function loadEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return;

  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;

    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (!/^["']/.test(value)) {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    value = value.replace(/^["']|["']$/g, '');

    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function redact(url) {
  return String(url).replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

const TRANSIENT =
  /terminated|ECONNRESET|ETIMEDOUT|EPIPE|timeout|server closed|already been connected/i;

/**
 * Connect with backoff. Returns a NEW, connected client on success.
 * @param {number} attempts
 */
export async function connect({ attempts = 5, quiet = false } = {}) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // Fresh instance every time — pg refuses a second connect().
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
      query_timeout: 20000,
    });

    try {
      await client.connect();
      return client;
    } catch (err) {
      // Never leave a half-open handle behind.
      await client.end().catch(() => {});

      if (!TRANSIENT.test(err.message) || attempt === attempts) {
        console.error(`Could not connect to ${redact(url)}`);
        console.error(`  ${err.message}`);
        process.exit(1);
      }

      const wait = attempt * 1500;
      if (!quiet) {
        console.warn(`  connection dropped (${err.message}) — retry ${attempt}/${attempts - 1} in ${wait}ms`);
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  /* c8 ignore next */
  throw new Error('unreachable');
}

/** Run `fn` inside a transaction as `role`, always rolling back. */
export async function asRole(client, role, fn) {
  await client.query('begin');
  await client.query(`set local role ${role}`);
  try {
    return await fn();
  } finally {
    await client.query('rollback').catch(() => {});
  }
}