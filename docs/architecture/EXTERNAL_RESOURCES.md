# External Resource and Data Matrix

This matrix records current ownership, credentials, persistence and fail-safe
behavior for network/local resources. Update it whenever a provider or dataset
is added.

| Resource | Caller | Credentials | Persistence | Offline/failure behavior |
| --- | --- | --- | --- | --- |
| Google Fonts | `index.html` browser | none | browser cache | CSS fallback fonts |
| Google CSE | `index.html` browser | public CSE id | browser cache | optional search unavailable |
| Gemini | Vite/FastAPI adapters | server env/Credential Manager | bounded local caches | English/source content remains usable |
| Edge TTS | local server | none | generated audio cache | visible unavailable/retry result |
| Merriam-Webster | local server | server key/Credential Manager | derived learning fields only | next registered provider |
| Wordnik | local server | server key | session result/provenance | next registered provider |
| Tatoeba | local server | none | selected provenance | next registered provider |
| Free Dictionary API | SRS browser fallback | none | session audio URL only | pronunciation unavailable |
| YouTube | local workflow | optional cookies | external workflow data root | typed job failure/cancel |
| ECDICT SQLite | read-only Node service | none | external ignored DB | feature fail-open |
| Sentence warehouse | read-only Node service | none | external ignored DB | provider fallback |
| Personal media/data | local workflow/browser | local authorization | external data root/IndexedDB | never committed or uploaded implicitly |

Security boundary: browser code must not receive server credentials. Diagnostic
and error output must redact tokens, cookies, proxy authentication and private
paths. Release artifacts must not include ignored dictionaries, media, caches or
personal profiles.
