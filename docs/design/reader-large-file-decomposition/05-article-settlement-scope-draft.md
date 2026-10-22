# R5重定范围草案：保留的本文整理职责

2026-10-04。**用户已确认顺序：单独N1清退本文扫描 → 清退独立通过 → R5职责整理。** N1执行范围见[本文扫描清退有限施工方案](E:/read-web-next-optimization/docs/design/reader-article-scan-retirement-plan-2026-10-04.md)。下列R5具体拆分/验收仍为讨论草案，尚未放行产品施工、派工或测试。R2已独立PASS；N1已独立PASS（限预先重定范围）；该前置已满足，R5仍须本草案定稿和明确调度。适用[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)。

## 1. 三段边界

| 任务 | 范围 | 结果 |
| --- | --- | --- |
| 前置N1 | 删除本文扫描入口/专属弹窗、显示隐藏预习词及专属状态/监听/消费者 | 另编消费者、允许文件及固定验收方案，单独施工和独立审核 |
| R5 | 分离现有本文整理弹窗与文章业务协调 | 保持N1独立通过后opening的行为、样式、数据/API合同 |
| 后续N5 | 自动精简、键盘调整、状态/跳过语义/性能等F1–F11 | 单独确定业务规则与验收；不混入R5 |

前置N1不整删vocabulary-preview-module.js；手动mark、AI解释、本文整理、独立PassagePreviewPage/usePassagePreview、共享词库/SRS及学习历史保留。已有扫描解释不随功能撤除删除。

清退前源码审计确认：article-srs-settlement.js曾从preview-scan.js导入isPreviewGeneratedItem/PREVIEW_SCAN_SOURCE，读取历史扫描项的分类及来源。N1方案已明确先将这两项来源识别移入保留的article-srs-settlement.js，再退役整个扫描器；识别合同/导出名保持，不裸删共享依赖，不新建历史大模块。R5采用N1独立通过后的opening，不再沿用清退前扫描消费。

N1消费者核对包括index.html两个入口、main/DOM refs/runtime接线、transcript store和普通/AI块预习高亮、专属CSS、现行检查。共享.vocabulary-preview-dialog仍服务本文整理，不能整段删除。audio identity仍消费__vocabularyPreviewController.refreshAvailability，不借清退/R5扩大为兼容全局清理。

## 2. 建议保留及排除

R5保留opening已有的候选分组、释义展开、移出本次/放回、重新学习、发音、手动AI精简、只加入单词/加入单词和短语、本篇不加入、进度提示、拖拽/缩放、关闭重开及焦点恢复。业务效果保持，不在此决定新的永久排除/文章完成语义。

不新建preview dialog或重建扫描器，不重写Vue/新增页面；不改独立预习、SRS评分队列、AI服务配置、默认释义、自动调用时机、HTTP、存储格式/schema或owner实现。已focused服务不因行数再次拆分。

## 3. 所有者及允许文件建议

| 所有者 | 职责 |
| --- | --- |
| 本文整理dialog | DOM/候选展示、本次交互状态、busy/status、拖拽/缩放/clamp、发音及迟到播放作废、关闭/释放/焦点返回 |
| 文章controller | 文章身份、候选构建/缓存、进度读取、打开协调、AI请求/结果记录、application/refinement claim与释放、owner acquisition和进度写入 |

dialog接收数据及业务callbacks，不持有仓库/owner/client，不向controller暴露私有DOM或geometry；不复制文章身份、持久进度和claim。已有view状态随view迁移，不新增第二套状态。

建议产品范围：修改src/composables/vocabulary-preview-module.js；新增src/features/vocabulary-preview/create-article-settlement-dialog.js。候选展示/format默认随dialog同文件；单消费者不另造view-model。原业务callbacks保持，不另拆文章业务controller。

src/styles/workflow-ui.css只补准确的新动态UI @source；styles.css、learning-ui.css、native variants、class/owner/theme保持N1后opening字节。本文整理/worker/meaning refinement、storage、acquisition及owner服务保持字节；例外须事前重新定界。

scripts/vocabulary-preview-ui-check.cjs、vocabulary-preview-service-check.cjs、vocabulary-preview-acquisition-check.mjs仅同步真实实现归属/staging；N1后所有有效行为断言保留。inventory/docs仅同步本轮实际增量，无已说明行为缺口不新增package入口或支持脚本。

## 4. 执行顺序建议

1. 读N1独立结论及退休/历史消费者映射；R5opening取N1独立通过后的当前源码，不使用HEAD或清退前源码。
2. 保存opening原字节/hash、dirty/有限diff、整理入口/生产CSS/代表状态；列dialog/controller、refreshAvailability、worker/acquisition及检查staging消费者。
3. 搬完整settlement dialog：render、drag/resize、发音、busy/status、openLoading/open/close/dispose/focus。原文案、顺序及效果保持。
4. 接回原业务数据/callbacks，controller继续候选/进度/AI/claim/owner协调；不扩大业务重构。
5. 新动态UI准确补@source；检查读取真实新实现、加载真实依赖，不拼接源码或stub新view求通过。
6. 完整必要检查及实际整理入口fresh生产旅程；同状态CSS/computed/截图对照，交接后停写待独立审核。

## 5. 建议重定版R5-A1–A7

原扫描A2及双入口扫描旅程，现登记为“因功能退役取消该子范围”，不能改写PASS。审核明确引用本重定版，历史原标准/结果不覆盖。

| 标准 | 建议固定验收 |
| --- | --- |
| A1表现归属 | DOM/view交互归dialog，文章/AI/claim/owner协调归controller，无复制状态或新全局 |
| A2打开与文章身份（替代旧扫描标准） | 实际整理入口可达，重复打开协调、资格/切文保护、refreshAvailability及进度按钮按opening保持，无迁移引入的串文或重复操作 |
| A3结算 | 分组/展开/remove/relearn/refine/两种apply/skip及原owner acquisition/进度/claim合同保持；历史扫描项读取分类保持 |
| A4生命周期 | 实际drag/resize/发音与close/dispose清理正确，重开不叠加监听，旧发音不因迁移复活，focus按原路径返回 |
| A5样式来源 | 新文件被Tailwind扫到，生产utilities、owner/theme、native variants保持 |
| A6几何 | 同opening状态footer自然换行、滚动、drag/resize界限、短长释义、loading/错误/空/disabled的computed/截图一致 |
| A7完整必要 | N1独立结论明确，三项有效focused完整通过，实际整理入口旅程与有限身份/回滚记录齐备；不再要求退休扫描旅程 |

源码阅读不是运行证明。opening若出现真实P0–P2故障，依共同停止/重定界规则处理，不静默把F1–F11加入R5。

## 6. 检查与实际旅程

- npm.cmd run verify:vocabulary-preview
- npm.cmd run verify:vocabulary-preview-ui
- npm.cmd run verify:vocabulary-preview-acquisition
- npm.cmd run verify:annotation-storage-envelope
- node scripts/dialog-controller-check.mjs
- 共同静态门禁及本轮实际增量所需inventory门禁。

以N1收口后的正式入口和有效断言为准；整理/owner/发音/布局断言保留，staging加载真实新dialog。N1退休验收不由R5静态no-hits替代。

fresh隔离production App从真实“已学完本篇/整理本篇生词”入口：打开/loading→滚动→drag/resize→展开/发音→移出/放回/重新学习→手动精简→两种入库与skip（分别独立场景）→关闭重开。重复点击、切文、失败/重开按原合同验证，观察实际请求、记录及UI；不调用私有open/claim冒充旅程，不用静态锁宣称幂等。

1280×720/390×844，dark/light壳中的固定light整理dialog；长释义、完成/处理中、loading/错误/空候选。只覆盖该保留入口的受影响状态，不扩全应用矩阵。

## 7. 交接与回滚

交接N1结论/来源、view/controller接口、claim/进度所有者、@source、实际整理旅程/生产CSS身份、重定版A1–A7及退休验收映射。R5回滚仅反向本轮opening→closing增量，移除无后续消费的新dialog；不得恢复已独立完成的N1扫描或覆盖原dirty。

本次只读核对及文档草案；产品施工、N1/R5实际旅程、生产构建、独立审核均NOT_RUN。重复入库/跨文异步/性能的实际报告仍NOT_VERIFIED。此草案不新增施工授权。


N1 本文扫描清退执行记录（2026-10-04）：两个扫描/显示入口及专用生产、显示、词典富集支路已撤除；本文整理、历史来源识别和独立学习入口保留。执行验收未完成：J3 现有手工导入入口不可达，句高亮正式检查失败；独立审核 NOT_RUN，R5 未放行。具体命令、失败与未覆盖项见本轮 Temp handoff.md：C:/Users/0/AppData/Local/Temp/reader-n1-resume-20261004-582b711a/handoff.md。此记录不更新全仓 Last verified 或前轮结论。


N1 补充执行（2026-10-04）：用户授权重定后，句高亮完整检查、匹配 target 的普通 AI/真实轻量合并与旧扫描来源/mark 保护、动画稳定的四组合生产矩阵及 drag/resize/focus、代表 loading/empty/长列表/relearn/error 对照通过。处理中 UI 已观测；补充 producer 完成响应合同错误的原 FAIL 保留，停止追加修补。原手工文件 UI 缺口不伪装为旅程通过，按方案补充范围改用既有 AI 导入链；dictionary 全入口的既有 FAIL 保留并有原 opening 复现。独立审核 NOT_RUN、R5 未放行，见 C:/Users/0/AppData/Local/Temp/reader-n1-supplement-20261004-2c83b798/handoff.md；不更新全仓 Last verified。


### N1 独立收口（2026-10-04）

**N1 独立 PASS，限于方案预先重定后的验收范围，现已收口。** 独立审核未发现阻断收口的 P0–P2 问题，见[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-n1-independent-review-20261004/review.md)。最后 completion 补测已闭合精简完成、进度保存及关闭重开读取；原失败尝试保留。原手工文件 UI 旅程仍为 NOT_RUN，dictionary:test 整入口仍为既有 FAIL，按重定范围保留另案；本审核未重跑业务测试。此前执行/补充段落是各阶段历史记录，不再代表当前 N1 状态。

R5 旧扫描/双入口扫描子范围标为“因功能退休取消”，不是 R5 PASS；R5 保留本文整理职责的方案仍须定稿及明确调度，尚未启动。R5 opening 应以 N1 本次收口后的当前源码及 closing 身份为基线，见 C:/Users/0/AppData/Local/Temp/reader-n1-closeout-20261004-e83a5c18/closing-manifest.json，不以 HEAD 或清退前源码代替。未更改 R9、全仓 Last verified 或推广状态。


### R5 本文整理职责迁移独立收口（2026-10-04）

R5按重定固定A1–A7独立PASS，见[独立报告](C:/Users/0/AppData/Local/Temp/reader-r5-independent-review-20261004-6bfa8721/review.md)。本文整理DOM、候选展示/展开、按钮、拖拽缩放、发音、关闭释放与焦点返回由src/features/vocabulary-preview/create-article-settlement-dialog.js单独拥有；vocabulary-preview-module.js继续负责文章身份、缓存、进度、AI、claim、入库及owner协调。workflow-ui.css仅补准确@source，生产CSS哈希保持。D/M/B前置分别独立PASS；原手工文件旅程NOT_RUN且功能已退役并清退，原dictionary历史FAIL保留。R5当前生产四组合/代表状态/精简保存重开/words-all-skip通过；切文原伪PASS撤回INVALID，当前桌面/移动完成隔离补证有效，opening桌面补测FAIL保留，迟到完成配对仍NOT_VERIFIED。源码及原日志见C:/Users/0/AppData/Local/Temp/reader-r5-settlement-dialog-20261004-01a10648/handoff.md。旧扫描范围因功能退休取消，不改为PASS；不更新全仓Last verified或推广状态。R6/R8/R9尚未施工，后续按R6→R8→R9执行。此前相关段落为历史记录。
