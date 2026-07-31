# Changelog

## Unreleased

### Renamed to NubArca

Effective 31 July 2026, NanoCloud was renamed **NubArca**. NubArca is the current
product and brand name; the television product is **NubArca TV**.

Entries below this one keep the name they were written with — they are a record
of what shipped, not a description of the product today.

- Every current user-facing surface now reads NubArca: web title, meta
  description, PWA manifest, favicon and app icons, login and authenticated
  shell, all locale resources, the OpenAPI document, the operator CLI banner,
  API validation messages, and the TV and mobile display names.
- Official palette, typography (Space Grotesk + Exo 2, bundled locally under the
  SIL OFL — no runtime CDN) and geometry are implemented as design tokens. Dark
  remains the first-run default; a contrast-checked light theme is derived from
  the same palette.
- Existing theme, language and navigation preferences migrate from the
  pre-rename browser-storage keys, so nobody loses a choice to the rename.
- Identifiers that cannot move without breaking a running deployment keep the
  former name and are documented in `config/legacy-brand-compatibility.txt`:
  session cookies, persisted container-key prefixes and hash peppers, the
  database and its role, Docker volumes/networks/paths, `NANOCLOUD_*`
  environment variables, the Android application id, the published APK filename,
  and the .NET assembly (which is the container entrypoint). No database, blob
  storage or Docker volume identity changed.
- `scripts/check-brand-cleanliness.sh` fails on any new occurrence of the former
  name outside that allowlist. See `docs/brand.md`.
- The approved visual package is imported under `assets/brand/nubarca/` as the
  canonical source of truth: 54 catalogued assets with checksums, dimensions,
  alpha and provenance, all verified against the real binaries.
  `scripts/sync-brand-assets.py` copies runtime assets into the platform
  directories byte-for-byte — it never resizes, recolours or regenerates — so
  every shipped image hashes identically to its canonical source. Source
  masters and reference boards are structurally excluded from the build.
- Small UI contexts use the approved flat mark rather than the luminous
  launcher icon, and dark and light surfaces get their own approved mark and
  wordmark variants.

### Fixed

- Similar Photos reserved tiles from the coded pixel dimensions while thumbnails
  are auto-oriented, so EXIF-rotated photos got a landscape tile for a portrait
  image and the wall filled the gap with a blurred copy of the thumbnail. The
  similarity results now resolve display dimensions through the same helper the
  library uses, and the media wall no longer renders a blurred backdrop layer at
  all.
- The photo viewer's similarity actions are resolved centrally, so a photo
  offers the same actions from every origin. Opening a photo from Similar Photos
  now exposes "Find similar in Library", which was missing. An album workspace
  was applying the similarity anchor to itself instead of the library.

## 0.2.0

NanoCloud `0.2.0` is the consolidated public baseline.

Highlights:

- Responsive file, folder, Trash, sharing and media-management workflows
- Photo and video galleries with metadata, derivatives and playback
- Durable background processing, resumable uploads and administrative imports
- Content-addressed storage with reference accounting and controlled cleanup
- Local face, image-semantic and video-semantic capabilities
- Production Docker Compose deployment and operational diagnostics

Detailed behavior and invariants are documented in `README.md`,
`ARCHITECTURE.md` and the focused documents under `docs/`.
