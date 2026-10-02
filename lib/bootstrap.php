<?php
declare(strict_types=1);

/**
 * Bootstrap — loaded first by every endpoint.
 *
 * Responsibilities: environment, error policy, security headers, and the
 * shared helpers every endpoint needs.
 *
 * LOCAL DEV ONLY: Vercel injects real environment variables, so the .env
 * parser below is a no-op in production. It exists so `php -S` works without
 * extra tooling.
 */

// ---------------------------------------------------------------------------
// Errors
//
// display_errors must stay OFF: a PHP notice would otherwise be echoed into a
// JSON response and break the client's parser, and stack traces leak paths.
// Everything goes to the function log instead.
// ---------------------------------------------------------------------------
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

mb_internal_encoding('UTF-8');

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
if (!function_exists('rmb_load_env')) {
    /**
     * Parse .env into getenv()-visible values. Real environment variables
     * always win, so this can never override Vercel's injected config.
     */
    function rmb_load_env(): void
    {
        $file = dirname(__DIR__) . '/.env';
        if (!is_readable($file)) {
            return;
        }

        $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            $eq = strpos($line, '=');
            if ($eq === false) {
                continue;
            }

            $key = trim(substr($line, 0, $eq));
            $value = trim(substr($line, $eq + 1));

            // Strip an unquoted trailing comment.
            if ($value !== '' && $value[0] !== '"' && $value[0] !== "'") {
                $hash = strpos($value, ' #');
                if ($hash !== false) {
                    $value = rtrim(substr($value, 0, $hash));
                }
            }
            $value = trim($value, "\"'");

            if (getenv($key) === false) {
                putenv("$key=$value");
                $_ENV[$key] = $value;
            }
        }
    }
}

/** Required env var, or a clear 500 rather than a confusing failure later. */
function rmb_env(string $key): string
{
    $value = getenv($key);
    if ($value === false || $value === '') {
        throw new RuntimeException("Missing required environment variable: {$key}");
    }
    return $value;
}

function rmb_env_optional(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    return ($value === false || $value === '') ? $default : $value;
}

rmb_load_env();

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
if (!headers_sent()) {
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('X-Frame-Options: SAMEORIGIN');
    // No inline event handlers are used. Alpine and Cropper are vendored
    // locally, so scripts are same-origin only. 'unsafe-inline' is required
    // for Alpine's x-* attribute evaluation.
    header(
        "Content-Security-Policy: default-src 'self'; "
        . "img-src 'self' data: blob: https:; "
        . "media-src 'self' blob: data: https:; "
        . "font-src 'self' https://fonts.gstatic.com; "
        . "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        . "script-src 'self' 'unsafe-inline'; "
        . "connect-src 'self' https://*.supabase.co; "
        . "frame-src https://www.youtube-nocookie.com https://www.youtube.com; "
        . "base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    );
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Escape for HTML output. Every user-authored string must pass through this. */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Constant-time comparison wrapper. */
function secure_equals(string $a, string $b): bool
{
    return hash_equals($a, $b);
}

function is_https(): bool
{
    if (($_SERVER['HTTPS'] ?? '') !== '' && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') {
        return true;
    }
    return false;
}

/** Request id, so a failed request can be traced in the function logs. */
function request_id(): string
{
    static $id = null;
    if ($id === null) {
        $id = bin2hex(random_bytes(6));
    }
    return $id;
}

function log_error(string $message, array $context = []): void
{
    write_log('ERROR', $message, $context);
}

function log_info(string $message, array $context = []): void
{
    write_log('INFO', $message, $context);
}

/**
 * Single logging sink. Writes to the function log (stderr), never to the
 * response body — a stray log line would corrupt the JSON envelope.
 */
function write_log(string $level, string $message, array $context = []): void
{
    $line = sprintf(
        '[%s] %s %s %s',
        date('c'),
        $level,
        $message,
        $context ? json_encode($context, JSON_UNESCAPED_SLASHES) : ''
    );
    error_log($line);
}