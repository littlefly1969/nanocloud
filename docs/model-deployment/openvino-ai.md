> **REMOVED (2026-07-17).** The Python OpenVINO sidecars (`nanocloud-openvino-query`,
> `nanocloud-openvino-worker`) described below were replaced by in-process
> OpenVINO inference (`openvino-direct`) in api + worker — see
> [openvino-direct-siglip-rollout.md](../openvino-direct-siglip-rollout.md).
> This document is kept for history only; `docker-compose.openvino-ai.yml` and
> `scripts/openvino-ai-sidecar/` no longer exist.

# OpenVINO FP32 AI acceleration and Party fast lane

This slice accelerates the existing, quality-validated NubArca ONNX models. It
does not change checkpoints, embedding dimensions, preprocessing, tokenization,
thresholds, vector tables, blobs, or ownership/privacy rules.

## Runtime policy

All inference remains FP32. Production measurements rejected FP16 for ArcFace:
on 100 vectors / 4,950 pairwise comparisons it changed the nearest neighbour in
10% of the synthetic numerical probes. GPU FP32 retained 100% neighbour
agreement with a maximum pairwise cosine delta of 0.00000221.

Two internal-only sidecars isolate latency from throughput:

| Host process | Model | OpenVINO device | Reason |
| --- | --- | --- | --- |
| API/query | SigLIP2 text | GPU | minimum semantic-query latency |
| API/query | SCRFD + ArcFace selfie | CPU | predictable Party query latency while worker GPU is busy |
| worker | SigLIP2 image | CPU | measured faster than GPU in FP32 on the production host |
| worker | SCRFD + ArcFace indexing | GPU | measured fastest FP32 face path |

This table describes the **currently deployed policy**. The target-host
benchmark also proved that concurrent CPU+GPU FP32 reaches 0.929 img/s, about
37% above the six-P-core OpenVINO run, with identical measured top-5/10/20
rankings. The recovered benchmark used separate CPU/GPU `InferRequest` objects
and a two-thread work queue; it was neither `MULTI` nor `HETERO`. See the full
[SigLIP2 benchmark report](openvino-siglip2-benchmark-2026-07.md).

The .NET process keeps the exact ImageSharp and Hugging Face tokenizer paths and
sends only preprocessed, bounded tensors to the sidecar. The sidecar mounts no
blob storage, database, secrets, or public port.

`Ai:Onnx:ExecutionProvider=onnxruntime` is the default and preserves the old
in-process path. Selecting `openvino` is fail-closed: an unavailable sidecar
causes the AI operation/job to retry or report unavailable; it does not silently
mix providers midway through an index generation.

## Post-ingestion ordering

Every normal image upload, including deduplicated logical copies, schedules only
missing work for that exact blob/file:

1. preview derivative, priority 40;
2. targeted face detection, priority 60;
3. targeted face embeddings, chained after committed detection, priority 60;
4. metadata, priority 100 when needed;
5. SigLIP2 image embedding, priority 200.

Party upload uses the same idempotent pipeline with preview priority 20 and face
priority 30. It does not wait for AI before returning or making an auto-approved
photo visible. SigLIP remains priority 200, so a burst cannot delay Party face
availability. Global operator backfills remain unchanged.

## Production configuration

Determine the render-device group and set host-specific affinity in `.env`:

```sh
stat -c %g /dev/dri/renderD128
```

```dotenv
OPENVINO_AI_MODEL_DIR=/srv/ai-models
OPENVINO_RENDER_GID=<result above>
OPENVINO_QUERY_CPUSET=0,2,4,6,8,10
OPENVINO_WORKER_CPUSET=0,2,4,6,8,10
OPENVINO_QUERY_CPU_THREADS=6
OPENVINO_WORKER_CPU_THREADS=6
OPENVINO_QUERY_MEMORY_LIMIT=6g
OPENVINO_WORKER_MEMORY_LIMIT=6g
OPENVINO_WORKER_PHOTO_IMAGE_DEVICE=DUAL:CPU,GPU
OPENVINO_WORKER_PHOTO_IMAGE_CONCURRENCY=2
OPENVINO_WORKER_PHOTO_IMAGE_PERFORMANCE_MODE=LATENCY
OPENVINO_WORKER_PHOTO_IMAGE_NUM_REQUESTS=0
Jobs__MaxConcurrentJobs=2
Ai__MaxConcurrency=2
```

The query sidecar needs the larger limit while compiling the SigLIP2 text tower;
3 GiB was measured insufficient on the production host (container exit 137).
Steady-state resident memory is lower, but the compile-time peak is authoritative.
The DUAL worker limit is 6 GiB because it keeps CPU and GPU image executions
available alongside the two GPU face graphs. The former CPU-only worker measured
about 2.9 GiB after warm-up and already had insufficient headroom at 3 GiB.

CPU sets are topology-specific. The example is correct only for the measured
i7-12650H host (one logical thread from each P-core). Do not copy it to another
machine without checking `lscpu -e=CPU,CORE,SOCKET,ONLINE`.

Compose the fragment with the same production/local files already used by the
host:

```sh
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.local.yml \
  -f docker-compose.human-aesexpert.yml \
  -f docker-compose.openvino-ai.yml \
  --env-file .env up -d --build
```

HumanAesExpert stays opt-in and independent. Its presence does not make normal
or Party uploads enter the aesthetics pipeline.

## Measured next optimization

Do not configure `HETERO:GPU,CPU` expecting it to reproduce the mixed result.
On this model it assigned the entire graph to the GPU and reached only
0.439 img/s. Real-path OpenVINO MULTI variants were also slower
(0.432–0.634 img/s). Production therefore uses `DUAL:CPU,GPU`: one exclusive
CPU executor and one exclusive GPU executor behind a bounded availability queue,
matching the recovered benchmark. Defaults remain one slot/request; rollback is
configuration-only.

Party preview and face jobs keep priorities 20/30, ahead of normal preview/faces
and SigLIP2 priority 200. DUAL therefore applies to Party image embeddings too,
while Party-visible derivatives and face recognition retain the fast lane. Two
already-running inferences are not preempted. A deliberate worst-case contention
probe kept warm face p50 near 50 ms but raised detection/recognition p95 to about
2.6/4.9 s; new Party face jobs take precedence after that in-flight work ends.

## Validation and rollback

Before enabling:

```sh
docker compose -f docker-compose.openvino-ai.yml --env-file .env build
docker compose -f docker-compose.prod.yml -f docker-compose.prod.local.yml \
  -f docker-compose.openvino-ai.yml --env-file .env config
```

After startup, both `nanocloud-openvino-query` and
`nanocloud-openvino-worker` must become healthy. The sidecars preload every model
they serve, so missing weights, GPU access, or an unsupported graph prevents
readiness rather than failing the first user query.

Rollback is configuration-only: deploy without `docker-compose.openvino-ai.yml`
and restart API/worker. They return to ONNX Runtime CPU. Stored FP32 embeddings
remain compatible and require no refill.
