<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

/**
 * Postgres access.
 *
 * CONNECTION MODE — this matters more than it looks:
 *
 * Supabase's transaction-mode pooler (port 6543) multiplexes many clients onto
 * a small set of Postgres backends. Two consequences:
 *
 *   1. PDO::ATTR_EMULATE_PREPARES MUST be true. Real server-side prepared
 *      statements are bound to one backend connection, which does not survive
 *      being handed to a different backend mid-request. Emulated prepares
 *      build the SQL locally with properly quoted values, which is still
 *      injection-safe.
 *
 *   2. Never hold a transaction across a request, and never rely on session
 *      state (SET, temp tables, LISTEN). One request may span several backends.
 *
 * This is why the local Node tooling (scripts/db.mjs) retries: the pooler drops
 * idle connections aggressively.
 */

/**
 * Convert a connection URL into a PDO DSN plus credentials.
 *
 * PDO does NOT accept a postgresql:// URL as a DSN. It reads the scheme as a
 * driver name, looks for a driver called "postgresql" (which does not exist —
 * it is called "pgsql"), and fails with "could not find driver" even though the
 * driver is perfectly available. So the URL must be unpacked into
 * `pgsql:host=…;port=…;dbname=…` plus a separate username and password.
 *
 * @return array{dsn:string, user:?string, pass:?string}
 */
function db_parse_url(string $url): array
{
    $parts = parse_url($url);
    if ($parts === false || !isset($parts['host'])) {
        throw new RuntimeException('DATABASE_URL is not a valid connection URL.');
    }

    $host = $parts['host'];
    $port = (int) ($parts['port'] ?? 5432);
    $dbname = ltrim($parts['path'] ?? '', '/');

    if ($dbname === '') {
        throw new RuntimeException('DATABASE_URL is missing a database name.');
    }

    // Query params such as sslmode=require become DSN entries.
    $options = [];
    if (isset($parts['query'])) {
        parse_str($parts['query'], $query);
        foreach ($query as $key => $value) {
            if (is_string($key) && is_scalar($value)) {
                $options[$key] = (string) $value;
            }
        }
    }

    $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s', $host, $port, $dbname);
    foreach ($options as $key => $value) {
        $dsn .= sprintf(';%s=%s', $key, $value);
    }

    return [
        'dsn'  => $dsn,
        'user' => isset($parts['user']) ? rawurldecode($parts['user']) : null,
        'pass' => isset($parts['pass']) ? rawurldecode($parts['pass']) : null,
    ];
}

/**
 * Shared PDO handle for the request.
 *
 * RETRIES ARE NOT OPTIONAL HERE. The transaction-mode pooler (6543)
 * multiplexes many clients onto few Postgres backends and drops idle
 * connections, so a fresh connection fails intermittently with "server closed
 * the connection unexpectedly". Without a retry, roughly every other cold
 * request would 503. The local Node tooling (scripts/db.mjs) has the same
 * retry logic for the same reason.
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    try {
        $config = db_parse_url(rmb_env('DATABASE_URL'));
    } catch (RuntimeException $e) {
        log_error('db config invalid', ['message' => $e->getMessage()]);
        json_error('db_unavailable', "The database isn't configured correctly.", 503);
    }

    // Supabase requires TLS. Default it on when the URL doesn't say.
    if (!str_contains($config['dsn'], 'sslmode=')) {
        $config['dsn'] .= ';sslmode=require';
    }

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        // Required for the transaction pooler — see the note above.
        PDO::ATTR_EMULATE_PREPARES   => true,
        PDO::ATTR_STRINGIFY_FETCHES  => false,
        // Fail fast rather than hanging a function invocation.
        PDO::ATTR_TIMEOUT            => 10,
    ];

    $attempts = 4;
    $lastError = null;

    for ($attempt = 1; $attempt <= $attempts; $attempt++) {
        try {
            $pdo = new PDO($config['dsn'], $config['user'], $config['pass'], $options);
            if ($attempt > 1) {
                log_info('db connected after retry', ['attempt' => $attempt]);
            }
            return $pdo;
        } catch (PDOException $e) {
            $lastError = $e;

            // Only retry transport-level failures. A bad password or a missing
            // database will not fix itself, and retrying just burns the
            // function's time budget.
            $transient = preg_match(
                '/server closed|terminated|connection|timeout|SSL|could not connect|too many clients/i',
                $e->getMessage()
            ) === 1;

            if (!$transient || $attempt === $attempts) {
                break;
            }

            usleep($attempt * 250000); // 0.25s, 0.5s, 0.75s
        }
    }

    log_error('db connect failed', [
        'message' => $lastError?->getMessage(),
        'code'    => $lastError?->getCode(),
    ]);
    json_error('db_unavailable', "Couldn't reach the database.", 503);
}

/** Run a statement and return the statement handle. */
function db_run(string $sql, array $params = []): PDOStatement
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}

/** All matching rows. */
function db_all(string $sql, array $params = []): array
{
    return db_run($sql, $params)->fetchAll();
}

/** First matching row, or null. */
function db_one(string $sql, array $params = []): ?array
{
    $row = db_run($sql, $params)->fetch();
    return $row === false ? null : $row;
}

/** A single scalar from the first row. */
function db_value(string $sql, array $params = []): mixed
{
    $row = db_run($sql, $params)->fetch(PDO::FETCH_NUM);
    return $row === false ? null : $row[0];
}

/**
 * Insert and return the new row's id.
 *
 * NOTE: PDO::lastInsertId() is MySQL/SQLite only and does not exist usefully in
 * Postgres, so this uses a RETURNING clause instead. If the INSERT statement
 * you pass has no RETURNING clause the value comes back empty.
 */
function db_insert(string $sql, array $params = []): string
{
    $row = db_one($sql, $params);
    if ($row === null) {
        return '';
    }
    return (string) ($row['id'] ?? reset($row));
}

/**
 * Settings key/value helpers. Small enough to sit here rather than
 * earn their own module.
 */
function setting_get(string $key, string $default = ''): string
{
    $value = db_value('select value from app_settings where key = :k', ['k' => $key]);
    return $value === null ? $default : (string) $value;
}

function setting_set(string $key, string $value): void
{
    db_run(
        'insert into app_settings (key, value) values (:k, :v)
         on conflict (key) do update set value = excluded.value',
        ['k' => $key, 'v' => $value]
    );
}

/** True when the database answers a trivial query. Used by /api/health. */
function db_is_healthy(): bool
{
    try {
        return db_value('select 1') === 1;
    } catch (Throwable) {
        return false;
    }
}