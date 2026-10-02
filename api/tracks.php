<?php
declare(strict_types=1);

/**
 * Audio tracks for the music bar.
 *
 *   GET    /api/tracks           list, in playback order
 *   POST   /api/tracks           add
 *   DELETE /api/tracks           remove (also deletes an uploaded file)
 *
 * source_type decides the frontend transport and its capabilities:
 *   file    → <audio>, full transport + live analyser
 *   youtube → IFrame embed, static equaliser instead of an analyser
 *   spotify → link-out; Spotify cannot be embedded by third-party sites
 *
 * `source` stores the NORMALISED value, never the raw paste:
 *   file    → absolute URL
 *   youtube → bare 11-char video id
 *   spotify → "track/<22-char id>"
 *
 * The server re-derives that value rather than trusting the client, so a
 * hand-crafted request can't store a javascript: URL or a traversal path.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/validate.php';
require_once __DIR__ . '/../lib/storage.php';

const TRACK_TYPES = ['file', 'youtube', 'spotify'];

function track_columns(): string
{
    return 'id, title, source_type, source, storage_path, position, created_at';
}

/** YouTube: accept the id or any common URL shape, return the bare id. */
function normalise_youtube(string $input): ?string
{
    $raw = trim($input);

    // Already a bare 11-char id.
    if (preg_match('/^[A-Za-z0-9_-]{11}$/', $raw)) {
        return $raw;
    }

    // youtu.be/<id>, with or without scheme or query.
    if (preg_match('#^(?:https?://)?(?:www\.)?youtu\.be/([A-Za-z0-9_-]{11})#i', $raw, $m)) {
        return $m[1];
    }

    $host = strtolower((string) parse_url(
        str_starts_with($raw, 'http') ? $raw : "https://{$raw}",
        PHP_URL_HOST
    ));

    $allowed = [
        'youtube.com', 'www.youtube.com', 'm.youtube.com',
        'music.youtube.com', 'youtu.be', 'www.youtu.be',
    ];
    if (!in_array($host, $allowed, true)) {
        return null;
    }

    $path = (string) parse_url(
        str_starts_with($raw, 'http') ? $raw : "https://{$raw}",
        PHP_URL_PATH
    );

    // /watch?v=<id>
    if (preg_match('/^\/watch$/', $path)) {
        parse_str((string) parse_url(
            str_starts_with($raw, 'http') ? $raw : "https://{$raw}",
            PHP_URL_QUERY
        ), $query);
        $id = (string) ($query['v'] ?? '');
        return preg_match('/^[A-Za-z0-9_-]{11}$/', $id) ? $id : null;
    }

    // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
    if (preg_match('#^/(?:embed|shorts|live|v)/([A-Za-z0-9_-]{11})$#', $path, $m)) {
        return $m[1];
    }

    return null;
}

/** Spotify: accept a link, return "<kind>/<id>". */
function normalise_spotify(string $input): ?string
{
    $raw = trim($input);
    if ($raw === '') {
        return null;
    }

    $url = str_starts_with($raw, 'http') ? $raw : "https://{$raw}";
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    $path = (string) parse_url($url, PHP_URL_PATH);

    // open.spotify.com, play.spotify.com, spotify.link, open.spotify.co.uk, …
    if (!str_contains($host, 'spotify') && !str_contains($host, 'spoti.fi')) {
        return null;
    }

    if (!preg_match('#^/(track|playlist|album|episode|show)/([A-Za-z0-9]{22})#', $path, $m)) {
        return null;
    }

    return "{$m[1]}/{$m[2]}";
}

try {
    require_auth();
    $cols = track_columns();

    switch (request_method()) {
        // ------------------------------------------------------------------
        case 'GET':
            $rows = db_all(
                "select {$cols} from audio_tracks order by position asc, created_at asc"
            );
            json_ok($rows);

        // ------------------------------------------------------------------
        case 'POST':
            $body = json_body();

            $v = new Validator($body);
            $v->text('title', 255, true, 1);
            $v->enum('source_type', TRACK_TYPES, true);
            $v->text('source', 2000, true, 1);

            if ($v->fails()) {
                fail_validation($v->errors());
            }

            $c = $v->values();
            $type = $c['source_type'];

            // Re-derive the normalised source server-side.
            switch ($type) {
                case 'youtube':
                    $id = normalise_youtube($c['source']);
                    if ($id === null) {
                        json_error('invalid_source', "That doesn't look like a YouTube link.", 422);
                    }
                    $source = $id;
                    break;

                case 'spotify':
                    $ref = normalise_spotify($c['source']);
                    if ($ref === null) {
                        json_error('invalid_source', "That doesn't look like a Spotify link.", 422);
                    }
                    $source = $ref;
                    break;

                default: // file
                    $source = (string) $c['source'];
                    if (!preg_match('#^https?://#i', $source)) {
                        json_error('invalid_source', 'An audio track needs a direct link or an upload.', 422);
                    }
                    break;
            }

            $position = (int) db_value('select coalesce(max(position), -1) + 1 from audio_tracks');

            $id = db_insert(
                'insert into audio_tracks (title, source_type, source, storage_path, position)
                 values (:t, :type, :src, :path, :pos)
                 returning id',
                [
                    't'    => $c['title'],
                    'type' => $type,
                    'src'  => $source,
                    'path' => null, // set by the client after an upload, if any
                    'pos'  => $position,
                ]
            );

            log_info('track added', ['id' => $id, 'type' => $type]);
            json_ok(db_one("select {$cols} from audio_tracks where id = :id", ['id' => $id]), 201);

        // ------------------------------------------------------------------
        case 'PATCH':
            // Used to attach storage_path after a direct upload, so deleting
            // the row later can also remove the stored object.
            $body = json_body();

            $id = new Validator($body);
            $id->uuid('id', true);
            if ($id->fails()) {
                fail_validation($id->errors());
            }
            $trackId = $id->values()['id'];

            $existing = db_one('select id, source_type from audio_tracks where id = :id', ['id' => $trackId]);
            if ($existing === null) {
                json_error('not_found', "That track doesn't exist.", 404);
            }

            if (!array_key_exists('storage_path', $body)) {
                json_error('nothing_to_update', 'No changes were supplied.', 400);
            }

            $u = new Validator($body);
            $u->text('storage_path', 300, false);

            if ($u->fails()) {
                fail_validation($u->errors());
            }

            $path = $u->values()['storage_path'] ?? '';
            if ($path !== '' && !storage_path_is_safe($path)) {
                json_error('invalid_source', 'That storage path is not valid.', 422);
            }

            db_run(
                'update audio_tracks set storage_path = :p where id = :id',
                ['p' => $path ?: null, 'id' => $trackId]
            );

            json_ok(db_one("select {$cols} from audio_tracks where id = :id", ['id' => $trackId]));

        // ------------------------------------------------------------------
        case 'DELETE':
            $v = new Validator(json_body());
            $v->uuid('id', true);
            if ($v->fails()) {
                fail_validation($v->errors());
            }
            $trackId = $v->values()['id'];

            $existing = db_one(
                'select storage_path from audio_tracks where id = :id',
                ['id' => $trackId]
            );

            db_run('delete from audio_tracks where id = :id', ['id' => $trackId]);

            // Only delete the object if we uploaded it. A YouTube id or an
            // external URL has nothing of ours to remove.
            if ($existing !== null && !empty($existing['storage_path'])) {
                storage_delete((string) $existing['storage_path']);
            }

            log_info('track removed', ['id' => $trackId]);
            json_ok(['deleted' => true, 'id' => $trackId]);

        default:
            require_method('GET', 'POST', 'PATCH', 'DELETE');
    }
} catch (Throwable $e) {
    json_fatal($e);
}