# 已确认 UI 固定收尾：执行指令（供 5.6-luna-max 使用）

日期：2026-10-19。状态：**固定范围已由用户确认；本次只编制文档，未启动下列产品施工或验收。**

用户将本文作为施工任务交给执行模型后，只执行本文的两项施工和一次限定验收，完成后停写交接。不要另外提出全站改版、底层前置工程或“下一轮统一清理”。本文不是 N6/N7 延期项、N9–N11、日常推广或旧失败 runner 第三轮修补的授权。

## 1. 任务与终点

你的工作目录固定为 `E:/read-web-next-optimization`。你是本轮唯一产品写入者，串行执行，不创建 worktree、新任务或并行写入代理。

原目标是现有 Tailwind + shadcn-vue 默认外观、标准尺寸、原位保留布局与操作。该原定范围已有独立 PASS 记录，不能重新宣称整套尚未施工。现在只处理后续功能界面的以下欠项。

| 固定项 | 唯一施工内容 | 完成条件 |
| --- | --- | --- |
| UI-1：N8 剩余呈现 | 在已有素材任务/解释历史界面展示现有请求与运行记录来源；保留第一批配置/用途成果 | 实现下文第 5 节，并按原 N8 A1–A12 分层验收；未通过项不得写成 PASS |
| UI-2：SRS 两处样式覆盖 | 只修 `.srs-review-save-retry` 与 `.srs-review-play-sequence` 的默认配方覆盖 | 三个普通按钮恢复共享默认字号、内边距/间距，位置和行为不变；详见第 6 节 |
| 一次限定验收与交接 | 检查上述改动及其直接回归，停产品写入，交一次按固定范围的独立审核 | 按第 7–9 节交付；不得以发现其它 CSS 或历史未验证项为由新增工程 |

两项是范围编号，不是两套新架构或要求分多个对话。没有用户新的明确需求，不得增加第三项施工。

## 2. 必读依据与当前事实

按下列顺序读取；不要重新扫描全仓来定义另一套要求。

1. `E:/read-web-next-optimization/AGENTS.md`。
2. 本文全文；以及 `E:/read-web-next-optimization/CURRENT_PROJECT_STATUS.md` 的最新顶部摘要。
3. `E:/read-web-next-optimization/docs/design/reader-n8-ai-transparency-plan-2026-10-19.md` 第 2–6、8 节。原 A1–A12 是 N8 固定验收，本文没有降低或增加其标准。
4. 第一批交接：`C:/Users/0/AppData/Local/Temp/reader-n8-stage1-20261019-103443/handoff.md`、同目录 `source-table.md`、`a1-a12-coverage.md`、`command-log.md`、`closing/allowed-file-hashes.json`。
5. 原默认配方边界：`E:/read-web-next-optimization/docs/design/reader-shadcn-default-inplace-plan.md` 第 1–2 节，以及只读的 `E:/read-web-next-optimization/src/components/ui/button/button-variants.js`。

必须继承的状态：

- N8-00/01 已实施。普通层模型输入、一个保存动作、配置读写状态、六项用途说明已有代码，不重做、不复制第二个模型输入。
- 第一批 focused、build 通过；受控设置整体 PARTIAL。旧 panel browser runner 在 retired `.youtube-filter-tabs` 超时 FAIL；`verify:vite` 有 Vue mount 15 秒超时 FAIL。
- 第一批 Temp harness 两次连续失败已经停止。不得修它第三次，不得换名字或复制成新脚本规避停止规则。N8-02 新呈现的必要定向检查是另一固定子范围，也不得借它重做旧 runner。
- N8 A4–A7、A9 为 NOT_RUN；A11 为 NOT_VERIFIED/NOT_RUN；A8/A10/A12 为 PARTIAL，独立 Spec/Standards NOT_RUN。执行 opening 时若已有较新交接，只核对本范围实际漂移并保留证据，不回滚他人增量。
- N6 仍为 `N6_NEW_BASELINE_ACCEPTANCE_NOT_CLOSED`；N7 主体已有实现但 H7 组件与 A7/A10 真实链未闭合。本文不恢复这些验收，也不改学习/评分逻辑。

上述 Temp 文件若缺失，只登记原件当前不可复核；不得补造，也不把缺失变成重做全专题的理由。

## 3. 文件白名单：只能改这些位置

“允许”不等于每个文件都必须改。已有代码能直接完成时，不新增 helper、脚本或重复状态。

| 允许的产品文件 | 允许内容 |
| --- | --- |
| `E:/read-web-next-optimization/src/components/YouTubeWorkflowPanel.vue` | 在原任务详情补来源标签；保持第一批配置/用途、素材列表、打开、修复、保存合同 |
| `E:/read-web-next-optimization/src/features/annotation-backfill/create-annotation-backfill-dialog.js` | 当前选择、请求/运行记录、历史缺失及合并边界的简短展示 |
| `E:/read-web-next-optimization/src/composables/annotation-backfill-ai-module.js` | 仅把已有 runContext/response/history 事实传给展示层，补现有自动切换的说明；不改执行决策 |
| `E:/read-web-next-optimization/src/services/ai/ai-provenance-presentation.js` | 必要时新增无副作用的展示归一化；不建立新配置/执行 owner |
| `E:/read-web-next-optimization/src/styles/workflow-ui.css` | 必要时为新增来源文字补局部换行与布局；不改全局控件、字号或主题 |
| `E:/read-web-next-optimization/src/features/srs-review/srs-review.css` | 仅第 6 节两个精确选择器；这是相对原 N8 保护范围的唯一局部样式例外，不开放其它 SRS 文件 |

允许的检查文件仅为：

- `E:/read-web-next-optimization/scripts/ai-provenance-presentation-check.cjs`：必要时新增，针对真实展示逻辑，不复制模型选择/缓存算法。
- `E:/read-web-next-optimization/scripts/youtube-workflow-panel-v3-check.cjs`。
- `E:/read-web-next-optimization/scripts/youtube-workflow-panel-v3-browser-check.cjs`。
- `E:/read-web-next-optimization/scripts/annotation-backfill-ai-module-check.cjs`。

后三个只允许补本次来源呈现的必要断言，不改或删旧断言追绿，不修 retired filter、通用挂载等待或其它旧 runner 问题。临时证据和有必要的 N8-02 受控 harness 放新的系统 Temp 目录，不成为绕过停止规则的新框架。

结果文档仅更新：本文、N8 首版方案、两份路线图、`E:/read-web-next-optimization/CURRENT_PROJECT_STATUS.md`。不顺带改 AGENTS、README、PROJECT_MAP、全仓清单或 package/lock。

## 4. 禁止扩展与隔离边界

- 不改后端、HTTP/client、owner/repository/UOW、学习资格、评分、导入、缓存/合并算法、模型路由、持久化格式或 IndexedDB schema。
- 不改 `E:/read-web-next-optimization/src/features/srs-review/SrsReviewPage.vue`、其它 SRS JS、N5/N6 产品或共享 Button/Input/native helpers。
- 不改薄 runtime/session 入口、脚本加载顺序、运行配置、凭据实现、启动包装；不装/升级依赖，不初始化或迁移数据。
- 不做新主题、气泡外观重设计、Uber 布局重组、通用 CSS 清零、组件库重建；不把发现的新残留顺手加入。
- 正文、高亮语义、播放器、气泡、专用候选行、原生文件/颜色/媒体控件维持原批准例外。
- N9 多服务、N10 回收站、N11 素材组织不是前置，也不施工；月度总览等另案维持原状态。
- 不新建真实 AI 任务，不调用付费 AI，不写学习数据；受控生成/导入检查须注入测试依赖，不能落到真实 Host mutation。
- 不操作 `E:/ReadWebDaily/N5-20261007`、`E:/ReadWebData/SubtitleWorkflow-Daily-N5`、日常 5194/5195/8786；不使用旧日常 5174/8766。
- 不编辑、构建、启动或提交 `E:/read-web-next`、`E:/read-web`；本任务也无需读取它们。
- 开发运行仅使用既有隔离入口、`E:/read-web-next-optimization/config/runtime.optimization.json` 和开发 5184/8776。启动前核对路径、数据根、端口和 PID 所有权；不得按 profileId 批量停服务。
- `E:/ReadWebData/SubtitleWorkflow-Optimization` 的既有学习数据、原优化配置只读。N8 A9 仅在既有入口能提供可证明隔离的测试配置副本时进行真实保存；做不到就 NOT_RUN，不新造隔离/迁移包装。
- 不 reset/restore/clean，不整文件覆盖 dirty 成果，不提交、推送或推广。只停止本次自己启动并已确认归属的进程，不清浏览器原有数据或存储。

## 5. UI-1 的逐步施工合同

### 5.1 Opening：保存当前状态，继续现有成果

建立新的系统 Temp 证据目录，保存 git status、允许文件原件/哈希及相关源码身份；基线用当前 dirty 工作树，不用 HEAD 代替。对照第一批 closing，核对其四个交付文件和解释 controller/dialog 的当前版本。

同一文件若存在其它执行者正在写入，先停本文件写入并报告，不覆盖。不要为了“干净基线”清理旧成果。已知第一批状态无需重跑来证明存在。

### 5.2 素材任务：只展示当前所选记录自身的事实

1. 使用现有任务详情/结果入口，不创建新的设置中心或日志仪表盘，不改素材列表排序与打开操作。
2. 读取所选 job 已有 `request.model` 等字段，文案为“任务请求模型”；不要用设置页当前输入填充历史。
3. 若记录已有模式字段，按原值说明真实请求、开发模拟或未调用远程模型；没有字段就说明“未记录”，不根据默认配置猜测。
4. 请求字段不能证明网关最终路由。没有服务商执行证据时说明“实际执行/路由模型：当前记录未提供”。
5. 选择任务 A 后改配置为 B，A 的来源仍取 A；切换任务或迟到响应只能更新仍匹配当前 job/run 的展示。只补必要的展示身份保护，不重构生命周期。

### 5.3 解释：当前选择、提交请求、运行记录分别呈现

1. 保留解释弹窗自己的模型选择，与素材模型不合并；保留输入、API key、按钮、取消、导入、关闭和焦点机制。
2. 展示当前选择；请求发出时使用现有最终 `runContext.model` 说明“本次请求模型”。原选择 A 经现有批量规则切为 B 时，说明原选择 A、最终提交 B 及原有切换原因。
3. 不改 `shouldUseRecommendedBulkModel`、推荐模型常量、触发条件、请求模板/字段或模型持久化策略。不得为了展示增加一次请求。
4. 每条历史的 model/runId/generatedAt 取该条自己的已有记录，文案为“本次运行记录模型”。旧 A、另一次 C 与当前 B 分开；没有 model 显示“未记录”，不借当前值回填。
5. 记录缺失、仅有 request、仅有 metadata、run 不匹配分别诚实说明；不存在的逐条来源不推导、不存储。
6. 复用说明“复用已有结果/未调用 API”；`mergeWithLatest` 只说明该轮为合并操作，不把所有旧词条标成最新模型。缺少逐条来源时明确边界。
7. mock/off 只在现有证据支持时标为模拟/未调用；缓存、合并、mock 的处理本身保持原行为。
8. 打开摘要、刷新摘要或切历史只使用已有读取结果/读请求，不保存配置、不生成、不翻译、不精简、不写学习记录、不加轮询。

### 5.4 保留第一批配置与用途成果

普通层保持一个素材模型输入、一个原保存动作。当前选择、后台已读、未保存、读取中/失败、保存中/失败/成功仍分别可见；GET 未成功时保存保护继续有效，保存 payload 与原 client 合同不变。

保留六项用途说明：WhisperX 本地转写、素材切分、素材翻译、解释弹窗、短义后端默认、独立句子翻译。不要改短义 controller、翻译缓存或转写实现来补标签。凭据只显示已保存/未配置/未知，不回显 key、敏感 URL，也不把凭据 provider 当 AI 服务商。

展示 helper 如有必要，只接收现有数据并返回文字/缺失原因；不选模型、不解析任意日志推测执行、不实现第二套状态机。

## 6. UI-2 的精确改动与验收

当前消费者均在只读的 `E:/read-web-next-optimization/src/features/srs-review/SrsReviewPage.vue`：一个“重试原评分”和“播放单词/播放原句”两个普通 Button，均已使用 `size="default"`。

只在 `E:/read-web-next-optimization/src/features/srs-review/srs-review.css` 改：

1. `.srs-review-save-retry`：移除局部 `min-height: 28px`、`padding: 3px 8px`、`font-size: 11px`；保留 `flex: 0 0 auto`。由已有 Button 默认配方控制尺寸与文字。
2. `.srs-review-play-sequence`：移除局部 `gap: 5px`；保留 display/align-items 等布局声明。采用共享 `gap-2`。

不要改同名 group、svg、kbd、其它按钮规则，不更换 variant，不改文案、事件、禁用状态、保存重试合同或评分。无需改 Vue 模板或全局 Button 配方。

以实际产品组件及 CSS，在 1280×900、390×844 核对：

- 三个按钮 computed 字号、padding/gap 与其共享配方一致；默认高度为 h-9。16px 根字号时通常为 36px、text-sm 为 14px、gap-2 为 8px；有 SVG 的 padding 按原配方，不强求所有按钮宽度/内边距一样。
- 两处自定义压缩声明不再生效；不能仅看到 36px 高就宣称字号/内边距正确，也不能宣称修改前实际高度必为 28px。
- 文字、键盘提示和焦点可见，无横向溢出、遮挡或入口丢失；保留现有分组/顺序，允许自然换行。
- 行为检查使用受控服务/测试依赖，确认播放/重试仍走原 handler，不真实评分、重试保存或写学习数据。

这只是原默认外观合同的局部纠正，不是 N7 H7 组件验收重启，不跑学习持久化链，也不新增 SRS 通用测试框架。

## 7. 固定验收：沿用原标准，不追加工程

N8 必须逐项引用原方案第 6 节 A1–A12；以下只说明本轮如何对应，不能替换或减免原条件。

| 原验收 | 本轮对应内容/证据层 |
| --- | --- |
| A1–A3 | 第一批配置/用途界面的直接回归；继承证据与本轮实测分列 |
| A4 | 真实 controller + 受控 client 捕获：A 不切换、A 按原规则切到 B；请求与说明一致，不真实调用 AI |
| A5 | 真实 Page/dialog + 受控历史 A/C、当前配置 B、切记录及迟到响应；历史不重标，不回写 |
| A6 | 缺 model、缺匹配 run、request-only、metadata-only、无最终路由证明的定向组合 |
| A7 | 复用不新增生成请求；合并标签范围准确；模拟与关闭状态准确；原缓存/算法不改 |
| A8 | 摘要/历史操作的请求类型与次数、凭据不泄露，原取消/失败/重试入口保留 |
| A9 | 可证明隔离的开发配置副本真实保存/读回/真关页新开；没有现成安全入口就 NOT_RUN，不以 fixture 代替 |
| A10 | 真实组件/CSS 两种宽度、Tab、输入、展开、弹窗关闭/焦点返回及快捷键隔离；不是只测 helper |
| A11 | 已确认版本/实例的开发 Host，只读既有配置与一个已有 job/run，UI 对照原响应；不新建 AI 任务 |
| A12 | 相对 opening 的增量、保护范围、历史失败和独立双轴；执行自查不能代替独审 |

UI-2 的固定验收仅第 6 节四条，不从样式修正推导 N7 全阶段 PASS。

一次限定验收按顺序执行并各自保存命令、stdout/stderr、退出码、运行层与覆盖项：

1. 若实际新增展示检查：`node scripts/ai-provenance-presentation-check.cjs`。
2. `npm run verify:youtube-workflow-panel`。
3. `npm run verify:annotation-backfill-ai`。
4. `npm run verify:keyboard-boundary`。
5. `npm run build`。
6. N8-02 受控真实 Page/dialog 检查与 UI-2 实际组件/CSS 检查。可共用简短受控证据环境，不造复制产品的演示页。对未触发的真实 AI/学习写入保持阻断。
7. 既有 browser/load 命令分别执行一次并如实登记：`npm run verify:youtube-workflow-panel-behavior`、`npm run verify:vite`。先核对开发实例归属，显式设置 `READ_WEB_URL=http://127.0.0.1:5184/`、`READ_WEB_PORT=5184`，执行后恢复原环境变量；不得裸连默认 5173/4173 或未知服务。旧 FAIL 可仍为 FAIL，不修 runner 追绿。
8. 原 A9/A11 只有在第 4 节的版本/隔离条件成立时运行。否则停止对应依赖步骤，登记原因；不把补环境变成施工项。
9. 检查相对 opening 的文件增量、`git diff --check` 和保护文件身份；只对本轮新增问题负责，旧 dirty/原失败分列。

不要求全仓 npm test、系统重启、多设备、声学听辨、新 provider 在线调用、N6/N7 补验或全站截图重审。不重跑已经声明继承且未受改动影响的整套历史旅程。

## 8. 停止规则与完成判定

出现以下情况，保留证据并停对应工作，不自动扩白名单：需要新后端/持久化字段、数据迁移、真实 AI/学习写入、未知服务控制、启动包装修复或范围外文件改动。无来源字段是可说明的事实，不是建设新存储的理由。

新出现的失败先分清产品/检查/环境，保存原始结果；同一任务两次连续修补/复审失败必须停止，不进入第三轮。第一批旧停止不重置。支持脚本超过约 500 行或超过其已审基线两倍时，按 AGENTS 的范围警报先暂停评估并说明新增复杂度；不因既有脚本较长而重写、拆分或开启脚本瘦身工程，不建设日志推理器或第二套业务实现。

限定验收结束后停写并交接，状态必须按以下规则选择：

- 产品内容仍缺：**未完成**，列缺哪一条固定项。
- 两项产品内容已实现，但任一必要项 FAIL/NOT_RUN/NOT_VERIFIED，或独审未完成：**固定清单已实施，验收未完成**；UI-1/UI-2 各自列状态，不能写整版 PASS。
- N8 原 A1–A12 按其规定证据层完成、UI-2 固定标准通过、一次独立 Spec/Standards 均支持且无本范围阻断 P0–P2：**本次已确认 UI 固定范围有限收口**；N8 仅首版呈现范围有限完成。

完成判定不等于所有 99 项功能、全仓验证或日用推广完成；未收口判定也不授权继续追加修补。停下列明固定缺口即可，不创建“下一轮 UI 统一工程”。

独审只按本文件、原 N8 固定标准或具体 P0–P2 产品/数据/回滚问题裁决；建议另列，不升级成新增必修项。执行模型不得自称独审通过，不自动开新任务/派代理；先交审核包，由用户安排一次只读审核。

## 9. 最终交付格式

在新 Temp 目录保存 opening/closing、相对本轮 opening 的精确增量 patch、允许文件哈希、命令原始结果、两种宽度截图/必要 computed 属性、固定验收表和 handoff。截图与日志不含真实凭据；结构/hash 检查不解释成真实旅程通过。

将结果追加到本文件、原 N8 方案、两份路线图和项目状态最新摘要；不删历史 FAIL，不刷新全仓 Last verified、无关 R 状态或推广状态。

对用户的最终回复只按这个顺序：

1. UI-1、UI-2：对应原要求 → 实际改动 → 已实施/通过/未完成 → 尚缺哪条既定验收。
2. 本轮实际文件清单和原始证据路径；不是整个 dirty 工作树清单。
3. N8 A1–A12 结果及 UI-2 四条结果，受控/真实/继承分列，旧 FAIL 与本轮结果分列。
4. 保护边界、服务/PID 最终状态，明确日常未操作、学习数据未写、未提交/推广。
5. 如未收口，只给固定缺口和停止原因，不追加新需求/前置工程，不提出全站重做。

交付后停止产品写入。
