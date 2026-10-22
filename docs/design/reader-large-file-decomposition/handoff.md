# 大文件整理有限收尾交接（2026-10-04）

本记录取代 R6/R8/R9 原方案中的当前执行状态。用户要求简化并尽快完成后，本轮停止旧 Temp 矩阵的第三次修补，按下列范围施工和自检。原方案与原始失败记录保留，不能把本记录理解为原全部验收标准通过。

## 当前结果与边界

- ABC、R1/R2/R3/R4/R7、N1、词典专项、手工导入清退及 R5 的既有独立结论保留；本轮没有重新独立审核这些范围。
- R6 的模板、弹窗和运行控制器职责已分离；六项完整针对性检查、dialog-controller 检查及生产构建通过。R6 新独立审核 **NOT_RUN**。
- R8 的三组 HTTP 路由已迁移；55 个业务端点及其定义、顺序、签名、OpenAPI 保持。原后端七组测试共 **156 项通过**。R8 新独立审核 **NOT_RUN**。
- R9 本轮完成源码身份、接线、现有页面加载/播放/交互、清单及文档的有限自检。原 R9 的全部跨轮真实旅程和独立审核 **NOT_RUN**，不宣布完整 R1–R9 或全仓验收 PASS。
- 功能改造任务线尚未施工。原手工文件导入已退役，其原 UI 旅程仍为 **NOT_RUN**。

## 施工前固定的简化验收

R6 保持原业务、全部同名弹窗定义及有效交互语义；模板只负责纯数据构造，弹窗拥有 DOM/呈现/关闭/焦点，控制器保留身份、请求、历史 run、导入和 SRS 协调。用原完整针对性检查和构建/CSS 身份验证此次机械迁移；不补写旧生产矩阵。

R8 保持 create_app 的生命周期、安全、CORS、metrics 与 manager 装配，路由只迁移注册职责。逐项比较路由和 OpenAPI，并运行原 service、production Host、安全和 owner 测试。R7 及所有其它 service 定义保持。

R9 检查当前源码与 opening 差异的白名单、模块接线、生产 CSS、正常加载/播放/交互及清单/文档。施工前既有检查失败只复现和记录，不扩展本轮产品施工。

## 当前所有者

| 职责 | 文件 |
| --- | --- |
| AI 请求模板、覆盖分析、目标和文本构造 | `src/features/annotation-backfill/annotation-backfill-template.js` |
| AI 标注弹窗 DOM、状态呈现和关闭/焦点 | `src/features/annotation-backfill/create-annotation-backfill-dialog.js` |
| AI 运行、文章身份、历史 run、轻量导入及 SRS 协调 | `src/composables/annotation-backfill-ai-module.js` |
| job/config/credential/import/maintenance/annotation/health 路由 | `tools/subtitle-workflow/youtube_workflow/http/workflow_routes.py` |
| reader/session/marks/media/file/recent 路由 | `tools/subtitle-workflow/youtube_workflow/http/reader_media_routes.py` |
| dictionary/TTS 路由 | `tools/subtitle-workflow/youtube_workflow/http/capability_routes.py` |
| 原序路由注册 | `tools/subtitle-workflow/youtube_workflow/http/__init__.py` |
| manager、安全、CORS、metrics、lifespan 装配 | `tools/subtitle-workflow/youtube_workflow/service.py` |

路由通过 APIRouter 构造，按原顺序注册到原平铺路由表，并使用 app 的 dependency_overrides_provider；不采用会改变当前 FastAPI 路由容器结构的 include_router。请求实现和原 Host 分派保持。

## 已完成验证

- `verify:annotation-backfill-ai`、`verify:annotation-lightweight-module`、`verify:session-annotation-lightweight-io`、`verify:session-annotation-generated-index`、`verify:annotation-storage-envelope`、`verify:srs-pending-candidates-transaction` 完整检查通过；dialog-controller 检查通过。
- R6 原 controller 导出主体字节相同；搬迁的模板及完整 view 定义保持。`workflow-ui.css` 仅补新 view 的准确 `@source`。
- Temp Vite/Vue/Tailwind 生产构建前后通过；主应用生成 CSS 字节相同，SHA256：`ebffa15b93b95b4e1f367c39037b393771569fd7e76221660e1dd839a12acf68`。该隔离构建只包含主应用默认入口，不宣称重新构建/验收独立 SRS 入口。
- R8 原 55 个 endpoint 的 AST 定义仅 decorator owner 从 app 改为 router；create_app 非路由部分及全部其它 service 定义 AST 相同。路由顺序、签名、状态码及 OpenAPI 快照完全一致。
- Python 原 `test_service_app`、`test_production_host_prototype`、`test_windows_owner_request_policy`、`test_workflow_owner`、`test_reader_session_owner`、`test_marks_activity_owner`、`test_annotation_owner`：156 项通过。
- `verify:youtube-workflow-client`、`verify:windows-owner-api-client` 通过；`dictionary:test` 当前 30 项通过。
- `verify:vite` 当前真实浏览器加载、播放、交互检查通过。使用自有随机 loopback Vite、空 API 启动 fixture 及阻断外部网络的既有 browser preload；这不证明真实在线 AI/provider、用户 Host 或跨机旅程。
- `verify:test-inventory`、`verify:script-inventory`、`verify:current-documentation` 通过。最终白名单身份检查及 `git diff --check` 结果见 Temp closing 记录。

## 原失败和未覆盖范围

- 旧 R6 before 生产旅程两次失败保留：第一次等待已经改变的按钮文本，第二次提交自动关闭弹窗后读取不可见元素。旧四组合矩阵未再修补；切文和生产 SRS 候选旅程仍 **NOT_RUN/NOT_VERIFIED**，没有改成通过。
- 当前 `verify:architecture:source-shape` 在 `critical-async-boundary-check.mjs` 失败，消息为 `panel-job-refresh must have an explicit observed best-effort policy`。本轮 opening 完整副本中复现同一失败；检查及相关生产模块本轮未改。其后尚未执行的 aggregate 项不算通过。
- 当前 `verify:youtube-workflow-streaming` 失败：现有 data URL staging 无法解析 loader 的 `./runtime-state-facade.js` 相对导入，错误为 `ERR_UNSUPPORTED_RESOLVE_REQUEST`。opening 副本同样复现；本轮未修改 loader 或该检查。
- 新 R6 staging 检查首次因迁移后的 dialog-controller 扩展名没有同步失败，修正 staging 后通过；第一次 R8 include_router 快照不满足原平铺路由表，修正注册后通过。两次初始失败日志/快照保留。
- Temp 初始构建配置曾使用 Windows 路径导入 ESM 并失败，随后改为 file:/// 导入通过；该第一次构建的原始日志被同名重跑覆盖，不能宣称保留了这份原始日志。其余当前记录以实际文件为准。
- 原 R5 迟到完成 before/after 配对 **NOT_VERIFIED**、其 opening 桌面补测 FAIL、撤回 INVALID 的旧伪 PASS 等历史状态保持。
- 全量 `npm test`、真实在线 AI、全部新生产矩阵、跨机、日常推广和本轮独立复审 **NOT_RUN**。

## 证据、隔离与回滚

证据根：[reader-fast-closeout-20261004-09389818](C:/Users/0/AppData/Local/Temp/reader-fast-closeout-20261004-09389818)。`scope.md` 为施工前固定简化范围；`opening-source/`、`opening-hashes.json` 保存施工前 1240 份文件；`logs/` 保存命令结果；`vite-artifacts/` 保存当前浏览器报告；路由快照、机械证明和 closing 文件保存在同一根。

所有 build/cache/测试数据均在本轮 Temp，自有 Vite 已关闭。没有启动或接管 5184/8776 或日常服务，没有修改日常树、真实数据、凭证、IndexedDB schema、HTTP/owner 协议及薄入口，没有安装、提交或推广。

回滚只针对 `closing.json` 列出的本轮修改/新增文件：先保留 closing，再把修改文件与 opening 逐一核对后恢复原字节，移除本轮新增文件。不得使用整个仓库 reset/restore/clean，避免丢失施工前脏工作。若后续有新修改，先比较 closing hash，不能盲覆盖。

源码施工在本轮有限范围内结束；若要求恢复原全部验收定义，下一步应单独做只读审核并处理上述既有检查和真实旅程缺口，不继续夹带产品改造。
