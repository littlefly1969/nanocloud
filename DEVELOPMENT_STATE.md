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

See `ARCHITECTURE.md` for the complete design and invariants, `README.md` for
setup and usage, and `docs/current-work.md` for the active development state.
