# Single-host prototype comparison

This is evidence for OpenSpec task 3.1. The prototype is intentionally not connected to the launcher, RuntimeConfig, or authentication.

## Current Vite server capabilities

`vite.config.js` installs nine application endpoint plugins in addition to Vue:

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

## Prototype result

`production_host_prototype.create_production_host(...)` dispatches `/api/*` to the existing workflow ASGI application without stripping the `/api` prefix, provides `/api/app/health`, serves immutable `dist` assets, and applies an HTML-only SPA fallback. Existing workflow Range responses pass through unchanged. Its `startupMs` field provides a small startup-cost measurement seam. A normal Starlette `mount('/api', workflow)` is intentionally not used because the workflow routes already include `/api`; mounting there would incorrectly expose them as `/api/api/*`.

| Option | Startup/processes | Static/SPA | Range and workflow | Nine Vite plugins | Maintenance conclusion |
| --- | --- | --- | --- | --- | --- |
| FastAPI single host | one Python host after migration | native prototype proven | existing ASGI routes and Range preserved | require focused Python ports or temporary Node sidecar | preferred target; consolidates the already larger local API |
| Node sidecar | Node host plus current Python workflow, unless workflow is proxied | straightforward with Vite/Express | needs HTTP proxy to Python | reused directly | lower short-term porting, but retains two owners/processes |

The experiment supports FastAPI as the target production host, while explicitly leaving the nine Node plugin migrations as follow-up work before Vite can be removed from daily use.

### Cold-process probe (2026-08-12)

Three PowerShell `Measure-Command` runs on the current machine measured full Python import plus workflow manager/host construction at 862.2/891.8/921.1 ms. A minimal Node static-shell import probe measured 71.3/48.6/46.4 ms. These are architecture probes rather than release budgets: FastAPI has the higher cold-start cost, but it replaces the already-required workflow process; a Node sidecar adds a second long-lived process and still needs to proxy workflow/Range. End-to-end ready time remains a task 3.4/3.5 release measurement.
