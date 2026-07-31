## 1. 独立页面与样本

- [x] 1.1 运行并记录 `npm run verify:vocabulary-srs`、`npm run verify:vocabulary-preview` 和 `npm run build` 基线，确认现有 SRS service 可复用。
- [x] 1.2 通过只读 IndexedDB 操作取得用户当前 `vocabulary.srs.store.v1` 的 `row.content`，保存为 gitignored 的 `src/features/srs-review/srs-review.sample.local.json`，不得提交个人样本。
- [x] 1.3 创建 `srs-review.html` 和 `src/srs-review-main.js`，使用 sample + `createInMemoryVocabularyRepository()` 挂载独立页面；此阶段不修改 `src/App.vue`、`index.html` 或 reader runtime。

## 2. 核心复习页面

- [x] 2.1 实现 `useSrsReview.js`：调用 `getDueWords()` 建立固定 queue，维护 index、pending 和 error，并映射 `容易 -> easy`、`一般 -> good`、`忘记 -> again`。
- [x] 2.2 实现评价提交保护：pending 时禁用三个按钮，`reviewWord()` 成功后才进入下一词，失败时停留当前词并允许重试。
- [x] 2.3 实现单文件 `SrsReviewPage.vue`：顶部来源和进度、左侧原文语境、右侧单词/音标/释义、底部三个等宽评价按钮，以及 loading、empty、error、completed 状态。
- [x] 2.4 实现 `srs-review.css` 的平衡双栏和窄屏堆叠；确保页面不出现笔记、重复播放、重复原句、底部提示、设置、更多信息、退出复习或额外统计。

## 3. 简单语境与音频

- [x] 3.1 实现 `srs-review-context.js`：选择最近有效 context，将 `surrounding_text` 分成最多三段，并高亮目标 sentence 和单词；缺少字段时直接隐藏。
- [x] 3.2 当 `source_id` 可用时，只读获取 transcript 和 audio，并用规范化相等或包含匹配定位原句；匹配失败或服务离线时隐藏 audio bar，不阻塞评价。
- [x] 3.3 使用独立 audio element 播放匹配语境，切词或离开页面时停止并释放 object URL；单词 speaker 直接使用 `speechSynthesis`，不可用时禁用。

## 4. 接入与验收

- [x] 4.1 新增 `scripts/srs-review-check.cjs` 和 `verify:srs-review`，覆盖 due queue、三档映射、重复点击、失败重试、空状态、完成状态和 text-only fallback。
- [x] 4.2 在 `1440 x 1024` 下将独立页面与选定第 1 版样稿对比，修正布局、字号、间距、按钮顺序和内容裁切。
- [x] 4.3 独立页面通过后，在 `index.html` 增加空入口挂载点，并在 `src/App.vue` 通过 Vue `Teleport` 增加 `今日复习` 按钮和 full-screen overlay；live 页面直接使用默认 `createVocabularyService()`。
- [x] 4.4 验证打开和返回不会清空当前文章或刷新页面，并运行 `npm run verify:srs-review`、`npm run verify:vocabulary-srs`、`npm run verify:vocabulary-preview`、`npm run build` 和 `npm test`；最后更新 `README.md` 与 `PROJECT_MAP.md` 的入口和存储说明。

## 5. 稳定今日数量与复习日志

- [x] 5.1 使用本地自然日结束时间建立今日队列，并通过当天 `reviewLogs` 保持“已完成 + 剩余”的总数在重新进入后稳定。
- [x] 5.2 在右上角增加轻量“复习记录”弹层，按日期汇总唯一单词数，并补充专项回归与浏览器验证。

## 6. 五档记忆评价与快捷键

- [x] 6.1 将评价扩展为 `忘记 / 困难 / 一般 / 容易 / 掌握`，确保第五档原子写入 review log 和已掌握排程，并补充专项回归。
- [x] 6.2 在五个按钮上显示数字 `1-5`，加入键盘快捷键保护，并完成浏览器与完整回归验证。

## 7. 精简释义、回顾导航与播放控制

- [x] 7.1 主释义优先使用 `simple_meaning`，删除提示区，并增加回归覆盖。
- [x] 7.2 增加只读上一张/下一张导航、方向键映射和防重复评分回归。
- [x] 7.3 增加单词与原句连续播放按钮、空格暂停/继续，并完成浏览器和完整回归验证。

## 8. 隐藏暂停行为与重读快捷键

- [x] 8.1 将空格暂停/继续保留为无 UI 的隐藏键盘行为，并在重读按钮显示 `R` 快捷键，支持 `R/r` 从头重读单词和原句。

## 9. 逐词播放与全局音频快捷键

- [x] 9.1 左侧原文支持点击英文单词后从其时间戳播放或朗读剩余句子；`R` 与空格改为捕获阶段全局快捷键，并完成专项、浏览器与完整回归验证。

## 10. 逐词视觉、快捷键自定义与释义分层

- [x] 10.1 移除逐词按钮视觉并保留轻微悬停放大；增加可持久化且大小写不敏感的重读快捷键编辑；将现有释义标为句中释义并预留独立常用释义字段，完成专项、浏览器与完整回归验证。

## 11. 逐词元素修正、辅助控制弱化与通用释义缓存

- [x] 11.1 将左侧逐词点击目标从 `button` 改为普通内联 `span`，从根源隔离阅读器全局按钮样式；将重读与快捷键编辑移至右侧面板边缘并降低视觉权重。
- [x] 11.2 复习打开时批量请求缺失的 Merriam-Webster Collegiate 英文通用定义，使用已保存的 Gemini 凭据批量翻译为精简中文，并将结果永久写回现有 vocabulary snapshot；完成服务、专项、构建和浏览器持久化验证。

## 12. 词典同形词消歧与释义视觉层级

- [x] 12.1 跟随 Merriam-Webster 拼写交叉引用并排除地名/人名词条，通过缓存来源版本自动刷新旧错误释义；常用释义使用黑色主信息，句中释义使用灰色次信息，并完成服务、专项、构建和浏览器验证。
