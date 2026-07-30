# NanoCloud current work

Transient state for development agents. Keep this file limited to the current
baseline and active work; do not use it as a chronological work log.

## Current baseline

- Release: `0.2.0`
- Branch: `main`
- Backend: ASP.NET Core / .NET 10, EF Core and PostgreSQL
- Frontend: React, TypeScript and Vite
- Runtime: Docker Compose with separate API, worker and frontend services
- Storage: local content-addressed blobs with database-owned logical paths

## Current capabilities

- Owner-scoped files, folders, Trash, sharing, albums and private media areas
- Photo and video galleries with derivatives, metadata and adaptive playback
- Durable background jobs, staged uploads and server-side imports
- Local AI pipelines for face, image and video semantic features
- Administration, diagnostics, storage reconciliation and controlled cleanup

## Development rules

- Read `CLAUDE.md`, `ARCHITECTURE.md` and this file before repository work.
- Preserve the storage, privacy, ownership and reference-count invariants in
  `ARCHITECTURE.md`.
- Add migrations for schema changes and verify both upgrade and runtime paths.
- Keep fast tests representative; do not weaken assertions or coverage to make
  the suite faster.
- Read `deploy/FAST_DEPLOY.md` in full immediately before any production
  deployment, rebuild, release-pin change or production migration.

## Active slice — UX-01 app shell, cloud functions and media experience

Branch `feat/frontend-experience-refresh`, started from `main` (`ee09591`). Not
pushed, not merged, not deployed. Frontend-only except ONE new backend test
file; no migration, no DTO change, no AI/media/TV pipeline change.

- **Theme**: semantic tokens under `:root` (dark, the default) and
  `:root[data-theme='light']`; legacy `--bg/--fg/--muted/--border/--error` are
  aliases so the 6k-line stylesheet stays theme-correct without a rewrite.
  Preference is local-only under the bounded key `nanocloud.theme`
  (`dark|light|system`) — no backend field. A pre-render bootstrap in
  `index.html` stamps `<html data-theme>` before first paint; `ThemeProvider`
  then owns the same value.
- **Shell**: collapsible grouped left nav from one model (`navModel`), compact
  top bar, one user popover (identity / account / language / theme / sign out),
  accessible mobile drawer rendering the SAME nav.
- **Cloud Functions**: four tools (Upload, Organize, Archive, TV Devices) behind
  a tablist, selected tool in `?tool=`, complete tool rendered below. Private
  Vault removed from the hub (it stays in primary nav). `/upload` and
  `/tv-devices` redirect to the canonical tool URL.
- **Library chrome**: segmented kind switcher with a reserved count slot,
  Active/Excluded demoted into the command bar, one toolbar with an
  active-filter count. Grid, paging, selection and query semantics untouched.
- **Viewer/drawer**: size + effective Date Taken under the display name (the
  upload-time fallback is never shown as Date Taken); grouped actions;
  strip-metadata removed from the UI (backend capability untouched); shared
  album picker; Library-filter vs Explorer as two distinct actions.
- **Similar Photos**: now renders on the shared `MediaGrid`/`MediaViewer`;
  `MediaGrid` gained one optional `badges` prop (not forked).

Decisions worth remembering:

- `MediaItem.takenAt` is `EffectiveDateTaken`, which FALLS BACK to `CreatedAt`.
  Only `FileMetadata.effective.dateTakenSource` distinguishes a real capture
  date, so the viewer summary needs the metadata document and suppresses the
  `uploaded` source entirely.
- `GET /api/files/{id}/content` already streamed the immutable original
  (`OpenContentAsync` → `BlobService`, attachment + original name), so the
  download decision gate required NO backend change.
  `OriginalDownloadContractTests` pins it.
- React Router's `replace: true` DROPS route state. The explorer syncs its
  threshold that way, so its return target is captured once on mount.
- The similar-photo DTO carries no pixel dimensions, so explorer tiles use the
  shared square fallback ratio rather than each photo's real ratio. Closing that
  needs a DTO addition — deliberately out of this slice.

## Active slice — VFACE-01 canonical video face tracks

Branch `feat/video-face-tracks`, started from `main` (`8d49d4c`). Not pushed,
not merged, not deployed; no production backfill and no janitor run.

Adds the canonical, blob-level face-track substrate for videos:

```text
video blob → bounded temporal sampling → face detection + recognition
           → deterministic association → canonical face tracks
```

- New tables `video_face_analysis_statuses` and `video_face_tracks`
  (migration `AddVideoFaceTracks`, additive only: it analyses nothing, enqueues
  nothing and never touches the photo face/People tables).
- New config section `Ai:VideoFaceAnalysis`, **disabled by default**, with hard
  caps on frame interval, frames per segment, frames per video and faces per
  frame, plus a whole-video wall-clock budget.
- New job `ai.videos.faces.backfill` (Compute band) plus
  `ai video semantic faces backfill` / `retry-failed faces`. Scheduled after a
  temporal manifest COMPLETES, independently of VSEM-02 visual embeddings.
- Sampling, association and aggregation are three pure, separately tested units.

Decisions worth remembering:

- VSEM-01 samples one frame per 2–20 s segment — measured as far too sparse for
  tracking, so face analysis has its OWN deterministic sampling policy (default
  1 fps) over the same segment boundaries. VSEM sample manifests are read-only.
- The face package profile (detector + recognizer in one `AiProfile`) is reused
  unchanged, so video tracks live in the photo recognition space.
- Gate 4: **no representative crop is persisted.** The representative timestamp
  and normalized bounding box are stored instead, so a crop can be regenerated
  from the immutable original on demand. `RepresentativeCropBlobObjectId` exists
  and is always null, reserved for VFACE-02.
- Cost per analysed video: **0 persistent frame/crop bytes**; persistent
  database cost is limited to the analysis status row and the track embeddings.
- VFACE-01C: face frame resolution is `Ai:VideoFaceAnalysis:FrameMaxEdge`
  (default 768, range [640, 8192]), passed to the shared FFmpeg extractor per
  invocation. VSEM-02 keeps `Ai:VideoVisualEmbeddings:FrameMaxEdge`; changing
  one cannot move the other.
- Tracks are evidence only. No `OwnerUserId`, `FileItemId`, `PersonId` or person
  name is stored, and cross-track / cross-video clustering is VFACE-02.

## Active slice — VFACE-02 owner-level video identity

Branch `feat/video-face-people`, **stacked on `feat/video-face-tracks`** (`f325e8c`),
not on `main`. Not pushed, not merged, not deployed; no production backfill and
no janitor run.

Connects canonical `VideoFaceTrack` evidence to the existing owner-level People
model:

```text
canonical blob-level track → owner suggestion → explicit user decision
                           → person videos with temporal intervals
```

- New table `video_face_track_person_decisions` (migration
  `AddVideoFaceTrackPersonDecisions`), one row per `(OwnerUserId,
  VideoFaceTrackId)`; a missing row means undecided. **No `PersonId` was added
  to `VideoFaceTrack`.**
- `people` gained an alternate key `(Id, OwnerUserId)` so decisions carry a
  COMPOSITE foreign key — a cross-owner person assignment is unrepresentable,
  not merely rejected.
- `VideoFaceTrackIdentitySuggestionService`: owner-scoped, profile-compatible,
  bounded top-K over the owner's own confirmed evidence (static faces + already
  confirmed tracks). Exact in-process cosine, so no second vector index and no
  pgvector dependency. Threshold is the existing
  `ai.face.candidateSimilarityThreshold`.
- `VideoFaceTrackPeopleService`: assign / ignore / clear, the undecided review
  queue, person video results, and co-presence.
- API under `/api/people/video-tracks/...` plus `/api/people/{id}/videos` and
  `/api/people/{id}/co-present/{otherId}`. `/api/people/{id}/photos` unchanged.
- Frontend: a "Faces in videos" People tab (review + suggestions + assign +
  ignore) and a video section on the person detail page that opens the existing
  media viewer at the representative timestamp.

Decisions worth remembering:

- Nothing automated writes a decision. Suggestions are advisory and are never
  persisted; there is no auto-assignment job and no way to create a person from
  a track.
- Co-presence requires temporal overlap **within one canonical analysis**.
  VFACE-02C made the predicate strict half-open and configuration-free:
  `A.Start < B.End && B.Start < A.End`. Adjacent intervals are not co-present;
  a 1 ms genuine overlap is. There is deliberately **no** tolerance derived from
  `FrameIntervalMilliseconds` — a query about persisted evidence must not change
  answer when an operator retunes sampling.
- `Ai:VideoFaceAnalysis:Enabled` governs **generation only** (post-segmentation
  scheduling + backfill execution). It is not a kill switch: with it off, every
  persisted track, decision, person-video result and co-presence answer stays
  readable, and assign/ignore/clear keep working. `VideoFaceTrackPeopleService`
  injects neither the options nor the flag, so both dependencies are
  structurally impossible rather than merely absent.
- Deep EF compositions over the visibility predicate do not translate on SQLite;
  the person-media path deliberately uses two flat queries instead.

Next: production enablement planning for VFACE-01/02 (still flag-off), and real
footage validation of tracker quality and suggestion accuracy.
