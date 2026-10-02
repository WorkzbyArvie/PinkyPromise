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
4. Install PHP and run locally:

   ```bash
   winget install PHP.PHP.8.5
   php -S localhost:8000 router.php
   ```

5. Set the same variables in Vercel, then `vercel deploy`.

### Database connection: use port 6543

Supabase's dashboard shows `5432` by default — that's **session mode**. Every
Vercel serverless invocation would hold its own dedicated Postgres connection
and you'd exhaust the connection limit under concurrency. Use the
**transaction-mode** pooler on `6543`.

The pooler also drops idle connections aggressively, so `scripts/db.mjs`
connects with backoff and builds a fresh client per attempt (`pg` refuses a
second `connect()` on the same instance).

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
node test.mjs          # 37 — countdown date math, calendar grid, jar, validation
node test-sources.mjs  # 30 — YouTube/Spotify/audio URL parsing
```

`scripts/verify-rls.mjs` is a live integration test against the real database.

## Security notes

- Every SQL call uses PDO prepared statements.
- Uploads stream `php://input` straight to storage — **no** `move_uploaded_file`,
  nothing written to the (read-only) local filesystem. Vercel's fs is ephemeral.
- Upload paths are random hex; user filenames never reach the storage path.
- The passcode is a bcrypt hash in Postgres and never reaches the browser. The
  session is an HMAC-signed httpOnly cookie, so state is stateless across
  instances.
- Every user-authored string is escaped before it reaches `innerHTML`.