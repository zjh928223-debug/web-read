# Precision Reading Utility Design Spec

This document is the implementation-grade design source for the Read-Web UI refinement.

It covers both modes:

- Dark mode: black precision utility shell with warm reading surface.
- Light mode: frosted paper utility shell with the same component geometry.

The matching visual boards are:

- `docs/design/precision-reading-utility-style-guide.html`
- `docs/design/precision-reading-utility-style-guide-light.html`

## 1. Design Position

Read-Web should feel like a precise desktop reading utility, not a marketing page and not a decorative glass demo.

The style combines:

- Raycast: shell-level glass, desktop-tool density, precise controls.
- Linear: strict hierarchy, low-noise rows, clear status treatment.
- Notion and Claude: warm paper reading surfaces.
- ElevenLabs: refined audio controls with low-opacity tactile depth.
- Airtable: structured library/search/filter rows.
- Cursor and shadcn/ui: flat utility controls, consistent focus and disabled states.

### Product Mode

The primary use case is repeated daily reading and listening. The interface should optimize:

- Fast return to recent reading.
- Clear queue/history separation.
- Calm transcript reading.
- Predictable controls.
- Recoverable error and cancel states.

The interface should not optimize for:

- Landing-page impact.
- Large decorative hero sections.
- Full-page visual drama.
- Heavy glass on every object.
- Large-radius soft SaaS cards.

## 2. Implementation Contract

Use this document as a contract during implementation.

Meaning of terms:

- MUST: required for the first implementation pass.
- SHOULD: preferred unless an existing constraint makes it impractical.
- MAY: allowed but not required.
- MUST NOT: disallowed because it breaks the direction or risks regressions.

### Implementation Boundary

The first pass MUST be visual only.

Allowed:

- `styles.css` variables and rules.
- Vue class hooks only when a state is impossible to style from existing attributes.
- Workflow panel visual structure.
- Reader/player/control visual treatment.

Not allowed unless explicitly requested:

- IndexedDB schema changes.
- `index.html` script order changes.
- New feature logic in `src/composables/reader-runtime.js`.
- New feature logic in `src/composables/session-init.js`.
- Runtime data shape changes.
- New workflow statuses.

## 3. Mode Model

The app already uses:

```css
:root { ...light variables... }
[data-theme="dark"] { ...dark variables... }
```

The Precision Reading Utility tokens SHOULD follow the same pattern.

Implementation rule:

```css
:root {
  /* PRU light mode defaults */
  --pru-...: ...;
}

[data-theme="dark"] {
  /* PRU dark mode overrides */
  --pru-...: ...;
}
```

Do not introduce a separate mode switch such as `[data-pru-mode]` for the production UI unless the theme system is deliberately refactored.

## 4. Global Token Names

All new visual rules SHOULD use `--pru-*` tokens. Existing `--glass-*`, `--btn-*`, `--input-*`, and `--radius-*` tokens can remain for legacy surfaces, but workflow/read-player refinements should not depend on them except as fallback during migration.

### Required Semantic Tokens

These names are stable and should be added before styling individual components.

| Token | Purpose |
| --- | --- |
| `--pru-app-bg` | Outer application background behind panels |
| `--pru-app-wash` | Subtle background wash/gradient support |
| `--pru-reader-bg` | Main transcript reading canvas |
| `--pru-reader-surface` | Elevated paper/card surfaces inside reader |
| `--pru-reader-muted` | Reader track, inactive highlight, low-emphasis fill |
| `--pru-ink` | Primary text on warm/light surfaces |
| `--pru-ink-muted` | Secondary text on warm/light surfaces |
| `--pru-paper-border` | Border on reader and light surfaces |
| `--pru-shell-bg` | Workflow shell background |
| `--pru-shell-border` | Workflow shell border |
| `--pru-shell-surface` | Flat inner control surface |
| `--pru-shell-row` | Default workflow row background |
| `--pru-shell-row-hover` | Hover/active row background |
| `--pru-shell-text` | Primary text in workflow shell |
| `--pru-shell-muted` | Secondary text in workflow shell |
| `--pru-accent` | Primary action, progress, selected state |
| `--pru-accent-hover` | Hover accent and focused border |
| `--pru-success` | Finished/ready/online |
| `--pru-warning` | Unfinished/attention/translating |
| `--pru-danger` | Failed/destructive |
| `--pru-info` | Downloading/transcribing/in-progress info |
| `--pru-focus-ring` | Keyboard focus ring |

### Required Geometry Tokens

| Token | Value | Applies To |
| --- | --- | --- |
| `--pru-radius-control` | `4px` | Buttons, inputs, selects, textareas |
| `--pru-radius-row` | `6px` | List rows, active rows, compact cards |
| `--pru-radius-panel` | `8px` | Drawer, modal, popover, larger panels |
| `--pru-radius-pill` | `999px` | Badges, tiny status pills, progress tracks |

MUST NOT introduce random radii such as `7px`, `10px`, `12px`, `14px`, or `16px` in the workflow UI. Existing values should be migrated to the 4/6/8/pill scale when touched.

### Required Size Tokens

| Token | Value | Applies To |
| --- | --- | --- |
| `--pru-control-h` | `36px` | Default button/input/select height |
| `--pru-control-h-sm` | `32px` | Compact row actions and icon buttons |
| `--pru-control-h-xs` | `26px` | Tiny inline actions only |
| `--pru-row-min-h` | `64px` | Material/job rows |
| `--pru-panel-pad` | `16px` | Workflow panel inner padding |
| `--pru-section-gap` | `12px` | Section separation |
| `--pru-row-gap` | `8px` | Row list gap |
| `--pru-inline-gap` | `6px` | Button/icon/text gap |

## 5. Dark Mode Token Values

Dark mode is the strongest identity version. It should read as a black precision tool surrounding a warm paper reading area.

| Token | Value |
| --- | --- |
| `--pru-app-bg` | `#0b0c0f` |
| `--pru-app-wash` | `#111318` |
| `--pru-reader-bg` | `#f7f4ec` |
| `--pru-reader-surface` | `#fffdf7` |
| `--pru-reader-muted` | `#eee7d8` |
| `--pru-ink` | `#24231f` |
| `--pru-ink-muted` | `#6f6a5e` |
| `--pru-paper-border` | `#e5dfd2` |
| `--pru-shell-bg` | `rgba(7, 8, 10, 0.74)` |
| `--pru-shell-border` | `rgba(255, 255, 255, 0.12)` |
| `--pru-shell-surface` | `#111318` |
| `--pru-shell-row` | `#151821` |
| `--pru-shell-row-hover` | `#1b1f2a` |
| `--pru-shell-text` | `#f4f4f1` |
| `--pru-shell-muted` | `#9ca3af` |
| `--pru-accent` | `#5e6ad2` |
| `--pru-accent-hover` | `#7170ff` |
| `--pru-success` | `#1f8a65` |
| `--pru-warning` | `#d97706` |
| `--pru-danger` | `#dc3f4d` |
| `--pru-info` | `#2f80ed` |
| `--pru-focus-ring` | `rgba(94, 106, 210, 0.36)` |

Dark mode shadows:

| Token | Value |
| --- | --- |
| `--pru-shadow-soft` | `0 1px 2px rgba(18, 16, 12, 0.08), 0 8px 18px rgba(18, 16, 12, 0.08)` |
| `--pru-shadow-shell` | `0 18px 48px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.08)` |
| `--pru-shadow-modal` | `0 22px 64px rgba(0, 0, 0, 0.36)` |

Dark mode MUST:

- Keep workflow shell dark.
- Keep inner workflow rows flat, not glassy.
- Use warm paper for the transcript area.
- Keep status colors visible but muted.
- Avoid neon glow and saturated gradients.

## 6. Light Mode Token Values

Light mode is not pure white. It is a frosted paper version of the same product.

| Token | Value |
| --- | --- |
| `--pru-app-bg` | `#f3efe6` |
| `--pru-app-wash` | `#ebe4d7` |
| `--pru-reader-bg` | `#fffaf1` |
| `--pru-reader-surface` | `#fffdf8` |
| `--pru-reader-muted` | `#efe7d8` |
| `--pru-ink` | `#25231f` |
| `--pru-ink-muted` | `#746d61` |
| `--pru-paper-border` | `#e4dac8` |
| `--pru-shell-bg` | `rgba(255, 253, 247, 0.76)` |
| `--pru-shell-border` | `rgba(123, 106, 82, 0.18)` |
| `--pru-shell-surface` | `#fffdf8` |
| `--pru-shell-row` | `#fbf6ed` |
| `--pru-shell-row-hover` | `#f4ecdf` |
| `--pru-shell-text` | `#272520` |
| `--pru-shell-muted` | `#746d61` |
| `--pru-accent` | `#5360c9` |
| `--pru-accent-hover` | `#6572de` |
| `--pru-success` | `#1f8a65` |
| `--pru-warning` | `#b96a04` |
| `--pru-danger` | `#cf3d4b` |
| `--pru-info` | `#2563eb` |
| `--pru-focus-ring` | `rgba(83, 96, 201, 0.28)` |

Light mode shadows:

| Token | Value |
| --- | --- |
| `--pru-shadow-soft` | `0 1px 2px rgba(35, 28, 18, 0.08), 0 12px 28px rgba(35, 28, 18, 0.10)` |
| `--pru-shadow-shell` | `0 18px 48px rgba(62, 48, 28, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.78)` |
| `--pru-shadow-modal` | `0 22px 64px rgba(62, 48, 28, 0.20)` |

Light mode MUST:

- Keep warm paper background.
- Use visible but quiet borders.
- Keep rows flat.
- Avoid flat pure white on every surface.
- Keep the same 4/6/8/pill radius system as dark mode.

## 7. Typography

UI text should stay compact and utilitarian. Reading text should be calmer and more book-like.

| Token | Stack |
| --- | --- |
| `--pru-ui-font` | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `--pru-reading-font` | `Georgia, "Noto Serif SC", "Songti SC", serif` |
| `--pru-mono-font` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

Type scale:

| Role | Size | Weight | Line Height | Notes |
| --- | --- | --- | --- | --- |
| UI caption | `11px` | 600 | 1.35 | Upper labels, tiny badges |
| UI meta | `12px` | 500 | 1.4 | URL, folder, timestamps |
| UI body | `13px` | 500 | 1.45 | Default workflow text |
| UI title | `14px` | 650 | 1.35 | Row title |
| Panel title | `18px` | 650 | 1.25 | Drawer/modal title |
| Reader body | `18px` | 400 | 1.78 | Transcript |
| Reader active sentence | `18px` | 500 | 1.78 | Current playback sentence |
| Data/clock | `12px` | 500 | 1.3 | Use mono stack and tabular numbers |

Rules:

- Letter spacing MUST be `0`.
- Timers, progress percentages, queue positions, and durations MUST use tabular numbers.
- Row titles SHOULD truncate after one line on dense rows and may wrap to two lines on wide rows.
- Body transcript line length SHOULD stay between `58ch` and `72ch` on desktop.

## 8. Component Specification

### 8.1 Workflow Panel

Current class targets:

- `.youtube-workflow-panel`
- `.youtube-workflow-header`
- `.youtube-window-actions`
- `.youtube-workflow-icon-btn`

Panel MUST:

- Use `border-radius: var(--pru-radius-panel)`.
- Use `padding: var(--pru-panel-pad)`.
- Use shell background and border tokens.
- Use `backdrop-filter` only on the outer panel.
- Use `box-shadow: var(--pru-shadow-shell)`.
- Keep `max-height` and overflow behavior.

Dark:

```css
background: var(--pru-shell-bg);
color: var(--pru-shell-text);
border: 1px solid var(--pru-shell-border);
backdrop-filter: blur(24px) saturate(1.35);
```

Light:

```css
background: var(--pru-shell-bg);
color: var(--pru-shell-text);
border: 1px solid var(--pru-shell-border);
backdrop-filter: blur(24px) saturate(1.25);
```

Panel MUST NOT:

- Put glass styling on every child row.
- Use nested card-in-card visual structure.
- Use large 12px+ radius.
- Use thick borders or bright background fills.

### 8.2 Workflow Header

Current class target:

- `.youtube-workflow-header`

Header MUST:

- Remain sticky if the panel scrolls.
- Use the same shell background as panel, slightly stronger if needed.
- Keep drag cursor.
- Use a bottom border with `--pru-shell-border` or `--pru-paper-border`.

Header title:

- Size `18px`.
- Weight `650`.
- Line height `1.25`.

Health text:

- Size `12px`.
- Online uses success.
- Offline uses danger.
- Text must include online/offline wording; color alone is not enough.

### 8.3 Icon Buttons

Current class target:

- `.youtube-workflow-icon-btn`

Icon button MUST:

- Visual size `32px`.
- Radius `4px`.
- Border `1px`.
- Use flat surface fill.
- Have `aria-label` and `title` when icon-only.
- Show focus ring.

Implementation values:

```css
width: var(--pru-control-h-sm);
height: var(--pru-control-h-sm);
border-radius: var(--pru-radius-control);
```

Icon button MUST NOT:

- Use circle radius unless the icon represents an avatar or status dot.
- Use `font-size: 18px` if the visual becomes unbalanced; prefer SVG/lucide-style icons where practical.

### 8.4 Buttons

Current class targets:

- `.small-btn`
- `.youtube-workflow-actions .primary`
- `.youtube-workflow-job-actions .primary`
- `.youtube-workflow-job-actions .danger`
- `.youtube-primary-actions button[type="submit"]`

Button base MUST:

```css
min-height: var(--pru-control-h);
padding: 0 12px;
border-radius: var(--pru-radius-control);
font-size: 13px;
font-weight: 650;
display: inline-flex;
align-items: center;
justify-content: center;
gap: var(--pru-inline-gap);
transition: background-color 150ms var(--pru-ease), border-color 150ms var(--pru-ease), color 150ms var(--pru-ease), box-shadow 150ms var(--pru-ease);
```

Compact row action:

```css
min-height: var(--pru-control-h-sm);
padding: 0 10px;
font-size: 12px;
```

Primary:

- Background `--pru-accent`.
- Text white.
- Hover `--pru-accent-hover`.
- No heavy glow.

Secondary:

- Surface fill.
- Border visible.
- Text primary.

Ghost:

- Transparent background.
- Border optional.
- Hover fills with row-hover token.

Danger:

- Use danger text on neutral surface for low-risk actions.
- Use danger background only for final destructive confirmation.

Disabled:

- Opacity `0.48`.
- `pointer-events: none`.
- Cursor default.
- No hover/active change.

### 8.5 Inputs, Selects, Search

Current class targets:

- `.youtube-workflow-form input`
- `.youtube-workflow-form select`
- `.youtube-import-panel input`
- `.youtube-folder-choice select`
- `.youtube-material-link-input`
- `.youtube-recent-search`
- `.youtube-history-filters input`
- `.youtube-history-filters select`

Input/select MUST:

- Height `36px`, except main material URL input may be `44px`.
- Radius `4px`.
- Border `1px`.
- Padding `0 11px` for normal input.
- Visible focus ring.
- Placeholder lower contrast than text.
- No inset glossy highlight.

Main material URL input:

- Height `44px`.
- Same radius `4px`, not `8px`.
- May have stronger border and focus ring.
- Should be visually primary only within the form, not the whole panel.

Search fields:

- Width should be flexible.
- Recent search in the header may stay `160px-240px`, but on mobile it should become full width.

### 8.6 Tabs / Section Navigation

Current UI uses sections rather than a strict tab primitive. If tabs are added or section headers are restyled, use this model:

- Recent, Queue, Library/History are sibling surfaces.
- Tab container radius `6px`.
- Tab trigger radius `4px`.
- Active trigger uses solid surface and either accent text or subtle accent line.
- Inactive trigger uses muted text.

MUST NOT:

- Use large pill segmented controls.
- Mix recent reading items into queue task status rows without a section boundary.

### 8.7 Material / Job Rows

Current class targets:

- `.youtube-workflow-job`
- `.youtube-workflow-recent-job`
- `.youtube-workflow-history-job`
- `.youtube-workflow-job-main`
- `.youtube-workflow-job-actions`
- `.youtube-job-title`
- `.youtube-job-status-line`
- `.youtube-job-status-badge`
- `.youtube-job-position`
- `.youtube-job-opened-state`

Row base MUST:

```css
min-height: var(--pru-row-min-h);
padding: 10px;
border-radius: var(--pru-radius-row);
background: var(--pru-shell-row);
border: 1px solid var(--pru-row-border);
display: flex;
align-items: flex-start;
justify-content: space-between;
gap: 10px;
```

Define:

| Token | Dark | Light |
| --- | --- | --- |
| `--pru-row-border` | `rgba(255, 255, 255, 0.08)` | `#e4dac8` |
| `--pru-row-active-bg` | `#1b1f2a` | `#f4ecdf` |
| `--pru-row-failed-bg` | `#17171c` | `#fff5f4` |

Row content order MUST be:

1. Title.
2. URL/folder/source metadata.
3. Status line: status pill, progress, annotation count, opened/current marker.
4. Error or log snippet only when needed.
5. Actions.

Title:

- Size `14px`.
- Weight `650`.
- Truncate one line by default.
- May wrap to two lines if row has no side action or screen is wide.

Metadata:

- Size `12px`.
- Muted color.
- Truncate middle or end, but do not overflow.

Actions:

- Keep one primary action visible.
- Secondary actions may wrap after the primary action.
- Danger action should be visually separated when destructive.

### 8.8 Row State Matrix

Use both text and color. Do not rely on color alone.

| Data State | Visual State | Badge Text | Accent |
| --- | --- | --- | --- |
| `readStatus: in-progress` | Active/unfinished recent row | `未听完` or `unfinished` | warning |
| `completed: true` | Completed recent row | `已听完` or `finished` | success |
| `readStatus: not-started` | Not started recent row | `未开始` or `not started` | neutral |
| `data-active="true"` | Current material/selected job | Existing status text plus active left inset | accent |
| `data-status="queued"` | Waiting task | `排队中` | neutral |
| `data-status="downloading"` | Download task | `下载中` | info |
| `data-status="transcribing"` | Transcript task | `转写中` | info/accent |
| `data-status="segmenting"` | Segment task | `分段中` | accent |
| `data-status="translating"` | Translation task | `翻译中` | warning |
| `data-status="validating"` | Validation task | `校验中` | success/info |
| `data-status="ready"` | Ready task/history | `可阅读` | success |
| `data-status="failed"` | Failed task | `失败` | danger |
| `data-status="canceled"` | Canceled task | `已取消` | neutral |

Active row:

- Use an inset left line: `box-shadow: inset 3px 0 0 var(--pru-accent)`.
- Use active row background.
- Do not use a full bright blue fill.

Failed row:

- Use danger inset line.
- Include readable error text and retry path.
- Do not hide error cause behind tooltip only.

### 8.9 Status Pills

Current class target:

- `.youtube-job-status-badge`

Badge MUST:

- Radius pill.
- Height `20px-22px`.
- Padding `0 7px` or `2px 8px`.
- Font size `11px-12px`.
- Font weight `700-800`.
- Include text label.

Badge palette MUST be tokenized:

| Status Type | Background Dark | Text Dark | Background Light | Text Light |
| --- | --- | --- | --- | --- |
| neutral | `rgba(255,255,255,0.08)` | `--pru-shell-muted` | `rgba(83,69,45,0.07)` | `--pru-shell-muted` |
| info | `rgba(47,128,237,0.16)` | `#9ec8ff` | `rgba(37,99,235,0.11)` | `#1d4ed8` |
| accent | `rgba(94,106,210,0.18)` | `#b8bfff` | `rgba(83,96,201,0.12)` | `#3f4db4` |
| warning | `rgba(217,119,6,0.15)` | `#f0b35a` | `rgba(185,106,4,0.13)` | `#8f5100` |
| success | `rgba(31,138,101,0.16)` | `#72d5b1` | `rgba(31,138,101,0.12)` | `#12694b` |
| danger | `rgba(220,63,77,0.16)` | `#ff9aa4` | `rgba(207,61,75,0.12)` | `#a12c38` |

### 8.10 Recent Reading Section

Current class targets:

- `.youtube-workflow-recent`
- `.youtube-workflow-recent-job`
- `.youtube-recent-search`

Recent reading MUST:

- Be the first visible workflow section.
- Use the row model above.
- Sort visually according to the existing data order: unfinished, finished, not started.
- Show search close to the section title.
- Keep queue/failure states out of recent reading unless the item is actually a reader item.

Recommended row fields:

- Title.
- URL or folder name.
- Last opened time or progress.
- Read status badge.
- Progress percent.
- Annotation count.
- Primary action: `打开` / `继续`.

### 8.11 Queue Section

Current class targets:

- `.youtube-workflow-queue`
- `.youtube-workflow-job[data-status]`

Queue MUST:

- Show processing lifecycle status clearly.
- Keep cancel/retry actions visible when available.
- Use the same row geometry as recent reading.
- Use progress/log snippets only when useful; avoid full noisy logs by default.

Queue rows SHOULD have:

- Status badge.
- Position or current stage.
- Error line when failed.
- `取消`, `重试`, or `打开` action depending on state.

### 8.12 History / Library Section

Current class targets:

- `.youtube-workflow-history`
- `.youtube-history-filters`
- `.youtube-workflow-history-job`

History/library MUST:

- Feel like structured archive rows, not task rows.
- Use search/filter controls with the same input style.
- Keep batch actions secondary.
- Use ready/failed/canceled status colors but less visually loud than active queue.

History filters:

- Grid on desktop.
- Stack on mobile.
- Inputs/selects same 36px/4px model.

### 8.13 Import Panels / Legacy Entrypoints

Current class targets:

- `.youtube-import-panel`
- `.youtube-import-item`
- `.youtube-link-card`
- `.youtube-advanced-settings`

Import panels MUST:

- Be visually subordinate to Recent Reading.
- Use row radius `6px`.
- Use panel radius `8px` only for containing panels.
- Avoid glass backgrounds inside the main workflow panel.

Legacy/obsolete entrypoints SHOULD:

- Remain collapsed or visually muted.
- Use neutral badges or low-emphasis controls.
- Never compete with the primary recent-reading path.

### 8.14 Switch / Confirmation Modal

Current class targets:

- `.youtube-switch-modal-backdrop`
- `.youtube-switch-modal`
- `.youtube-workflow-actions`

Backdrop MUST:

- Cover viewport.
- Use a scrim strong enough to separate foreground.
- Use blur only as background separation, not decoration.

Values:

| Mode | Backdrop |
| --- | --- |
| Dark | `rgba(0, 0, 0, 0.52)` plus `blur(8px)` |
| Light | `rgba(37, 31, 22, 0.32)` plus `blur(8px)` |

Modal MUST:

- Radius `8px`.
- Padding `18px`.
- Border `1px`.
- Width `min(520px, calc(100vw - 32px))`.
- Title size `18px`.
- Body text size `13px`.
- Actions right-aligned on desktop.
- Actions full-width stacked only on narrow mobile if needed.

Modal MUST include:

- Title.
- Body explaining consequence.
- Cancel action.
- Primary action.
- Destructive action styling only when the action loses data.

### 8.15 Audio Player / Reader Controls

Current class targets may be broader legacy selectors; use scoped changes carefully.

Player MUST:

- Belong visually to the reading area.
- Use warm surface in both modes.
- Use accent progress.
- Use tabular timers.
- Use 4px control radius for buttons.
- Use pill radius only for progress track.

Player MUST NOT:

- Use a dark workflow shell style.
- Introduce glossy glass on every button.
- Shift layout when playback time changes.

### 8.16 Reading Pane

Reading pane MUST:

- Use warm paper background.
- Keep primary text high contrast.
- Keep active sentence visible but not dashboard-like.
- Use max text measure.
- Keep annotation marks low noise.

Recommended active sentence:

| Mode | Background | Edge |
| --- | --- | --- |
| Dark shell / warm reader | `rgba(217, 119, 6, 0.12)` | `inset 3px 0 0 rgba(94, 106, 210, 0.55)` |
| Light | `rgba(185, 106, 4, 0.12)` | `inset 3px 0 0 rgba(83, 96, 201, 0.52)` |

## 9. Glass Rules

Glass is allowed only on:

- Workflow outer panel.
- Floating task/material capsule.
- Top/bottom shell bars.
- Modal backdrop/scrim.
- Optional outer app shell.

Glass is not allowed on:

- Every button.
- Every list row.
- Status pills.
- Search inputs.
- Import items.
- Nested cards inside workflow panel.

Reason: too much glass weakens hierarchy, increases blur cost, and makes dark/light parity harder.

## 10. Light/Dark Parity Rules

The two modes MUST share:

- Radius scale.
- Component dimensions.
- Row layout.
- Badge shape.
- Button hierarchy.
- Focus model.
- Section order.
- Motion timing.

The two modes MAY differ in:

- Background brightness.
- Shadow opacity.
- Border contrast.
- Shell material.
- Badge color tonal values.

The two modes MUST NOT differ in:

- Which actions are primary.
- Which rows are active.
- Which status maps to which semantic meaning.
- Whether focus is visible.
- Whether a field/control is disabled.

## 11. Motion

Motion tokens:

| Token | Value |
| --- | --- |
| `--pru-ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` |
| `--pru-duration-fast` | `140ms` |
| `--pru-duration-base` | `180ms` |
| `--pru-duration-slow` | `220ms` |

Allowed animations:

- Hover color/border changes.
- Focus ring appearance.
- Modal fade/scale.
- Panel open/close translate/opacity if already supported.

Disallowed animations:

- Decorative background motion.
- Width/height animation that causes layout shift.
- Slow hover animation over `300ms`.
- Blinking status colors.

Reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  * {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

Use scoped reduced-motion overrides if the global form is too broad for the existing app.

## 12. Accessibility Requirements

Required:

- Text contrast: normal text at least 4.5:1.
- Secondary text: at least 3:1.
- Focus ring visible on keyboard navigation.
- Icon-only buttons have `aria-label`.
- Dialog uses `role="dialog"` and `aria-modal="true"` where modal.
- Status color always paired with text.
- Error state includes recovery path.
- Disabled controls use actual `disabled` attribute when possible.

Workflow-specific:

- Search inputs need accessible labels.
- Close/minimize buttons need accessible labels.
- Retry/cancel/open actions need clear button text.
- Modal should return focus to the trigger after close when practical.

## 13. Responsive Rules

Breakpoints:

| Width | Layout |
| --- | --- |
| `>= 1024px` | Reading pane and workflow panel may sit side by side or workflow floats |
| `768px - 1023px` | Workflow panel remains fixed/floating, max width constrained |
| `<= 640px` | Workflow panel width `calc(100vw - 16px)`, rows may wrap actions |
| `<= 390px` | Primary action stays visible; metadata truncates before actions |

Mobile row rules:

- Row can become two columns: content and action.
- If width is too narrow, action moves below content.
- Metadata truncates before title.
- Badges wrap after the first line.
- No horizontal scroll.

## 14. Existing Class Migration Map

Use this as the first implementation checklist.

| Existing Selector | Apply Spec |
| --- | --- |
| `.youtube-workflow-panel` | Panel shell, mode tokens, radius 8 |
| `.youtube-workflow-header` | Sticky header, shell border, title/meta typography |
| `.youtube-workflow-icon-btn` | 32px icon button, radius 4, focus ring |
| `.youtube-workflow-form input/select` | Input/select base, radius 4 |
| `.youtube-material-link-input` | Primary URL input, 44px high, radius 4 |
| `.youtube-recent-search` | Search input base, responsive width |
| `.youtube-workflow-job` | Base row, radius 6, row token background |
| `.youtube-workflow-recent-job` | Recent row variant |
| `.youtube-workflow-history-job` | Archive/library row variant |
| `.youtube-workflow-job[data-active="true"]` | Active row inset line and active bg |
| `.youtube-workflow-job[data-status="failed"]` | Failed row inset line and danger badge |
| `.youtube-job-status-badge` | Pill badge token matrix |
| `.youtube-job-position` | Mono/tabular meta if numeric |
| `.youtube-job-opened-state` | Neutral status chip |
| `.youtube-job-log` | Muted nested log, not a full card |
| `.youtube-history-filters input/select` | Input/select base |
| `.youtube-import-panel` | Subordinate panel, radius 8 |
| `.youtube-import-item` | Compact row, radius 6 |
| `.youtube-link-card` | Compact validation row, radius 6 |
| `.youtube-switch-modal-backdrop` | Modal scrim |
| `.youtube-switch-modal` | Confirmation modal |
| `.youtube-primary-actions button[type="submit"]` | Primary action |
| `.youtube-workflow-job-actions .danger` | Danger action |

Important: avoid broad global changes to `button` while implementing workflow polish. The existing CSS has broad glass button rules later in the file. Prefer more specific workflow selectors for this pass.

## 15. Implementation Order

Implement in this order to reduce regressions.

1. Add PRU variables to `:root` and `[data-theme="dark"]`.
2. Normalize workflow panel/header/icon button radius and colors.
3. Normalize input/select/button base styles inside `.youtube-workflow-panel`.
4. Normalize recent/queue/history rows.
5. Normalize status badges.
6. Normalize switch modal.
7. Normalize import/legacy sub-panels.
8. Adjust reader/player surfaces only after workflow is stable.
9. Run build and targeted verification.
10. Do visual screenshots desktop/mobile light/dark.

Do not combine this with logic refactors.

## 16. Common Failure Modes

Watch for these during implementation:

- Broad `button` CSS later in `styles.css` overrides workflow button radius.
- Existing `--radius-md: 12px` leaks into workflow controls.
- Light mode surfaces become indistinguishable because all backgrounds are `#fff`.
- Dark mode rows become too low contrast.
- Status badges use readable colors in one mode but fail in the other.
- Recent reading and queue visually merge into one list.
- Modal backdrop is too weak and background competes with the dialog.
- Search input width breaks mobile layout.
- Title and action buttons overlap in rows.
- Error text truncates so the recovery path is lost.
- Focus ring is removed by `outline: none`.

## 17. Acceptance Checklist

Visual:

- [ ] Buttons, inputs, row cards, panels use only 4/6/8/pill radius.
- [ ] Glass appears only on allowed shell surfaces.
- [ ] Recent Reading is clearly the primary entry.
- [ ] Queue and History are visually separate from Recent Reading.
- [ ] Dark mode matches the black precision utility direction.
- [ ] Light mode matches the frosted paper utility direction.
- [ ] Status colors are consistent across both modes.
- [ ] Modal looks like the design board in both modes.

Behavioral:

- [ ] No workflow action moved or disappeared.
- [ ] Existing drag/minimize/close behavior still works.
- [ ] Search fields still work.
- [ ] Open/retry/cancel actions still work.
- [ ] No new IndexedDB or API behavior introduced.

Accessibility:

- [ ] Keyboard focus visible.
- [ ] Icon-only controls labeled.
- [ ] Dialog is announced as a dialog.
- [ ] Status has text label, not color only.
- [ ] Contrast checked in both modes.

Responsive:

- [ ] 390px width: no horizontal overflow.
- [ ] 640px width: row actions do not overlap.
- [ ] 768px width: panel remains usable.
- [ ] Desktop: row density remains compact and scannable.

Verification:

- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm run verify:youtube-workflow-panel`
- [ ] `npm run verify:youtube-workflow-client`

