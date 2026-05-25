## Context

当前已经存在四个相邻但尚未闭合的部分：

```text
annotation generation pipeline
  -> AnnotationGenerationStorage
  -> annotation.generated.json 语义 bundle

annotation bubble
  -> AnnotationBubble.setAnnotation(annotation)
  -> 只显示 markedText / boundary / type / meaning / memoryHint

current click wiring
  -> transcriptContainer click
  -> audio seek / forceUpdateUI
  -> notifyAnnotationBubbleWordClick(span)
  -> resolveAnnotationBubbleForSpan(span)

legacy resolver source
  -> vocabMatchMap.get(wordIndex)
```

断点是：`annotation.generated.json` 已能写入 `AnnotationGenerationStorage`，但 `resolveAnnotationBubbleForSpan(span)` 不知道 generated bundle，也没有 generated results 的内存索引。

本 change 要加的是“读取/索引/点击查询”的桥。它不拥有 bubble DOM、不启动生成、不调 provider、不改变 word click seek。

## Goals / Non-Goals

**Goals:**

- 新增 generated result store/index，把 generated bundle 中的 items 转成内存索引。
- 新增 click resolver，基于 clicked word span / word index / reader words 查询 generated annotation。
- app.js 在初始化 / transcript load / generation complete 后触发 generated index restore/refresh。
- 点击已生成的标注词时，bubble visible 的情况下显示 generated annotation。
- generated resolver miss 时继续使用旧 `vocabMatchMap` 路径。
- 点击时只做内存查询，不做 storage/file/localStorage 读取。

**Non-Goals:**

- 不修改 `annotation-bubble.js` 的 DOM、样式、drag、resize、hotkey。
- 不修改 API provider、prompt builder、block planner、generation orchestration。
- 不新增手动导入 `annotation.generated.json` UI。
- 不新增正文 inline annotation、右侧 panel、历史列表。
- 不删除或替换 `vocabMatchMap`。
- 不改变普通点击词的 audio seek、播放高亮和句/块选择行为。

## Decisions

### Decision: generated results 先进入独立 store/index，不进入 bubble

新增建议模块：`annotation-generated-result-store.js`。

职责：

```js
window.AnnotationGeneratedResultStore = {
  clear(),
  indexBundle(bundle, scope),
  getScope(),
  getItems(),
  query(query)
}
```

`indexBundle(bundle, scope)` 接收 `AnnotationGenerationStorage.loadBundle(scope).generated` 或等价 generated JSON，标准化 `items`，并建立多种查询结构。

不把 store 写进 `annotation-bubble.js`，因为 bubble 是显示端；未来可能换成侧栏、popover、快捷预览，都应该复用同一 store/resolver。

### Decision: resolver 是独立模块，app.js 只提供 reader adapter

新增建议模块：`annotation-click-resolver.js`。

建议 API：

```js
window.AnnotationClickResolver = {
  resolveClick({
    span,
    wordIndex,
    words,
    generatedStore
  })
}
```

resolver 返回：

```js
{
  markedText,
  boundary,
  type,
  meaning,
  memoryHint
}
```

如果查不到，返回 `null`。app.js 收到 `null` 后继续旧 `vocabMatchMap` fallback。

### Decision: 点击时禁止 storage 读取

restore/refresh 时机负责读 storage：

```text
load transcript / restore session / generation complete
  -> loadBundle(scope)
  -> GeneratedResultStore.indexBundle(...)

word click
  -> AnnotationClickResolver.resolveClick(...)
  -> pure memory lookup
```

原因：点击在播放和高亮路径里，任何异步读文件 / storage 都可能造成迟滞、乱序或点击后内容闪烁。

### Decision: scope 必须跟 generation context 对齐

generated bundle 的 scope 使用同一组 identity：

- `audioKey`
- `documentId`

app.js 应复用它已有的 generation document context / current identity，而不是给 resolver 造第三套 key。

如果当前 audio/document scope 改变，store 必须 clear 或 re-index，避免 A 音频的解释显示在 B 音频上。

### Decision: 第一版匹配键以 generated item 的文本/边界为核心

当前 generated items 还没有落回 transcript word index。第一版 index 可以建立这些键：

- item id / targetId / blockId 元数据索引，用于调试和未来扩展。
- `markedText` normalized token index。
- `boundary` normalized phrase index。
- 可选：在 restore/index 阶段，用当前 reader `words` 预计算 phrase -> wordIndex 命中表。

推荐第一版 resolver 策略：

1. 从 clicked span 读 `data-word-index` 和文本。
2. 从 `words[wordIndex]` 取得当前 word 和相邻 small window。
3. 在 store 的预计算 wordIndex index 中查精确命中。
4. 若没有预计算 index，用 clicked normalized word 查询候选。
5. 对候选用 `markedText` tokens + `boundary` tokens 与 clicked word window 做局部校验。
6. 返回最可信候选；没有足够证据时返回 `null`，交给 `vocabMatchMap`。

这比“任何同名词都显示同一解释”更安全，但仍是小步实现。若未来 generated result 直接包含 start/end/globalIndex，可优先使用这些强定位字段。

### Decision: generated-first, vocab fallback

`resolveAnnotationBubbleForSpan(span)` 的优先级：

```text
generatedResolver hit
  -> normalize generated annotation
  -> return

legacy vocabMatchMap hit
  -> normalize legacy annotation
  -> return

otherwise
  -> null
```

这让新生成的 annotation 立即覆盖 mock/visual/vocab 类旧解释；同时没有 generated 命中时旧导入词库/视觉助手仍能工作。

### Decision: 生成完成后 refresh，不耦合 controller 内部

最小方案是在 `startAnnotationGenerationFromEntry(...)` 收到 controller result 或 complete/partial-failed status 后调用一个 app.js thin function，例如：

```js
await refreshGeneratedAnnotationIndexForCurrentDocument();
```

不建议让 `AnnotationGenerationController` 直接 import / call click resolver。generation backend 应保持 display/click-agnostic。

如果后续要更实时，可以让 controller callback 的 status 中携带 `generatedUpdated: true` 或 block complete 事件，再由 app.js integration 层决定刷新。

## Risks / Trade-offs

- [Risk] generated item 没有 wordIndex，点击匹配可能对重复词不够准确。
  - Mitigation：resolver 同时使用 `boundary` / clicked local window；不确定时返回 null；后续 change 可在 generation result 加 sentence/source coverage。

- [Risk] 在每个 click 时做 phrase matching 会影响“跟手”。
  - Mitigation：restore/refresh 阶段预计算 index；click path 只查 Map 和小窗口候选。

- [Risk] generation storage 当前可能是 `localStorage-fallback`，未来是 audio-folder；reader 需要统一读取。
  - Mitigation：只通过 `AnnotationGenerationStorage.loadBundle(scope)` 读取；不要在 app.js 拼 localStorage key。

- [Risk] 生成完成后马上刷新可能与 storage flush 竞争。
  - Mitigation：controller result 返回后再 refresh；block-level 实时刷新要等待 callback 明确表明 block flush 完成。

- [Risk] 新 resolver 如果写进 app.js 会继续扩大 app.js。
  - Mitigation：app.js 只负责 scope/context adapter、调用 store/loader、调用 resolver；匹配和标准化留在新模块。

## Migration Plan

1. 新增 `annotation-generated-result-store.js`，可 index/clear/query generated bundle。
2. 新增 `annotation-click-resolver.js`，只做内存索引查询和 annotation normalize。
3. 在 `read-26.html` 中将两者放到 generation storage/controller 之后、entry UI / app.js 之前，或在 app.js 之前加载。
4. 在 app.js 建立 current generation scope helper，复用 `audioKey/documentId`。
5. 在 transcript load / restore session 后尝试 `loadBundle(scope)` 并 index generated items。
6. 在 `startAnnotationGenerationFromEntry()` 完成 controller result 后刷新 generated index。
7. 修改 `resolveAnnotationBubbleForSpan(span)`：generated-first，legacy fallback。
8. 用 mock generated bundle 验证：同页生成后可点击 bubble；刷新页面/恢复同一 transcript 后可点击；没有 generated 命中时旧 vocabMatchMap 路径仍返回。

## Open Questions

- 未来真实 API 是否会返回 start/end/globalIndex/sourceSentenceId？如果会，resolver 应优先用强定位字段。
- 生成结果是只有 `** **` target，还是后续会生成 boundary 中的多词短语？这会影响 click 命中范围：只点 target 单词显示，还是点 boundary 内任一词显示。
- audio-folder directory handle 何时接入？本 change 应通过 storage seam 读取，避免提前绑定到某种持久化实现。
