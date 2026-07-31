# NubArca brand

**Effective 31 July 2026, NanoCloud was renamed NubArca. NubArca is the current
product and brand name. Historical records and compatibility identifiers may
retain the former name.**

This document is the current-state reference for the brand in software. It does
not rewrite history: changelog entries, release notes, EF migration identifiers
and past design documents keep the name they were written with.

## Name

Always written:

```
NubArca
```

Capital N, capital A, nothing between them. The television product is
`NubArca TV`.

Never `Nubarca`, `NUBARCA`, `nubarca`, `Nub Arca`, or the former name, on any
current user-facing surface.

Brand names are **not translated**. Every locale renders the identical string.
In the web frontend the name lives in [`frontend/src/brand/brand.ts`](../frontend/src/brand/brand.ts);
`app.name` in each locale file resolves to the same value so existing
translation call sites keep working.

## Palette

| Token | Name | Hex | Role |
| --- | --- | --- | --- |
| `--brand-midnight-navy` | Midnight Navy | `#0A0F1A` | Principal dark background |
| `--brand-deep-blue` | Deep Blue | `#0F1E3A` | Raised surfaces |
| `--brand-electric-blue` | Electric Blue | `#1565FF` | Primary accent |
| `--brand-cyan-glow` | Cyan Glow | `#00D4FF` | Secondary accent, focus ring, restrained glow |
| `--brand-soft-violet` | Soft Violet | `#9A6CFF` | Limited highlight — never the primary action colour |
| `--brand-cloud-white` | Cloud White | `#F5F7FB` | Primary text, light surfaces |

The six `--brand-*` tokens hold the approved hexes verbatim. Everything else
consumes the **semantic** tokens (`--surface-canvas`, `--accent`, `--text-primary`, …)
which map onto them in [`frontend/src/styles.css`](../frontend/src/styles.css).
No component may introduce a brand colour of its own.

### Two deliberate legibility tints

Electric Blue `#1565FF` reaches only **3.96:1** on Midnight Navy and **4.0:1** on
white — below WCAG AA for text. `--accent` is overwhelmingly a text and border
colour (40 text uses, 22 border uses, 15 fills), so it is set to a tint:

- dark theme `--accent: #3D82FF` — 5.3:1 on the canvas;
- light theme `--accent: #0B4FD6` — 6.3:1 on the canvas.

The exact brand hex is not lost. `--accent-strong` is Electric Blue itself and is
used for **fills**, where the white `--accent-contrast` on it clears AA at 4.84:1.
These are the only two deviations from an official hex, and both are annotated in
the stylesheet.

### Themes

Dark is the first-run default and lives on bare `:root`, so a page still renders
dark if the bootstrap fails. Light is derived from the same palette (Cloud White
canvas, Midnight Navy text). `system` remains selectable and is resolved in JS,
never by a `prefers-color-scheme` rule on the palette — otherwise a dark-mode OS
could override an explicit Light choice.

Both themes declare `color-scheme`, so native controls and scrollbars follow.
Destructive (`--danger`) and successful (`--success`) stay warm-red and green:
they must read as themselves, not as another shade of the brand blue.

## Typography

```
Headings, display text  Space Grotesk   (--font-heading)
UI, body, labels        Exo 2           (--font-ui)
Logs, hashes, code      unchanged mono  (--font-mono)
```

Both families are **SIL Open Font License 1.1**. They are installed as the
`@fontsource/space-grotesk` and `@fontsource/exo-2` packages and imported in
[`frontend/src/main.tsx`](../frontend/src/main.tsx), so Vite bundles the woff2
files into our own `dist` and serves them same-origin. **Nothing is fetched from
a third-party CDN at runtime.**

Only the required weights ship, latin subset only (the UI is en + it):

- Space Grotesk 500, 700
- Exo 2 400, 500, 600, 700

`@fontsource` sets `font-display: swap`, so text paints immediately in the
fallback stack and is never invisible. Every font token ends in a real
`sans-serif`, so a failed woff2 leaves the UI fully usable.

The licence notices are served at `/fonts/space-grotesk-OFL.txt` and
`/fonts/exo-2-OFL.txt`.

## Geometry

| Rule | Value | Token |
| --- | --- | --- |
| Base grid | 8 px | `--space-unit` |
| Card radius | 16 px | `--radius-card` |
| Button radius | 12 px | `--radius-button` |
| App icon corner radius | 20% | baked into the app-icon artwork |
| Minimum icon size | 24 px | `MIN_ICON_SIZE_PX`, enforced by `.brand-mark__icon` |
| Minimum wordmark width | 120 px | `MIN_WORDMARK_WIDTH_PX` |
| Logo clear space | 25% of logo height | `.brand-mark` inline padding |
| Default theme | dark | `DEFAULT_THEME_PREFERENCE` |

Do not stretch or rotate the logo, change its proportions, recolor it outside the
approved variants, or add heavy shadows.

## Assets

Approved source artwork is preserved at full resolution in
[`assets/brand/source/`](../assets/brand/source) and is never edited. Every
runtime image is generated from it by
[`scripts/generate-brand-assets.py`](../scripts/generate-brand-assets.py), which
only trims, pads and **downscales** — it refuses to upscale past a source, and
refuses outright to build a runtime asset from a guideline board.

| Source file | Role |
| --- | --- |
| `icon-transparent.png` | Primary icon, alpha, light-on-dark. The app-shell mark. |
| `app-icon.png` | Opaque app-icon artwork — favicon, PWA, Apple touch, maskable, TV icon. |
| `tv-lockup.png` | The approved `NubArca TV` lockup. |
| `wordmark-dark-text-transparent.png` | Approved wordmark with **dark** text. Light backgrounds only. |
| `reference-brand-system.png` | Guideline board — **reference only**, never UI. |
| `reference-color-and-type.png` | Guideline board — **reference only**, never UI. |
| `reference-development-guidelines.png` | Guideline board — **reference only**, never UI. |

Regenerate with `python3 scripts/generate-brand-assets.py`; verify the committed
derivatives still match their sources with `--check`. Outputs land in
`frontend/public/brand/` and `tv/assets/brand/`.

### Why the app shell renders the wordmark as text

The only approved transparent wordmark has **dark** text (`#000829` / `#0160D9`).
On the dark default theme it would be invisible, and informally recoloring an
official asset is not permitted. The brand contract's own fallback applies: use
the standalone approved icon plus normal UI text. That is what
[`BrandMark`](../frontend/src/brand/BrandMark.tsx) does — the icon carries the
accessible name and the wordmark is live text in Space Grotesk, two-tone with
`Arca` in the accent colour. It stays crisp at any zoom and respects the reader's
font size.

The dark-text wordmark is still shipped, as `wordmark-dark-text-{240,480,960}.png`,
for use on guaranteed-light surfaces.

## Legacy compatibility identifiers

Some identifiers keep the former name because renaming them would break a running
deployment, log users out, orphan stored rows, or install the TV app as a
separate application. They are **not** scattered: every one is listed with its
reason in [`config/legacy-brand-compatibility.txt`](../config/legacy-brand-compatibility.txt).

[`scripts/check-brand-cleanliness.sh`](../scripts/check-brand-cleanliness.sh)
fails when an occurrence of the former name appears outside that allowlist. Run
it before committing. Adding an entry is a deliberate act that requires stating
what would break and under what condition it can be removed.

The allowlist is the only sanctioned home for the former name in current code.
Everything else uses NubArca.
