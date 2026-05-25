## ADDED Requirements

### Requirement: Chunk note 气泡在主题切换时必须保持尺寸稳定
系统在 dark/light 主题切换过程中，针对已渲染的 `.chunk-note-tag` SHALL 保持切换前后的宽度和高度语义一致。主题切换只允许更新颜色、阴影、背景和其他视觉样式，不得因为尺寸锁定或重渲染而让气泡宽高持续增长。

#### Scenario: 已渲染气泡从 light 切换到 dark
- **WHEN** 用户在存在可见 chunk note 气泡的情况下从 light theme 切换到 dark theme
- **THEN** 该气泡的宽度和高度不得因为主题切换而变大
- **THEN** 该气泡仍可更新为 dark theme 对应的颜色和阴影样式

#### Scenario: 已渲染气泡从 dark 切换回 light
- **WHEN** 用户在存在可见 chunk note 气泡的情况下从 dark theme 切换回 light theme
- **THEN** 该气泡的宽度和高度不得因为主题切换而变大
- **THEN** 该气泡仍可更新为 light theme 对应的颜色和阴影样式

### Requirement: 主题切换尺寸锁定必须写回与 `.chunk-note-tag` 盒模型一致的宽高
系统在主题切换前锁定 chunk note 尺寸时，写回 `note.w` 和 `note.h` 的值 MUST 与 `.chunk-note-tag` 最终消费的 `style.width` 和 `style.height` 语义一致，不得把 outer-box 尺寸直接写回 content-box 宽高字段。

#### Scenario: 锁定逻辑读取现有气泡尺寸
- **WHEN** 主题切换逻辑在刷新前读取现有 `.chunk-note-tag` 的屏幕尺寸
- **THEN** 系统必须在写回 `note.w` 和 `note.h` 前消除 padding 和 border 对 outer-box 的影响，或使用等价方式得到 content-box 尺寸

#### Scenario: 重渲染后保持既有布局尺寸
- **WHEN** 主题切换后 `spawnChunkNoteTag()` 使用 `note.w` 和 `note.h` 重新创建气泡
- **THEN** 新建气泡的宽高必须与切换前的气泡布局尺寸保持一致
- **THEN** 不得出现每切换一次主题就额外增长一圈的现象

### Requirement: 修复不得改变 chunk note 的现有渲染与定位行为
系统在修复主题切换尺寸问题时 SHALL 保持 chunk note 的定位、渲染入口、存储格式和主题 CSS 视觉规则兼容，不得因为此次修复引入广泛 UI 重构或数据格式变化。

#### Scenario: 主题切换后 note 仍在原有位置附近渲染
- **WHEN** 用户切换主题并触发 chunk note 视觉刷新
- **THEN** 气泡仍应按现有 anchor 和定位逻辑显示
- **THEN** 不得因为本次修复导致 chunk note 明显漂移或丢失

#### Scenario: 现有数据格式保持兼容
- **WHEN** 系统读取已保存的 chunk note 数据并在主题切换后重渲染
- **THEN** 不需要迁移已有 chunk note 存储数据
- **THEN** 现有 chunk note 渲染和显示流程必须继续可用
