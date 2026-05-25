## 1. 实施前确认

- [x] 1.1 确认当前点击气泡路径仍为 `notifyAnnotationBubbleWordClick()` -> `resolveAnnotationBubbleForSpan()` -> `vocabMatchMap` fallback；实施前记录要插入的最小 seam
- [x] 1.2 确认 generated bundle 当前通过 `AnnotationGenerationStorage.loadBundle(scope)` / `saveBundle(scope, ...)` 管理；不得在 app.js 中拼接 storage key
- [x] 1.3 确认本 change 不修改 `annotation-bubble.js`、不修改 API provider/prompt/controller 主流程、不新增导入 UI 或设置 UI

## 2. 新增 standalone bridge modules

- [x] 2.1 新增 `annotation-generated-result-store.js`，暴露独立 store/index API，支持 clear、indexBundle、query、scope metadata
- [x] 2.2 store/index 标准化 generated items，保留 id / targetId / blockId / markedText / boundary / type / meaning / memoryHint / provider/source
- [x] 2.3 store/index 只接收 bundle/plain data；不得读取 DOM、bubble、entry UI、audio player、storage 或网络
- [x] 2.4 新增 `annotation-click-resolver.js`，暴露 generated click resolver API，输入 clicked span / wordIndex / words / store，输出 bubble-consumable annotation 或 null
- [x] 2.5 click resolver 实现基于 clicked word、小窗口、markedText、boundary 的保守匹配；不确定时返回 null
- [x] 2.6 click resolver 点击查询时不得调用 storage / localStorage / IndexedDB / file handle / 网络
- [x] 2.7 明确 generated resolver 的返回契约：要么直接返回与 `bubble.setAnnotation(...)` 兼容的 normalized annotation，要么返回可被独立 `normalizeGeneratedAnnotationHit(...)` 消化的统一结构；禁止在多个调用点各自拼字段
- [x] 2.8 明确 generated resolver 的候选排序与冲突策略：优先使用 boundary 精确命中，其次 boundary 包含 clicked word，再其次 markedText 精确匹配；若最高优先级出现并列歧义，则返回 null
- [x] 2.9 `store.indexBundle(...)` 需对 generated items 做容错标准化与过滤：缺少有效 markedText 且缺少合法 boundary 的项不得入索引；非法字段不得在 query 阶段临时修补

## 3. HTML / app.js 最小接线

- [x] 3.1 在 `read-26.html` 中以最小方式加载 bridge modules，确保它们在 `app.js` 前可用
- [x] 3.2 在 app.js 中新增 thin helper 获取 `AnnotationGeneratedResultStore` / `AnnotationClickResolver` / `AnnotationGenerationStorage`
- [x] 3.3 在 app.js 中新增当前 annotation generation scope helper，复用现有 audioKey / documentId 语义，不创建第三套身份
- [x] 3.4 新增 `refreshGeneratedAnnotationIndexForCurrentDocument()` 或等价 thin wiring：通过 storage seam loadBundle 并调用 store.indexBundle
- [x] 3.5 在 transcript/session restore、字幕/切分数据建立后，安排一次 generated index restore；scope 变化时清理或重建 index
- [x] 3.6 在 `startAnnotationGenerationFromEntry()` 结束后，只要 storage 中已有可恢复的 generated bundle，就刷新 generated index；complete 与带可用结果的 partial-failed 都应覆盖
- [x] 3.7 为 restore 和 generation completion refresh 增加 scope guard 或 request token；若异步返回时当前页面 scope 已变化，则不得覆盖当前 generated index

## 4. 接入点击 resolver

- [x] 4.1 修改 `resolveAnnotationBubbleForSpan(span)` 的最小接线：先调用 generated click resolver，hit 时返回 generated normalized annotation
- [x] 4.2 保留现有 `vocabMatchMap.get(wordIndex)` 和 `normalizeAnnotationBubbleHit(...)` 路径作为 fallback
- [x] 4.3 保持 `notifyAnnotationBubbleWordClick(span)` 的 bubble-visible gate；bubble hidden 时不做显示更新
- [x] 4.4 保持 transcriptContainer click handler 中 audio seek、`forceUpdateUI(...)`、chunk selection、notify 调用顺序不变
- [x] 4.5 generated 接线不得改变现有 `normalizeAnnotationBubbleHit(...)` 对 legacy vocab hit 的字段语义、优先级和显示结果

## 5. 验证

- [x] 5.1 `node --check` 通过所有新增 bridge modules、generation modules、bubble module、entry UI、app.js
- [x] 5.2 单元式 smoke：store indexBundle 后可按 generated item 的 markedText / boundary 查询，并返回标准 bubble fields
- [x] 5.3 单元式 smoke：resolver miss 时返回 null，不抛异常，不读 storage
- [x] 5.4 浏览器 smoke：同页点击 `生成全文注释` 完成后，generated index 刷新；打开 bubble，点击已生成 target，bubble 显示 generated annotation
- [x] 5.5 restore smoke：刷新/重开同一 audio/document 后，通过 storage seam 恢复 generated index；无需重新生成即可点击显示
- [x] 5.6 fallback smoke：清空 generated index 或点击非 generated word 时，legacy vocabMatchMap 路径和普通 audio seek 仍保持
- [x] 5.7 隔离 smoke：bubble UI/drag/resize/hotkey 不变；API generation pipeline、entry status UI、播放高亮、chunk note、sentence note、cloze 路径不变
- [x] 5.8 回归确认：点击时不调用 `AnnotationGenerationStorage.loadBundle(...)`，仅使用内存 store/resolver
- [x] 5.9 歧义 smoke：同一 clicked word 命中多个 generated candidates 且无法按优先级唯一决策时，resolver 返回 null，legacy fallback 仍可继续
- [x] 5.10 并发/scope smoke：在 A scope 生成未完成时切换到 B scope，A 的异步完成不得污染 B 的 generated index
