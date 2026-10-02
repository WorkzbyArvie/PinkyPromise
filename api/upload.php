<?php
declare(strict_types=1);

/**
 * Media upload — streamed straight to Supabase Storage.
 *
 *   POST   /api/upload?kind=photo|audio&variant=…
 *          Body: the raw file bytes (NOT multipart/form-data)
 *          → { url, path, bytes, mime }
 *   DELETE /api/upload   { path }   → removes one stored object
 *
 * WHY RAW BODY, NOT MULTIPART
 *
 * When the request is multipart/form-data, PHP consumes php://input in order
 * to populate $_FILES, writing the part to a temporary file first. That would
 * put user data on local disk — exactly what Rule 1 forbids, and pointless on
 * Vercel, where the filesystem is read-only and /tmp is ephemeral per instance.
 *
 * Sending the file as the raw request body keeps php://input intact, so the
 * bytes go from the client straight to Supabase through curl's READFUNCTION.
 * Nothing is buffered, nothing is written, and a 4 MB upload costs a few KB of
 * memory instead of 4 MB.
 *
 * The client's filename is never used for the storage path — the path is
 * random hex, which is what prevents traversal and double-extension tricks.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/validate.php';
require_once __DIR__ . '/../lib/storage.php';

try {
    require_auth();

    switch (request_method()) {
        // ------------------------------------------------------------------
        case 'POST':
            $kind = query_param('kind', 'photo');
            $variant = query_param('variant', 'card') ?? 'card';

            if (!in_array($kind, ['photo', 'audio'], true)) {
                json_error('invalid_kind', "Unknown upload kind.", 422);
            }

            $isAudio = $kind === 'audio';
            $allowed = $isAudio ? AUDIO_MIMES : IMAGE_MIMES;
            $prefix = $isAudio ? 'audio' : 'photos';

            // Refuse an oversized body before reading a single byte of it.
            $declared = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
            if ($declared <= 0) {
                json_error('missing_length', "Couldn't determine the upload size.", 411);
            }
            if ($declared > MAX_UPLOAD_BYTES) {
                json_error(
                    'too_large',
                    sprintf(
                        'That file is too large. Keep it under %d MB.',
                        (int) (MAX_UPLOAD_BYTES / 1024 / 1024)
                    ),
                    413
                );
            }

            $input = fopen('php://input', 'rb');
            if ($input === false) {
                json_error('upload_failed', "Couldn't read the upload.", 400);
            }

            $result = storage_upload($input, $prefix, $allowed, $variant);

            json_ok([
                'url'   => $result['url'],
                'path'  => $result['path'],
                'bytes' => $result['bytes'],
                'mime'  => $result['mime'],
            ], 201);

        // ------------------------------------------------------------------
        case 'DELETE':
            $v = new Validator(json_body());
            $v->text('path', 300, true, 1);

            if ($v->fails()) {
                fail_validation($v->errors());
            }

            $path = $v->values()['path'];

            // Shape-checked here AND again inside storage_delete, so this
            // endpoint cannot be used to remove an arbitrary object.
            if (!storage_path_is_safe($path)) {
                json_error('invalid_path', "That storage path isn't valid.", 422);
            }

            if (!storage_delete($path)) {
                json_error('delete_failed', "That file couldn't be removed.", 502);
            }

            log_info('upload removed', ['path' => $path]);
            json_ok(['deleted' => true, 'path' => $path]);

        default:
            require_method('POST', 'DELETE');
    }
} catch (Throwable $e) {
    json_fatal($e);
}