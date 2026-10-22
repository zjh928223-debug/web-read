# R5：分离本文词汇预览与结算的动态弹窗

> 2026-10-04：用户已选择“单独清退本文扫描，再做R5”。本文件下文保留为原方案历史参考，禁止按旧双弹窗范围放行。当前讨论见[本文整理职责重定草案](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/05-article-settlement-scope-draft.md)；具体范围待定稿；N1已独立PASS，旧扫描/双入口扫描子范围因功能退休取消，R5未施工。R2已独立PASS，下文旧前置状态不再代表当前进度。

状态：待R2独立PASS，且第5项确认本文词汇预览/本文结算各自保留；退休的子功能不重建新dialog。施工/自检估计1.5–2.5小时，独立复审另计。必读[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)。

## 1. 结果与限定

当前 vocabulary-preview-module.js 1634行，包含预览扫描/controller、preview dialog、可拖拽结算dialog和候选渲染/操作。本轮按“弹窗表现与交互”对“文章业务协调”分离，保留原legacy DOM路径。不会强制重写为Vue，不新增页面，不把独立PassagePreviewPage/usePassagePreview已拆服务再拆一次。

后者仍提供当前学习预习页；与本文旧DOM词汇预览是不同入口。本轮的通过不能替代该独立预习页的全部验收。

## 2. 文件范围

产品修改 E:/read-web-next-optimization/src/composables/vocabulary-preview-module.js；新增 src/features/vocabulary-preview/create-vocabulary-preview-dialog.js、create-article-settlement-dialog.js。如果两个view共用的候选render/format不依赖controller私有状态，允许同目录 vocabulary-preview-view-model.js；没有共同消费者则留在所属dialog，不造只供一个简单函数的文件。

旧控制器的scanPreview/runPreviewExplanation/togglePreviewWords/openSettlement/applySettlement/refreshAvailability/status/dispose接口不改。article settlement/worker/meaning refinement、storage、vocabulary acquisition及owner实现字节保持。

仅允许 src/styles/workflow-ui.css 增加准确的新动态UI @source；styles.css、learning-ui.css 与native control variants、dialog class/owner属性不改。检查 scripts/vocabulary-preview-ui-check.cjs、vocabulary-preview-service-check.cjs、vocabulary-preview-acquisition-check.mjs 的归属/staging同步，原行为断言保留。已有controller全局兼容消费保持，不追加清理。

## 3. 顺序

1. 保存opening与原生产CSS/DOM代表状态。列previewButton/toggle/settle真实绑定及DOM、controller/worker/acquisition消费。
2. 搬preview dialog完整创建/ensureMounted/values/busy/status/open/close/dispose，保留按钮/字段顺序、框架控件属性、scope和focus返回。
3. 搬settlement dialog完整候选render、drag/resize/clamp、remove/relearn/speak/refine/apply/skip、busy/status、open/close/dispose。pointer和speech清理跟着dialog所有者，不交给controller到处操作私有DOM。
4. controller只提供已存在业务callbacks和数据，scan单航班/文章身份、settlementOpening、操作claim和owner写入保持。不把各种dom refs和geometry从新view返回给controller。
5. 动态Tailwind类补新文件 @source；尽量保留literal class生成，不改用任意动态字符串拼接让扫描遗漏。
6. 更新真实依赖staging与controller行为检查，production before/after生成utilities/computed几何对照和实际交互，交接停止。

## 4. 固定验收 R5-A1–A7

| 标准 | 必须达到 |
| --- | --- |
| A1 表现归属 | DOM/view交互在dialog，文章scan/claim/owner写入在controller，无复制状态与新全局。 |
| A2 扫描 | 同一文章重复scan仍single-flight，切换文章迟到scan不打开错误dialog，refreshAvailability正常恢复按钮可用性。 |
| A3 结算 | 候选分组/remove/relearn/refine/apply/skip与当前owner acquisition路径保持，完成/处理中按钮语义保持。 |
| A4 生命周期 | drag/resize/发音的真实操作和close/dispose清理正确，重开无重复pointer/键盘监听，focus返回原按钮。 |
| A5 样式来源 | 新dynamicUI文件被Tailwind扫到，生产utilities、data-ui-owner/theme、native variants保持，无生产丢皮肤。 |
| A6 几何 | footer自然换行、列表滚动、drag/resize界限、短/长meaning和disabled在前后同状态computed/截图一致。 |
| A7 完整必要 | 原三项focused完整通过，真实两个入口旅程完成；有限源码/产物/回滚记录齐备。 |

## 5. 必要检查与真实UI

- npm.cmd run verify:vocabulary-preview
- npm.cmd run verify:vocabulary-preview-ui
- npm.cmd run verify:vocabulary-preview-acquisition
- npm.cmd run verify:annotation-storage-envelope
- node scripts/dialog-controller-check.mjs
- 共同静态门禁。

完整旧UI检查已有真实controller DOM行为，复制新文件到staging，不能只保留静态assert。另在fresh隔离production App通过实际“词汇预览”和“本文结算”入口：preview scan→explanation→close；settlement open→scroll→drag/resize→refine→remove/relearn→apply/skip→close/reopen。合成service明确，未知请求阻断；不能直接调用私有open/claim代替入口。

对照1280×720/390×844，当前dark/light壳下的固定light dialog；数据包括长释义、已完成按钮、loading/错误和空列表。仅这两个入口影响状态，不重跑全应用矩阵。

## 6. 交接与回滚

交接view/controller接口、scan与claim状态所有者、@source精确增量、两入口交互与生产CSS身份、R5-A1–A7。回滚restore controller opening与对应@source，再移除无后续消费的新views；不动已验收B的退休query-helper/translation-queue，不把它们恢复为新dialog的依赖。



N1 本文扫描清退执行记录（2026-10-04）：两个扫描/显示入口及专用生产、显示、词典富集支路已撤除；本文整理、历史来源识别和独立学习入口保留。执行验收未完成：J3 现有手工导入入口不可达，句高亮正式检查失败；独立审核 NOT_RUN，R5 未放行。具体命令、失败与未覆盖项见本轮 Temp handoff.md：C:/Users/0/AppData/Local/Temp/reader-n1-resume-20261004-582b711a/handoff.md。此记录不更新全仓 Last verified 或前轮结论。


N1 补充执行（2026-10-04）：用户授权重定后，句高亮完整检查、匹配 target 的普通 AI/真实轻量合并与旧扫描来源/mark 保护、动画稳定的四组合生产矩阵及 drag/resize/focus、代表 loading/empty/长列表/relearn/error 对照通过。处理中 UI 已观测；补充 producer 完成响应合同错误的原 FAIL 保留，停止追加修补。原手工文件 UI 缺口不伪装为旅程通过，按方案补充范围改用既有 AI 导入链；dictionary 全入口的既有 FAIL 保留并有原 opening 复现。独立审核 NOT_RUN、R5 未放行，见 C:/Users/0/AppData/Local/Temp/reader-n1-supplement-20261004-2c83b798/handoff.md；不更新全仓 Last verified。


### N1 独立收口（2026-10-04）

**N1 独立 PASS，限于方案预先重定后的验收范围，现已收口。** 独立审核未发现阻断收口的 P0–P2 问题，见[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-n1-independent-review-20261004/review.md)。最后 completion 补测已闭合精简完成、进度保存及关闭重开读取；原失败尝试保留。原手工文件 UI 旅程仍为 NOT_RUN，dictionary:test 整入口仍为既有 FAIL，按重定范围保留另案；本审核未重跑业务测试。此前执行/补充段落是各阶段历史记录，不再代表当前 N1 状态。

R5 旧扫描/双入口扫描子范围标为“因功能退休取消”，不是 R5 PASS；R5 保留本文整理职责的方案仍须定稿及明确调度，尚未启动。R5 opening 应以 N1 本次收口后的当前源码及 closing 身份为基线，见 C:/Users/0/AppData/Local/Temp/reader-n1-closeout-20261004-e83a5c18/closing-manifest.json，不以 HEAD 或清退前源码代替。未更改 R9、全仓 Last verified 或推广状态。
