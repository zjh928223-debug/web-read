# 原位换肤终审缺陷 F03：预习录键控件定点修复交接

日期：2026-09-30（Asia/Shanghai）。

**当前结论：F03 定点修复与施工自检完成，原位换肤仍待最终独立验收。本文不是原范围完工结论，也不把局部 PASS 写成全应用统一。**

## 1. 开场、范围与准确局部 diff

- 唯一施工目标：`E:\read-web-next-optimization`。
- 开场 HEAD：`153f9464356c9f59020f4f35ede713a807c798d3`。
- 结束 HEAD：`153f9464356c9f59020f4f35ede713a807c798d3`；未提交，未自动提交、推送或 promotion。
- 开场时间：`2026-09-30T16:07:53+08:00`；施工自检结束记录：`2026-09-30 16:18:27 +08:00`；最终交接记录：`2026-09-30 16:23:23+08:00`。
- 施工阶段开场及交接文件创建前的 dirty 清单均为 27 个 tracked modified、9 个既有 untracked；本轮未改动或清理这些既有差异。原始清单见 `C:\Users\0\AppData\Local\Temp\readweb-passage-shortcut-repair-20260930-160752\status.before.txt` 与 `status.after.txt`；最终状态另见 `status.final.txt`，其额外的第 10 个 untracked 文件就是本文。
- 本轮独立证据根：`C:\Users\0\AppData\Local\Temp\readweb-passage-shortcut-repair-20260930-160752`。其中 `passage-preview.css.before` 是开场副本，`target-css.diff.this-repair.patch` 是本轮相对开场的准确局部 diff。

相对开场副本，唯一产品 diff 为：

```diff
 .passage-preview-shortcut-record[data-ui-owner="learning"] {
   height: auto;
   min-height: 40px;
-  padding: 6px 8px;
-  gap: 9px;
   white-space: normal;
 }
```

未修改 `PassagePreviewPage.vue` 的 `size="default"`、ghost variant、owner/class/aria、事件、快捷键存储、录制逻辑、共享 Button default 配方、主题代码、真实数据、日常/历史树或优化 runtime 配置。目标文件当前行段为 `src/features/passage-preview/passage-preview.css:568-572`。

## 2. 前后获胜规则与属性结果

### 2.1 修复前基线

开场源码 matched 结果与终审基线一致：目标 learning 录键按钮的局部无层规则覆盖了共享配方，声明为 `padding: 6px 8px`、`gap: 9px`；`height: auto`、`min-height: 40px`、`white-space: normal` 同时存在。模板实际有句子中文形态和列表形态两类消费者，均为真实 `Button` 组件。

### 2.2 修复后实际结果

源码和新生产入口都对句子中文录键按钮及列表录键按钮读取了 computed 与 CSSOM matched rules：

| 属性 | 修复后实际结果 | 来源/说明 |
| --- | --- | --- |
| padding | 上下 `8px`、左右 `16px` | shared `rw:py-2`、`rw:px-4`；不再有局部 padding 覆盖 |
| row/column gap | `8px` / `8px` | shared `rw:gap-2`；不再有局部 gap 覆盖 |
| height | 实际 `44px`，获胜声明为 `height: auto` | `rw:h-9` 仍匹配，但本地 auto 例外胜出；自然增高允许 |
| min-height / wrap | `40px` / `normal` | 本轮保留 |
| radius / font | `6px` / `14px`，line-height `20px`，weight `500` | shared default 配方 |
| box sizing | `border-box` | learning 基础规则 |
| 内容 | `kbd` 与 `修改` 保留；录制时 `请按键` 保留 | 模板和状态文字未改 |

源码 matched 来源为 `src/styles/workflow-ui.css` 的 `rw:gap-2`、`rw:px-4`、`rw:py-2` 及本地有限例外；生产 matched 来源为 `assets/learning-ui-DLSk_zsV.css` 的 shared utilities 和 `assets/reader-CNyA-0Oz.css` 的 `height:auto/min-height/white-space` 规则。完整记录见 `source.json`、`production.json`。

## 3. P01–P07 自检结果

| ID | 自检结果 | 证据与边界 |
| --- | --- | --- |
| P01 配方胜出 | PASS | 两种形态在 light desktop、reader dark 390px、custom 390px 及 recording/Escape 状态均为 8px 16px、gap 8px；matched 来源是 shared utilities。 |
| P02 有限例外 | PASS | auto、min-height 40px、normal 换行、kbd、`修改`/`请按键` 均实际读取；自然高度 44px 未被硬锁。 |
| P03 其他基础属性 | PASS（待独立复审确认视觉对比） | radius 6px、14/20、500、border-box 通过；真实 Tab 到达句子按钮，`:focus-visible=true`，ring token/box-shadow 声明和焦点截图已保存。CSSOM 对 ring 的透明色序列仍按原规则保留给复审判断，未擅自扩大 F03 diff。 |
| P04 操作 | PASS | 句子中文与列表录键均真实点击进入 `is-editing`；Escape 只取消录制且窗口仍在；合成单键 `z` 保存后恢复原 `q`；完成关闭后焦点回到原快捷键入口。 |
| P05 主题与窄屏 | PASS（焦点视觉由独立复审确认） | 1280×800、390×844 均无新增横向溢出；reader dark/custom 下窗口仍 `data-ui-theme="light"`；390px footer 真实 `scrollIntoViewIfNeeded` 后点击“完成”；焦点记录见 P03。 |
| P06 生产一致性 | PASS（本轮 CLS 未重测） | 源码入口和新 Temp 生产入口均通过目标矩阵；实际加载 CSS、产物身份和 matched 来源可追溯。旧 CLS 记录未冒充本次新产物 CLS。 |
| P07 分类与历史 | PASS（待独立复审） | EG-26 已按属性拆分，旧 S3/P2、A02/A05、R05/R06、N12、C05 记录均保留；未把本轮自检改写为最终独立 PASS。 |

## 4. 源码与新生产入口矩阵

浏览器使用新的非持久 Chromium context；导航前只放行目标本地静态资源和本轮合成 API，其余未知/外部请求 abort。未读取真实 sample/key/media，也未写真实数据。

| 入口 | 视口/主题 | 实际观察 | 结果 |
| --- | --- | --- | --- |
| 当前源码 Vite | 1280×800、默认 light | 句子/列表 default，matched/computed，真实 Tab，recording/Escape，保存/恢复，完成焦点回收 | PASS |
| 当前源码 Vite | 390×844、reader dark | 两种形态、recording/Escape、窄屏 footer、无横向溢出；学习窗口 fixed light | PASS |
| 当前源码 Vite | 390×844、custom | 通过真实 `#theme-toggle` 进入 `data-theme-mode="custom"`，窗口 fixed light，控件/footer 可达 | PASS |
| 新生产 reader | 1280×800、默认 light | 与源码相同的两种形态、产物 matched 来源、recording/Escape/Tab/focus | PASS |
| 新生产 reader | 390×844、reader dark | 与源码相同的目标属性和实际 footer/关闭动作，无新横向溢出 | PASS |
| 新生产 reader | 390×844、custom | `data-theme-mode="custom"`、`data-ui-theme="light"`，目标属性和 footer 保持 | PASS |

生产入口实际加载顺序为 `learning-ui-DLSk_zsV.css` 后 `reader-CNyA-0Oz.css`。新产物身份：

| 文件 | SHA-256 |
| --- | --- |
| `src/features/passage-preview/passage-preview.css` | `FAC47A75B04DB7BD08EC84F4A9F663FB026BA6C9D2A2A5756CD9CFC34E033FD4` |
| `production-dist-8776/index.html` | `F2B3EFDE67C96572CFAF4367F082825F94042BDD269C52FB680A9555D5DB7FF6` |
| `production-dist-8776/assets/learning-ui-DLSk_zsV.css` | `A6BB5D7973913AC9F59F6303283DEC4C66EF411A6E477767446527F8CC6F0F7E` |
| `production-dist-8776/assets/reader-CNyA-0Oz.css` | `0F5EECFB31D1E51F4D9D6E0A45EF86D90BBB9FE4918F4D61477BF95C34E3965D` |

## 5. EG-26 按属性纠正与历史记录

本轮沿用原 35 个元素组父级索引，不新增元素组编号。受影响记录关联 `UI-013 / SV-19`，父级为 `EG-26`。

| EG-26 子属性 | 当前分类/结论 | 说明 |
| --- | --- | --- |
| shortcut dialog 外壳、窗口固定浅色、行布局、translation switch 专用布局 | S4 保留/建议 | 属于 dedicated learning surface 或后续统一建议，不因本轮 F03 批量重设计。 |
| `height:auto`、`min-height:40px`、`white-space:normal` | 有限保留例外 | 只保留这些复合控件的合法几何和换行行为，不豁免 padding/gap。 |
| learning 录键按钮 `padding`/`gap` | 历史 S3/P2 → 当前已修，待独立复审 | 原局部覆盖已删除；当前由 shared default 实际胜出。此记录不覆盖旧 FAIL，也不预填独立审核 PASS。 |
| kbd、状态文字、录制状态、关闭/焦点行为 | 原归属保留 | 本轮未改变业务协议、文案、事件或键帽专用几何。 |

F01/F02 及此前 SRS 录键修复的历史有效记录保持不变；本轮没有回滚共享配方、玻璃生命周期或 SRS 入口。R09/C05 的旧 FAIL 与后续纠正仍需新的独立审核关闭，不能因本轮 CSS 自检自动改判。

## 6. 命令、阻断与未运行项

- `npm run verify:passage-preview-shortcuts`：PASS。
- `npm run build -- --outDir <Temp>\production-dist-8776`：PASS，856 modules transformed；ECDICT 保持关闭，未访问数据库。
- `git diff --check`：PASS。
- 已复用的 `scripts/passage-preview-browser-check.cjs` 源码隔离检查：PASS；本轮补充的源码/生产目标矩阵结果分别在 `source.json`、`production.json`。
- `npm run verify:vite`：NOT_RUN；不能把替代矩阵写成正式命令通过。
- `npm run verify:production-preview`、`npm test`：NOT_RUN；本轮为纯 CSS 定点修复，不扩大为全仓库/Host 验收。
- 生产浏览器中 `/api/app/health`、Google fonts、CSE 请求按隔离策略阻断；这与合成业务响应、预期网络阻断和真实产品错误分开记录，不能写成产品错误或“控制台零错误”。
- 本轮没有测量新生产构建的 CLS，也没有承接 standalone SRS 或 C04/C06 全应用补查；既有 CLS/SRS/全应用记录继续按原文保留，不能挪作本轮证据。

## 7. 独立复审入口与完工门槛

请由新的独立只读复审对话聚焦 P01–P07，并关闭 A02/A05、R05/R06、N12、C05；同时核对 A03/A04/A08/A09、R07/R08/R09 的直接影响。复审可使用本证据根中的 JSON、截图、开场副本、局部 diff 和新生产资产，但不能修改产品、文档状态、任务、真实数据，不能创建任务/代理/worktree、提交或 promotion。

只有最终验收方案第 9 节的固定门槛全部满足，才可宣布原范围完工：A01–A10 所有适用要求 PASS，必要 FAIL/NOT_VERIFIED/必要性待定为零，确认缺陷同时有当前源码和生产修复证据。当前交接结论仍仅为：**F03 定点修复与自检完成，原位换肤待最终验收。**
