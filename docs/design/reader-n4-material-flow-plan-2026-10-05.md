# N4 素材基本流程与恢复反馈施工方案

用户于2026-10-05批准先独立收口N3，再按以下顺序施工。N3两轴有限PASS已登记；本轮opening是登记后的当前脏树，不能使用HEAD代替。

## 固定顺序与验收

1. I4：正常fresh/reload/关闭页签重开为空白，无文章、媒体或上次标题。启动保留DB、owner/committed/legacy保存数据、素材、marks、学习记录和个人设置；只停止自动恢复内容。显式restore/回滚、outbox重放和BFCache返回已打开页行为保留。
2. B9–B12/I5：主动点击立即在阅读区显示目标标题和打开中；提交加载且激活成功后才显示已打开。失败显示目标和原因，旧正文/身份/媒体/marks不被替换。标题读取真实音频元信息投影并与正文关联，本地输入不沿用旧workflow标题。记录点击、请求/读取、可见内容/成功、媒体就绪时间，先建立基线，无虚构速度指标。
3. B1–B8：素材库为主入口；单链接默认，批量能力在明确可展开入口内保留；提交靠右、窄屏自然换行。URL格式/去重保护保留，元信息预读不阻塞提交，不重复教学及已有URL展示。任务、重试/取消保持可达。
4. B14–B16（2026-10-05用户重定）：删除素材库“全部／7天内／更早”三个筛选按钮，验证列表显示、刷新、加载更多及打开。保留系统内部查询、轮询及时间数据接口，不扩后端筛选修复；区分最近活动与下载/创建时间，不冒充最后阅读。月度每日学习篇数总览另定学习事件与去重口径，不用下载或打开次数代替。
5. B17–B21：详情先说明可读性与问题，统计次要；修复独立区域、两种操作同级视觉；关闭独立。确认显示目标、阶段及已知影响，取消不发修改请求，不承诺历史数据保留超过现有后端合同。

## 范围、证据与回滚

允许：index.html、styles.css、src/styles/workflow-ui.css、src/components/YouTubeWorkflowPanel.vue、src/pinia-stores/audio.js、src/composables/reader-bootstrap-runtime.js、src/composables/session-startup-runtime.js、src/composables/session-lifecycle-runtime.js；对应聚焦检查 scripts/session-startup-runtime-check.cjs、scripts/session-lifecycle-runtime-check.cjs、scripts/reader-bootstrap-runtime-check.cjs、scripts/youtube-workflow-panel-v3-check.cjs、scripts/ui-compatibility-store-check.cjs；本方案与scheduling/opinions及AGENTS/CURRENT_PROJECT_STATUS的本轮状态登记。2026-10-05为用户明确要求的本地字幕成功后标题同步，补入src/composables/import-module.js、src/composables/reader-import-runtime.js及scripts/reader-import-runtime-check.cjs；为不自动恢复的验收合同适配补入scripts/read-web-playback-check.cjs和scripts/read-web-interactions-check.cjs，保留业务断言。补充opening与固定验收见C:/Users/0/AppData/Local/Temp/reader-n4-title-simplify-20261005/scope.md。新增聚焦产品模块需先说明必要性再扩allowlist，不修改后端、schema、媒体owner、loader/publisher保存合同、薄入口或旧保护树。

证据根：C:/Users/0/AppData/Local/Temp/reader-n4-material-flow-20261005-c9b691ac。保存opening源码身份、允许文件副本、命令输出、浏览器断言/截图及closing差异。浏览器fixture仅证明声明数据及请求合同；真实Host/AI、系统重启与全仓检查如未运行保持NOT_RUN，不把已有FAIL抹掉。首批先验证空白与主动打开，再顺序进行输入/筛选/详情。

验证：startup及explicit restore/lifecycle/bootstrap/UI/Panel聚焦检查、loader/publisher/marks保存检查，verify:vite、生产构建与生产预览；桌面/390窄屏、持久数据reload与页签重开、成功/失败旧内容保护、默认single/batch/task及筛选/确认交互。固定标准的独立Spec/Standards审核后才宣布N4收口。若同任务连续两轮fix/re-review失败，暂停并询问；发现方案或实质P0–P2问题立即停下询问用户。

回滚只反向本轮hunk，核对opening及后续漂移，不整文件覆盖已有dirty。N3closing身份和失败记录保留，不更新全仓Last verified、R状态或推广。

## 首批恢复记录（2026-10-05）

用户要求先新审核N3、通过后开始N4。N3新Spec/Standards只读审核均有限PASS，报告：C:/Users/0/AppData/Local/Temp/reader-n3-fresh-review-20261005-67a5f34d/review.md；未重跑N3业务旅程。N4恢复原允许范围内首批，owner时间筛选/分页是否纳入仍待明确选择，client/backend未修改。

本次仅适配bootstrap/Panel两项旧检查合同，并为阅读区标题状态预留挂载高度。startup、lifecycle、bootstrap、Panel聚焦检查PASS；publisher及loader声明机制浏览器检查PASS。使用自有隔离origin的声明持久legacy材料，通过实际阅读器首次打开、reload、桌面/390px页签重开验证无正文/媒体/旧标题，原保存记录及中文/视频偏好保留；不等同真实Host、owner/committed全部来源或系统重启验收。

当前源码Temp生产构建PASS；verify:vite加载段PASS，布局位移0.004435，整体仍FAIL：播放段等待旧app.restore_session_complete/rejected事件超时，未进入播放断言；交互段NOT_RUN。原布局位移FAIL、测试按钮id错误导致的首轮FAIL及继承FAIL全部保留。本地字幕覆盖旧workflow标题/反馈、主动打开完整成功/失败旅程、生产预览和N4独立收口尚未完成。证据：C:/Users/0/AppData/Local/Temp/reader-n4-resume-20261005-67a5f34d/handoff.md。未更新全仓Last verified、R状态或推广。

## 本轮有限验收完成（2026-10-05）

以上首批段落为历史阶段状态。按用户最新要求，三个时间筛选按钮撤除，内部查询、时间数据、轮询与分页owner保留；不追加后端时间筛选修复。月度每天学习篇数需求另定准确学习事件/去重口径，不能用下载/打开次数替代。关闭后重开只清临时错误提示，可重试下载/转写/AI任务记录保留。

原五步中的前端施工已完成：正常启动为空白且保留保存数据/个人设置；打开目标即时反馈、提交/激活后成功、失败保留旧标题/正文；本地合法字幕成功后同步标题与反馈，非法导入不改旧内容；默认单链接/右侧提交，批量在展开入口保留，URL与去重保持、元信息不阻塞；素材时间注明活动/打开/完成/导入/创建来源；详情先说明结果与问题、统计次要，修复同级且关闭独立，确认说明目标/阶段及检查点可能覆盖旧结果，取消无修改请求。移除批量失焦提交，修复卡片展开导致按钮移动、首次点击未提交的现象。

源码17项、生产同17项及加载检查PASS，桌面/390px实操覆盖成功/失败、本地替换/非法输入、列表加载更多、单链接/批量去重、未等待元信息、任务重试/取消、阶段修复及整项重处理确认。focused、loader/publisher检查和最终Temp构建PASS。verify:vite在隔离32175以及随后5184均加载/播放/交互三段PASS；旧等待restore、首轮5184挂载超时和runner失败日志仍保留。打开计时仅为声明HTTP/媒体数据的基线，不是实际Host速度保证。

Spec/Standards独立审核均有限PASS，无阻断固定范围的P0–P2，审查16项源码/方案变化及其余1237原opening路径无漂移。审核未重跑业务。本轮按“源码与声明旅程”范围有限收口，不能称全部真实环境验收通过；真实Host/AI、owner/committed真实持久路径、系统重启及全仓检查保持NOT_RUN/未验证。报告与最终身份见C:/Users/0/AppData/Local/Temp/reader-n4-remaining-20261005/review.md及handoff.md。不更新全仓Last verified、R状态或推广，未提交。

## 单素材真实链路补验（2026-10-05）

用户要求实际验收后，先核对N1、N2-A/同步补丁及N3既有有限收口，使用标准优化启动器和实际Host/UI提交约19秒Me at the zoo，任务802eb5775a5c。下载、WhisperX转写、Gemini real切分/翻译、文件校验保存、素材库打开、普通正文/七个中英语块及真实媒体播放通过；reload及关页后新页启动空白，保存条目保留，显式重开正常。预先八项标准见C:/Users/0/AppData/Local/Temp/reader-real-chain-20261005-1330/scope.md，两轴独立证据复核有限PASS，未重跑业务，无阻断P0–P2；详见同目录review.md/results.md。执行和审核时1,253路径零漂移，只在此后追加三份状态文档；测试服务和页签清理，产物/任务保留。前段真实Host/AI NOT_RUN是补验前历史；本补验仅当前设备一个真实材料，不覆盖全部owner/committed来源、系统重启、长视频/批量、故障恢复、声学听辨及全仓。原FAIL保留，不更新全仓Last verified、R状态或推广。
