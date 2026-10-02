<?php
declare(strict_types=1);

/**
 * App settings — anchor date, titles, and the music bar's remembered volume.
 *
 *   GET   /api/settings   read
 *   PATCH /api/settings   update
 *   POST  /api/settings   change the passcode (current passcode required)
 *
 * `passcode_hash` is never returned. Only the derived fact that a passcode
 * exists is exposed, via /api/auth.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/validate.php';

/** Keys the client may read. passcode_hash is deliberately absent. */
const PUBLIC_KEYS = ['anchor_date', 'site_title', 'partner_names', 'music_volume'];

/** Keys the client may write. Deliberately excludes passcode_hash. */
const WRITABLE_KEYS = ['anchor_date', 'site_title', 'partner_names', 'music_volume'];

/** Defaults applied when a row is missing. */
const SETTING_DEFAULTS = [
    'anchor_date'   => '',
    'site_title'    => 'Our Little World',
    'partner_names' => 'You & Me',
    'music_volume'  => '0.7',
];

function settings_read(): array
{
    $rows = db_all('select key, value from app_settings');
    $found = [];
    foreach ($rows as $row) {
        $found[$row['key']] = (string) $row['value'];
    }

    $out = [];
    foreach (PUBLIC_KEYS as $key) {
        $out[$key] = $found[$key] ?? SETTING_DEFAULTS[$key];
    }
    return $out;
}

try {
    require_auth();

    switch (request_method()) {
        // ------------------------------------------------------------------
        case 'GET':
            json_ok(settings_read());

        // ------------------------------------------------------------------
        case 'PATCH':
            $body = json_body();

            // Reject anything not on the allowlist BEFORE validating, so an
            // unknown key is a clear error rather than being silently ignored.
            foreach (array_keys($body) as $key) {
                if (!in_array($key, WRITABLE_KEYS, true)) {
                    json_error('unknown_setting', "That setting can't be changed here.", 422);
                }
            }

            $v = new Validator($body);

            if (array_key_exists('anchor_date', $body)) {
                $v->date('anchor_date', false);
            }
            if (array_key_exists('site_title', $body)) {
                $v->text('site_title', 120, false);
            }
            if (array_key_exists('partner_names', $body)) {
                $v->text('partner_names', 120, false);
            }
            if (array_key_exists('music_volume', $body)) {
                $v->int('music_volume', 70, 0, 100);
                // Store as a 0..1 fraction to match the slider's range.
                $v->set('music_volume', (string) ((int) $v->values()['music_volume'] / 100));
            }

            if ($v->fails()) {
                fail_validation($v->errors());
            }

            $written = [];
            foreach ($v->values() as $key => $value) {
                if (!in_array($key, WRITABLE_KEYS, true)) {
                    continue;
                }
                setting_set($key, (string) $value);
                $written[] = $key;
            }

            if ($written === []) {
                json_error('nothing_to_update', 'No changes were supplied.', 400);
            }

            log_info('settings updated', ['keys' => $written]);
            json_ok(settings_read());

        // ------------------------------------------------------------------
        case 'POST':
            // Passcode change. Separate verb from PATCH because it needs the
            // CURRENT passcode, and mixing it into a settings patch would let
            // a stolen session lock you out of your own app.
            $body = json_body();

            $v = new Validator($body);
            $v->text('current_passcode', 200, true, 1);
            $v->text('new_passcode', 200, true, 4);

            if ($v->fails()) {
                fail_validation($v->errors());
            }

            $c = $v->values();

            if (!passcode_verify((string) $c['current_passcode'])) {
                json_error('invalid_passcode', "That isn't our current passcode.", 401);
            }

            if ((string) $c['current_passcode'] === (string) $c['new_passcode']) {
                json_error('same_passcode', 'Choose a different passcode.', 422);
            }

            passcode_set((string) $c['new_passcode']);
            session_issue(true);

            log_info('passcode changed');
            json_ok(['changed' => true]);

        default:
            require_method('GET', 'PATCH', 'POST');
    }
} catch (Throwable $e) {
    json_fatal($e);
}