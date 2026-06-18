## Context

Read-Web 当前是 Vite + Vue 3 + Pinia 迁移中的混合项目。当前浏览器入口是 `index.html`，但运行时仍以 `app.js` 为中心：`app.js` 持有大量 local state，通过 `window.__state` getter/setter proxy 暴露给 compatibility modules，再通过 `window.__bridge` 同步到 `src/pinia-stores/*.js`，最后由 Vue components 渲染薄层 UI。

当前关键约束：

- 清理完成前不新增用户功能。
- `app.js` 目前约 3379 行，仍导出大量 `window.*` 函数。
- `index.html` script order 仍依赖 legacy globals 和 side effects。
- `src/composables/session-init.js` 是高风险文件，负责 startup restore、persisted cleanup 和 annotation/session glue。
- IndexedDB schema 不允许改变：`SeekPlayerDB` / version `1` / object store `files` / key path `id`。
- Vue rendering 已默认启用，但很多交互仍依赖 inline handlers、legacy DOM 和 `app.js` exports。

这次变更不以新增功能为目标，而是建立一条阶段性清空路线，让 `app.js` 逐步从真实运行时中心降级为 legacy compatibility shell，最终删除。

## Goals / Non-Goals

**Goals:**

- 把 `app.js` 清空路线拆成可独立验证的阶段。
- 每个阶段都明确迁出对象、禁止事项、验证命令和回退方式。
- 把新代码落点固定到 `src/utils/`、`src/services/`、`src/composables/`、`src/pinia-stores/` 或 Vue components，而不是继续进入 `app.js`。
- 逐步迁移 state ownership，使 Pinia/runtime modules 成为真实状态源，`window.__state` 只保留临时兼容语义。
- 逐步迁移 DOM/event ownership，最终移除 inline handlers 和 legacy render paths。
- 在最终阶段删除 `app.js` 和可移除的 root regular scripts。

**Non-Goals:**

- 不新增 reader 用户功能。
- 不改变 IndexedDB schema。
- 不在单个阶段同时重写 playback、chunk note、session restore 和 annotation glue。
- 不为了减少行数而做无边界的机械搬家。
- 不把 `src/stores/` compatibility stores 误认为长期状态层；长期状态层应是 `src/pinia-stores/` 或明确 runtime module。

## Decisions

### Decision: 采用阶段性清空，而不是一次性重写

`app.js` 的主要风险来自隐式状态、事件顺序、script order 和 DOM ownership，不是单纯文件长度。一次性重写会让回归来源不可定位。

采用阶段性清空：

1. 每阶段只迁移一个边界类型。
2. 每阶段结束都运行验证。
3. 每阶段形成独立提交。
4. 下阶段只在上阶段验证通过后开始。

备选方案：

- 一次性重写：短期看快，但 playback highlight、AI chunk、chunk notes、session restore 很容易产生不可定位回归。
- 极保守小刀口：稳定但过慢，不符合当前“清理完成前不新增功能”的项目状态。

### Decision: Phase 0 先建立重构基线和禁止线

正式迁移前必须建立当前 runtime map，包括：

- `app.js` 的 `window.*` exports 清单。
- `window.__state` 字段清单。
- `window.__bridge` 同步字段清单。
- `index.html` inline handlers 和 script order 清单。
- root regular scripts 的消费者清单。
- 当前验证覆盖清单。

Phase 0 还要写清楚禁止线：

- 清理期间不新增用户功能。
- 不向 `app.js` 添加新的 feature logic。
- 不在未验证前调整 IndexedDB schema 或 script order。
- 不把 dead path 删除和核心迁移混在同一提交里。

### Decision: Phase 1 只迁出纯逻辑和近纯 helper

第一批迁移对象必须满足：

- 可以通过显式参数传入依赖。
- 不直接读写 DOM。
- 不改变 event ordering。
- 不改变 persisted state 格式。

优先对象：

- chunk matching helpers。
- playback index helpers。
- cloze view model helpers。
- import/export parse helpers。
- storage key 和 data normalization helpers。

这阶段的目标是减少 `app.js` 内部算法复杂度，同时不碰用户最敏感的 UI 行为链。

### Decision: Phase 2 迁出子系统，但保留 legacy facade

第二批处理有清晰业务边界但仍有 DOM/state 依赖的子系统：

- chunk note subsystem。
- sentence note / note preview subsystem。
- annotation lightweight import/export glue。
- keyboard/event module boundary。

每个子系统迁出时先建立 module API，再让 `app.js` 调用该 API。调用方全部迁移完成前，`window.*` facade 继续存在。

这个阶段允许 `app.js` 行数明显下降，但不追求立刻删除所有兼容出口。

### Decision: Phase 3 迁移 state ownership

`app.js` local `let` state 当前仍是很多行为的真实源。Phase 3 的目标是把真实状态迁到 Pinia 或明确 runtime modules：

- transcript/chunk/cloze state 进入对应 Pinia store。
- playback transient state 进入 playback runtime module 或 Pinia store，按是否需要 Vue reactivity 决定。
- chunk note 和 sentence note state 进入对应 subsystem module/store。
- `window.__state` 变为 compatibility facade，只从真实状态源读写。

只有当某个字段没有 legacy caller 直接依赖时，才能删除对应 `window.__state` property。

### Decision: Phase 4 迁移 DOM/event ownership

当状态所有权明确后，再迁移 DOM 和事件：

- inline `onclick` / `oninput` 转成 Vue event 或 centralized DOM bindings module。
- legacy `getElementById` wiring 转成显式绑定层。
- Vue components 逐步接管正常 transcript、AI chunk、cloze、toast、notes 等可视层。
- legacy render function 只保留临时 facade，直到调用方迁移完成。

这阶段允许调整 `index.html`，但必须把 script order 变化作为单独验证点处理。

### Decision: Phase 5 迁移 root regular scripts 和入口

最后处理 root regular scripts：

- `chunk-note-layout-helpers.js`
- `chunk-note-layout-core.js`
- `annotation-bubble.js`
- `annotation-api-settings-ui.js`

优先把可模块化的脚本迁入 `src/`，并通过 Vite module graph 加载。只有确认 production build 不再需要 copy legacy root scripts 后，才能删除 `vite.config.js` 中的 copy 逻辑。

### Decision: Phase 6 删除 `app.js`

删除 `app.js` 前必须满足：

- `index.html` 不再直接加载 `app.js`。
- 没有 inline handler 调用 `app.js` exports。
- 没有 runtime module 依赖 `window.__state` 作为真实状态源。
- `window.__bridge` 不再承担 startup sync。
- 所有 root regular scripts 要么已迁入 module graph，要么有明确保留理由。
- `npm test`、`npm run verify:playback`、`npm run verify:interactions`、`npm run build` 全部通过。

## Risks / Trade-offs

- [Risk] 迁移纯 helper 时误改边界逻辑，导致行为细节变化。
  Mitigation: 每次只迁一个 helper family，保留原入口签名，先加或更新针对 helper 的测试，再运行现有验证。

- [Risk] 子系统迁出后形成“新模块 + app.js facade + window export”的双层复杂度。
  Mitigation: 每个 facade 都必须标注消费者和删除条件，不能无限期保留。

- [Risk] `session-init.js` 和 annotation glue 仍然会把启动流程复杂度拉回全局。
  Mitigation: 在 state ownership 稳定前只做接口收束，不提前重写 session restore。

- [Risk] script order 调整会触发 import-time side effect 回归。
  Mitigation: script order 变化只能在 Phase 4 之后做，并且作为单独提交验证。

- [Risk] 当前验证覆盖不足，人工不使用项目会让视觉/交互回归滞后发现。
  Mitigation: 每阶段扩展 Playwright 覆盖，尤其是 playback highlight、AI chunk、chunk note、annotation lightweight import/export。

- [Risk] 为了减少 `app.js` 行数而迁移未收敛的逻辑，造成模块边界不清。
  Mitigation: 迁移前必须先写清楚 owner、public API、state source 和 cleanup condition。

## Migration Plan

### Phase 0: Baseline and Guardrails

- 生成 `app.js` runtime map。
- 列出 `window.*` exports、`window.__state` properties、`window.__bridge` fields。
- 列出 `index.html` inline handlers 和 root regular scripts consumers。
- 记录当前验证命令和覆盖范围。
- 提交文档和检查清单。

Validation:

- `npm test`
- `npm run build`

Rollback:

- 回退 Phase 0 文档提交即可，不影响 runtime。

### Phase 1: Pure Logic Extraction

- 迁出纯 helper 和近纯 helper。
- 保持原函数入口或 wrapper 行为不变。
- 为 helper 增加 focused tests 或 Playwright 覆盖。

Validation:

- helper tests，如果新增。
- `npm test`
- 影响 playback 或 interactions 时运行对应专项验证。

Rollback:

- 回退该 helper family 的单独提交。

### Phase 2: Subsystem Extraction

- 迁出 chunk note、sentence note、annotation lightweight glue、keyboard/event boundary。
- `app.js` 临时作为 facade 调用新模块。
- 为每个 facade 写删除条件。

Validation:

- `npm test`
- `npm run verify:interactions`
- 影响 playback 时运行 `npm run verify:playback`
- 必要时启动 `npm run dev` 做浏览器验证。

Rollback:

- 回退对应 subsystem 提交；避免多个 subsystem 混在一个提交。

### Phase 3: State Ownership Migration

- 把真实 state source 迁到 Pinia/runtime modules。
- 降级 `window.__state` 为 compatibility facade。
- 删除没有消费者的 proxy fields。

Validation:

- `npm test`
- `npm run verify:playback`
- `npm run verify:interactions`
- session restore 相关手动或自动验证。

Rollback:

- 回退单个 state domain 迁移提交。

### Phase 4: DOM/Event Ownership Migration

- 移除 inline handlers。
- 将 DOM bindings 移入集中模块或 Vue components。
- 删除已无调用方的 legacy render facade。

Validation:

- `npm test`
- `npm run verify:playback`
- `npm run verify:interactions`
- `npm run build`
- 浏览器验证 `http://127.0.0.1:5173/`。

Rollback:

- 回退单个 DOM/event domain 提交。

### Phase 5: Root Script and Entry Cleanup

- 将可迁移 root regular scripts 纳入 Vite module graph。
- 删除不再需要的 root script copy build logic。
- 调整 `index.html` script order，但每次只做一个入口变化。

Validation:

- `npm run build`
- `npm test`
- production preview load check。

Rollback:

- 回退单个 script migration 提交。

### Phase 6: Remove `app.js`

- 删除 `index.html` 中的 `app.js` script。
- 删除残余 `window.__state` / `window.__bridge` startup dependency。
- 删除无消费者 `window.*` facade。
- 删除 `app.js` 文件。

Validation:

- `npm test`
- `npm run verify:playback`
- `npm run verify:interactions`
- `npm run build`
- 浏览器 smoke test。

Rollback:

- 回退 final removal commit。

## Open Questions

- Phase 0 runtime map 是否作为长期文档保存在 `docs/`，还是保存在 OpenSpec change 内直到 archive。
- 当前 `src/stores/` compatibility layer 是否在 Phase 3 一并清理，还是等 `app.js` 删除后单独清理。
- `session-init.js` 是否应在 Phase 2 只收束 API，还是等 Phase 3 state ownership 明确后再拆分。
- root regular scripts 中哪些脚本可以直接迁入 ES module，哪些需要先保留 regular script 语义。
