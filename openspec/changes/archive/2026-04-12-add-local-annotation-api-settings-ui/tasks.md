## 1. Seam Audit And Initial Wiring

- [x] 1.1 Review how `annotation-api-client.js` reads config through `AnnotationApiConfig` / `window.__ANNOTATION_API_CONFIG__`, and keep that runtime seam unchanged.
- [x] 1.2 Review `app.js` initialization and configured/unconfigured status sync timing, and keep the wiring thin.
- [x] 1.3 Keep the settings entry in the existing toolbar near the annotation generation entry/status area.

## 2. Local Config Store / Helper

- [x] 2.1 Add a centralized local config helper for localStorage read/write, normalization, restore, and global seam sync.
- [x] 2.2 Keep Gemini defaults and minimal normalization for `provider`, `apiKey`, `model`, and `baseUrl`.
- [x] 2.3 Keep incomplete current config mapped back to `unconfigured`.
- [x] 2.4 Preserve compatibility with the existing `AnnotationApiConfig.read()` contract used by the API client and generation controller.

## 3. Lightweight Settings Popover

- [x] 3.1 Add a lightweight settings entry in the page toolbar without changing the existing generation entry location.
- [x] 3.2 Render a compact popover UI for local annotation API configuration.
- [x] 3.3 Keep `apiKey` hidden by default and editable only inside the popover.
- [x] 3.4 Keep the UI scoped to annotation API settings only, without expanding into a broader settings center.

## 4. Save / Restore / Status Sync

- [x] 4.1 Restore local configuration automatically on page load and sync it into `window.__ANNOTATION_API_CONFIG__`.
- [x] 4.2 Make save actions effective immediately without page refresh.
- [x] 4.3 Make clear / incomplete config fall back immediately to `unconfigured`.
- [x] 4.4 Keep generation pipeline, target source, planner, storage, click resolver, and bubble responsibilities unchanged.

## 5. Initial Verification

- [x] 5.1 Run `node --check` on the added and modified helper/UI/wiring files.
- [x] 5.2 Verify first-load `unconfigured` behavior.
- [x] 5.3 Verify saving a complete real config immediately switches the page to configured/ready semantics.
- [x] 5.4 Verify refresh restores the saved config without manual Console injection.
- [x] 5.5 Verify the real API chain remains usable, and mock remains usable through the existing runtime seam.
- [x] 5.6 Verify clearing config returns the page to `unconfigured`, and `apiKey` is not shown in always-visible UI.

## 6. Popover Positioning Fix

- [x] 6.1 Replace the old pure CSS popover positioning with button-anchored positioning plus viewport clamping.
- [x] 6.2 Keep the panel visible inside the viewport on normal, narrow, and low-height windows.
- [x] 6.3 Recalculate popover position on open, resize, and scroll while it remains visible.
- [x] 6.4 Move the panel to a stable `document.body` overlay context to avoid toolbar-relative positioning bugs.

## 7. Lightweight Multi-Profile Config Management

- [x] 7.1 Upgrade the local config store from a single config object to `profiles + currentProfileId`, with migration from the previous single-config format.
- [x] 7.2 Add a current-profile selector plus `新建` / `删除` actions in the settings popover.
- [x] 7.3 Change the form fields to `配置名称`, `Provider`, `API Key`, `Model`, and `Base URL`.
- [x] 7.4 Save the current profile without introducing `另存为`, dirty-state management, import/export, or project-file persistence.
- [x] 7.5 Restore saved profiles and the current selected profile after refresh.
- [x] 7.6 Sync the selected complete profile immediately into `window.__ANNOTATION_API_CONFIG__`.
- [x] 7.7 Return the page to `unconfigured` when the selected profile is incomplete or when the last profile is deleted.
- [x] 7.8 Verify profile creation, switching, deletion, restore, and real API generation compatibility.
