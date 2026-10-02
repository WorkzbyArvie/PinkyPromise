<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

/**
 * JSON responses and request parsing.
 *
 * Every endpoint speaks the same envelope: { ok, data } or { ok, error }.
 * The client (js/api.js) branches on `ok`, so keeping one shape everywhere
 * means the frontend only has to understand one contract.
 */

/** Emit a success payload and stop. */
function json_ok(mixed $data = null, int $status = 200): never
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode(
        ['ok' => true, 'data' => $data],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

/**
 * Emit an error payload and stop.
 *
 * @param string $code    machine-readable slug the client can branch on
 * @param string $message human-readable, safe to show the visitor
 * @param int    $status  HTTP status
 * @param array  $details optional per-field messages
 */
function json_error(string $code, string $message, int $status = 400, array $details = []): never
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }

    $error = ['code' => $code, 'message' => $message];
    if ($details !== []) {
        $error['fields'] = $details;
    }

    echo json_encode(
        ['ok' => false, 'error' => $error],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

/**
 * Unexpected exception handler: log the detail, return something generic.
 * Stack traces and SQL must never reach the browser.
 */
function json_fatal(Throwable $e): never
{
    log_error('unhandled exception', [
        'type' => $e::class,
        'message' => $e->getMessage(),
        'file' => $e->getFile() . ':' . $e->getLine(),
        'request_id' => request_id(),
    ]);

    $message = 'Something went wrong on our side.';
    if ($e instanceof PDOException) {
        $message = "Couldn't reach the database.";
    }

    json_error('server_error', $message, 500);
}

function request_method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

/** Restrict an endpoint to specific verbs. */
function require_method(string ...$allowed): void
{
    if (!in_array(request_method(), $allowed, true)) {
        header('Allow: ' . implode(', ', $allowed));
        json_error('method_not_allowed', 'That request method is not supported here.', 405);
    }
}

/**
 * Parse the JSON request body.
 *
 * Returns an associative array. Throws a ValidationError on malformed input so
 * callers get a 400 rather than a 500.
 */
function json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    // Reject an oversized body before spending memory on json_decode.
    if (strlen($raw) > 1_048_576) {
        json_error('payload_too_large', 'That request was too large.', 413);
    }

    $decoded = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        json_error('invalid_json', 'The request body was not valid JSON.');
    }
    if (!is_array($decoded)) {
        json_error('invalid_json', 'The request body must be a JSON object.');
    }

    return $decoded;
}

/** Read a query-string parameter with a default. */
function query_param(string $key, ?string $default = null): ?string
{
    $value = $_GET[$key] ?? null;
    return is_string($value) && $value !== '' ? $value : $default;
}

function int_param(string $key, int $default): int
{
    $value = $_GET[$key] ?? null;
    return is_string($value) && $value !== '' ? (int) $value : $default;
}

/** True when the request wants JSON (it always does here, but keeps intent clear). */
function wants_json(): bool
{
    return true;
}