<?php
declare(strict_types=1);

/**
 * Calendar events.
 *
 *   GET    /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD   list in range
 *   POST   /api/calendar   create
 *   PATCH  /api/calendar   partial update
 *   DELETE /api/calendar   delete
 *
 * The GET range deliberately covers the WHOLE visible grid, including the
 * leading and trailing days from adjacent months, because the calendar renders
 * those dimmed cells with their own markers.
 */

require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/http.php';
require_once __DIR__ . '/../lib/db.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/validate.php';

/** Must match the CHECK constraint in db/001_schema.sql. */
const ICON_TYPES = ['anniversary', 'monthsary', 'date', 'sorry', 'heart'];

/** Widest range we'll serve, so a hand-crafted query can't scan the table. */
const MAX_RANGE_DAYS = 120;

function event_columns(): string
{
    return 'id, event_date, title, description, icon_type, created_at';
}

try {
    require_auth();
    $cols = event_columns();

    switch (request_method()) {
        // ------------------------------------------------------------------
        case 'GET':
            $v = new Validator([
                'from' => query_param('from') ?? '',
                'to'   => query_param('to') ?? '',
            ]);
            $v->date('from', true);
            $v->date('to', true);

            if ($v->fails()) {
                fail_validation($v->errors());
            }

            $from = $v->values()['from'];
            $to   = $v->values()['to'];

            if ($from > $to) {
                [$from, $to] = [$to, $from];
            }

            $days = (int) ((strtotime($to) - strtotime($from)) / 86400);
            if ($days > MAX_RANGE_DAYS) {
                json_error(
                    'range_too_wide',
                    'Ask for a smaller date range.',
                    400
                );
            }

            $events = db_all(
                "select {$cols} from calendar_events
                  where event_date between :from and :to
                  order by event_date asc, created_at asc",
                ['from' => $from, 'to' => $to]
            );

            // Memories with a date in range come back alongside, so one request
            // fills both the markers and the day-popover thumbnails.
            $memories = db_all(
                'select id, photo_url, title, memory_date
                   from photo_cards
                  where memory_date between :from and :to
                  order by memory_date asc',
                ['from' => $from, 'to' => $to]
            );

            json_ok(['events' => $events, 'memories' => $memories, 'from' => $from, 'to' => $to]);

        // ------------------------------------------------------------------
        case 'POST':
            $body = json_body();

            $v = new Validator($body);
            $v->date('event_date', true);
            $v->text('title', 255, true, 1);
            $v->text('description', 4000, false);
            $v->enum('icon_type', ICON_TYPES, true);
            $v->set('description', $v->raw('description') ?: null);

            if ($v->fails()) {
                fail_validation($v->errors());
            }

            $c = $v->values();

            $id = db_insert(
                'insert into calendar_events (event_date, title, description, icon_type)
                 values (:d, :t, :desc, :icon)
                 returning id',
                [
                    'd'    => $c['event_date'],
                    't'    => $c['title'],
                    'desc' => $c['description'],
                    'icon' => $c['icon_type'],
                ]
            );

            log_info('event created', ['id' => $id, 'date' => $c['event_date']]);
            json_ok(db_one("select {$cols} from calendar_events where id = :id", ['id' => $id]), 201);

        // ------------------------------------------------------------------
        case 'PATCH':
            $body = json_body();

            $id = new Validator($body);
            $id->uuid('id', true);
            if ($id->fails()) {
                fail_validation($id->errors());
            }
            $eventId = $id->values()['id'];

            $existing = db_one('select id from calendar_events where id = :id', ['id' => $eventId]);
            if ($existing === null) {
                json_error('not_found', "That event doesn't exist.", 404);
            }

            $sets = [];
            $params = ['id' => $eventId];

            if (array_key_exists('event_date', $body)) {
                $u = new Validator($body);
                $u->date('event_date', true);
                if ($u->fails()) {
                    fail_validation($u->errors());
                }
                $sets[] = 'event_date = :event_date';
                $params['event_date'] = $u->values()['event_date'];
            }

            if (array_key_exists('title', $body)) {
                $u = new Validator($body);
                $u->text('title', 255, true);
                if ($u->fails()) {
                    fail_validation($u->errors());
                }
                $sets[] = 'title = :title';
                $params['title'] = $u->values()['title'];
            }

            if (array_key_exists('description', $body)) {
                $u = new Validator($body);
                $u->text('description', 4000, false);
                if ($u->fails()) {
                    fail_validation($u->errors());
                }
                $sets[] = 'description = :description';
                $params['description'] = $u->values()['description'] ?: null;
            }

            if (array_key_exists('icon_type', $body)) {
                $u = new Validator($body);
                $u->enum('icon_type', ICON_TYPES, true);
                if ($u->fails()) {
                    fail_validation($u->errors());
                }
                $sets[] = 'icon_type = :icon_type';
                $params['icon_type'] = $u->values()['icon_type'];
            }

            if ($sets === []) {
                json_error('nothing_to_update', 'No changes were supplied.', 400);
            }

            db_run('update calendar_events set ' . implode(', ', $sets) . ' where id = :id', $params);
            json_ok(db_one("select {$cols} from calendar_events where id = :id", ['id' => $eventId]));

        // ------------------------------------------------------------------
        case 'DELETE':
            $v = new Validator(json_body());
            $v->uuid('id', true);
            if ($v->fails()) {
                fail_validation($v->errors());
            }
            $eventId = $v->values()['id'];

            db_run('delete from calendar_events where id = :id', ['id' => $eventId]);
            log_info('event deleted', ['id' => $eventId]);
            json_ok(['deleted' => true, 'id' => $eventId]);

        default:
            require_method('GET', 'POST', 'PATCH', 'DELETE');
    }
} catch (Throwable $e) {
    json_fatal($e);
}