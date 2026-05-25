## ADDED Requirements

### Requirement: Annotation bubble can be toggled as an independent fixed floating layer
The system MUST provide an independent annotation bubble that can be shown or hidden by a custom hotkey. The bubble MUST exist as a fixed-position floating UI layer and MUST NOT be rendered inline in article text or as a right-side explanation panel.

#### Scenario: Toggle bubble from hidden to visible
- **WHEN** the user presses the annotation bubble show/hide hotkey
- **THEN** the system MUST show a fixed-position annotation bubble
- **AND** the bubble MUST NOT change article layout, article text, the audio player, or the current highlight state

#### Scenario: Toggle bubble from visible to hidden
- **WHEN** the annotation bubble is visible and the user presses the show/hide hotkey again
- **THEN** the system MUST hide the annotation bubble
- **AND** later text clicks MUST continue to use the existing reader click behavior
- **AND** later text clicks MUST NOT automatically show explanation UI

#### Scenario: Empty bubble state
- **WHEN** the annotation bubble is visible but no current annotation has been selected
- **THEN** the bubble MUST show an empty-state hint equivalent to “点击一个已标注单词查看释义”

### Requirement: Annotation bubble updates from annotated word clicks without replacing audio seek
The system MUST update the visible annotation bubble from annotated word clicks without changing the existing audio-seek behavior.

#### Scenario: Click annotated word while bubble is visible
- **WHEN** the annotation bubble is visible and the user clicks a word that has annotation data
- **THEN** the system MUST continue to run the existing audio jump and highlight update behavior
- **AND** the bubble MUST update to the annotation content for that clicked word
- **AND** the bubble content MUST replace the previous content instead of appending a history list

#### Scenario: Click normal word while bubble is visible
- **WHEN** the annotation bubble is visible and the user clicks a normal word without annotation data
- **THEN** the system MUST continue to run the existing audio jump and highlight update behavior
- **AND** the bubble MUST NOT refresh to the normal word content
- **AND** the bubble MUST NOT clear the previously displayed annotation

#### Scenario: Click text while bubble is hidden
- **WHEN** the annotation bubble is hidden and the user clicks any article text
- **THEN** the system MUST preserve the current click-to-audio behavior
- **AND** the system MUST NOT show the annotation bubble
- **AND** the system MUST NOT show a right-side explanation panel, article-embedded explanation card, or inline `[]` boundary marker

### Requirement: Annotation bubble displays the initial annotation field set
The annotation bubble MUST safely render the initial annotation field set: `标注内容`, `边界`, `类型`, `意思`, and `要记`.

#### Scenario: Render full annotation content
- **WHEN** the bubble receives an annotation containing marked text, boundary, type, meaning, and memory hint
- **THEN** the bubble MUST render `标注内容`
- **AND** the bubble MUST render `边界`
- **AND** the bubble MUST render `类型`
- **AND** the bubble MUST render `意思`
- **AND** the bubble MUST render `要记`

#### Scenario: Render annotation with missing optional fields
- **WHEN** the bubble receives an annotation with some missing fields
- **THEN** the bubble MUST continue to render the available fields
- **AND** the bubble MUST NOT throw visible errors, block audio jumps, or break the reader UI

### Requirement: Annotation bubble position and size are user-controlled
The annotation bubble MUST remain user-controlled for drag, resize, and fixed viewport positioning.

#### Scenario: Drag bubble
- **WHEN** the user drags the annotation bubble
- **THEN** the bubble MUST update to the dragged fixed viewport position
- **AND** article scrolling MUST NOT move the bubble away from that screen position

#### Scenario: Resize bubble
- **WHEN** the user resizes the annotation bubble
- **THEN** the bubble MUST update its size
- **AND** later annotation updates MUST NOT reset the user-selected size

### Requirement: Annotation bubble implementation remains modular
The annotation bubble implementation MUST remain modular, with only minimal wiring in `app.js`.

#### Scenario: Minimal app integration
- **WHEN** the reader integrates the annotation bubble
- **THEN** `app.js` MUST only contain thin integration for hotkey wiring, click notification wiring, and annotation resolver adaptation
- **AND** bubble DOM creation, show/hide state, content rendering, drag, resize, and position/size state MUST remain inside the standalone module

#### Scenario: No inline boundary rendering in reader text
- **WHEN** the system shows the annotation bubble or updates its annotation content
- **THEN** the system MUST NOT inject `[]`, boundary markers, explanation cards, or other explanation DOM into the article text
