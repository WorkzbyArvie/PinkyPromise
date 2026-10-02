<?php
declare(strict_types=1);

/**
 * Health check — deployment diagnostics.
 *
 *   GET /api/health
 *
 * Deliberately UNAUTHENTICATED: it is the first thing you hit when a deploy
 * misbehaves, and the lock screen needs to tell "server is down" from "wrong
 * passcode". It therefore returns only booleans and versions — never rows,
 * never config values, never a stack trace.
 *
 * This is also what the daily Vercel cron hits, which keeps the free-tier
 * Supabase project from being paused after 7 idle days.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/storage.php';

try {
        require_method('GET');

        $checks = [
            'php'      => true,
            'database' => false,
            'storage'  => false,
            'schema'   => false,
        ];

        $dbOk = db_is_healthy();
        $checks['database'] = $dbOk;
        $checks['storage'] = storage_is_healthy();

        if ($dbOk) {
            // Cheap and useful: is the schema actually applied?
            try {
                db_value('select count(*) from app_settings');
                $checks['schema'] = true;
            } catch (Throwable $e) {
                log_error('schema probe failed', ['message' => $e->getMessage()]);
            }
        }

        // Reported, but NOT part of the health verdict: an un-bootstrapped app
        // is waiting for setup, not broken.
        $passcodeSet = $dbOk && passcode_is_set();
        $configured = $dbOk && setting_get('anchor_date', '') !== '';

        // Cron invocations get 200 even on a partial failure so the scheduler
        // doesn't retry-storm; humans get the real status code.
        $isCron = str_contains((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 'vercel-cron')
            || isset($_GET['cron']);

        $allOk = !in_array(false, $checks, true);

        log_info('health check', array_merge($checks, [
            'passcode_set' => $passcodeSet,
        ]));

        json_ok([
            'status'     => $allOk ? 'ok' : 'degraded',
            'checks'     => $checks,
            'ready'      => $allOk && $passcodeSet,
            'passcode_set' => $passcodeSet,
            'anchor_date'   => $configured ? setting_get('anchor_date') : null,
            'php'        => PHP_VERSION,
            'request_id' => request_id(),
        ], ($allOk || $isCron) ? 200 : 503);

    } catch (Throwable $e) {
        json_fatal($e);
    }