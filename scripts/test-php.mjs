/**
 * Runs the PHP unit suites.
 *
 * Resolves a PHP binary instead of assuming `php` is on PATH: this machine has
 * a minimal winget PHP 8.4 first on PATH that lacks pdo_pgsql and curl, while
 * the XAMPP build has the extensions these suites need. Preferring XAMPP keeps
 * the run honest about which interpreter the app actually runs on.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CANDIDATES = [
  'C:\\xampp\\php\\php.exe',
  '/usr/local/bin/php',
  '/usr/bin/php',
];

function resolvePhp() {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to PATH and accept whatever turns up.
  const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
  return probe.status === 0 ? 'php' : null;
}

const php = resolvePhp();

if (!php) {
  console.error('No PHP binary found. Install PHP or set one of:');
  CANDIDATES.forEach((c) => console.error(`  ${c}`));
  process.exit(1);
}

const version = spawnSync(php, ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8' });
console.log(`php ${version.stdout.trim()} (${php})`);

const suites = ['test-storage.php'];

let failed = 0;

for (const suite of suites) {
  const file = path.join(root, suite);
  if (!existsSync(file)) {
    console.error(`missing suite: ${suite}`);
    failed++;
    continue;
  }

  console.log(`\n${'='.repeat(60)}\n${suite}\n${'='.repeat(60)}`);
  const result = spawnSync(php, [file], { stdio: 'inherit', cwd: root });
  if (result.status !== 0) failed++;
}

process.exit(failed === 0 ? 0 : 1);