## Context

The current pipeline is already structured like this:

```text
entry/status UI
  -> AnnotationGenerationController.startFullArticle(context, callbacks)
  -> unified target source
  -> block planner
  -> prompt builder
  -> api client
  -> generated storage
  -> generated result store / index
  -> click resolver
  -> annotation bubble
```

The missing piece is no longer “how to run generation at all”. The missing piece is that the contract is still too weak at the boundary between generation and consumption:

```text
generation side can already distinguish more than one occurrence
but persistence/index/resolver still collapse too early toward text matching
```

That is why the next revision must be framed as:

```text
sentence-context-aware generation
  + occurrence-stable generated identity
  + occurrence-aware click consumption
  + compact bubble presentation
  + shorter annotation wording
```

## Goals / Non-Goals

**Goals**

- Keep article block as generation execution/progress unit.
- Keep unified target source support for raw `** **`, imported `marks.json`, and manual marking.
- Keep sentence context as the basis for boundary resolution.
- Add stable occurrence identity across the full path:
  - unified target
  - planner target
  - generated annotation item
  - store/index
  - click resolver
- Keep final generated result compact and bubble-compatible.
- Remove `markedText` from bubble display while keeping it internally.
- Tighten `meaning` and `memoryHint` length/style for fast reading.
- Preserve existing storage/restore/manual-mark/imported-mark/no-targets/bubble-toggle behavior.

**Non-Goals**

- No new OpenSpec change.
- No redesign of the archived bubble module’s scope.
- No settings UI or provider UI changes.
- No incremental generation.
- No new display surfaces beyond the existing bubble.
- No broad refactor of unrelated reader flows.

## Decisions

### Decision: Block remains execution and progress unit

Blocks continue to be the unit of generation orchestration and progress reporting:

- total/completed/failed/running are still block-based
- one block may still produce multiple compact annotation items
- click consumption remains annotation-item based, not block-based

This keeps the entry/status UI semantics unchanged.

### Decision: Occurrence identity becomes first-class contract

The pipeline must stop assuming that `markedText`, `boundary`, or token overlap are enough to distinguish one annotation from another.

Each unified target must carry stable occurrence identity. Acceptable identity inputs include:

- `globalIndex`
- source `start`
- stable span offsets
- or an equivalent compound occurrence key

This identity must then survive through:

```text
target source
-> planner target
-> generated item
-> persisted bundle
-> generated result store
-> click resolver
```

The important rule is not the exact field name. The important rule is that repeated words at different positions remain distinguishable after persistence and restore.

### Decision: Target identity and generated identity are related but not identical

`targetId` is still useful as a run-local identifier, but it is not sufficient on its own if it can be recreated differently across runs or plans.

Therefore the design should keep two layers:

1. run-local target identifier
2. stable occurrence identity

Conceptually:

```text
targetId = current generation run mapping
occurrenceIdentity = stable document-level hit identity
```

The click path should rely on occurrence identity first.

### Decision: Click resolver becomes occurrence-aware first, text-aware second

The click resolver should follow this priority:

```text
1. occurrence identity exact hit
2. only if occurrence identity is missing or unavailable, use legacy text-based fallback
```

This keeps compatibility without leaving repeated-word behavior unstable.

### Decision: Bubble display becomes compact

The bubble should stop rendering `markedText` as a visible row.

Visible rows become:

- `boundary`
- `meaning`
- `type`
- `memoryHint`

`markedText` remains in the internal normalized annotation structure for:

- compatibility
- debugging
- logging
- possible future tooling

But it is not part of the final bubble presentation.

### Decision: Shorter language rules are part of the generation contract

The shorter wording requirement should not live only in UI preference. It must be treated as part of the generation contract.

Rules:

- `meaning`
  - prioritize current-sentence meaning
  - primarily Chinese
  - usually 1 to 2 sentences
  - avoid long dictionary-like expansion

- `memoryHint`
  - usually 1 sentence
  - Chinese + English cue
  - prioritize chunk memory, collocation memory, or boundary memory
  - avoid long etymology-like expansion

This should be enforced in prompt expectations and, where needed, in normalization quality checks.

### Decision: Compact persisted result remains the compatibility boundary

The final user-facing generated result still remains compact:

```js
{
  markedText,
  boundary,
  type,
  meaning,
  memoryHint
}
```

This change only adds the smallest necessary occurrence identity fields for stable restore/index/click behavior.

Sentence context must not leak into the final user-facing annotation structure.

### Decision: Existing stable paths must not regress

The following paths remain mandatory to preserve:

- generated storage
- restore
- manual marks
- imported marks
- no-targets
- bubble toggle

This means the correction must be additive and contract-tightening, not a broad rewrite.

## Proposed Shape

```text
raw markup / marks.json / manual marks
  -> unified target source
     carries occurrence identity
  -> planner
     carries sentence context + occurrence identity
  -> prompt builder
     uses sentence context, not raw word-only assumption
  -> api client
     returns compact item + occurrence identity carry-through
  -> storage
     persists compact item + minimal occurrence identity
  -> generated result store
     indexes by occurrence identity first
  -> click resolver
     resolves clicked span by occurrence identity first
     falls back to text matching only when needed
  -> bubble
     shows boundary / meaning / type / memoryHint
```

## Risks / Trade-offs

- [Risk] If occurrence identity is too tied to transient planner IDs, restore may still be unstable.
  Mitigation: keep a stable document-level identity separate from run-local target IDs.

- [Risk] If too much identity data is persisted, the compact result contract may bloat.
  Mitigation: persist only the minimal occurrence fields needed for stable lookup.

- [Risk] If the click resolver uses mixed priority rules, repeated words may remain flaky.
  Mitigation: make occurrence identity explicit priority 1, and text matching explicit fallback only.

- [Risk] If wording tightening is only a prompt hint, long results may still leak through.
  Mitigation: capture wording rules in prompt contract and optionally normalize overly long results later in implementation.

- [Risk] Removing `markedText` from bubble could accidentally affect internal compatibility assumptions.
  Mitigation: remove it only from presentation, not from the internal annotation result structure.

## Migration Plan

1. Update this change’s artifacts to reflect the new contract.
2. Add occurrence identity to unified targets and planner targets.
3. Carry minimal occurrence identity into generated persisted items.
4. Update generated store/index to use occurrence identity as primary lookup key.
5. Update click resolver to resolve by occurrence identity first and keep legacy text fallback.
6. Remove `markedText` row from bubble presentation only.
7. Tighten prompt/output language rules for shorter `meaning` and `memoryHint`.
8. Verify repeated-word resolution, compact bubble display, shorter wording, and no regressions on existing paths.

## Open Questions

- Which exact occurrence identity shape is best for both transcript mode and chunk mode:
  - `globalIndex`
  - `sentenceId + local offsets`
  - `globalStart/globalEnd`
  - or a compound key?

- For imported `marks.json`, do we already have enough stable fields, or should the generation path derive a stronger occurrence key at load time?

- Should wording length be enforced purely by prompt contract, or should implementation later add a normalization guard for unexpectedly long outputs?
