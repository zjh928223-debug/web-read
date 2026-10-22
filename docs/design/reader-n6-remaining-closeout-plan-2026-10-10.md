# N6 剩余证据补齐与独立收口方案

2026-10-10。状态：**方案已编制，尚未执行本轮备份、开发预览更新或浏览器补验；N6 整体未正式 CLOSED。** 本方案按用户要求处理原施工/旧数据逐 ID 证据缺口，补最终 patch 的真实浏览器验证；不补造历史、不扩大功能、不操作日常版。当前请求只编制方案，后续由执行模型在收到执行指令后按顺序落实。

## 1. 固定依据、现状与允许范围

依据 [固定首版方案](E:/read-web-next-optimization/docs/design/reader-n6-independent-preview-construction-plan-2026-10-07.md) 的 A1–A12、数据保护和 N6-03，[最新独立审核](C:/Users/0/AppData/Local/Temp/reader-n6-s5-post-save-review-20261010/review.md)，以及 [证据分层/停止规则](E:/read-web-next-optimization/docs/architecture/review-loop-and-evidence-validation-lessons.md)。不另建一套功能验收标准。

| 当前事项 | 已确认状态 | 本方案处理 |
|---|---|---|
| Spec-S1/S2/S3/S4/S6/S7 修复、Standards-S1 成员排除还原 | 前轮源码/受控层有限闭合 | 保留结论和原失败，按最终版本核对相关证据 |
| S5 preload/transition 及保存后重开回归 | 两轴有限 PASS，S5 有限闭合 | 不重新施工；直接回归与真实正常旅程分层 |
| 原 N6 实际施工身份、完整保护副本、旧数据逐 ID 对照 | 原 Standards-S2 / A2/A12：NOT_VERIFIED | 有界找回原件、确定覆盖区间；不可追溯部分如实登记 |
| 最终 patch 的 5184 真实浏览器验证 | NOT_RUN；此前 5184 release 尚未包含最后修复 | 更新开发生产预览，并执行同版本固定代表链与缺项矩阵 |
| N6 整体 | 尚未正式 CLOSED | 只由最后独立 Spec/Standards 判定 |

本轮不允许产品 hunk、共享服务/后端/schema/持久 key/评分/调度/数量/组推进规则的修改。S5 两个文件保持已审结果；不得为取证撤销提交、重造接触时间、删除合法目标或覆盖进行中的组。不安装新浏览器/依赖、不修旧整入口 runner、不运行全仓，不启动 N7、N+1、待定组操作或原文音频播放器。

执行产物默认放在新的 `C:/Users/0/AppData/Local/Temp/reader-n6-final-evidence-<执行日期时间>/`，保护副本放在优化数据根下独立目录并记录实际绝对路径；不得覆盖历轮证据目录。新脚本限取证、原函数受控回归、结构与逐 ID 比较，优先 Temp，各尽量不超过 300 行；约 500 行或已审基线两倍的复杂度警戒仍适用。不得复制学习算法或用日志解析器宣告真实旅程 PASS。

开发范围仅 `E:/read-web-next-optimization`、5184/8776、`E:/ReadWebData/SubtitleWorkflow-Optimization`。日常 `E:/ReadWebDaily/N5-20261007`、`E:/ReadWebData/SubtitleWorkflow-Daily-N5`、5194/5195/8786，以及旧保护树 `E:/read-web-next`、历史树 `E:/read-web` 均不用于取证副本、验收写入、构建、启停或推广；不要求用户退出日常版。凭据沿用现有配置，不打印 token、API key 或完整敏感运行文件。

## 2. 第一步：本轮 actual opening 与版本冻结

1. 读取 AGENTS、固定首版和最新审核，保存当前 HEAD、branch、完整 dirty/status/diff；枚举全部现存 tracked/nonignored untracked 路径及 SHA256，记录既有已删除路径，保存 N6 允许产品文件的完整副本。保留 dirty，不用 HEAD 或旧 N5 源码覆盖当前树。
2. 与最新独审 closing 比较，区分方案文档新增与产品变化。本方案编制前已核对 1,277 文件及四份优化 owner 均与最新独审 closing 一致，见 `C:/Users/0/AppData/Local/Temp/reader-n6-remaining-closeout-planning-20261010/prior-review-comparison.json`；这是编制时事实，执行必须重新捕获。
3. 已审产品标识：use-passage-preview.js SHA256 `00c0c61a90f0633dc0031e1f9037704d4c546b3c166201904e2d9d0cba5b90db`；S5 runner SHA256 `f9d4907927a42cc5f628ae383c689a23f92c82f00b041f81c0c7dc974a71acc0`。其余 N6 产品文件与最新完整 manifest 核对，不只看这两个 hash。
4. 记录实际优化进程 PID、可执行文件/运行目录、数据根、authority/profile 根、实例及启动时间、现有 release 与 front-door 指向。仅凭端口或 `profileId=optimization` 不能认定可操作对象。不允许另一执行者同时改本段源码或写验收 profile。

产物：`execution-opening/`、`baseline-comparison.json`、`runtime-identity.redacted.json`。未归属的产品漂移先停止版本切换并报告；不能沿用“同版本”结论继续验收。

## 3. 第二步：找回原施工证据，固定历史可证明区间

只读进行一次有界检索，先读已有证据索引及其明确引用，再检查优化版留存 release/backup；不全盘搜用户目录，不启动旧版本重放以制造历史。每个候选登记原路径、SHA256、记录时间/版本/profile、原始命令或操作引用、覆盖文件/域/ID、是否截断，以及本次恢复时间。文件 mtime 或文件名不能单独证明采集发生于开工前。

| 已知材料位置 | 可用于核对 | 不能直接声称 |
|---|---|---|
| `reader-n6-construction-planning-20261007/` 的 closing manifest/identity | 施工前规划点及其文件身份 | N6 实际开工原副本、已完成业务保护 |
| `reader-n6-independent-review-20261008/` 的 construction-thread-index、construction-file-diffs、selected-evidence | 原施工操作、时间线、具体 hunk/命令引用 | 截断 diff 等于完整原文件；审核 opening 等于施工 opening |
| 10-09 各轮复审、S5 repair 的实际 originals/manifests/patch | 相应修复区间的真实身份链 | 自动补足更早原 N6 的未知区间 |
| `reader-n5-completion-20261007/owner-final-last-readback.json`、`final/two-data.json` 和 N5 审核 | N5 留存完整 vocabulary owner 候选原件、必选双语境样本及其时间点 | 整个 N6 profile 的开工保护副本 |
| 优化 `.codex/releases/optimization/*/release-manifest.json`、优化数据 `backups/` 及索引明确引用的文件 | 原 release/build/域快照的候选来源 | release/dist 等于全部源码或学习数据备份 |

上表 `reader-*` 默认位于 `C:/Users/0/AppData/Local/Temp/`。本次只确认这些候选材料/目录存在并查看部分索引；没有完成历史逐 ID 比较，也没有确认完整原 N6 保护副本已找回。浅层目录日期查询不能证明其它位置不存在原件。

按“原 N6 开工→各段施工→首次开发真实写入→各修复→最终版本”建 `historical-evidence-index.json` 和 `history-gap-report.md`：

- 完整当时原件且时间/身份可关联：复制到本轮只读材料区，保留原 hash；按实际原件与相应 closing 比较。补交原件发生在现在，不改原采集时间。
- 只有较早或较晚快照：明确标为相应时间点，逐 ID 报告只覆盖该区间。较早基线的所有记录均保留，可以证明这些记录的较长区间保留；它不能覆盖该点以后新增且未留 opening 的记录。
- 完整、有序且与当时独立记录 hash 绑定的 patch 链，可在 Temp 做派生重建辅助核对，标记 `DERIVED_RECONSTRUCTION`、输入原件、步骤和缺段；不把重建副本称为当时已保存的 backup/opening。截断或无独立身份绑定的链保留未知，不自动认定历史 PASS。
- 未找到原件/内容/可靠时间链：对应文件、域、ID 集合和区间保持 `NOT_VERIFIED`，报告已检查位置及缺失项；不能借新 opening、总数、当前 hash、owner revision 或两个新增目标来回填。

**历史检索没有找齐，不阻止下一步在新保护基线上的安全补验；它会继续阻断原范围的整体 CLOSED。** 不补做一次“假装在过去发生”的施工，不通过恢复备份到 live profile 来重演历史。

## 4. 第三步：建立新保护基线并完成真正的逐 ID 比较

在任何浏览器打开可能触发 replay/first-contact 或新 release 激活前，先完成本步。取证打开页面也可能写 owner，不能先浏览后补备份。

### 4.1 完整、可核验的新保护副本

复用 [application-backup 合同](E:/read-web-next-optimization/docs/persistence/application-backup.md) 和既有生产 backup/owner 读取接口。保存六耐久域 reader-session、marks-activity、vocabulary-srs、passage-preview、annotation、workflow 的完整导出、原 record envelope/payload、checksum、revision、registry；覆盖 owner 文件、browser-origin 已知耐久键、receipt/pending journal/owner-mode 等实际保护内容，不能把四个 owner hash 当完整备份。

保存优化 profile/相关文件一致副本和媒体的既有保护方式/引用及实际文件身份。六域导出不包含媒体二进制，须明确媒体字节是另有保护副本还是仍由原路径保留，不把 JSON 包称为所有媒体已复制。记录副本路径、来源、采集锁/lease、前后 revision 及校验结果；运行中随意复制文件不能代替一致快照。既有导出缺 adapter、未知 key、内容不可读或无法保证一致性时，停止依赖该副本的写入，不改备份实现补能力。

只验证副本的结构、校验和、覆盖与可读取性；不在 live profile 恢复、不执行迁移/owner promotion，不把此前未做的回滚演练标为已完成。备份敏感侧材料按既有合同本地保护，公开报告只留身份和必要 ID。

### 4.2 全量逐 ID 方法

对可用历史原件和本轮新 opening 分别建立清单；不要混成一个 baseline。每条使用实际域/记录主键：通常 `id`，学习单元为 `learning_unit_id`；无独立 ID 的 preview 分配/状态按原持久 key、date/batch/item.id 等稳定复合键。不能统一按 `id` 读取导致 unit 为 null，不能以缺解析结果当空域。

规范化仅排序 JSON 对象键；保持数组顺序、缺字段与 null 的差别及全部业务字段。不删除 createdAt/introducedAt/seenAt、原义/短义、评分、完成/毕业史、来源/关系和记录 revision 来让差异消失。owner envelope/receipt/采样元数据另外比较，合法 revision 增长必须解释，不能掩盖 payload 改动。

每个基线逐 ID 输出 unchanged/added/removed/changed；changed 给字段 before/after、影响目标、请求/receipt、原合同允许理由。覆盖旧 word/context/unit、acquisition、learning event/review/rating/history、preview items/progress/firstContacts、allocations/archive/continuation 和关联数据；检查 ID、word/sense/context 关系，无未知删除、重编号、另一义覆盖、重复 unit/event 或静默旧评分/时间/来源分配修改。

必选 N5 样本以当时原件内容为准，不只重新数“1词2语境2单元”：

- word：`vocab_word_462972a3-d83c-43c5-9cb0-65068f50790f`（that's）。
- contexts：`vocab_context_d92aa195-8909-4b60-a10e-41fb189ead44`、`vocab_context_f42f1f2a-ea29-4910-908d-d7ea3fc46180`。
- units：`article-acquisition:891a0c8df87fb3ccafc9e84931d801bf:unit`、`article-acquisition:f1b5543fcba0261dfb2d0a88f7459534:unit`。
- 比较原/短义、同 word_id 下两合法目标身份、关联 acquisition/event/review 和原时间；事件 ID 从原件读取，不推测或造 ID。样本全部一致也只关闭样本对应事实，不代替全旧数据比较。

### 4.3 本轮写入预声明与 closing

维护 `test-target-ledger.json`：每次展示前登记真实 pool/当前组目标、previewItemId、lemma/义项/source、opening 是否已有 contact/canonical/unit/event；仅选择已确认可安全使用的当前组，不覆盖用户未完组。UI 自然形成的新接触保留，按真实 owner 返回记录准确新增/变化 ID。

正常允许差异只按现有合同解释：本轮真正可见目标的 firstContacts、新 word/context/unit/未评分事件，已存 pending 的幂等恢复、测试目标的原导航/revealed/progress 变化及对应 receipt/revision。复用旧 word 增加合法 context 时，旧记录任何变化仍逐字段解释；不能先规定“所有 updatedAt 都忽略”。旧 firstContacts 的 seenAt 和旧评分/完成史不重写；禁止正常生产队列评分或造 ≥24 小时历史。

新 opening→每段 owner 读回→final closing 的逐 ID 比较必须完整通过：所有旧 ID 保留；每个新增/变化能对应实际操作与合同；未知差异为 0。若原 profile 未用于业务写入，也比较其前后身份/逐 ID 内容，不能只凭声称隔离成功。历史区间的未知与本轮新增分别登记。

产物：`protection-baseline/`、`historical-data-comparison/`、`current-data-comparison/`、`test-target-ledger.json`。禁止为通过比较回退 owner、清空数据、删除新合法目标或手工改时间。

## 5. 第四步：把最终版本放到优化生产入口

1. 冻结产品版本，采用最终 S5 已审检查及原固定 focused checks；有完整同 hash 结果可复用并标 `INHERITED`，缺对应最终身份的必要检查才重跑。构建/开发预览激活用既有 `scripts/launch-optimization-preview.ps1`、`config/runtime.optimization.json` 的默认生产流程，不用 DevFallback 代替真实 production Host，不启用 migration/promotion。不改 launcher、runtime 或 provider 能力。
2. 如选择隔离 profile，优先用固定首版允许的优化根下完整耐久副本及现有 authority 隔离接口。核对所有 owner、workflow state/output、browser storage 和实际写入路径；`ApplicationProfileAuthorityIsolationRoot` 仅有参数名不能证明六域全部隔离。媒体等共享只读引用单列。既有部署不能实现安全完整隔离时，停止该路径并记 NOT_RUN，不改路由/服务代码。成果明确标“真实 Host/UI、隔离 profile”，不冒充原用户 profile。
3. 更新前核对原进程拥有权；不得按 profileId 批量停止、扫描终止日常端口，或使用日常配置。本轮保护完成后才允许既有优化 launcher 的版本切换；不手工杀未知进程。保存旧/new release、切换及健康记录。
4. 记录 audit 文件 manifest/hash 与 release 的 sourceSha256/distSha256/releaseId 等各自含义，建立关联，不把不同摘要算法强行比较为同一 hash。核对 launcher/staging manifest、active-release、实际 `/api/app/health`、浏览器 URL 与 Network 加载资源，确认服务端和浏览器真正加载最后 S5 patch 的构建。
5. 浏览器先确认实际平台、已有可执行文件及可用自动化环境；优先使用可工作环境，不因 WSL 找不到二进制推断 Windows 未安装。新建本轮可识别浏览器 context/tab，确认 URL 为优化 5184 后再操作；无法证明来源立即停止该 tab，保存原因。不得沿用未知日常 tab、清用户全局 browser storage 或扩大安装范围。

产物：`release-linkage.json`、优化身份/健康记录、Network 资源索引。只有旧 5184 URL、旧 release 或 4173 verify:vite 通过，都不能把本步标 PASS。

## 6. 第五步：同最终版本补真实链与固定缺项

真实最小链先在 1280×900 执行：优化入口→待预习→当前组来源/数量→只看当前词与英语句且不揭示→精确单目标接触→两个域最终读回→揭示释义→鼠标/键盘前后导航和两种 TTS→保留未接触成员→关闭真实 tab→新建 tab 同入口→恢复同组/位置→再次读回，确认不重复 unit/event。随后 390×844 补当前词句实际可见、导航/释义/TTS/返回和无遮挡截图；两宽处于同一最终 release。

优先使用已有接触的当前项做打开/返回/重进和 TTS；A6/A11 必需的新接触选择 opening 确认未学习的真实目标。浏览新增项都记录 ledger。首/中/末、完成后推进、旧格式/空组等可能影响当前组的场景放完整隔离副本，不通过删除合法目标制造空态。晚到保存 gate 故障维持受控/隔离层，禁止向原 live owner 注入保存失败。

| A项 | 本轮最终版本需补/核对的固定内容 | 证据层 |
|---|---|---|
| A1 | 真实 pool 当前组、原导入受控副本、缺来源；词包/句源分别说明，人数和 locator 可核对 | 真实 UI/字段读回 + 受控缺来源 |
| A2 | 全旧 ID 和 N5 两目标原件对照；again/hard/good/easy 现有资格合同只读 | 两类 baseline 的逐 ID 比较；正常评分 NOT_RUN |
| A3 | G4/D4/原文播放器延期明确，Book 来源范围与旧有效数量/快捷键偏好保留 | 同版本 UI/配置读回，保留延期 |
| A4 | 摘要/列表不批量接触；未浏览成员无新 contact/unit/event；当前组成员保持 | 正常旅程 owner 差异 + 受控摘要负例 |
| A5 | 最终 Host 正常入口/返回；39/40/41/100、有/无/已完组、不可读/不可写原矩阵 | 真 Host 正常代表 + 隔离数值/故障，不伪称线上故障 |
| A6 | 两宽真实词句可见且未 reveal 时接触当前目标；缺句/加载/弹窗/后台等不登记 | DOM/截图 + 双域读回；负例受控层分别标注 |
| A7 | 真关 tab→新 tab 恢复组/位置/状态、逐 ID 无重复；原完成推进、旧格式/错误代表 | 真实 close/open 配对；其余隔离组 |
| A8 | 真实来源句、AI 辅助句、缺句；当前义/short 对齐，AI 不制造 validated anchor，同 lemma 另义保护 | 原共享服务的隔离验证 + 实际目标持久读回 |
| A9 | 鼠标/键盘同目标，首/中/末，输入/IME/录键/设置/上层弹窗/无关键，自定义及中文偏好重开保留 | 可用真实按键/交互截图；合成 IME 明示受控，人工 IME 未做不称真输入法 PASS |
| A10 | 实际词与当前句 TTS play/stop/完成；切词、返回、真实后台 tab 不启动/播放旧目标；迟到回应隔离 gate | 真 provider/media 技术事件 + 受控迟到；声学听辨 NOT_RUN |
| A11 | 真实新目标 firstContacts 与 canonical 两域 terminal committed/最终 owner；重开幂等；失败/未知/冲突/pending 跨组恢复、缺/坏字段 | 真实双域链 + 完整隔离故障矩阵；既有 CAS/receipt 合同 |
| A12 | A1–A11 同版本证据、完整身份及保护比较、最后双轴独审 | 本轮最终报告，不能由施工自宣 |

这是原固定矩阵的补齐表；旧修复不再新增验收标准。既有证据逐项写 `FINAL_VERSION / INHERITED / CONTROLLED / REAL_HOST_UI / NOT_RUN / NOT_VERIFIED` 的来源与真实状态，这些来源标记不替代 PASS/FAIL。内容无变化的源码/受控证据可有理由继承；旧版本的真实截图/旅程不能改称本版本新跑。对所有缺项给结论及引用，不能只补 S5 正常打开便宣布整表完成。

TTS 要有真实音频请求/加载、Audio/media play/stop/ended 或现有技术状态与目标关联；不替换 play 为永远成功、不用 mock 音频宣称实际播放。provider 不可用时保留实际 FAIL/BLOCKED/NOT_RUN，不增 provider。模拟 document.hidden 不等于真实后台 tab；刷新、panel close 不等于真关 tab→新 tab。

保存层每目标关联 previewItemId/义项、firstContacts seenAt、preview operation/revision/terminal、canonical operation/receipt/terminal、word/context/unit/event ID 及最终内容。两个域分别判断，pending/未知不能称 committed；owner GET 不能取代先前 UI 可见事实。不需要新增跨域事务，也不为补验改评分/毕业条件。

S5 最后保存竞态仍由最终源码的直接 gate 回归证明；真实正常关闭/重开补足运行层，不能拿正常冒烟替代故障注入。若真实浏览器可在完整隔离 profile 安全延迟响应，可另记受控浏览器证据，不作为当前 profile 的真实自然故障。

## 7. 第六步：closing、独立复核和正式出口

执行结束保存 `execution-closing/`：完整源码 manifest、opening→closing 精确增量、原始命令 stdout/stderr/exit/时间/运行层、release 链、两宽截图/Network/真实 close-open 配对、各目标两个域读回、全量逐 ID 差异解释、历史缺口清单。产品应零变化；构建/runtime/本轮证据与真实合法数据差异分别列明。证据保存本地保留，历史文件不整份重写。

独立审核最后按 A1–A12 分别给 Spec/Standards；审核者确认是否新跑业务，审阅 raw 材料、版本身份和差异，不能仅由 verifier/施工摘要宣告 PASS。需要双轴独审时使用独立审核模型，施工模型不兼任最终裁定。

| 出口 | 固定条件 | 允许声明 |
|---|---|---|
| 原范围正式收口 | 历史实际施工与完整旧数据保护已由可信原件/区间证据充分核验，原 S2 经独审关闭；最终固定矩阵必需项与新保护比较通过；两轴无阻断 P0–P2 | N6 固定首版范围正式 CLOSED；历史失败及明确未纳入范围的未跑项仍保留 |
| 新基线验收通过，历史缺口仍在 | 当前受保护区间及最终真实链通过，历史部分仍无原件或覆盖不全 | 仅“最终版本在新保护基线上的有限 PASS”；原施工/旧数据历史区间 NOT_VERIFIED，N6 整体仍未正式 CLOSED |
| 必需项失败、数据不明或环境阻断 | 固定必需项 FAIL/NOT_RUN，无法解释旧 ID 变化、版本/隔离身份不明 | 明确未收口，保留原因与材料，不自动修产品 |

**本方案未授权豁免原 Standards-S2。** 若历史确实不可恢复，要改变原 N6 的可声明收口范围，必须另由用户明确重定；新采集与有限 PASS 不能自动完成该授权。本轮先把“已证明什么、仍缺什么”做成可审核结果，不把缺证据写成数据已损坏，也不把“未知”写成“历史未改变”。

只有最后两轴支持相应出口后，才按固定首版 §N6-03 在施工主文档、原草案、CURRENT_PROJECT_STATUS.md 追加准确结果；不覆盖旧 NOT_PASS/FAIL 或整份重写，不连带更新 AGENTS/README/全仓 Last verified/R 状态。追加后再核对产品与数据身份，版本推广/日常更新另案。未找到历史材料时，状态追加必须保留 NOT_VERIFIED 和整体未 CLOSED。

## 8. 停止、保留与交接

- 不明产品漂移、保护副本不完整/不一致、无法证明优化入口或写入路径：停对应切换/浏览/写入，保存材料；可继续不依赖该条件的只读取证。
- 旧 ID 丢失/覆盖、评分/时间/来源被改而无合同依据、另一义误注册、未知当成功：停相关业务，不删目标、不回退 owner、不改 fixture 消除差异。
- 新产品 P0–P2 或需要修改 allowlist 外能力：报告固定 A项、实际触发和证据后停止，不自动进入第四次施工。本方案是剩余取证/验收计划，没有新的产品修复授权；两次修复复审失败停规则继续有效。
- 保留新的合法学习成果、原失败和环境/harness 失败；同一问题的环境修正按实际阶段记录，不把 harness 修正当产品修复或真实旅程 PASS。仅清理本轮创建且拥有权明确的测试页签/临时服务，保留用户服务、已验收优化 release 和数据；不操作日常版。
- 系统重启、多设备、断电、声学听辨、正常 SRS 队列评分及全仓等原未跑项按固定首版边界保留，不以本轮收口语句掩盖。

## 9. 可直接交给执行模型的文本

> 按本方案执行 N6 剩余取证与补验，先保存新的 actual opening 并核对最后 S5 已审身份。仅只读找回原施工/保护原件，逐材料标时间/覆盖/截断；找不到的历史保持 NOT_VERIFIED，不能把新快照改名。浏览器或 release 切换前先按既有六域合同保存一致完整优化保护副本与全量逐 ID 基线，核对 N5 必选双语境/双 unit 原件，登记本轮真实目标与每项合法变化。用既有 optimization launcher/config 将最终 patch 放到 5184/8776，核对路径、数据根、实例、release、实际加载资源；日常与旧保护树不操作。按固定 A1–A12 补最终同版本真实最小链、1280/390、真关 tab→新 tab、词句 TTS 技术播放和两个域 terminal/readback，故障/迟到用完整隔离副本或受控层，层级分开。保留新合法记录和全部原失败，产品代码不改，不扩大功能、部署能力或安装范围。保存完整 closing、逐 ID 比较、缺口和交接，交独立 Spec/Standards；历史 S2 未核验时最多新基线有限 PASS，不能自宣 N6 CLOSED 或默认豁免历史要求。发生具体产品/数据阻断就停止对应步骤，报告，不自动第四轮。
