# Single-host prototype comparison

This is the architecture evidence for OpenSpec task 3.1. The FastAPI Local App Host prototype is
now wired into the isolated optimization launcher; the nine Node capability plugins remain behind
an explicitly managed loopback sidecar until they are ported.

## Current Vite server capabilities

`vite.config.mjs` installs nine application endpoint plugins in addition to Vue:

| Plugin | Route family | Runtime dependency |
| --- | --- | --- |
| Aria Edge TTS | `POST /api/tts/edge`, `GET /api/tts/edge/audio/{sha}.mp3` | Node `node-edge-tts`, temp cache |
| Local sentences | `GET /api/vocabulary/local-sentences` | Node SQLite |
| Sentence translation | `POST /api/vocabulary/sentence-translations` | Gemini/network proxy |
| AI preview sentences | `POST /api/vocabulary/ai-preview-sentences` | Gemini/network proxy |
| Merriam-Webster examples | `GET /api/vocabulary/merriam-webster-examples` | network/API key |
| Tatoeba sentences | `GET /api/vocabulary/real-sentences` | network |
| Wordnik examples | `GET /api/vocabulary/wordnik-examples` | network/API key |
| IELTS learning pool | `/api/vocabulary/ielts-learning-pool` | local candidate data |
| ECDICT | `GET /api/dev/dictionary/ecdict` | optional read-only SQLite |

These are Connect middleware and cannot accompany a copied `dist` directory without a Node/Vite process. The separate FastAPI workflow service already owns workflow, activity, marks, pronunciation, TTS, file, and Range media APIs.

### Wordnik free-plan boundary

Wordnik is configured only in the Windows capability backend through `WORDNIK_API_KEY` (or the
backend-only `.env.local`); it is never exposed as a `VITE_*` value. The browser asks for a sentence
only after the learner reveals a word, so opening a 50-word preview does not pre-fetch Wordnik. The
free-plan path does not retain completed Wordnik data in browser/session caches; only identical
requests that are still in flight are coalesced. The backend keeps a conservative local hourly guard
and forwards Wordnik's `x-ratelimit-*` headers when available, including the observed hour/minute
limits and remaining counts. The current public pricing page lists Free Basic as 100 calls/hour;
the exact minute allowance is plan-dependent and must be read from those response headers.

## Prototype result

`production_host_prototype.create_production_host(...)` dispatches `/api/*` to the existing workflow ASGI application without stripping the `/api` prefix, provides `/api/app/health`, serves immutable `dist` assets, and applies an HTML-only SPA fallback. Existing workflow Range responses pass through unchanged. Its `startupMs` field provides a small startup-cost measurement seam. A normal Starlette `mount('/api', workflow)` is intentionally not used because the workflow routes already include `/api`; mounting there would incorrectly expose them as `/api/api/*`.

The production CLI also requires an isolated application root plus browser,
Python state and Python output paths. It starts the Node application-profile
lock holder before binding the HTTP port. That holder runs pending restore
recovery and retains the cross-process lease until the host exits, so restore
cannot overlap a serving application and startup cannot expose partially
restored owners.

| Option | Startup/processes | Static/SPA | Range and workflow | Nine Vite plugins | Maintenance conclusion |
| --- | --- | --- | --- | --- | --- |
| FastAPI single host | one Python host after migration | native prototype proven | existing ASGI routes and Range preserved | require focused Python ports or temporary Node sidecar | preferred target; consolidates the already larger local API |
| Node sidecar | Node host plus current Python workflow, unless workflow is proxied | straightforward with Vite/Express | needs HTTP proxy to Python | reused directly | lower short-term porting, but retains two owners/processes |

The experiment supports FastAPI as the production host. The optimization launcher now removes Vite
from the default serving path: it builds `dist`, starts a loopback stable front door on `5184`, and
runs each FastAPI candidate Host on an isolated internal port. The capability sidecar remains on
`8776` only for the still-Node-owned endpoint implementations. Vite remains an explicit
source-debugging fallback, and the nine plugin migrations remain follow-up work.

### Optimization launcher integration

`scripts/launch-optimization-preview.ps1` resolves `config/runtime.optimization.json`, validates
the fixed loopback ports and isolated data root, builds into a unique staging directory, validates
the complete artifact checksum/manifest contract, and atomically publishes an immutable versioned
release. The old Host remains behind the stable front door while the new internal Host and its
per-instance profile lease become ready; an activation journal keeps the last committed target
visible while the front-door target and active release/Host pointers are switched, and only a
committed, coherent set becomes public before the old Host is stopped. The old release is retained
as a rollback target and the project-root `dist` is never changed by this launcher. The Python host receives the
selected manifest plus isolated browser/Python profile paths and holds its application-profile lease
for its lifetime. The launcher manages the sidecar and Host with a token kept outside the page and
logs, atomic state files, and separate stdout/stderr logs. `-Stop` uses recorded PID and
process-start identity; `-DevFallback` is the only path that invokes the existing Vite launcher.

### Cold-process probe (2026-08-12)

Three PowerShell `Measure-Command` runs on the current machine measured full Python import plus workflow manager/host construction at 862.2/891.8/921.1 ms. A minimal Node static-shell import probe measured 71.3/48.6/46.4 ms. These are architecture probes rather than release budgets: FastAPI has the higher cold-start cost, but it replaces the already-required workflow process; a Node sidecar adds a second long-lived process and still needs to proxy workflow/Range. End-to-end ready time remains a task 3.4/3.5 release measurement.
