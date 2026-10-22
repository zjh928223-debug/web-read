# A 线续修：翻译重开回归与媒体验收补齐

日期：2026-10-03。执行对话：**A · SRS 媒体退出修复**。
模型与推理：沿用该对话的 GPT-6.1-sol / high。
工作区：`E:/read-web-next-optimization`，项目本地执行，无 worktree。

本文件是可直接施工的续修任务说明。用户已明确指示：“你给出A的详细修复内容，让A去实现”。这构成对 A 原两次失败停点的直接续修授权。当前 B、C 均 completed/idle；本轮 A 获得独占产品写入窗口，父对话仅调度和随后独立审查，不与 A 同时编辑产品。

目标：修复独立复审确认的翻译状态回归，修复媒体测试的卸载入口，完整执行原 A1–A6 验收及本文追加的翻译回归用例。不得以部分通过替代整线完成。

## 1. 必读材料与现状

- [本轮独立复审](C:/Users/0/AppData/Local/Temp/reader-abc-independent-review-20261003-4c72d518/review.md)。
- [翻译回归证据](C:/Users/0/AppData/Local/Temp/reader-abc-independent-review-20261003-4c72d518/translation-reopen-evidence.json)。
- [独立复现脚本](C:/Users/0/AppData/Local/Temp/reader-abc-independent-review-20261003-4c72d518/translation-reopen-probe.cjs)。
- [原 A 施工交接](C:/Users/0/AppData/Local/Temp/reader-srs-media-A-20261003-10854494/handoff.md)及该目录的 acceptance.txt、opening/closing、原两轮 FAIL 日志。
- 当前 [AGENTS.md](E:/read-web-next-optimization/AGENTS.md)，以当前文件为准。

已独立确认的产品问题：显示答案后整句翻译挂起 → 返回阅读器 → 旧翻译返回 → 重开同卡，页面一直显示“正在生成整句翻译…”。请求返回后 translationRequests=1、loading=true、unavailable=false，无新请求或重试入口。

原因：`deactivateReviewPage()` 新增 `translationRequest += 1`，旧请求的写回和 finally 都被作废，但 sentenceTranslationLoading 未结算。KeepAlive 重开同卡不改变 answerRevealed；activate 仅恢复媒体，翻译 watcher 不会重新触发。

测试问题：夹具 #unmount 与产品 overlay 同为 z-index:10000，按钮被遮罩挡住。原新媒体测试前三个子项通过，第四项失败；A3/A4 后续未执行。失败是夹具入口不可达，尚未证明产品卸载回归。

B/C 的限定改动已通过父对话独立复审。A 的续修不需要重做 B/C 清理；B 的补充旅程及 C 原执行侧身份脚本 FAIL 保留，不由 A 接管。

## 2. 精确文件边界

| 文件 | 允许修改的内容 |
| --- | --- |
| `src/features/srs-review/SrsReviewPage.vue` | script 内翻译退出结算、同卡激活恢复、异步旧代保护；仅在完整原验收发现与原 A 媒体修复直接相关的确定问题时补充最小修正 |
| `scripts/srs-review-media-lifecycle-browser-check.mjs` | 独立卸载按钮可达性；合成翻译响应与请求控制；新增本文 T1–T4；为完成原 A1–A4 而修正明确的夹具缺陷，不降低原断言 |

其它产品文件、模板、CSS、App.vue、Pinia/runtime、后端、schema、依赖、package/lock、inventories 和 B/C 文件均不在本轮写入范围。两项旧 SRS focused 检查应保持原字节，不为迁就实现改断言。

本任务文档由父对话维护。A 的新交接、增量 patch 和日志写入新的独有 Temp 目录，保留原目录和全部原失败证据。现有正式媒体命令已经注册，无需新增命令或更新 inventory。本文的测试用例直接合入已有媒体测试，不新增测试框架。

## 3. 按顺序施工

### 第一步：保存续修 opening

以**当前已汇合 A/B/C 的源码**为本轮 opening，不使用原 A 施工之前或 HEAD 的快照覆盖当前成果。保存两项允许编辑文件及两项旧检查的 raw bytes、SHA256/bytes、git status 和相关 diff。顺手记录 package/lock、App.vue、SRS CSS 的哈希，最终确认未改即可；不新增复杂证据验证器。

本轮 opening 应包含原 A 的 mediaActive、audioRequest/statusRequest 活跃检查和 B/C 成果。保留原 dirty 及 WhisperX/language-processing 工作。

### 第二步：修复翻译生命周期

建议采用“退出结算 + 同卡激活时按需重新加载”的最小方案，复用现有 translationRequest、卡 ID、缓存及 sourceReadyPromise。可在同文件提取小 helper，但不引入新的状态系统、通用取消框架或组件拆分。

1. **退出时继续作废旧请求**。保留 mediaActive=false、audioRequest/statusRequest/translationRequest 递增及音频释放；不能删除 translationRequest 作废语句来躲过加载悬挂。
2. **退出时结算被取消的加载状态**。至少将 sentenceTranslationLoading 复位，不留下永久 loading。不应重置整张卡的 answerRevealed、评分/进度，也不要丢弃已完成的同卡翻译与有效缓存。
3. **同卡激活时恢复已展开答案的翻译**。在 active、有 current card、非 deferred 的有效会话中，若答案已展开，恢复翻译。应先发起本代来源音频/上下文准备，确保 hydrate 等待的是新的 sourceReadyPromise，而不是退出时重置的旧 promise。
4. **保持正常显示答案路径**。原 answerRevealed watcher 继续工作；未展开答案的重开不能提前发起整句翻译。已有缓存/内嵌翻译使用现行路径，不额外请求。
5. **限制当前代回写**。在 hydrate 入口、等待来源后、翻译响应后、catch/finally 回写前核对当前 active、translationRequest、卡身份及必要的句子身份。旧成功/旧失败/旧 finally 都不能覆盖重开后新代的结果、错误或 loading，也不能在隐藏/卸载后启动新翻译。
6. **失败可以恢复**。有效新请求失败时结束 loading，显示现有 unavailable/重试 UI；真实点击重试成功后恢复翻译。不能仅隐藏 spinner 而让已展开答案失去整句翻译。

注意：不要为了触发 watcher 先把 answerRevealed 设为 false 再 true；这会改变用户已完成的卡片状态。无需为此修改评分服务、翻译 API 或通用翻译模块。当前没有要求中止后台 HTTP，本代校验足以解决本次回归；如考虑 AbortController，必须说明为什么现有请求编号不足。

### 第三步：修复独立卸载夹具

将 #unmount 的测试专用层级提升到产品 overlay 之上，例如 10001，或使用同样小且明确的夹具调整。保留普通 Playwright click，证明按钮真实可点击且 KeepAlive 容器实际卸载。

不得修改产品 z-index、使用 force:true、直接调用组件私有卸载/关闭函数、改 CSS 隐藏 overlay 或删去卸载断言。两个 unmount 场景都仍应检查组件确实从 DOM 移除、迟到来源释放、迟到回调不启动下一段播放。

### 第四步：扩展已有真实组件测试

保留原 9 个 A1–A4 场景，追加下面 4 个翻译场景。只在新翻译场景的合成 transcript/chunk 响应中省略内嵌中文，使真实产品走 sentence-translations 路径；正常原场景的合成输入保持其既有用途。

翻译请求使用真实 `/api/vocabulary/sentence-translations`，合成响应应匹配请求中的 id/sentence；用明确的 deferred/barrier 控制返回顺序，观察 response body 已消费后再检查 DOM。不要用长 sleep 猜请求已结束。

| 用例 | 实际交互与返回顺序 | 必须观察的结果 |
| --- | --- | --- |
| T1 旧请求关闭期间返回 | 显示答案 → 挂起旧翻译 → 真实返回阅读器 → 释放旧响应 → 同卡重开 → 放行有效新响应 | 旧结果不恢复隐藏 UI；重开可重新加载，最终显示新翻译且 loading=false。答案仍展开、卡未改变，重开不自动播放词音频 |
| T2 重开后的新请求先返回 | 显示答案 → 挂起旧翻译 → 关闭并重开 → 新响应先返回 → 最后释放旧成功响应 | 当前显示新翻译；旧结果及其 finally 不覆盖当前文本/状态；最终无 loading。旧/新译文刻意不同以识别覆盖 |
| T3 新代失败与真实重试 | 旧请求挂起 → 关闭并重开 → 有效新请求失败，旧失败随后返回 → 点击现有“重试” → 成功 | 新失败结束 loading，现有错误/重试 UI 可达；旧失败不污染新代；真实重试后显示译文且无永久 loading |
| T4 已完成缓存的同卡重开 | 显示答案并完成翻译 → 关闭 → 同卡重开 | 翻译/答案保留或由有效缓存恢复，不能新增无必要翻译请求；未改变卡片进度、评分或播放行为 |

每个翻译场景应检查 pageErrors、相关 console、未知请求、当前词/卡与实际显示状态。旧响应是否完成以消费屏障为准；不得把“请求仍未释放所以暂未覆盖”当作 PASS。

保持原 A 的发音多段 dependency seam：真实组件及生命周期不改写，仅 A4 合成两段发音 URL。媒体调用 probe 不证明扬声器发声；翻译测试也不证明真实 Host/在线翻译成功。

当前测试约 306 行。预期新增有限场景后仍应控制在约 500 行以内；若接近 AGENTS 警戒线，先解释必要复杂度，可把纯夹具响应数据放 Temp 或适度整理已有本地 helper，不能堆第二套产品实现或证据解析器。

### 第五步：完整验证

必须从本轮最终源码重新构建隔离真实组件 fixture，不能复用父复审或原 A 的旧 bundle 冒充新代码。

| 检查 | 要求 |
| --- | --- |
| `npm run verify:srs-review-media-lifecycle-browser` | 完整执行全部原 A1–A4 和 T1–T4，逐场景记录结果；不只跑新增用例或已通过的子集 |
| `npm run verify:srs-review` | 完整原检查，保持断言；若通过 Temp preload 改 staging 位置，准确记录实际命令与隔离范围 |
| `npm run verify:srs-review-ui-v2` | 完整原检查，保持断言，同上 |
| `node --check scripts/srs-review-media-lifecycle-browser-check.mjs` | PASS |
| `git diff --check` | PASS，原失败如有应保留 |
| 文件/模板边界 | opening→final 两文件精确增量，组件 template 字节不变、SRS CSS/App/package/lock 等无本轮变化 |

旧 rating-latency-browser 的 Temp runner 上轮在 ESM 加载前失败，仍保留原 NOT_RUN。它不是本轮新增闭环的必要项；本轮正常词重播/目标原句/评分由原 A3 完整场景验收。若另行运行旧命令，要采用 fileURL 正确加载和完整隔离，准确分列；不能让额外夹具阻断本轮已定义范围或冒称原命令通过。

package/inventory 未改，默认不重跑 B/C 全套。父对话后续按实际增量做独立审查，必要时读取现有文件确认共享事实。不得以此执行 npm test/verify:full、完整 architecture 图或真实后端链。

## 4. 固定验收标准

| 标准 | 必须达到 |
| --- | --- |
| 原 A1 | 发音挂起后实际关闭并释放，play=0、speech fallback=0，旧 src/playing/loading 不恢复 |
| 原 A2 | close 与真正 unmount 的迟到来源均释放同一已创建 URL，无资源重新持有或状态恢复 |
| 原 A3 | 切卡和快速关闭/同卡重开不被旧代覆盖；可见词发音、手动重播、目标原句和正常评分保留 |
| 原 A4 | 多段发音关闭/卸载取消后，迟到 ended/error 不启动下一段，也不回写卸载组件 |
| 原 A5 | 上表必要完整检查及新增真实组件回归用例均成功，无必要 NOT_RUN/NOT_VERIFIED |
| 原 A6 | fresh opening、精确增量、源码与新 bundle/hash、原日志/exit、Temp 服务关闭、按 opening 回滚齐备；无 schema/data/layout 改动 |
| 追加 T | T1–T4 全部通过；有效翻译成功/失败/重试可结束 loading，旧代不覆盖，新代/缓存恢复正确 |

只有必要项均完成，A 才能宣布“本轮限定执行自检完成，待父对话独立复审”；不能自行宣布 ABC 或全应用 PASS。部分项通过、历史失败措辞更正、bundle 构建成功均不替代实际交互。

## 5. 隔离、停止与交接

沿用原 A 的安全随机 loopback 服务、Temp out/cache、fresh 非持久浏览器上下文与合成服务/媒体。Service Worker block、WebSocket close，未知请求及未有合成响应的第三方请求 abort；静态只放行本轮自己的 origin。保留原发音/来源合成路由，并为翻译明确增加合成响应，不访问真实 API。

仅操作自己创建的服务并 finally 关闭。不得启动/重启 launcher、backend 或现有 5184/8776 试用服务，不碰每日 5174/8766、daily/historical tree、真实用户数据或工作区 dist。当前试用快照是旧不可变产物，不应为了本轮验收替换它。

这是用户明确授权后的继续施工，原两次 FAIL 永久保留。本次授权后如同一修复/复审任务再次连续失败两次，重新按 AGENTS 停止，说明具体失败和最小下一步；不能把失败任务改名、换 checker 或降低断言继续自动第三轮。

交接需包含：

1. 两项发现分别如何修复、修改文件/函数与消费者关系。
2. 原 A1–A6、T1–T4、正式必要命令的逐项状态、stdout/stderr/exit 与未验证项。
3. 新 opening/final 哈希、精确增量 patch、真实组件 bundle/source identity、实际交互截图及合成范围。
4. 原两次媒体失败、原评分 runner NOT_RUN 和父复审回归证据的链接；不得覆盖原状态。
5. 回滚只使用本轮 opening 字节，并先确认 current hash 等于本轮 closing；已有后续改动时仅反向本次 hunks，禁止 HEAD reset/restore/clean。
6. 最终明确“写入结束”，停止修改产品，交给父对话独立复审。无需也不得给父对话发送另一个 follow-up；父对话会主动读取进展。

估时：约 30–60 分钟，失败排查另计；父对话独立复审另计。大文件拆分、功能撤除规划、B/C 补充脚本均不在本次范围。
