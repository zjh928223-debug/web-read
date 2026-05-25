## 1. 实施前边界确认

- [x] 1.1 确认页面级入口放置点：优先选择 `read-26.html` 的 `.transcript-actions` 工具栏；不得改 transcript / chunk 正文结构
- [x] 1.2 确认当前 change 只做 entry/status/progress UI；不得加入 API key form、provider form、model picker、prompt editor 或真实 request
- [x] 1.3 确认 entry UI 不通过 `AnnotationBubble` 启动生成；annotation bubble 只保持当前释义显示 consumer 身份

## 2. 页面级 entry / status UI

- [x] 2.1 在页面级控制区新增 `生成全文注释` 按钮或等价 entry；保持既有导入/导切分/标记/释义/播放控件不被替换
- [x] 2.2 新增最小 status/progress mount，可显示 state label、message、total、completed、failed、progress
- [x] 2.3 新增集中、命名清晰的 entry/status 样式；不得复用旧 `#info-card` 侧栏 DOM，不得耦合 `.annotation-bubble` selector

## 3. Standalone status renderer / future seam

- [x] 3.1 新增小型 entry/status renderer boundary 或等价独立函数，支持 `unconfigured`、`ready`、`running`、`complete`、`partial-failed`、`retryable` 状态
- [x] 3.2 新增 future controller lookup / adapter seam；优先查找未来 standalone annotation generation controller，缺失时返回 unconfigured/未接入状态
- [x] 3.3 新增最小 reader document context adapter，只输出 plain data 摘要给 future seam；不得把 provider request、prompt builder、result persistence 写入按钮 handler

## 4. 最小 app.js wiring

- [x] 4.1 在 `app.js` 中新增 entry/status DOM binding 和初始化调用；页面加载时能看到诚实的 `未配置` 或 ready 状态
- [x] 4.2 给 `生成全文注释` 入口添加 click wiring；缺配置或 controller 未接入时更新状态 message，不假装生成
- [x] 4.3 保持 word click / audio seek / `forceUpdateUI(...)` / highlight / `renderChunkMode()` / annotation bubble click update 路径不变

## 5. 验证

- [x] 5.1 验证 `app.js` 以及如有新增的 annotation generation entry/status JS 文件语法通过
- [x] 5.2 浏览器验证页面加载：entry button 和 status/progress area 可见；annotation bubble 默认行为不变
- [x] 5.3 验证无 controller / 无 API config 时，点击 `生成全文注释` 显示未配置/未接入状态，不生成假 annotation，不刷新 bubble
- [x] 5.4 验证 status renderer 可用测试数据渲染 ready / running / complete / partial-failed / retryable 的状态与计数
- [x] 5.5 验证既有控件仍存在：音频/字幕导入、导切分、标记、释义、annotation bubble hotkey、播放跳转入口
- [x] 5.6 验证普通 transcript word click 仍只走既有音频跳转路径；不会启动全文生成

## 6. 追加的状态边界要求

- [x] 6.1 明确区分 `unconfigured` / 未配置 和 `not-connected` / 未接入 两种状态；不得把缺少 API 配置和 future controller 未接入混成同一种 message
- [x] 6.2 生成处于 `running` / 生成中状态时，页面级 `生成全文注释` 入口必须禁用或等价防重复触发
- [x] 6.3 status renderer 必须支持初始 `idle` / `empty` 状态；页面首次加载时 status/progress area 不得空白、闪动或显示误导性的 running/complete
