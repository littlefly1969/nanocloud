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

## Next work

No development slice is currently open. Record only the active task here when
new work starts, then reduce this file back to the current baseline when it
closes.
