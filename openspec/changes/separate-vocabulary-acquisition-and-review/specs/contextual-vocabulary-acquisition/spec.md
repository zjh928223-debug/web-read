## ADDED Requirements

### Requirement: Acquisition 与 review 生命周期必须分离
系统 MUST 为 `LearningUnit` 分别维护 acquisition 生命周期与 review 生命周期，并且在 graduation 前不得创建 FSRS `ReviewState`。

#### Scenario: 考试词表候选进入 acquisition
- **WHEN** 用户导入一个此前不存在的考试候选词
- **THEN** 系统创建 candidate 或 acquisition 记录
- **AND** 系统不创建 `ReviewState`，也不把该词加入 due review queue

#### Scenario: graduation 创建 review 状态
- **WHEN** 一个 `LearningUnit` 满足 graduation 条件并成功毕业
- **THEN** 系统在同一事务中将 acquisition 状态改为 `graduated`
- **AND** 系统恰好创建一个 initial FSRS `ReviewState`

### Requirement: Passage 1 预习试点必须保持本地且不建卡
系统 MUST 提供一个共享复习视觉体系的五词预习覆盖层，并 MUST 只从用户主动选择的本地 JSON 导入 `source` 包含 `C19-T1-RP1-` 且 lemma 分别为 `thorough`、`readily`、`subtle`、`attribute`、`enhance` 的五个项目。该试点 MUST NOT 创建或修改 `ReviewState`。

#### Scenario: 首次导入本地熟悉度结果
- **WHEN** 用户从“待预习”入口选择包含熟悉度结果与 `passage-preview.micro-reading.v1` 的本地 JSON
- **THEN** importer 从 `answers` 与微阅读项中按 lemma 合并、去重，并且只有五个指定词全部存在且 schema 合法时才按固定顺序保存
- **AND** 词性、目标义、短语中英注释、语义块、完整语境与来源只保存在用户浏览器本地
- **AND** 旧 v1 数据或缺少微阅读字段时系统明确要求重新导入，且成功导入前不静默丢弃既有进度

#### Scenario: 预习首态
- **WHEN** 用户第一次看到一个预习词
- **THEN** 页面只显示左侧固定单词与发音按钮，并自动播放一次严格 Aria 美式单词发音
- **AND** 页面不显示中文、短语、英文核心语境或完整语境

#### Scenario: 揭示学习内容
- **WHEN** 用户点击“显示学习内容”
- **THEN** 页面显示可用音标、词性、精简中文目标义、英文核心短语与书面英语语义块
- **AND** 短语中文和各英文块对应中文默认隐藏，仅在用户按住页面按钮或独立可自定义快捷键时显示
- **AND** 完整段落语境仍默认折叠，除非用户点击与复习板块一致的按钮或使用独立可自定义快捷键展开

#### Scenario: 按住中文可靠复位
- **WHEN** 用户松开按键/页面按钮、切词、关闭、刷新、window blur 或页面变为 hidden
- **THEN** 所有微阅读中文块立即隐藏
- **AND** 输入框、contenteditable 或快捷键设置中的按键不触发按住显示

#### Scenario: 手动朗读微阅读语境
- **WHEN** 用户点击“朗读语境”或单个英文语义块的重播控件
- **THEN** 系统使用同一严格 Aria 美式服务手动朗读英文块，并高亮当前块
- **AND** 连续朗读按块顺序进行，语境不自动播放，界面标明“AI 美式朗读”而不声称是官方音频
- **AND** 页面不显示 ECDICT 长释义或 FSRS 四级评分

#### Scenario: 刷新恢复
- **WHEN** 用户在完成前刷新 reader
- **THEN** 系统从本地恢复 `not_started`、`in_progress` 或 `completed` 状态与当前位置
- **AND** 上一个、下一词、学习内容揭示和完整语境折叠状态可继续使用
- **AND** 按住中文状态不会持久化且刷新后保持隐藏

#### Scenario: 完成五词预习
- **WHEN** 用户在第五词选择完成预习
- **THEN** 页面显示“5词预习完成”
- **AND** 系统只保存 acquisition 预习完成时间与进度
- **AND** vocabulary/SRS repository 中不存在由该试点创建的新 `ReviewState`

### Requirement: Passage 1 试点必须使用严格 Aria 美式发音
系统 MUST 在进入每个预习词时自动播放一次单词，并保留扬声器手动重播；语境只允许手动播放。两者 MUST 优先严格匹配系统语音 `Microsoft Aria Online (Natural) - English (United States)`；系统语音不可用时只能回退到同源 `en-US-AriaNeural` TTS。

#### Scenario: 指定系统语音存在
- **WHEN** 用户进入新预习词或点击扬声器且指定系统语音可用
- **THEN** 系统用该精确语音播放当前单词
- **AND** 系统不请求本地 TTS

#### Scenario: 指定系统语音不存在
- **WHEN** 用户点击扬声器且指定系统语音不可用
- **THEN** 系统请求当前 Vite dev/preview 的同源 `/api/tts/edge`，后端实际用 `node-edge-tts` 的 `en-US-AriaNeural` 合成音频，客户端验证响应 voice
- **AND** 系统拒绝其他英语 voice

#### Scenario: 导航时取消旧发音
- **WHEN** 发音仍在等待系统 voice、TTS 响应、单词播放或语境块播放，而用户切词、完成预习或关闭覆盖层
- **THEN** 系统取消该请求且旧词不得稍后开始播放

#### Scenario: 第二轮仍未实施
- **WHEN** 用户完成本轮五词预习
- **THEN** 系统不安排至少 24 小时延迟检查、不执行 graduation、不创建 `ReviewState`、不接入 FSRS
- **AND** 未来延迟检查的发音仍为手动触发，不由本轮自动发音规则决定

#### Scenario: 两条 Aria 路径都不可用
- **WHEN** 指定系统语音与 `en-US-AriaNeural` 都不可用
- **THEN** 页面显示“Aria美式发音暂不可用”
- **AND** 系统不静默选择其他英语语音

### Requirement: 学习单位必须绑定目标义项
系统 MUST 以“规范词形 + 目标义项”标识 `LearningUnit`，并允许多个 `ContextEvidence` 支持同一个目标义项。

#### Scenario: 同一词的不同义项
- **WHEN** 同一 lemma 的两个候选具有不同目标义项
- **THEN** 系统以不同 `target_sense_key` 将其保存为可同时 active 的不同 `LearningUnit`
- **AND** 系统不得仅因 lemma 相同而静默覆盖其中一个义项

#### Scenario: 重复目标义项
- **WHEN** 同一 `word_id` 已存在相同 active `target_sense_key`
- **THEN** repository 拒绝第二个 active unit 并返回 `DUPLICATE_TARGET_SENSE`

#### Scenario: 同一义项具有多个句子
- **WHEN** 用户为一个 `LearningUnit` 添加多个表达同一目标义项的句子
- **THEN** 系统把句子保存为多个 `ContextEvidence`
- **AND** FSRS 卡片身份保持为该 `LearningUnit`，而不是某个固定句子

#### Scenario: graduation 原子读取语境锚点
- **WHEN** graduation 验证 `validated_anchor_id`
- **THEN** 系统在 graduation 的同一个 IndexedDB transaction 中通过 ContextEvidence transaction binding 读取锚点
- **AND** 锚点状态与 acquisition、review、event、receipt 提交之间不得出现跨 transaction 竞态

#### Scenario: transaction binder 无循环组装
- **WHEN** P6 创建 graduation unit of work
- **THEN** P6 先从唯一 transaction 创建 row port，再将该 port 传给 acquisition、context、review、event binder
- **AND** binder 不得接收尚未组装的完整 unit of work

### Requirement: graduation 必须验证首次可靠联系
系统 MUST 在 graduation 前确认目标义项、至少一个经过验证的真实语境和一次延迟检查；系统 MUST NOT 把孤立词义提取作为必选条件。

#### Scenario: 在语境中理解但孤立提取较弱
- **WHEN** 用户在未显示中文答案的延迟检查中能借助英文语境正确理解目标义项
- **AND** 用户不能立即从孤立词形说出中文释义
- **THEN** 系统仍允许该 `LearningUnit` graduation
- **AND** 系统将孤立提取能力另行记录

#### Scenario: 仅录入中文释义
- **WHEN** 候选词只有中文释义而没有 validated `ContextEvidence`
- **THEN** 系统不得允许 graduation
- **AND** 系统明确显示缺少真实语境证据

#### Scenario: 检查前揭示答案
- **WHEN** 延迟检查在评分前已经揭示中文答案
- **THEN** 该 attempt 不得单独满足 graduation 的无答案检查条件

#### Scenario: 延迟条件可稳定回放
- **WHEN** acquisition attempt 距首次引入至少 86,400,000ms 且 episode id 不同
- **THEN** `acquisition-delay.v1` 将 `delayed_from_introduction` 记为 true
- **AND** 相同输入在任意时区和刷新后产生相同结果

#### Scenario: 仅跨 episode 但未满 24 小时
- **WHEN** acquisition attempt 的 episode id 不同但距首次引入不足 86,400,000ms
- **THEN** `delayed_from_introduction` 为 false
- **AND** 该 attempt 不得单独满足 graduation

#### Scenario: eligibility 回放不读取当前时钟
- **WHEN** 系统使用相同 `GraduationEligibilityInput` 回放一次检查
- **THEN** evaluator 使用输入中显式保存的 `evaluated_at`
- **AND** reason codes 按冻结顺序输出且结果不依赖回放时的系统时钟

### Requirement: 语境证据必须带来源与质量状态
系统 MUST 为每个 `ContextEvidence` 记录来源类型、可追溯定位信息、所有权或许可状态以及质量状态。

#### Scenario: 用户导入文章句子
- **WHEN** 句子来自用户导入的文章或字幕
- **THEN** 系统记录文档标识、标题和句子定位信息
- **AND** 系统可在不依赖外部 API 的情况下再次展示该句子

#### Scenario: 来源不明的批量句子
- **WHEN** 导入句子没有可识别来源或许可信息
- **THEN** 系统将其标为 `pending`
- **AND** 系统不得自动把它作为 graduation 的 validated 锚点

#### Scenario: 用户本地考试材料
- **WHEN** 句子来自用户合法持有并主动导入的考试材料
- **THEN** 系统仅在本地保存内容和来源定位
- **AND** 应用的发布包、导出模板和公共数据集不得内置该句子

### Requirement: AI 例句只能作为可选补位
系统 MUST 在没有 AI 服务时完成 candidate、acquisition、graduation 和 review 主流程；AI 生成句子只能作为用户启用的待审查候选。

#### Scenario: API 未配置
- **WHEN** 用户没有配置任何 AI API
- **THEN** 系统仍可使用用户语料或开放语料完成 acquisition
- **AND** review 页面不得因缺少 AI API 而阻塞

#### Scenario: AI 候选句
- **WHEN** 用户启用 AI 生成一个候选句
- **THEN** 系统缓存生成结果并标记来源为 AI
- **AND** 该句子必须经过确认后才能变成 validated `ContextEvidence`

### Requirement: graduation 必须具有幂等性和事务性
系统 MUST 保证同一 `LearningUnit` 的重复 graduation 请求不会创建重复 `ReviewState`，且 acquisition 状态、review 状态和 graduation 事件必须全部提交或全部回滚。

#### Scenario: 重复点击毕业
- **WHEN** 相同 graduation command 因重复点击或重试被提交两次
- **THEN** 系统返回同一个已毕业结果
- **AND** 系统只保留一个 active `ReviewState` 和一个有效 graduation 事件

#### Scenario: 事件写入失败
- **WHEN** graduation transaction 中事件记录无法写入
- **THEN** 系统不得单独提交 acquisition 状态或 `ReviewState`

#### Scenario: 刷新后重试相同 command
- **WHEN** 页面刷新后再次提交相同 command id 和相同 canonical payload fingerprint
- **THEN** 系统从持久化 command receipt 返回首次保存的 result
- **AND** 系统不执行第二次 graduation、不追加第二个事件

#### Scenario: 重用 command id 但 payload 不同
- **WHEN** 已提交 command id 被用于不同 canonical payload fingerprint
- **THEN** transaction 以 `IDEMPOTENCY_CONFLICT` 中止
- **AND** 已有 receipt 和业务 rows 保持不变

### Requirement: 旧词必须通过可限流 reassessment 迁移
系统 MUST 先只读审计旧词，再将需要重新判断的词分批送入 reassessment；原始词、状态和日志不得被无提示覆盖。

#### Scenario: 生成旧数据审计
- **WHEN** 用户首次启用 legacy audit
- **THEN** 系统将旧记录分类为 `compatible`、`needs_context`、`needs_sense`、`conflicting` 或 `ignored_or_deleted`
- **AND** 系统不在审计阶段改变 due date 或创建新卡

#### Scenario: 分批重新评估
- **WHEN** 当日计划为 reassessment 分配了有限时间
- **THEN** 系统只加入预计能在该预算内处理的小批旧词
- **AND** 未被选中的旧词不因迁移而同时变成到期

#### Scenario: 保留历史
- **WHEN** 一个旧词完成 reassessment
- **THEN** 系统保留旧日志并标记为 legacy
- **AND** 旧日志默认不得进入个性化参数训练集

### Requirement: 迁移期必须提供显式兼容边界
系统 MUST 在所有调用方迁移前保留可识别的 legacy adapter，并 MUST 阻止新 acquisition 调用方通过通用 `addWord()` 隐式创建 FSRS 状态。

#### Scenario: 新入口错误调用 legacy API
- **WHEN** 考试词表或新版文章结算调用隐式建卡的 legacy API
- **THEN** focused verification 失败并报告调用位置

#### Scenario: 回滚新流程
- **WHEN** acquisition feature flag 被关闭
- **THEN** 系统停止创建新的 acquisition/graduation 数据
- **AND** 已存在的旧 review 数据仍可通过兼容读取路径访问
