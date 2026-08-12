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
| POS-aware bilingual primary senses | `data/dictionaries/sources/mdx/supplements/new-oxford2-bilingual.mdx` |
| open dictionary examples | `data/dictionaries/sources/english-wordnet-2025-json.zip` |
| optional broader open data | `data/dictionaries/sources/kaikki.org-dictionary-English.jsonl` |
| generated read-only warehouse | `data/dictionaries/local-sentences.sqlite` |

To refresh only the bilingual `primary_senses` index in an existing warehouse, without rebuilding sentence rows:

```powershell
python scripts/build-local-sentence-warehouse.py --primary-senses-only
```

The local source directory may also contain Cambridge, Macmillan, Collins, Oxford, American Heritage, and MDD media files for later parsers/audio indexing. Their presence does not make them part of the app bundle.

`scripts/download-mdict-supplements.ps1` adds a local supplement set under `data/dictionaries/sources/mdx/supplements/`: bilingual LDOCE/Collins/AHD/Oxford, an English-Chinese sentence dictionary, common phrases, Longman Language Activator, Oxford collocations/idioms, Cambridge phrasal verbs and vocabulary profile, COCA frequency data, ODE3 bilingual entries, and Merriam-Webster/ODE pronunciation assets. The script accepts `-Only file1,file2` for targeted resumes and `-Foreground` for synchronous verification.

## Runtime

`local-sentence-vite-plugin.mjs` exposes a same-origin GET endpoint and lazily opens the database read-only. Lemma candidates are inverse-validated by regenerating the target word's possible inflections, so `slates` resolves to `slate` and cannot drift to `slat`. The endpoint returns the ordered headword's first bilingual learner-dictionary sense together with sentence candidates locked to that lemma. The preview keeps the same part of speech and ranks English sense-gloss overlap before sentence length, then persists the repaired meaning and sentence in the local preview batch. The registry asks this provider first, then Merriam-Webster Learner's/Collegiate, Tatoeba, and Wordnik. A local hit ends the provider chain, so it consumes no online quota.

The builder stores source name, record locator, source type, reference text, URL, and a usage/license note with each sentence. Commercial dictionary files and extracted content are local personal resources: do not commit, bundle, export, or redistribute them.

MDD audio is a separate, optional phase. Downloads can be resumed independently; future indexing should map existing `sound://` references to local MDD records without delaying text lookup.

Large downloads use Windows BITS jobs whose names begin with `read-web-`. The local helper `scripts/complete-local-dictionary-downloads.ps1` finalizes completed jobs and resumes transient failures; it does not change application data or `SeekPlayerDB`.
