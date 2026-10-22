# N6 重定收口方案：当前版本与新保护基线

2026-10-10。**范围已由用户本轮明确重定；本轮只编制方案，保护核对、发布、浏览器补验和最终独审尚未执行。** 成功出口为 `N6_CLOSED_ON_NEW_PROTECTION_BASELINE`，中文声明为“N6 已在重定的新保护基线范围内收口”。不声称原施工历史保护已通过，也不声称全域恢复系统已通过。

## 1. 重定内容与固定依据

用户本轮要求：“按新保护基线收口，workflow 恢复问题另案，历史缺口保留 NOT_VERIFIED；先只读核对完整副本和逐 ID 保护，再补最终浏览器验证和独立 Spec/Standards 复审。不再扩大功能，不操作日常版。”

沿用[固定首版方案](E:/read-web-next-optimization/docs/design/reader-n6-independent-preview-construction-plan-2026-10-07.md)的产品范围、A1–A12 和停止规则。本方案替代[上一剩余方案](E:/read-web-next-optimization/docs/design/reader-n6-remaining-closeout-plan-2026-10-10.md)中“历史 S2 必须关闭才能整体收口”的出口，以及将全域恢复演练成功绑定为当前保护门的执行选择；其它产品与当前数据保护要求继续有效。旧方案、旧 FAIL/NOT_PASS、停止记录和原始证据不改写。

| 项目 | 本次固定处理 |
|---|---|
| N6 功能、S5 竞态修复、v2 登记补丁 | 冻结已审源码；无新产品施工，核对最终版本与已有证据的对应 |
| 本轮当前数据保护 | 完整一致副本、当前全量逐 ID 基线、测试后逐 ID 对照是必过门，不得豁免 |
| workflow 隔离恢复失败 | 原 `RESTORE_POST_VERIFY_FAILED` 保留 FAIL，单独登记；不修复、不重跑，不要求恢复 PASS 才能关闭本次范围 |
| 原 N6 施工 opening/closing、原完整保护与历史逐 ID 链 | 缺失部分持续 NOT_VERIFIED，从本次收口必过条件中移出；不升级为 PASS，不补造 |
| 最终 patch 真实浏览器 | 必须补运行层证据，不能沿用旧版本截图或用 4173/fixture 替代 |
| 最终独审 | 按重定范围的 A1–A12 给独立 Spec/Standards；两轴支持才可声明重定收口 |

**workflow 恢复 FAIL 与历史 NOT_VERIFIED 可以随重定范围收口保留；当前副本不完整、不一致或旧 ID 出现未知变化仍会阻断。** 发现与本轮保护或真实旅程直接相关的具体数据失败须按事实处理，不能因为“workflow 另案”而忽略。

## 2. 现状、版本与隔离

固定参照：

- [v2 第二轮独审](C:/Users/0/AppData/Local/Temp/reader-n6-v2-registration-independent-recheck-20261010-211828/review.md)：两轴有限 PASS，补丁已关闭。
- [最后 S5 独审](C:/Users/0/AppData/Local/Temp/reader-n6-s5-post-save-review-20261010/review.md)：已审源码/受控修复结论保留。
- [上轮停止包](C:/Users/0/AppData/Local/Temp/reader-n6-final-evidence-20261010-212520/execution-closing/stop-report.md)及其 `all-tracked-nonignored-sha256.json`：1,280 个现存文件、8 个历史 tracked 删除，无本轮产品变化；该次完整保护门未建立。
- [独立停止核验](C:/Users/0/AppData/Local/Temp/reader-n6-continuation-stop-independent-check-20261010-213231/review.md)：v2 已进入实际导出包；只有 workflow 隔离恢复 post-verify 失败，不能据此断言源学习数据损坏。

本方案编制前重新核对当前 1,280 个现存文件和 8 个删除项，与上轮 closing 零漂移，HEAD 为 `153f9464356c9f59020f4f35ede713a807c798d3`。编制证据见 `C:/Users/0/AppData/Local/Temp/reader-n6-new-baseline-closeout-planning-20261010-215024/`；该事实只是编制时点，执行仍须保存自己的 actual opening。本方案新增文档作为可归属增量列明，不能冒充产品漂移。

S5 源码 SHA256：`use-passage-preview.js` 为 `00c0c61a90f0633dc0031e1f9037704d4c546b3c166201904e2d9d0cba5b90db`；S5 runner 为 `f9d4907927a42cc5f628ae383c689a23f92c82f00b041f81c0c7dc974a71acc0`。v2 最终 218 行 probe 为 `42da85f790389c0c1c3ae54a01f2afd7ad8a8ac4d6878360c5e217476b9bed3a`。还须比较完整 manifest，不能只核对三个 hash。

允许运行范围仅 `E:/read-web-next-optimization`、优化 5184/8776、`E:/ReadWebData/SubtitleWorkflow-Optimization`。使用既有 `config/runtime.optimization.json` 与 `scripts/launch-optimization-preview.ps1`，不得修改它们。

日常 `E:/ReadWebDaily/N5-20261007`、`E:/ReadWebData/SubtitleWorkflow-Daily-N5`、5194/5195/8786，以及 `E:/read-web-next`、`E:/read-web` 不编辑、构建、启停、验收写入、回退或用作验收副本。不得按 profileId 批量停止服务；实际路径、数据根、PID 和拥有权必须可识别。不要求退出日常版。

执行只产出新的本地保护材料和 Temp 证据。无产品、后端、schema、key、owner/receipt/锁、备份/恢复、provider、launcher、runner 或依赖修复；不改评分、数量、组推进，不安装浏览器，不跑全仓，不启动 N7/N+1、原文音频播放器或推广。

## 3. 第一阶段：只读核对完整副本和逐 ID 保护

此阶段不启动优化应用服务、不打开可能触发 replay/接触的应用页、不恢复/import/promote owner、不创建或删除学习记录。证据写入新的 Temp/优化保护目录，**源文件与源学习数据只读**。现有导出若使用克隆浏览器和截获空白页，可用于仅限 5184 origin 的只读采集：必须无源应用请求/业务脚本，不计作真实浏览器验收。

### 3.1 先核对现有材料，不把失败演练目录当完整副本

保存本轮 actual opening：完整 dirty/status、HEAD、tracked/nonignored 路径/SHA256、8 个历史删除、允许 N6 源文件原副本，以及优化运行/数据/authority 根的身份。与上述审阅 closing 比较；无法归属的产品变化先报告。

只读核对上轮 artifact、源导出、owner/authority 留存与其它已索引的优化保护材料，逐材料记路径、hash、真实采集时点、源实例/域/revision、覆盖和缺项。上轮恢复失败后的 `restored/` 可能已回滚，不是原源副本；`source/` 中的部分空目录也不能算 workflow 全量副本。不得用文件名、总数或四个 owner hash 宣告完整。

上轮 `real-profile-backup.json` 可作为已导出的候选材料，核对 schema、checksum、record 数、v1/v2 原值和未知键拒绝；它不能自动替代原始 owner 文件、完整 workflow JSON、receipt/journal 或采集前后一致性。脱敏/可移植化的 JSON 必须列清删改字段及原件来源，不当作逐字段原值保护。

### 3.2 不足时仅做源只读的保护采集

本方案允许利用既有只读接口/安全文件复制，把缺失的保护内容保存到新目录；不经 restore 构造副本、不调 migration/cutover，不修改保护算法。只读收集器可复用 `materializeRealProfileSource`、限定 origin 的导出和已存在 owner 读取能力，但它们各自只是部分来源，不能靠函数名认定六域完整。

若接口不可用、源在变化、未知键/坏字段/权限阻断或覆盖无法证明，保存具体缺项后停在本阶段；不扩大登记、不过滤键、不改校验，也不自动重试全域恢复。无需为了读文件先启动可能写学习状态的 App/Host。

### 3.3 完整保护的固定判定 P1–P5

| 条件 | 必须实际确认 |
|---|---|
| P1 完整性 | reader-session、marks-activity、vocabulary-srs、passage-preview、annotation、workflow 六域当前耐久内容；实际 authority/owner 原 envelope/payload、revision、receipt、pending/outbox/journal、owner-mode/registry，以及相关已认领浏览器键和 workflow JSON/sidecar 均有覆盖映射；不存在的项须有源查询依据 |
| P2 一致性 | 同一采集区间的源/副本与前后域 revision、目标 origin 逻辑指纹、文件清单/hash 可对应；无未解释写入或相互矛盾的跨域关联。可用既有一致读取/lease，但不能写新 freeze 状态或切 authority。无法证明一致性就不通过 |
| P3 原值可读 | 副本完整读取、checksum/长度/类型验证；原语义/时间/评分/历史/firstContacts 和 v1/v2 字符串保留。源值不能只剩脱敏摘要；敏感材料按既有本地保护方式存放，不打印凭据、不改保护合同 |
| P4 全量逐 ID | 每个域/嵌套记录有稳定真实主键，源与副本逐 ID 内容一致、关联完整，未知丢失/覆盖/重编号为 0；解析失败不能算空域 |
| P5 范围与媒体 | 副本来源和本轮实际写入 profile 明确属于优化；媒体按既有方式另有副本或原路径只读保留，记录存在性/身份及引用。JSON 保护不声称包含全部媒体字节；本轮不改变媒体，不因未全量复制二进制另加恢复验收门 |

“完整”按本表核对所有实际耐久落点；不是必须启动一遍全域恢复。browser 数据仅核对 5184 origin，不能要求共享 Chrome 整个物理 profile 稳定而迫使用户停止日常活动。共享物理文件的变化与目标 origin 逻辑变化分开记录；不能掩盖目标 origin 自身的不一致。

采用真正的主键：word/context 等用实际 id，unit 用 learning_unit_id，事件/评分/receipt 用各自实际 ID；preview 状态用原 key、date/batch/item.id 的稳定复合键。仅排序 JSON 对象键，保留数组顺序、缺字段/null、时间、评分、原义/短义、来源、关系与 revision。逐 ID 输出 unchanged/added/removed/changed，变化逐字段给 before/after，不普遍忽略 updatedAt。

N5 必选当前保护样本：word `vocab_word_462972a3-d83c-43c5-9cb0-65068f50790f`；contexts `vocab_context_d92aa195-8909-4b60-a10e-41fb189ead44`、`vocab_context_f42f1f2a-ea29-4910-908d-d7ea3fc46180`；units `article-acquisition:891a0c8df87fb3ccafc9e84931d801bf:unit`、`article-acquisition:f1b5543fcba0261dfb2d0a88f7459534:unit`。读取真实关联 acquisition/event/review ID、原/短义与时间，保护同 word_id 的两个合法语境/单元，不能用 1/2/2 总数代替内容。

已有 N5 原件可附带核对，结果明确覆盖其真实区间；不能把该样本升级为整个原 N6 历史保护。历史缺口不再次全盘搜索、不倒灌数据重演，只引用既有 index 并保留 NOT_VERIFIED。

产物：`execution-opening/`、`protection-inventory.json`、完整副本/保护 manifest、采集前后身份、`source-copy-per-id-comparison.json`、`new-baseline-per-id/`、`protection-gate.md`。P1–P5 全部通过才给 `CURRENT_PROTECTION_PASS`，进入下一阶段；这不是恢复 PASS，也不是 N6 CLOSED。

## 4. 第二阶段：最终版本放到优化入口

保护门通过后，才用既有优化 launcher/config 激活最终 production 5184/8776。重核对原进程拥有权，不按 profileId 停两套，不使用 DevFallback/4173 冒充 production，不启迁移或 owner promotion。

产品完全冻结。已有 focused/build 结果仅在消费源码 hash、参数和运行层一致时标 INHERITED；必要缺项才运行既有 focused、build、verify:vite。4173 验证只是加载检查，不替代 5184 真实链；无需新增全仓 gate。

默认优先完整隔离优化 profile，但只能使用既有部署接口。记录 owner、authority、workflow state/output、browser storage 和实际写入路径；`ApplicationProfileAuthorityIsolationRoot` 参数名不能证明六域隔离。若不能安全隔离，可在 P1–P5 已保护的原优化 profile 使用安全当前组；不得覆盖用户未完组。任何可写落点均须有自己的完整新 opening，原 profile 未用于验收也需前后只读对照。

核对 releaseId/sourceSha256/distSha256、staging/active-release、真实 `/api/app/health`、5184 URL 与 Network 加载资源，关联最终 S5/v2 源码 manifest。不同摘要口径分别解释，不能强行当同一 hash。保存 `release-linkage.json`、实际运行身份、健康和资源索引。

使用已安装、环境已验证的 Windows Chrome 与现有自动化；不开未知日常 tab，不清全局 browser storage。不能证明 5184 来源/最终 release 时暂停该 tab；不借环境错误扩大安装或改部署。只读采集浏览器和本阶段真实应用浏览器分层记录。

## 5. 第三阶段：同最终版本的 A1–A12 补验

不新增功能验收，沿用固定首版的矩阵。建立逐项 `FINAL_VERSION / INHERITED / CONTROLLED / REAL_HOST_UI` 来源标记与 PASS/FAIL/NOT_RUN/NOT_VERIFIED 状态。旧修复受控证据可有身份依据地继承；旧版本真实旅程不能升级为本次新跑。

| A项 | 本次必需证据与边界 |
|---|---|
| A1 | 真实 pool/当前组来源、人数、locator；原导入副本/缺来源受控对照，词包与句源分别说明 |
| A2 | 原资格合同只读；全量新 opening→closing 旧 ID/原值保护及 N5 双语境/双 unit 内容；原施工前未知区间明确另列 NOT_VERIFIED，不阻断本次范围 |
| A3 | 原 G4/D4/原文播放器延期和 Book 来源说明，旧有效数量/快捷键偏好保留 |
| A4 | 摘要/列表不批量接触，未浏览成员无新增 contact/unit/event，当前成员保持 |
| A5 | 真 Host 正常入口/返回；39/40/41/100、有/无/已完组及读写故障矩阵按最终同 hash 受控/隔离证据核对 |
| A6 | 1280/390 当前词句实际可见且未 reveal 即准确当前项接触；缺句/加载/隐藏/弹窗等负例明确受控层 |
| A7 | 真关 tab→新 tab 恢复同组/位置/状态，两域读回无重复；完成推进/旧格式/错误用安全隔离组或既有同 hash 受控证据 |
| A8 | 真实句/AI 辅助句/缺句及义项、short/来源对应；AI 不造 validated anchor，同 lemma 另义与旧合法目标保护 |
| A9 | 实际鼠标/键盘导航与两宽截图；输入/IME/录键/设置/上层弹窗/无关键/自定义偏好按对应层核对，合成 IME 不称人工输入法旅程 |
| A10 | 真 provider 的单词/当前句 TTS 请求及 media play/stop/ended、切词/返回/真实后台 tab 的目标保护；迟到 gate 保持受控，声学听辨 NOT_RUN |
| A11 | 真实新目标 preview 与 canonical 两域 terminal committed/receipt/最终 owner；真重开幂等；失败/未知/冲突/pending 恢复及坏字段使用完整隔离/既有同 hash 受控矩阵 |
| A12 | 当前稳定版本、完整新保护区间、真实链、逐 ID closing 及独立双轴报告；原历史 S2 明示排除/NOT_VERIFIED，workflow restore FAIL 明示另案 |

最低真实链不可继承免跑：1280×900 优化入口→组摘要→当前词与英语句可见且未揭示→准确单目标接触及两域 terminal/readback→展开释义→鼠标/键盘前后导航与词/句 TTS→保留未接触成员→真关 tab→新 tab 同入口恢复→两域再读回无重复。再用 390×844 同一最终 release 验证词句可见、导航/释义/TTS/返回、无遮挡/无横向溢出。

优先已接触项用于打开/返回/TTS；A6/A11 新接触使用 opening 确认未学习的真实 pool 目标。每次显示前写 `test-target-ledger.json`：previewItemId、lemma/义项/source、组、opening 已有 contact/canonical/unit/event、预计合法操作；实际新增/变化 ID 与 receipt 后续补齐。只增加真实可见目标，不删验收目标、不造 ≥24 小时时间、不跑正常 SRS 队列评分。

readback 每目标记录 firstContacts seenAt、preview operation/revision/terminal、canonical operation/receipt/terminal、word/context/unit/event 内容。pending/未知不能称 committed，owner GET 不能替代词句可见证据。保留原 seenAt，不重写旧评分/毕业史/来源分配。

故障/迟到/空组不能注入原 live owner；使用已保护的完整隔离副本或已有直接调用原函数的同 hash 受控证据，不复制学习算法。刷新/panel close 不算真 tab close，模拟 document.hidden 不算真实后台 tab；mock play 不算技术播放。旧 FAIL 不涂掉，provider 不可用如实报告，不新增 provider。

## 6. 第四阶段：closing 与独立 Spec/Standards

保存完整 `execution-closing/`：源码 manifest/opening 差异，命令 stdout/stderr/exit/时间/版本/hash，release 链，截图/Network，真 close/open 配对，目标账本和两个域终态，全量新 opening→分段 readback→closing 逐 ID 差异解释，以及原 profile 的保护区间对照。

所有旧 ID 保留；合法新增 contact/context/unit/未评分事件、已存 pending 幂等恢复、导航/revealed/progress 和 receipt/revision 变化逐字段对应实际操作与原合同。复用旧 word 的合法变化也解释，不忽略所有时间字段。未知删除、覆盖、重编号、另一义替换、重复 unit/event、旧评分/时间静默改动均为 0。原历史未知与本轮变化不能混算。

执行模型交完整包，不自兼独审，不自宣 CLOSED。独立 Spec/Standards 审核分别检查重定 A1–A12，声明是否新跑业务，读取 raw、身份、消费者和保护差异；不能仅采信施工摘要/自动 verifier，也不重新增加全域恢复成功或历史原件找齐要求。

两轴复审可并行，保持独立；既有修复和 v2 的独审结论按覆盖引用，不重开已关闭问题。发现只可映射固定 A项或具体 P0–P2 当前产品/数据/回滚失败，报告真实触发与影响；不增加无界对抗验收，不把延期/历史/另案误算成当前未实现。

## 7. 明确出口与有限状态追加

| 出口 | 固定条件与声明 |
|---|---|
| 成功 | P1–P5 通过，最终版本真实必需链/固定矩阵通过，本轮完整逐 ID 对照无未知差异，Spec/Standards 均无阻断 P0–P2：`N6_CLOSED_ON_NEW_PROTECTION_BASELINE`；“N6 已在重定的新保护基线范围内收口” |
| 当前保护未通过 | `N6_NEW_BASELINE_PROTECTION_BLOCKED`，只列当前完整性/一致性/主键/隔离的具体缺项；浏览器与 release 依赖步骤 NOT_RUN；不要求先修 workflow restore |
| 当前必需验收失败/缺证据 | `N6_NEW_BASELINE_ACCEPTANCE_NOT_CLOSED`，列 A项、真实 FAIL/NOT_RUN 和材料，停止对应步骤，不自动施工 |

成功后仍附两项保留：`originalConstructionAndHistoricalPerId=NOT_VERIFIED`；`workflowIsolatedRestore=FAIL_DEFERRED_SEPARATE_CASE`。原范围 `originalScopeClosure=NOT_VERIFIED`，不再作为本次范围的阻断条件。不得只写一个无范围的“N6 全部 CLOSED”，也不能继续因这两项保留而将本次成功结果写为“重定范围仍未 CLOSED”。

只有独审支持成功出口，执行者才追加准确状态到固定施工主文档、原草案和 `CURRENT_PROJECT_STATUS.md`，注明用户重定、保护覆盖的真实起止、两轴报告、本轮真实层级及两项保留。不覆写旧段落，不改 AGENTS/README/R 状态/全仓 Last verified，不推广日常版。追加后核对产品和数据身份，文档新增单列。

workflow 另案仅登记原错误、引用、未知根因和“本轮未修/未重跑”；不创建新任务、不修工具，不把路径重绑定等尚未核实的猜测写成根因。

## 8. 停止与执行交接

本轮只做取证和验收。遇源不一致、当前副本缺失/不可读、隔离/版本不明、未知旧 ID 变化、具体新 P0–P2 或必须改产品/部署/校验时，保存原始材料和 closing，停受影响步骤；可继续独立的只读核对，不自动修复。两次连续修复/复审失败停规则仍有效，不进入第三轮自动施工；本方案没有授权新修复循环。

保护核对脚本仅做来源读取、排序/字段比较、结构/hash 验证与取证，优先 Temp、每个尽量 ≤300 行；约 500 行或超过已审基线两倍先解释范围，不把 verifier 做成第二个学习实现。只清理本轮明确拥有的临时页签/服务，不动日常和用户数据，保留全部合法新成果。

系统重启、多设备、断电、声学听辨、正常队列评分及全仓未跑项沿原边界保留，不重新作为本次 CLOSE 的新增门。

### 可直接交给执行模型的指令

> 按本重定方案执行。冻结已审 N6/S5/v2 产品，先保存新 actual opening，只读核对完整优化副本与全量逐 ID 原值保护。上轮 restore FAIL 的 artifact 仅是候选，不当完整副本；不足时只用既有源只读采集/文件复制补保护材料，不 restore/migrate/import、不改工具/校验。按 P1–P5 确认真实六域落点、owner/receipt/journal、5184 origin、workflow JSON、源/副本一致性、原值和稳定主键；无法证明就报告具体当前缺项停止。P1–P5 通过后才用既有优化 launcher/config 激活最终 production 5184/8776，验证进程/数据/authority/release/加载资源；日常与旧树不操作。补最终版本 A1–A12 的真实最小链、1280/390、真关 tab→新 tab、词句 TTS 技术播放及 preview/canonical 两域 terminal/readback，故障保持安全隔离/同 hash 受控层，保留新合法记录。交完整 closing、逐 ID 差异解释和原始证据给独立 Spec/Standards。本次成功声明 N6_CLOSED_ON_NEW_PROTECTION_BASELINE；原施工/历史逐 ID 缺口保留 NOT_VERIFIED，workflow restore 原 FAIL 另案，不作为本次必过门。不补造、不扩功能、不修备份恢复、不安装、不跑全仓、不推广；任何当前数据/版本/保护或具体新 P0–P2 阻断只报告，不自动修复。两轴通过后才追加三个既定状态文档的准确新范围结果。
