## Context

当前 chunk note 气泡的主题切换流程包含两步与尺寸相关的动作。第一步是在主题切换前由 `lockChunkNoteDimensions()` 读取现有 `.chunk-note-tag` 的 `getBoundingClientRect()` 结果并写回 `note.w`、`note.h`；第二步是在 `refreshAllChunkNoteVisuals()` 触发的重渲染过程中，由 `spawnChunkNoteTag()` 将 `note.w`、`note.h` 重新写入 `style.width`、`style.height`。由于 `.chunk-note-tag` 当前使用 `box-sizing: content-box`，前一步读到的 outer-box 尺寸不能直接作为后一步的 content-box 尺寸使用，这正是气泡逐次变大的来源。

这个变更只处理主题切换时的 chunk note 尺寸锁定链路，不改变现有 theme CSS token，不改变 chunk note 的定位、绘制、编辑、持久化和 connector 渲染规则。

## Goals / Non-Goals

**Goals:**
- 修正主题切换前的 chunk note 尺寸锁定，使写回的 `note.w`、`note.h` 与 `.chunk-note-tag` 的盒模型语义一致
- 保证 dark/light 主题切换前后，chunk note 气泡的宽高保持不变
- 保持现有颜色、阴影、背景玻璃效果和主题视觉行为不变
- 保持变更范围局限在主题切换和 chunk note 尺寸锁定相关代码

**Non-Goals:**
- 不重写 `.chunk-note-tag` 的整体布局或视觉样式
- 不做广泛的 `box-sizing` 体系调整
- 不修改 chunk note 编辑、拖拽、resize、connector 或图片渲染逻辑
- 不修改 chunk note 的存储 schema 或其他阅读器功能

## Decisions

### Decision: 在主题切换尺寸锁定阶段写回 content-box 尺寸，而不是 outer-box 尺寸
当前根因是 `getBoundingClientRect()` 返回 outer-box 尺寸，但 `spawnChunkNoteTag()` 最终需要的是 content-box 尺寸。最小修复方案应该保留现有“主题切换前先锁尺寸，再重渲染”的整体流程，只调整锁定时写回的宽高语义。

备选方案：
- 方案 A：把 `.chunk-note-tag` 改成 `box-sizing: border-box`
  - 优点：表面上可以让写回的宽高更接近 `getBoundingClientRect()` 结果
  - 缺点：会影响现有编辑态、resize、文本布局、图片模式和其他尺寸计算，回归面更大
- 方案 B：删除主题切换前的尺寸锁定逻辑
  - 优点：实现简单
  - 缺点：无法保证主题切换重渲染时保持既有尺寸，可能引入其他尺寸漂移
- 方案 C：保留锁定逻辑，但在写回前把 outer-box 转换成 content-box
  - 优点：最小、聚焦、与现有渲染链兼容
  - 结论：选择此方案

### Decision: 保持 `spawnChunkNoteTag()` 与现有存储格式不变
问题不在 `spawnChunkNoteTag()` 自身，而在上游传入的 `note.w`、`note.h` 语义错误。保持下游渲染和存储格式不变，可以把修复限定在主题切换锁定环节，降低对已有 note 数据的影响。

### Decision: 继续允许主题切换后刷新视觉，但不允许布局增长
主题切换后仍应调用现有视觉刷新链，以便颜色、阴影、accent 和 connector 正常更新。但该刷新不应改变宽高。这个约束会通过 spec 和验证步骤固定下来。

## Risks / Trade-offs

- [Risk] 仅修正主题切换前的尺寸锁定后，其他使用 `getBoundingClientRect()` 的尺寸回写路径仍可能存在类似语义问题
  → Mitigation：本次 change 只限定主题切换链路；如后续发现其他路径复现，再单独提出 change

- [Risk] 如果某些 note 在切换前处于编辑或 dragging 状态，读取到的瞬时尺寸可能与稳定态不同
  → Mitigation：本次设计不扩展到交互态重构，只要求常规已渲染气泡在主题切换下尺寸稳定

- [Risk] 浏览器对 `backdrop-filter` 和 subpixel rounding 的实现差异，可能让 `getBoundingClientRect()` 出现 1px 级别浮动
  → Mitigation：验证关注“不会持续增长”，并以宽高保持稳定为判据，而不是要求视觉截图像素级完全一致

## Migration Plan

这是前端本地逻辑修复，不涉及数据迁移。上线方式为直接替换前端资源。

回滚方式：
- 如果出现 chunk note 尺寸或定位回归，可直接回滚本次针对主题切换尺寸锁定的局部改动
- 由于不修改存储 schema，回滚不会引起已有 note 数据不兼容

## Open Questions

- 主题切换时是否需要对编辑中的 chunk note modal 做同类尺寸锁定，目前不在本次范围内
- 是否要为未来其他尺寸锁定场景提炼一个统一的 “content-box dimension helper”，本次先不要求
