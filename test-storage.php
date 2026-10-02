<?php
declare(strict_types=1);

/**
 * Unit tests for the storage MIME layer.
 *
 * These functions are the gate that decides what a browser may write into our
 * public bucket, so they get direct tests rather than relying on the API suite.
 * Pure logic only — no database, no network, so this runs anywhere.
 */

require_once __DIR__ . '/lib/storage.php';

$passed = 0;
$failed = 0;
$current = '';

function suite(string $name): void
{
    global $current;
    $current = $name;
    echo "\n$name\n";
}

function check(string $name, bool $ok, string $detail = ''): void
{
    global $passed, $failed;
    if ($ok) {
        $passed++;
        echo "  ok   $name\n";
    } else {
        $failed++;
        echo "  FAIL $name" . ($detail !== '' ? "  ($detail)" : '') . "\n";
    }
}

function same(string $name, mixed $actual, mixed $expected): void
{
    check(
        $name,
        $actual === $expected,
        'got ' . var_export($actual, true) . ', want ' . var_export($expected, true)
    );
}

suite('mime canonicalisation — audio aliases collapse to the bucket spelling');

/*
 * The Supabase bucket lists exactly one MIME per format. Browsers send several
 * spellings, and an unlisted content_type makes Supabase reject the PUT. Each
 * of these must normalise to the one spelling the bucket accepts.
 */
$audioAliases = [
    'audio/mpeg'            => 'audio/mpeg',
    'audio/mp3'             => 'audio/mpeg',
    'audio/x-mpeg'          => 'audio/mpeg',
    'audio/mpeg3'           => 'audio/mpeg',
    'audio/mp4'             => 'audio/mp4',
    'audio/x-m4a'           => 'audio/mp4',
    'audio/m4a'             => 'audio/mp4',
    'audio/aac'             => 'audio/aac',
    'audio/x-aac'           => 'audio/aac',
    'audio/ogg'             => 'audio/ogg',
    'audio/wav'             => 'audio/wav',
    'audio/x-wav'           => 'audio/wav',
    'audio/wave'            => 'audio/wav',
    'audio/vnd.wave'        => 'audio/wav',
    'audio/flac'            => 'audio/flac',
    'audio/x-flac'          => 'audio/flac',
    'audio/opus'            => 'audio/opus',
];

// Parameters are stripped before lookup, so Opus-in-Ogg resolves via 'audio/ogg'.
// Storing audio/ogg is honest about the container and plays in every browser.
$audioAliases['audio/ogg;codecs=opus'] = 'audio/ogg';

foreach ($audioAliases as $input => $expected) {
    same("'$input' -> $expected", storage_canonical_mime($input, 'audio'), $expected);
}

suite('mime canonicalisation — image aliases');

$imageAliases = [
    'image/jpeg' => 'image/jpeg',
    'image/jpg'  => 'image/jpeg',
    'image/pjpeg' => 'image/jpeg',
    'image/png'  => 'image/png',
    'image/x-png' => 'image/png',
    'image/apng' => 'image/png',
    'image/webp' => 'image/webp',
    'image/gif'  => 'image/gif',
];

foreach ($imageAliases as $input => $expected) {
    same("'$input' -> $expected", storage_canonical_mime($input, 'photo'), $expected);
}

suite('mime canonicalisation — hostile types are rejected, not coerced');

/*
 * The client controls this string and it becomes the stored content_type, which
 * the CDN then serves. Anything that could execute as script from our origin has
 * to be refused outright — there is no safe "close enough" mapping.
 */
$hostile = [
    'text/html',
    'application/xhtml+xml',
    'image/svg+xml',
    'text/javascript',
    'application/javascript',
    'application/pdf',
    'text/plain',
    'application/octet-stream',
    'application/x-msdownload',
    '',
    '   ',
];

foreach ($hostile as $mime) {
    same(
        "audio family rejects " . ($mime === '' ? '(empty)' : $mime),
        storage_canonical_mime($mime, 'audio'),
        null
    );
    same(
        "photo family rejects " . ($mime === '' ? '(empty)' : $mime),
        storage_canonical_mime($mime, 'photo'),
        null
    );
}

suite('mime canonicalisation — no cross-family smuggling');

/*
 * A valid type from the wrong family is still refused. Otherwise an audio
 * endpoint could be used to write images, or vice versa, bypassing the intent
 * of the caller's kind parameter.
 */
same('audio type refused by photo family',
    storage_canonical_mime('audio/mpeg', 'photo'), null);
same('image type refused by audio family',
    storage_canonical_mime('image/png', 'audio'), null);

suite('mime canonicalisation — casing and parameters are normalised');

same('uppercase collapses', storage_canonical_mime('AUDIO/MPEG', 'audio'), 'audio/mpeg');
same('mixed case collapses', storage_canonical_mime('Image/JPEG', 'photo'), 'image/jpeg');
same('leading whitespace trimmed', storage_canonical_mime('  audio/mp3', 'audio'), 'audio/mpeg');
same('charset parameter stripped', storage_canonical_mime('audio/mpeg; charset=binary', 'audio'), 'audio/mpeg');
same('charset parameter on alias', storage_canonical_mime('audio/x-m4a;charset=utf-8', 'audio'), 'audio/mp4');

suite('every canonical type is one the bucket actually allows');

/*
 * Guards against the two lists drifting apart. A canonical type absent from the
 * bucket's allowlist produces an opaque Supabase 400 at upload time, which is
 * far harder to diagnose than a failing test here.
 *
 * This mirrors the bucket's configured allowed_mime_types. If the bucket config
 * changes, update this list in the same commit.
 */
$bucketAllows = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav',
    'audio/x-wav', 'audio/aac', 'audio/flac', 'audio/opus',
];

$canonicalSet = array_values(array_unique(array_values(MIME_ALIASES)));

foreach ($canonicalSet as $canonical) {
    check(
        "$canonical is allowed by the bucket",
        in_array($canonical, $bucketAllows, true)
    );
}

/*
 * The invariant that actually matters is containment, not equality: every
 * canonical type we can emit must be one the bucket accepts. The bucket may
 * legitimately allow extra spellings we never produce — it allows audio/x-wav,
 * which is an input alias, while our canonical output for WAV is audio/wav.
 */
$notAllowed = array_diff($canonicalSet, $bucketAllows);
check(
    'no canonical type falls outside the bucket allowlist',
    $notAllowed === [],
    $notAllowed === [] ? '' : 'not allowed: ' . implode(', ', $notAllowed)
);

suite('extension mapping');

same('mp3', storage_mime_extension('audio/mpeg'), 'mp3');
same('m4a', storage_mime_extension('audio/mp4'), 'm4a');
same('wav', storage_mime_extension('audio/wav'), 'wav');
same('flac', storage_mime_extension('audio/flac'), 'flac');
same('opus', storage_mime_extension('audio/opus'), 'opus');
same('ogg', storage_mime_extension('audio/ogg'), 'ogg');
same('aac', storage_mime_extension('audio/aac'), 'aac');
same('jpeg', storage_mime_extension('image/jpeg'), 'jpg');
same('png', storage_mime_extension('image/png'), 'png');
same('webp', storage_mime_extension('image/webp'), 'webp');
same('gif', storage_mime_extension('image/gif'), 'gif');
// Never allowlist-driven code to emit an empty or executable extension.
same('unknown falls back to bin', storage_mime_extension('text/html'), 'bin');
same('empty falls back to bin', storage_mime_extension(''), 'bin');

suite('random path generation');

$p = storage_random_path('audio', 'mp3');
check('has the prefix directory', str_starts_with($p, 'audio/'), $p);
check('ends with the extension', str_ends_with($p, '.mp3'), $p);
check('passes storage_path_is_safe', storage_path_is_safe($p));
check(
    'contains no directory traversal',
    !str_contains($p, '..') && !str_contains($p, '\\'),
    $p
);
check(
    'filename portion is hex only',
    (bool) preg_match('#^audio/[0-9a-f]{32}\.mp3$#', $p),
    $p
);
check(
    'no two paths collide',
    storage_random_path('audio', 'mp3') !== storage_random_path('audio', 'mp3')
);

suite('size ceilings agree with the bucket');

check('MAX_SIGNED_BYTES is the bucket limit',
    MAX_SIGNED_BYTES === 52428800,
    MAX_SIGNED_BYTES . ' vs 52428800');
check('MAX_UPLOAD_BYTES stays under Vercel\'s 4.5 MB',
    MAX_UPLOAD_BYTES < 4.5 * 1024 * 1024,
    MAX_UPLOAD_BYTES . '');
check('signed route allows more than the function route',
    MAX_SIGNED_BYTES > MAX_UPLOAD_BYTES);
check('signed URLs are short-lived', SIGNED_URL_TTL > 0 && SIGNED_URL_TTL <= 3600, (string) SIGNED_URL_TTL);

echo "\n$passed passed, $failed failed\n";

exit($failed === 0 ? 0 : 1);