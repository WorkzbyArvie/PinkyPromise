<?php
declare(strict_types=1);

/**
 * Signed upload URL for media that exceeds Vercel's request-body limit.
 *
 *   POST /api/upload-signed?kind=audio&variant=audio
 *   Body: { filename, mime, bytes }
 *   → { path, upload_url, token, content_type, url, max_bytes }
 *
 * The response is tiny — a few hundred bytes. The browser then PUTs the file
 * itself to `upload_url?token=…`, so the bytes go straight from the browser to
 * Supabase and never pass through a Vercel function.
 *
 * WHY THIS EXISTS
 *
 * Vercel rejects a serverless function request body over 4.5 MB, and it does so
 * before PHP runs — so the 4 MB limit in lib/storage.php is never even
 * consulted, and no amount of raising our own limit helps. A 5 MB mp3 fails with
 * "Request Entity Too Large" no matter what. This route moves the transfer off
 * the function entirely.
 *
 * The signed URL is short-lived (15 min) and scoped to one exact path, so it
 * cannot be reused to write anywhere else.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/validate.php';
require_once __DIR__ . '/../lib/storage.php';

try {
    require_auth();
    require_method('POST');

    $kind = query_param('kind', 'audio');
    $variant = query_param('variant', $kind) ?? $kind;

    if (!in_array($kind, ['photo', 'audio'], true)) {
        json_error('invalid_kind', 'Unknown upload kind.', 422);
    }

    $isAudio = $kind === 'audio';

    $body = json_body();

    $v = new Validator($body);
    $v->text('mime', 120, true, 1);
    $v->int('bytes', 0, 1, MAX_SIGNED_BYTES);
    // The filename is never used for the path or the extension — both come from
    // the canonical MIME below, so a crafted name cannot influence storage.
    $v->text('filename', 255, false);

    if ($v->fails()) {
        fail_validation($v->errors());
    }

    $c = $v->values();

    /*
     * Size check against the RAW declared value, not the validated one.
     *
     * Validator::int() CLAMPS to its max rather than erroring (it is written
     * that way so a hostile limit parameter degrades to the maximum instead of
     * failing). That is right for pagination and wrong here: by the time we read
     * $c['bytes'] an oversized value has already been silently reduced, so
     * comparing it to MAX_SIGNED_BYTES could never fire and the 413 below was
     * unreachable. Reject on the untouched request value instead.
     */
    $declaredBytes = (int) ($body['bytes'] ?? 0);

    if ($declaredBytes < 1) {
        json_error('invalid_bytes', 'Tell us how big the file is.', 422);
    }

    if ($declaredBytes > MAX_SIGNED_BYTES) {
        json_error(
            'too_large',
            sprintf(
                'That file is larger than %d MB.',
                (int) (MAX_SIGNED_BYTES / 1024 / 1024)
            ),
            413
        );
    }

    // STRICT allowlist, no fallback.
    //
    // The browser controls the Content-Type on the subsequent PUT, and that is
    // the type Supabase stores AND serves. Letting an arbitrary type through
    // would let someone stash text/html or an SVG in our bucket and have it
    // served from our own origin — stored XSS by another name. So an unknown
    // type is rejected outright.
    //
    // Browsers report several aliases for the same format (an .m4a can arrive
    // as audio/mp4 or audio/x-m4a; an .mp3 as audio/mpeg or audio/mp3), but the
    // bucket's allowlist only lists ONE spelling of each. So we normalise to the
    // canonical type here and tell the browser to PUT with that value —
    // otherwise the upload dies at Supabase with an opaque 400.
    $canonical = storage_canonical_mime($c['mime'], $isAudio ? 'audio' : 'photo');

    if ($canonical === null) {
        json_error(
            'invalid_mime',
            $isAudio
                ? 'Choose an MP3, M4A, OGG, WAV, AAC, FLAC or Opus audio file.'
                : 'Choose a JPEG, PNG, WebP or GIF image.',
            422
        );
    }

    $extension = storage_mime_extension($canonical);
    $prefix = $isAudio ? 'audio' : 'photos';

    $path = storage_random_path($prefix, $extension);
    $signed = storage_sign_upload($path, $canonical, SIGNED_URL_TTL);

    log_info('signed upload issued', [
        'kind' => $kind,
        'variant' => $variant,
        'bytes' => $declaredBytes,
        'mime' => $canonical,
        'path' => $path,
    ]);

    json_ok([
        'path'         => $path,
        'upload_url'   => $signed['url'],
        'token'        => $signed['token'],
        'url'          => storage_public_url($path),
        // The client MUST send this as Content-Type on the PUT, not its own
        // file.type — see the alias note above.
        'content_type' => $canonical,
        'max_bytes'    => MAX_SIGNED_BYTES,
    ], 201);

} catch (Throwable $e) {
    json_fatal($e);
}
