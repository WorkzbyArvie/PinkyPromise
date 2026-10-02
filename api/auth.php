<?php
declare(strict_types=1);

/**
 * Authentication status and passcode login.
 *
 *   GET  /api/auth  -> { authenticated, passcode_set }
 *   POST /api/auth  -> set the session cookie
 *
 * GET is unauthenticated on purpose: the lock screen has to know whether a
 * passcode has ever been configured, and whether the visitor is already in.
 * It deliberately reveals nothing else.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/auth.php';

try {
    switch (request_method()) {
        case 'GET':
            $set = passcode_is_set();
            $session = current_session();

            json_ok([
                'authenticated' => $set && $session !== null && session_matches_current_passcode($session),
                'passcode_set'   => $set,
            ]);

        case 'POST':
            if (!passcode_is_set()) {
                json_error(
                    'not_initialised',
                    'No passcode has been set up yet. Run the bootstrap step first.',
                    503
                );
            }

            login_throttle_delay();

            $body = json_body();
            $passcode = is_string($body['passcode'] ?? null) ? (string) $body['passcode'] : '';

            if ($passcode === '') {
                json_error('validation_failed', 'Please enter the passcode.', 422);
            }

            if (!passcode_verify($passcode)) {
                log_info('failed login attempt', [
                    'ip_hash' => substr(hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? '')), 0, 16),
                ]);
                // Same message either way: don't reveal whether the passcode
                // exists, only that this attempt failed.
                json_error('invalid_passcode', "That isn't our passcode. Try again.", 401);
            }

            $remember = !array_key_exists('remember', $body) || (bool) $body['remember'];
            session_issue($remember);

            log_info('login ok');
            json_ok(['authenticated' => true, 'expires_in_days' => $remember ? SESSION_TTL_DAYS : 0]);

        default:
            require_method('GET', 'POST');
    }
} catch (Throwable $e) {
    json_fatal($e);
}