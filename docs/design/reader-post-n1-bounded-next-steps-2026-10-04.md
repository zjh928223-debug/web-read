# N1 后续有限施工步骤：词典审核 → 手工导入清退 → R5

日期：2026-10-04。状态：本文件是具体执行方案，不表示已经派工或启动产品修改。用户已决定手工标注文件导入不保留；用户当前要求具体施工步骤。本次仅编写方案。

## 1. 当前事实与执行顺序

1. N1 本文扫描清退已经独立 PASS，限此前重定的验收范围，不重开。
2. 词典隔离检查修正已经执行：`dictionary:test` 30/30 PASS、`verify:sentence-translations` PASS；目前只是执行自检，独立审核 NOT_RUN。
3. 手工标注文件导入仍有隐藏 input 和专属接线，清退未施工。
4. R5 仍未施工。只整理保留的本文整理弹窗职责，不恢复扫描、不做后续功能改造。

固定顺序：D 独立审核通过 → M 手工导入清退并独立审核通过 → R5 按重定范围施工并独立审核。三轮各自 opening/closing、日志、有限 patch、结论；不能合成一个“全绿”结论。

参考：

- [词典修正交接](C:/Users/0/AppData/Local/Temp/reader-dictionary-boundary-20261004-bd4d4c6b/handoff.md)
- [N1 独立结论](C:/Users/0/AppData/Local/Temp/reader-n1-independent-review-20261004/review.md)
- [R5 重定范围草案](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/05-article-settlement-scope-draft.md)
- [共同执行约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)

## 2. 所有轮次的有限执行规则

- 一个写入者，审核者只读。仅优化工作区，不开 worktree、不提交、不推广。
- opening 必须保存当前文件原字节、SHA256、git dirty 清单；不能用 HEAD 代替当前状态。R5 opening 取 M 收口后的源码，附 N1、D、M 的连续增量身份，不能要求它与较早 N1 closing 全部相同。
- 临时源码副本、构建、cache、数据库、浏览器 profile、日志及截图放各轮独有 Temp。受控自动测试只启动自有随机 loopback，不复用或启停用户 5184/8776、日常 5174/8766 或未知进程。
- 不改 SeekPlayerDB v1/files/id、存储键/缓存格式、HTTP 合同、owner 实现、用户数据、provider 设置、薄 runtime/session 入口和 script 顺序。
- 每个命令记录真实 command/env/exit/stdout/stderr。原 FAIL/NOT_RUN/NOT_VERIFIED 保留，不能覆盖旧日志。
- 两次连续修复/复审失败按 AGENTS 停止，重审边界；不能静默开始第三轮。约500行或超过审过基线两倍的支持脚本需要先解释并收窄，不能发展成另一套业务实现。
- 全仓 npm test/verify:full、跨机、真实 provider、daily 推广默认 NOT_RUN/NOT_VERIFIED。只做本轮必要检查，不把源码/hash当作真实旅程证明。
- 每轮交接后停止写入，等待该轮独立结论，再开始依赖轮。

## 3. D：词典检查修正独立审核，无新产品施工

### D1. 固定审核对象

唯一修改文件：`src/dictionary/ecdict/tests/isolation.test.mjs`。

只读参照：句子翻译 service/plugin、浏览器翻译 client、Vite/本地 capability Host 装配；当前测试文件与 Temp opening/closing、有限 patch、四份执行日志及 scope-verification.json。检查原字节漂移，不能把整个 dirty checkout 当作本次改动。

审核者使用新的只读上下文，不由本次执行者给自己独立 PASS。只新增自己的 Temp review.md，不改正式代码或原证据。

### D2. 五项固定标准

| 标准 | 验收内容 |
| --- | --- |
| D-A1 原因 | 原 FAIL 确实由既有 Node 句子翻译缓存引起；浏览器走 HTTP，该服务没有变成 ECDICT repository 消费者。 |
| D-A2 有限例外 | 只有指定翻译 service 可在原目录检查中使用 SQLite，未放行所有 mjs/vocabulary 模块；原 ECDICT 禁令、默认禁用和 sentinel 保护保留。 |
| D-A3 浏览器保护 | 当前真实 HTML module 入口、Vue 脚本及 standalone SRS 本地依赖可检查；静态 import、转导出、字符串动态 import 能拒绝服务端 service/plugin 和 SQLite。 |
| D-A4 反例与结果 | 直接 SQLite、ECDICT 内部引用、直接 Node service、动态 import→barrel→Node plugin 四种反例有效；完整词典30项及翻译检查原始结果有效。 |
| D-A5 身份与回滚 | 开闭1238份源码中仅白名单检查变化；产品/数据无改动；opening备份和按closing身份回滚方法齐全，原失败没有回写。 |

此门禁只声明当前本地源代码依赖范围，不扩成任意运行时动态路径/全部第三方包分析器。没有身份漂移或具体证据缺口，不重新跑浏览器或全仓检查。

### D3. 输出与停止点

输出独立 PASS 或具体阻断项，逐项映射 D-A1–A5 或具体 P0–P2。若需修正，仅在原检查文件范围内一次集中列齐；超出范围先重定界。原首轮新增反例提示不匹配的 FAIL 保留。

独立通过后新增事实记录“词典检查修正独立通过”；N1 原 dictionary:test FAIL 仍作为历史结果。没有审核结论不得宣称该修正独立收口。

## 4. M：清退手工标注文件入口，保护共享导入能力

### M1. 开工前基线与消费者表

确认 D 独立结论，保存当前 opening。逐项列消费者：

- 专属支路：`import-annotation-lightweight-file` → DOM ref → feature deps → app 控制参数 → click/change文件选择 → 手工成功提示。
- 共享支路：`importManualLightweightAnnotations` → session IO → normalization/bundle merge/mark rebuild；普通 AI 和 YouTube workflow loader 都实际消费。
- 模板/导出：当前 API 及其配置仍保留，本任务没有退役模板或导出能力的授权。
- `getFirstFileFromEvent`、render、forceUpdateUI、toast/error 仍有 marks/AI 消费，只删除手工导入这一条参数和调用。

不要按函数名带 Manual 来删除共享实现，也不要整删 annotation-lightweight-module.js。

### M2. 产品白名单：只改五份现有文件

| 文件 | 允许增量 |
| --- | --- |
| index.html | 删除隐藏的手工标注文件 input；不动 marks input、AI/整理按钮和 script 顺序。 |
| src/composables/reader-dom-refs.js | 删除 importAnnotationLightweightInput 引用。 |
| src/composables/reader-feature-runtime-deps.js | 删除 importAnnotationLightweightBtn/Input 参数传递；保留 export 及所有其他消费者。 |
| src/composables/reader-app-runtime.js | 从轻量控件初始化删除 importButton/importInput/getFirstFileFromEvent/refreshAfterImport/showToast 等手工专属参数；保留 exportButton/showError。AI 的 refreshAfterImport 回调、marks 的文件辅助函数保持。 |
| src/composables/annotation-lightweight-module.js | 删除 importButton/input的读取、click/change绑定及只被该UI使用的buildImportSuccessMessage与其publication；保留控件初始化的export分支、配置API、模板/导出/导入facade。 |

保留 `initManualLightweightAnnotationControls` 现名及导出分支，不借此次清退改全局命名/导出生命周期。业务共享 facade 及 session 模块原字节保持；AI/loader 产品原字节保持。

### M3. 检查修改白名单：五份现有检查

1. `scripts/annotation-lightweight-module-check.cjs`：移除退休的文件选择/提示断言；保留配置、模板、导出、未ready、programmatic import及options透传；原import错误用共享facade rejection验证。增加“即便给旧import元素也不会绑定监听/打开文件”的退休断言，export分支仍有效。
2. `scripts/reader-dom-refs-check.cjs`：输入ID从预期收集中删除，并验证不再查询它；其余refs断言保留。
3. `scripts/reader-feature-runtime-deps-check.cjs`：验证退休input/button字段不再传递，既有装配/薄入口断言保留。
4. `scripts/reader-app-runtime-check.cjs`：删除手工控件refreshAfterImport调用断言；保留AI普通/块模式刷新，marks、导出及dispose断言；验证轻量初始化仅保留导出所需参数。
5. `scripts/read-web-interactions-check.cjs`：将隐藏input存在断言由true改为false，不删除整个removed UI检查或其他阅读交互断言。

不新增package入口或支持脚本。源码搜索允许保留反例/历史文档中的退休符号；产品中不能保留可达手工选择支路。

### M4. 有限静态与正式检查

修改前先运行受影响focused基线，失败原样归档；修改后完整执行：

```powershell
npm.cmd run verify:annotation-lightweight-module
npm.cmd run verify:reader-dom-refs
npm.cmd run verify:reader-feature-runtime-deps
npm.cmd run verify:reader-app-runtime
npm.cmd run verify:session-annotation-lightweight-io
npm.cmd run verify:session-annotation-bundle-merge
npm.cmd run verify:session-annotation-marks
npm.cmd run verify:annotation-backfill-ai
npm.cmd run verify:youtube-workflow-loader
npm.cmd run verify:annotation-storage-envelope
npm.cmd run verify:file-input-bindings
npm.cmd run verify:inline-handler-bindings
npm.cmd run verify:script-order
```

verify:vite 使用已确认自有URL/随机port、Temp artifacts/cache、同一开闭环境，完整运行wrapper原load/playback/interactions三项。默认wrapper会复用可达URL，不得对未知服务裸跑；必要时用原三项完整底层命令并如实写alias NOT_RUN，不能以单项代替整入口PASS。

### M5. 两条真实保留旅程

- M-J1：fresh隔离App正常打开素材，真实词点击和m标记；实际AI按钮提交→真实client→queued operationId/poll→轻量导入→合并读回→普通及块模式点击/解释。新解释更新，原历史preview-scan meaning/source保留，旧扫描项不被错误变为manual mark，新manual目标mark正确。
- M-J2：从正常素材流程打开带AI结果的独立样本，触发workflow loader的真实结果导入；确认来源与target匹配、历史合并和mark重建有效。素材列表/播放器与已有手动mark导入保持可用。

合成只放在已声明HTTP/provider边界，保持真实client/controller/loader和导入实现；禁止直接调用私有合并函数或注入store冒充App旅程。只覆盖本次入口删除的保留消费者，代表桌面1280×720、移动390×844即可；CSS不改，不另开全应用外观矩阵。

原手工选文件旅程仍NOT_RUN，并新增“产品决定退役，已按M清退”的事实；不能把它改写为PASS。

### M6. 固定验收与交接

M-A1全专属支路撤除；M-A2共享facade/IO/merge/mark及AI/loader保持；M-A3模板/导出/marks保护；M-A4focused完整与两真实旅程有效；M-A5仅白名单变化、回滚和原状态保留。

交接源码/hash、有限diff、消费者表、命令日志/请求/读回/截图与清理记录，停写待独立审核。只有M独立PASS才进入R5。

## 5. R5：迁出本文整理dialog，保留文章业务controller

### R5-1. 以M closing重新封存opening

固定采用重定草案R5-A1–A7；原扫描A2和双入口扫描旅程登记“因功能退役取消该子范围”，不能登记PASS。记录N1/D/M连续增量，不回到清退前源码。

先保存before源码及Temp生产产物、实际整理入口代表状态。列清所有依赖后再移动；无与本轮相关的真实行为缺口，不新增框架/存储抽象。

### R5-2. 产品白名单

- 修改 `src/composables/vocabulary-preview-module.js`。
- 新增 `src/features/vocabulary-preview/create-article-settlement-dialog.js`。
- `src/styles/workflow-ui.css` 只增加准确的新文件 `@source`；已有来源保留，不改任何主题/选择器/声明。

styles.css、learning-ui.css、native variants、article settlement/refinement/worker、storage、acquisition/owner、AI client、HTTP、Pinia、薄入口及现有controller兼容publication保持。没有共同消费者，不新建view-model或另一个业务controller。

### R5-3. 先搬展示与交互，再接回原callbacks

完整迁出createSettlementDialog及只属于view的：尺寸常量、DOM/图标创建、候选分组/紧凑释义/精简状态展示、renderSettlementList、展开/本次移出/重新学习、busy/status、drag/resize/clamp、pronunciation及迟到发音作废、openLoading/open/close/dispose、焦点恢复。

保留createDialogController、native control styles、pronunciation真实依赖；它们随view导入。纯normalizeText若两边都需使用，允许同语义小型私有helper，不能让dialog反向依赖controller形成循环。

工厂保持现有参数合同：documentObject/windowObject/pronunciationService + onApply/onSkip/onToggleRemove/onRefineMeanings；返回现有open/openLoading/close/setStatus/setSpeakingState/dispose，不返回私有DOM或geometry。

controller继续持有：文章身份、候选cache、bundle/进度读取、open资格/settlementOpening、AI请求与结果、application/refinement claim、owner/worker路径、进度写入、按钮badge/refreshAvailability。callbacks数据、文章ID、入库/skip语义保持，无第二套持久状态。

只做职责迁移。迁移前已存在的close/异步/业务缺陷不偷偷改；具体P0–P2先记录并按停止/重定界处理。

### R5-4. 同步真实检查归属

只修改 `scripts/vocabulary-preview-ui-check.cjs`、`scripts/vocabulary-preview-service-check.cjs`、`scripts/vocabulary-preview-acquisition-check.mjs` 的实现归属/staging加载；N1后有效业务断言全部保留。新dialog必须加载真实依赖，不能拼接源码或stub新view求通过。

```powershell
npm.cmd run verify:vocabulary-preview
npm.cmd run verify:vocabulary-preview-ui
npm.cmd run verify:vocabulary-preview-acquisition
npm.cmd run verify:annotation-storage-envelope
node scripts/dialog-controller-check.mjs
```

做共同diff/JS/ESM门禁及fresh生产构建，必要装配加载用隔离verify:vite；D/M无漂移已通过范围按身份继承，不盲目再次全跑。

### R5-5. 固定真实旅程与生产矩阵

从完整App真实“已学完本篇/整理本篇生词”入口进入，不直接调用私有open：

1. 标准素材打开 → loading → 候选分组、滚动、释义展开。
2. 移出/放回、重新学习、真实发音操作；检查取消/迟到结果按opening保持。合成媒体不声明扬声器发声。
3. AI精简：提交→queued/poll→processing按钮disabled→completed→进度读回；关闭重开实际展开读到保存的释义。声明合成provider，不外推用户provider或跨浏览器重启。
4. words、all、skip用三份独立样本/上下文，观察真实申请、入库/进度读回及按钮，不复用已污染样本。
5. 重复点击、切文、请求失败/重开：确认opening既有单航班/claim、文章隔离和错误恢复保持。
6. 实际pointer drag/resize、边界clamp、Escape/关闭与focus返回；重开监听行为不因搬迁增加。

同一before/after数据、环境和状态，1280×720/390×844 × dark/light外壳共四组合，dialog保持原固定light主题。各组合覆盖初始/展开/drag-resize及滚动/footer自然换行；长释义、空、loading/error/processing/completed做配对代表状态。

等字体和动画完成、连续帧computed稳定后采样；生成utilities/computed/geometry/截图和交互一起比较。新增文件必须被Tailwind扫描到，不能只证明开发版正确。

### R5-6. 固定收口

按草案A1表现归属、A2打开/身份、A3结算合同、A4生命周期、A5样式来源、A6几何、A7完整必要逐项交接，独立审核只用这些标准或具体P0–P2。

回滚仅反向R5增量，恢复M后opening并移除无后续消费者的新dialog；不得恢复N1扫描或M手工文件入口。R5独立PASS后再进入剩余R6/R8，R9最后执行，不因此宣称整个项目完成。

## 6. 文档/清单的受控同步与状态表

需要同步时只允许对应新增模块/变化检查记录：docs/architecture/script-inventory.json、test-inventory.json、compatibility-consumer-map.json及其md；README.md、PROJECT_MAP.md、CURRENT_PROJECT_STATUS.md中对应本轮事实；本方案、R5草案与decomposition README/dispatch相关段落。不要全量生成无关diff。

新增正式检查入口与package.json不在默认白名单。当前各轮均可用现有入口；必要新增先列真实缺口再重定界。修改清单/事实后运行：

```powershell
npm.cmd run verify:test-inventory
npm.cmd run verify:script-inventory
npm.cmd run verify:current-documentation
git diff --check
```

| 项目 | 本文件编写时状态 |
| --- | --- |
| D词典修正 | 执行自检PASS，独立审核NOT_RUN |
| M手工导入清退 | 产品决定退役，施工/实际旅程/独立审核NOT_RUN |
| R5保留本文整理职责 | 本方案明确具体步骤，产品施工/构建/旅程/独立审核NOT_RUN |

每轮最小事实同步只能记录真实的新结论，不能回写原N1失败或刷新全仓Last verified。

### 2026-10-04 执行连续增量

D词典修正独立PASS，原dictionary历史FAIL保留：[D审核](C:/Users/0/AppData/Local/Temp/reader-dictionary-independent-review-20261004-84d3f7a1/review.md)。M五产品/五检查清退后真实素材mark呈现缺口在opening复现；用户另行授权B共享mark通知有限修复，B独立PASS（仅marks-state-module.js及对应检查）。随后M按原M-A1–A5补充独立PASS并收口：[B审核](C:/Users/0/AppData/Local/Temp/reader-mark-reactivity-independent-review-20261004-618db3a9/B-review.md)、[M审核](C:/Users/0/AppData/Local/Temp/reader-mark-reactivity-independent-review-20261004-618db3a9/M-supplemental-review.md)。原手工文件旅程NOT_RUN，功能已退役并清退；原失败不回写。R5现在获原用户执行指令按序启动，opening以当前M+B收口后源码重新封存，附连续增量身份；不更新全仓Last verified/推广状态。


### R5 本文整理职责迁移独立收口（2026-10-04）

R5按重定固定A1–A7独立PASS，见[独立报告](C:/Users/0/AppData/Local/Temp/reader-r5-independent-review-20261004-6bfa8721/review.md)。本文整理DOM、候选展示/展开、按钮、拖拽缩放、发音、关闭释放与焦点返回由src/features/vocabulary-preview/create-article-settlement-dialog.js单独拥有；vocabulary-preview-module.js继续负责文章身份、缓存、进度、AI、claim、入库及owner协调。workflow-ui.css仅补准确@source，生产CSS哈希保持。D/M/B前置分别独立PASS；原手工文件旅程NOT_RUN且功能已退役并清退，原dictionary历史FAIL保留。R5当前生产四组合/代表状态/精简保存重开/words-all-skip通过；切文原伪PASS撤回INVALID，当前桌面/移动完成隔离补证有效，opening桌面补测FAIL保留，迟到完成配对仍NOT_VERIFIED。源码及原日志见C:/Users/0/AppData/Local/Temp/reader-r5-settlement-dialog-20261004-01a10648/handoff.md。旧扫描范围因功能退休取消，不改为PASS；不更新全仓Last verified或推广状态。R6/R8/R9尚未施工，后续按R6→R8→R9执行。此前相关段落为历史记录。
