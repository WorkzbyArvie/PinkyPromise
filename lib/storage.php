<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/http.php';

/**
 * Supabase Storage.
 *
 * Uploads are STREAMED from php://input straight to Supabase with curl's
 * READFUNCTION. Nothing is written to disk, because on Vercel the filesystem
 * is read-only and /tmp is ephemeral per instance — a file written there would
 * vanish and would not be shared between concurrent instances.
 *
 * We still sniff the first bytes to validate the real MIME type, since the
 * client-declared type is attacker-controlled. The sniffed bytes are replayed
 * to curl so validation does not cost us the stream.
 */

/** Vercel rejects request bodies over 4.5 MB. Leave headroom. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const IMAGE_MIMES = [
    'image/jpeg' => 'jpg',
    'image/png'  => 'png',
    'image/webp' => 'webp',
    'image/gif'  => 'gif',
];

const AUDIO_MIMES = [
    'audio/mpeg'      => 'mp3',
    'audio/mp3'       => 'mp3',
    'audio/mp4'       => 'm4a',
    'audio/x-m4a'     => 'm4a',
    'audio/aac'       => 'aac',
    'audio/ogg'       => 'ogg',
    'audio/wav'       => 'wav',
    'audio/x-wav'     => 'wav',
    'audio/wave'      => 'wav',
    'audio/flac'      => 'flac',
    'audio/x-flac'    => 'flac',
    'audio/opus'      => 'opus',
    'audio/webm'      => 'weba',
];

function storage_bucket(): string
{
    return rmb_env_optional('SUPABASE_STORAGE_BUCKET', 'recon-media') ?? 'recon-media';
}

function storage_base(): string
{
    return rtrim(rmb_env('SUPABASE_URL'), '/');
}

/** Public CDN URL for a stored object. */
function storage_public_url(string $path): string
{
    return sprintf(
        '%s/storage/v1/object/public/%s/%s',
        storage_base(),
        rawurlencode(storage_bucket()),
        rawurlencode($path)
    );
}

/**
 * Generate an unguessable storage path.
 *
 * The user's filename NEVER reaches the path — that is how directory traversal
 * and double-extension tricks get in. We keep only a sanitised extension.
 */
function storage_random_path(string $prefix, string $extension): string
{
    return sprintf('%s/%s.%s', $prefix, bin2hex(random_bytes(16)), $extension);
}

/**
 * Reject anything that isn't a path we could have generated.
 * Guards DELETE /api/upload against traversal and arbitrary-object removal.
 */
function storage_path_is_safe(string $path): bool
{
    return (bool) preg_match('#^[a-z0-9_-]+/[a-f0-9]{32}\.[a-z0-9]{2,5}$#', $path);
}

/**
 * Recover the storage path from a public URL.
 *
 * We persist the CDN URL, but deletion needs the path. Returns null for
 * anything that isn't one of OUR bucket URLs — an externally hosted file has
 * no object here to remove, which is the correct answer, not a failure.
 */
function storage_path_from_url(string $url): ?string
{
    $needle = '/storage/v1/object/public/';
    $pos = strpos($url, $needle);
    if ($pos === false) {
        return null;
    }

    $rest = substr($url, $pos + strlen($needle));
    $slash = strpos($rest, '/');
    if ($slash === false || $slash === 0) {
        return null;
    }

    $bucket = substr($rest, 0, $slash);
    $path = rawurldecode(substr($rest, $slash + 1));

    if ($bucket !== storage_bucket()) {
        return null;
    }

    return storage_path_is_safe($path) ? $path : null;
}

/**
 * Sniff the real MIME type from the leading bytes, then rewind.
 *
 * Reads only the first 8 KB. Returns [mime, sniffedBytes, remainingStream].
 */
function sniff_upload(): array
{
    $input = fopen('php://input', 'rb');
    if ($input === false) {
        json_error('upload_failed', "Couldn't read the upload.", 400);
    }

    $prefix = (string) fread($input, 8192);
    if ($prefix === '') {
        fclose($input);
        json_error('empty_upload', 'The file was empty.', 400);
    }

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = (string) $finfo->buffer($prefix);

    return [$mime, $prefix, $input];
}

/**
 * Stream an upload to Supabase Storage.
 *
 * @param resource $stream    php://input handle
 * @param string   $prefix    e.g. 'photos' or 'audio'
 * @param array    $allowed   mime => extension map
 * @return array{url:string, path:string, bytes:int}
 */
function storage_upload($stream, string $prefix, array $allowed, string $variant = 'file'): array
{
    [$mime, $prefixBytes, $input] = sniff_upload();

    if (!isset($allowed[$mime])) {
        fclose($input);
        $label = array_key_exists('image', $allowed) ? 'image' : 'audio';
        json_error('unsupported_type', "That file isn't a supported {$label} format.", 415);
    }

    $declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($declared <= 0) {
        fclose($input);
        json_error('missing_length', "Couldn't determine the upload size.", 411);
    }
    if ($declared > MAX_UPLOAD_BYTES) {
        fclose($input);
        json_error('too_large', sprintf(
            'That file is too large. Keep it under %d MB.',
            (int) (MAX_UPLOAD_BYTES / 1024 / 1024)
        ), 413);
    }

    $path = storage_random_path($prefix, $allowed[$mime]);
    $url = sprintf(
        '%s/storage/v1/object/%s/%s',
        storage_base(),
        rawurlencode(storage_bucket()),
        rawurlencode($path)
    );

    // Replay the sniffed bytes, then continue with the rest of the stream.
    $offset = 0;
    $readFn = static function ($ch, $fd, $length) use ($prefixBytes, &$offset, $input): string {
        if ($offset < strlen($prefixBytes)) {
            $chunk = substr($prefixBytes, $offset, $length);
            $offset += strlen($chunk);
            return $chunk;
        }
        $rest = fread($input, $length);
        return $rest === false ? '' : $rest;
    };

    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_UPLOAD        => true,
        // Send POST (not PUT) while keeping the streaming upload body.
        CURLOPT_CUSTOMREQUEST => 'POST',
        CURLOPT_READFUNCTION  => $readFn,
        CURLOPT_INFILESIZE    => $declared,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT       => 60,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER    => [
            'Authorization: Bearer ' . rmb_env('SUPABASE_SERVICE_ROLE_KEY'),
            'apikey: ' . rmb_env('SUPABASE_SERVICE_ROLE_KEY'),
            'Content-Type: ' . $mime,
            'Content-Length: ' . $declared,
            'x-upsert: false',
            // Suppress the 100-continue round trip; it doubles latency and the
            // body is already size-checked.
            'Expect:',
        ],
    ]);

    $body = curl_exec($handle);
    $errno = curl_errno($handle);
    $error = curl_error($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    fclose($input);

    if ($errno !== 0) {
        log_error('storage upload transport error', [
            'path' => $path, 'errno' => $errno, 'error' => $error,
        ]);
        json_error('upload_failed', "Couldn't reach the storage service.", 502);
    }

    if ($status < 200 || $status >= 300) {
        log_error('storage upload rejected', [
            'path' => $path, 'status' => $status, 'body' => is_string($body) ? substr($body, 0, 400) : '',
        ]);
        json_error('upload_failed', "The file couldn't be saved.", 502);
    }

    log_info('upload stored', ['path' => $path, 'bytes' => $declared, 'variant' => $variant]);

    return [
        'url'   => storage_public_url($path),
        'path'  => $path,
        'bytes' => $declared,
        'mime'  => $mime,
    ];
}

/** Delete an object. Best effort — a failure here must not block a row delete. */
function storage_delete(string $path): bool
{
    if (!storage_path_is_safe($path)) {
        log_error('storage delete rejected: unsafe path', ['path' => $path]);
        return false;
    }

    $url = sprintf(
        '%s/storage/v1/object/%s/%s',
        storage_base(),
        rawurlencode(storage_bucket()),
        rawurlencode($path)
    );

    $handle = curl_init($url);
    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST => 'DELETE',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT       => 20,
        CURLOPT_HTTPHEADER    => [
            'Authorization: Bearer ' . rmb_env('SUPABASE_SERVICE_ROLE_KEY'),
            'apikey: ' . rmb_env('SUPABASE_SERVICE_ROLE_KEY'),
        ],
    ]);

    curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);

    return $status >= 200 && $status < 300;
}

/** Verify the bucket is reachable and the service key works. Used by /api/health. */
function storage_is_healthy(): bool
{
    try {
        $url = sprintf('%s/storage/v1/bucket', storage_base());
        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT       => 10,
            CURLOPT_HTTPHEADER    => [
                'Authorization: Bearer ' . rmb_env('SUPABASE_SERVICE_ROLE_KEY'),
                'apikey: ' . rmb_env('SUPABASE_SERVICE_ROLE_KEY'),
            ],
        ]);
        curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        curl_close($handle);
        return $status >= 200 && $status < 300;
    } catch (Throwable) {
        return false;
    }
}