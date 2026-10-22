# 迁移后清理有限补证交接

日期：2026-10-02（Asia/Shanghai）。本次按 [剩余补证施工方案](reader-post-migration-cleanup-evidence-completion-plan.md) 完成一次有限补证和停止点交接；**原清理与外观/操作保持仍未关闭，等待用户安排独立只读审核**。不自行宣布 CP 全部通过。

| 步骤 | 执行侧结果 | 结束条件和限制 |
| --- | --- | --- |
| S0 | 快照与保护已完成 | 开场HEAD/branch/status、全tracked diff、untracked清单、1196文件hash、12目标副本和原交接副本；结束逐文件比较见下文。 |
| S1 | 当前产物身份对齐完成（执行侧PASS） | 当前before/after两个HTML、全部应用assets、实际响应及当前源码关联已对齐；历史09DD…差异原因单列NOT_VERIFIED，未声称找回历史副本。 |
| S2 | NOT_VERIFIED | 全候选逐项索引已补，6项未确定；没有把定义/生成改名为消费证明或删除产品。 |
| S3 | NOT_VERIFIED | 完成有限生产采样及继承映射；固定必要矩阵、源码browser及停止动作未齐。66对采样一致不能代替完整矩阵。 |

## 1. S0、dirty与文件边界

证据根：[readweb-cleanup-evidence-20261002-01a0fb48](C:/Users/0/AppData/Local/Temp/readweb-cleanup-evidence-20261002-01a0fb48)。以下证据均在该新Temp根；未覆盖旧证据目录。

开场 HEAD `153f9464356c9f59020f4f35ede713a807c798d3`，branch `codex/read-web-optimization`。`opening-identity.json`、`opening-status.txt`、`opening-diff.patch`、`opening-untracked.txt` 保存全部开场身份；`opening-source/` 保存12个清理/检查目标和原交接的可恢复副本。新交接开场不存在。当前 tracked diff 与最新独立 `opening-diff.patch` **字节一致**，清理目标和第二修复after hash一致，见 `independent-source-comparison.json`/`artifact-identity.json`。没有以HEAD diff当本轮diff。

本轮仓库写入只限本新交接及原交接末尾有日期身份勘误/引用。施工方案、产品CSS/JS/Vue/模板/runtime、配置、已有测试、依赖、锁文件及现有dist只读；未build、提交、开任务/聊天/代理/worktree、promotion或归档。未触碰日常/历史树、真实profile、数据根或真实评分。已有WhisperX/语言处理及其他dirty保持。

结束证据：`closing-identity.json`、`closing-status.txt`、`closing-diff.patch`、`workspace-changes.json`，以及两文档 `.this-run.diff`。结束实测只列两份允许文档；其余1195个开场文件hash无变化、无移除，HEAD/branch不变。原交接开场13621字节仍是现文件的逐字节未变前缀，新增勘误仅追加。本次回滚只涉及这两文档：原交接用opening-source副本，新交接原本不存在；不使用reset/clean/HEAD恢复，不恢复其他人的工作。真正回滚仍由用户决定。

## 2. S1当前身份及历史勘误

完整清单：[artifact-identity.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-evidence-20261002-01a0fb48/artifact-identity.json)，说明：[identity-reconciliation.md](C:/Users/0/AppData/Local/Temp/readweb-cleanup-evidence-20261002-01a0fb48/identity-reconciliation.md)。

| 对象 | index.html SHA-256 | srs-review.html SHA-256 |
| --- | --- | --- |
| 原before-dist | F2B3EFDE67C96572CFAF4367F082825F94042BDD269C52FB680A9555D5DB7FF6 | CEC9807FBE94F129D89FB9593A89745FE916CA69125A33C6BEDE0977FD00DB71 |
| 第二修复after-dist | A4C3EDB3C52E774C7509DF3C7E197F300DAF24765758DF2DFDDD1C73EA27119D | 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E |

before为原清理根 `readweb-post-migration-cleanup-20261001-212901-b1592d93/before-dist`；after为 `readweb-cleanup-repair2-20261001-01a0f7a6/after-dist`，都在 `C:/Users/0/AppData/Local/Temp/`。各27个应用assets，两个HTML；after另2个`.vite/deps`缓存元数据单列，不按文件总数替代应用身份。

最新独立audit的两份index与全部asset hash匹配；当前清理源码目标hash及tracked diff一致，因此可继承其已经实测的有限主题/chunk/Toast/glass/WAV/素材R1/R2/SRS/预习观察和12focused，不能继承未测项。浏览器前后目录字节完全不变；[response-identity-binding.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-evidence-20261002-01a0fb48/response-identity-binding.json) 524条实际HTML/assets响应hash均匹配，mismatch=0。`artifact-identity-closing.json`复核两个HTML与全部资产。

原交接第二修复声明 `09DDC3B4E4B4880286861F0E0F4E1CA3327FE075CEB19CC834DD1CF05FFDCE67` 与当前A4C3…不一致。限定四个已知证据根查现有复制/构建资料及index副本，未找到09DD…副本或可核实差异原因；**原因NOT_VERIFIED**。只诚实纠正本次实际身份，不推断只是笔误、遭篡改或恢复了历史产物。旧声明和历史命令保留。

## 3. S2逐候选台账

[完整台账](C:/Users/0/AppData/Local/Temp/readweb-cleanup-evidence-20261002-01a0fb48/candidate-ledger-complete.md) 与 `candidate-ledger-complete.json`；原/当前selector完整逗号分支、属性/context/行号见 `candidate-extraction.json`。当前CSS读取/JS显式读写、theme生成/清除、动态prefix审查见 `dynamic-access-index.json` 与逐变量行。正向badge/file/bubble/video/chunk/Toast/small-button索引位于JSON positiveConsumers。

| 分类 | 口径与可信计数 | 未确定 |
| --- | --- | --- |
| C01 | 110个唯一完整顶层selector/文件（重复media/context归入行数组）：60删除，11共享改写移除旧editor根，38有据保留，1未确定；旧字符串退出19/44/8仅核对线索 | 1 |
| C02 | 原11个退役UI/函数/变量独立条目，继承删除/当前chunk合同证据 | 0 |
| C03 | 36个名字：19删除（根16/SRS3）、12有据保留、5未确定；原/当前CSS定义及theme生成/清除分别记录 | 5 |
| C04 | 原37个名字逐项索引，继承已删除结果；保留preview-vocabulary-word有两个Vue生成链 | 0 |
| C05 | 6个原覆盖对象逐上下文属性索引，继承独立matched/computed及R1/R2；不是重写历史规则统计 | 0 |
| C06 | 原6个已登记检查脚本逐文件索引，断言未改，继承证据 | 0 |

分类重叠不相加成完成率。C01包含当前未改的原owner分支供完整对账，11个共享改写不能当作全规则删除。STATIC_ACCOUNTED是静态索引状态，不是独立CP PASS或浏览器PASS。

6项未确定（只登记，不改产品）：

- C01-001：`styles.css:582` learning-entry owner-exclusion完整分支。`App.vue`当前Teleport只产reader-owned Button，均被该分支排除；未找到当前无owner生成链或具体兼容合同。
- C03-020 `--chunk-annot-default`：CSS root/dark与theme生成/清除均在，无当前消费证明；配对修复保持不等于变量闭合。
- C03-028 `--glass-shadow-lg`：root/dark及theme生成/清除在；无当前读取证明。`ssc2`目前只服务lg生成，不能凭独占计算擅自删除。
- C03-031 `--glass-blur-lg`：定义存在；无当前读取证明。
- C03-035 `--glass-duration-slow`：原glass族保留候选定义存在，缺当前读取/兼容合同。
- C03-036 `--pru-reader-bg`：定义及custom映射存在，但当前消费者不足；不能沿用旧“素材表面消费”族级话术。当前素材实际消费的其他`--pru-*`名字不能代替此名字的证明。

sm/md shadow/blur、panel/button/border/highlight、timing fast/base/ease均有精确CSS读取和保留表面链。五色存储格式/默认值与共享mixHex/hexToRgba计算保持；light/dark/custom两亮度、有效清除/刷新恢复沿用身份吻合的独立audit实际输入结果。未确定不为零，S2不报告PASS。

## 4. S3固定必要矩阵

[逐缺口矩阵与停止点](C:/Users/0/AppData/Local/Temp/readweb-cleanup-evidence-20261002-01a0fb48/missing-matrix.md)、`missing-browser.json` 原始属性/matched/实际响应/请求/错误、`browser-summary.json` 简化索引及同目录PNG。

Chromium145.0.7632.6、1280×800/390×844、DPR1、zoom1，新context/SW block、双侧相同字体阻断/合成输入。16case，139状态，66配对采样属性/矩形/文字/SVG无差异；7组素材状态仅before，明确不计通过。无pageerror；console和阻断不滤成空；startup CLS 0.0032927–0.0075789，均<0.01。

已新增有效观察：reader speed真实hover/pressed/selected/键盘focusVisible；真实单词+m使badge非零；可解码12秒WAV自然推进/跳句；固定file导入预习，录键R→…→Escape后R、存储未变，dialog保持与before相同，中文switch及正常关闭快捷键focus；reader通过新context现有词库row正常恢复有卡，与standalone均历史/录键/揭示答案/固定浅色/自然换行采样。截图已目视390录键及badge表面。

仍缺：

| 固定组 | 必要剩余限制 |
| --- | --- |
| M01 | 当前chunk数据/正文切换，受影响其他owner全部代表状态；真实gate disabled不能代替评分等待 |
| M02 | 新quality/notice/completed/末项滚动等仅before1280；缺after、390、四主题完整配对及关闭focus。复合动作两次定位/关闭失败后停止 |
| M03 | 评分延迟/禁用/防重计数、实际学习播放；关闭页即时focus文本为“返回”，双侧一致，缺等待后的精确返回focus。登记疑点，不确认清理新P2 |
| M04 | Escape后的精确focus节点不足、最终返回reader焦点、完成/等待池；本次录键局部补证不能替代全组 |
| M05 | AI/文章预习词/整理生词按钮因标准素材gate未打开成功；bubble命中和产品视频未测。达到两次失败停止，没强设enabled/identity/DOM |
| M06 | 旧主题/chunk/Toast/glass生命周期可继承；缺当前chunk效果/模式和源码加载路径。真实外部字体/TTS/词典/source不声明成功 |

源码环境：`source-environment.json`。127.0.0.1:5184 bind成功即释放，私有5184 tailscaled PID12748不证明loopback冲突。但没有现有loopback源码服务；授权DevFallback前置数据目录创建、ServiceOnly服务链不满足本次无副作用边界。未启动launcher、不另启Vite或改端口凑证据，source browser NOT_VERIFIED。原before-source/dist作为已知基线不冒充源码运行。

## 5. 逐CP交接索引（不改独立状态）

| CP | 最新独立历史状态 | 本次补证与仍需审核的子项 |
| --- | --- | --- |
| CP01 | PASS | S0副本/hash和本轮逐文档diff、结束保护比较；只修改两允许文档 |
| CP02 | NOT_VERIFIED | 全原候选索引与口径已补，6未确定，不改称0 |
| CP03 | PASS | 当前native/shared正向链索引补齐；C01-001保留分支消费未确定由独立审核判断影响；M05正向状态仍缺 |
| CP04 | PASS | 身份一致的chunk/Toast/退役链证据继承，无本次产品变化 |
| CP05 | NOT_VERIFIED | 逐变量生成/清除/读取完成，5缺消费者；五色/共享计算未改 |
| CP06 | PASS | 两HTML/assets及当前身份绑定，旧R1/R2/matched继承；新素材全必要矩阵未齐 |
| CP07 | NOT_VERIFIED | 66组paired有限CSS/rect/text/SVG/截图补充，M02/M05等未齐 |
| CP08 | NOT_VERIFIED | 新非零badge/录键取消/有卡SRS/WAV观察；评分等待、防重、播放、焦点、模式未齐 |
| CP09 | NOT_VERIFIED | 当前产物hash差异已诚实对齐；12focused继承，源码browser与必要生产状态缺失，正式命令NOT_RUN |
| CP10 | NOT_VERIFIED | 本交接、勘误、未关闭项和停止点完整；必要NOT_VERIFIED不为0，不能宣布完成 |

## 6. 实际命令、继承结果与停止规则

`command-status.json` 保存命令身份、现有脚本hash、实际/继承/未运行状态。12focused只继承最新独立PASS，依据HEAD+tracked diff+脚本身份未变；本轮没产品改动，不反复跑相同检查。

- 实际 `git diff --check` PASS（结束文档后再核，最终日志 `diff-check.log`）。
- 实际Temp浏览器runner第一次smoke因定位错误终止并保存；正式一次runner exit0，但动作含NOT_VERIFIED，不能写整体PASS。
- 本次 `verify:vite`、`verify:production-preview`、`npm test`、build、含live TTS的passage聚合均NOT_RUN。源码wrapper可能在不可达目标时启4173、production wrapper可能启动默认dist，正式load脚本无合成业务隔离；本轮未改变断言或覆盖`.playwright-artifacts`。
- 历史production health404 FAIL、YouTube行为FAIL/清理归因NOT_VERIFIED、verify:vite/npm test NOT_RUN全部保留。替代矩阵不升级正式命令。

本轮未确认清理新增P0–P2；静态未确定与SRS即时focus疑点保留给审核。M02及三M05动作两次失败后停止；无产品修复、无第三补证重试/修复复审循环。支持脚本均低于500行；有限browser补充38行/约18KB，复制audit58行/约16KB与原supplement9行/约5KB，未扩成日志真实性推断平台。

正式runner本轮PID15000的before14995/after6151服务已finally释放；试跑PID24636/9992只停止自有树；结束listener记录证明本轮端口无监听。原tailscaled12748保持，8776未启动。未使用默认production launcher发布新release。

交接至此停止执行，等待用户安排独立只读审核。本次有限补证交接完成不表示原清理闭合。标准原位换肤仍为既有原范围PASS；历史C04/C06、日常版替换与全应用统一保持各自原状态，未promotion。
