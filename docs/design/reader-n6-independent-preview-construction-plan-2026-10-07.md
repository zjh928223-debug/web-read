# N6 独立预习施工方案（固定首版范围）

2026-10-07。状态：施工方案已编制，尚未产品施工或独立验收。可交给执行模型按下述顺序实施；执行开工须先核对当前 dirty/opening。本文是施工主文档，[规划草案](./reader-n6-independent-preview-plan-2026-10-07.md)保留决策来源；冲突时以用户最新答复及本文固定首版范围为准。本文不宣布 N6 完成，也不授权执行本对话直接修改产品。

## 1. 固定交付与延期项

目标：待预习始终能进入；说明这组实际来源、数量和选择依据；看到当前词及对应句子即首次接触；查看释义、考察、毕业和普通 SRS 评分各自清楚；重开、键盘和朗读目标正确，旧学习成果保留。

| 原备注 | 首版交付 | 不纳入本轮实现 PASS 的部分 |
|---|---|---|
| G1/G2 | 实际词包/素材/句子来源、当前组人数与可核对的选择依据；缺记录说明依据不足 | 不编造考试来源、能力、未熟悉或人工选择记录 |
| G3 | 一般/容易作为较熟悉参考，忘记/困难作为不熟悉参考；只读核对已有评分与义项身份 | 不改词库、评分、调度、候选熟悉筛选，不自行选择取最新/最高评分 |
| G4 | Book 只说明现有来源范围 | N+1、测评、难度建模、反馈升级算法本轮暂不实施 |
| G5 | 当前组摘要可见，数量与实际成员相符，原设置有效值保留 | 数量调整新规则、暂不学习/换组继续待定，不新建按钮或改其作用时机 |
| G6 | waiting 积压只提醒，已有组/新组/空组/失败均可进入面板；数据不可写时如实说明 | 不绕过 Host 权限、耐久保存或候选真实可用条件 |
| G7 | 当前可见词+对应句子形成首次接触，未浏览成员不登记；释义揭示与复习资格分开 | 不要求额外开始按钮、标注、评分、朗读或停留时长；不新增共享学习事件类型 |
| G8 | 未完组恢复组/位置/原状态；完成、无候选、旧格式和失败解释清楚 | 完成/下一组新规则待定；保留原推进方式，只解除 G6 的积压阻断 |
| G9/G10 | 词句直接可见，用法展开内容明确；首末反馈、鼠标键盘同目标、输入/弹窗隔离 | 不以导航修补为由改完成条件、引入循环或新完成按钮 |
| G11 | 明示单词 TTS 与句子 TTS；换项/退出/迟到不播旧目标；原文音源缺失如实显示 | 不新增原片段播放器、音源 provider 或媒体下载系统；实际原文音频入口另案 |

文章阅读仍从开始标注单词算学习；文章完成判断不在 N6。N5 已独立收口：[最新审核](C:/Users/0/AppData/Local/Temp/reader-n5-completion-20261007/review.md)。N7 的评分/调度改造不启动，本文只核对原资格合同。组操作待定不是继续追问用户的前置；按上表延期登记，不将历史建议当批准。

## 2. 已只读核对的施工依据

2026-10-07 核对当前源码、原 G1–G11 与 N5 最新报告；未启动服务、调用 AI、写学习数据或运行业务验收。

| 当前消费者 | 已观察到的实现 | 固定施工处理 |
|---|---|---|
| `src/App.vue` 的 Page 挂载；`use-passage-preview.js` 的 open 链 | Page 依赖 items.length；无组/错误以 alert 和文件选择器结束 | 提前显示面板状态，不以是否有词决定能否打开；失败不自动打开文件选择器，保留显式原导入入口 |
| `passage-preview-daily-continuation.js` 的 continuation gate/completed action；use 的 ensure/advance/openFirst | waiting≥40 阻断新组/完成组推进；未完组可继续 | 前端将 waiting 阻断改为提醒；完成后沿用原已批准基线推进方式，不增“手动下一组”规则 |
| Page 的 `isRevealed`、reveal 与句子模板 | 单词先显示，英语句子与释义均在 reveal 后显示；reveal 先保存，再向 App 注册 | 英语句子与当前单词直接展示；按钮只展开释义/中文内容；可见接触和答案揭示分开，不拿 revealed 冒充接触 |
| use 的 saveEnriched/register/reconcile/startup replay | 富集保存也注册；注册失败会返回 null；旧 revealed 可重放 | 富集仅保存内容；新接触使用可见证据与原注册服务。保留旧历史，不以后台富集/隐藏项新增接触；失败保持可重试且不能报成功 |
| preview acquisition 的 findRecord/buildContext | findRecord 有同 lemma 回退；上下文缺来源时可能默认本地真实资料 | 在预习适配器限定同义匹配，保护另义；来源不足不升格真实证据，AI 辅助句不送作 validated anchor |
| preview storage/durable；Python passage_preview_owner 的内容验证 | progress 显式规范化，未知字段会被前端丢弃；durable 的 progress 是对象；owner 按既有 schema 校验并保留 JSON 内容 | 仅给预习 progress 增加向后兼容的可选接触字段；保留现有 schema/key、CAS/receipt/owner 实现，不修改后端 |
| `preview-sentence-source.js`、Page 的 pronunciation 服务 | 当前句子來源可分辨；Page 仅通过 Aria 服务读词和句子，没有原文片段播放器 | UI 说明 TTS 与文字来源差异；原文音频显示未提供，不以 TTS 冒充原音 |

上述潜在边界是施工输入，不是新复现的线上损坏或根因结论。waiting 限制已定位在前端；本次读取的 owner 内容校验不负责 waiting 配额，不能由此承诺所有真实 Host 请求成功。

## 3. 首次接触的准确合同

1. 当前预习卡实际展示单词及对应英语句子即接触；页面可见、当前目标匹配、进度读取已就绪。加载提示、隐藏卡、后台预取/富集、只含词列表/数量/来源的组摘要，以及缺句子时，不登记这些目标。1280/390 两宽保证词句在预习内容中可访问；若其中一个不在可视区域，待两者实际进入可视区域后才触发，不加秒数门槛。
2. 布局沿用现有 Page：先显示词和英语句子；原“看看这个词怎么用”改成准确说明将展开释义/中文的文案。答案揭示仍保存 `progress.revealed`；看到英语词句本身不改 revealed。既有前后导航/末项完成动作及组推进规则保持，不因用户只看词句新增完成规则。
3. 用 `nextTick` 后的当前目标/页面可见状态与实际词句展示触发接触；只发当前 item 的不可变快照。卡片/组 token 作废旧回调；切换、退出、弹窗覆盖或隐藏页面后，迟到加载不能登记另一项。DOM 可见事实由真实旅程验收，不让静态脚本“推断用户读过”。
4. 本方案唯一允许新增的持久内容是**预习自身 progress 中的可选 `firstContacts` 映射**，按 item.id 保存 `{ seenAt, targetSenseKey, item }`，其中 item 是接触时准确词义和来源的必要注册快照。旧字段、key 和 schemaVersion 保留；不改 SeekPlayerDB、共享词库/单元/事件/owner schema。旧 progress 缺该字段正常读取为无新证据，不回填整组、旧日期或旧 revealed。新增映射结构损坏时受控报错并保留原文件，不能规范化成空映射后写回；原初始化/组切换保存进度时必须合并保留已有 firstContacts，尤其是尚未注册的已见目标，不能因切换组丢掉恢复证据。本轮不做接触历史清理。
5. 先将可见接触证据写入既有预习 owner，再调用原 `queuePreviewVocabularyAcquisition` 合同。接触证据 pending 与 canonical 已登记分开显示；注册后的既有 canonical 结果才算“已保存到首次接触链”，不能因 preview 写成功就声称两个域都成功。没有跨域事务承诺；原 CAS/receipt/terminal 合同不改。
6. 保存失败：保留当前内容、准确错误与重试机会；重试使用原 seenAt 与同一义项身份，不重新算首次时间，向已有预习 coordinator 传原 introducedAt。接触证据已保存而注册失败/结果未知时，重开仅按该证据重放、查询原 canonical 身份，不能创建重复 unit/event 或伪报成功；切组后的旧 pending 也按已保存快照恢复，不依赖它仍在当前 items。组完成界面沿用原组状态，但须分别显示当前组接触/保存数量和待恢复项，不把原 completed 直接译成“全部入库成功”。
7. 旧 introduced/unit/event/旧 revealed/历史保持；已注册旧记录照旧读取恢复。旧 revealed 但缺本轮可见证据、尚未注册的项保持历史待恢复意图，不凭后台启动创造新接触时间，实际再次看到该项后幂等登记。原历史文件不删、不改旧评分、不改旧时间；若有证据证明这会丢掉既有耐久恢复合同，停止该增量报告具体冲突，不能删除旧记录来通过。
8. 同词不同义由当前 primaryMeaningZh/pos/targetSenseKey 与既有 canonical identity 对齐；预习适配器不再无条件用另一义的 lemma 记录覆盖当前义。共享服务已有按 word+sense 查找逻辑，先复用；不得修改 N5 词条计数/意义或共享库实现。已存在旧 unit 不改名、不重新编号。
9. AI 辅助句算“已接触内容”，不算真实 anchor；现有 shared schema 下，AI/来源不完整的注册上下文传 null，保留预习展示来源，不伪装 `user_local_exam_material/validated`。确有来源的当前真实上下文沿用原合同；不能拿不同于当前展示的句子证明本次真实语境接触，也不能删除已有合法 anchor。

新增字段是预习内部的兼容增量，纳入下述存储往返/旧数据验收；若实际 owner 不允许保留该字段，或实现必须改共享词库/事件/后端/IndexedDB schema，停止该增量并报告范围差异，不自行扩大。

## 4. 顺序、允许文件与出口

所有路径均相对唯一工作树 `E:/read-web-next-optimization`。每段只改本段列出的消费者；新聚焦模块允许项已明列，不允许整目录重写。执行模型可选择必要子集，不必为凑范围修改全部文件。代码一条写入线；独立审核只读，不同时改 App/存储。

### N6-00 开工核对（只读）

- 用户要求日常学习与开发完全独立：日常版冻结N5副本，规划使用5194入口、5195内部Host、8786能力服务及独立数据根；开发版继续使用本工作树、5184/8776和优化数据根。日常副本 E:/ReadWebDaily/N5-20261007 与数据 E:/ReadWebData/SubtitleWorkflow-Daily-N5 属保护边界，N6不得修改、停止或用于验收写入；开发流程不要求用户退出日常版。两套运行准备状态与启动证据见 docs/operations/daily-development-isolation-2026-10-07.md；以该记录的实际READY/NOT_READY为准，不把规划端口当成已可用服务。此前共用优化服务、等待学习结束的安排已被用户新要求取代。
- 阅读本文、草案、AGENTS、原备注与 N5 最新报告。保存完整 dirty、HEAD、当前所有 tracked/nonignored untracked 文件的路径/SHA256、允许文件原副本；以当前树为 opening，不用 HEAD 覆盖 dirty，不回退到旧 N5 closing。
- 与本次规划 closing 比较；差异逐项归属已有工作。若产品源有无法归属的漂移、保护数据不可读、实际行为与第 2 节关键链不符，先报告，不跳过核对施工。
- 保存优化配置、数据根/owner profile 的身份及保护快照；不打印凭据、不对 daily 数据写入。确认没有其它执行者同时修改本段文件。
- 本次规划证据：`C:/Users/0/AppData/Local/Temp/reader-n6-construction-planning-20261007/`。执行新 opening 的变化不自动等于错误，但不得默默当成已核对。

### N6-01 入口、组摘要和积压提醒（G1/G2/G5/G6/G8）

允许产品文件：`src/App.vue`（仅 preview props/events/挂载）、`src/features/passage-preview/use-passage-preview.js`、`PassagePreviewPage.vue`、`passage-preview.css`、`passage-preview-daily-continuation.js`（仅 waiting gate 与解释），可新增 `src/features/passage-preview/passage-preview-entry-state.js`（纯入口状态/说明）。

- 明确 loading / ready / no-candidates / legacy-format / read-error / write-unavailable 状态；打开即看到面板，返回可用。读取失败不清空保存批次，不以缓存伪装 owner 读取成功；可读缓存仅供只读查看并标明来源/保存不可用。Host 失败与 waiting 提醒分别显示，waiting 不可读显示未知而非 0。
- 组摘要只使用已装载组/原 pool 元数据，逐项显示真实来源和已有定位；缺失显式说明。选择依据只说明真实已知的现有来源分配/导入/记录状态，不声称按评级筛选、N+1或“未见过”而无证据。不请求新算法或新词表。
- waiting 39/40/41/大积压都可进入、有候选时按原生成路径取得组。保留 threshold 常量用于提醒；旧 completed action 在解除 waiting 阻断后仍按原 dated/undated 分支推进。保留原组大小偏好/来源分配/未完组成员，不新增跳过或换组规则。
- 有组不必等所有外部句源/AI 成功才显示入口状态；原材料准备策略可以继续，等待期间可关闭且旧请求不得重新打开页面。仅复用现有 provider，不增加调用种类、凭据或新的 AI enrichment 流程。
- 出口：A1/A3/A4/A5/A7 的本段场景通过；准确说明接触保护在 N6-02完成，不能将入口阶段当作全 N6 通过。

### N6-02 可见接触、用法、恢复、键盘和朗读（G7/G9–G11）

允许产品文件：N6-01 的 App/use/Page/CSS；`src/features/passage-preview/passage-preview-storage.js`（仅 firstContacts 规范化/往返，原事务不改）、`passage-preview-daily-continuation.js`（仅组切换时保留 firstContacts，原事务/推进条件除G6外不改）、`passage-preview-acquisition.js`（预习身份匹配和上下文来源适配）、`passage-preview-shortcuts.js`（输入/快捷键隔离与反馈，偏好保持）；可新增 `src/features/passage-preview/passage-preview-contact.js`（当前展示快照/幂等恢复辅助）。

- 按第 3 节实施；后台 enriched 只保存内容，不单独创建接触。replay 与注册失败可观测，准确展示 pending/失败；payload 和 current card 绑定，不覆盖另义。
- 来源信息用现有 previewContext/realSentence.source；保留 attribution/branding 义务。展开释义与中文不替换词句或注册身份；旧答案状态保持，句子缺失解释原因，不能假报接触。
- 首项说明当前位置；末项保留原“完成首次接触”动作，与到达末项区别；未完重开恢复。输入/IME/快捷键录制/预习设置/上层弹窗不触发背景导航或发音，不吞无关按键。保留 Space/R/S/C/左右的有效自定义值及中文按住/持续偏好。
- 复用既有 Aria 服务，只在 Page 层补当前 token/退出/切换/隐藏保护；单词和句子 TTS 标明音源与正确目标。原文音频本轮不建播放器，当前无原音时明确“未提供原文音频”；文字是真实语境不等于音频是真人原片段。
- group history、既有 SRS 评分/毕业延迟条件只读；不为测试更改 createdAt、introducedAt、旧评分或造一个≥24小时事件。不扩大 Book 来源、不重建 familiar 筛选。
- 出口：A2/A6/A8–A11 本段受控验证及真实代表保存/重开通过；再进行 N6-03。

### N6-03 稳定版本真实补验和独立收口

不再增加产品 hunk；在同一稳定源码/生产构建运行第 5 节矩阵，保存实际版本身份、Network/截图/交互/owner terminal 与持久读回。1280×900 和 390×844 两宽同版本。新的合法词/语境/unit保留，不删除验收目标。

独立审核按 A1–A12 分别给 Spec/Standards 结论；审阅者可核对源码、消费者与已保存真实证据，不能把 fixture 当作真实 Host/UI/媒体证明。总审要求交付范围内无阻断 P0–P2；审阅者是否新跑业务另行写明。

只有两轴通过后才允许在本文/草案及 `CURRENT_PROJECT_STATUS.md` 追加本次有限范围结果；其余状态文件需另列准确增量，不能借收口整份重写。追加后核对产品/数据身份零漂移。未启动的 N7、待定 D4、暂不实施 G4、原文音频新播放器和未跑项分别保留，不宣布原 G1–G11全量无延期完成。

### 明确不允许修改

`PassagePreviewSettingsDialog.vue` 的数量行为、`passage-preview-learning-history.js`、`passage-preview-durable-state.js`、import/句源/preload/cache/翻译模块、`PassagePreviewCheckPage.vue`、`src/services/vocabulary/**`、`src/features/srs-review/**`、TTS 共享服务、Windows owner/HTTP/后端、N5 整理/计数/性能、N4、AI provider/credential、shared durable/lock/receipt、thin entry、`package.json`、IndexedDB schema、daily/historical 树。它们可只读，若必须改，明确具体原因/文件/数据差异后停止对应增量，不自动扩界。

## 5. 固定验收 A1–A12

执行开始就冻结本节，不在独审末尾添加无限标准；新增发现只有映射本节或具体 P0–P2 产品/数据/回滚问题才可阻断。待定/延期按第 1 节登记，不伪装 PASS。

| 项 | 固定验收与代表场景 | 证据要求 |
|---|---|---|
| A1 来源/理由 | 一组真实 pool 候选、原导入记录的受控副本、来源缺失项；摘要人数=实际成员，词包/句子来源分别说明，实际 locator 可读或显示缺失 | 字段读回+UI；不编造熟悉/N+1结论 |
| A2 评分和旧成果 | 只读核对 again/hard/good/easy；无记录/另一义记录不冒充当前熟悉；D2不改过滤/评级规则；N5实际双 context/unit 原/短义与事件逐ID保持 | opening/closing规范化逐ID比较；正常生产队列不评分 |
| A3 延期表达 | G4/D4与原文播放器明确暂不实施/待定；Book只说来源；旧有效数量/快捷键偏好保持 | 源码diff+UI文案；不将延期项计实现PASS |
| A4 组摘要 | 未浏览当前组不批量创建unit/event；仅摘要/列表无firstContacts；当前组成员/数量保持 | 受控存储差异+真实面板代表；无新跳过/数量规则 |
| A5 入口/积压/Host | waiting39/40/41/100；未完/已完/无组；正常/不可读/不可写；可见面板且返回可用，有候选不被waiting阻断，失败不清数据/假报保存 | 数值边界用受控测试；真实Host正常代表路径；故障注入单列，不能称真实故障发生 |
| A6 接触起点 | 词句可见即接触；只词/缺句/隐藏/后台富集/加载/摘要不接触；未展开答案仍revealed=false；准确当前目标，无秒数/按钮门槛 | DOM实际展示+单目标firstContacts保存+canonical读回；后台受控负例；两宽代表 |
| A7 重开/恢复 | 部分接触且未完的真实关tab→新tab→恢复同组/位置；已完沿原推进方式；缺候选/旧格式/读取失败可辨；重开不重复unit/event、不丢历史 | 真实关闭页签和重新进入证据；fixture只证明相应模拟场景 |
| A8 词义/句源 | 同 lemma 不同义受控预习身份验证；一真实来源句、一AI辅助句、一缺句；当前释义/short若存在与义项相符；AI不增加validated anchor；N5双义原样保持 | 用原共享服务/模型在隔离数据验证，不复制一份学习算法；实际新目标读回 |
| A9 导航/输入 | 首/中/末、鼠标/键盘同目标；输入/IME/录键/预习设置/上层弹窗/无关按键；自定义键和中文偏好重开保留；两宽无横向溢出/关键操作遮挡 | 真实交互+截图；末项保留原完成动作，不新增组规则 |
| A10 音源/退出 | 实际词TTS、实际当前句TTS技术play/stop/完成；切词/关面板/隐藏/迟到回应不播旧词，不能取消新词后再报旧完成；无原音明确不可用 | 真实技术播放和受控迟到分别登记；声学听辨保持NOT_RUN，除非人工实际完成 |
| A11 保存/幂等 | 连点/快速切换/退出；接触证据写失败、注册失败、结果未知、受控冲突、重开/切组后pending恢复；缺字段兼容、损坏字段不写回清空；证据与canonical分域正确，不把pending称成功；原CAS/receipt/耐久合同保持 | 隔离故障注入+真实新目标两个域terminal committed/最终owner读回；不为验收删除目标或改旧时间 |
| A12 独立收口 | 同稳定版本矩阵和固定A项两轴复核；实际dirty/diff/数据身份可追溯；总审后仅既定状态追加 | Spec/Standards报告、源码closing、数据保护比较；历史FAIL/NOT_PASS/NOT_RUN保留 |

最低真实链：优化Host正常→实际待预习入口→查看当前组来源/数量→只看到词句且未揭示答案→登记准确当前目标→显示释义→前后切换/两种TTS→保留部分未接触项→关真实tab→新tab重开→owner最终读回。完成组推进和数值/故障矩阵另用隔离组覆盖，不用删除合法词让状态变空。

真实数据写入先保存优化 profile 完整保护副本/逐ID内容，并选一个从真实 pool 获取、opening确认未学习的新目标；不得覆盖现有进行中的用户组来制造样本。若当前组不可安全使用，在优化根下用完整耐久副本的隔离profile验收，保留结果并明确“真实Host/UI、隔离profile”，不能冒充用户原profile旅程。所有正常生产 SRS 队列评分保持 NOT_RUN。

## 6. 检查命令与脚本边界

本次规划没有运行下述命令。执行按修改范围使用，不跑全仓或修旧失败runner：

- 入口段：`npm run verify:passage-preview:daily-continuation`、`npm run verify:passage-preview:learning-plan`。若已通过的 daily 单元断言期待旧waiting阻断，仅在该单元对应断言按A5改验收，不重写runner；旧运行结果保留。
- 接触段：`npm run verify:vocabulary-preview-acquisition`、`npm run verify:passage-preview:durable-state`、`npm run verify:passage-preview-shortcuts`；需要比较的原词库acquisition合同检查只读运行，不修改共享实现。
- 最终构建：`npm run build`、`npm run verify:vite`；后者是既有Vite隔离加载检查，不能代替真实优化Host保存。实际手工/Host旅程仅用 `scripts/launch-optimization-preview.ps1` 与 optimization配置、5184/8776、优化数据根；不复用日用端口/数据。
- 可新增 `scripts/passage-preview-n6-contact-check.mjs` 与 `scripts/passage-preview-n6-browser-check.cjs`，或等价保存于本轮Temp的定向检查；可改 `scripts/passage-preview-daily-continuation-check.mjs` 中A5对应断言。新脚本各尽量≤300行；单个支持脚本超过约500行或超过已审基线两倍时，按AGENTS说明复杂度并先重新评估边界。复用真实模块和隔离数据，禁止复制学习算法或用静态文本宣告旅程PASS。
- 新browser检查显式连接本轮已启动的优化入口，不自己占日用端口；真实Host业务记录与拦截/fixture层分列。旧整入口 `verify:passage-preview` 自带4197与live TTS，不作为本方案真实Host证明，不为使它绿联动修旧runner。

每条命令登记原始stdout/stderr、exit code、版本、时间、运行层和新结论。必需项失败就保留FAIL并按允许范围修；旧断言若与本方案已固定新行为冲突，单列原FAIL及冲突，由新定向测试和独审按A项判断，不改无关runner、不把旧失败涂成通过。两次连续修补/复审失败后停止自动迭代，请用户决定简化/拆分/继续。源码检查不能代替实际关闭重开、技术媒体播放或owner持久读回。

## 7. 数据保护、回滚与停止条件

- opening保留当前dirty每个允许文件的完整副本与hash、既有历史FAIL、全学习数据逐ID保护清单；比较词条/语境/unit/acquisition状态/事件/评分/学习历史及preview allocations/archive/continuation，不能只比总数。N5同word_id双语境/双unit、原/短义为必选保护样本。
- 新合法接触、word/context/unit、firstContacts和素材保留。预习注册新目标的必要新增可登记准确ID与原因；旧记录任何修改须解释原合同允许效果，不能声称“数据都一样”而只看hash总数。原评分/完成史/来源分配不可静默更改。
- 每段保留相对实际opening的产品增量patch、命令/业务证据与closing。回滚先核对当前位置/hash，只逆转本轮准确hunk；禁止整文件覆盖dirty、git reset/restore/clean、回退owner备份抹掉学习成果。接触字段回滚需保留原耐久文件副本及新增记录；旧前端会规范化丢弃新字段时，不允许直接启动旧版本写回，先制定只保护/兼容方案。
- 不改Word/SRS/schema、后端、持久化锁/receipt/备份、provider凭据或protected树。发现必须越界、当前数据保护比较失败、未知保存被当成功、真实目标/词义不一致或不明产品漂移时，停止对应写入并报告具体A项/差异，不用删目标/fixture替代/假PASS补洞。
- 独审按固定范围收口；保留原FAIL/NOT_PASS/NOT_RUN、未跑系统重启/多设备/声学/断电/全仓。不更新全仓Last verified、R状态、不提交/发布/推广。仅清理由本轮创建的测试服务/页签，不动用户服务；数据留下。

## 8. 可直接发给执行模型的启动文本

> 你作为执行模型，阅读 E:/read-web-next-optimization/docs/design/reader-n6-independent-preview-construction-plan-2026-10-07.md 及其引用草案、AGENTS和N5最新独立审核。先只读保存并核对当前dirty/opening与数据保护身份，一致后按N6-01→N6-02→N6-03单线施工。严格按允许文件及固定A1–A12验收，再独立Spec/Standards复核。预习看到当前单词及对应句子即首次接触，不等答案/评分；只修改预习内部接触证据与既有注册调用，不改共享词库/评分/调度/schema/后端。N+1不做，组数量/暂不学习/换组/完成后下一组的新规则待定，不自行设计；G6只解除积压阻断，保留原完成推进方式。保护N5双语境/双unit和全旧学习数据，保留新合法目标，原FAIL/NOT_PASS/NOT_RUN不回改。原文音频本轮只说明是否提供，不新增播放器。不联动N5性能/UI或旧失败runner，不推广。越界或数据风险按本文停止条件报告；两次连续修补/复审失败停下。最后按原备注→实际改善→是否完成/延期登记新结论。
