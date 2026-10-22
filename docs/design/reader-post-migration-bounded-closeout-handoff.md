# 本轮有限收口施工交接

日期：2026-10-03（Asia/Shanghai）。**执行侧部分完成；R1 验收未收口，整体 NOT_COMPLETE；独立审核尚未开展。** 本文只记录 [本轮方案](E:/read-web-next-optimization/docs/design/reader-post-migration-bounded-closeout-plan.md) 的增量，不覆盖旧 F1–F6 交接或历史状态。

证据根：[reader-bounded-closeout-20261003-141112](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112)。所有构建、截图、日志均在本轮新 Temp；正常合成服务响应经过真实业务组件/素材库入口，不代表真实 Windows Host、在线 TTS 或跨机验收。

## 施工增量与状态

| 项目 | 本轮增量 | 执行状态 |
| --- | --- | --- |
| R1 | `PassagePreviewSettingsDialog.vue` 注册现有 dialog controller；加载期间先聚焦关闭按钮；卸载释放；close 守卫消费保存期 Escape；加入保存/加载防重、aria-busy；遮罩 pointerdown.prevent 保持焦点恢复。现有浏览器脚本增加双向 Tab、校验、四种关闭路径、持久化重开及真实 Host 请求挂起检查。 | 代码已落地，验收未完成。第二次浏览器检查停在保存命令到达前的观察断言；不得称保存期通过。 |
| R2 | `styles.css` 指定规则局部合并；移除三个 workflow 根的八个冲突赋值，沿用未修改的 `workflow-ui.css` neutral 配方。 | 目标浏览器对照 PASS；一项旧源码断言 FAIL，见后文。 |
| R3 | 文件按钮、视频标题栏、标注气泡改为 WebKit 声明在前、标准声明在后；气泡关闭按钮局部显式保留原 glass-blur-sm 配方。 | source/after-dist 目标有效滤镜一致，PASS。未修改 Vite 配置、依赖或 node_modules。 |
| R4 | `theme.js` 移除五个仅生成/清理的 chunk-note 变量，保留 pb 和有效 glass 变量；14 个 fixture 基础规则与 1 个手机规则移入新 `scripts/fixtures/passage-preview-check.css`，harness 显式导入。 | 消费者、规则迁移、产品产物隔离和现有评分延迟检查 PASS。 |

实际变更：上述设置组件、`styles.css`、`theme.js`、`passage-preview.css`、fixture harness、`passage-preview-browser-check.cjs` 六个既有文件，以及新 fixture CSS 和本交接。开场已有 dirty 全部保留；`workflow-ui.css`、共享 dialog controller、`vite.config.mjs` 未修改。没有提交、工作树、代理、新聊天或日常推广。

## R2 规则处理表

以下开场行号来自 [opening-rule-ledger.json](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/opening-rule-ledger.json)。目标规则均未分层（unlayered）；`reader-footprint` 层和既有 Tailwind layer 顺序保留。specificity 记为 ID/class/type。

| 开场位置 / 选择器 | media / specificity | 属性与开场胜出值 | 处理 / 保留原因 |
| --- | --- | --- | --- |
| styles.css:221、3503、3773 `.youtube-workflow-layout` | 基础与 min-width:761 / 0,1,0 | 前置132→后置112→桌面132；实际桌面132px | 移除前置132和后置基础112声明；桌面132仅由现有 min-width:761 规则负责。 |
| styles.css:420、3737 `.youtube-workflow-layout` | max-width:760 / 0,1,0 | 单列、auto/minmax 行、max-height相同，后者胜出 | 删除前置完全重复项，保留后置手机规则；760/761 双侧实测。 |
| styles.css:596、2064 `.youtube-workflow-panel` | 基础 / 0,1,0 | 后置width/max-height/overflow/padding/颜色/边框/阴影胜出；早期position/pointer-events仍有效 | surviving position/pointer-events 合入原后置规则，删前置被覆盖的整组；未移动后置规则跨越媒体条件。 |
| styles.css:184、405、3722 `.youtube-workflow .youtube-workflow-panel` | 基础与 max-width:760 / 0,2,0 | 实际桌面768×772，390手机390×844；scoped布局高于unscoped | 保留基础高specificity；手机完全重复组只保留后置一处。640/760下unscoped变体条件不同，保留。 |
| styles.css:1050、1061 `.youtube-subwindow` | 基础 / 0,1,0 | position:absolute、padding:12px由相邻后者胜出 | 两项合入前者；descendant scoped、panel-child定位及quality根fixed规则条件不同，保留。实际Teleport质量报告可打开/关闭。 |
| styles.css:619、2085 `.youtube-workflow-header` | 基础 / 0,1,0 | 后置top/margin/padding/边框/背景胜出；早期sticky/z-index/justify/cursor/user-select仍有效 | surviving属性合入原后置规则。共享flex组、scoped 0,2,0和640px变体保留；重复760px背景只留后置。 |
| styles.css:852、2182、2290 `.youtube-job-status-badge` | 基础 / 0,1,0 | 后置11px、750、pill、current-badge变量胜出；tabular-nums独立有效 | 合成一处后置基础规则；各data-status规则specificity更高且表达有效业务状态，保留。 |

三个根八项颜色变量的直接赋值现只在 `workflow-ui.css` neutral 映射。旧 :root/light/dark fallback，以及字体、active/failed 和其他状态变量保留；本轮未以变量名出现次数为理由扩删。生产 light 的 shell 文字从 `rgb(28,30,33)` 统一为 neutral `oklch(0.145 0 0)`；dark 统一为 `oklch(0.985 0 0)`。行色、边框也沿用 neutral 映射，**不宣称所有像素保持不变**。reader 五项自定义颜色通过实际原生颜色输入设置，存储键和映射未改。

## 构建原因与浏览器证据

开场新 [before-build.log](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/before-build.log) 和最终 [after-build.log](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/after-build.log) 均 exit 0。另两次只读构建阶段观察保存在 `build-stages*.log` / `css-pre-stage-*.json`，不作为最终验收产物。

开场 `styles.css` 到 Tailwind 后、Vite CSS 处理前的捕获仍含标准滤镜；当前 Vite 8 的 CSS 压缩路径使用 Lightning CSS，`cssMinify:true`，target 含 Safari16.4/Chrome111。声明顺序的受控实验 [filter-order-experiment.json](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/filter-order-experiment.json) 复现“标准在前+WebKit在后”只剩WebKit，“WebKit在前+标准在后”保留两者。当前 before/after 最终规则分别见 `before-filter-rules.json` / `after-filter-rules.json`。因此采用局部 CSS 修正，不改构建选项。

实际入口顺序保存在 [matrix-final-results.json](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/matrix-final-results.json) 的 cssOrder：source reader 为 styles.css 后加载 workflow-ui.css 等模块样式；production reader 为 learning-ui CSS 后 reader CSS；独立 srs-review.html 只加载 learning-ui CSS。两个生产入口均实际访问本轮 after-dist。

[comparisons.json](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/comparisons.json)：source/after 各8个reader上下文（1280×800、390×844 × light/dark/custom-light/custom-dark），各2个standalone学习上下文、各2个760/761边界上下文，共24个；reader内SRS在1280 light和390 dark实测。262组目标元素配对、三个workflow根八变量共192组配对，无差异；颜色按实际computed原值转换成RGBA比较，保留原值，尺寸容差1px，display/position/padding/gap/font-size/radius/标准滤镜精确比较。不是全部CSS属性、所有业务旅程或所有浏览器验收。

材料由素材库真实“打开”恢复非空合成 transcript/chunk 与生成标注，再点击 Synthetic 打开实际标注气泡，视频由同一正常素材流程打开。没有force点击、私有状态写入、媒体时间写入或额外业务实现。目标有效值：file `blur(8px) saturate(1.15)`；bubble `blur(28px) saturate(1.75) brightness(1.04)`；bubble关闭按钮 `blur(12px) saturate(1.35)`；video title `blur(6px)`。本轮不宣称视频播放行为已重新验收。

所有24上下文pageerror为0；console、阻断请求和HTTP响应原值保留，预期的not-json素材失败用于触发真实notice，不把对应错误滤成“无日志”。主reader无横向溢出，手机关闭入口可达，workflow default/icon为36px；两学习入口固定浅色。已目视390 light workflow、quality、settings和390 custom-dark bubble/workflow、390 dark学习页。

代表图：[开场production workflow](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/opening-before-reader-1280-light-workflow.png)、[最终production同上下文](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/final-after-reader-1280-light-workflow.png)、[最终手机custom-dark气泡](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/final-after-reader-390-custom-dark-bubble-open.png)、[最终手机设置](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/final-after-reader-390-light-settings.png)。

## A1–A6 固定验收结果

| 编号 | 状态 | 实测与缺口 |
| --- | --- | --- |
| A1 | PARTIAL | source 1280双向Tab、四种关闭/恢复和重开检查已通过；16个source/production reader矩阵均观察到内部初始焦点及关闭按钮可用。完整R1脚本尚未成功结束，不能宣称全项PASS。 |
| A2 | NOT_VERIFIED | 正常local持久化37、重开、取消不保存和0/201/1.5校验已通过；真实owner保存挂起测试断言时尚未观察到命令到达，保存期后续检查未执行。 |
| A3 | PASS | 指定规则处理/保留表、三根neutral映射、实际queue/quality/notice、两宽四主题和边界computed/截图已记录。 |
| A4 | PASS（本轮限定范围） | 新before/after构建，两个生产入口、正常材料滤镜消费者以及262+192组对照均已核实。 |
| A5 | PASS（规定证据） | 消费者重新检索；无变量读取消费；fixture规则15项属性/媒体逐项相同，harness为唯一入口；产品CSS无fixture专用选择器；既有评分延迟浏览器命令PASS。另一个补充样式对照runner未成功完成，单列NOT_VERIFIED，不当作浏览器样式PASS。 |
| A6 | PASS（记录与边界） | 本轮开场副本/哈希、增量、日志和字面FAIL/NOT_VERIFIED均保留；未更改数据配置、脚本顺序或共享配方。此行不表示所有命令PASS。 |

## 命令与停止点

PASS：verify:toolchain、browser-port-policy、dialog-controller、lifecycle-scope、keyboard-boundary、passage-preview:unit、passage-preview-shortcuts、theme-controls-module、glass-effects、style-editor-module、reader-controls-runtime、reader-app-runtime、youtube-workflow-panel-behavior、srs-review、srs-review-ui-v2、passage-preview:rating-latency-browser、script-order、legacy-deletion；git diff --check；before/after构建；verify:vite；verify:production-preview。明细见 [checks.json](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/checks.json)、[formal.json](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-20261003-141112/formal.json) 和各log。延迟检查DOM1.7ms、frame2.1ms，后台清理block700ms。

FAIL：`verify:youtube-workflow-panel` 第213行仍要求 styles.css 中存在旧reader继承赋值，与本轮3.2指定neutral唯一归属冲突；浏览器行为命令已PASS。该测试文件不在本轮允许编辑范围，保留FAIL并交付，不改成PASS。`node scripts/passage-preview-browser-check.cjs` 首次因遮罩恢复焦点失败，局部prevent修复后该路径通过；第二次停在保存期HTTP到达观察断言，完整命令exit1，后续旅程NOT_RUN。

R1 已按 AGENTS.md “After two consecutive fix/re-review failures on the same task, stop automatic iteration” 停止第三轮自动修复，并请求用户选择继续、拆分或简化；未收到决定前不继续依赖该决定的工作。矩阵原定位器把SRS“返回阅读器”写成“关闭”的四个失败case原样保存在matrix-results/log，仅对应四个case用正确真实入口补测成功，合并结果另存matrix-final-results，不删旧失败。补充fixture样式runner两次分别停在挂载容器/异步保存观察，日志保留；规定的真实评分延迟检查与静态规则等价证据已完成，不借补充失败修改产品。

NOT_RUN：全仓库npm test/verify:full、在线TTS/WhisperX/AI、真实Host/跨机与日常推广、独立审核；这些不冒充本轮验收。本轮最终仍须用户决定R1后完成A1/A2，才可说执行收口完成。

回滚依据是本轮 `opening/` 六个既有变更文件的开场字节和本轮增量patch，不是HEAD；新fixture CSS与本交接原本不存在。先核对后续并发增量，再逐文件回退本轮变更；不得reset/restore/clean覆盖既有dirty。源服务、构建身份与最终增量收尾证据见同Temp的source-ready/closed、closing-summary与manifest文件。


## 2026-10-03 审核后限定补跑：当前收口状态

**执行侧 COMPLETE：A1–A6 在本轮限定范围满足。** 本节是当前状态；前文是停止点的历史记录，原 FAIL、NOT_RUN、NOT_VERIFIED 和原字节全部保留。独立审核接受 R2–R4、允许保留 R1 产品修复；本次两处测试增量尚未接受新的独立只读审核，不能把执行完成写成新一轮独立审核通过。

依据：[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-bounded-closeout-review-20261003-dace1eca/review.md) 及用户限定继续指令。新证据根：[reader-bounded-tests-closeout-20261003-144518](C:/Users/0/AppData/Local/Temp/reader-bounded-tests-closeout-20261003-144518)。本次仅修改下列两处测试，并追加本节；产品、CSS、配置、共享控制器、依赖均未修改。

### 两处测试修正

- `scripts/passage-preview-browser-check.cjs`：在实际 `/api/app/owner` 的 `kind=command`、`domain=passage-preview`、`operation=legacy-import` 拦截分支通知测试；最多等待 10 秒到达请求，再核对 aria-busy 与保存期行为。响应仍挂起，finally 清理计时器、释放请求并关闭上下文。没有固定 sleep，也没有放宽行为断言。输入/取消禁用、Escape/关闭按钮/遮罩拒绝关闭、双向 Tab 不泄漏、Escape 不进入底层、释放后关闭并恢复焦点、重开41均由完整脚本执行。
- `scripts/youtube-workflow-panel-v3-check.cjs`：只替换旧配色断言，逐一要求三根八变量在 `workflow-ui.css` 中各有唯一的指定 `--rw-ui-*` neutral 映射，在 `styles.css` 同一根规则中无直接赋值。保留其余业务检查；完整命令已执行到结束。

### 当前 A1–A6

| 条件 | 当前执行状态 | 依据 |
| --- | --- | --- |
| A1 | PASS | 新源码完整 passage-preview 浏览器命令成功；初始焦点、双向 Tab、关闭/恢复、重开检查全部执行。 |
| A2 | PASS | 同一完整命令观察真实 owner 保存请求后挂起/释放；保存期间隔离、校验、取消不保存、持久化重开及后续完整旅程执行结束。 |
| A3 | PASS（限定范围） | 原规则/浏览器证据获独立审核接受；本次完整 workflow 正式源码检查通过，后续业务断言已执行。 |
| A4 | PASS（原规定范围） | 原源码/after-dist 对照和两个生产入口加载证据获独立审核接受；本次重新核对全部29个产物哈希及未改动边界文件无漂移。未重新运行24上下文。 |
| A5 | PASS（规定证据） | 原消费者/产物隔离和评分延迟证据获接受；独立审核另实际复测两宽 fixture 样式与评分。原补充 runner 的失败保持原样。 |
| A6 | PASS | 本次开场副本、两文件增量、哈希、日志和历史状态保留；未改产品/数据/配置/配方，未覆盖既有 dirty。 |

### 新运行与继承证据

| 检查 | 本次结果 | 原始证据 |
| --- | --- | --- |
| `npm run verify:youtube-workflow-panel` | PASS，exit 0，完整运行 | [workflow.log](C:/Users/0/AppData/Local/Temp/reader-bounded-tests-closeout-20261003-144518/workflow.log) |
| `READ_WEB_URL=http://127.0.0.1:5184/ node --require <Temp网络fixture> scripts/passage-preview-browser-check.cjs` | PASS，exit 0，完整运行；未启用 queue-notice-only 模式 | [passage-preview-source.log](C:/Users/0/AppData/Local/Temp/reader-bounded-tests-closeout-20261003-144518/passage-preview-source.log)、[owner请求观察](C:/Users/0/AppData/Local/Temp/reader-bounded-tests-closeout-20261003-144518/owner-request-observations-source.json) |
| 当前边界及 after-dist 身份核对 | PASS，29个资产与原 manifest 相同；追加交接前11个非本次测试边界文件相同 | [identity.json](C:/Users/0/AppData/Local/Temp/reader-bounded-tests-closeout-20261003-144518/identity.json) |
| `git diff --check` | PASS | [diff-check.log](C:/Users/0/AppData/Local/Temp/reader-bounded-tests-closeout-20261003-144518/diff-check.log) |
| 补充尝试：原 after-dist 上完整 passage-preview 脚本 | FAIL，exit 1；等待 owner 请求超时，owner 请求观察为空。该产物构建未设置 `VITE_LOCAL_SERVICE_BASE_URL`，`src/main.js` 按现行条件不初始化 owner-domain composition；保存走本地路径，Host挂起分支前置条件不成立。未改变产物、产品或跳过断言来变绿。此额外尝试不替代原规定的生产加载/样式检查。 | [passage-preview-production.log](C:/Users/0/AppData/Local/Temp/reader-bounded-tests-closeout-20261003-144518/passage-preview-production.log)、[production-result.json](C:/Users/0/AppData/Local/Temp/reader-bounded-tests-closeout-20261003-144518/production-result.json) |

本次完整源码脚本使用项目 Playwright 和 Temp 网络 fixture，沿用原脚本真实组件/服务边界。fixture 拦截外部/API请求；保存期上下文使用仓库脚本自己的健康/owner合成响应。日志中的未提供 API 合同请求与阻断记录原样保留；不宣称真实 Windows Host、在线 TTS 或外部词典验收。截图重定向到 Temp，避免覆盖工作区旧输出。

原24上下文、262组目标样式和192组变量对照是上一阶段实际执行证据；独立审核本次复核它们，**并非重新运行全部上下文**。本次也未重跑矩阵。原 before/after 构建、verify:vite、verify:production-preview 和其他相关检查沿用已核实身份、且已获独立审核接受的结果；没有把继承结果写成新执行。本次只改测试，因此未新增产品构建。

NOT_RUN（本次）：新独立审核、全仓库 npm test/verify:full、真实 Host/跨机、在线服务、日常推广。它们不替代本轮必要命令；前文原命令历史 FAIL 仍是 FAIL，原中断后 NOT_RUN 只由本次新源码完整执行补齐，不篡改旧日志。

本次仅启动自身 frontend-only 服务 PID30060，127.0.0.1:5184、optimization 配置和 Temp 缓存；未启动8776后端。该服务已关闭，生产临时安全端口14506已关闭；原未知/private 5184监听 PID11920 保留。关闭证据在新 Temp `source-closed.json`、`production-ready.json` / `production-result.json`。

本次回滚依据：新 Temp `opening/` 两个测试与交接开场字节，逐文件核对后仅撤回本次增量；原产品修复、旧交接和其他 dirty 均保留。本次最终哈希/增量见 [closing-summary.json](C:/Users/0/AppData/Local/Temp/reader-bounded-tests-closeout-20261003-144518/closing-summary.json)。
