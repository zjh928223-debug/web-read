## Why

当前词汇服务会在单词加入时立即创建 FSRS 复习状态，把“第一次建立词义与语境联系”和“毕业后的长期保持”混在同一条队列中；同时，现有每日固定队列与 FSRS 的同日 learning/relearning steps 存在策略冲突。需要建立严格的 acquisition/review 领域边界，使系统既适配以真实语境为主的个人学习方式，也能持续记录可用于评估和个性化参数的数据。

## What Changes

- 将内部词汇流程分为 `vocabulary-acquisition` 与 `srs-review`：前者负责候选词、目标义项、真实语境锚点和毕业评估，后者只负责毕业后的长期记忆维护；前端暂不要求显示两个独立板块。
- 将复习单位定义为“词形 + 目标义项”，句子作为带来源的学习证据和提示语境，而不是固定卡片本体。
- 考试词表导入只进入候选池；候选词经引入、语境学习、延迟检查后，才通过原子化 graduation 操作创建 FSRS `ReviewState`。
- 为旧数据增加 reassessment 通道：保留原始日志和状态快照，逐批重新评估，不把全部旧词一次性投入到期队列，也不把不兼容历史记录直接用于参数训练。
- 明确三类提示能力：原语境识别、新语境迁移识别、单词孤立提取；graduation 只要求建立可靠的“词形—目标义项—真实语境”联系，不要求一次达到完全掌握。
- 将评分结果 `again/hard/good/easy` 与答题时获得的提示层级分开记录；支持 `once_daily`、`balanced`、`intensive` 三种同日策略，默认采用只让新词或答错词短时再见一次的 `balanced`。
- 将每日计划从固定词数改为时间预算驱动：先处理到期 review/relearning，再分配 reassessment 和 acquisition；以用户实测约 100 词/小时作为初始估算并由个人数据更新。
- 建立 append-only 学习事件数据集，记录策略版本、提示模式、评分、耗时、前后调度状态、内容来源和会话位置；参数优化必须经过样本量门槛、留出评估与版本化发布。
- 真实例句优先来自用户导入文章/字幕、用户合法持有并本地导入的考试材料、许可明确的开放语料或允许使用的词典示例；AI 仅可作为可选、缓存、可审查的离线补位，不在答题时强制调用。
- **BREAKING**：在迁移所有调用方后，通用 `addWord()` 不再隐式创建 FSRS 状态；创建 `ReviewState` 的唯一业务入口为 graduation/reassessment 通过操作。迁移期间保留显式标记的兼容适配器。
- 不提升 `SeekPlayerDB` 版本、不新增 object store；新增记录继续通过现有 `files` store 的命名键保存。系统不内置或再分发受版权保护的 IELTS 例句。
- 将原五词本地预习试点扩展为剑雅阅读候选池驱动的首次接触覆盖层：预习分配直接读取本地 `reading-vocabulary-candidates.json` 的 priority 候选，不再从旧版 SRS 行反推新词；每词只显示一个主要义与至多一条通过校验的短真实句。首次接触完成后记录 acquisition，至少 24 小时后进入延迟考察；考察在评分前未揭示答案且评分不是 `again` 时，通过既有原子 graduation 创建唯一 V2 `ReviewState`，从而接入正式复习队列。

- 为真实短句来源增加版本化 provider registry；当前先查询 Tatoeba，再以 Wordnik API 作为补充来源。Wordnik 密钥只由 Vite/Node 同源代理从 `WORDNIK_API_KEY` 读取，浏览器不得接触密钥；调用使用每小时 80 次本地安全预算和官方剩余额度，无密钥或额度不足时安全回退，格式化结果只允许会话内暂存，不写入 localStorage 或 IndexedDB。
- 在本地仓库缺句时优先查询 Merriam-Webster Learner's Dictionary，再以 Collegiate Dictionary 兜底；两个产品 key 分开保存在 Windows Credential Manager 或服务端环境变量中。只返回与目标词性、义项和首次接触长度匹配的 `vis` 例句，结果仅在页面会话内缓存，并在展示内容时按官方要求显示 Merriam-Webster 标识。
- 为所有首次接触句源增加统一的目标验收门：候选 lemma 必须与页面目标词构成可验证屈折关系，句中必须出现该 lemma 的确切合法词形，词性与目标义项证据不得冲突；API 附带的相关词条、模糊后缀猜测和 provider 自报的任意 `matchedTerm` 均不能绕过该门槛。
- 修复首次接触左栏的长内容适配：长英文目标词必须在栏内缩放而不是静默裁剪，长中文主要义必须在栏内自然换行；中文快捷键设置新增“按住展示 / 持续展示”模式，按住模式在 keyup、切词、失焦或页面隐藏时立即复位。

## Capabilities

### New Capabilities

- `contextual-vocabulary-acquisition`: 候选词引入、目标义项、真实语境来源、延迟检查、graduation 与旧词 reassessment 的业务规则。
- `personalized-srs-review-policy`: graduation 后的四级复习、提示层级、同日策略、固定会话快照和时间预算队列规则。
- `vocabulary-learning-event-dataset`: acquisition/review 事件的追加式记录、数据质量、导出、训练门槛、离线评估和策略版本发布规则。

### Modified Capabilities

无。

## Impact

- 主要影响 `src/services/vocabulary/`、`src/features/srs-review/`、文章标注结算与新增的考试词表导入流程。
- 通用首次接触覆盖层额外影响 reader 顶部入口、独立的 passage-preview 组件/纯函数、真实句源 Vite 适配与可复用的严格 Aria 美式发音服务；不复用依赖全局字幕/时间戳/reader 状态的 `processChunkData` 或 `ChunkModeView`，也不改变既有“今日复习”数据源与交互。
- 需要为 acquisition 状态、词义项、例句来源、reassessment、学习事件和策略版本增加 repository/service 层，但保持 IndexedDB schema version 1 和现有 `files` object store。
- `vocabulary-service.addWord()`、`article-srs-settlement` 及复习队列调用方需要分阶段迁移；兼容层在全部调用方迁移和验证后删除。
- 新增纯函数单元验证、repository 合约验证、端到端 graduation/review 验证、旧数据演练与数据导出验证。
- 将首次接触的真实短句收紧为一至两行，目标词只使用下划线；隐藏面向学习者无帮助的缺译和来源长提示，并通过最多 25 句一批、单并发、可缓存的 AI 整句翻译补充中文理解支架。
- 扩充本地个人词典仓库的双语、整句/短语、搭配、词频分级与发音资源；所有 MDX/MDD 和派生内容继续只保存在 Git 忽略目录，不随应用分发。
- 为首次接触页增加本地持久化的自定义快捷键设置，覆盖揭示“看看这个词怎么用”、单词发音、句子发音、整句中文显隐、上一个和下一词；设置入口弱化并放在右侧预习数量之后，快捷键只在设置弹层中管理，学习主界面不展示按键提示。
- 修正首次接触的义项链路：先从学习型双语词典确定词性对应的主要释义，再用该义项的词性、英文释义和词典顺序筛选真实短句，禁止将 `automatic`的罕见名词义“自动手枪”与形容词例句配对。
