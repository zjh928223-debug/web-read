# Local sentence warehouse

This module is the read-only runtime boundary for the first-contact sentence warehouse. It is independent of ECDICT and `SeekPlayerDB`.

## Build

```powershell
python -m pip install --target data/dictionaries/tools/mdict-python mdict-utils
npm run sentences:build
npm run verify:local-sentences
```

Default local inputs:

| Role | Local path |
| --- | --- |
| authentic publication excerpts | `data/dictionaries/sources/mdx/vocabulary-com/Vocabulary.com series mdx/Vocabulary.com Dictionary.mdx` |
| short sense-ordered learner examples | `data/dictionaries/sources/mdx/ldoce5.mdx` |
| open dictionary examples | `data/dictionaries/sources/english-wordnet-2025-json.zip` |
| optional broader open data | `data/dictionaries/sources/kaikki.org-dictionary-English.jsonl` |
| generated read-only warehouse | `data/dictionaries/local-sentences.sqlite` |

The local source directory may also contain Cambridge, Macmillan, Collins, Oxford, American Heritage, and MDD media files for later parsers/audio indexing. Their presence does not make them part of the app bundle.

## Runtime

`local-sentence-vite-plugin.mjs` exposes a same-origin GET endpoint and lazily opens the database read-only. The preview registry asks this provider first, then Tatoeba, then Wordnik. A local hit ends the provider chain, so it consumes no online quota.

The builder stores source name, record locator, source type, reference text, URL, and a usage/license note with each sentence. Commercial dictionary files and extracted content are local personal resources: do not commit, bundle, export, or redistribute them.

MDD audio is a separate, optional phase. Downloads can be resumed independently; future indexing should map existing `sound://` references to local MDD records without delaying text lookup.

Large downloads use Windows BITS jobs whose names begin with `read-web-`. The local helper `scripts/complete-local-dictionary-downloads.ps1` finalizes completed jobs and resumes transient failures; it does not change application data or `SeekPlayerDB`.
