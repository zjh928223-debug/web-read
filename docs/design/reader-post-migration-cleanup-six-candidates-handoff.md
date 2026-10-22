# 六项候选最小清理交接

日期：2026-10-02（Asia/Shanghai）。状态：本轮六项处置已施工并交接，等待独立只读审核。**不宣布 CP 全部通过，不宣布原清理或完整外观/操作验收完成。**

## 授权与固定边界

本轮依据用户最新授权，仅处理最新独立 `readweb-cleanup-evidence-independent-review-20261002-01a0f7c7/evidence-review-report.md` 所列六项。它对原有限补证方案的只读/不构建限制，作了仅限六项的最小产品改动、必要测试同步和一次新 Temp 构建授权；其余文件边界、独立验收和停止规则继续保持。

证据根：`C:/Users/0/AppData/Local/Temp/readweb-cleanup-six-candidates-20261002-01a0fb48`。施工前标准与逐项判定见 `acceptance-and-decisions.md`；没有新增候选、改设计或开启自动修复/复审循环。

## S0：开场与保护

- HEAD `153f9464356c9f59020f4f35ede713a807c798d3`；branch `codex/read-web-optimization`。开场记录 1197 个 tracked/untracked 文件，保存 status、全 tracked binary diff、untracked 和逐文件 SHA-256。不能用 HEAD diff 当本轮 diff。
- 本轮三个拟修改文件均保存 `opening-source` 原字节副本；开场 hash 与上一执行补证的开场记录一致，该来源又已由最新独立报告核对。新交接在本轮开场不存在。
- 本轮实际修改仅 `styles.css`、`src/pinia-stores/theme.js`、`scripts/theme-controls-module-check.cjs`，另新增本交接。结束 `workspace-changes.json` 与三个 `*.this-run.diff` 供审核逐字核对；其余 1194 个开场文件字节保持，无移除，HEAD/branch 保持。
- 原 cleanup/evidence-completion 交接、全部其他 dirty、WhisperX/语言处理工作均保留。没有提交、promotion、创建任务/聊天/代理/worktree；没有操作 daily/historical 树，没有改 DB schema、入口、DOM、owner、事件、持久化键、配置或依赖。

## S2：六项独立处置

本轮口径为 **1 个 selector 分支 + 5 个变量名**：清理 6，有据保留 0，仍不确定 0。此计数仅指用户指定六项，不重算或追改原 C01/C03 历史总数。

| ID / 候选 | 当前消费者核实 | 最小处理与保留上下文 |
| --- | --- | --- |
| C01-001 / learning-entry 分支 | `App.vue:11` 起唯一 group 为 Teleport 中三个显式 reader owner 的 Button；Button 单根 Primitive 透传属性。精确 owner-exclusion 分支排除全部现有按钮；无另一无 owner 生成链/兼容合同。生产双侧实际三个 owner=reader、size=default，分支匹配数均 0。 | 删除该规则块的 9 个声明；保留 group 排列/换行、root 预留尺寸、隐藏 file 输入和全部操作。 |
| C03-020 / `--chunk-annot-default` | 开场只有 root/dark 定义与 theme 生成/清除；无 CSS var()、JS getter 或动态前缀读取。style-editor 当前有限输入键不涉及此名。 | 删除 2 个 CSS 定义、生成和 clear-list 项；共享 hexToRgba/mixHex、其他 chunk 变量不动。 |
| C03-028 / `--glass-shadow-lg` | 同为 root/dark 定义与 theme 生成/清除，无精确读取。`ssc2` 仅服务该生成。glass-effects 的动态键为 mx/my。 | 删除 2 个定义、生成/清除和独占 ssc2 计算；sm/md、panel/button/border/highlight 及其共享计算保留。 |
| C03-031 / `--glass-blur-lg` | 仅 root 定义，无读取或动态 lg 选择链。 | 删除 1 个定义；sm/md 保留。 |
| C03-035 / `--glass-duration-slow` | 仅 root 定义，无读取或动态 duration 选择链。 | 删除 1 个定义；fast/base/ease 保留。 |
| C03-036 / `--pru-reader-bg` | 仅 root/dark 定义及 custom 映射；当前素材 CSS 读取其他 pru 变量，不读取此精确名称。 | 删除 3 个定义/映射；其他 pru 变量保持。 |

`consumer-references.txt` 保存施工前精确引用，`dynamic-css-access.txt` 保存 src 动态 API/变量族索引，`candidate-ledger.json` 含定位、消费者链、处理和源文件身份。静态索引结合实际入口解释，不宣称无匹配日志本身证明真实旅程。

CSS AST 对照确认：除上述 9 个变量定义/映射及 1 个 selector 块外，其余规则、声明和值、注释及顺序完全相同。theme 仅删两项生成/清除、ssc2；五色结构和共享计算保持。主题脚本移除过时的 chunk-annot-default 存在断言，改为运行 store，检验所有现存生成 key 与 clear-list 配对、两亮度五色持久化/恢复、离开 custom 后清除；原其他检查保留。

## S1：唯一新构建与产物身份

- 实际只执行一次 `npm run build -- --outDir <本证据根>/after-dist`，exit 0。`VITE_LOCAL_SERVICE_BASE_URL=http://127.0.0.1:8776`、`READ_WEB_RUNTIME_CONFIG=E:/read-web-next-optimization/config/runtime.optimization.json` 均保存后设置，并在 finally 恢复。
- 新目录开场不存在；没有覆盖 root dist、旧证据或旧产物，没有启用 `--emptyOutDir`。构建 SQLite experimental/outDir 外部目录提示保留在 `build.log`，不是构建失败。
- 构建输入全文件身份见 `build-input-identity.json`；三个改动文件在构建后与输入 hash 一致。源码→一次构建→新目录→实际响应→浏览器后目录 hash 链单列记录。
- 本轮 before 使用最新独立已确认的现有产物：`C:/Users/0/AppData/Local/Temp/readweb-cleanup-repair2-20261001-01a0f7a6/after-dist`。它是本轮六项清理的开场基线，不能混同原迁移清理 before-dist。

| HTML | 本轮 before SHA-256 | 新 after SHA-256 |
| --- | --- | --- |
| index.html | A4C3EDB3C52E774C7509DF3C7E197F300DAF24765758DF2DFDDD1C73EA27119D | 6E9C35A6A8A94243D658FF2EB48C628624E759C0369C58F83CB8D36DABC1992E |
| srs-review.html | 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E | 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E |

两个 HTML、全部 assets/缓存元数据见 `before-dist-manifest.json`、`after-dist-manifest.json`；浏览器前后目录字节不变。原 09DD… 历史来源未知保持旧记录，不用本次新构建覆盖历史身份。

## S3：仅六项影响范围的生产观察

复制已有 `audit.cjs` 合成隔离路线到新 Temp，新增有限 `six-browser.cjs`，没有执行其旧完整矩阵。Chromium 145.0.7632.6、DPR 1、SW block、新 context、同字体阻断；viewport 1280×800 与 390×844。所有业务契约在导航前拦截，未知/外部请求阻断并记录，没有真实 profile、后端数据、评分、AI 或下载。

实际 before/after 共 4 case、22 组状态配对：light、entry hover、Tab 键盘 focus、dark、custom-light、刷新恢复、custom-dark、刷新恢复、返回 light、返回 dark、重置。对照 body/控制区/root/group/学习按钮/主题控件的 computed CSS、文本、SVG、rect（沿用约 1 CSS px 容差），**已采样属性和几何差异 0**。三个学习按钮顺序与 owner 保持，Tab 实际到待预习且 focusVisible=true；实际点击预习设置后取消、今日复习进入后关闭，两侧完成。

五色持久化仍只有 bg/text/sub/border/button；两亮度刷新实际恢复，返回 light/dark 的 inline 均为空，重置保持原五色默认值。新产物各状态 5 个退役变量 computed/inline 为空；没有制造无 owner 节点。截图目视核对了 390px custom-dark 双侧学习入口与换行，未见变化。

startup CLS：before 1280 0.003292688、390 0.007578921；after 1280 0.003292688、390 0.004383037，均 <0.01。4 case 无 pageerror；console ERR_FAILED/外部字体与 CSE 阻断记录保留。

**采集限制必须保留：浏览器 runner exit 1，不记为命令 PASS。** 收集旧 response 对象到多次刷新结束后才取 body，184/284 条报 Chromium `No resource with given identifier found`。原 `six-browser-summary.json` 的 `responseHashMismatches:184` 字段同时包含 body 无法读取与真实不一致，不能解释为 184 份资产内容不一致。另有 100 条成功取 body 的响应全部与目录 SHA-256 匹配；从全部响应 URL 逐路径核对，before/after 各 25 个唯一实际加载路径都有成功取 body 的匹配记录，未覆盖路径 0、实际 hash 不一致 0。详见独立附加 `response-coverage.json`，原脚本/错误/退出码不追改，没有重跑浏览器或构建。

两本机静态服务归本轮 node PID 26028：before `127.0.0.1:5096`、after `127.0.0.1:2225`，均 finally 释放。开场私有地址 5184 属 PID 12748；未停止或变动已有服务，也未启动源码/8776 后端。

## 实际命令与未关闭项

| 本轮命令/动作 | 结果 |
| --- | --- |
| verify:theme-controls-module | PASS |
| verify:reader-controls-runtime | PASS |
| verify:reader-app-runtime | PASS |
| verify:glass-effects | PASS |
| verify:script-order | PASS |
| git diff --check | PASS |
| 唯一 Temp build | PASS / exit 0 |
| 六项有限生产浏览器 runner | exit 1，响应 body 采集限制如上；22 配对状态差异 0，仅支持实测范围 |
| verify:vite / verify:production-preview / npm test | 本轮 NOT_RUN |

本轮不继续原完整 S3。最新独立报告仍未关闭的源码加载路径、素材 quality/notice/额外添加/滚动焦点、SRS 等待防重/播放/返回焦点、chunk 模式及其他 owner、预习等待/完成池及返回 reader、AI/词窗/bubble/video 等必要矩阵保持原 NOT_VERIFIED。旧 production health404 FAIL、YouTube 行为 FAIL/清理归因未知和既有 NOT_RUN 记录不追改。

独立审核可据本轮逐项处置复核 CP02/03/05，并核对范围、产物及交接对 CP01/09/10 的支持；执行者不改判任何 CP。旧标准原位换肤原范围 PASS、历史 C04/C06、全应用统一和日常版替换各自状态保持。

停止点：六项已完成处置；没有新的不确定候选或确认产品回归。响应逐次取 body 的采集限制原样交接，不自动迭代。等待用户安排独立只读审核。

回滚依据：只针对本轮三个文件 `*.this-run.diff` 和 `opening-source`，不能恢复整个 HEAD 或覆盖后续 dirty；需要回滚时先核对当前 hash 与结束记录，由用户另行决定。
