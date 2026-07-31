## Context

现有 SRS 底层已经足够使用：

- `vocabulary-models.js` 保存单词、语境、排程状态和复习日志。
- `vocabulary-repository.js` 将快照保存在 `SeekPlayerDB/files/vocabulary.srs.store.v1`。
- `srs-scheduler.js` 已使用 `ts-fsrs`。
- `vocabulary-service.js` 已提供 `getDueWords()` 和 `reviewWord()`。
- `verify:vocabulary-srs`、`verify:vocabulary-preview` 和 `npm run build` 当前通过。

因此本次不建设新的 SRS 平台，只为个人使用补一个页面和入口。

## Goals / Non-Goals

**Goals:**

- 能找到已经加入词库的单词。
- 能按到期顺序逐个复习。
- 使用五个带数字提示的按钮完成评价，并支持键盘 `1-5`。
- 独立开发期间不影响阅读器和真实排程。
- 完成后以最少改动接入阅读器。

**Non-Goals:**

- 不做卡组、账号、云同步、统计大盘或多用户并发。
- 不重构 IndexedDB repository，不处理多标签页同时写入。
- 不增加 AI 生成、笔记、词典和复杂设置。
- 不保证每个历史单词都能恢复原文音频。
- 不修改 IndexedDB schema 或 `reader-runtime.js`、`session-init.js`。

## Decisions

### 1. 保持文件结构简单

建议实现结构：

```text
srs-review.html
src/srs-review-main.js
src/features/srs-review/
├── SrsReviewPage.vue
├── useSrsReview.js
├── srs-review-context.js
├── srs-review.css
└── srs-review.sample.local.json  # gitignored
scripts/srs-review-check.cjs
```

不拆分多个 Vue 子组件、adapter 层或独立 Vite 配置。`SrsReviewPage.vue` 负责页面结构，`useSrsReview.js` 负责队列和评价，`srs-review-context.js` 负责上下文与可选音频。

### 2. 独立页面先使用真实词库副本

通过浏览器只读读取一次 `vocabulary.srs.store.v1`，将 `row.content` 保存为 gitignored 的 `srs-review.sample.local.json`。开发时使用 `createInMemoryVocabularyRepository(sample)` 创建 service；评价只改变内存副本，刷新页面即恢复。

不制作 exporter UI，不增加 fixture/live 模式系统。`srs-review-main.js` 在 sample 存在时使用 sample；专项检查使用一个很小的 synthetic snapshot。

### 3. 复习流程直接复用现有 service

```text
getDueWords(now)
  -> 显示 queue[0]
  -> 用户选择评价
  -> reviewWord(wordId, rating)
  -> 成功后显示下一词
```

会话只维护 `queue`、`index`、`pending` 和 `error`：

- queue 在打开页面时加载一次。
- 没有到期词时显示“今天没有待复习单词”。
- 最后一词完成后显示“今日复习完成”。
- rating pending 时禁用五个按钮，防止重复日志。
- 写入失败时停留在当前词，恢复按钮以便重试。

五档映射写在 `useSrsReview.js` 的单一常量中：

| 快捷键 | 文案 | service 行为 |
|---|---|---|
| 1 | 忘记 | `REVIEW_RATINGS.AGAIN` |
| 2 | 困难 | `REVIEW_RATINGS.HARD` |
| 3 | 一般 | `REVIEW_RATINGS.GOOD` |
| 4 | 容易 | `REVIEW_RATINGS.EASY` |
| 5 | 掌握 | 原子执行 `REVIEW_RATINGS.EASY` 并写入 `KNOWN` 状态 |

### 4. 页面采用一个组件实现平衡双栏

`SrsReviewPage.vue` 按选定样稿实现：

- 顶部：返回、`今日复习`、来源标题、`复习 N / Total`。
- 左侧：最近 context 的 `surrounding_text`，最多分成三段；目标 sentence 和单词高亮。
- 左侧底部：仅在音频可恢复时显示一个 audio bar。
- 右侧：speaker、word、可选 phonetic、meaning、可选 usage hint。
- 底部：`1 忘记`、`2 困难`、`3 一般`、`4 容易`、`5 掌握`，从左到右排列。

不显示 note、重复原句、顶部播放按钮、底部提示、设置、更多信息、退出复习或大型统计卡片。字段不存在时直接隐藏，不显示空面板。右上角允许提供一个轻量的“复习记录”弹层，只按本地日期显示当天复习过的唯一单词数。

今日队列使用本地自然日结束时间作为 `getDueWords()` 截止点，并与当天已有 `reviewLogs` 合并。当天已经复习过的单词不再次进入初始队列，进度分母固定为“当天已完成的唯一单词 + 当天剩余队列”，因此关闭后重新进入不会缩小。

右侧释义按 `context.simple_meaning -> word.meaning -> context.meaning` 选择，确保加入 SRS 时生成的精简释义覆盖文章背景型释义；不再渲染独立 usage hint。

会话同时维护只增不减的评分 `index` 和可前后移动的 `viewIndex`。上一张只进入只读回顾状态，五个评分按钮禁用；下一张最多回到当前待评分卡，不能跳过未评分卡。界面显示左右箭头，键盘左/上与右/下执行同样导航。

右栏提供“R 重读单词和原句”按钮，复用现有单词录音与原句音频顺序播放；按 `R` 也从头重读。`R` 和空格在复习页的捕获阶段全局处理，不受按钮、原文、音频控件或其他焦点元素影响。空格键暂停当前单词、原句或系统语音，再按一次继续，但不显示空格提示或暂停状态 UI。

左栏将英文单词渲染为轻量内联点击目标。转录含 `segment.words[].start/end` 时，点击单词从对应原声时间开始并播放到该段结束；缺少逐词时间戳或原声音频时，使用美式系统语音朗读从该词起的剩余句子。

逐词点击目标不得显示按钮底色、边框或阴影，普通状态与正文一致；鼠标悬停或键盘聚焦时只做轻微放大。

重读按钮右侧键帽是独立的快捷键编辑入口。点击后捕获下一个可用单字符键，排除空格与评分键 `1-5`，保存至 localStorage；字母匹配统一转为小写，因此大小写均可触发。

释义拆为两类：`context.simple_meaning -> context.meaning -> word.meaning` 只作为“句中释义”；`word.general_meaning / word.dictionary_meaning` 作为未来可选的“常用释义”。现有 `word.meaning` 来源于首次上下文，不得冒充通用词典义。本轮不新增词典请求。

speaker 直接调用浏览器 `speechSynthesis`；不可用时禁用，不单独建立 pronunciation service。

### 5. 音频只做简单匹配

`srs-review-context.js` 的行为限制为：

1. 总是先从存储的 sentence 和 surrounding text 生成文本语境。
2. 有 `source_id` 时，可通过现有 `youtubeWorkflowClient` 只读取得 transcript 和 audio。
3. 对原句只做大小写、空格和标点规范化后的相等或包含匹配。
4. 匹配成功才显示 audio bar；失败、来源丢失或服务离线时隐藏 audio bar。
5. 使用独立 audio element，不调用 `loadJobIntoReader()`，不改写当前 reader 的 audio/transcript/chunkData。
6. 切词或离开页面时暂停音频并释放当前 object URL。

不做模糊评分、跨多个来源缓存、复杂 abort 管线或音频预加载。

### 6. 验证完成后再接入

独立页面通过后：

- 在 `index.html` 的学习控制区增加一个 `#srs-review-entry-root` 挂载点。
- 在 `src/App.vue` 用 Vue `Teleport` 放置一个 `今日复习` 按钮。
- 打开时将同一个 `SrsReviewPage.vue` 作为全屏 overlay，并改用默认 `createVocabularyService()` 读写真实词库。
- 返回时关闭 overlay、停止 SRS 音频并回到原阅读界面，不刷新页面。

不增加 `window.__srs*`、新 runtime assembly 或 feature flag 系统。

## Risks / Trade-offs

- [Risk] 历史 context 没有 `source_id` 或素材文件已删除。 → 显示文本语境，隐藏音频，复习仍可进行。
- [Risk] 快速重复点击产生多条日志。 → pending 时立即禁用五个按钮。
- [Risk] 用户 sample 含个人来源信息。 → 文件 gitignore，不提交版本库。
- [Risk] 新入口影响日常阅读。 → 页面先独立完成；最终只增加一个按钮和 overlay，回归失败可直接移除入口。
- [Trade-off] 不处理多标签页并发写入。 → 这是个人单机使用的合理简化，默认一次只在一个页面操作词库。

## Migration Plan

1. 从用户真实词库读取一份本地 sample，完成独立页面和核心检查。
2. 完成双栏 UI、五档评价和简单音频 fallback。
3. 独立页面验收通过后接入 `今日复习` 入口。
4. 运行现有 build、vocabulary checks 和一个新增 SRS smoke check。

回滚只需移除 `src/App.vue` 中的 SRS 页面挂载和 `index.html` 的入口挂载点；没有数据库迁移。

### 7. 常用释义使用现有词库快照永久缓存

复习页在 due queue 加载完成后启动非阻塞批量补全，只处理没有
`general_meaning` 的词。浏览器每批最多发送 50 个词到本地 workflow
service；服务复用系统凭据中的 Merriam-Webster Collegiate Key 获取
`shortdef`，再使用系统凭据中的 Gemini Key 将整批英文定义翻译成精简中文。

返回结果通过 `vocabulary-service.cacheGeneralMeanings()` 写入现有
`vocabulary.srs.store.v1` row content，字段为 `general_meaning`、
`dictionary_definition`、`dictionary_source` 与 `dictionary_fetched_at`。
这只是现有 JSON 内容扩展，不提高 IndexedDB version，也不新增 object
store。后续会话先检查持久化字段，命中时不再调用词典服务。批量失败只影响
常用释义补全，不阻塞句中释义、音频或评分。

### 8. 词典交叉引用与缓存版本

Merriam-Webster 对英美拼写变体可能返回没有 `shortdef` 的交叉引用，例如
`centre -> center`，后续结果还可能混入 `Rockville Centre` 之类地名。
服务只接受查询词自身 ID、headword 或 stems 匹配的普通词条；精确词条只有
spelling cross-reference 时再查询目标基础词，并排除 geographical name 与
biographical name。

解析结果的 `dictionary_source` 使用
`merriam-webster-collegiate+gemini:v2`。前端只将旧 Merriam/Gemini 来源视为
过期并重新补全，人工或其他来源的通用释义不受影响。旧结果在刷新成功前不再
显示，避免服务额度不足时继续暴露错误释义。

释义视觉层级固定为“常用释义优先、句中释义辅助”：常用释义值使用黑色和
较高字重，句中释义值使用灰色和略低字重。
