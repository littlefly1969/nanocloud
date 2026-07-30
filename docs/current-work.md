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

Next: VFACE-02 (owner-level identity decisions over these canonical tracks).
