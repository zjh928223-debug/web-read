## 1. Occurrence Identity Contract

- [x] 1.1 Confirm sentence-context-aware block execution and unified target source entry remain unchanged.
- [x] 1.2 Add stable occurrence identity to each unified target from raw `** **`, imported `marks.json`, and current-page manual marking.
- [x] 1.3 Define the minimal occurrence identity contract carried through planner targets and generated items.
- [x] 1.4 Ensure repeated marked words remain distinguishable even when `markedText` is identical.

## 2. Persistence And Generated Index Carry-Through

- [x] 2.1 Persist minimal occurrence identity in each generated annotation item.
- [x] 2.2 Keep the compact user-facing annotation fields unchanged while allowing internal occurrence identity fields to persist.
- [x] 2.3 Ensure generated storage and restore keep occurrence identity stable across reload.
- [x] 2.4 Ensure generated store/index uses occurrence identity as the primary lookup path rather than token text only.

## 3. Occurrence-Aware Click Resolver

- [x] 3.1 Update click resolver contract so current click span resolves by occurrence identity first.
- [x] 3.2 Keep text-based matching only as a fallback path for legacy or incomplete generated items.
- [x] 3.3 Ensure repeated words such as `immense` can resolve to different annotations at different positions.
- [x] 3.4 Preserve legacy fallback behavior when generated occurrence identity is missing or ambiguous.

## 4. Compact Bubble Presentation

- [x] 4.1 Remove `标注内容` from bubble display.
- [x] 4.2 Keep `markedText` in internal annotation data for compatibility, debugging, or logging only.
- [x] 4.3 Ensure bubble now shows only `boundary`, `meaning`, `type`, and `memoryHint`.
- [x] 4.4 Keep bubble toggle, drag, resize, and existing visibility behavior unchanged.

## 5. Shorter Annotation Language Contract

- [x] 5.1 Tighten prompt rules so `meaning` is usually 1 to 2 concise Chinese sentences focused on the current sentence meaning.
- [x] 5.2 Tighten prompt rules so `memoryHint` is usually 1 concise Chinese + English sentence focused on chunk/collocation memory.
- [x] 5.3 Avoid long dictionary-like explanation or long etymology-style expansion in newly generated output.
- [x] 5.4 Keep shorter wording compatible with the existing compact generated result chain.

## 6. Verification

- [x] 6.1 Run `node --check` on affected generation, resolver, bubble, and integration files.
- [x] 6.2 Real webpage verification: when the same word appears two or three times, each occurrence click resolves to its own annotation.
- [x] 6.3 Real webpage verification: in an `immense`-style repeated case, one occurrence can show `immense` while another shows `immense wealth`.
- [x] 6.4 Real webpage verification: after removing `标注内容`, bubble still correctly shows `boundary`, `meaning`, `type`, and `memoryHint`.
- [x] 6.5 Real webpage verification: newly generated `meaning` and `memoryHint` are visibly shorter and easier to read.
- [x] 6.6 Regression verification: generated storage, restore, manual marks, imported marks, `no-targets`, and bubble toggle still work.
