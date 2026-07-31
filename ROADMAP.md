# NubArca Roadmap

NubArca is a minimal, robust, secure personal cloud server. This roadmap
tracks direction at a high level; release detail lives in
[CHANGELOG.md](CHANGELOG.md) and current state in
[DEVELOPMENT_STATE.md](DEVELOPMENT_STATE.md).

## Done in 0.1.0 (baseline)

- Authenticated access (cookie sessions), single admin role, operator CLI.
- Logical folder/file tree (DB-owned), upload, folder upload preserving
  structure, rename/move, soft delete + Trash + restore, name search.
- Immutable content-addressed blob storage with SHA-256 exact deduplication and
  reference counting; quota accounting; storage reconciliation.
- Secure share links (hashed tokens, expiry, revocation, max downloads).
- Gallery with infinite scroll and duplicate collapsing; image thumbnails +
  medium previews; video playback with HTTP Range; video posters (synthetic
  default, optional FFmpeg).
- Embedded metadata extraction, user metadata editing, metadata privacy policy,
  and privacy-safe actions (strip / privacy-safe download / write DateTaken).
- Albums/collections.
- Background-jobs architecture; admin storage stats + diagnostics + on-demand
  integrity check; bounded admin server-side directory import with
  history/progress/cancel/throttle/timings.
- Production Docker Compose deployment, backup/restore scripts, operator
  runbook.

## Done in 0.2.0

- **Hardened background jobs** — lease + heartbeat crash recovery, cooperative
  cancellation, progress, owner-guarded terminal writes, a dedicated worker
  option, and an admin Jobs dashboard.
- **Import optimisation** — derivative generation moved off the per-file
  critical path (background `media.derivatives.backfill` job + lazy
  endpoints), and **true import resume** from a persisted per-item manifest
  (`admin_import_items`) instead of re-walking the source from the top.
- **Resumable / chunked web upload** — staged upload sessions with
  server-tracked chunk state (uploads resume from exactly the missing
  chunks, including after a reload), verification, and background import
  through the existing admin-import pipeline.

### Additional work after 0.2.0-rc1

- **Media-library scope** — per-folder gallery include/exclude rules (photos
  and/or videos, subtree-aware, nearest rule wins) applied through a single
  eligibility service to galleries and batch media jobs; file browser,
  downloads, and sharing untouched.
- **Metadata pipeline V2** — full embedded extraction moved off the import
  critical path onto the async backfill job (native MetadataExtractor, no
  ExifTool), with EffectiveDateTaken recompute and an owner-private GPS
  projection (`file_item_locations`) preparing the future photo map.

## Near-term

- A private, owner-scoped **photo map** view on top of `file_item_locations`.
- Admin **user-management UI** (today: CLI only).
- **Operationalise blob cleanup** — a safe admin-triggered reclaim and clearer
  janitor/sweeper guidance so cleanup isn't purely background config.
- Production-docs polish.

## Later

- A **sync foundation** and eventual desktop/mobile sync clients.
- **Auth hardening** (e.g. two-factor authentication).
- Pluggable storage backends (S3/MinIO) and a faster search backend
  (Meilisearch/Typesense) once the local-first core warrants it.
- Optional native/Rust media worker; perceptual (near-duplicate) image
  deduplication.

## Non-goals

NubArca intentionally does **not** aim to be a Nextcloud clone. Out of scope:

- WebDAV.
- HLS/DASH video transcoding.
- Collaborative document editing, calendar, contacts, chat.
- A plugin system.
- Advanced multi-tenant permission models.
- Public user registration.
