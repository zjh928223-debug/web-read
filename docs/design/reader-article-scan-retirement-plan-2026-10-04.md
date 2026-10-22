# N1：本文扫描清退的有限施工方案

日期：2026-10-04。当前状态：N1 独立 PASS（限预先重定验收范围），施工及收口完成；R5 未启动。
唯一实施工作区：E:/read-web-next-optimization。
用户已确认顺序：**单独N1清退本文扫描 → N1独立PASS → 重定并施工R5 → 后续N5功能改造。**

本文件给执行者及独立审核者共同使用，固定本轮目标、允许文件及N1-A1–A7；不授权读到文档即自动开工。适用[AGENTS.md](E:/read-web-next-optimization/AGENTS.md)及[分轮共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)。本轮是原第5项中的有限功能撤除前置，不混称为R5结构施工。

只读依据：[源码依赖审计](C:/Users/0/AppData/Local/Temp/reader-article-scan-audit-20261004-c8bfcccb/audit.md)。其622条静态import/reexport记录及1239份文件身份核对不是运行验收；Temp原证据若缺失，重新核对相关源码，不编造结果。本方案保留实施所需边界，避免仅靠Temp链接才能理解任务。

## 1. 最终产品效果与明确排除

本轮完成后：
1. 阅读器不再提供“预习生词”和“显示/隐藏预习词”两个本文扫描入口；没有扫描专属窗口、隐藏接线、扫描方法空壳或可达的扫描生产链。
2. 本文扫描规则、候选聚合、数量限制、扫描AI模板/结果生产、扫描新结果写入、专用显示state/class/style及扫描专用词典富集链一并退休。
3. 普通/AI块中的手动mark、点击定位/解释气泡、现有播放高亮继续保持。
4. “已学完本篇/整理本篇生词”、普通AI标注、独立首次接触预习、SRS和ECDICT其他消费者继续保持。
5. 已有扫描解释、词库、学习历史及backend run/result不清空；仍可按原来源/资格规则读取历史项。

不新增替代扫描器，不把扫描改成隐藏按钮或no-op接口。不做自动精简、键盘重设计、空/新增状态改造、新跳过语义、模型/设置迁移、SRS队列/评分改造、API/schema迁移。N1不拆整理dialog，不更名整个controller/全局兼容面，不施工R6/R8/R9，不重开已结束R3。

允许的外观差异仅为：两个入口和扫描点线提示消失，剩余工具栏按既有自然换行重新排列。其余保留入口相对顺序、分组、皮肤和操作方式保持，不补占位按钮、不移动其他操作来填空。

## 2. 当前依赖与切割位置

扫描支路：
index.html两个入口 → reader DOM refs → feature deps → reader-app-runtime → vocabulary-preview controller。
其中scanPreview → performPreviewScan → preview-scan算法 → 可选ECDICT富集 → preview dialog → runPreviewExplanation → 共享annotation-backfill client → 扫描结果构建 → savePreviewGeneratedItems → 共享annotation bundle/index。

显示支路：
togglePreviewWords → 读取已有generated bundle → getPreviewWordIndexesFromGeneratedItems → transcript store两个preview字段 → TranscriptContainer/ChunkModeView专属class → dotted underline/hover CSS。

保留支路：
同一controller的openSettlement → bundle/candidate/progress → settlement dialog → 手动精简/claim/owner acquisition/worker/application/skip。
audio identity仍通过__vocabularyPreviewController.refreshAvailability更新整理资格/进度，因此global/controller/runtime生命周期不可整删。

共享根的处理：
- preview-scan.js里PREVIEW_SCAN_SOURCE及isPreviewGeneratedItem仍被article-srs-settlement使用；先移到保留的article-srs-settlement.js，保持原导出名/识别语义，随后删scanner及其barrel导出。不新增历史大模块。
- annotationBackfillAi.model及__annotationBackfillAiSessionApiKey与普通AI标注共用；清掉扫描局部实现，不清空已存配置/凭据；本文整理精简的getSessionApiKey/persistSessionApiKey保留。
- loadCurrentAnnotationBundle/getGeneratedItemsFromBundle/getStorage仍供整理使用；只退役扫描写入producer，不删storage/index/facade。
- ECDICT富集适配器当前只有扫描产品调用，可退役；client/formatter/SQLite/plugin及App/SRS/独立预习消费者保留。
- 旧扫描项来源展示与导入后manual mark过滤继续保留，不能把来源一律改为manual。

## 3. 开工条件、opening与隔离

1. 获得明确N1施工调度；唯一writer，其它相关范围保持停写。父负责调度，执行者不创建任务/代理/worktree；独立审核使用独立只读审查，不由执行者自判PASS。
2. 阅读最新AGENTS、README、PROJECT_MAP、CURRENT_PROJECT_STATUS、dispatch第16节、本方案及R5草案；R1/R2/R3/R4/R7已有结果不因N1刷新为本轮重跑。
3. 开工时重新核对上述消费者及文件；若发现新的产品调用者或影响保留合同，不扩大白名单，先报告具体差异并重定范围。
4. 保存所有责任文件opening原字节、SHA256/bytes、git status/HEAD、有限diff；记录既有未提交工作。回滚依据本轮opening，不是HEAD。
5. 同时保存受保护模块、前轮closing关键文件、CSS和index脚本顺序身份；构建/旅程明确before对应本轮opening。
6. Node staging/outDir/cache/log/artifacts和Python data/config/cache/pycache只用独有Temp。构建缓存不可落到用户dist或覆盖日常产物；现有检查若写repo内staging，使用只改临时目录的preload/安全包装，业务断言原样执行。
7. 不启停/复用用户5184/8776、5174/8766或未知进程/端口。测试自有随机loopback端口、fresh非持久browser context、Service Worker block；外部AI/ECDICT/TTS用已声明合成边界，未知请求阻断。
8. 手动优化试用启动不属本轮；以后获授权仍只能用optimization runtime/launcher/数据根。需要Python的测试只能用项目既有配置选择机制，不安装/修复系统依赖。

## 4. 产品白名单：12个局部修改、2个文件退休

| 文件 | 允许的具体增量 |
| --- | --- |
| index.html | 删除btn-preview-vocabulary及btn-toggle-preview-vocabulary两个button；script/其他DOM顺序保持 |
| src/main.js | readerToolbarButtonIds移除两个对应ID |
| src/composables/reader-dom-refs.js | 移除previewVocabularyBtn/togglePreviewVocabularyBtn两项 |
| src/composables/reader-feature-runtime-deps.js | startApp deps移除两项对应传递 |
| src/composables/reader-app-runtime.js | 移除两button参数、dictionaryEnrichmentAdapter参数、createOptionalDictionaryEnrichmentAdapter及专属两个imports；整理controller创建/生命周期保持 |
| src/composables/vocabulary-preview-module.js | 按第5节删除完整扫描/显示/preview dialog及局部无用依赖；保留整理 |
| src/pinia-stores/transcript.js | 删除previewVocabularyWordIndexes/previewVocabularyWordIndexSet；computed无其它消费时只移除该import |
| src/components/TranscriptContainer.vue | 只删除wordClasses中preview class分支 |
| src/components/ChunkModeView.vue | 只删除wordClasses中preview class分支 |
| styles.css | 按第6节删专属规则/混合selector分支 |
| src/services/vocabulary/index.js | 移除export * from './preview-scan.js'；其余exports保持 |
| src/services/vocabulary/article-srs-settlement.js | 移入并export原PREVIEW_SCAN_SOURCE/isPreviewGeneratedItem，删除对scanner的import；候选/业务函数保持 |
| src/services/vocabulary/preview-scan.js | 消费迁移完成后整文件删除 |
| src/dictionary/ecdict/application/dictionary-enrichment-adapter.mjs | 产品消费断开后整文件删除 |

不新增产品文件/依赖/配置。保持两个来源识别export是为了原保留消费者及检查继续读取旧来源，不保留扫描API。

## 5. controller内部允许切割

按函数/消费者定位，历史行号仅作导航。

完整退休：
- 本文件扫描MODEL_STORAGE_KEY/DEFAULT_MODEL/getStoredModel/persistModel。
- savePreviewGeneratedItems、setPreviewWordIndexes、buildStateContext、renderCandidateList、createPreviewDialog。
- previewButton/togglePreviewButton/dictionaryEnrichmentAdapter及previewVisible/latestPreviewScan/previewScanInFlight/previewScanInFlightIdentityKey/previewScanRequestId/previewFocusReturnTarget/previewDialog。
- performPreviewScan/scanPreview/runPreviewExplanation/togglePreviewWords、两个click bindings、返回对象中的扫描方法及仅含扫描状态的getStatusSnapshot。
- refreshAvailability/dispose内对应扫描片段。
- 已无本文件消费者的buildPreview*、getPreviewWordIndexes*、applyNativeInputStyles、formatDictionarySuggestion、getPiniaRuntimeStores、scheduleGeneratedAnnotationIndexRefresh等局部imports。

保留且不能借机重写：
- normalizeText、formatGeminiModelError、getCurrentIdentity/getSourceInfo/getSettlementCacheKey。
- SESSION_API_KEY/getSessionApiKey/persistSessionApiKey。
- createElement、speaker/dialog/native控件/发音帮助、settlement geometry常量及全部settlement view操作。
- getStorage/loadCurrentAnnotationBundle/getGeneratedItemsFromBundle。
- activeIdentityKey及切文settlementCache失效；settlementOpening、progress请求代号、applicationsInFlight。
- owner/client/vocabularyService/worker/progress repository、refinement/application claim与释放及进度写入。
- settleButton/openSettlement/applySettlement、refreshAvailability的整理资格/进度、整理dispose及controller publication。

按实际引用决定局部import去留，不全局删同名服务，也不通过复制保留代码到新大模块规避白名单。

## 6. CSS允许删除与保护

styles.css扫描专属删除对象：
- 两个button ID尺寸分支；包含AI标注/整理的混合列表只删toggle selector，保留其它selector及声明。
- .preview-vocabulary-word、其:hover及.marked.preview-vocabulary-word:hover。
- .vocabulary-preview-dialog__form/__field/__label/__hint/__dictionary-suggestion及form内status规则。
- .vocabulary-preview-dialog:not(.vocabulary-preview-dialog--settlement) .vocabulary-preview-dialog__item-main。
- form与--settlement共用声明的规则只删除form selector，保留settlement声明。

__input目前只有扫描DOM class，不制造不存在的CSS删项。
共享dialog/backdrop/header/title/status/list/item/footer、--settlement全部规则、light学习主题、native variants和其它共同selector保持。剩余选择器及声明不重排、不压缩、不顺手去!important。

src/styles/workflow-ui.css和src/features/learning-ui/learning-ui.css本轮产品字节保护：controller仍生产整理动态classes，原@source和学习主题范围有消费者，不能删。不按utilities文字出现在退休view里就删除通用recipe。

## 7. 检查、文档允许同步清单

### 检查文件

允许修改以下已有9份文件；不是要求每份都改：
1. scripts/reader-dom-refs-check.cjs：去掉两个退休DOM refs要求，保留其余refs。
2. scripts/reader-app-runtime-check.cjs：同步退休deps/字典factory imports/stubs，保留整理/AI/生命周期装配断言。
3. scripts/vocabulary-preview-service-check.cjs：退休scan/template/结果生产/显示检查；保留settlement/refinement/progress/application/来源资格。保留历史fixture直接构造，不依赖已删扫描生产函数。
4. scripts/vocabulary-preview-ui-check.cjs：移除扫描/显示检查；保留整理状态、owner、发音、样式/几何；旧扫描解释的读取回归通过正常索引/保留入口验证，不调用已退休toggle。
5. scripts/annotation-backfill-ai-module-check.cjs：只同步scanner移除后的staging文件图，AI业务断言保持。
6. scripts/vocabulary-srs-service-check.cjs：只同步staging文件表，SRS业务断言保持。
7. scripts/vocabulary-article-acquisition-check.cjs：只同步staging文件表，acquisition断言保持。
8. scripts/sentence-highlight-ui-check.mjs：去掉退休store注入/点线断言，保留mark、句高亮、普通/AI切换和焦点旅程。
9. src/dictionary/ecdict/tests/browser-client-adapter.test.mjs：仅取消富集适配器三个测试及对应import；保留client DTO/错误/超时和formatter测试。

其他正式检查脚本与package.json保护。不新增正式package入口、不整批改名测试；发生明确新消费者缺口时先重定清单。

### 文档/映射

只允许以下文件与本轮事实有关的局部记录，不批量改历史结论：
- README.md、PROJECT_MAP.md、CURRENT_PROJECT_STATUS.md、AGENTS.md。
- docs/architecture/compatibility-consumer-map.json及.md。
- docs/architecture/test-inventory.json、script-inventory.json。
- docs/architecture/windows-local-owner-thin-reader/browser-direct-writer-consumer-map.json、ownership-matrix.json。
- docs/tools/reader-feature-map/catalog.js：只更新article-preview/preview-word-visibility退休及相关关系描述，稳定feature ID/意见格式保持，不改feature-map页面实现。
- 本方案、reader-feature-change-scheduling-2026-10-03.md、大文件README、05-article-settlement-scope-draft.md及05-vocabulary-preview.md的N1/R5状态/前置行。

writer map中annotation.vocabulary-preview对应的扫描新结果merge consumer退役；loadCurrentAnnotationBundle仍供整理读取，不能把该读者也抹掉。其它owner domains/cutover/backup/migration门禁不改。
生成inventory前保存原字节并核对diff，仅接受本轮退休和来源行号变化；不能借重生成覆盖其它dirty事实。

## 8. 保护文件与数据

以下范围产品字节不变：
- reader-runtime.js、session-init.js、runtime assembly和脚本加载顺序。
- reader-bootstrap-runtime.js、audio identity、reader session persistence/loader及R1–R3实现。
- annotation-backfill-ai-module.js、youtube-workflow-client.js、session-annotation-*、annotation-bubble/resolver、src/services/annotation/**。
- 除第4节两个保留文件/一个退役文件外的src/services/vocabulary/**，尤其settlement progress/worker/refinement/acquisition/repositories/scheduler/owner。
- src/App.vue、src/features/passage-preview/**、src/features/srs-review/**及独立SRS entry。
- ECDICT客户端/formatter/config/service/infrastructure/plugin及其他tests；全部真实dictionary数据库。
- theme/native variants/glass及其它CSS；WhisperX/语言处理改动。
- tools/subtitle-workflow/**、backend annotation runtime/template/service、全部runtime/config文件。

数据不迁移、不清库、不清key、不删run/latest/bundle。SeekPlayerDB v1/files/id保持。共享model/key、marks、SRS/learning progress、owner profile/revision/operationId和历史格式保持。数据断言只能读取独有Temp测试数据，不接触日常库。

## 9. 按阶段、按步骤施工

| 阶段 | 顺序与交付 | 继续条件 |
| --- | --- | --- |
| S0 opening | 复核消费者→冻结责任/保护文件→保存dirty/diff→fresh Temp before build及固定before数据/截图/computed | opening能对应当前源码，依赖和环境满足；未运行项明确 |
| S1 来源解耦 | 移原两个来源识别到article-srs-settlement→接回真实消费者/barrel→将历史fixture与扫描生产解耦 | 来源识别及资格结果与opening一致，无新模块/新合同 |
| S2 全支路退休 | 删除扫描controller/view/request/write→删refs/deps/button/style-list→删专用store/class→删字典factory/adapter→删scanner/barrel | 导入图完整，无隐藏scan/run/toggle或no-op；整理state/生命周期仍在 |
| S3 样式/检查同步 | CSS精确删分支→调整9份已有检查的实际受影响部分→更新staging | 保留有效断言，有清晰“退休断言→取消原因/保留断言→新来源”表 |
| S4 必要验证 | 跑第10节完整focused→fresh Temp after build→第11节实际入口及第12节同状态CSS对照 | 固定N1-A1–A7有运行/身份依据，FAIL不改写为PASS |
| S5 有限交接 | 最小同步当前映射→静态门禁→closing保护身份/有限patch→清理自有资源→执行自检交接停写 | 状态“自检完成，待独立复审”，不自行启动R5 |
| S6 独立收口 | 独立只读审核按固定标准审源码/原证据→PASS后父释放最小事实同步→以N1 closing更新R5 opening范围 | 独立PASS才放行R5；保留原FAIL/NOT_RUN/NOT_VERIFIED |

每一阶段不是新一轮维修或独立审核任务；同一N1范围只在执行结束后独立审核。失败仅修具体受影响问题，不重复全部已通过检查。

## 10. 必要检查：各执行一次，按变化补跑

以下正式入口保留完整有效断言，使用安全隔离目录/自有URL参数或只改staging目录的Temp包装；不能stub掉本轮保留实现求通过：

| 对应范围 | 正式命令 |
| --- | --- |
| 词汇/整理/历史资格 | npm.cmd run verify:vocabulary-preview |
| 整理UI/退休入口 | npm.cmd run verify:vocabulary-preview-ui |
| 共享首次接触/学习记录 | npm.cmd run verify:vocabulary-preview-acquisition |
| 保留SRS与文章acquisition | npm.cmd run verify:vocabulary-srs；npm.cmd run verify:vocabulary-article-acquisition |
| 普通AI装配/staging | npm.cmd run verify:annotation-backfill-ai |
| refs/runtime接线 | npm.cmd run verify:reader-dom-refs；verify:reader-feature-runtime-deps；verify:reader-app-runtime；verify:reader-bootstrap-runtime（均npm.cmd run） |
| 历史标注/存储 | npm.cmd run verify:annotation-bubble-resolver；verify:session-annotation-lightweight-io；verify:annotation-storage-envelope（均npm.cmd run） |
| ECDICT剩余边界 | npm.cmd run dictionary:test |
| Pinia与脚本顺序 | npm.cmd run verify:transcript-state；verify:bridge-startup；verify:script-order（均npm.cmd run） |
| dialog共用合同 | node scripts/dialog-controller-check.mjs |
| 普通/AI阅读高亮 | node scripts/sentence-highlight-ui-check.mjs（自有随机端口/URL；不存在同名package alias） |
| 清单/文档 | npm.cmd run verify:test-inventory；verify:script-inventory；verify:current-documentation（均npm.cmd run），git diff --check及变更JS语法 |

正式focused与Temp底层命令分别记录，不能把替代矩阵冒称为未跑alias。fixture范围与真实owner持久化证据分开：UI合成HTTP成功不证明owner真实durability；既有acquisition实际仓库断言完整执行。

当前Vite加载/播放/交互使用npm.cmd run verify:vite：READ_WEB_PORT指向自有空闲端口，READ_WEB_URL指向本轮自有source服务，READ_WEB_ARTIFACTS_DIR为本轮Temp，并把Vite cache导向Temp。该wrapper会复用已可达URL，因此运行前必须确认服务/PID由本轮创建，不能复用用户服务。若正式wrapper无法满足隔离，则运行其原read-web-load/playback/interactions三份底层脚本并保留实际命令；alias本身标NOT_RUN且说明安全隔离原因，不把底层结果改称alias PASS。不为此修改wrapper或播放逻辑。

本轮不要求npm test/verify:full、全App旧矩阵、R3关闭保存、真实BFCache、跨机、用户provider/Host、扬声器或daily推广，标NOT_RUN/NOT_VERIFIED并说明。不因本轮结果刷新历史全仓Last verified。
基础环境不满足时记录具体阻断，不安装依赖、不删断言。新发现的无关旧故障不静默塞入N1。

## 11. 固定实际入口旅程J1–J6

before/after使用相同合成材料/历史bundle/已熟悉与忽略词fixture，测试数据单独存储、固定hash。构建中实际加载的HTML/assets/CSS绑定source manifest，禁止用旧用户dist冒充before。

before先验证本批fixture能从现有入口进入：素材可打开、整理有可用候选、独立预习具备原资格、SRS有合法队列项。失败时先定位夹具/环境还是原产品合同；不注入私有状态绕过资格，不借N1修复未定的预习积压规则。无法建立必要before时停止依赖施工，报告具体阻断。

夹具可以预置Temp数据快照/声明的HTTP响应和合成AI结果；必须注明哪些是夹具。实际App仍使用真实storage/index/controller/store/owner-adapter代码，不替换AnnotationGenerationStorage、不直接indexBundle或注入preview/markedMap、不调用私有open/claim冒充用户动作。

| 旅程 | 实际动作 | 必须观察 |
| --- | --- | --- |
| J1 入口退休/正常阅读 | 正常App加载并从素材库打开固定文章；走普通/AI两种阅读模式、真实词点击及m标记 | 两button/旧扫描dialog/点线不存在；保留入口可达，mark目标/现有解释/定位/高亮无迁移回归，无新page error |
| J2 已有历史扫描解释 | 由正常恢复/存储读取预置历史bundle；实际点击无手动mark的旧扫描词，切普通/AI模式再点击 | generated索引读到原target/meaning/source；不用已退休toggle来刷新，不把普通词无法显示当成“无mark所以无需验证” |
| J3 合并导入与历史保护 | 预置一个历史扫描项及不同manual target；从现有轻量标注导入入口导入匹配manual target的文件 | 实际bundle保留旧扫描项及source；重建marks时旧项被排除，manual target按原合同保存/显示 |
| J4 本文整理 | 实际整理按钮打开，分别独立场景做候选查看/展开/移出放回/重新学习/发音、手动精简、words/all入库、skip、关闭重开 | 原候选分组与资格、历史专有名词/KNOWN/IGNORED排除、shared AI请求purpose、claim/结果/进度按opening保持；重复点击不产生迁移引入的重复提交 |
| J5 普通AI解释 | 真实mark后从AI解释标注按钮提交固定合成provider结果，经原导入流程读取，再点击对应词 | client共享endpoint/poll及结果读取仍可用，非扫描词的target/释义正确；来源与配置保持，无外部付费调用 |
| J6 独立学习入口 | App“待预习”入口→现有首次接触流程；SRS入口→答案/评分→退出 | 独立预习和SRS可进入、对应数据/目标按原合同推进；词典可选建议仍属于保留消费者，不新增学习规则 |

J4各互斥操作使用独立fixture，不先all入库再把无候选当成words/skip测试。发音验证UI/request/停止及原生命周期，不宣称真实扬声器试听。
J6只验证受影响共享图/入口连通和最小学习路径，不重跑R4全部媒体场景；完整媒体/翻译实现不漂移时继承原固定结论并记录原辅助FAIL。

**导入语义特别限定：** 当前bundle-merge会把本次成功匹配的手工导入项目设为manual-lightweight-import；未被本次导入覆盖的原扫描项原样保留。J3验证后者和mark过滤，不能要求所有新导入JSON中的source=preview-scan都被保留原source；那会变成新的导入规则。先前审计笼统的“导入历史扫描项不生成manual marks”按此具体场景收窄，不修改产品修补另一合同。

一个Temp旅程producer可以调度上述场景，复用已有测试/真实库；不在里面实现扫描、候选资格、排程或owner业务。建议producer/fixture/服务装配分开，单个support script控制在约500行以内；超限/超过已审基线两倍先说明和收窄，不继续堆解释日志的validator。

## 12. 生产外观固定对照矩阵

仅以下8个组合：1280×720及390×844 × dark/light壳 × 两个保留状态。
- 状态V1：正常材料正文、原手工marked词/当前高亮及原历史扫描解释词；分别观察普通/AI模式，after允许点线/两个按钮消失，文本/标记/点击能力与剩余控件顺序保持。
- 状态V2：同数据的整理dialog，含短/长释义、manual/历史候选及已处理项。light dialog主题、footer自然换行、滚动、disabled、控件geometry/focus保持；实际drag/resize按原界限。

loading/空/错误/处理中状态在一个desktop和一个mobile代表组合做保留合同补充，不扩成全状态笛卡尔矩阵。
比较截图+computed+实际操作；待主题/动画稳定及可见数据ready后采样，不能只凭截图或utilities存在判PASS。页面ready使用domcontentloaded、Vue挂载及真实业务/请求边界，bounded timeout，不靠固定sleep掩盖异步。

## 13. 固定独立验收N1-A1–A7

| 标准 | 必须满足 | 直接依据 |
| --- | --- | --- |
| A1 全支路退休 | 两入口/专属dialog/scan-run-toggle API/专用state/高亮/生成写入/富集已退役，无空壳；两个文件经迁移后删除 | allowlist diff/导入图/退休符号核对 + J1实际App |
| A2 历史来源合同 | 来源常量/识别按原语义；旧专有名词/KNOWN/IGNORED资格及source_type不变，不清旧数据 | 历史fixture/service实际断言 + J2/J3/J4 |
| A3 共享根保护 | client/backend/key/storage/mark/acquisition/ECDICT其它消费者保持，controller的整理refresh/dispose保留 | protected hash/有限diff + 正式有效checks及J4/J5/J6 |
| A4 保留入口旅程 | J1–J6有本轮实际动作/观察；focused注入检查不冒充真实入口；UI合成service不冒称用户Host/真实provider | source/asset identity + trace/screens/request/Temp记录读回 |
| A5 CSS与交互 | 只允许两个入口/扫描点线消失及自然重排；共享整理/主题/native/@source及第12节矩阵通过 | before/after生产CSS/computed/截图/真实操作 |
| A6 完整必要检查 | 第10节有效focused完整执行，取消断言明确只属退休子功能，staging读真实保留实现 | 实际命令/环境/退出码/stdout/stderr及断言迁移表 |
| A7 有限交接/回滚 | dirty保护、opening/closing/allowlist、保护身份、有限patch、可执行回滚及自有资源清理齐备 | 文件/结构/hash只校身份；独立审核解释实际业务证据 |

新review发现必须映射上述标准或具体P0–P2产品/数据/回滚失败。不能追加无限输入/日志对抗规则；不要求static validator从日志推断网络/重启真实发生。
本轮未动范围的历史证据可按身份继承，但J1–J6核心实际入口及第12节受影响CSS必须本轮运行，不能全用旧证据取代。
验收未完成的项保留FAIL/NOT_RUN/NOT_VERIFIED，不把取消扫描旧验收写成PASS。

## 14. 交接材料与事实同步

执行根至少交付：
- handoff.md：当前状态、N1-A1–A7/J1–J6/V1–V2结果、实际命令/隔离说明、失败/未覆盖及证据路径。
- opening/closing manifest及责任文件原字节；HEAD/git status、有限diff/patch、protected manifest。
- “旧消费者→删除/保留→真实新位置”表、历史来源逻辑对照、退休/保留断言映射。
- before/after source/assets/CSS hash、截图/computed、真实journey trace/request及Temp存储/记录读回。
- rollback.md及自有服务/PID/端口清理记录。
- provenance：UI/service/数据/provider哪些为合成，哪些实际运行保留实现，哪些结论仅继承。

执行自检完成后停写WAIT_REVIEW。独立审核不修改产品或事实文档，读源码/trace/截图/记录并出报告。
PASS后父仅释放同一writer的最小事实同步并核对范围，记录N1独立PASS；R5旧扫描/双入口子范围标“因功能退休取消”，R5仍等待自身方案定稿/施工/独审。R9和全仓/推广状态不改变。

## 15. 回滚、失败与停止

回滚仅代码：先验证current等于N1 closing；有后续增量时仅反向N1 hunks，不整文件覆盖。
按本轮opening恢复两个退休文件、12份产品修改及对应检查/CSS/映射；不恢复B已退役cloze/query helper/translation queue，不覆盖WhisperX/语言处理或其他dirty。N1无数据迁移，不做数据清理/回滚。

停止条件：
- 新共享消费者、需要修改白名单外产品/数据/API/schema/配置、需要改变保留行为：停止该依赖施工，说明具体原因，先重定范围。
- 同任务连续两次修复/复审失败：停止自动迭代，重新评估简化/拆分/继续，不能默开第三轮。
- 支持脚本超约500行或超已审基线两倍：先说明复杂度、收窄/拆分；不得构造第二套业务或语义证据判定器。
- opening/closing/protected漂移、端口/数据隔离无法保证：停写/停止依赖测试，不接管未知资源。
- 发现保留产品确有P0–P2故障：按固定标准定位；已有且无关的故障记录另案，不能为清退无限追加维修。

修复后只补受影响标准/检查；必要checks通过且无新变化后，不重复全仓/全矩阵。
净工作量粗估：消费者opening/before约0.5–1小时，清退/检查同步约1–2小时，必要checks/实际journey/after与交接约1.5–3小时；执行合计约3–6小时，独立审查另计。不是墙钟承诺，不含环境阻断和新需求。

## 16. 编写时事实（历史记录）

本次仅编写方案及索引/前置说明。产品改动、N1业务测试、before/after构建、旅程和独立审核均NOT_RUN；实际历史数据数量/运行效果仍NOT_VERIFIED。
方案不派工、不创建执行对话、不启动服务、不提交、不推广。下一次明确调度只针对N1；N1独立PASS后再进入R5。


### 2026-10-04 执行增量

用户已明确调度并批准 Temp before runner 修复；fresh context 的 before 对照通过后实施 S1–S3。S4 有真实通过与阻断，S5 交付有限 patch/身份/回滚后停写；不是 N1 独立 PASS。原第16节描述保留为编写时事实。J3 缺口及两次句高亮失败按第15节停止自动追加维修，R5 仍等待 N1 独立 PASS。

N1 本文扫描清退执行记录（2026-10-04）：两个扫描/显示入口及专用生产、显示、词典富集支路已撤除；本文整理、历史来源识别和独立学习入口保留。执行验收未完成：J3 现有手工导入入口不可达，句高亮正式检查失败；独立审核 NOT_RUN，R5 未放行。具体命令、失败与未覆盖项见本轮 Temp handoff.md：C:/Users/0/AppData/Local/Temp/reader-n1-resume-20261004-582b711a/handoff.md。此记录不更新全仓 Last verified 或前轮结论。

### N1 补充验收重定（2026-10-04，用户授权“重订范围后继续”）

原两轮失败保留；本补充单独建 opening，先诊断再修复，不继承旧 FAIL 为 PASS。产品14份清退范围保持封闭，不恢复新手工导入UI，不修node:sqlite翻译仓库。新增允许增量仅 scripts/sentence-highlight-ui-check.mjs 的 Vue remount import 改为从当前Vite转换后的依赖图读取真实Vue，及本方案/当前状态/相关N1状态文档、Temp runner/fixture。

固定补充验收：
1. S-H：正式句高亮完整原保留断言执行，不混用旧node_modules/.vite；每个问题最多两次有限修复失败再停。
2. S-I（替换原J3手工文件UI前提）：通过现有普通AI按钮执行真实client/poll→轻量导入→bundle merge/mark rebuild，验证不同manual target被覆盖且旧preview-scan项source/meaning保持并不生成manual mark；另可调用现有公开轻量模块API作真实文件integration，明确不是手工UI旅程。原独立手工文件选择入口缺口保持NOT_RUN/既有阻断，移出本次N1受影响验收门槛，不伪造UI。
3. S-A：J5真实mark/提交/导入后点击及现有b气泡键，直接读回target/meaning/source并核对poll。修正runner必须由probe证据支持。
4. S-V：用原opening源码副本重新构建before和当前源码after；四组合生产同数据矩阵等待字体、request及动画实际稳定，补desktop/mobile drag/resize、展开、focus/scroll/disabled；代表loading/empty/error/processing边界合成仅HTTP，不改产品候选逻辑。
5. S-D：dictionary:test整入口原FAIL保留；由原opening相同断言与被测源身份证明node:sqlite违规既有且与N1无关，列为继承失败另案。N1字典增量验收只用完整保留client/formatter测试及非扫描consumer protected身份；不把focused PASS写成alias PASS。
6. S-C：closing保护身份、有限增量/累计patch、可回滚、资源清理；只交WAIT_REVIEW，不自行独立PASS/启动R5。

不得修改annotation导入/storage/index/backfill、字典翻译产品或新增入口；若probe显示保留产品确有故障且需越界，报告具体最小范围。证据根：C:/Users/0/AppData/Local/Temp/reader-n1-supplement-20261004-2c83b798。


N1 补充执行（2026-10-04）：用户授权重定后，句高亮完整检查、匹配 target 的普通 AI/真实轻量合并与旧扫描来源/mark 保护、动画稳定的四组合生产矩阵及 drag/resize/focus、代表 loading/empty/长列表/relearn/error 对照通过。处理中 UI 已观测；补充 producer 完成响应合同错误的原 FAIL 保留，停止追加修补。原手工文件 UI 缺口不伪装为旅程通过，按方案补充范围改用既有 AI 导入链；dictionary 全入口的既有 FAIL 保留并有原 opening 复现。独立审核 NOT_RUN、R5 未放行，见 C:/Users/0/AppData/Local/Temp/reader-n1-supplement-20261004-2c83b798/handoff.md；不更新全仓 Last verified。


### N1 独立收口（2026-10-04）

**N1 独立 PASS，限于方案预先重定后的验收范围，现已收口。** 独立审核未发现阻断收口的 P0–P2 问题，见[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-n1-independent-review-20261004/review.md)。最后 completion 补测已闭合精简完成、进度保存及关闭重开读取；原失败尝试保留。原手工文件 UI 旅程仍为 NOT_RUN，dictionary:test 整入口仍为既有 FAIL，按重定范围保留另案；本审核未重跑业务测试。此前执行/补充段落是各阶段历史记录，不再代表当前 N1 状态。

R5 旧扫描/双入口扫描子范围标为“因功能退休取消”，不是 R5 PASS；R5 保留本文整理职责的方案仍须定稿及明确调度，尚未启动。R5 opening 应以 N1 本次收口后的当前源码及 closing 身份为基线，见 C:/Users/0/AppData/Local/Temp/reader-n1-closeout-20261004-e83a5c18/closing-manifest.json，不以 HEAD 或清退前源码代替。未更改 R9、全仓 Last verified 或推广状态。
