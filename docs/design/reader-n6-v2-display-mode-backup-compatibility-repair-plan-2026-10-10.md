# N6 v2 显示偏好键备份与兼容采集：有界施工方案

2026-10-10。状态：**方案已编制，补丁施工、补丁独立复审和 N6 收口续跑均未执行。** 当前授权只编制本方案；执行模型收到施工指令后按下列顺序落实。目标仅是让既有 v2 偏好键被备份合同和兼容采集正确识别，保留 v1 与原始值，继续拒绝未知键。

## 1. 已知阻断与本次授权

[原阻断报告](C:/Users/0/AppData/Local/Temp/reader-n6-final-evidence-20261010-20261010-151711/protection-baseline/protection-blocker.json) 记录：六域保护导出遇到 `vocabulary.passage-preview.translation-display-mode.v2`，抛出 `BACKUP_UNCLAIMED_LOCAL_STORAGE_KEY`。完整保护副本和全量逐 ID 基线未创建；release、5184/8776 切换、浏览器 A1–A12 未运行。原停止记录、失败原件与历史缺口保留。

现有 producer 在 `src/features/passage-preview/passage-preview-shortcuts.js` 写入该精确键，值为原始字符串 `hold` / `persistent`。备份键规格、兼容采集 raw-text 集合，以及兼容采集实际读取的两份 claim/source 清单均缺此键。因此需要四处登记；只加解析集合不能完成 claim 与来源校验。

用户本次授权是[剩余收口方案](E:/read-web-next-optimization/docs/design/reader-n6-remaining-closeout-plan-2026-10-10.md) §4.1“停止、不改备份实现补能力”的**单键登记例外**。只修此已知缺口，不授权通用备份改造、额外未知键登记、偏好迁移或任何 N6 功能变化。补丁双轴独审通过后，才恢复该方案的保护基线阶段。

## 2. 固定合同与隔离边界

| 项目 | 固定要求 |
| --- | --- |
| 新精确键 | `vocabulary.passage-preview.translation-display-mode.v2` |
| 新记录 schema 标签 | `passage-preview.display-mode.v2`；仅用于此键的备份/采集记录标签，不改变应用、六域、envelope、bridge 或 owner registry 版本 |
| 原键及标签 | `vocabulary.passage-preview.translation-display-mode.v1` / `passage-preview.display-mode.v1` 原样保留；所有其他既有登记不变 |
| 备份值 | `rawText: true`，沿用现有 `{ schemaVersion, value }` 包装及现有恢复路径；原字符串逐值保持 |
| 兼容采集身份 | `passage-preview` 域、`localStorage` 来源、`non-canonical` 偏好，沿用 v1 的分类和来源政策 |
| owner 导入 | 沿用现有排除政策；v2 在 `excludedRecords`，不得成为 canonical/compatibility importInput，不新增写接口 |
| 未知键 | 备份采集继续抛出 `BACKUP_UNCLAIMED_LOCAL_STORAGE_KEY`；兼容采集继续 blocked/unclaimed，不静默丢弃 |

保留 v1/v2 共存：不读 v1 去补写 v2，不删除、重命名、覆盖任一键，不改 producer 的默认值/归一化/模式切换。备份与采集不新增枚举验证或值修正；例如 v1 的 `sentence` 与 v2 的 `persistent` 必须分别保留。缺失的键不凭空生成默认值。

实施仅在 `E:/read-web-next-optimization`。测试只写本轮新建 Temp 和隔离内存 storage；构建只写本工作区既有构建产物。不得写真实 Chrome profile、优化学习数据或 live owner；不得启动页面、调用实际导入/恢复提交或切换开发 release。

日常 `E:/ReadWebDaily/N5-20261007`、数据 `E:/ReadWebData/SubtitleWorkflow-Daily-N5`、5194/5195/8786，以及旧保护树 `E:/read-web-next`、历史树 `E:/read-web` 不读写、不构建、不启停、不复制用于本补丁验收。5184/8776 保持现有运行状态；不按 profileId 批量停进程，不安装浏览器。

## 3. 文件 allowlist 与精确增量

| 文件 | 唯一允许的实现增量 |
| --- | --- |
| `src/services/persistence/read-web-application-backup.js` | 在 `PASSAGE_PREVIEW_STORAGE_KEYS` 的 v1 项旁新增 v2 精确规格、v2 标签、`rawText: true` |
| `src/services/windows-owner-legacy-compatibility-bridge.js` | 在 `RAW_TEXT_LOCAL_STORAGE_KEYS` 新增 v2 精确键 |
| `docs/architecture/windows-local-owner-thin-reader/owner-registry.json` | 在 passage-preview 的 `nonCanonicalRecords` 新增 v2 精确 key 与唯一对应 schema 标签 |
| `docs/architecture/windows-local-owner-thin-reader/domain-inventory.json` | 在 passage-preview 的 `ephemeralOrPreferenceKeys` 新增 v2 精确 key、`storage: localStorage`、v2 标签及 `UI preference/raw text` 分类；来源依据指向现有 producer |
| `scripts/passage-preview-v2-backup-compatibility-check.mjs` | 新增一个直接覆盖本键的受控回归探针；调用真实模块和真实两份清单，不复制备份/bridge 实现 |

四个登记文件只加必要条目与逗号，不重排/格式化整份文件，不改全局版本、旧条目、claim 构建、来源匹配、异常、校验、import 排除或通用 restore 逻辑。两份 JSON 是静态运行登记，新增项的本轮时间由 patch/closing 记录；不把原 `capturedAt` 改成全清单重新核验，也不将新增登记作为历史采集证据。

既有 `scripts/application-backup-adapter-check.mjs`（本方案核对时 297 行）和 `scripts/windows-owner-legacy-bridge-check.mjs`（477 行）只运行、不修改。新探针目标不超过 250 行，仅含必要加载、内存 fixture 和断言；超过此范围须先解释并重新定界，不扩成支持脚本框架。无需添加 package.json 命令。

禁止改动：`application-backup.js`、production/rehearsal harness、api-contract、运行配置/launcher、后端、owner/CAS/receipt、IndexedDB schema、偏好 producer，以及 PassagePreviewPage、use-passage-preview、预加载、批次推进、首次接触和 SRS/词库。允许文件不足以完成目标时停止，不自行扩大名单。

## 4. 施工前 actual opening

1. 保存当前 HEAD、分支、dirty/status、已存在及已删除 tracked 路径、全部 tracked/非忽略 untracked 文件的 SHA-256。以实际工作树比较，不以 HEAD diff 充当本轮增量，不 reset/restore/clean。
2. 保存四个登记文件原文与 SHA-256；确认它们确实只有 v1、没有 v2。记录两份既有 focused 脚本和 producer 的身份。所有原件写本轮新 Temp，不覆盖原阻断目录。
3. 与最新已有 closing 比较，逐文件解释先前授权增量；保留最后 S5 两文件的已审身份：`use-passage-preview.js` 为 `00c0c61a90f0633dc0031e1f9037704d4c546b3c166201904e2d9d0cba5b90db`，`passage-preview-n6-s5-check.mjs` 为 `f9d4907927a42cc5f628ae383c689a23f92c82f00b041f81c0c7dc974a71acc0`。发现不明漂移则停止。
4. 仅只读记录已知优化 owner 文件身份，明确“少量文件 hash 不是完整保护副本/逐 ID 证明”。本补丁不需要新采集真实 profile 或暂停服务；学习数据写入必须为 0。

本方案编制时已另存新的 planning opening：1,278 个现存文件与上一轮 planning closing 无差异，8 个既有 tracked 删除路径单列，四个已知优化 owner 文件身份一致。此记录仅证明本次编制区间，不是原施工 opening、补丁施工 opening 或完整学习数据保护证据。

## 5. 固定回归矩阵：先复现，再登记

新探针使用实际 backup adapter/service、实际 bridge 及其默认两份 JSON 登记，fixture 放隔离内存。不得传入自制宽松 claims/source policies，不用字符串搜索替代行为检查。预修复运行与修后运行使用同一探针、同一 fixture、同一断言，并记录探针自身 hash。

| ID | 固定场景 | 修后验收与证据 |
| --- | --- | --- |
| V2-01 | v2 单独存在，分别 `hold` / `persistent` | 调真实 passage-preview collector，并经现有六域 service 创建受控 artifact；记录精确 id、schema 和原始字符串，artifact/checksum 沿现有检查通过 |
| V2-02 | v1 单独存在 `sentence`；v1/v2 均不存在 | v1 原合同通过；不存在的键不生成，不改变其他域或键 |
| V2-03 | v1=`sentence` 与 v2=`persistent` 共存 | 导出含两个独立记录及各自标签/原值；向新的隔离 MapStorage 调现有 restoreRecords，再逐键比较；v2=`hold` 亦覆盖 |
| V2-04 | 原始字符串保真 | 额外固定一个非枚举字符串（例如 ` original value `）验证存储运输不 trim、不改成默认值、不 JSON 解析；仅内存测试，不修改产品可选模式 |
| V2-05 | bridge 真实默认 claim + localStorage 采集 | v1/v2 都 ready、域和标签正确、分类 non-canonical；`readRollbackWindow` 回读对应原字符串，inventory 仅元数据且不泄露原值 |
| V2-06 | bridge `prepareImport` | 干净 fixture 的计划 ready，v1/v2 在 excludedRecords、不在 importInput；零 storage/owner/Host 提交，原值未变 |
| V2-07 | 未知键与混合输入 | 保留 `vocabulary.passage-preview.future.v9`；再测 `translation-display-mode.v3`。单独及与合法 v2 共存时，备份均按原码拒绝，bridge 均 blocked/unclaimed；不能只采合法键并报整体成功 |
| V2-08 | 原合同回归 | 两个既有 focused checks 通过；旧坏 JSON、未知 schema、来源不匹配等既有防线和 v1 断言继续有效；新探针观察到的源 fixture 写入/移除计数为 0，restore 仅写新的测试目标 |

预修复 V2-01 和 V2-05 分别独立执行：前者必须记录实际 `BACKUP_UNCLAIMED_LOCAL_STORAGE_KEY`；后者记录实际 unclaimed/blocked 原因。探针不能因第一个失败便漏测另一个。正向断言失败应产生非零退出码；修后两路通过。受控失败日志标明 fixture、来源版本与时间，不称为再次运行真实 profile 导出，也不替换原失败原件。

先落探针并复现，再依次完成四处精确登记；不改探针验收来迁就实现。探针不为 v2 开辟新 import/写入路径，恢复测试也不增加针对通用 restore 的新安全规格。

## 6. 有界验证与施工 closing

在本工作区运行并保存命令、版本身份、原始 stdout/stderr、退出码及时间：

```text
node scripts/passage-preview-v2-backup-compatibility-check.mjs
node scripts/application-backup-adapter-check.mjs
node scripts/windows-owner-legacy-bridge-check.mjs
npm run build
```

新探针是本次直接行为验证；既有脚本验证原备份/兼容边界；build 验证 JSON 和模块消费图。既有 warning 如实保留，不能把 exit 0 改写成全仓通过。本阶段不运行 release、真实 profile rehearsal、4173/5184 页面、A1–A12 或实际恢复；本补丁测试 PASS 不能证明真实浏览器或全量旧数据保护。

保存 `opening/`、`pre-fix/`、`post-fix/`、`closing/` 和简短 `handoff.md`：完整 opening→closing 路径/内容比较、只包含本轮增量的 patch、五个允许文件的前后身份、原两个 focused 脚本身份不变、命令证据和矩阵逐项状态。产品增量只能是四个精确登记；新探针是唯一新增检查文件。

closing 核对 HEAD 未变、S5 两文件及 producer 未变、allowlist 外原文件与原删除路径无漂移；新生成的 ignored 构建产物另列，不伪装为产品源文件。已知优化 owner 文件前后 hash 与所有测试写调用记录分开报告。任何非预期源文件或真实数据变化均停止交付，保留证据，不清理合法记录或覆盖原件。

## 7. 独立 Spec/Standards 复审门

施工模型只交付“施工完成，待独立复审”；不得自审自宣 PASS。由独立审核模型核对完整原件、直接增量和真实模块消费者，分别裁定两轴；可共享证据，但不能将施工摘要当审核依据。

| 轴 | 本补丁预先固定的审核范围 |
| --- | --- |
| Spec | 四处精确登记一致；V2-01–08 的 v1/v2 保真、默认来源采集、non-canonical 排除及未知键拒绝成立；实际失败→通过与版本匹配 |
| Standards | 无通配/放宽拒绝/值迁移/版本或功能扩张；实际消费两份清单；零真实数据写入、无日常操作；opening/closing 和 S5 身份保留，探针有界且未复制实现 |

任一轴 FAIL、NOT_RUN 或存在阻断 P0–P2，保持 `PATCH_NOT_CLOSED`，不得进入 N6 依赖阶段。同一补丁两次连续修复/复审失败后停止自动迭代，按 AGENTS.md 重新定界；其他未知键或新能力缺口不在本授权内。审核不得由本次登记推断历史数据未改变或全量备份已完成。

仅两轴均对本补丁有限 PASS、无阻断 P0–P2，才标记 `V2_REGISTRATION_PATCH_CLOSED`。范围仅为登记兼容修复；**N6 整体仍未 CLOSED**。

## 8. 通过后衔接 N6 剩余收口

1. 以本补丁实际 closing 和独立审核结果作为新的源码比较点；与 S5 已审版本相比，四处登记是用户批准的增量，S5 功能文件不变。再次保存真实 N6 续跑 opening，不沿用或重命名本方案编制/补丁 opening。
2. 回到[剩余收口方案](E:/read-web-next-optimization/docs/design/reader-n6-remaining-closeout-plan-2026-10-10.md) §4 的保护基线阶段，用原有 harness/导出合同与新的隔离目录重新采集优化来源；只在这时确认真实 v2 阻断是否消除、完整六域副本和全量逐 ID 基线是否建立。不得覆盖原失败目录，不删除/过滤未知键以获得成功。
3. 若真实导出再次发现未知键、坏记录或一致性问题，保存新的实际原因并停止保护依赖步骤；不再顺手登记下一键。受控单键补丁可保持其已审核结论，真实完整保护仍按实际结果记 FAIL/NOT_CREATED。
4. 完整保护前置条件通过后，才按原方案更新最终 patch 的优化 release、核对 5184/8776 身份并做最终版本真实浏览器 A1–A12，再交 N6 独立双轴复审。不得用本次 build/内存探针代替真实旅程。
5. 原施工及旧数据历史逐 ID 原件缺口继续 `NOT_VERIFIED`；新增保护只能证明其真实覆盖区间。不补造历史、不自动豁免原 Standards-S2；历史缺口未闭合时，最多给原剩余方案规定的新基线有限 PASS，不宣称 N6 正式 CLOSED。不更新全仓 Last verified、R 状态或日常推广。

## 9. 给施工模型的执行指令

> 只执行本方案的 v2 单键登记补丁。先保存 actual opening，核对 dirty 树、S5 两文件和四个登记文件原件；写一个有界直接探针，以真实 backup/bridge 和默认 JSON 清单分别复现 v2 备份拒绝与兼容采集 unclaimed。只改四处精确登记，保留 v1 和所有原始值，不迁移、不改 import 排除、不放宽未知键。按 V2-01–08 在隔离内存验证导出/恢复/回读/未知键拒绝与零源写入，运行两份原 focused checks 和 build，保存本轮增量及完整 closing。真实学习数据写入为 0；日常、旧保护树、5184/8776、release、profile rehearsal、浏览器和 N6 功能均不操作。交独立 Spec/Standards；两轴未通过不继续 N6。两轴通过后才以新 closing 衔接原剩余方案的保护基线阶段，遇其他未知键停止，保留历史 NOT_VERIFIED 和全部原失败，不能自宣 N6 CLOSED。
