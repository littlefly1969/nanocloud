# NubArca current work

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

## Active slice — SHARE-ALBUM-01 live album sharing, Viewer role

Branch `feat/album-sharing-viewer`, started from `main` (`70815d8`). Not pushed,
not merged, not deployed. ONE additive migration (`AddAlbumMemberships`, a new
table only — nothing existing is altered). No backfill, no job, no TV/AI/storage
change.

Introduces authenticated album sharing between NubArca users. An album still has
exactly one owner; a membership grants a DIFFERENT user bounded, revocable
access to that one album. Only the **Viewer** role is enabled — `contributor`
and `editor` exist in the closed role catalog + check constraint so
SHARE-ALBUM-02/03 extend behaviour without a schema change.

```text
owner invites by exact email → recipient accepts → grant re-resolved on EVERY
request → owner revokes → dead on the next call
```

- **One gate**: `IAlbumAccessResolver` is the only place allowed to conclude
  that a non-owner may see an album's media. The owner-only `/api/files/{id}/*`
  endpoints are untouched — shared media is a SEPARATE family
  (`/api/shared-albums/...`) that resolves a grant and then calls the SAME
  unchanged owner-scoped services with the ALBUM OWNER's id. That is the shape
  the public Party surface already uses.
- **Frontend**: an owner Share panel (separate from Settings, where Show-on-TV
  and Party live), a "Condivisi con me" primary destination, invitation
  accept/decline, and a purpose-built recipient viewer.

Decisions worth remembering:

- **NubArca has no public account identifier.** `Email` is the only unique
  human-typeable field and `DisplayName` is the only one already shown as an
  identity. So invitations are addressed by EXACT email (never a prefix — over a
  unique identifier that is a directory-enumeration primitive). No endpoint
  returns another user's email or user id; an owner addresses a member row by
  its `MembershipId`.
- **`DisplayName` is not unique, so the owner's member list carries a MASKED
  account hint** (`RecipientEmailMask`: `m•••i@nubarca.local`). Without it an
  owner with two members called "Mario Rossi" cannot tell which one to revoke —
  a correctness problem for the owner, and a sharper one in SHARE-ALBUM-02 where
  a contributor's items appear in someone else's album. The hint is served ONLY
  by the owner-only member list, only ever masked, and is absent from every
  recipient-facing shape. Confirmations and the download aria-label use the same
  disambiguated label, so no destructive action is ever confirmed ambiguously.
- **`DeleteAsync` now clears `album_memberships` too.** They carry the same FK
  Restrict as `album_items`, so deleting an album that had EVER been shared —
  including one whose shares were all revoked, since a revoke keeps the row for
  the audit trail — failed on the constraint with a 500. Found in the browser,
  not by the unit suite; now pinned by two regression tests.
- **Shared media is `no-store`, the owner's own stays `private, max-age=86400`.**
  Revocation must be effective on the next request, and a 200 already sitting in
  the recipient's HTTP cache would outlive it. Verified in the browser: a
  thumbnail URL the page already holds returns 404 the moment access is revoked.
- **One row per (album, member), reused on re-invite.** A plain unique index
  behaves identically on PostgreSQL and the SQLite the endpoint tests use;
  a partial one would not. History lives in the audit log, which is where a
  security question about it should be answered from.
- **The owner is authoritative from the `Album` row alone.** No synthetic owner
  membership row exists, so the owner's access cannot be broken by inconsistent
  membership data — and "owner" is deliberately absent from `AlbumRoles`, making
  it unrepresentable as a membership write.
- **A disabled OWNER stops serving their shares**, not just a disabled member.
  The listing applies the same predicate as the media routes, so it can never
  advertise an album whose media would 404.
- Private Vault needed no new predicate: the global `PrivateVaultId == null`
  filter on `FileItems` already removes vaulted rows from every share query. A
  file moved into the vault AFTER joining an album keeps a stale `album_items`
  row — pre-existing behaviour, visible on the owner's own listing too — but it
  is unreachable through the share. Reported, not changed.
- **The shared wall reuses `computeJustifiedRows`.** A plain CSS grid was built
  first and the browser pass showed it was wrong: mixed portrait/landscape media
  left ragged rows and holes. `mediaWallRowParams` / `MEDIA_WALL_GAP_PX` were
  extracted from `MediaGrid` so both walls lay out with one set of numbers.
- **The lightbox does NOT reuse `.ws-sheet-backdrop`.** That is a side-sheet
  backdrop (32% dim, `justify-content: flex-end`); reusing it left the app shell
  fully readable behind the photo and the viewer chrome colliding with the top
  bar. It now matches `.face-viewer` / `.party-lightbox`.
- `HlsVideoPlayer` gained optional `videoUrl`/`posterUrl` props (defaulting to
  the owner routes) so the shared viewer reuses the real player instead of a
  second HLS implementation.
- Two verification traps worth remembering: Playwright's `goBack()` on an SPA
  returns `null` (History API, no document load), so a non-waiting `isVisible()`
  races the re-render; and two identically-generated fixture images dedupe to
  ONE blob, so a test that turns one into a video silently turns the other into
  one too.

## Superseded slice — UX-02 + VIDEO-HLS-05 wider workspaces, Laboratory, Faces, HLS

Branch `feat/ux-lab-faces-hls`, started from `main` (`13a5a3a`, the merged
TV-ID-01 tip). Not pushed, not merged, not deployed. No migration, no backfill,
no TV package/APK/signing change.

- **Compact brand mark**: the approved flat-mark master draws the symbol on a
  canvas far larger than itself — 528×476 of 1024×1024, so only 51.6% of the
  width and 46.5% of the height was ink, and a 16px favicon rendered ~10×8px of
  symbol. `scripts/generate-compact-brand-marks.py` crops that transparent
  excess once, at the source, and re-pads to a 603px square with a uniform safe
  margin (~1 physical pixel at 16px). Same geometry, same colours, no redraw.
  Package version 2.1. The shell mark is a 41px box showing ~36px of artwork
  (37px/~32px on mobile), up from a 26px box showing ~13.5px.
- **One layout system**: `.app-main` is full-width with `clamp(1rem, 2.5vw,
  2.5rem)` gutters. The media-wall opt-out (`app-main--media`,
  `mediaWallLayout.ts`) is gone; surfaces that need a reading measure use the
  local `.form-measure` instead.
- **Laboratory**: one primary destination at `/lab`, with route-backed sections
  `/lab/plates` and `/lab/aesthetics`; `/plates` redirects. Plates and
  Aesthetics keep their own APIs, storage and data models — only the shell is
  shared.
- **Faces**: the general area reads Volti/Faces; the named-cluster tab stays
  Persone/People. Routes, endpoints, DTOs and tables untouched — terminology,
  not a migration. The selected tab lives in `?tab=`, and a person detail
  returns to the tab that opened it (`facesTabs.ts`).
- **HLS startup**: the first fragment loads at a level chosen for the display
  and connection (`hlsLevelSelection.ts`); recovery is bounded
  (`hlsRecovery.ts`); preparation polling ramps 1.5→2.5→5 s and honours
  `Retry-After`, which the 202 now advertises.

Decisions worth remembering:

- The master playlist lists the HIGHEST rendition FIRST — ffmpeg's
  `-var_stream_map` is `v:0,a:0,name:high v:1,a:1,name:low`, verified against a
  real run. hls.js re-sorts its `levels` by bitrate, but nothing of ours may
  assume either order, so the selector sorts by pixel count itself.
- `Retry-After` is a MINIMUM wait (RFC 9110 §10.2.3), not an appointment. The
  endpoint is stateless and cannot estimate a transcode, so it sends a small
  constant and the client takes `max(localRamp, header)` — obeying it literally
  would pin polling at 2 s forever and discard the backoff.
- A custom property set as an INLINE style cannot be overridden by a media
  query. The mobile mark step-down therefore sets `.brand-mark__icon`'s width,
  not `--brand-mark-size`. The browser matrix caught this; the unit test had
  passed against the ineffective rule.
- hls.js's MSE branch is not reachable under the jsdom harness (the component's
  dynamic import resolves to the real library even when the test file mocks it),
  so the two decisions inside it are pure modules with their own tests and the
  wiring is verified in the browser instead.
- **Measured, not assumed**: the new policy does NOT make the first frame
  arrive sooner. On 2560×1440 the median time to first frame went 80 ms →
  154 ms, because the correct rendition means a bigger first segment. What it
  fixes is the rendition: 854×480 → 1920×1080, where the old path was still at
  480p after 3 s of playback. Small viewports are unchanged (52 → 49 ms, 480p
  both).

## Superseded slice — TV-ID-01 NubArca TV application identity

Branch `feat/nubarca-tv-identity`, started from `main` (`ee489a6`, which is also
the currently deployed SHA). Not pushed, not merged, not deployed. No database,
Docker volume, media storage or backend API identity changed; no GitHub
repository rename.

**NubArca and NubArca TV are separate applications sharing one backend and one
account ecosystem.** No universal mobile/TV binary. The mobile app will sync and
upload through the shared backend; TV stays remote-first on the limited pairing
and `/api/tv/*` contracts.

| | NubArca TV (now) | NubArca mobile (reserved) |
| --- | --- | --- |
| applicationId / bundle id | `it.littlefly.nubarca.tv` | `it.littlefly.nubarca` |
| slug / scheme | `nubarca-tv` | `nubarca` |
| version / versionCode | `1.0.0` / `1` | — |
| OTA runtime | `nubarca-tv-native-1` | — |

Retired with no upgrade path (an applicationId cannot be renamed):
`it.littlefly.nanocloudtv`, slug `nanocloud-tv`, runtime `tv-native-3`, storage
key `nanocloud.tv.session.cookie`, artifact `nanocloud-tv.apk`.

**BLOCKED before publication and device install.** Two operator inputs are
missing; everything else in the slice is complete and validated.

Decisions worth remembering:

- **The release build was never really signed.** `expo prebuild` regenerates
  `android/` from the RN template, whose release buildType is
  `signingConfig signingConfigs.debug`. The published 0.2.0 APK is signed
  `CN=Android Debug` (`fac61745…`) — a publicly known key, so anyone could have
  produced an "update" for it. A committed edit to `android/` cannot fix this
  because prebuild deletes it; `tv/plugins/withReleaseSigning.js` re-applies the
  fix every time and **fails** `assembleRelease` (at task-graph time, in ~40 s)
  rather than falling back.
- **The API base URL is resolved twice.** `app.config.js` runs once for prebuild
  and again for the Gradle JS-bundling step, and only the second decides what
  the shipped app talks to. Exporting the URL for prebuild alone produced a
  release APK that passed *every* manifest check — package, label, leanback,
  banner, signature — while its bundle pointed at the LAN dev default with
  cleartext already disabled: it installs, launches, and can never reach a
  server. Now guarded in two places: `app.config.js` throws under
  `NODE_ENV=production`, and `deploy/publish-tv-apk.sh` refuses to publish an
  APK whose embedded `extra.apiBaseUrl` is not HTTPS.
- OTA isolation is structural, not conventional: publications and channel
  pointers are keyed by runtime (`publications/android/<runtime>/`), so the
  retired `tv-native-*` series and `nubarca-tv-native-*` cannot cross. The
  backend `/api/tv-app/updates` treats the runtime as an opaque header value and
  needed no change.
- No AsyncStorage migration is possible, not merely skipped: the new
  applicationId gets a fresh private storage sandbox, so the old key is
  unreachable from the new package.
- `apksigner verify` reports `v1: false` for this APK even though a v1 block is
  present, because minSdk is 24 and it does not exercise the JAR path. Forcing
  `--min-sdk-version 21` shows v1/v2/v3 all true.
- Four compatibility entries were deleted rather than narrowed, and the source
  files that describe the retired identity deliberately do **not** spell it, so
  a regression to the old package id, slug, storage key or artifact name is
  rejected by `check-brand-cleanliness.sh` instead of being excused by a comment.

## Superseded slice — BRAND-01C NubArca asset integration (closes the rebrand)

Branch `feat/nubarca-rebrand`, started from `main` (`60984e8`), which already
contains the merged UX-01 work (`cfee4fd`). Not pushed, not merged, not
deployed.

Effective 31 July 2026 the product is **NubArca** (capital A); the TV product is
**NubArca TV**. See `docs/brand.md` for the palette, typography, geometry, asset
roles and the allowlist policy.

- **Similar Photos geometry**: the similarity DTO now resolves DISPLAY
  dimensions through `ImageDisplayDimensions`, the same helper the library and
  album listings use. It previously returned the CODED pair, so an EXIF
  quarter-turned photo got a landscape tile for a portrait thumbnail and the
  wall filled the gap with a blurred duplicate — the reported lateral bands.
- **Media wall**: no blurred backdrop layer at all any more, for photos or video
  posters. One media layer, `object-fit: cover`, over a tile reserved from the
  item's real ratio. The explorer's own page-level skeleton is gone; it used
  eight equal-width tiles that matched no real result.
- **Viewer actions**: eligibility lives in `media/viewer/mediaViewerActions.ts`
  and is a function of media kind plus explicit capability gates. Its signature
  cannot express an origin, so a photo offers the same actions from the Library,
  an album, a search result, a direct URL or Similar Photos — which gained the
  previously missing "Find similar in Library".
- **Brand**: assets generated reproducibly from preserved sources by
  `scripts/generate-brand-assets.py`; palette and geometry as design tokens;
  Space Grotesk + Exo 2 bundled locally (SIL OFL, no CDN); favicon, app icons
  and a PWA manifest, none of which existed before.
- **Compatibility**: `config/legacy-brand-compatibility.txt` declares every
  retained legacy identifier with why it stays and what would break;
  `scripts/check-brand-cleanliness.sh` enforces it and self-tests its own engine.
- **Canonical assets**: `assets/brand/nubarca/` is the source of truth (54
  assets, all checksums verified). `scripts/sync-brand-assets.py` copies
  runtime assets into `frontend/public/brand/` and `tv/assets/brand/`
  byte-for-byte; `--check` fails if a consumer copy drifts. The earlier
  generator is gone — it derived artwork from provisional sources.

Decisions worth remembering:

- The .NET assembly rename to `NubArca.*` was investigated and REJECTED. Jobs,
  EF migration history, Data Protection and cookie names would all survive it,
  but the assembly name IS the container entrypoint (`dotnet NanoCloud.Api.dll`)
  and is baked into every runbook command; proving it safe needs a deploy. The
  user-visible consequence was removed instead: the OpenAPI title AND the
  default tag on untagged endpoints are now set explicitly, where both
  previously defaulted to the assembly name.
- `IHostEnvironment.ApplicationName` was deliberately NOT changed: it feeds the
  Data Protection default purpose string, so touching it would invalidate live
  auth cookies.
- Browser-storage keys move to `nubarca.*` with a one-way migration that also
  lives in the pre-paint bootstrap, because that script decides the first paint.
- The photo-export folder rename carries a fallback: the generated script skips
  files it already has, so a bare rename would silently re-download the reader's
  entire archive.
- The approved light-surface wordmark sits on a much larger transparent canvas
  than the dark one (77.2% vs 98.3% width usage). `wordmarkAsset()` divides by
  that measured ratio so a requested width is the VISIBLE lockup's width in
  either theme — otherwise the light variant renders smaller and can slip under
  the 120px minimum.
- Renaming the GitHub repository and the `/opt/nanocloud` checkout is deferred
  to BRAND-02; both are allowlisted until then.

## Superseded slice — UX-01 app shell, cloud functions and media experience

Branch `feat/frontend-experience-refresh`, merged to `main` as of `cfee4fd`. Frontend-only except ONE new backend test
file; no migration, no DTO change, no AI/media/TV pipeline change.

- **Theme**: semantic tokens under `:root` (dark, the default) and
  `:root[data-theme='light']`; legacy `--bg/--fg/--muted/--border/--error` are
  aliases so the 6k-line stylesheet stays theme-correct without a rewrite.
  Preference is local-only under the bounded key `nubarca.theme`
  (`dark|light|system`) — no backend field, with a one-way migration from the
  pre-rebrand key. A pre-render bootstrap in
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
- ~~The similar-photo DTO carries no pixel dimensions.~~ CLOSED: the DTO now
  carries DISPLAY width/height, resolved exactly as the library resolves them.

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
