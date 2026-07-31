## ADDED Requirements

### Requirement: 独立开发使用词库副本
系统 SHALL 允许 SRS 独立页面使用用户现有 vocabulary snapshot 的 in-memory 副本，且独立开发期间不得写入真实 IndexedDB 词库。

#### Scenario: 使用本地 sample 复习
- **WHEN** 开发者打开独立 SRS 页面并提交评价
- **THEN** 系统 SHALL 只修改内存副本，刷新页面后 sample SHALL 恢复原状

#### Scenario: 正常打开阅读器
- **WHEN** 用户在最终接入前使用现有阅读器
- **THEN** 阅读器 SHALL 不加载独立 SRS 页面或产生新的词库写入

### Requirement: 加载并完成到期复习队列
系统 SHALL 通过现有 `getDueWords(now)` 加载到期词，并通过现有 `reviewWord()` 完成排程更新。

#### Scenario: 存在到期词
- **WHEN** service 返回 N 个到期词
- **THEN** 页面 SHALL 显示第一词和 `复习 1 / N`，每次评价成功后进入下一词

#### Scenario: 没有到期词
- **WHEN** service 返回空数组
- **THEN** 页面 SHALL 显示“今天没有待复习单词”

#### Scenario: 完成最后一词
- **WHEN** 最后一词的评价成功
- **THEN** 页面 SHALL 显示“今日复习完成”

#### Scenario: 写入失败
- **WHEN** `reviewWord()` 抛出错误
- **THEN** 页面 SHALL 保持当前词和进度，并允许用户重试

### Requirement: 界面显示五档评价并支持数字快捷键
系统 SHALL 显示 `1 忘记`、`2 困难`、`3 一般`、`4 容易`、`5 掌握` 五个按钮，并按记忆程度从弱到强排列。

#### Scenario: 选择一至四档
- **WHEN** 用户点击前四个按钮或按下数字键 `1-4`
- **THEN** 系统 SHALL 依次提交 `AGAIN`、`HARD`、`GOOD`、`EASY`

#### Scenario: 选择掌握
- **WHEN** 用户点击 `5 掌握` 或按下数字键 `5`
- **THEN** 系统 SHALL 原子写入一条 `EASY` review log，并将单词状态和排程标记为已掌握

#### Scenario: 正在输入文本
- **WHEN** 焦点位于 input、textarea、select 或可编辑元素
- **THEN** 数字键 `1-5` SHALL 不触发复习评价

#### Scenario: 连续点击
- **WHEN** 一次评价仍在提交中
- **THEN** 五个按钮 SHALL 被禁用，系统 SHALL 不产生重复 review log

### Requirement: 页面采用精简的平衡双栏
系统 SHALL 以左侧原文语境、右侧单词信息的布局显示当前复习词，并遵守已选定的精简 UI。

#### Scenario: 显示正常复习词
- **WHEN** 当前词具有 word、meaning 和 context
- **THEN** 页面 SHALL 显示来源、进度、最多三段语境、单词、可选音标、释义和五个评价按钮

#### Scenario: 可选字段缺失
- **WHEN** phonetic、usage hint 或来源信息不存在
- **THEN** 页面 SHALL 隐藏对应内容，不得显示空卡片

#### Scenario: 检查被移除的元素
- **WHEN** 页面显示任意复习词
- **THEN** 页面 SHALL 不包含笔记、note input、顶部播放原文音频、重复原句、底部提示、设置、更多信息、退出复习或大型统计卡片

### Requirement: 今日复习数量稳定且可查看历史
系统 SHALL 按本地自然日建立今日复习范围，并复用已有 `reviewLogs` 显示按日期汇总的复习记录，不得修改 IndexedDB schema。

#### Scenario: 同一天重新进入
- **WHEN** 用户完成部分单词后关闭并在同一天重新打开复习页
- **THEN** 页面 SHALL 将今日已完成的唯一单词数与今日剩余队列合并计算固定总数，并从下一个未完成单词继续

#### Scenario: 查看复习记录
- **WHEN** 用户点击右上角“复习记录”
- **THEN** 页面 SHALL 按日期倒序显示“几月几日复习了几个单词”，同一单词在同一天多次评分只计为一个单词

### Requirement: 单词面板使用精简释义
系统 SHALL 将加入 SRS 时保存的 `simple_meaning` 标记为“句中释义”，并且 SHALL NOT 将首次上下文产生的 `word.meaning` 冒充为常用词典义。

#### Scenario: 同时存在文章释义和精简释义
- **WHEN** 当前 context 同时具有带文章背景的 `meaning` 和精简的 `simple_meaning`
- **THEN** 右侧单词面板 SHALL 将 `simple_meaning` 显示为“句中释义”

#### Scenario: 存在独立词典释义
- **WHEN** 单词具有 `general_meaning` 或 `dictionary_meaning`
- **THEN** 右侧面板 SHALL 分别显示“常用释义”和“句中释义”

#### Scenario: 不存在独立词典释义
- **WHEN** 单词只有首次上下文保存的 `word.meaning`
- **THEN** 系统 SHALL NOT 显示虚假的“常用释义”

### Requirement: 可回顾已评分卡片
系统 SHALL 提供上一张和下一张控制，并支持左/上与右/下方向键。

#### Scenario: 返回上一张
- **WHEN** 用户完成至少一张卡后点击上一张或按左/上方向键
- **THEN** 页面 SHALL 显示上一张卡并将进度标记为“回顾”，五个评分按钮 SHALL 禁用

#### Scenario: 返回当前待评分卡
- **WHEN** 用户在回顾状态点击下一张或按右/下方向键
- **THEN** 页面 SHALL 返回当前待评分卡，且不得跳过未评分卡

### Requirement: 手动连续播放、重读快捷键与隐藏空格暂停
系统 SHALL 提供“R 重读单词和原句”按钮，按顺序播放当前词录音和目标原句。

#### Scenario: 点击连续播放或使用重读快捷键
- **WHEN** 用户点击“重读单词和原句”或按下 `R`
- **THEN** 系统 SHALL 先播放单词，再播放当前目标原句

#### Scenario: 焦点位于任意复习页元素
- **WHEN** 焦点位于按钮、原文、音频控件或复习页内其他元素且用户按下当前重读快捷键
- **THEN** 系统 SHALL 从头重读单词和目标原句

#### Scenario: 修改重读快捷键
- **WHEN** 用户点击重读键帽并按下一个非空格、非 `1-5` 的单字符键
- **THEN** 系统 SHALL 保存新快捷键，并且字母大小写 SHALL 触发相同重读行为

#### Scenario: 空格暂停和继续
- **WHEN** 当前复习音频正在播放且用户在复习页内任意操作状态下按下空格
- **THEN** 系统 SHALL 暂停当前音频，再次按空格 SHALL 从暂停位置继续，且界面 SHALL NOT 显示空格提示或暂停状态

### Requirement: 左侧原文支持从点击单词开始朗读
系统 SHALL 将左侧英文原文中的单词作为独立点击目标，并从用户点击的单词位置开始播放。

#### Scenario: 查看普通状态和悬停状态
- **WHEN** 原文单词未悬停
- **THEN** 单词 SHALL 与正文外观一致且无按钮底色、边框或阴影；悬停时 SHALL 仅轻微放大

#### Scenario: 存在逐词时间戳和原声
- **WHEN** 用户点击具有 `start` 时间戳的原文单词
- **THEN** 系统 SHALL 从该时间戳开始播放原声，并播放到当前段落结束

#### Scenario: 不存在逐词时间戳或原声
- **WHEN** 用户点击没有可用原声时间戳的原文单词
- **THEN** 系统 SHALL 使用美式系统语音朗读从该词开始的剩余句子

### Requirement: 原文音频不可用时不阻塞复习
系统 SHALL 优先显示保存的文本语境，并只在能简单匹配来源 transcript 时显示独立原文音频。

#### Scenario: 来源和原句匹配成功
- **WHEN** `source_id` 对应的 transcript 和 audio 可用且规范化原句匹配成功
- **THEN** 页面 SHALL 显示一个原文 audio bar，并使用独立 audio element 播放

#### Scenario: 来源或匹配失败
- **WHEN** 来源不存在、服务离线或原句无法匹配
- **THEN** 页面 SHALL 隐藏 audio bar，继续显示文本语境和评价按钮

#### Scenario: 离开当前词
- **WHEN** 用户进入下一词或关闭页面
- **THEN** 当前 SRS 音频 SHALL 停止，object URL SHALL 被释放

### Requirement: 最终接入不改变当前阅读状态
系统 SHALL 在独立页面通过验证后，通过单一 `今日复习` 入口接入现有 Vue 应用。

#### Scenario: 打开今日复习
- **WHEN** 用户点击 `今日复习`
- **THEN** 页面 SHALL 以 overlay 打开并使用真实 vocabulary service，不得清空当前文章状态

#### Scenario: 返回阅读器
- **WHEN** 用户点击返回
- **THEN** overlay SHALL 关闭，阅读器 SHALL 回到原文章且不得整页刷新

#### Scenario: 检查存储和 runtime 边界
- **WHEN** 完成最终接入
- **THEN** IndexedDB schema、script order、`reader-runtime.js` 和 `session-init.js` SHALL 保持不变，系统 SHALL 不新增 `window.__srs*` facade

### Requirement: 缺失的常用释义批量获取并永久复用
系统 SHALL 在复习会话打开时仅选择缺少 `general_meaning` 的词条，以每批最多 50 个词请求本地词典服务；服务 SHALL 从 Merriam-Webster Collegiate 获取英文通用定义，并通过已保存的 Gemini 凭据将同一批定义翻译为精简中文。

#### Scenario: 当前队列存在多个缺失常用释义的词
- **WHEN** 复习页面完成到期队列加载
- **THEN** 系统 SHALL 批量请求缺失词，而不是为当前卡片逐词发起请求

#### Scenario: 批量释义返回成功
- **WHEN** 本地服务返回 `englishDefinition` 与 `generalMeaning`
- **THEN** 系统 SHALL 将 `general_meaning`、`dictionary_definition`、`dictionary_source` 和获取时间写回现有 `vocabulary.srs.store.v1` 内容

#### Scenario: 再次打开已经缓存的词
- **WHEN** 词条已经具有持久化的 `general_meaning`
- **THEN** 页面 SHALL 直接显示常用释义并且 SHALL NOT 再次请求该词

#### Scenario: 查询词是另一拼写形式
- **WHEN** Merriam-Webster 精确词条没有 `shortdef` 但提供 spelling cross-reference
- **THEN** 服务 SHALL 跟随交叉引用获取对应基础词义，并且 SHALL NOT 选取后续地名或人名建议作为通用释义

#### Scenario: 已缓存旧版词典结果
- **WHEN** 词条的 `dictionary_source` 属于旧版 Merriam/Gemini 解析结果
- **THEN** 页面 SHALL 隐藏该旧结果并重新加入批量补全；其他来源或人工通用释义 SHALL 保持不变

#### Scenario: 词典或翻译服务不可用
- **WHEN** 批量请求失败或某个词没有词典定义
- **THEN** 复习流程 SHALL 继续显示句中释义并允许正常评分

### Requirement: 常用释义在视觉上优先于句中释义
系统 SHALL 使用黑色主文本显示常用释义，并使用灰色次文本显示句中释义。

#### Scenario: 同时显示两种释义
- **WHEN** 当前词同时具有常用释义和句中释义
- **THEN** 常用释义值 SHALL 使用黑色高对比文本，句中释义值 SHALL 使用灰色低对比文本

### Requirement: 辅助播放控制不得与核心释义竞争
系统 SHALL 将重读单词和原句以及快捷键编辑作为低视觉权重的辅助控件放置在单词面板边缘，不得形成与单词或释义同级的内容块。

#### Scenario: 查看正常复习卡片
- **WHEN** 右侧面板显示单词和释义
- **THEN** 重读控件 SHALL 位于面板右下边缘，使用小号、低对比度、透明背景的样式
