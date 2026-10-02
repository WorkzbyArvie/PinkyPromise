<?php
declare(strict_types=1);

/**
 * One-time setup: sets the passcode and the countdown anchor date.
 *
 *   POST /api/auth-bootstrap
 *   Header: x-setup-token: <APP_SETUP_TOKEN>
 *   Body:   { passcode, anchor_date?, site_title?, partner_names? }
 *
 * Two independent gates stop someone else claiming your app first:
 *   1. the APP_SETUP_TOKEN env var, which lives only in Vercel settings
 *   2. passcode_hash must still be empty — once set, this endpoint is closed
 *      permanently. Rotating the passcode is a different, authenticated flow.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/validate.php';

try {
    require_method('POST');

    // Verify the token FIRST, then check whether setup is still needed.
    //
    // The reverse order would let anyone who cannot read APP_SETUP_TOKEN
    // discover whether the app is bootstrapped, just by calling this endpoint.
    // Checking the token first means an unauthorised caller learns nothing.
    $expected = rmb_env_optional('APP_SETUP_TOKEN');
    if ($expected === null || $expected === '') {
        json_error(
            'setup_disabled',
            'APP_SETUP_TOKEN is not configured, so setup is disabled.',
            503
        );
    }

    $provided = $_SERVER['HTTP_X_SETUP_TOKEN'] ?? '';
    if (!is_string($provided) || !secure_equals($expected, $provided)) {
        log_info('bootstrap rejected: bad setup token');
        json_error('forbidden', 'That setup token is not valid.', 403);
    }

    if (passcode_is_set()) {
        json_error(
            'already_initialised',
            'A passcode is already set for this app.',
            409
        );
    }

    $body = json_body();

    $v = new Validator($body);
    $v->text('passcode', 200, true, 4);
    $v->date('anchor_date', false);
    $v->text('site_title', 120, false);
    $v->text('partner_names', 120, false);

    if ($v->fails()) {
        fail_validation($v->errors());
    }

    $values = $v->values();

    passcode_set((string) $values['passcode']);

    foreach ([
        'anchor_date'   => $values['anchor_date'] ?? '',
        'site_title'    => $values['site_title'] ?? 'Our Little World',
        'partner_names' => $values['partner_names'] ?? 'You & Me',
    ] as $key => $value) {
        if ((string) $value !== '') {
            setting_set($key, (string) $value);
        }
    }

    // Log the visitor straight in — they just proved they own this install.
    session_issue(true);

    log_info('bootstrap completed');
    json_ok([
        'initialised' => true,
        'anchor_date' => setting_get('anchor_date'),
    ], 201);

} catch (Throwable $e) {
    json_fatal($e);
}