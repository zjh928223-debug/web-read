## Why

`app.js` 仍是当前运行时的中央胶水层，集中持有大量 legacy state、DOM wiring、`window.*` exports、`window.__state` proxy 和 Vue/Pinia bridge。项目在清理完成前不会新增功能，因此现在应专门建立一条阶段性清空路线，把 `app.js` 从高风险集成面逐步降级为可删除的 legacy shell。

## What Changes

- 建立以 `app.js` 清空为目标的阶段性迁移路线，而不是继续按零散 bugfix 推进。
- 为每个阶段定义可验证出口：load check、playback/interactions checks、build，以及必要时的浏览器人工回归。
- 先冻结新增功能入口：清理期间不把新业务逻辑加入 `app.js`。
- 逐步迁出纯逻辑、子系统、状态所有权、DOM/event ownership 和 root legacy scripts。
- 将 `window.__state`、`window.__bridge`、`window.*` exports 从真实运行时中心降级为兼容 facade，并在调用方迁移完成后删除。
- 明确 `index.html` script order、IndexedDB schema、session restore、annotation glue 等高风险区域的处理顺序。
- **BREAKING**：最终阶段允许删除 legacy inline handlers、legacy render paths、root regular scripts 和 `app.js`，但只有在对应调用方已经迁移并通过验证后执行。

## Capabilities

### New Capabilities

- `legacy-runtime-decomposition`: 约束 `app.js` 阶段性清空、状态迁移、兼容 facade 降级、DOM/event ownership 转移和验证出口。

### Modified Capabilities

- 无。

## Impact

- 主要影响文件：
  - `app.js`
  - `index.html`
  - `src/main.js`
  - `src/composables/session-init.js`
  - `src/composables/*.js`
  - `src/pinia-stores/*.js`
  - `src/stores/*.js`
  - `src/components/*.vue`
  - root legacy scripts: `chunk-note-layout-helpers.js`, `chunk-note-layout-core.js`, `annotation-bubble.js`, `annotation-api-settings-ui.js`
- 验证命令：
  - `npm test`
  - `npm run verify:playback`
  - `npm run verify:interactions`
  - `npm run build`
- 不改变 IndexedDB schema：
  - DB name: `SeekPlayerDB`
  - version: `1`
  - object store: `files`
  - key path: `id`
