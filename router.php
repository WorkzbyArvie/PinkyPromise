<?php
declare(strict_types=1);

/**
 * Local development front controller.
 *
 *   php -S 127.0.0.1:8000 -t public router.php
 *
 * The `-t public` is REQUIRED, not cosmetic. PHP's built-in server resolves a
 * router script's `return false` against its document root. Without -t, the
 * docroot is the repo root, `return false` looks for webapp/css/app.css
 * (which moved into public/), the file is not found, and every static request
 * falls through to the HTML shell below — so /css/app.css serves HTML and the
 * page renders unstyled. This mirrors Vercel, where public/ is the
 * outputDirectory.
 *
 * Mimics the Vercel routing rules so the app behaves the same locally:
 *
 *   /            -> index.html
 *   /css/app.css, /js/*.js, /audio/*  -> served as static files
 *   /api/health  -> api/health.php
 *   /api/cards   -> api/cards.php      (cleanUrls: true strips the extension)
 *
 * NOT deployed — .vercelignore excludes it.
 */

// Resolved against __DIR__, not getcwd(), so the script works regardless of
// where the server was launched from.
$root = __DIR__;

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = rawurldecode($path);

// ---------------------------------------------------------------------------
// API routing
// ---------------------------------------------------------------------------
if (str_starts_with($path, '/api/')) {
    $name = basename($path, '.php');

    // Reject anything that isn't a plain filename — no traversal, no nesting.
    if (!preg_match('/^[a-z0-9-]+$/', $name)) {
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode([
            'ok' => false,
            'error' => ['code' => 'not_found', 'message' => 'Unknown endpoint.'],
        ]);
        return true;
    }

    $file = $root . '/api/' . $name . '.php';
    if (is_file($file)) {
        // The endpoint sets its own headers and calls exit.
        require $file;
        return true;
    }

    http_response_code(404);
    header('Content-Type: application/json');
    echo json_encode([
        'ok' => false,
        'error' => ['code' => 'not_found', 'message' => 'Unknown endpoint.'],
    ]);
    return true;
}

// ---------------------------------------------------------------------------
// Static files
//
// Returning false hands the request back to the built-in server, which resolves
// it against the document root. That is why the server must be started with
// -t public (see the note at the top of this file).
// ---------------------------------------------------------------------------
return false;