<?php
declare(strict_types=1);

/**
 * Which build is this?
 *
 *   GET /api/version  ->  { sha, short, branch, env }
 *
 * Vercel injects VERCEL_GIT_COMMIT_SHA into the function's environment at
 * runtime, so this always reports the commit that is genuinely serving
 * requests. No build step, no committed stamp to forget to regenerate, and it
 * cannot drift from reality.
 *
 * WHY IT EXISTS
 *
 * A stretch of "the fix is deployed but the page looks unchanged" turned out to
 * be the browser running a bundle several commits behind the repository, with
 * nothing on screen able to distinguish the two. The footer now prints this, so
 * "is this the new build?" is answered by looking rather than by guessing.
 *
 * Deliberately unauthenticated: a commit SHA is not a secret, it is already
 * public in the repository, and this endpoint must answer before the lock screen
 * so a stale build can be identified even when locked out.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';

try {
    require_method('GET');

    $sha = (string) (getenv('VERCEL_GIT_COMMIT_SHA') ?: '');
    $branch = (string) (getenv('VERCEL_GIT_COMMIT_REF') ?: '');
    $vercel = getenv('VERCEL') !== false;

    // Locally there is no Vercel environment. Say so plainly instead of
    // inventing a hash — "local" is useful information, a fake SHA is not.
    $short = $sha !== '' ? substr($sha, 0, 7) : ($vercel ? 'unknown' : 'local');

    header('Cache-Control: no-store');

    json_ok([
        'sha'    => $sha !== '' ? $sha : null,
        'short'  => $short,
        'branch' => $branch !== '' ? $branch : null,
        'env'    => $vercel ? 'vercel' : 'local',
    ]);

} catch (Throwable $e) {
    json_fatal($e);
}
