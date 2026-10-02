# PinkyPromise 💗

A private little world for two people — memory photocards with hidden letters,
an anniversary calendar, categorized heart decks, a promise jar, and a music bar.

Soft pink glassmorphism, built with Tailwind CSS v4, Alpine.js, and vanilla JS
on the front; PHP serverless functions and PostgreSQL on the back.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | HTML5, Tailwind CSS v4 (CSS-first `@theme`), Alpine.js 3.17, vanilla ES modules |
| Backend | PHP 8.5 serverless via `vercel-php@0.9.0` on Vercel |
| Database | PostgreSQL on Supabase (transaction pooler) |
| Media | Supabase Storage, streamed from PHP — never written to local disk |
| Deploy | Vercel |

No Composer, no PHP dependencies — `pdo_pgsql`, `curl`, and `openssl` all ship
in the runtime. Cropper.js v1.6.2 is vendored locally, so there's no CDN
dependency at runtime.

## Try it without a backend

```bash
npm install
npm run build:css
npx serve -l 4173 .
```

Then open **http://localhost:4173/?demo=1** — full sample data, no server, no
database. The Music tab is pre-seeded with one track of each source type so you
can see all three playback behaviours.

## Run the real thing

```bash
node scripts/migrate.mjs      # apply db/*.sql in order
node scripts/status.mjs       # row counts, decks, settings
node scripts/verify-rls.mjs   # prove the anon key cannot reach your data
```

1. **Supabase** — the migrations create every table; you don't paste SQL by hand.
2. Create a **public** storage bucket (default `recon-media`).
3. Copy `.env.example` → `.env` and fill in the values.
4. Install PHP with `pdo_pgsql`, then run locally:

   ```bash
   php -S localhost:8000 router.php
   ```

   On Windows/XAMPP, `pdo_pgsql` ships with XAMPP but is commented out in
   `php.ini`. Enable it:

   ```ini
   extension=pdo_pgsql
   ```

5. Choose your passcode once. Until this runs, the app has no way in:

   ```bash
   curl -X POST http://localhost:8000/api/auth-bootstrap \
     -H "Content-Type: application/json" \
     -H "x-setup-token: $APP_SETUP_TOKEN" \
     -d '{"passcode":"YOUR-PASSCODE","anchor_date":"2024-02-14"}'
   ```

   It returns 409 if a passcode already exists — the endpoint closes
   permanently once set. To start over: `npm run db:reset-passcode`.

6. Set the same variables in Vercel, then `vercel deploy`.

### Database connection: use port 6543

Supabase's dashboard shows `5432` by default — that's **session mode**. Every
Vercel serverless invocation would hold its own dedicated Postgres connection
and you'd exhaust the connection limit under concurrency. Use the
**transaction-mode** pooler on `6543`.

Two consequences, both handled in `lib/db.php`:

- `PDO::ATTR_EMULATE_PREPARES` **must** be `true`. Real prepared statements bind
  to one backend connection, which doesn't survive the pooler handing the
  request to a different backend.
- The pooler drops idle connections, so `db()` **retries with backoff**. Without
  it, roughly every other cold request 503s — a bug this caught during testing.
  `scripts/db.mjs` does the same for the Node tooling.

### Uploads use a raw request body, not multipart

`php://input` is **unavailable** for `multipart/form-data` — PHP consumes it to
populate `$_FILES`, writing a temp file first. That would put user data on local
disk, which Rule 1 forbids and which is pointless on Vercel where the filesystem
is read-only.

So the client sends the `File` as the raw body and the kind/variant as query
params. The bytes go from the browser straight to Supabase through curl's
`READFUNCTION`; nothing is buffered, nothing is written to disk, and a 4 MB
upload costs a few KB of memory.

## Security model

The app **never uses the public anon key**. PHP connects to Postgres as
`postgres` over the pooler and uses the `service_role` key only for Storage
uploads. Nothing in the browser needs an anon key — which means the anon key is
a liability rather than an asset, since it's designed to be public.

Data is protected at **two independent layers**, because either alone leaves a
gap the other covers:

| Layer | What it stops | Gap it leaves |
|---|---|---|
| RLS enabled, zero policies | Row reads/writes via PostgREST | **`TRUNCATE` is not subject to RLS at all** |
| `REVOKE ALL … FROM anon, authenticated` | Everything, including `TRUNCATE` | Nothing — belt and braces |

`node scripts/verify-rls.mjs` asserts both halves by seeding a probe row and
checking what the anon key can actually reach. It caught two real bugs during
development: `audio_tracks` shipped without RLS enabled, and `app_settings`
needed a `TRUNCATE` revoke.

### Rotate your keys

The `service_role` key bypasses RLS entirely and the Postgres password is the
superuser account. Both are in `.env`, which is gitignored — but if either ever
lands in a commit, a public repo, or a chat log, **rotate it in the Supabase
dashboard**. Git history makes a leaked credential effectively permanent even
after deletion.

## How it's laid out

```
api/      one .php file = one stateless endpoint (auth, cards, calendar,
          decks, settings, tracks, upload, health)
lib/      shared PHP — OUTSIDE api/, because every .php under api/ is
          compiled into its own serverless function
db/       SQL migrations, run in order
js/       ES modules: api, lock, cardflip, countdown, calendar, decks,
          jar, player, sources, admin
src/      Tailwind source (tokens live in @theme here)
css/      generated — gitignored, rebuilt by buildCommand on deploy
audio/    optional bundled tracks + tracks.json
```

### Why `lib/` sits outside `api/`

The `vercel-php` runtime doesn't support `includeFiles` — it ships the whole
project tree. Any `.php` under `api/` becomes its own function, so shared code
has to live elsewhere and be pulled in with `require`.

## Design system

`DESIGN-SYSTEM.md` is the source of truth: palette, typography, spacing, glass
recipe, motion tokens, accessibility contract, and per-surface UI states.
`src/input.css` implements it as Tailwind v4 `@theme` tokens plus `@utility`
primitives.

Generated with the [`ui-ux-pro-max`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
skill, then reconciled against measured WCAG contrast — the skill's palette was
rejected because white text on its primary pink measured **3.53:1**.

Design decisions worth knowing:

- **Ink is deep plum `#831843`, never white.** That's what lets the whole pastel
  palette stay legible (8.0–9.65:1).
- Solid buttons use `#BE185D` (6.04:1) and `#6D28D9` (7.10:1) — not `#EC4899`,
  which fails.
- Cards are always **1:1** because the browser crops on upload. Photos are
  downscaled to 1000×1000, with a 2400px original kept for re-cropping later.

## Music sources

Three kinds, with genuinely different capabilities:

| Source | Playback | Visualiser | Player |
|---|---|---|---|
| Audio file | in-page | **live analyser** | — |
| YouTube | in-page | static equaliser | popover above the bar |
| Spotify | link-out only | — | opens Spotify |

The visualiser can't run for YouTube because the audio is in a cross-origin
iframe and Chromium's `MediaElementAudioSourceNode` returns zeros for
cross-origin media. Spotify can't be embedded by third-party sites at all. See
`audio/README.md`.

## Tests

```bash
npm test            # 67 unit tests — date math, calendar grid, jar, validation, URL parsing
npm run test:api    # 57 end-to-end tests against a live PHP server + real Supabase
npm run db:verify   # live check that the anon key cannot read your data
```

`npm run test:api` needs the server running (`php -S localhost:8000 router.php`)
and covers the real auth flow, every endpoint, and the rejection paths — invalid
enums, impossible dates like `2024-02-31`, path traversal, MIME sniffing,
oversized ranges, and every auth gate. It sets a throwaway passcode; run
`npm run db:reset-passcode` afterwards to choose your real one.

## API

All endpoints return `{ ok, data }` or `{ ok: false, error: { code, message, fields? } }`.
Every endpoint except `/api/health` and the GET arm of `/api/auth` requires the
session cookie.

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/health` | GET | Deployment diagnostics; also the daily cron target |
| `/api/auth` | GET, POST | Session status; passcode login |
| `/api/auth-bootstrap` | POST | One-time passcode + anchor-date setup |
| `/api/auth-logout` | POST | Clear the session cookie |
| `/api/cards` | GET, POST, PATCH, DELETE | Memory photocards |
| `/api/calendar` | GET, POST, PATCH, DELETE | Events; GET takes `from`/`to` |
| `/api/decks` | GET, POST, PATCH, DELETE | Heart deck cards |
| `/api/tracks` | GET, POST, PATCH, DELETE | Music bar tracks |
| `/api/settings` | GET, PATCH, POST | Settings; POST changes the passcode |
| `/api/upload` | POST, DELETE | Stream a file to storage; DELETE removes an object |

## Security notes

- Every SQL call uses PDO prepared statements with `ATTR_EMULATE_PREPARES`.
- Uploads stream from the client straight to storage — **no** `move_uploaded_file`,
  no temp file, nothing written to the read-only local filesystem.
- Upload paths are random hex; the user's filename never reaches the storage
  path, and `storage_path_is_safe()` re-validates the shape before any delete.
- The passcode is a bcrypt hash in Postgres and never reaches the browser. The
  session is an HMAC-signed httpOnly cookie bound to a passcode fingerprint, so
  changing the passcode invalidates every existing session immediately — with no
  session table to keep in sync across instances.
- `/api/auth-bootstrap` verifies the setup token **before** reporting whether
  setup is still needed, so an unauthorised caller can't probe app state.
- `passcode_hash` is never returned by `/api/settings`, and is not writable.
- CSP is set in `lib/bootstrap.php`; `api/php.ini` sets
  `disable_functions` for anything that could shell out.

## Security notes

- Every SQL call uses PDO prepared statements.
- Uploads stream `php://input` straight to storage — **no** `move_uploaded_file`,
  nothing written to the (read-only) local filesystem. Vercel's fs is ephemeral.
- Upload paths are random hex; user filenames never reach the storage path.
- The passcode is a bcrypt hash in Postgres and never reaches the browser. The
  session is an HMAC-signed httpOnly cookie, so state is stateless across
  instances.
- Every user-authored string is escaped before it reaches `innerHTML`.