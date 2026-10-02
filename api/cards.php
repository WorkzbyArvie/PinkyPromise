<?php
declare(strict_types=1);

/**
 * Memory photocards.
 *
 *   GET    /api/cards[?memory_date=YYYY-MM-DD]  list
 *   POST   /api/cards          create
 *   PATCH  /api/cards          partial update
 *   DELETE /api/cards          delete row + BOTH stored images
 *
 * Deleting removes photo_url AND photo_original_url from storage, not just the
 * row — otherwise every deleted card leaks ~750 KB forever.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/validate.php';
require_once __DIR__ . '/../lib/storage.php';

/** Columns we expose. Never SELECT * on a table a user can influence. */
function card_columns(): string
{
    return 'id, photo_url, photo_original_url, title, letter_text, memory_date, created_at';
}

try {
    require_auth();
    $cols = card_columns();

    switch (request_method()) {
        // ------------------------------------------------------------------
        case 'GET':
            $v = new Validator(['memory_date' => query_param('memory_date') ?? '']);
            $v->date('memory_date', false);
            if ($v->fails()) {
                fail_validation($v->errors());
            }

            $filter = $v->values()['memory_date'] ?? null;

            if ($filter) {
                $rows = db_all(
                    "select {$cols} from photo_cards
                      where memory_date = :d
                      order by memory_date desc, created_at desc",
                    ['d' => $filter]
                );
            } else {
                $rows = db_all("select {$cols} from photo_cards order by created_at desc");
            }

            json_ok($rows);

        // ------------------------------------------------------------------
        case 'POST':
            $body = json_body();

            $v = new Validator($body);
            $v->url('photo_url', true);
            $v->url('photo_original_url', false);
            $v->text('title', 255, true, 1);
            $v->text('letter_text', 20000, true, 1);
            $v->date('memory_date', false);
            $v->set('memory_date', $v->raw('memory_date') ?: null);

            if ($v->fails()) {
                fail_validation($v->errors());
            }

            $c = $v->values();

            $id = db_insert(
                'insert into photo_cards
                     (photo_url, photo_original_url, title, letter_text, memory_date)
                 values (:url, :orig, :title, :letter, :mem)
                 returning id',
                [
                    'url'    => $c['photo_url'],
                    'orig'   => $c['photo_original_url'] ?: null,
                    'title'  => $c['title'],
                    'letter' => $c['letter_text'],
                    'mem'    => $c['memory_date'],
                ]
            );

            log_info('card created', ['id' => $id]);
            json_ok(db_one("select {$cols} from photo_cards where id = :id", ['id' => $id]), 201);

        // ------------------------------------------------------------------
        case 'PATCH':
            $body = json_body();

            $id = new Validator($body);
            $id->uuid('id', true);
            if ($id->fails()) {
                fail_validation($id->errors());
            }
            $cardId = $id->values()['id'];

            $existing = db_one(
                'select id, photo_url, photo_original_url from photo_cards where id = :id',
                ['id' => $cardId]
            );
            if ($existing === null) {
                json_error('not_found', "That memory doesn't exist.", 404);
            }

            // Validate ONLY the fields the caller actually sent, so a partial
            // update cannot blank an untouched column.
            $sets = [];
            $params = ['id' => $cardId];

            $specs = [
                'photo_url'          => 'url',
                'photo_original_url' => 'url',
                'title'              => 'text',
                'letter_text'        => 'text',
                'memory_date'        => 'date',
            ];

            foreach ($specs as $field => $kind) {
                if (!array_key_exists($field, $body)) {
                    continue;
                }

                $u = new Validator($body);
                match ($kind) {
                    'url'  => $u->url($field, $field === 'photo_url'),
                    'text' => $u->text($field, $field === 'title' ? 255 : 20000, true),
                    'date' => $u->date($field, false),
                };

                if ($u->fails()) {
                    fail_validation($u->errors());
                }

                $value = $u->values()[$field] ?? null;
                if ($field === 'photo_original_url' || $field === 'memory_date') {
                    $value = $value === '' ? null : $value;
                }

                $sets[] = "{$field} = :{$field}";
                $params[$field] = $value;
            }

            if ($sets === []) {
                json_error('nothing_to_update', 'No changes were supplied.', 400);
            }

            db_run('update photo_cards set ' . implode(', ', $sets) . ' where id = :id', $params);

            // A re-crop swaps photo_url; drop the superseded object so the
            // bucket doesn't accumulate an orphan on every re-crop.
            if (array_key_exists('photo_url', $params)) {
                $oldPath = storage_path_from_url((string) $existing['photo_url']);
                if ($oldPath !== null) {
                    storage_delete($oldPath);
                    log_info('superseded card image removed', ['path' => $oldPath]);
                }
            }

            json_ok(db_one("select {$cols} from photo_cards where id = :id", ['id' => $cardId]));

        // ------------------------------------------------------------------
        case 'DELETE':
            $v = new Validator(json_body());
            $v->uuid('id', true);
            if ($v->fails()) {
                fail_validation($v->errors());
            }
            $cardId = $v->values()['id'];

            $existing = db_one(
                'select photo_url, photo_original_url from photo_cards where id = :id',
                ['id' => $cardId]
            );
            if ($existing === null) {
                json_error('not_found', "That memory doesn't exist.", 404);
            }

            db_run('delete from photo_cards where id = :id', ['id' => $cardId]);

            foreach (['photo_url', 'photo_original_url'] as $key) {
                if (empty($existing[$key])) {
                    continue;
                }
                $path = storage_path_from_url((string) $existing[$key]);
                if ($path !== null) {
                    storage_delete($path);
                }
            }

            log_info('card deleted', ['id' => $cardId]);
            json_ok(['deleted' => true, 'id' => $cardId]);

        default:
            require_method('GET', 'POST', 'PATCH', 'DELETE');
    }
} catch (Throwable $e) {
    json_fatal($e);
}