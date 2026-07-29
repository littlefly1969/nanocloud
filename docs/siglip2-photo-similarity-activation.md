# Activating SigLIP2-base photo similarity (production runbook)

> Superseded legacy runbook. Do not use for a new rollout. See
> [multimodal-photo-search.md](multimodal-photo-search.md) for So400m/1152.

SigLIP2 base is the chosen production photo-similarity model.

| | |
|---|---|
| Profile | `photo-siglip2-base-patch16-384-v1` |
| Model | `google/siglip2-base-patch16-384` (provider `onnx`) |
| Dimension | **768** |
| Vector backend | pgvector table `blob_embedding_vectors_768` (HNSW cosine) |

This runbook activates it end-to-end on the **old server** (the active deploy
target; the new server migration is **not** blocking this). Until you switch the
active profile, similarity keeps serving the deterministic profile via exact-scan
— so this is reversible at every step.

Prereqs already in place (Phase 2A/2B): the ONNX eval harness, the profile
lifecycle (`Ai__PhotoSimilarityProfileKey`), and the pgvector foundation
(`pgvector/pgvector:pg17` + the `AddPhotoVectorIndex768` migration). See
[ai-photo-profile-lifecycle.md](ai-photo-profile-lifecycle.md) and
[ai-photo-pgvector.md](ai-photo-pgvector.md).

```bash
cd /opt/nanocloud
DC="docker compose -f docker-compose.prod.yml -f docker-compose.prod.local.yml --env-file .env"
```

## How vectors get indexed (automatic + repair)

The photo-embeddings backfill now **auto-indexes the pgvector row as each 768-d
`BlobEmbedding` is written** — no fragile manual sequencing. The vector upsert is
best-effort and *secondary*: if pgvector is unavailable/unsupported or an insert
fails transiently, the canonical `BlobEmbedding` is still kept and the vector row
is simply left missing for a later repair. `vector-sync` remains the idempotent,
profile-keyed catch-up/repair command. A vector failure never fails the backfill
and never emits per-blob noise (aggregate counters only).

## 1. Confirm model readiness

The SigLIP2-base ONNX weights must be present under `Ai__Onnx__ModelDir`
(mounted read-only into api+worker).

```bash
$DC exec api dotnet NanoCloud.Api.dll ai onnx image models
#   ... photo-siglip2-base-patch16-384-v1 ... model_present=True
```

If `model_present=False`, place/mount the export and set `Ai__Onnx__ModelDir`
(see [ai-image-onnx-evaluation.md](ai-image-onnx-evaluation.md)).

`model_present=True` proves only that a file exists. Validate the tensor contract
and one real inference before any mass backfill:

```bash
$DC exec api dotnet NanoCloud.Api.dll ai onnx image benchmark \
  --profile photo-siglip2-base-patch16-384-v1 --limit 1
# expect: attempted=1 succeeded=1 failed=0
```

`Missing Input: input_ids` means the installed file is the combined SigLIP
text+vision graph, not the required vision tower. Replace the export; never
work around it with dummy text inputs.

## 2. Ensure ONNX image settings (do NOT switch the active profile yet)

```env
# .env
Ai__Enabled=true
Ai__Provider=onnx
Ai__ImageEmbeddingsEnabled=true
Ai__PhotoSimilarityProfileKey=
Jobs__WorkerEnabled=false   # dedicated Compose worker is the only consumer
```

Leave `Ai__PhotoSimilarityProfileKey` **empty** for now — the read path stays on
the deterministic default fallback. Restart api+worker if you changed `.env`:

```bash
$DC up -d api && $DC --profile worker up -d worker
```

## 3. Seed profiles if needed

```bash
$DC exec api dotnet NanoCloud.Api.dll ai onnx image seed-profiles
$DC exec api dotnet NanoCloud.Api.dll ai profiles   # photo-siglip2-base-... present, default=False
```

## 4. Enqueue the full SigLIP2-base backfill (profile-keyed)

```bash
$DC exec api dotnet NanoCloud.Api.dll jobs enqueue ai-photos-embeddings-backfill \
  --profile photo-siglip2-base-patch16-384-v1
```

Writes **only** that profile, idempotent, cooperative/sliceable/cancellable. With
pgvector available, each embedding's 768-d vector is auto-upserted as it is
written. CPU embedding is slow (~seconds/image) — expect this to run for a while;
it resumes safely across slices and restarts.

The CLI idempotency key collapses duplicate `queued`/`running` requests only.
After a prior job reaches `succeeded`, `failed`, or `cancelled`, running this
command again creates a fresh job; data-level idempotency still skips embeddings
already stored for the selected profile.

After activation, future successful/partial admin imports automatically enqueue
one profile-keyed photo-embedding backfill when `Ai__Enabled` and
`Ai__ImageEmbeddingsEnabled` are true. The per-import idempotency key prevents a
duplicate hand-off. Direct uploads remain cheap; operators can run the same
idempotent catch-up command when needed.

## 5. Monitor

```bash
$DC exec api dotnet NanoCloud.Api.dll ai photos embeddings coverage \
  --profile photo-siglip2-base-patch16-384-v1
#   embedded → eligible_images, vector_indexed → embedded, missing_vectors → 0

$DC exec api dotnet NanoCloud.Api.dll jobs list          # job progress/status
$DC exec api dotnet NanoCloud.Api.dll ai diagnostics     # expect total=0
```

Provider/model unavailable is a clean no-op (one aggregate transient diagnostic
at most, never per-blob `skipped`/`failed`). Cancelling the job is safe (never a
permanent failure); re-running is idempotent. Individual bad files are counted
without leaking identifiers. A terminal run that produces zero embeddings while
all processed items fail is a job failure, not a misleading `succeeded` result.

## 6. Repair / sync vectors if needed

Only needed if some vectors were deferred (transient errors, or the backfill ran
while pgvector was briefly unavailable):

```bash
$DC exec api dotnet NanoCloud.Api.dll ai photos embeddings vector-sync \
  --profile photo-siglip2-base-patch16-384-v1 --dry-run     # preview
$DC exec api dotnet NanoCloud.Api.dll ai photos embeddings vector-sync \
  --profile photo-siglip2-base-patch16-384-v1               # repair
```

## 7. Switch the active profile (only when coverage is acceptable)

When `coverage` shows `embedded` ≈ `eligible_images` and
`vector_coverage_percent` ≈ 100:

```env
# .env
Ai__PhotoSimilarityProfileKey=photo-siglip2-base-patch16-384-v1
```

```bash
$DC up -d api && $DC --profile worker up -d worker
```

## 8. Validate

```bash
$DC exec api dotnet NanoCloud.Api.dll ai photos embeddings active-profile
#   source=config  profile=photo-siglip2-base-patch16-384-v1  usable=True  dimension=768

$DC exec api dotnet NanoCloud.Api.dll ai photos similar --file <FILE_ITEM_ID> --limit 10
$DC exec api dotnet NanoCloud.Api.dll ai diagnostics            # total=0
$DC exec api dotnet NanoCloud.Api.dll storage blobs audit-references
```

In the web app, open an owner image in the viewer → **Details (ⓘ) → Similar
photos** → expand. Results show thumbnails + names; clicking one navigates to it.
Before coverage is ready the section reads: *"Similar photos will appear as the
photo index is built."* — never broken.

## Rollback

Fully reversible, no data/storage changes:

1. Unset the key and restart — the read path returns to the deterministic
   exact-scan fallback immediately:

   ```env
   Ai__PhotoSimilarityProfileKey=
   ```
   ```bash
   $DC up -d api && $DC --profile worker up -d worker
   ```
2. SigLIP2 `BlobEmbedding` rows and `blob_embedding_vectors_768` rows are left
   **intact** (they coexist with the deterministic profile), so re-switching
   later is instant — no re-backfill.
3. No blob/storage changes are ever made by any of the above.

## Notes / safety

- Profiles are never mixed: every read/write filters by `ProfileId`.
- Owner-private only; no public-share AI; no cross-owner search.
- No raw vectors / `BlobObjectId` / SHA / `StorageKey` / paths in any CLI/API/UI
  output — counts, stable keys, dims, file names, rounded scores only.
- Changing the model later is the same lifecycle: backfill the new profile,
  `vector-sync` (or rely on auto-upsert), switch the key. A model whose dimension
  ≠ 768 first needs its own `blob_embedding_vectors_<dim>` table (additive
  migration) — see [ai-photo-pgvector.md](ai-photo-pgvector.md).
