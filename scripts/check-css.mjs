// ---------------------------------------------------------------------------
// Fails if css/app.css is stale.
//
// Vercel has no build step for this project (setting one made it demand a
// conventional outputDirectory that this layout does not have), so the compiled
// stylesheet is committed. The risk is committing a stale one, which silently
// drops every style change.
//
//   npm run css:check
//
// Run in CI or before pushing. Exit code 1 means "rebuild and commit".
// ---------------------------------------------------------------------------

import { readFile, unlink, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'public', 'css', 'app.css');
const TMP = join(root, 'public', 'css', '.app.css.verify');

/**
 * Run the Tailwind CLI via its JS entry point rather than the `tailwindcss`
 * shim. The shim is a `.cmd` on Windows, and execFile cannot spawn a `.cmd`
 * without a shell â€” which fails with `spawn EINVAL`. Running the module with
 * the current Node binary works identically on every platform.
 */
async function runTailwind(outPath) {
  const pkgDir = join(root, 'node_modules', '@tailwindcss', 'cli');
  await access(pkgDir);

  const entry = join(pkgDir, 'dist', 'index.mjs');
  await exec(process.execPath, [entry, '-i', './src/input.css', '-o', outPath, '--minify'], {
    cwd: root,
    maxBuffer: 1024 * 1024 * 16,
  });
}

async function main() {
  let before;
  try {
    before = await readFile(OUT);
  } catch {
    console.error('public/css/app.css is missing. Run: npm run build:css');
    process.exit(1);
  }

  // Read the verification output BEFORE cleaning it up.
  let rebuilt = null;
  try {
    await runTailwind(TMP);
    rebuilt = await readFile(TMP);
  } catch (err) {
    console.error('verification build failed:', err.message);
    process.exitCode = 1;
  } finally {
    await unlink(TMP).catch(() => {});
  }

  if (rebuilt === null) {
    console.error('verification build produced no output');
    process.exit(1);
  }

  const hash = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);

  if (hash(before) === hash(rebuilt)) {
    console.log(`css/app.css is up to date (${hash(before)})`);
    return;
  }

  console.error('public/css/app.css is STALE.');
  console.error(`  committed: ${hash(before)}`);
  console.error(`  rebuilt:   ${hash(rebuilt)}`);
  console.error('  fix: npm run build:css && git add public/css/app.css');
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});