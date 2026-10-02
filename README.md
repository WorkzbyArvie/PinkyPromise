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

1. **Supabase** — create a project, then run the SQL files in order:
   `db/001_schema.sql`, `db/002_settings.sql`, `db/004_tracks.sql`.
2. Create a **public** storage bucket (default `recon-media`).
3. Copy `.env.example` → `.env` and fill in the values:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — dashboard → API Keys
   - `DATABASE_URL` — **use port `6543`** (transaction mode) for serverless.
     Port `5432` is session mode and will exhaust your connection limit.
4. Install PHP and run locally:

   ```bash
   winget install PHP.PHP.8.5
   php -S localhost:8000 router.php
   ```

5. Set the same variables in Vercel, then `vercel deploy`.
6. Bootstrap the passcode once:

   ```bash
   curl -X POST https://your-app.vercel.app/api/auth-bootstrap \
     -H "Content-Type: application/json" \
     -H "x-setup-token: $APP_SETUP_TOKEN" \
     -d '{"passcode":"YOUR-PASSCODE","anchor_date":"2024-02-14"}'
   ```

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
node test.mjs          # 37 — countdown date math, calendar grid, jar, validation
node test-sources.mjs  # 30 — YouTube/Spotify/audio URL parsing
```

## Security notes

- Every SQL call uses PDO prepared statements.
- Uploads stream `php://input` straight to storage — **no** `move_uploaded_file`,
  nothing written to the (read-only) local filesystem. Vercel's fs is ephemeral.
- Upload paths are random hex; user filenames never reach the storage path.
- The passcode is a bcrypt hash in Postgres and never reaches the browser. The
  session is an HMAC-signed httpOnly cookie, so state is stateless across
  instances.
- Every user-authored string is escaped before it reaches `innerHTML`.