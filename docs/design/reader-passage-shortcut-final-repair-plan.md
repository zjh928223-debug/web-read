# 原位换肤终审缺陷：预习录键控件定点施工方案

日期：2026-09-30（Asia/Shanghai）。

**当前状态：原位换肤待最终验收（存在待修复项）。本文件仅制定施工与复审要求，产品修复尚未执行。**

## 1. 依据与本轮目标

依据本对话的独立终审结果及以下固定标准执行：

- [最终验收方案](reader-shadcn-default-inplace-final-acceptance.md)，尤其 N12、第 8 节证据规则及第 9 节完工门槛。
- [原施工方案](reader-shadcn-default-inplace-plan.md)第 1.2 节的共享配方与复合录键高度例外。
- [原审核方案](reader-shadcn-default-inplace-review.md) A02/A05，以及受影响的 A03/A04/A08/A09。
- [维修审核方案](reader-ui-style-repair-review.md) R05/R06、相关 R07/R08/R09 和 C05。
- [复审与证据边界](../architecture/review-loop-and-evidence-validation-lessons.md)。

终审结论为 FAIL；A02/A05、R05/R06 未通过；N01–N14 闭合组为 PASS 13、FAIL 1（N12）、NOT_VERIFIED 0、必要性待定 0。F01/F02 及 SRS 录键修复仍有效。全应用调查仍为部分完成，C04/C06 NOT_VERIFIED；这些状态与原范围完工分别报告。

本轮只关闭一项确认缺陷，本文记为 **F03：预习录键按钮 padding/gap 局部覆盖，S3/P2**。这一编号是本方案的定位编号，不更改旧报告。

### 确认的事实

| 对象 | 终审观测 | 原要求 |
| --- | --- | --- |
| UI-013 / UI-07 / SV-19 / EG-26 的录键按钮 | 实际入口打开，390×844、reader dark、learning light | 本轮普通控件仍遵循共享 Button default |
| `.passage-preview-shortcut-record[data-ui-owner="learning"]` | `padding:6px 8px; gap:9px`，局部无层规则胜出 | 由 `button-variants.js` 的 `rw:px-4 rw:py-2 rw:gap-2` 胜出；16px 根字号下为 8px 16px、gap 8px |
| 复合高度 | `height:auto; min-height:40px` | 合法几何保留；高度例外不豁免 padding/gap |
| 生产来源 | `production-dist-8776/assets/reader-auDsIFgr.css` | 新修复必须进入新的生产产物，不能只证明源码已改 |

源位置：`src/features/passage-preview/passage-preview.css` 当前 568–574 行；两个模板消费形态在 `PassagePreviewPage.vue` 当前 209–240 行：句子中文录键按钮、列表录键按钮。执行时按选择器重新定位。

独立证据根：`C:\Users\0\AppData\Local\Temp\readweb-final-independent-20260930-01`。

- `browser-record-winner/record-matched.json`：实际生产获胜规则、computed 及 CSSOM 来源。
- `browser-record-winner/independent.json`：默认、录制、Escape 的实际状态。
- `browser-final/independent.json`：预习揭示、导航、完成和快捷键状态。
- `final-workspace-check.json`：终审结束 HEAD、状态及 1182 个跟踪文件哈希无变化。

证据可能被系统清理；缺失时重测这项基线，不凭文件名或旧 PASS 恢复不存在的证据。

## 2. 修改范围与明确保留项

默认产品修改仅涉及 **`src/features/passage-preview/passage-preview.css`**。

最小修改如下：

```diff
 .passage-preview-shortcut-record[data-ui-owner="learning"] {
   height: auto;
   min-height: 40px;
-  padding: 6px 8px;
-  gap: 9px;
   white-space: normal;
 }
```

先用实际 matched/computed 确认当前覆盖与终审一致，再删除上述两条声明。若有其他当前有效规则仍覆盖这两个属性，只处理同一控件的确切获胜声明，并在交接中说明额外 diff 的必要性；不批量搜索替换所有 `6px 8px` 或 `9px`。

不把正确的 padding/gap 重新复制到局部 CSS，不增加 `!important`，不改共享 default 配方、层顺序或全局按钮基线。

保留自动高度、min-height 40px、换行、kbd 及辅助文字几何、is-editing 状态、中文模式 switch、行布局、窗口外壳及滚动。恢复 padding 后实际高度可能超过 40px，属于允许的自然增高；不得硬锁 36/40px、缩键帽/字体或压 padding 来恢复旧高度。

模板、事件、快捷键存储、业务协议、文案、入口和主题代码默认不改。若新几何造成实测裁切，只允许在同一窗口内修复必要的布局/滚动限制，记录具体触发条件；不重新设计窗口。

F01/F02、SRS 录键、全部 S2/S4 外观和范围外业务限制保持其原归属；本轮不承接 C04/C06 的全应用补查工程。

## 3. 开工前固定验收条件

下表在施工前固定，复审不得另加全站统一矩阵。

| 编号 | 必须观察到的结果 | 对应条款 |
| --- | --- | --- |
| P01 配方胜出 | 两种录键形态的 padding 8px 16px、row/column gap 8px；来源是共享 utilities，而非局部复制。默认/录制/Escape 后均成立 | A02/A05、R05/R06、N12 |
| P02 有限例外 | auto 高度、min-height 40px、normal 换行保留；kbd、修改/请按键文字完整，无需精确固定实际高度 | A02/A03、R05/R07 |
| P03 其他基础属性 | 代表控件 radius 6px、font 14px/20px、weight 500、box-sizing 正常；焦点可见，录制状态可辨 | A02/A04、R06 |
| P04 操作 | 真实点击进入录制；录制中 Escape 仅取消录制且窗口仍开、旧快捷键未改变；合成上下文保存一个未冲突单键并验证对应动作，再恢复；完成/关闭返回原触发入口焦点 | A08、V06、R07 |
| P05 主题与窄屏 | 必要矩阵中的 learning 均固定浅色；全部按钮及文字可见，footer 可滚动到达并实际点击，焦点环不裁切，无新非预期水平滚动 | A03/A04、R06/R07 |
| P06 生产一致性 | 当前源码和新生产入口实际控件均通过；新产物身份、加载 CSS、获胜来源可追溯；共享 reader/SRS 修复无回退 | A09、R08 |
| P07 分类与历史 | EG-26 按属性拆分；历史 S3 与修复后结果可查；R09/C05 旧失败及纠正事实保留，未做动作不变成 PASS | A05/A09、R09/C05 |

P01 数值以项目当前 16px 根字号为前提，读取实测根字号；合理亚像素舍入不制造失败。按钮内部 kbd/small 的专用字号不强制改成按钮字号。

## 4. 连续施工顺序

### W01：锁定基线及安全复现

1. 读取上述文件及 AGENTS.md；记录当前 HEAD、dirty 清单和时间。方案编写现场 HEAD 为 `153f9464356c9f59020f4f35ede713a807c798d3`，27 个跟踪修改；执行必须重新核对。
2. 在新的系统 Temp 子目录保存目标 CSS 开场副本、本轮局部 diff 和证据。相对 HEAD 的整份 diff 含既有修改，不能当成本轮修复 diff。保留旧审核证据目录。
3. 使用新非持久浏览器 context；导航前白名单静态资源和合成业务响应，SW block、WS close、未知/外部请求 abort。不得先请求真实 sample/key/media 再拦截，不得以失败为由直连真实服务。
4. 从实际 reader 的预习包导入入口导入合成内容，再点击预习页“快捷键”入口；用实际组件/应用，不手绘 DOM，不修改产品条件。
5. 保存两种录键形态的修复前截图、computed 与 matched 来源；至少复现原 390×844 dark 情况。

### W02：定点修复

按第 2 节删除两条覆盖声明。不要改 `PassagePreviewPage.vue` 的 `size="default"`、ghost variant、owner、class、aria、事件或录制逻辑。检查相邻中文模式 switch 的 span padding、kbd padding 没有误删。

### W03：实际控件定向复测

| 入口 | 主题/视口 | 最小操作与证据 |
| --- | --- | --- |
| 当前源码 reader → 预习 → 快捷键 | 390×844、dark | 两种录键形态的配方胜出；录制/Escape；一次保存/恢复；焦点/关闭/footer 实际动作 |
| 新生产 reader → 同一入口 | 1280×800、light | 两种形态默认/录制/Escape，hover/Tab focus；完成与重新打开；必要文字和高度 |
| 新生产 reader → 同一入口 | 390×844、dark | 两种形态默认/录制/Escape；窗口滚动、footer、关闭焦点；无新遮挡/横向溢出 |
| 新生产 reader → 同一入口 | 390×844、custom | 主题按钮进入实际 custom；窗口固定浅色，控件/文字及 footer 可达，custom 原值保留 |

default → recording → Escape 至少采集句子中文与一个列表按钮的状态；其余同选择器按钮读取最终属性即可，不重复每个键的完整旅程。

padding/gap 需要读取四边 padding 和 row/column gap，并保存最终获胜规则及样式文件。截图、类名或高度单独不满足 P01。focus 使用真实 Tab，hover 使用真实指针；不通过改 class 冒充交互。

合成上下文结束后销毁，不恢复或清理用户真实设置。新生产补查 reader 普通按钮及 reader 内/standalone SRS 录键代表控件，确认共享配方、固定浅色和加载层顺序没有回退；这些对象无需重跑已有效的全部业务旅程。

### W04：命令及新生产产物

本轮执行方先检查脚本前置，再运行：

```powershell
npm run verify:passage-preview-shortcuts
git diff --check
```

快捷键单测使用内存 storage，只承担快捷键语义检查，不能代替浏览器样式/焦点结果。纯 CSS 修复可复用现有 passage unit、SRS、theme、glass focused 有效记录；发生相关额外修改才复跑对应检查，不扩大成完整 npm test/Host 验收。

修复后生成一次新的 Temp 生产产物，显式指向合成拦截所用的 8776 边界。PowerShell 示例如下（由执行方运行，本方案未运行）：

```powershell
Set-Location -LiteralPath 'E:\read-web-next-optimization'
$repairEvidenceRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('readweb-passage-shortcut-repair-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $repairEvidenceRoot -ErrorAction Stop | Out-Null
$repairOutDir = Join-Path $repairEvidenceRoot 'production-dist-8776'
$repairPreviousServiceBase = $env:VITE_LOCAL_SERVICE_BASE_URL
try {
  $env:VITE_LOCAL_SERVICE_BASE_URL = 'http://127.0.0.1:8776'
  npm run build -- --outDir $repairOutDir 2>&1 | Tee-Object -FilePath (Join-Path $repairEvidenceRoot 'production-build.log')
  if ($LASTEXITCODE -ne 0) { throw 'Production build failed' }
} finally {
  if ($null -eq $repairPreviousServiceBase) {
    Remove-Item Env:VITE_LOCAL_SERVICE_BASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:VITE_LOCAL_SERVICE_BASE_URL = $repairPreviousServiceBase
  }
}
```

构建时保持 ECDICT 关闭，不访问数据库。旧产物不覆盖，新 CSS 文件名可能改变；按实际页面加载资产定位，不能继续硬编码 `reader-auDsIFgr.css` 冒充新产物。

复用已经可用的 Temp 隔离方式检查新产物，无需启动或重启用户服务。自动化不得裸连历史 5173/日常端口；手工预览才按项目启动器及 5184/8776、优化数据根执行。

记录新构建身份、目标 CSS/共享配方/相关入口源码及实际加载资产的简单哈希对应即可，不另建全仓库验证平台。新生产初次加载 CLS 沿用既定测量窗口及 `<0.01` 门槛，reader 1280×800/390×844、standalone SRS 各记录一次原始 layout-shift 和加载 CSS 顺序。

正式 `verify:vite` 若未运行，继续记录 NOT_RUN。将当前源码挂载、目标控件、当前生产定向动作和有效旧播放证据分别映射，不把替代检查包装成命令全通过。预期网络阻断、合成失败响应、历史 4173 timeout 与真实产品错误分别保留。

### W05：交付新增记录，保留历史

新增 `docs/design/reader-passage-shortcut-final-repair-handoff.md`，不覆盖既有施工交接和历史 FAIL。至少包含：

1. 开场/结束 HEAD、dirty 清单、本轮 CSS 相对开场的准确 diff、时间及证据目录。
2. F03 前后属性与获胜来源、P01–P07 实际结果、源码/生产矩阵、失败及未运行项。
3. EG-26 外壳/行布局仍属 S4 建议；auto/min-height/wrap 属有限保留；按钮 padding/gap 为本轮 S3，取得证据后记录“历史 S3/P2 → 当前已修，待独立复审”，不直接预填独立 PASS。
4. 单列 EG-26 受影响控件子记录，关联 UI-013/SV-19，沿用原 35 元素组父级索引；如另增组编号，说明计数口径。不要写旧统计“当前 S3=0”却隐去新发现。
5. N12、A02/A05、R05/R06、C05 进入待复审；N01 的历史记录纠正与当前产品修复分别说明。A/R/N 旧 PASS 逐项保留复用依据；相关源/产物不再匹配的项按实际影响重判。
6. C04/C06 的全应用范围未验证项、S2/S4 保留与非必要业务限制继续单列，不冒充全应用调查或统一完成。

施工交接结论只能写“F03 定点修复与自检完成，原位换肤待最终验收”，不写“原范围已完工”或“基本完工”。

## 5. 复审与完工门槛

由用户/调度者安排新的独立只读审核对话；执行方和审核方都不自行创建任务/代理，不使用 worktree。主工作区写操作串行，禁止 reset/clean 或覆盖已有 WhisperX 等差异，不自动提交、推送或 promotion。

复审固定聚焦 P01–P07、A02/A05、R05/R06、N12、C05，并核对 A03/A04/A08/A09、R07/R08/R09 的直接影响。其他已通过项只在内容变化或证据失效时重测；临时证据消失则补对应最小范围。

只在 [最终验收方案第 9 节](reader-shadcn-default-inplace-final-acceptance.md#9-固定完工门槛) 全部满足后，独立审核才可宣布原范围完工：A01–A10 所有适用要求 PASS，必要 FAIL/NOT_VERIFIED/必要性待定均为零，全部确认原范围缺陷有当前源码及生产修复证据，记录问题关闭，保留项明列。构建成功或 F03 自检 PASS 不能单独替代此判定。

同一任务连续两次修复/复审失败后停止自动迭代，重新评估并由用户决定简化、拆分或继续；本方案不授权第三轮自动修复。辅助脚本超过约 500 行或两倍已审核基线时暂停说明复杂度，不建设新日志语义验证器。

## 6. 可直接交给施工模型的指令

> 请在 E:\read-web-next-optimization 按本方案定点修复 F03：删除 passage-preview.css 中 `.passage-preview-shortcut-record[data-ui-owner="learning"]` 的旧 padding/gap 覆盖，让共享 Button default 配方实际胜出；保留自动高度、min-height 40px、键帽、状态、换行和全部录键行为。先读取 AGENTS.md、本方案及引用的最终验收/原 A/维修 R 条款，保存开场差异与合成隔离基线。完成 P01–P07、源码和新 Temp 生产产物的最小矩阵及必要命令，按属性更新新增交接中的 EG-26 分类和 N12 待复审记录，保留全部历史失败、已通过证据及范围外限制。当前项目继续保持“原位换肤待最终验收”；不得宣称全应用统一或原范围已完工。不要修改共享配方、事件/协议、真实数据、日常/历史树，不创建任务/代理/worktree，不自动提交或 promotion；不承接 C04/C06 全应用补查。完成后交付准确局部 diff、前后获胜规则/状态、产物身份、命令结果及最小复审入口，交由独立审核关闭。
