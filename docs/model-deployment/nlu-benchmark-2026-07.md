# NLU command-model benchmark (target-host, 2026-07)

On-host evaluation of local decoder candidates for the TV/web natural-language
gallery interpreter, versus the built-in deterministic grammar. Synthetic corpora
only (no user data); no private host identifiers recorded.

## Environment

- CPU: Intel Core i7-12650H (Alder Lake) — 6 performance + 4 efficiency cores,
  10C/16T, x86-64, AVX2 (no AVX-512). **Not ARM64** (task premise corrected).
- RAM: 30 GiB. Runtime: ONNX Runtime GenAI, CPU int4, Docker sidecar (concurrency
  1, greedy, `/no_think`). Measured while production API/worker/Postgres idle.
- E-cores = logical CPUs 12–15; P-cores = 0–11.

## Candidates

| Key | Repo | Revision | Quant | License |
|---|---|---|---|---|
| Phi-4-mini | microsoft/Phi-4-mini-instruct-onnx | `fc04c8f93df6…` | cpu-int4-rtn-block-32-acc-level-4 | MIT |
| Qwen3-1.7B | Qwen/Qwen3-1.7B → ORT-GenAI builder | `70d244cc86cc…` | int4 cpu (reproducible export) | Apache-2.0 |

Method: 85-case dev corpus (prompt tuning) + **102-case held-out corpus scored
once** (adversarial: lowercase names, common-noun names, AND/OR/exclusion, refine,
ambiguous dates, metadata-vs-semantic, typos, malformed). Few-shot compact-JSON
prompt (examples from the dev corpus only). One local repair attempt; valid-DTO
measured after repair. Scoring identical to `GalleryCommandBenchmark` (C#).

## Results — HELDOUT (102 cases), the decision surface

| Metric | Deterministic | Phi-4-mini | **Qwen3-1.7B** | Hard gate |
|---|---|---|---|---|
| valid-DTO | 100% | 100% | 100% | 100% |
| people include/exclude/all/any | **61.2%** | 16.3% | **79.6%** | **≥97%** |
| date accuracy | **91.7%** | 0.0% | **20.8%** | **≥95%** |
| operation | 99.0% | 4.9% | 94.1% | — |
| person span P/R/F1 | 100 / 71.4 / 83.3 | 86 / 57 / 69 | 82 / 94 / 87 | — |
| metadata-vs-semantic | 78.4% | 69.6% | 67.6% | — |
| exact structured match | 72.5% | 3.9% | 28.4% | — |
| warm p50 / p95 | **2.6 / 4.7 ms** | 10.8 / 12.9 s | **6.3 / 7.1 s** | p95 **≤6 s** |
| peak RSS | ~0 | 3.1 GiB | 1.95 GiB | ≤8 GB |
| model load | — | 7 s | 4 s | — |

E-cores-only latency (isolation experiment): Phi-4 ~32 s; Qwen3-1.7B ~2× the
P-core figure (~12–14 s) — both far over the gate, so E-core isolation is not
viable for either.

## Gate verdict

- **Phi-4-mini: FAIL** — people 16%, date 0%, p95 12.9 s.
- **Qwen3-1.7B: FAIL** — people-logic 79.6% (<97%), date 20.8% (<95%), p95 7.1 s
  (>6 s). It parses cleanly (valid-DTO 100%) and reads person spans well
  (recall 94%), but cannot do exact date arithmetic (a general LLM weakness) and
  is ~1500× slower than the grammar.
- **Neither candidate passes.** Per the task's rule, **do not enable an LLM**;
  keep the deterministic interpreter as the production interpreter
  (`Ai__NaturalGallerySearch__Interpreter=deterministic`).

## Notes

- The deterministic grammar wins decisively on dates (code computes exact whole-
  day boundaries), overall exact match, metadata-vs-semantic separation, and
  latency (2.6 ms). Its one real gap is **lowercase person names** (recall 71%),
  which cascades into the metadata-vs-semantic and AND/OR misses.
- That gap is fixable with a targeted grammar change (lowercase-name detection
  after cue words, guarded by the non-name vocabulary) — estimated holdout ~88–92%
  at ~3 ms — but **modifying the grammar is out of scope for this deploy task** and
  would be a separate, test-guarded slice.
- The exported int4 artifacts + reproducible build (`scripts/nlu-sidecar/`,
  `install-nlu-model.sh`, `benchmark.py`) remain available to re-run this
  evaluation against future/smaller models or a constrained-decoding setup.
