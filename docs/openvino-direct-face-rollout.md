# Direct OpenVINO face pipeline — rollout, rollback & validation

Face AI milestone. The complete face pipeline runs **in-process** with no Python
OpenVINO sidecar:

```
image → .NET face preprocessing → direct OpenVINO face DETECTION
      → existing SCRFD decode + NMS → face alignment
      → direct OpenVINO face RECOGNITION → existing validation + L2 normalization
```

Both the detector (SCRFD, e.g. `antelopev2/scrfd_10g_bnkps.onnx`) and the
recognizer (ArcFace `glintr100.onnx`) route through `IOnnxInferenceSessionFactory`.
Provider selection is explicit and **never silently falls back**:

| `Ai:Onnx:ExecutionProvider` | Detector & recognizer path |
|---|---|
| `onnxruntime` | factory-created in-process ORT **CPU** session |
| `openvino-direct` | factory-created in-process **OpenVINO** session (CPU or GPU per model) |
| `openvino-sidecar` (alias `openvino`) | existing Python HTTP sidecar (rollback) |

SigLIP2 image/text embedding, semantic search, HumanAesExpert and the Python
sidecars are **out of scope** and unchanged; sidecars remain available for rollback.

## 1. Configuration

```jsonc
{
  "Ai": {
    "Enabled": true,
    "FaceProfileKey": "face-insightface-antelopev2-v1",   // selects WHICH face model preloads
    "Onnx": {
      "ModelDir": "/models/ai",
      "ExecutionProvider": "openvino-direct",
      "OpenVino": {
        "NativeDir": "/opt/nanocloud/ort-openvino",  // baked into runtime-openvino image
        "CacheDir": "/tmp/ov-cache",                 // bounded writable compile cache
        "FaceDetectorDevice": "GPU",                 // CPU | GPU (independent per model)
        "FaceRecognizerDevice": "CPU",
        "GpuPrecision": "FP32"                       // MANDATORY for equivalence
      }
    }
  }
}
```

Env form: `Ai__Onnx__ExecutionProvider`, `Ai__Onnx__OpenVino__FaceDetectorDevice`, etc.
Valid direct devices are **`CPU`** and **`GPU`** only — `DUAL`/`AUTO`/`MULTI`/`HETERO`
are rejected. Invalid config (unknown provider, bad device, non-FP32 GpuPrecision,
missing `NativeDir`) is rejected **at startup** (`AiOnnxOptionsValidator`); the
process does not silently degrade to CPU.

## 2. Startup, preload & readiness

Liveness and readiness are **distinct**:

* **Liveness** `GET /health` — green as soon as the process is up, *including while
  models compile*. The container is not killed mid-compile.
* **Readiness** `GET /health/ready` — green (`200`) only after the direct pipeline
  has fully compiled and synthetic-validated; otherwise `503` with a sanitized
  `{state, code}`.

Preload lifecycle (`OnnxFacePreloadService`, run once, bounded, cancellable):

```
STARTING → NATIVE_RUNTIME_INITIALIZING
        → FACE_DETECTOR_COMPILING → FACE_DETECTOR_VALIDATING
        → FACE_RECOGNIZER_COMPILING → FACE_RECOGNIZER_VALIDATING
        → READY            (or FAILED at any step)
```

Preload uses the **exact factory cache** the real requests use, so the first real
request is warm and no second compilation happens. Synthetic inputs are
deterministic in-memory tensors — **no** DB, storage, user photos or external files.
Detector validation checks output count/shape, finiteness, SCRFD-decodability and
finite decoded coordinates; recognizer validation checks dim 512, finiteness,
non-zero norm and successful L2 normalization.

Sanitized failure codes (surfaced by `/health/ready`, never a path/native text):

```
ORT_NATIVE_CORE_MISSING   OPENVINO_EP_MISSING             FACE_DETECTOR_MODEL_MISSING
ORT_NATIVE_LOAD_FAILED    OPENVINO_DEVICE_UNAVAILABLE     FACE_DETECTOR_COMPILE_FAILED
ORT_ABI_MISMATCH          FACE_DETECTOR_VALIDATION_FAILED FACE_RECOGNIZER_MODEL_MISSING
PRELOAD_TIMEOUT           FACE_RECOGNIZER_COMPILE_FAILED  FACE_RECOGNIZER_VALIDATION_FAILED
```

Direct mode is **fail-closed**: a failure leaves readiness unhealthy and does not
mark blobs/files `skipped`/`failed` (provider-unavailable is an environment state).
The container health check (`docker-compose.openvino-direct.yml`) targets
`/health/ready` with a generous `start_period` for GPU compile, then marks a
permanently-failing instance unhealthy.

## 3. Reversible live rollout

Switching providers is **configuration + Compose only** — no code change, no image
rebuild required to fall back.

**To direct mode** (layer the direct override on prod; see `CLAUDE.md` for the full
`$DC` pattern and the never-`source`-`.env` rule):

```bash
cd /opt/nanocloud
export NANOCLOUD_GIT_SHA="$(git rev-parse HEAD)"
export OPENVINO_AI_MODEL_DIR=/srv/nanocloud/models/ai
export OPENVINO_RENDER_GID="$(stat -c '%g' /dev/dri/renderD128)"   # GPU only
export NANOCLOUD_FACE_DETECTOR_DEVICE=GPU
export NANOCLOUD_FACE_RECOGNIZER_DEVICE=CPU
DC="docker compose -f docker-compose.prod.yml -f docker-compose.prod.local.yml -f docker-compose.openvino-direct.yml --env-file .env"
$DC build api worker
$DC up -d api worker
# wait for readiness (compile can take up to the health start_period)
curl -fsS http://127.0.0.1:8080/health/ready
```

**Expected preload duration:** CPU compile is seconds; GPU FP32 first compile is
tens of seconds (cached in `CacheDir` afterwards). The health check `start_period`
is 300s to cover a cold GPU compile.

### Rollback (config-only, sidecars retained)

```bash
cd /opt/nanocloud
# drop the direct override (and re-add the sidecar override if that is the baseline)
DC="docker compose -f docker-compose.prod.yml -f docker-compose.prod.local.yml -f docker-compose.openvino-ai.yml --env-file .env"
$DC up -d api worker      # back on the Python OpenVINO sidecar
```

Or, without changing files, force CPU in-process: set
`Ai__Onnx__ExecutionProvider=onnxruntime` and recreate `api worker`.
Do **not** delete sidecar images/config; do **not** change production defaults
without explicit authorization.

### Confirming what is actually running

```bash
# provider + device + native/OpenVINO versions + ABI match + loaded providers:
$DC exec api dotnet NanoCloud.Api.dll ai onnx runtime-info
# → configuredProvider=openvino-direct, providers=[...,OpenVINOExecutionProvider], abiMatch=True

# No Python OpenVINO calls: the direct api/worker image has NO python and the
# sidecar is not in the active project — verify:
$DC exec api sh -c 'command -v python3 || echo NO-PYTHON'      # → NO-PYTHON
$DC ps | grep -i openvino-query || echo "no sidecar in active stack"

# Memory / GPU:
docker stats --no-stream nanocloud-api nanocloud-worker
$DC exec api sh -c 'grep VmRSS /proc/1/status'
intel_gpu_top    # GPU utilization while a face backfill runs
```

## 4. Real-model validation (Part 5) — acceptance

Run on the model host with the actual weights, exercising the **application path**
(`ai onnx face-embed` → real `OnnxFaceBackend`), not standalone sessions:

```bash
scripts/openvino-direct/face-equivalence.sh \
  --models /srv/nanocloud/models/ai --fixture /srv/nanocloud/fixtures/face_fixture.jpg
```

Compares `onnxruntime` (reference) vs `openvino-direct` CPU vs `openvino-direct`
GPU FP32 (and, optionally, a **temporary isolated** sidecar).

**Recognition acceptance:** dim 512; no NaN/Inf; L2 ≈ 1; cosine ≥ **0.9999**;
maxAbsDiff ≤ **1e-4**; no material threshold regression.

**Detection acceptance (decoded, not raw tensors):** same face count; confidence,
bounding boxes and landmarks within documented tolerance; equivalent NMS result; no
new false positive; no missing expected face; deterministic on repeat.

If GPU FP32 diverges enough to change detection/recognition behavior, **stop and
report** — thresholds are not relaxed to pass the gate.

## 5. Bounded concurrency & lifecycle (Part 6)

```bash
# 4 concurrent callers, fixed iterations, global timeout, through the full pipeline:
scripts/openvino-direct/face-canary.sh --models … --fixture … --concurrency 4 --iterations 20
```

Verify: no native crash; no corrupted detector output or embedding; deterministic
dimensions; stable face count; bounded memory; cancellation works; shutdown does not
hang; sessions disposed once (owned by the factory); no request receives a disposed
session. Shared-session concurrency is validated by the real-container smoke test; if
detector concurrency proves unsafe, add an exclusive lease **for the detector only**
(the `IOnnxSessionLease` seam already exists) — do **not** build the general DUAL
scheduler here.

## 6. Isolated production canary (Part 8)

```bash
scripts/openvino-direct/face-canary.sh \
  --models /srv/nanocloud/models/ai \
  --fixture /srv/nanocloud/fixtures/face_fixture.jpg \
  --detector-device GPU --recognizer-device CPU
```

The script builds the image tagged with the exact commit, runs **isolated**
(`--network none`, `--read-only`, `--cap-drop ALL`, `--security-opt
no-new-privileges`, `--memory`/`--cpus` limits, models RO, `/dev/dri` + detected
render group only for GPU, `--rm` + teardown trap), uses **no** prod DB/storage/creds
and **no** ports, and asserts live prod container IDs + uptimes are unchanged
before/after. It captures runtime identity, readiness, preload time, first
post-ready vs warm timing, complete pipeline results, concurrency, RSS, CPU, GPU,
thread count, shutdown and cleanup.

## 7. Warm performance comparison (methodology)

Benchmark the **warmed** pipeline after preload — never compare a preloaded sidecar
with a cold direct process. Use equivalent warmed lifecycle states and matching CPU
affinity + thread limits (`Ai:Onnx:IntraOpThreads`); otherwise label results
**preliminary**.

Capture per provider (`ORT CPU`, `OpenVINO CPU`, `OpenVINO GPU FP32`, `Python
sidecar`): startup native init; detector compile; recognizer compile; total
readiness time; first post-ready request; warm p50; warm p95; throughput; API RSS;
idle CPU; load CPU; GPU utilization; process count; thread count.

| metric | ORT CPU | OV CPU | OV GPU FP32 | sidecar |
|---|---|---|---|---|
| native init (ms) | | | | |
| detector compile (ms) | | | | |
| recognizer compile (ms) | | | | |
| total readiness (ms) | | | | |
| first post-ready (ms) | | | | |
| warm p50 / p95 (ms) | | | | |
| throughput (img/s) | | | | |
| API RSS (MB) | | | | |
| idle / load CPU (%) | | | | |
| GPU util (%) | | | — |
| process / thread count | | | | |

## 8. Status of this milestone

Implemented + unit/integration-tested in-repo (fakes; no GPU/weights required):
detector migration, per-model device config, preload + readiness state machine,
provider routing, complete-pipeline tests, Docker/Compose direct-mode + readiness
health check. **Requires the model host + GPU to execute:** real-model equivalence
(§4), bounded-concurrency real-container smoke (§5), isolated canary (§6), warm
performance (§7). Run the scripts above on the model host to complete those gates.
