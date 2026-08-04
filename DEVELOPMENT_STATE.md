# NubArca — Development State

NubArca `0.3.0` is the current baseline. It is a self-hosted personal cloud
implemented with ASP.NET Core, EF Core, PostgreSQL, React and TypeScript, with
local content-addressed blob storage and Docker Compose deployment.

## Stable areas

- Authentication and owner-scoped file/folder operations
- Trash, restore, sharing, albums and private media organization
- Photo and video galleries, derivatives, metadata and playback
- Durable background jobs, resumable staging and administrative imports
- Storage reconciliation, reference accounting and controlled cleanup
- Local face, image-semantic and video-semantic processing
- Web and TV clients

## Core invariants

- Binary originals are immutable and never stored in PostgreSQL.
- User-visible paths are database-owned and never map to physical blob paths.
- Every file/folder operation is owner-scoped; missing and foreign resources
  have indistinguishable responses.
- Storage keys, hashes, blob identifiers, token hashes, raw metadata and
  physical paths never cross public API boundaries.
- Blob references are acquired and released exactly once by every owning
  domain object. Physical deletion happens only after the final reference is
  gone and the configured grace period has elapsed.
- Derived media is regenerable and cannot invalidate an original.
- Schema changes use additive, reviewed EF Core migrations.

## Operational notes

- Production uses separate API, worker and frontend containers.
- Database migrations are applied explicitly during deployment.
- Trash retention and unreferenced-blob grace are independent controls.
- Cleanup and deployment procedures are documented in
  `deploy/FAST_DEPLOY.md`.

## Release record — 0.3.0

| | |
| --- | --- |
| server / web release | `0.3.0` |
| NubArca TV | `1.0.1`, `versionCode` 2, runtime `nubarca-tv-native-2` (not advanced) |
| tracked files | 1,676 |
| tracked bytes | 46,367,868 (44.2 MiB) |
| identity scan | clean — 1,587 tracked text files, 13 permitted occurrences, all `/opt/nanocloud` |
| identity checker self-test | 49/49 (40 rejected, 9 allowed) |
| secret scan | no keys, tokens, certificates or filled `.env`; `.env.example` is a template |
| large-file scan | largest tracked files are the approved brand asset package |
| backend tests | 3,174 local + 98 external passed, 2 skipped (unavailable external dependencies) |
| frontend tests | 1,207 passed; typecheck and production build clean |
| TV tests | 121 passed; typecheck clean; the released APK was **not** rebuilt |
| mobile | typecheck clean |
| database migration | `RenameLogicalContainerKeyPrefixes`, proven on seeded pre-cutover rows including reversibility and idempotence |

Intentionally excluded from the tracked tree, by class: `.env` and any filled
configuration, signing keys and certificates, APK/AAB artifacts, AI model
binaries, database backups, archives, build output, dependency directories,
browser artifacts, scratchpad files, and the local Compose overrides that pin
images and bind host paths (`docker-compose.prod.local.yml`,
`docker-compose.release.local.yml`) — those are operator files that necessarily
differ per installation.

## The one retained legacy path

`/opt/nanocloud` is the production deployment checkout. It is a live filesystem
location on the running host, not a product identifier, and it is the single
textual exception `scripts/check-identity-cleanliness.sh` permits — as that exact
path only. Everything else, including every path *inside* the checkout and inside
the images, is `nubarca`.

See `ARCHITECTURE.md` for the complete design and invariants, `README.md` for
setup and usage, and `docs/current-work.md` for the current baseline.
