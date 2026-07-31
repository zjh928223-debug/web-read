# ECDICT 构建与查询性能记录

记录日期：2026-07-24
环境：Windows，AMD Ryzen 9 7945HX（16 核 / 32 线程），Node.js 24.13.1，
Python 3.10.10。

数据源为当日下载的官方基础版 `ecdict.csv` 与 `lemma.en.txt`。数据文件和生成库
位于 Git 忽略目录，没有提交。

## 构建

| 指标 | 结果 |
|---|---:|
| 导入词条 | 770,611 |
| lemma 映射 | 102,867 |
| SQLite 文件大小 | 149,233,664 bytes（约 142.32 MiB） |
| 构建耗时 | 10.584 s |

数据库包含以下显式索引：

- `idx_entries_word`：`word COLLATE NOCASE`
- `idx_entries_sw`：`sw COLLATE NOCASE, word COLLATE NOCASE`
- `idx_lemma_forms_form`：`form COLLATE NOCASE`

`word` 的 unique constraint 和 `lemma_forms(form, lemma)` 主键还会创建对应 SQLite
索引。普通查询均走等值索引，不进行全表扫描。

## 查询

命令：`npm run dictionary:benchmark`，每类预热后执行 1,000 次。

| 查询路径 | 平均 | P50 | P95 |
|---|---:|---:|---:|
| exact (`look`) | 0.0469 ms | 0.0443 ms | 0.0544 ms |
| normalized (`longtime`) | 0.0526 ms | 0.0512 ms | 0.0576 ms |
| lemma (`looked`) | 0.0465 ms | 0.0456 ms | 0.0501 ms |

这些数字是本机单次运行记录，用于确认索引路径和量级，不是跨设备性能承诺。
