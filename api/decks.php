<?php
declare(strict_types=1);

/**
 * Heart decks — the four categorised card sets.
 *
 *   GET    /api/decks[?category=love]   all, or one category
 *   POST   /api/decks                   create
 *   PATCH  /api/decks                   partial update
 *   DELETE /api/decks                   delete
 *
 * GET without a category returns the four buckets keyed by name, so the
 * frontend renders all four tabs from a single request.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/validate.php';

/** Must match the CHECK constraint in db/001_schema.sql. */
const DECK_CATEGORIES = ['sorry', 'appreciation', 'love', 'comfort'];

function deck_columns(): string
{
    return 'id, category, title, content, created_at';
}

try {
    require_auth();
    $cols = deck_columns();

    switch (request_method()) {
        // ------------------------------------------------------------------
        case 'GET':
            $category = query_param('category');

            if ($category !== null) {
                $v = new Validator(['category' => $category]);
                $v->enum('category', DECK_CATEGORIES, true);
                if ($v->fails()) {
                    fail_validation($v->errors());
                }

                $rows = db_all(
                    "select {$cols} from category_cards
                      where category = :c order by created_at desc",
                    ['c' => $v->values()['category']]
                );
                json_ok($rows);
            }

            // All four buckets, always present even when empty, so the client
            // can render tabs without guessing the category list.
            $rows = db_all("select {$cols} from category_cards order by created_at desc");

            $grouped = array_fill_keys(DECK_CATEGORIES, []);
            foreach ($rows as $row) {
                $grouped[$row['category']][] = $row;
            }

            json_ok($grouped);

        // ------------------------------------------------------------------
        case 'POST':
            $body = json_body();

            $v = new Validator($body);
            $v->enum('category', DECK_CATEGORIES, true);
            $v->text('title', 255, true, 1);
            $v->text('content', 20000, true, 1);

            if ($v->fails()) {
                fail_validation($v->errors());
            }

            $c = $v->values();

            $id = db_insert(
                'insert into category_cards (category, title, content)
                 values (:c, :t, :body)
                 returning id',
                ['c' => $c['category'], 't' => $c['title'], 'body' => $c['content']]
            );

            log_info('deck card created', ['id' => $id, 'category' => $c['category']]);
            json_ok(db_one("select {$cols} from category_cards where id = :id", ['id' => $id]), 201);

        // ------------------------------------------------------------------
        case 'PATCH':
            $body = json_body();

            $id = new Validator($body);
            $id->uuid('id', true);
            if ($id->fails()) {
                fail_validation($id->errors());
            }
            $cardId = $id->values()['id'];

            $existing = db_one('select id from category_cards where id = :id', ['id' => $cardId]);
            if ($existing === null) {
                json_error('not_found', "That card doesn't exist.", 404);
            }

            $sets = [];
            $params = ['id' => $cardId];

            if (array_key_exists('category', $body)) {
                $u = new Validator($body);
                $u->enum('category', DECK_CATEGORIES, true);
                if ($u->fails()) {
                    fail_validation($u->errors());
                }
                $sets[] = 'category = :category';
                $params['category'] = $u->values()['category'];
            }

            foreach (['title' => 255, 'content' => 20000] as $field => $max) {
                if (!array_key_exists($field, $body)) {
                    continue;
                }
                $u = new Validator($body);
                $u->text($field, $max, true);
                if ($u->fails()) {
                    fail_validation($u->errors());
                }
                $sets[] = "{$field} = :{$field}";
                $params[$field] = $u->values()[$field];
            }

            if ($sets === []) {
                json_error('nothing_to_update', 'No changes were supplied.', 400);
            }

            db_run('update category_cards set ' . implode(', ', $sets) . ' where id = :id', $params);
            json_ok(db_one("select {$cols} from category_cards where id = :id", ['id' => $cardId]));

        // ------------------------------------------------------------------
        case 'DELETE':
            $v = new Validator(json_body());
            $v->uuid('id', true);
            if ($v->fails()) {
                fail_validation($v->errors());
            }
            $cardId = $v->values()['id'];

            db_run('delete from category_cards where id = :id', ['id' => $cardId]);
            log_info('deck card deleted', ['id' => $cardId]);
            json_ok(['deleted' => true, 'id' => $cardId]);

        default:
            require_method('GET', 'POST', 'PATCH', 'DELETE');
    }
} catch (Throwable $e) {
    json_fatal($e);
}