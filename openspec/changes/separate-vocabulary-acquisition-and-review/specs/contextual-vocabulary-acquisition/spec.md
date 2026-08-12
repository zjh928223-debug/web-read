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

### Requirement: 历史 Passage 1 五词导入必须保持兼容
系统 MUST 继续支持共享复习视觉体系的历史五词微阅读 JSON 导入，并 MUST 只从用户主动选择的本地 JSON 导入 `source` 包含 `C19-T1-RP1-` 且 lemma 分别为 `thorough`、`readily`、`subtle`、`attribute`、`enhance` 的五个项目。该历史 fixture 不属于剑雅 priority 自动批次，MUST NOT 创建或修改 `ReviewState`；剑雅自动批次遵守本规范末尾的预习 acquisition 闭环。

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

#### Scenario: 完成历史五词预习
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

#### Scenario: 历史 fixture 不触发第二轮
- **WHEN** 用户完成历史五词微阅读预习
- **THEN** 系统不安排至少 24 小时延迟检查、不执行 graduation、不创建 `ReviewState`、不接入 FSRS
- **AND** 该兼容行为不限制剑雅 priority 自动批次使用下方的 acquisition 闭环

### Requirement: 通用预习必须使用单一主要义与可追溯短真实句
系统 MUST 支持任意数量的首次接触批次。每个项目 MUST 只展示一个主要义项；英文语境 MUST 来自用户已导入语料或明确许可的开放/词典语料，并保留来源定位。系统 MUST NOT 以 AI 现编句作为默认语境，也 MUST NOT 在首次接触中默认展示本地考试长句或完整段落。

#### Scenario: 开放真人语料存在合格短句
- **WHEN** 一个已确定目标义项的词在开放语料中存在来源完整、义项已验证且难度低于 `first_preview` 上限的句子
- **THEN** 系统通过确定性句子排序器选择一条句子
- **AND** 页面显示语料名称、许可、作者或句子记录链接
- **AND** 页面只显示这一条句子，不追加同日第二、第三个重复语境

#### Scenario: Tatoeba 无合格句时调用 Wordnik
- **WHEN** Tatoeba 未返回符合首次接触约束的句子且服务端已配置 `WORDNIK_API_KEY`
- **THEN** 来源注册表调用 Wordnik provider 并通过同源服务端端点请求 `/examples`
- **AND** API key 不得进入浏览器 bundle、请求 URL、响应、日志或本地持久化数据
- **AND** Wordnik 候选仍须通过词形、来源和首次接触难度约束

#### Scenario: Wordnik 无密钥或额度不足
- **WHEN** `WORDNIK_API_KEY` 未配置、本地每小时 80 次安全预算耗尽或官方 rate-limit 响应拒绝请求
- **THEN** Wordnik provider 返回 unavailable，页面继续使用既有无句安全状态
- **AND** 系统不得自动重试、绕过配额或改用 AI/考试长句

#### Scenario: Wordnik 结果只在会话内暂存
- **WHEN** 当前页面会话已为同一词和目标义取得格式化 Wordnik 例句
- **THEN** 往返导航可复用该格式化结果而不再次调用 API
- **AND** 原始或格式化 Wordnik 数据均不得写入 localStorage、IndexedDB 或独立本地语料仓库

#### Scenario: Wordnik 没有中文整句翻译
- **WHEN** 页面展示 Wordnik 例句
- **THEN** 页面明确说明整句中文翻译暂缺，不得把左侧主要义伪装成整句翻译
- **AND** 结果内部保留该词的 Wordnik 页面、provider 与 attribution 元数据，但学习面板不显示来源长文案或 badge

#### Scenario: 只有剑雅长句匹配
- **WHEN** 目标词在用户本地考试材料中存在，但句子不符合首次接触难度或来源策略
- **THEN** 系统不在首次接触页展示该考试原句或完整段落
- **AND** 系统保留其来源定位，供熟练后的 `late_context_transfer` 使用

#### Scenario: 没有安全句子
- **WHEN** 所有候选句均缺少许可、来源定位、目标义项匹配证据或超过首次接触难度
- **THEN** 页面只显示单词与一个主要义
- **AND** 页面明确提示“暂未找到合格真实短句”，不得静默生成 AI 句子或回退到考试长段落

#### Scenario: 多个已启用来源均未返回合格句
- **WHEN** 来源注册表依次尝试多个已启用 provider 且最终没有合格真实短句
- **THEN** 结果保留每个已尝试 provider 的标识、状态与提示
- **AND** 页面不得只显示最后一个 provider 的失败而隐藏之前已经尝试的来源

#### Scenario: 主要义项证据不足
- **WHEN** learner dictionary、WordNet MFS 与 general/exam corpus 未达到主要义项共识门槛
- **THEN** 系统将第一条精简释义标记为“主要义建议”而不是已确定主要义
- **AND** 该建议不得伪装为已经由词频证明的固定比例

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

### Requirement: 首次接触必须优先使用本地可追溯例句仓库
系统 MUST 在首次接触页优先查询用户本机的只读例句仓库，并仅在本地仓库没有合格候选时依次尝试在线开放语料和 Wordnik。仓库 MUST 支持词形到 lemma 的查询，保留词典、出版物或语料来源信息，并与 `SeekPlayerDB` 完全隔离。

#### Scenario: 变化词形命中本地 lemma
- **WHEN** 首次接触项为 `sanctuaries`、`propping` 或 `gauges`
- **THEN** 本地仓库分别查询 `sanctuary`、`prop` 或 `gauge` 的候选句
- **AND** 只返回明确包含目标词形或可验证词族形式的短句

#### Scenario: 本地仓库命中
- **WHEN** 本地仓库返回符合主要义、长度和可理解性边界的候选句
- **THEN** 页面显示该句及其具体来源和本地使用说明
- **AND** 本次查询不得调用 Tatoeba 或 Wordnik

#### Scenario: 本地仓库缺失或无候选
- **WHEN** 本地数据库尚未构建或当前词没有合格本地候选
- **THEN** provider registry 继续尝试 Tatoeba 和 Wordnik
- **AND** 页面汇总每个已启用来源的状态，不用 AI 现编句或剑雅长段落补位

#### Scenario: 本地商业词典材料
- **WHEN** 用户将本地持有的 MDX/MDD 词典构建为例句或音频索引
- **THEN** 原文件、抽取内容和生成数据库只保存在被 Git 忽略的本地数据目录
- **AND** 发布包、fixture、导出模板和公共数据集不得包含这些内容

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
### Requirement: 首次接触语境必须紧凑并提供可选整句翻译
系统 MUST 将真实短句作为首次接触页右侧的主要内容，目标词只以下划线标识，桌面端常规短句 SHOULD 保持一行且较长合格短句 SHOULD 不超过自然换行后的两行。系统 MUST NOT 在学习面板展示缺译说明、授权说明或来源归属长文案；来源元数据仍保留在内部结果中。

#### Scenario: 本地真实短句具有中文翻译
- **WHEN** 当前真实短句已经具有人工或 AI 整句中文翻译
- **THEN** 页面在英文短句下方显示一行中文翻译
- **AND** 目标词没有背景色、阴影或块状高亮

#### Scenario: 当前短句没有中文翻译
- **WHEN** AI 未配置、请求失败或本地缓存没有当前短句
- **THEN** 页面仍显示真实英文短句并允许朗读
- **AND** 页面不显示“暂无整句中文翻译”或 API 配置提示

### Requirement: 整句翻译必须批量、可缓存且不生成例句
系统 MUST 将整句中文翻译与真实短句选择分离。翻译请求 MUST 每批不超过 25 句、保持单并发、使用稳定 ID 对齐结构化结果并优先读取本地缓存；翻译服务 MUST NOT 改写、扩写或替代英文真实短句。

#### Scenario: 五十词预习批次需要翻译
- **WHEN** 一个首次接触批次有 50 条待翻译真实短句
- **THEN** 系统最多以两个 25 句请求顺序处理
- **AND** 已缓存句子不重复发送给 AI

#### Scenario: 翻译返回部分结果
- **WHEN** AI 只返回批次中一部分有效 ID
- **THEN** 系统只接受可与原句稳定对齐的译文
- **AND** 其他英文短句保持可用且不会被 AI 现编内容替换

### Requirement: 首次接触快捷键必须可自定义且不干扰学习界面
系统 MUST 为“看看这个词怎么用”、单词发音、句子发音、整句中文展示/隐藏、上一个和下一词提供互不冲突的自定义快捷键。快捷键配置 MUST 本地持久化，但学习主界面 MUST NOT 展示按键标签或提示；设置入口 MUST 位于右侧预习数量之后并采用弱化视觉。

#### Scenario: 修改并恢复快捷键
- **WHEN** 用户在首次接触页的快捷键设置中为一个动作按下新的有效按键
- **THEN** 系统保存新的唯一映射并立即使用
- **AND** 刷新后仍恢复该映射

#### Scenario: 快捷键驱动学习动作
- **WHEN** 用户在非输入状态下按下已配置快捷键
- **THEN** 系统执行对应的学习内容揭示、单词发音、句子发音、中文显隐或导航动作
- **AND** 上一个与下一词遵守当前揭示状态和批次边界，不得绕过首次接触步骤

#### Scenario: 设置或输入期间按键
- **WHEN** 焦点位于输入控件、contenteditable 或快捷键捕获状态
- **THEN** 学习动作快捷键不触发
- **AND** 重复映射被拒绝且不会覆盖已有配置

### Requirement: 首次接触必须先确定主要义项再选句
系统 MUST 优先从学习型双语词典的词性、义项顺序、英文释义和中文释义确定一个主要义项，再从与该词性和英文释义一致的可追溯真实句中排序。系统 MUST NOT 因某个少见名词义排在原始双语字符串前面就把它当作主要释义。

#### Scenario: automatic 的名词义排在形容词义之前
- **WHEN** 原始词典文本先列出“自动手枪”，但学习型双语词典将 `automatic` 的主要词性和首义标为 adjective / “自动的”
- **THEN** 左侧主要释义显示“自动的”而不是“自动手枪”
- **AND** 右侧只能选择 adjective 且与“设备或过程自行工作”这一主要义项匹配的真实句

#### Scenario: 本地仓库没有可用主要义项
- **WHEN** 双语义项索引缺失或当前词没有可用记录
- **THEN** 页面保留导入的主要义建议并按现有来源链路安全回退
- **AND** 系统不得为填补义项而现编英文句子

#### Scenario: 弱化的快捷键入口
- **WHEN** 首次接触页显示右上角快捷键入口
- **THEN** 入口文字使用明确的紧凑字号和行高并在点击区内水平、垂直居中
- **AND** 文字不得漂出按钮的可视边界

### Requirement: Merriam-Webster 必须按学习词典优先并安全保管双 key
系统 MUST 将 Merriam-Webster Learner's Dictionary 与 Collegiate Dictionary 视为两个独立 reference work。首次接触的在线词典补句 MUST 先查询 Learner's，再在无合格结果时查询 Collegiate；两个 key MUST 只存在于 Windows Credential Manager 或服务端环境变量中。

#### Scenario: Learner's 返回同词性同义项例句
- **WHEN** 本地仓库没有合格句且 Learner's API 返回目标词性、目标义项下的短 `vis` 例句
- **THEN** 系统选择一条符合首次接触长度和可理解性边界的例句
- **AND** 系统不再请求 Collegiate、Tatoeba 或 Wordnik

#### Scenario: Learner's 无合格例句
- **WHEN** Learner's 没有目标词性/义项下的合格短句
- **THEN** 系统使用独立 Dictionary key 查询 Collegiate
- **AND** Collegiate 仍须通过相同词性、义项和难度约束

#### Scenario: 浏览器与持久化边界
- **WHEN** 任一 Merriam-Webster reference 被查询或返回结果
- **THEN** key、带 key 的上游 URL和原始 payload 不进入浏览器响应、日志、localStorage、IndexedDB 或本地例句 SQLite
- **AND** 格式化结果只允许当前页面会话内复用

#### Scenario: 官方品牌与额度
- **WHEN** 页面展示 Merriam-Webster 内容
- **THEN** 页面以官方允许的 50px 尺寸显示未修改的 Merriam-Webster 标识并链接到对应 reference
- **AND** 每个 reference 使用低于官方每日免费额度的本地安全预算，额度不足时安全回退下一来源

### Requirement: Windows 桌面入口必须可靠打开首次接触页面
系统 MUST 提供一个不包含 API key 的本地 Windows 启动器，复用或启动 Read-Web 服务并打开 `/?learning=preview`。该入口 MUST 只自动打开已经有效保存的首次接触批次，且 MUST NOT 因缺少批次而在无用户手势时自动触发文件选择器。

#### Scenario: 已保存有效预习批次
- **WHEN** 用户通过桌面快捷方式启动且浏览器本地已有有效首次接触批次
- **THEN** 本地服务可用后浏览器打开学习网址
- **AND** 首次接触覆盖层自动显示已保存批次及进度

#### Scenario: 尚未导入预习批次
- **WHEN** 用户通过桌面快捷方式启动但浏览器本地没有有效首次接触批次
- **THEN** 阅读器正常打开并保留“待预习”入口
- **AND** 页面不在无用户手势时自动点击文件输入或修改 SRS/IndexedDB 数据

### Requirement: 所有首次接触句源必须通过统一目标词最终验收
系统 MUST 在任一 provider 返回 ready 后、停止来源回退前，验证页面目标词形、候选 lemma、句中实际词形、词性和目标义项证据的一致性。句中下划线 MUST 仅来自最终验收得到的确切词形；系统 MUST NOT 使用宽松后缀拼接或 provider 自报的相关词条绕过验证。

#### Scenario: slates 不得回退到 slat
- **WHEN** 页面目标词为 `slates`，本地查询同时发现 `slate` 与拼写相近的 `slat`
- **THEN** 系统只接受能够重新生成目标词形 `slates` 的 lemma `slate`
- **AND** `slat` 的“板条；百叶板”义项及包含 `slats` 的句子不得进入学习页面

#### Scenario: Merriam-Webster 返回相关 mission 词条
- **WHEN** 查询 `rescue` 的 API 响应同时包含 `rescue` 与相关的 `mission` 词条
- **THEN** 系统只解析 headword 属于 `rescue` 合法词形族的词条和例句
- **AND** 不含 `rescue` 合法词形的 mission 例句被拒绝，来源链继续寻找下一候选

#### Scenario: 旧错误句已经保存在本地批次
- **WHEN** 已保存句子的 candidate lemma、目标词形或句中下划线词无法通过当前最终验收
- **THEN** 页面忽略该句并重新执行正常来源链
- **AND** 错误主要义和句子不得因 `resolved` 旧状态而阻止重新匹配

### Requirement: 首次接触左栏不得裁剪学习内容
系统 MUST 将目标词和中文主要义完整限制在左侧栏内。长目标词 MUST 通过确定性字号收缩完整显示且不得被中线裁剪；长中文主要义 MUST 在栏内自然换行且不得产生水平滚动。

#### Scenario: approximate 与长中文释义
- **WHEN** 左栏展示 `approximate` 和“近似的，接近但不完全正确的”
- **THEN** 英文单词的可见宽度和内部滚动宽度均不超过其可用标题区域
- **AND** 中文释义在左栏边界内自然换行，不被中线裁剪且页面无水平溢出

### Requirement: 中文快捷键必须支持按住展示与持续展示
系统 MUST 在首次接触快捷键设置中提供“按住展示”和“持续展示”两种中文展示模式，并在本地持久化用户选择。`persistent` MUST 保持按键后持续显示或隐藏；`hold` MUST 仅在配置的中文快捷键被按住期间显示。

#### Scenario: 按住展示
- **WHEN** 用户选择“按住展示”并按下中文快捷键
- **THEN** 当前可用整句中文立即显示
- **AND** 用户松开该键、切词、关闭页面、window blur 或页面变为 hidden 时中文立即隐藏

#### Scenario: 持续展示
- **WHEN** 用户选择“持续展示”并按下中文快捷键
- **THEN** 中文显隐状态切换并在松开按键后保持
- **AND** 再次按下同一快捷键时反向切换

#### Scenario: 模式刷新恢复
- **WHEN** 用户修改中文展示模式后刷新页面
- **THEN** 快捷键设置恢复所选模式
- **AND** 临时按住状态不恢复，也不写入 preview progress、ReviewState 或 IndexedDB

### Requirement: 剑雅 priority 预习必须接入 acquisition 与毕业复习
系统 MUST 从本地剑桥阅读候选池的 priority lemma 分配自动预习批次，且 MUST 通过显式 preview acquisition 入口记录首次接触。该入口 MUST 复用稳定的 `(word_id, target_sense_key)`，在首次接触阶段不得写旧版或 V2 `ReviewState`；只有满足延迟考察条件的 graduation 才能进入正式复习。

#### Scenario: 剑雅候选池生成新批次
- **WHEN** 预习入口请求下一个自动批次且本地 `reading-vocabulary-candidates.json` 可用
- **THEN** 系统从 `readingVocabulary` priority pool 中按 lemma 去重分配最多 50 个词
- **AND** 系统不从 `vocabulary.srs.store.v1` 的旧复习词反推新批次
- **AND** 分配失败时显示候选池 unavailable，不伪造或静默生成替代词批次

#### Scenario: 首次接触写 acquisition 不建复习卡
- **WHEN** 用户第一次揭示一个剑雅批次词的学习内容
- **THEN** 系统创建或复用一个 `LearningUnit`，选择目标义项并记录 `introduced`/`acquiring`
- **AND** 合格本地剑雅短句作为 validated `ContextEvidence` 保存来源定位、许可和 ownership
- **AND** 旧版 vocabulary snapshot 与 V2 review row 均不新增该词的 `ReviewState`

#### Scenario: 延迟考察通过后进入 V2 复习
- **WHEN** 词的 acquisition 已存在 validated anchor，且首次接触至少过去 86,400,000ms，用户在未揭示中文答案的不同 episode 中评分 `hard`、`good` 或 `easy`
- **THEN** 系统通过原子 graduation 创建恰好一个 initial V2 `ReviewState`
- **AND** acquisition 状态变为 `graduated`，graduation event 与 receipt 同事务提交
- **AND** 该 ReviewState 的 `due_at` 为毕业时间，V2 今日复习队列可立即识别该词

#### Scenario: 答案揭示或 again 不得毕业
- **WHEN** 用户在评分前查看中文答案，或在延迟考察选择 `again`
- **THEN** 系统记录 acquisition attempt 及资格原因
- **AND** 系统不创建 `ReviewState`，该词保留在可再次考察的 acquisition 状态

#### Scenario: 打开预习入口优先处理待考察
- **WHEN** 用户打开“待预习”入口且存在已达到 24 小时、具备 validated anchor 的 acquisition 单元
- **THEN** 系统先显示待考察页
- **AND** 只有没有待考察单元时才生成或打开下一个剑雅自动批次
