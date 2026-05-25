## 1. 根因链路收敛

- [x] 1.1 审查 `lockChunkNoteDimensions()`、主题切换入口和 `spawnChunkNoteTag()` 之间的宽高传递链，确认只在主题切换尺寸锁定环节修复
- [x] 1.2 选定最小修复方式，使写回的 `note.w`、`note.h` 与 `.chunk-note-tag` 的 content-box 宽高语义一致

## 2. 最小实现

- [x] 2.1 在不修改 theme CSS 视觉规则的前提下，调整主题切换前的 chunk note 尺寸锁定逻辑，避免把 outer-box 尺寸直接写回 `note.w`、`note.h`
- [x] 2.2 保持 `spawnChunkNoteTag()`、chunk note 存储格式和现有渲染入口兼容，不引入广泛 UI 结构变更

## 3. 验证

- [x] 3.1 验证已渲染 chunk note 气泡在 light → dark → light 切换过程中宽高不再持续增长
- [x] 3.2 验证主题切换后颜色和阴影仍会更新，同时 chunk note 的位置、渲染和显示不出现明显回归
