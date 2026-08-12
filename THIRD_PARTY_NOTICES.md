# Third-Party Notices

Read-Web includes or connects to third-party software, services and data. This
file is an inventory and compliance aid; it does not replace the upstream
licenses or terms.

## Packaged software

The exact JavaScript dependency graph is recorded in `package-lock.json`. Run
`npm run verify:supply-chain` to validate allowed licenses and generate a
CycloneDX-style SBOM under the ignored `output/release/` directory.

The local workflow service direct Python baseline is recorded in
`tools/subtitle-workflow/requirements-service.txt`. Transitive Python hash
locking and clean-room installation remain a release task.

## Network services and visible attribution

| Provider/resource | Purpose | Runtime boundary | Notes |
| --- | --- | --- | --- |
| Google Fonts | Reader typography | Browser stylesheet | Network request exposes normal web request metadata; application remains usable with fallback fonts. |
| Google Programmable Search | Optional search UI | Browser script | Subject to Google terms and privacy policy. |
| Google Gemini / GenAI | Translation and learning-aid generation | Local server only | Keys must remain server-side; generated text is labeled and not authentic source evidence. |
| Microsoft Edge TTS | Pronunciation | Local service | Generated audio is cached locally where configured. |
| Merriam-Webster APIs | Dictionary meanings/examples | Local server only | Required product attribution/logo is preserved; content is not redistributed as a dictionary dump. |
| Wordnik API | Optional example sentence provider | Local server only | Visible Wordnik attribution is retained. |
| Tatoeba API | Open sentence fallback | Local server only | Returned results retain source URL and upstream attribution. |
| Free Dictionary API | Optional pronunciation fallback | Browser request | Only HTTPS audio URLs are accepted. |
| YouTube / yt-dlp | User-requested material acquisition | Local workflow | User is responsible for authorization and source terms; generated media is not committed. |

## Local datasets

ECDICT, LDOCE/MDX files, New Oxford material, Vocabulary.com data, Kaikki,
WordNet archives, downloaded audio and personal learning material are excluded
from Git. Their individual licenses and redistribution restrictions vary. The
application may read user-provided local copies, but this repository does not
grant redistribution rights for those datasets.

## Reference prototype

`cankao/src/` is a non-production visual reference and contains external
Unsplash/CodePen asset URLs. It is not loaded by `index.html` or the Vite build.
Do not distribute or promote it as part of a release without replacing those
assets or separately confirming their licenses.
