<?php
declare(strict_types=1);

/**
 * Sign out — clears the session cookie.
 *
 *   POST /api/auth-logout
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/auth.php';

try {
    require_method('POST');
    session_clear();
    json_ok(['authenticated' => false]);
} catch (Throwable $e) {
    json_fatal($e);
}