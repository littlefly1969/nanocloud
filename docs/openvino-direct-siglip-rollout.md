# SigLIP2 direct rollout — removing the Python OpenVINO sidecars

Status: rollout runbook for the `feat/openvino-direct-face-ai` SigLIP slice.
Face AI direct is already live on the API (see
[openvino-direct-face-rollout.md](openvino-direct-face-rollout.md)); this slice
moves the LAST two Python OpenVINO sidecars — `nanocloud-openvino-worker` and
`nanocloud-openvino-query` — into the .NET processes and removes them.
HumanAesExpert is a separate experimental Python sidecar and is intentionally
untouched by this milestone.

## Architecture

Before (sidecar mode): the .NET embedders did ALL preprocessing (image decode/
orient/resize/normalize) and ALL tokenization (`Tokenizers.HuggingFace` over the
exported `tokenizer.json`) in-process, then POSTed the raw input tensors to a
Python OpenVINO HTTP sidecar (`/v1/infer`, binary protocol) and L2-normalized
the returned vector.

After (direct mode): the SAME preprocessing/tokenization feeds
`IOnnxInferenceSessionFactory` (the Face AI infrastructure) in-process:

| Model            | Host   | OnnxModel enum   | Default device |
|------------------|--------|------------------|----------------|
| SigLIP2 image    | worker | `PhotoImage`     | CPU (benchmark: whole-graph GPU is slower) |
| SigLIP2 text     | api    | `PhotoText`      | CPU |
| Face detector    | both   | `FaceDetector`   | GPU |
| Face recognizer  | both   | `FaceRecognizer` | api CPU / worker GPU |

Everything is FP32 (mandatory for output-equivalence with the persisted
1152-dim `photo-siglip2-so400m-patch14-384-v2` embeddings — no reindex).
Providers are explicit and never silently fall back:
`onnxruntime` / `openvino-direct` → factory; legacy `openvino-sidecar` → HTTP
client (removed at the end of the milestone).

## Readiness / preload

- API (`/health/ready`): compile-backed preload of face detector + face
  recognizer + SigLIP text tower, with distinct sanitized failure codes
  (`PHOTO_TEXT_MODEL_MISSING`, `PHOTO_TEXT_TOKENIZER_MISSING`,
  `PHOTO_TEXT_COMPILE_FAILED`, `PHOTO_TEXT_VALIDATION_FAILED`, plus the ORT/
  OpenVINO/native/ABI/device codes shared with the face stages).
- Worker (`jobs worker`): inline preload + synthetic validation of the SigLIP
  image tower at startup (`photo-image preload READY/FAILED code=…` on the
  worker log). Failure never stops the worker: AI photo jobs no-op through the
  embedder's compile-backed readiness (environment state, never a per-blob
  content failure), non-AI jobs keep running.
- Note: `CheckReadiness` in direct mode COMPILES the model (authoritative,
  warm-cached). Running `ai status` in the api container therefore loads the
  photo image tower there too (~1.7 GB model) even though the api never runs
  image embedding jobs.

## Equivalence harness (run on the GPU host)

```bash
scripts/openvino-direct/siglip-equivalence.sh \
  --models /srv/ai-models \
  --fixtures ~/siglipeq/fixtures \
  --queries ~/siglipeq/queries.txt
```

Four paths through the REAL embedders (`ai onnx image-embed --dir`,
`ai onnx text-embed --queries-file`): ORT CPU (reference), OpenVINO CPU,
OpenVINO GPU FP32, isolated temporary Python sidecar. Compares per-vector
cosine/maxAbs/L2, token ids (must be identical), and per-query top-5 ranking
(same top-1, same top-5 set). The inline python3 comparator is a dev tool only
— never part of a runtime image.

## Deploy (minimal, no down)

```bash
cd /opt/nanocloud
DC="docker compose -f docker-compose.prod.yml -f docker-compose.prod.local.yml \
    -f docker-compose.facedirect-api.yml --env-file .env"
# .env: FACE_DIRECT_IMAGE=nanocloud-api:siglip-direct-<shortsha>
#       WORKER_DIRECT_IMAGE=nanocloud-worker:siglip-direct-<shortsha>
$DC up -d --no-deps --no-build api
$DC --profile worker up -d --no-deps --no-build worker
```

`docker-compose.openvino-ai.yml` is NOT part of the file set any more; after
the canary the two sidecar containers are removed with
`docker rm -f nanocloud-openvino-worker nanocloud-openvino-query`.

## Rollback (initial observation window only)

Point `FACE_DIRECT_IMAGE`/`WORKER_DIRECT_IMAGE` back at the previous images
(`nanocloud-api:facedirect-aae430c92d21`, `nanocloud-worker:latest`) and, if
the sidecar path is needed for the worker, temporarily re-add
`docker-compose.openvino-ai.yml` (from git history) to the file set. The
sidecar image `nanocloud-openvino-ai:local` is retained on the host during the
observation window. After final approval the sidecars are not a supported
fallback.
