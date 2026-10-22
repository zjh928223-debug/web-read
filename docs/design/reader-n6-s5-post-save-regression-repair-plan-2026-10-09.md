# N6 S5 保存后重开回归：第三轮有界修复方案

2026-10-09。用户已明确选择“仅修回归”，授权在两次失败停止后继续这一有界修复。本文件只编制方案，尚未执行产品修补、构建、运行或独立复审。

## 1. 唯一目标与结论边界

唯一目标：**最后一次保存正在等待时，用户关闭预习；保存返回后，失效请求不得重新打开面板或发布旧页面状态。**

对应固定首版方案 A5/A7 与第 72 行“等待期间可关闭且旧请求不得重新打开页面”。它是同一个 S5 回归在文件导入、旧格式恢复、新组生成三个入口的表现，不新增功能或验收规格。

依据：
- [第二次修复后独立总审](C:/Users/0/AppData/Local/Temp/reader-n6-s5-rereview-20261009/review.md)。
- [Spec 与三个原函数时序探针](C:/Users/0/AppData/Local/Temp/reader-n6-s5-rereview-20261009/spec-review.md)。
- [Standards 复审](C:/Users/0/AppData/Local/Temp/reader-n6-s5-rereview-20261009/standards-review.md)。
- [N6 固定首版方案](E:/read-web-next-optimization/docs/design/reader-n6-independent-preview-construction-plan-2026-10-07.md)。

原 S5-R1 旧预加载覆盖、S5-R2 旧推进覆盖新导入已经有限闭合，本轮保留这两个原回归，不重做其实现。

**本轮即使通过，也只关闭此 S5 回归。原 N6 施工 opening/closing 与旧数据逐 ID 保护仍 NOT_VERIFIED，完整真实矩阵缺项沿用前轮记录，不宣布 N6 CLOSED。**

## 2. 开工与隔离

唯一产品目录 E:/read-web-next-optimization；开发入口 5184/8776，数据 E:/ReadWebData/SubtitleWorkflow-Optimization。日常副本 E:/ReadWebDaily/N5-20261007、日常数据 E:/ReadWebData/SubtitleWorkflow-Daily-N5 与日常服务不得修改、停止或用于验收写入；E:/read-web-next 和 E:/read-web 继续保护。

本方案编制时只读核对 1,276 个 tracked/nonignored untracked 文件，与上一轮源码 closing 改/增/删均为 0；HEAD 为 153f9464356c9f59020f4f35ede713a807c798d3。规划证据为 C:/Users/0/AppData/Local/Temp/reader-n6-s5-regression-planning-20261009/。

执行模型开工须另存**本轮实际 opening**：完整 dirty、HEAD、路径/SHA256、下列两个允许文件完整原副本，以及优化运行目录/数据根/owner 身份。以当前 dirty 为基线，不能用 HEAD 覆盖。与规划身份的新增差异先逐项归属，不改其他执行者文件。

规划快照及本轮开工快照都不能改名为原 N6 开工证据。保存本轮 current protection 是保护现在的数据，不是补造过去的 opening。

## 3. 唯一允许改动

| 文件 | 允许 hunk |
|---|---|
| src/features/passage-preview/use-passage-preview.js | enqueuePassagePreviewWrite 的完成后代际校验；openStoredPassagePreviewLegacy 两分支、openFirstAvailableIeltsPreviewBatch、importPassagePreviewFile 在 await 写队列后发布 UI 前的当前请求校验 |
| scripts/passage-preview-n6-s5-check.mjs | 在原两个回归上增加三个最后保存关闭负例及必要对照；只作本问题的直接回归 |

本轮不新增产品模块、不改 package.json（已有 npm alias 足够），不改 daily-continuation 的已闭合 canCommit 逻辑、预加载实现、Page、CSS、数量/成员规则、共享词库/SRS、存储 schema/owner/CAS/receipt、后端、TTS 或日常树。其他队列消费者可只读核对，不顺带重构。

证据、patch、探针日志与交接可写本轮新 Temp 目录；不重写原审核报告，不追加全局 CLOSED/Last verified/R 状态。

## 4. 固定修复方法

推荐同时保留两层校验，均使用现有 requestId：

1. **写队列完成层**：保持开始前校验；await operation() 后再次检查请求。过期返回既有取消语义 false；当前请求保留 operation 原返回值。保持真实错误向调用者传播，以及失败后队列仍可继续执行的既有 catch 链。
2. **UI 发布层**：三个入口在 await enqueuePassagePreviewWrite 返回后，先同时确认结果可用与 requestId 仍当前，再更新 items、contact summary、open、entryState。legacy 两个同构分支均补齐；不只补迁移分支。

示意（依实际当前代码做精确 hunk，不复制整文件）：

```js
const result = await operation()
if (!isOpenPassagePreviewRequestCurrent(requestId)) return false
return result

// 消费者 await 写队列后、发布页面状态前
if (!committed || !isOpenPassagePreviewRequestCurrent(requestId)) return
```

返回值按现有函数合同处理：布尔入口返回 false，void 导入入口直接 return；不把取消伪报成功，不制造新的错误状态。

已开始的合法保存可正常完成。**不撤销 owner 提交、不回滚旧备份、不删除合法记录、不重置写队列**；关闭仍立即返回阅读器，不等待所有持久写入才隐藏页面。原有序队列及 transition 各步 canCommit 保留。

## 5. 冻结验收：三个负例与必要对照

测试直接复用当前原函数、合法导入/迁移输入；外部 I/O 用内存回调和可控 gate，不能复制学习算法或向真实学习 owner 注入故障。可沿用上轮 spec-source-probes 的原函数提取与 fixture，但保存到本轮新目录，不能覆盖原探针结果。

每个负例必须先等待“指定最后保存已开始”的 entered 信号，再关闭；不能靠任意 sleep 或只在准备阶段关闭来避开回归。

| 负例 | 暂停点与操作 | 放行后的固定断言 |
|---|---|---|
| T1 文件导入 | data 保存已完成；最后 saveProgress 已开始、尚未返回；调用 close，然后放行 progress | 关闭即时 open=false；全部相关 Promise/微任务结算后仍 false；不发布失效导入的 items/summary/entryState |
| T2 旧格式恢复 | 合法旧格式已迁移准备；最后 saveData 已开始、尚未返回；close 后放行 | 仍关闭，入口返回 false；不发布旧恢复结果。另只读核对 legacy 的有效格式分支同样有返回后校验 |
| T3 新组生成 | data/progress 已保存；最后 saveContinuation 已开始、尚未返回；close 后放行 | 仍关闭，入口返回 false；不发布旧新组结果、不将 entryState 改回 READY |

每例记录请求代际、关闭即时 open、旧保存完成后的 open、UI 发布计数及调用顺序。原失效时序修复前应见 false→true，修复后应见 false→false；逐例保留原始结果，不能只用第一条断言中止产生的 FAIL 代表三例已复现。

必要对照：
- 相同入口未关闭、请求仍当前时，原成功结果及正常 UI 发布保持；可参数化复用上述 fixture。
- 原 S5-R1 旧 preload 返回后新句/新缓存保留。
- 原 S5-R2 archive 等待→close→新 import，旧后续写入不执行，最终新组保持；沿用现有两个测试。

断言关注旧 UI 回调，不把已开始保存的正常完成称为数据破坏；不要要求取消已经提交的合法学习结果来使测试通过。

新增脚本当前基线 164 行，尽量保持总长不超过 300 行。超过已审基线两倍（328 行）或约 500 行时，按 AGENTS 先报告复杂度与边界，不自动扩大 runner。不修改无关断言，不以静态源码字符串宣告真实 Host/UI/TTS PASS。

## 6. 顺序与检查

1. 保存实际 opening，复现 T1–T3，逐例保留修复前结果。
2. 按两个允许文件做一次有界修复，记录精确增量 patch。
3. 运行 T1–T3 及对照，保留修复后结果；确认原 R1/R2 仍通过。
4. 在同一稳定源码运行：
   - npm run verify:passage-preview:n6-s5
   - npm run verify:passage-preview:daily-continuation
   - npm run verify:passage-preview:durable-state
   - npm run verify:passage-preview:session-cache
   - npm run build
   - npm run verify:vite
5. 保存每条原始 stdout/stderr、exit code、时间、源码身份与运行层。预期红灯与 harness 故障分别登记，保留原 FAIL；不运行全仓或为旧失败修其他 runner。
6. 如更新开发预览并做浏览器冒烟，只用既有优化启动脚本/配置及 5184；先核对进程运行目录、数据根和所有权，不按 optimization profileId 批量停服务。不得操作日常实例。

真实浏览器正常打开/返回/重进只证明相应冒烟，不代替三个 gate 故障注入，不冒充真实关 tab→新 tab 或完整 TTS/双域 terminal。

若进行会触发 owner 写入的真实浏览器验证，须先保存本轮优化 profile 完整保护副本及对应逐 ID 内容，优先用已确认接触/注册的当前目标，避免浏览未见项制造样本；无法保证时停止该真实写入，报告 NOT_RUN 或使用固定首版允许的完整隔离副本。不得覆盖进行中的组或删除目标。无真实业务写入的内存探针无需启动服务。

## 7. 独立复审与本轮出口

执行模型交接后，由独立审核只读复核；不让施工自检代替独审。

- **Spec**：仅按 T1–T3、正常成功对照与原 R1/R2，确认保存返回后的过期请求不发布 UI。
- **Standards**：增量仅两个允许文件；队列/返回/错误合同保持，未改数据模型/owner/保护树；脚本未复制学习算法或伪报真实层结果。
- 保存 actual opening、允许文件原副本、patch、命令/探针/冒烟证据、closing、审核报告。closing 对照实际本轮 opening；数据写入须有本轮精确 ID/字段差异解释，只有修订号变化也须如实登记。
- 两轴通过可声明“S5 保存后重开回归有限闭合”；N6 整体仍未正式 CLOSED。原施工逐 ID 保护 NOT_VERIFIED 与其他既定未跑项保持。
- 本轮获得的是第三轮有界继续授权。若本轮独审仍有该回归或修复必须越出这两个文件，停止交接，不自动进入第四轮，不恢复自动无限迭代。

## 8. 可直接交给施工模型的文本

> 用户已批准仅修 S5 保存后重开回归。阅读本方案及 reader-n6-s5-rereview-20261009/review.md，先保存当前 dirty/actual opening，不覆盖原工作。只改 use-passage-preview.js 的队列完成后和三个入口 UI 发布前 requestId 校验，以及现有 passage-preview-n6-s5-check.mjs 的直接回归。关闭仍即时生效，已开始的合法保存可完成，不回滚提交/备份或删除目标。先逐例复现导入最后 progress、旧格式最后 data、新组最后 continuation 等待中关闭导致重开，再验证修复后均不重开，正常成功对照和原 preload/transition 两项仍通过。按本方案运行定向检查/build/verify:vite，实际开发预览只用优化目录/5184/8776与优化数据，日常程序/服务/数据不动。保存原 FAIL、精确 patch、结果与 closing，交独立 Spec/Standards 复审；不能自宣 N6 CLOSED，不补造原施工 opening 或把旧数据 NOT_VERIFIED 改成 PASS。若仍失败或需扩界，报告并停止，不自动第四轮。

