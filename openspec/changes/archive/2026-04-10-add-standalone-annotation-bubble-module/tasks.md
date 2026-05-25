## 1. Boundary confirmation

- [x] 1.1 Confirm existing word click / transcriptContainer click / audio seek chain and list the minimal allowed click-notification point
- [x] 1.2 Confirm current consumable annotation source; read it as resolver input; do not modify annotation generation, import or matching pipeline
- [x] 1.3 Confirm default annotation bubble hotkey and avoid current `m/n/c/s/x/ArrowLeft/ArrowRight`

## 2. Standalone bubble module

- [x] 2.1 Add standalone `annotation-bubble.js` module and expose a small `window.AnnotationBubble` API
- [x] 2.2 Implement bubble DOM creation, empty state, visible state, current annotation state and field rendering inside the module
- [x] 2.3 Implement fixed-position drag / resize / viewport clamp inside the module; reader scrolling must not move the bubble screen position
- [x] 2.4 Implement lightweight position/size persistence; keep content as current runtime state only; do not create a history list

## 3. Styles and page loading

- [x] 3.1 Add centralized clearly named annotation bubble styles; may reuse glass tokens; do not reuse old `#info-card` side DOM
- [x] 3.2 Load/mount annotation bubble module in `read-26.html` minimally; do not alter transcript/chunk text structure

## 4. Minimal app.js integration

- [x] 4.1 Add a tiny annotation resolver adapter in `app.js`, normalizing existing annotation hits into `{ markedText, boundary, type, meaning, memoryHint }` or `null`
- [x] 4.2 Append annotation click notification after existing word click behavior; preserve audio seek, `forceUpdateUI(...)`, highlight and chunk/sentence order
- [x] 4.3 Add centralized hotkey wiring to call `AnnotationBubble.toggle()`; hidden bubble must not update/show on click
- [x] 4.4 Confirm clicking an ordinary unannotated word does not clear, replace or refresh existing bubble annotation content

## 5. Verification

- [x] 5.1 Validate `app.js`, `annotation-bubble.js` syntax and page load
- [x] 5.2 Validate normal transcript click audio jump stays on the existing path
- [x] 5.3 Validate bubble-hidden annotated and normal clicks do not show explanation UI
- [x] 5.4 Validate bubble-visible annotation update renders/replaces the five fields; normal word does not refresh existing content
- [x] 5.5 Validate bubble drag/resize/fixed frame path, hotkey toggle and empty state
