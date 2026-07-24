# ECDICT 独立本地词典模块

这是第一阶段的隔离模块。它没有被 `src/main.js`、阅读器、词汇服务或 SRS
入口导入，只能由独立 CLI 手动调用。默认 `ECDICT_ENABLED=false`；关闭时不会打开、
探测或初始化词典数据库。

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
