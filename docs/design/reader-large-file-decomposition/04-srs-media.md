# R4：集中 SRS 媒体与整句翻译生命周期

状态：待R2独立PASS，且第5项确认SRS/对应媒体与翻译功能保留。施工/自检估计2–3小时，独立复审另计。必读[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)及已完成的[A续修独立报告](C:/Users/0/AppData/Local/Temp/reader-srs-media-A-independent-review-20261003-e379c684/review.md)。

## 1. 本轮结果

SrsReviewPage 的 template、评分/答案流程、历史与快捷键UI继续留在页面；词发音/来源音频/播放段序列/异步活跃代和翻译恢复分别由 focused composable拥有。保留已验收的退出作废、同卡重开、旧成功/失败/finally隔离及缓存语义，不能拆分时丢掉A修复。

只拆媒体与翻译，不顺带重做评分队列、卡规划、词库迁移、快捷键系统或layout逻辑。

## 2. 文件范围与消费者

产品：E:/read-web-next-optimization/src/features/srs-review/SrsReviewPage.vue 的script；新增同目录 use-srs-review-media.js 与 use-srs-review-answer-translation.js。

media：prepareCurrentCardMedia、loadReviewSourceForCurrentCard/sourceReadyPromise、词音频prefetch与sequence、playWord/playTarget/paragraph、URL/音频释放与phase/error。translation：hydrate/current sentence/cache/loading/unavailable，与同一media活跃代/卡/句身份的有效写回条件。

页面消费显式 refs与操作；media获得current card/word/source selector/audio DOM refs，translation获得current card/answer/source-ready及显式当前代判断。两个模块不能各建一套active/generation或从页面私有字段偷状态。既有 srs-review-playback/pronunciation/source-selector/flow/queue/policy/useSrsReview 保持原实现。

检查：scripts/srs-review-check.cjs、srs-review-ui-v2-check.cjs、srs-review-media-lifecycle-browser-check.mjs 最小同步实现归属和实际依赖staging。media fixture 的A4 seam如路径迁移，改为拦截真实新media依赖，仍只合成两个发音URL，不能重写生命周期代码。原template/CSS/App字节保持；同目录已在Tailwind @source覆盖，无需重写CSS。

## 3. 顺序

1. 保存当前A已独立PASS源码为opening；列audioRequest/playbackStatusRequest/translationRequest与sourceReadyPromise的所有写点、watcher和消费者。
2. 先迁移media完整状态/prepare/play/stop/release。页面保留明确activate/deactivate及card/word watcher的调用顺序，不在两个模块重复注册watch或DOM事件。
3. 确保prepare在首个await前安装本代sourceReadyPromise；active=false/卡切换/unmount使旧media写回和autoplay无效，旧URL只能按当前释放规则处理。
4. 再迁移translation cache/请求/状态：退出结束loading并作废旧请求；已展开答案同卡activate等待本代来源后恢复；有效失败可真实重试；旧catch/finally不影响新代。
5. 页面activate：media开始本代prepare（autoplay:false）后恢复已展开翻译；正常reveal watcher继续工作；不通过翻转answerRevealed强行触发。
6. 接回template refs/native audio events/manual playback/评分后的停止，保持现行手动与自动播放策略、剪辑起止和maxDuration。
7. 更新检查真实依赖，完整A1–A4九场景和T1–T4四场景，再做可见页生产样式/操作对照后交接。

## 4. 固定验收 R4-A1–A7

| 标准 | 必须达到 |
| --- | --- |
| A1 一个活跃代 | media/request状态只有一个所有者，translation消费同代许可，不复制generation或重复watch。 |
| A2 原九媒体场景 | close recorded/fallback、late source close/unmount、switch/reopen/normal replay+sentence+rating、multi-clip close/unmount全部通过。 |
| A3 原四翻译场景 | 旧响应在关闭期间、新成功先返回、有效失败+旧失败+真实重试、已完成cache重开全部通过，响应body已消费后再断言。 |
| A4 正常流程 | 答案/目标句/上下文、手动发音/原句、评分与推进保持；未展开答案不提前翻译，重开不自动词播放。 |
| A5 资源 | 真正unmount释放URL/事件，旧回调不重启播放/改变phase，失败可恢复无永久loading。 |
| A6 UI | template/CSS/布局/快捷键入口与固定light皮肤保持；回答、loading、unavailable状态及评分focus可达。 |
| A7 完整记录 | 原两项focused与新完整browser、语法/diff通过；staging加载真实新模块，hash/日志/截图/回滚齐备。 |

## 5. 必要验证

- npm.cmd run verify:srs-review
- npm.cmd run verify:srs-review-ui-v2
- npm.cmd run verify:srs-review-media-lifecycle-browser（完整13场景）
- npm.cmd run verify:srs-review-policy-planner
- npm.cmd run verify:vocabulary-srs
- source/pronunciation/playback 的必要行为由上述完整focused与13场景共同验收；施工如发现它们遗漏一个实际迁移分支，先在开工消费表列明有限补充场景再实施，不在复审时临时追加未知检查。
- fresh生产App入口“今日复习”→show answer→词/原句→评分→close/reopen一条真实UI旅程，API与媒体明确可合成。
- 共同静态门禁。

focused原脚本若只复制旧单文件，扩展它真实新模块的staging/rewrite，不改业务实现求通过。13场景不得只跑T或前三个close项。原评分latency历史NOT_RUN保留，不将它新增为本轮门槛；正常评分由原A3和可见UI旅程覆盖，不设新性能预算。

样式对照1280×800与390×844，前后同生产CSS/数据的未揭示、已揭示、翻译失败、历史展开、关闭focus代表状态。单组件fixture没有全局productionCSS时，只作功能证据。

## 6. 交接与回滚

交接所有者状态图、页面调用顺序、A旧修复到新函数映射、13场景原结果与新hash、R4-A1–A7。回滚恢复本轮opening的页面，再反向新增模块/staging，不回滚A修复。移到新文件行数降低但仍复制状态时不予验收。

