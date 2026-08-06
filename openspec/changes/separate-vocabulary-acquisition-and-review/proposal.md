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
- 将原五词本地预习试点扩展为通用首次接触覆盖层：本地词批次只显示一个主要义与至多一条通过义项、来源和难度校验的短真实句；开放语料保留句子 ID、作者、许可和原始链接。剑雅长句只用于后期语境迁移，AI 不生成默认例句；本轮仍不执行至少 24 小时延迟检查、graduation 或 FSRS 建卡。

- 为真实短句来源增加版本化 provider registry；当前先查询 Tatoeba，再以 Wordnik API 作为补充来源。Wordnik 密钥只由 Vite/Node 同源代理从 `WORDNIK_API_KEY` 读取，浏览器不得接触密钥；调用使用每小时 80 次本地安全预算和官方剩余额度，无密钥或额度不足时安全回退，格式化结果只允许会话内暂存，不写入 localStorage 或 IndexedDB。

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
