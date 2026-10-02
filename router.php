<?php
declare(strict_types=1);

/**
 * Local development front controller.
 *
 *   php -S localhost:8000 router.php
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
// ---------------------------------------------------------------------------
$candidate = realpath($root . $path);

if ($candidate !== false && is_file($candidate) && str_starts_with($candidate, $root)) {
    // Returning false tells the built-in server to serve the file itself,
    // which is faster than re-reading it in PHP.
    return false;
}

// Directory request -> index.html
if (is_dir($candidate) && is_file($candidate . '/index.html')) {
    return false;
}

// Unknown path -> the app shell, so client routing can handle it.
readfile($root . '/index.html');
return true;