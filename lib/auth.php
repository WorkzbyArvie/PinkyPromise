<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/http.php';

/**
 * Authentication.
 *
 * The passcode is stored as a bcrypt hash in Postgres and never leaves the
 * server. On success we issue a STATELESS session: an HMAC-signed cookie, so
 * there is no session table to keep in sync across serverless instances.
 *
 * Cookie format:  base64url(payload) . "." . base64url(hmac)
 *   payload = {"uid":<uuid>,"exp":<unix>}
 *   hmac    = HMAC-SHA256(payload, SESSION_SECRET)
 *
 * Tampering changes the payload, which invalidates the signature. Expiry is
 * enforced both in the payload and against the cookie's own lifetime.
 */

const SESSION_COOKIE   = 'rmb_session';
const SESSION_TTL_DAYS = 30;
const SESSION_ID       = 'owner';

/** Default window when the visitor does not ask to be remembered. */
const SESSION_TTL_SESSION = 0;

function base64url_encode(string $raw): string
{
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function base64url_decode(string $encoded): string|false
{
    $padded = strtr($encoded, '-_', '+/');
    $remainder = strlen($padded) % 4;
    if ($remainder !== 0) {
        $padded .= str_repeat('=', 4 - $remainder);
    }
    return base64_decode($padded, true);
}

/** Build the signed token string for a payload. */
function session_sign(array $payload): string
{
    $body = base64url_encode(json_encode($payload, JSON_THROW_ON_ERROR));
    $secret = rmb_env('SESSION_SECRET');
    $sig = base64url_encode(hash_hmac('sha256', $body, $secret, true));
    return "{$body}.{$sig}";
}

/**
 * Verify a token and return its payload, or null if invalid/expired.
 */
function session_verify(?string $token): ?array
{
    if ($token === null || $token === '') {
        return null;
    }

    $parts = explode('.', $token);
    if (count($parts) !== 2) {
        return null;
    }

    [$body, $sig] = $parts;

    $secret = rmb_env('SESSION_SECRET');
    $expected = base64url_encode(hash_hmac('sha256', $body, $secret, true));

    // Constant time, so a wrong signature can't be brute-forced byte by byte.
    if (!secure_equals($expected, $sig)) {
        return null;
    }

    $json = base64url_decode($body);
    if ($json === false) {
        return null;
    }

    $payload = json_decode($json, true);
    if (!is_array($payload) || !isset($payload['exp'], $payload['uid'])) {
        return null;
    }
    if (!is_int($payload['exp']) || $payload['exp'] <= time()) {
        return null;
    }

    return $payload;
}

function session_cookie_value(): ?string
{
    return $_COOKIE[SESSION_COOKIE] ?? null;
}

/** Current session payload, or null. */
function current_session(): ?array
{
    return session_verify(session_cookie_value());
}

/**
 * Gate an endpoint. Sends 401 and stops when there is no valid session.
 *
 * Every read AND write endpoint calls this — the lock screen is a real gate,
 * not a decoration.
 */
function require_auth(): array
{
    $session = current_session();
    if ($session === null) {
        json_error('unauthenticated', 'Please enter the passcode.', 401);
    }
    if (!session_matches_current_passcode($session)) {
        // Signed, unexpired, but minted under a previous passcode.
        session_clear();
        json_error('unauthenticated', 'Please enter the passcode.', 401);
    }
    return $session;
}

/** Set the session cookie. */
function session_issue(bool $remember = true): void
{
    $ttl = $remember ? SESSION_TTL_DAYS * 86400 : SESSION_TTL_SESSION;

    $payload = [
        'uid' => SESSION_ID,
        'exp' => time() + $ttl,
        // A remembered session outlives a password change, so bind it to the
        // hash. Changing the passcode silently invalidates old cookies.
        'ph'  => substr(setting_get('passcode_hash', ''), 0, 16),
    ];

    $token = session_sign($payload);

    $options = [
        'expires'  => $remember ? time() + $ttl : 0,
        'path'     => '/',
        'secure'   => is_https(),
        'httponly' => true,   // never readable from JavaScript
        'samesite' => 'Lax',  // blocks cross-site POST, which is every write
    ];

    setcookie(SESSION_COOKIE, $token, $options);
}

/** Expire the cookie. */
function session_clear(): void
{
    setcookie(SESSION_COOKIE, '', [
        'expires'  => 1,
        'path'     => '/',
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/**
 * Reject a session issued before the current passcode was set.
 *
 * The session carries a short fingerprint of the passcode hash. Changing the
 * passcode changes that fingerprint, so every cookie minted under the old one
 * stops validating immediately — no session table required.
 */
function session_matches_current_passcode(array $session): bool
{
    $current = setting_get('passcode_hash', '');
    if ($current === '') {
        return false; // no passcode configured yet
    }
    return secure_equals(
        (string) ($session['ph'] ?? ''),
        substr($current, 0, 16)
    );
}

/** True once a passcode has been configured. */
function passcode_is_set(): bool
{
    return setting_get('passcode_hash', '') !== '';
}

/** Create or replace the passcode. */
function passcode_set(string $plaintext): void
{
    $hash = password_hash($plaintext, PASSWORD_BCRYPT, ['cost' => 12]);
    if ($hash === false) {
        throw new RuntimeException('Could not hash the passcode.');
    }
    setting_set('passcode_hash', $hash);
}

function passcode_verify(string $plaintext): bool
{
    $hash = setting_get('passcode_hash', '');
    if ($hash === '') {
        return false;
    }
    return password_verify($plaintext, $hash);
}

/**
 * Change the passcode, optionally supplying the current one.
 * Returns null on success, or a human-readable reason for refusal.
 */
function passcode_change(string $current, string $next): ?string
{
    if (!passcode_verify($current)) {
        return "That isn't our current passcode.";
    }
    if (strlen($next) < 4) {
        return 'The new passcode must be at least 4 characters.';
    }
    if (strlen($next) > 200) {
        return 'That passcode is too long.';
    }
    passcode_set($next);
    // Re-issue so the caller keeps access with the new binding.
    session_issue(true);
    return null;
}

/**
 * Rate-limit login attempts.
 *
 * Serverless instances are ephemeral, so an in-memory counter cannot work.
 * This is a best-effort delay to blunt online guessing rather than a hard
 * limit; for a real ceiling, use Vercel Attack Challenge Mode or a WAF rule
 * on /api/auth.
 */
function login_throttle_delay(): void
{
    $key = 'rmb_login_' . substr(hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown')), 0, 32);
    $file = sys_get_temp_dir() . '/' . $key;

    $now = time();
    $entries = [];
    if (is_readable($file)) {
        $raw = @file_get_contents($file);
        if ($raw !== false) {
            $entries = array_filter(array_map('intval', explode(',', $raw)));
        }
    }

    $entries = array_values(array_filter($entries, static fn (int $t): bool => $t > $now - 60));

    if (count($entries) >= 8) {
        // Sleep once; do not sleep in a loop.
        sleep(2);
    }

    $entries[] = $now;
    @file_put_contents($file, implode(',', $entries));
}