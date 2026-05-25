## Why

The current annotation generation pipeline already has the main path in place:

- page-level entry/status UI
- unified target source
- block-based generation orchestration
- prompt builder
- API client
- storage and restore
- generated-result indexing
- click resolver
- annotation bubble consumption

However, recent manual testing exposed two contract problems that are now on the core path, not in a side feature:

1. Repeated marked words do not have stable occurrence-level click consumption.
   The generation path can already produce multiple distinct annotations for repeated occurrences such as `immense` and `immense wealth`, but the click consumption layer still tends to fall back to text-level matching. That makes repeated occurrences unstable and can surface the wrong annotation when the same word appears multiple times in one document.

2. Bubble presentation and annotation wording are still too verbose for the actual product goal.
   The bubble currently shows both `markedText` and `boundary`, which becomes redundant when they are the same or highly overlapping. In addition, `meaning` and `memoryHint` are still longer than needed for quick reading during playback.

This change therefore needs to evolve from only “sentence-context-aware boundary resolution” to a broader and more correct contract:

`sentence-context-aware generation + occurrence-stable click consumption`

That means:

- generation still runs by article block
- targets still come from the unified target source
- the model still resolves final `boundary` from sentence context
- but every target and every generated annotation must now keep stable occurrence identity all the way through click consumption
- bubble display must become more compact
- language output rules must become shorter and easier to scan

## What Changes

- Keep article block as the execution and progress unit for generation.
- Keep unified target source and continue to support:
  - raw `** **` markup
  - imported `marks.json`
  - current page manual marking
- Upgrade the contract so every unified target carries stable occurrence identity, such as `globalIndex`, `start`, or an equivalent stable span identity.
- Require generated annotation items to persist minimal occurrence identity so restore and click consumption remain stable after reload.
- Require generated store/index and click resolver to prefer occurrence identity over text-only matching.
- Keep sentence context internal to generation and keep final persisted annotation output compact.
- Keep the generated result data structure compatible with the current bubble consumer chain, while removing `markedText` from bubble display.
- Tighten annotation language rules so:
  - `meaning` is usually 1 to 2 concise Chinese sentences
  - `memoryHint` is usually 1 concise Chinese + English sentence
- Keep existing generation path stability:
  - generated storage
  - restore
  - manual marks
  - imported marks
  - no-targets
  - bubble toggle

## Capabilities

### Modified Capabilities

- `standalone-annotation-generation-pipeline`
  - upgrades from sentence-context-aware boundary resolution only
  - to sentence-context-aware generation plus occurrence-stable click consumption
  - keeps compact generated results compatible with the existing bubble consumer chain
  - tightens language output and bubble presentation for faster reading

## Impact

- Updates this active change only:
  - [proposal.md](E:/小新备份文件/开发项目/lunix/read-final/openspec/changes/add-standalone-annotation-generation-pipeline/proposal.md)
  - [design.md](E:/小新备份文件/开发项目/lunix/read-final/openspec/changes/add-standalone-annotation-generation-pipeline/design.md)
  - [tasks.md](E:/小新备份文件/开发项目/lunix/read-final/openspec/changes/add-standalone-annotation-generation-pipeline/tasks.md)
  - [spec.md](E:/小新备份文件/开发项目/lunix/read-final/openspec/changes/add-standalone-annotation-generation-pipeline/specs/standalone-annotation-generation-pipeline/spec.md)
- Expected implementation files later:
  - `annotation-target-source.js`
  - `annotation-block-planner.js`
  - `annotation-prompt-builder.js`
  - `annotation-api-client.js`
  - `annotation-generation-controller.js`
  - `annotation-generated-result-store.js`
  - `annotation-click-resolver.js`
  - `annotation-bubble.js`
  - `app.js`

## Non-Goals

- No new change will be created for this correction.
- Do not reopen or broaden the archived bubble change.
- Do not add a settings page.
- Do not add incremental generation.
- Do not redesign storage format beyond minimal occurrence identity carry-through.
- Do not add inline annotation cards, right-side panels, or history lists.
