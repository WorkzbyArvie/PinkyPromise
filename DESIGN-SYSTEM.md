# Reconciliation Memory Box — Design System

> **Authoritative.** Where this file disagrees with the generated
> `design-system/reconciliation-memory-box/MASTER.md`, **this file wins.**
> Every override is listed in [Provenance & Overrides](#provenance--overrides).

Generated with the `ui-ux-pro-max` skill (v2.15.0), then reconciled against the
user's locked brief and measured for WCAG contrast.

---

## Provenance & Overrides

| # | Skill generated | Overridden to | Why |
|---|---|---|---|
| 1 | Color: navy/blue "trust blue" (`#0F172A` bg, `#1E40AF` primary) | Pink/cream/lavender below | User's locked brief: soft pink, cream `#FFFDD0`, pastel rose, soft lavender |
| 2 | Color: Beauty/Spa palette primary `#EC4899` | `#BE185D` for solid fills | White on `#EC4899` = **3.53:1 FAIL**. `#BE185D` = 6.04:1 |
| 3 | Color: lavender accent `#8B5CF6` | `#6D28D9` for solid fills | White on `#8B5CF6` = **4.23:1 FAIL**. `#6D28D9` = 7.10:1 |
| 4 | Color: Card `#FFFFFF` | Translucent glass, never opaque white | Skill: "Avoid pure white backgrounds". Glass is the whole point |
| 5 | Motion: GSAP snippets | CSS transitions + `requestAnimationFrame` | Stack is vanilla JS + CSS. No GSAP dependency |
| 6 | Icons: `@phosphor-icons/react` | Inline SVG, Phosphor outline paths | No React. Same visual language, zero dependency |
| 7 | Pattern: "Product Demo + Features" landing | Single-page app shell | Not a marketing site |

**Kept as-is from the skill:** style (Glassmorphism), typography (Caveat + Quicksand),
glass recipe (blur/opacity/border values), density 3 (spacious), stagger timing,
reduced-motion requirement, accessibility requirement set, anti-pattern list.

---

## Music Sources — per-source capability matrix

Added after the skill pass. Three source types with genuinely different
capabilities; the UI must degrade honestly rather than pretend.

| Source | Transport | Volume | Visualiser | Player shown |
|---|---|---|---|---|
| `file` (uploaded / direct URL) | Full | Yes | **Live analyser** | None — audio element |
| `youtube` (IFrame embed) | Full | Yes | **Static equaliser** | Popover above the bar |
| `spotify` | **None — link-out** | n/a | Static equaliser | Opens Spotify |

**Why the visualiser cannot run for YouTube:** the audio lives in a
cross-origin iframe. Chromium's `MediaElementAudioSourceNode` returns zeroes for
cross-origin media (confirmed in the Blink source and WebAudio spec issue
#2453), so an `AnalyserNode` never sees the signal. The static equaliser is the
honest substitute — a fake dancing bar would be a lie.

**Why Spotify cannot play in-page:** their widget terms restrict embedding to
Spotify-operated properties. There is no API that streams their audio into a
third-party player. The play control becomes an "Open in Spotify" hand-off
(Spotify green `#1DB954`).

**Why YouTube needs a visible player:** the IFrame embed has no audio-only
mode. The popover above the music bar keeps it out of the way without
reserving permanent layout space, which would otherwise jump on every track
change.

YouTube error codes are surfaced as real copy, not a generic failure:
`101`/`150` → *"That video can't be embedded here"* (the uploader disabled it);
`2` → *"Couldn't play that YouTube video"*.

### Music bar contract

- Fixed bottom, 72px, `z-30`, translucent. `scroll-padding-bottom: 96px` keeps
  keyboard focus clear of it (WCAG 2.2 focus-not-obscured).
- Source badge next to the title: File / YouTube / Spotify, each colour-coded
  and always paired with the text label — never colour alone.
- Volume slider and mute hidden entirely for Spotify, since they would do nothing.
- Spotify play button is Spotify-green and uses an **external-link** icon, not a
  play triangle — the icon must not imply in-page playback.
- YouTube transport shows a reveal button (chevron) before the player exists;
  opening the popover is a prerequisite for playback, so it is labelled as
  "Show the YouTube player", not a preference toggle.

---

## Color

### Surfaces — the 60% dominant layer

Page background is a **fixed multi-stop gradient**, not a flat fill, so the glass
surfaces always have colour to refract.

| Token | Value | Usage |
|---|---|---|
| `--cream` | `#FFFDD0` | User-locked. Leftmost gradient stop, glass tint top |
| `--blush` | `#FDF2F8` | From skill. Primary page tint |
| `--lavender-100` | `#EDE7FB` | Rightmost gradient stop, cool balance |
| `--blush-soft` | `#FFF0F3` | Glass fill tint, hover wash |

```css
background:
  radial-gradient(120% 80% at 12% 8%,  var(--cream) 0%, transparent 55%),
  radial-gradient(100% 70% at 88% 12%, var(--lavender-100) 0%, transparent 50%),
  radial-gradient(90%  90% at 50% 100%, var(--blush-soft) 0%, transparent 60%),
  var(--blush);
```

### Accents — the 10%

| Token | Value | Usage | White text? |
|---|---|---|---|
| `--rose` | `#F9A8D4` | Decorative fills, glow, card wash | never |
| `--rose-mid` | `#EC4899` | **Interactive borders only** (3.40:1 on cream) | never |
| `--rose-deep` | `#BE185D` | Solid button fills, active tab underline | yes (6.04) |
| `--rose-800` | `#9D174D` | Solid fills needing stronger presence | yes (7.88) |
| `--lavender-500` | `#8B5CF6` | Decorative glow, visualizer bars | never |
| `--violet-700` | `#6D28D9` | Solid lavender fill (rare accent) | yes (7.10) |
| `--destructive` | `#DC2626` | Delete actions only | yes (4.83) |

### Ink — the contrast backbone

**All body text is deep plum, never white.** This is what makes the pastel
aesthetic legible. Measured ratios:

| Token | Value | on cream | on blush | on lavender |
|---|---|---|---|---|
| `--ink` | `#831843` | **9.29** | **8.84** | **8.00** |
| `--ink-strong` | `#6B1233` | **11.49** | **10.93** | **9.90** |
| `--ink-muted` | `#7A5568` | **6.08** | **5.78** | **5.24** |

`--ink-muted` is the floor for any text — never go lighter.

**Reserved:** pure `#FFFFFF` text appears **only** on `--rose-deep`,
`--rose-800`, `--violet-700`, `--destructive`.

---

## Typography

From the skill: *"handwritten, personal, friendly, casual, warm, charming"*.

| Role | Font | Size | Weight | Line height | Tracking |
|---|---|---|---|---|---|
| Display | Caveat | 40px | 700 | 1.1 | -0.01em |
| Heading | Caveat | 28px | 600 | 1.2 | 0 |
| Title | Quicksand | 20px | 700 | 1.3 | 0 |
| Body | Quicksand | 16px | 500 | **1.6** | 0 |
| Label | Quicksand | 14px | 600 | 1.4 | 0.01em |

Letters (`letter_text`) render in **Caveat 24px / 1.7** — handwriting is the
emotional point, and letters are long-form so line height is generous.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Quicksand:wght@500;600;700&display=swap" rel="stylesheet">
```

`display=swap`. Exactly 4 sizes, 3 weights, 2 families. No third family.

---

## Spacing — 8pt scale, density 3 (spacious)

| Token | px | Usage |
|---|---|---|
| `space-1` | 4 | Icon gaps |
| `space-2` | 8 | Inline padding |
| `space-3` | 16 | Default element spacing |
| `space-4` | 24 | Section padding |
| `space-6` | 32 | Layout gaps |
| `space-8` | 48 | Major section breaks |
| `space-12` | 64 | Page rhythm |

**Exceptions:** touch targets ≥ 44px (`min-h-11 min-w-11`) even when the icon
inside is 20px. Icon-only buttons get `p-3`. Grid gap is 24px, never 16px.

---

## Glassmorphism Recipe

Verbatim from the skill's `glassmorphism` style spec:

| Property | Value |
|---|---|
| Blur | `15px` (`backdrop-filter: blur(15px)` + `-webkit-` prefix) |
| Fill | `rgba(255, 255, 255, 0.15)` |
| Border | `1px solid rgba(255, 255, 255, 0.20)` |
| Shadow | `0 8px 32px rgba(131, 24, 67, 0.10)` — plum-tinted, not black |
| Radius | `24px` cards, `16px` inputs, `9999px` pills |
| Depth | Layered: content `z-10`, sticky bars `z-30`, modals `z-50` |

Glass is defined **once** as a Tailwind v4 `@utility glass` so it composes with
variants (`hover:glass-strong`). Per the skill's stack guidance, `@apply` is
avoided — direct utilities in HTML, `@utility` only for true primitives.

**Glow** (the "glowing UI elements" in the brief) is a *separate* layer:
`box-shadow: 0 0 24px rgba(249, 168, 212, 0.45)` — reserved for focus rings,
the active music bar, and the jar. Never for general elevation.

---

## Motion

CSS-only. No GSAP. Skill's timing intent preserved.

| Token | ms | Easing | Usage |
|---|---|---|---|
| `--t-fast` | 150 | `ease-out` | Hover, focus ring |
| `--t-base` | 250 | `cubic-bezier(.2,.8,.2,1)` | Tabs, popovers, swipes |
| `--t-flip` | 700 | `cubic-bezier(.4,0,.2,1)` | 3D card flip |
| `--t-slow` | 450 | `cubic-bezier(.34,1.4,.64,1)` | Grid stagger entrance |

**Grid stagger:** cards enter at `opacity 0→1, translateY 16px→0, scale .92→1`,
40ms apart, capped at 12 items. Back-out easing is fine here (photo gallery,
not a data table — the skill's warning about `back.out` on dense tables does not
apply).

**Typewriter:** `requestAnimationFrame`, 18ms/char, blinking caret 530ms.
Tap anywhere to complete instantly.

**Rules from the skill:**
- State correctness must **never** depend on `animationend`/`transitionend`.
  Cancel prior motion and set the final state directly.
- Every transition gets an explicit `transition` property — never an instant
  hover change.
- `prefers-reduced-motion: reduce` → all durations collapse to `0.01ms`,
  stagger disabled, typewriter becomes instant text.

---

## Iconography

Phosphor **outline** style, inlined as SVG. Consistent `stroke-width: 2`,
`stroke-linecap: round`, `stroke-linejoin: round`, `viewBox="0 0 256 256"`.

| Role | Size |
|---|---|
| Inline | 20px |
| Control | 24px |
| Feature | 32px |

- Icon-only control → needs `aria-label`; expose `aria-pressed`/`aria-expanded`.
- Decorative icon beside visible text → `aria-hidden="true"`.
- Never mix outline and filled in the same hierarchy level.

**Emoji exception (deliberate):** calendar day marks (`💖 🍰 🌸 🩹 💗`) are
**content**, not UI chrome — they're the user's specified data vocabulary and
each maps to a real `icon_type`. They are not used for navigation, buttons, or
system controls.

---

## Accessibility Contract

| Requirement | Rule |
|---|---|
| Body text contrast | ≥ 4.5:1 — use `--ink` family only |
| Control borders | ≥ 3:1 — use `--rose-mid` or `--ink`, never pastel |
| Focus ring | `2px solid var(--rose-deep)` + `2px` offset, **always visible**, never removed |
| Focus not obscured | Fixed music bar sets `scroll-padding-bottom: 96px` |
| Touch targets | ≥ 44×44px |
| Keyboard | Every action reachable without a pointer. Dialogs trap focus, `Esc` closes |
| Lock screen | `autocomplete="current-password"`, paste allowed, visible label (not placeholder-only) |
| Error summary | `role="alert"` block at form top + per-field inline errors, focus moves to it on submit failure |
| Reduced motion | `prefers-reduced-motion` collapses all motion |
| Images | `alt` describes the photo content; `loading="lazy"` + `decoding="async"` |
| Zoom | Never `user-scalable=no`. Never disable pinch-zoom |
| Cropper | Drag has keyboard/button alternatives (arrow-key nudge, reset, rotate) |

---

## UI States — every data surface needs all four

| Surface | Empty | Loading | Error | Populated |
|---|---|---|---|---|
| Photo cards | "No memories yet" + Add first photo | 6 shimmering skeleton squares | Retry banner | 1:1 grid, staggered in |
| Calendar | "No events this month" | Skeleton grid | Retry | Day cells with emoji |
| Decks | "No cards in this deck" + Add | 3 skeletons | Retry | Scroll-snap row |
| Jar | n/a | Note emerging | n/a | Random folded note |
| Music bar | "Add mp3s to /audio" | Buffering spinner | "Could not load track" | Playing state + visualizer |

Empty-state copy always names the **next action**, never just states absence.

---

## Copywriting

| Element | Copy |
|---|---|
| Primary CTA | "Add a memory" |
| Upload CTA | "Choose a photo" |
| Crop confirm | "Use this photo" |
| Lock screen heading | "Our little world is just for us" |
| Lock label | "Passcode" (visible, above input) |
| Lock error | "That isn't our passcode. Try again." |
| Empty photos | "No memories yet — add the first photo" |
| Empty events | "Nothing on this day. Make it special?" |
| Error banner | "Couldn't reach the server." + Retry button |
| Delete confirm | "Delete this memory? This can't be undone." |

Tone: warm, second-person, understated. Never clinical, never exclamation-heavy.

---

## Component Inventory

No component library — hand-built on Tailwind v4 utilities + Alpine.

| Component | File | Notes |
|---|---|---|
| `glass` utility | `src/input.css` | `@utility`, blur 15px |
| `glow` utility | `src/input.css` | `@utility`, rose glow |
| Lock screen | `js/lock.js` | Full-screen gate, floating hearts |
| Countdown header | `js/countdown.js` | Y/M/D/H/M + next milestone |
| Photocard | `js/cardflip.js` | 1:1, glossy, 3D flip, typewriter |
| Cropper modal | `js/admin.js` | Cropper.js v1.6.2, 1000×1000 out |
| Calendar grid | `js/calendar.js` | Month nav, emoji day marks |
| Day popover | `js/calendar.js` | Events + memory thumbnails |
| Deck tabs + swiper | `js/decks.js` | Scroll-snap, no library |
| Promise jar | `js/jar.js` | Shuffle-bag, no repeats |
| Music bar | `js/player.js` | Fixed, WebAudio visualizer |

---

## Layout

- **Mobile-first.** Single column. Breakpoints: 375 / 768 / 1024 / 1440.
- **Header:** countdown, sticky, translucent.
- **Music bar:** fixed bottom, 72px tall, translucent, `z-30`.
- **Cards:** 1:1, `grid-cols-2` → `3` (768) → `4` (1024) → `5` (1440), gap 24px.
- **Modals:** centred, `max-w-lg`, radius 24px, scrim `rgba(51, 20, 35, 0.45)`.
- No horizontal scroll at any width. No fixed pixel container widths.

---

## Pre-Delivery Checklist

- [ ] All body text uses `--ink` family — no white on pastel, no pastel text
- [ ] All interactive borders ≥ 3:1 (`--rose-mid` / `--ink`)
- [ ] Focus ring visible on every control, never `outline-none` alone
- [ ] Fixed music bar does not cover focus (`scroll-padding-bottom`)
- [ ] Touch targets ≥ 44px
- [ ] `prefers-reduced-motion` collapses all motion
- [ ] Every data surface has empty / loading / error / populated states
- [ ] No emojis as UI icons (calendar day marks are content, exempt)
- [ ] All images have `alt`, `loading="lazy"`, `decoding="async"`
- [ ] Dialogs trap focus and close on `Esc`
- [ ] Tested at 375px, 768px, 1024px, 1440px