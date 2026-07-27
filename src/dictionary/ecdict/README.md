# ECDICT 独立本地词典模块

ECDICT 的 Node SQLite service 仍与阅读器业务隔离，只读访问独立数据库。阅读器只导入
browser client、`DictionaryEnrichmentAdapter` 和 formatter；当前已接入文章预习和复习答案区，
但不会写入 SRS、复习记录、卡片或现有释义。默认 `ECDICT_ENABLED=false`。

`vite.config.js` 可以静态加载 ECDICT plugin 模块；关闭开关时 plugin 不注册 endpoint，
SQLite service 也不会初始化。启用后，SQLite service 只在第一次查询时延迟加载。

## 边界

- 公开入口只有 `index.mjs` 创建的 `LocalDictionaryService`，公开类型见
  `domain/types.ts`。
- 运行时只读打开独立的 `ecdict.sqlite`，不导入或查询任何业务 repository。
- 构建脚本只写 `ECDICT_DATABASE_PATH` 指定的词典文件，并以临时文件构建后原子替换。
- 不扫描文章，不生成卡片，不调用 AI，不写入词汇/SRS 数据。
- 短语仅进行完整字符串查询；无词条时返回 `none`。

## 环境要求

- Node.js 24（使用内置 `node:sqlite`；项目当前验证版本为 24.13.1）
- Python 3.10+（构建脚本仅使用标准库）

配置字段见 `config/ecdict.env.example`。项目不自动读取 env 文件，请由终端、IDE 或
进程管理器注入环境变量。

## 获取数据

数据来自 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)：

- 基础版 `ecdict.csv`
- `lemma.en.txt`

PowerShell 示例：

```powershell
New-Item -ItemType Directory -Force data/dictionaries/sources
Invoke-WebRequest https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv `
  -OutFile data/dictionaries/sources/ecdict.csv
Invoke-WebRequest https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt `
  -OutFile data/dictionaries/sources/lemma.en.txt
```

`data/dictionaries/` 已整体加入 `.gitignore`，CSV、lemma 数据和 SQLite 均不会提交。

## 构建、删除和重建

PowerShell：

```powershell
$env:ECDICT_CSV_PATH = "data/dictionaries/sources/ecdict.csv"
$env:ECDICT_LEMMA_PATH = "data/dictionaries/sources/lemma.en.txt"
$env:ECDICT_DATABASE_PATH = "data/dictionaries/ecdict.sqlite"
npm run dictionary:build
```

安全删除只接受显式的文件路径，不会猜测目标：

```powershell
$env:ECDICT_DATABASE_PATH = "data/dictionaries/ecdict.sqlite"
npm run dictionary:clean
```

重新构建就是再次执行 `npm run dictionary:build`；脚本在临时数据库完成导入和
完整性检查后，才原子替换目标文件。应用启动时不会触发构建。

## 手动查询

```powershell
$env:ECDICT_ENABLED = "true"
$env:ECDICT_DATABASE_PATH = "data/dictionaries/ecdict.sqlite"
npm run dictionary:lookup -- looked
npm run dictionary:lookup -- "run into"
```

## 第二阶段：本地预习候选接入

第二阶段通过浏览器 client 和 `DictionaryEnrichmentAdapter` 把 ECDICT 结果附加到
“当前文章预习”候选的瞬时 `dictionarySuggestion`。启用本地 Vite host：

```powershell
$env:ECDICT_ENABLED = "true"
$env:ECDICT_DATABASE_PATH = "data/dictionaries/ecdict.sqlite"
npm run dev
```

Vite dev/preview server 会提供：

```text
GET /api/dev/dictionary/ecdict?q=looked
```

预习列表会以独立的 `ECDICT` 行显示 direct、normalized 或 lemma 候选。多候选只展示
歧义，不自动选择。endpoint 不可用、超时、缺库或损坏时，预习和 AI 操作继续沿用
现有流程。

以下边界仍然有效：

- `dictionarySuggestion` 只存在于当前内存中的 preview scan；
- 不进入 `buildPreviewAnnotationTemplate(...)` 或 AI prompt；
- 不写入 annotation bundle、vocabulary repository、SRS、card 或 review record；
- 不覆盖 `meaning`、`simple_meaning`、`context` 或 `memoryHint`；
- `ECDICT_ENABLED=false` 时 browser client、endpoint 和 SQLite service 均不初始化。

真实 endpoint smoke：

```powershell
$env:ECDICT_ENABLED = "true"
$env:ECDICT_DATABASE_PATH = "data/dictionaries/ecdict.sqlite"
npm run dictionary:endpoint-smoke
```

## 复习答案区辅助查询

启用 ECDICT 后，overlay 与 standalone 复习入口会把同一个可选 browser client 注入
`SrsReviewPage`。当前卡片出现时查询完整的 `word.word`（短语不拆分），结果只在答案揭示后
显示于现有释义之后：

- exact 显示词头及 translation，缺少 translation 时使用 definition；
- normalized 与 lemma 分别显示候选类型、数量和词头，不自动消歧；
- none 和 disabled 不显示词典区域；
- endpoint unavailable 或请求失败只显示弱提示，不弹 toast，也不阻止评分、播放或翻页。

成功结果只缓存在当前复习组件会话的内存 `Map` 中。失败与 unavailable 不缓存；结果不会进入
`cacheGeneralMeanings(...)`、VocabularyRepository、card、review log 或 IndexedDB。

关闭开关、缺库、损坏库或查询异常都会返回结构化的 `available: false` 与错误码，
而不是向阅读器传播异常。CLI 在不可用时使用退出码 2。

匹配优先级是 `exact → normalized → lemma → none`，但结果会同时保留可用候选：

- exact 对大小写不敏感，不忽略空格、连字符或撇号；
- normalized 与官方 `stripword` 一致：小写并删除非字母数字字符，冲突全部返回；
- lemma 允许一个 form 对应多个 lemma，且不会移除原词 direct match。

## 测试和性能

```powershell
npm run dictionary:test
$env:ECDICT_ENABLED = "true"
$env:ECDICT_DATABASE_PATH = "data/dictionaries/ecdict.sqlite"
npm run dictionary:benchmark
```

测试使用临时小型词典，不依赖下载大型数据。性能实测记录见
`docs/ecdict-performance.md`。

## 对官方 `stardict.py` 的评估

本模块复用了官方字段语义、`stripword` 规则、CSV/lemma 文件格式和 SQLite 索引
思路。没有直接把 `StarDict` 用作运行时 repository：其构造过程会执行
`CREATE TABLE/INDEX` 并提交事务，不符合“运行时严格只读”的边界。`LemmaDB` 的
`stem -> form1, form2` 解析规则已在离线构建脚本中等价落库，并增加了 form 索引。

## 数据来源与许可证

ECDICT 仓库将代码和数据以 MIT License 发布；使用和再分发时应保留其版权和许可
声明。上游许可证：
[ECDICT LICENSE](https://github.com/skywind3000/ECDICT/blob/master/LICENSE)。
本仓库不再分发完整上游 CSV、lemma 文件或生成数据库。
