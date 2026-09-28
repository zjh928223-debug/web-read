# HOST-03 正常入口保存确认交接

日期：2026-09-26。执行结果：**PASS**。

**本次 Host 保存与入口维修按约定范围完成；
历史旧数据问题未确认。**

本次仅执行 [Host 最小修复方案](./host-minimal-repair-plan.md) 第 5 节及用户指定的 HOST-03 范围。HOST-01 的独立审核 PASS 采用用户提供的状态；关联检查引用 [HOST-01 交接](./host-01-repair-handoff.md)。预习首次打开、关闭重开及刷新恢复引用 [HOST-02 交接](./host-02-repair-handoff.md)，没有重复验收预习。未恢复 H3–H5、严格延迟门槛、全系统或旧库清理任务，未自动提交。

## 1. 本次修改和预定验收口径

本次没有修改产品、启动器、配置、测试登记或 HOST-01 修复。仓库只新增本交接文档；开场的 7 个已修改文件逐个 SHA-256 比较一致，原未跟踪设计资料保留。

验收口径在操作前沿用方案：从正常主入口进入 SRS，第一张揭示并评分后进入下一张；第二张快速重复输入只保存一笔；保存后刷新，实际学习记录、业务回执和进度没有重复或丢失；引用未受本轮改动影响的 HOST-02 预习证据；完成构建及 diff 检查，并停止本任务服务。

## 2. 环境、合成数据及启动准备

- 工作区：`E:\read-web-next-optimization`，配置：`config/runtime.optimization.json`。未操作日常或历史工作区。
- 开场优化 loopback 5184/8776 无监听实例。Tailnet 地址上的 5184 由 `tailscaled`（PID 12536）监听，未操作该进程，未验收 Tailnet。
- 为保留 HOST-02 原始记录，把它的 `profiles/optimization` 合成 profile 复制到新专用根 `E:\ReadWebData\SubtitleWorkflow-Optimization\.read-web-application\host-03-20260926`。只有 cobalt / lantern 两词；原 HOST-02 Owner 内容与本轮复制的初始快照逐字段一致，未修改原数据。
- 使用现有启动器：

  ```powershell
  & scripts/launch-optimization-preview.ps1 -NoOpen -EnableOwnerMigration -EnableOwnerPromotion -ApplicationProfileAuthorityIsolationRoot 'E:\ReadWebData\SubtitleWorkflow-Optimization\.read-web-application\host-03-20260926'
  ```

- 测试副本最初保留了原路径的 Owner checkpoint。第一次 readiness 等待 45 秒失败；第二次用 90 秒等待检查真实健康响应，得到 `status=degraded`、`OWNER_MODE_CHECKPOINT_INVALID`。启动器两次均回滚并停止其实例。`read-web-production-backup.mjs` 的 checkpoint 校验要求 profile 路径对应的 lease hash 一致；复制的旧 checkpoint 不适用于新测试路径。这是本轮测试环境准备问题，没有作为产品评分失败，也不代表历史健康超时问题已修复。
- 将**新副本内**这两份 checkpoint 移入本轮证据目录留存；原 HOST-02 checkpoint 和所有 Owner 记录保留。随后按原命令启动成功，配置未改，仍使用默认 45 秒等待。
- 正常入口 `http://127.0.0.1:5184/`；capability sidecar 8776，内部 Python Host 5200。成功 instance：`27369b1f3ebc417a9964ba1c0c4fc18b`；release：`read-web-optimization-v2-c9c18b1add51-742357250b65-b692895de6ba`，与 HOST-02 相同。
- 新测试根是 `pre-cutover`。准备脚本按现有优化管理契约，使用 `X-Read-Web-Owner-Migration: optimization` 查询实际两域快照，再使用 `X-Read-Web-Owner-Promotion: optimization` 调用 `/api/app/owner-promotion/commit`，绑定当前 profile lease。准备中曾遇到未带相应管理 header 的 pre-cutover 查询拒绝及 promotion 403；补齐现有契约后成功，没有更改产品授权或去重保护。
- 只登记 `vocabulary-srs` 与 `passage-preview` 两域，属于合成环境准备，不是现存数据迁移或全六域验收。详细请求和结果见 `test-domain-initialization.json`。
- 通过真实 `/api/app/owner` HTTP mutation，把复制的两词 acquisition state 准备为 `graduated`，新增两份已到期的 `review-state.v2`，初始 `reps=2`、state revision=2。仅此步骤是合成卡准备，未预造评分、学习事件或会话结果；词库 revision 12→13。见 `synthetic-card-preparation.json`。

## 3. 实际浏览器操作及持久化结果

使用项目已安装的 Playwright Chromium，新的隔离 context，1365×900，时区 Asia/Shanghai。当前未提供 frontend-testing-debugging 技能所指的 Browser 插件，记录为 `Browser plugin not available`，沿用项目 Playwright 方式。没有拦截 HTTP、模拟 Owner 响应或注入评分处理器。

1. 打开正常根页面，标题 `Advanced Seek Player + Smart Chunking (Pro)`，点击现有“今日复习”。显示 cobalt，进度“复习 1 / 2”；实际 session ledger 在 Host 保存。
2. 点击“显示答案”，确认句中释义“钴”，再点击“一般”。页面进入 lantern，“复习 2 / 2”。等待实际 Host 评分和 ledger 写入完成后读回。
3. 揭示 lantern，确认“灯笼”，使用真实 Playwright keyboard 连续执行两次 `press('3')`；两次调用共约 10 ms，没有注入延迟或设延迟门槛。页面显示“今日复习已完成，共完成 2 张，Good 一般：2”。实际只新增 lantern 的一笔评分。
4. 完成保存后刷新根页面，再点击“今日复习”。显示“今日复习已完成，当前没有需要复习的词”。通过新的真实 HTTP snapshot 读回完整学习记录；不把该空队列提示当成保存证明。

| 实际阶段 | vocabulary revision | 业务回执总数 | 学习事件总数 | 本轮评分数 |
|---|---:|---:|---:|---:|
| 合成卡准备后，正常主页面 | 13 | 8 | 6 | 0 |
| 首次进入 SRS，session ledger 保存 | 14 | 8 | 6 | 0 |
| 首卡揭示时 | 15 | 8 | 6 | 0 |
| cobalt 评分后，进入 lantern | 17 | 9 | 7 | 1 |
| lantern 快速重复输入后 | 19 | 10 | 8 | 2 |
| 刷新根页面、重开 SRS | 19 | 10 | 8 | 2 |
| 停服后磁盘读回 | 19 | 10 | 8 | 2 |

revision 的额外变化不是重复评分：revision 14 创建 session ledger，15 是正常页面常用释义缓存的 `entry-upsert`；16/18 是两笔评分 `learning-unit-of-work`，17/19 是各自 session ledger 的 `review-attempt` 更新。浏览器捕获到的 6 次 Owner command 全部 `committed`。

实际读回的两笔 `review_attempt_recorded`：

| 词 | attempt ID | occurred_at | recorded_at | 下次到期 |
|---|---|---|---|---|
| cobalt | `srs-ui-attempt:b2b3ff2a-bb51-42fd-8348-3286361fb59d` | `2026-09-26T11:45:39.315Z` | `2026-09-26T11:45:39.349Z` | `2026-10-07T11:45:39.315Z` |
| lantern | `srs-ui-attempt:e8fcbf8b-688e-44b0-aeb5-bbde591c2990` | `2026-09-26T11:45:51.634Z` | `2026-09-26T11:45:51.667Z` | `2026-10-07T11:45:51.634Z` |

- 两笔均为 `good`、`answer_revealed_before_rating=true`；各有唯一 event ID、command ID、对应业务回执。每个 learning unit 只有一笔本轮评分，`reps=2→3`、state revision=2→3，与事件 `after_state` 完全一致。
- session `srs-review-ui:2026-09-26`：cursor=2、status=`completed`、revision=2、两个 completed item ID、两个唯一 attempt ID及两份结果；与学习事件身份对应。
- 刷新前后比较**全部 Owner records**，完全一致；包括时间、请求/业务身份、事件内容、review state、回执、ledger，而非仅比较行数。
- 原有 8 条业务回执、6 个学习事件逐条内容一致，没有丢失或重复。停服后磁盘 JSON 与最终 HTTP records 及 revision 完全一致。

## 4. 检查、引用证据和剩余边界

| 检查 | 结果及边界 |
|---|---|
| 页面身份、非空、框架错误覆盖层、截图 | PASS；正常根入口，实际主页面/两卡/完成/刷新截图已保存并检查 |
| 揭示、评分及下一张 | PASS；真实 UI→HTTP→Python Owner |
| 第二张快速重复输入 | PASS；两次真实键盘输入，只一笔评分事件和业务回执 |
| 刷新读回、原记录保留 | PASS；完整 HTTP records 比较，再与磁盘内容比较 |
| Host command outcome | PASS；6 次均 committed，0 次失败；无 `Command ID was reused` 或评分保存错误 |
| 浏览器运行情况 | 0 pageerror、0 dialog、0框架覆盖层；4 条资源 404，见下述合成素材限制；一个整句翻译请求在页面生命周期中被取消，未影响保存 |
| `npm run build` | PASS；本轮单独执行一次，日志 `build.log`；启动器的 staging 构建另外也成功 |
| `git diff --check` | PASS；最后在交接文档写入后再检查 |
| 既有差异保护 | PASS；开场 7 个已修改文件 SHA-256 未变；无产品、启动器、配置新改动 |
| HOST-01 关联检查 | 引用其已完成的竞争回归（模拟及真实 Python）、13 项 Python Owner 测试、获取/文章获取、SRS及评分 UI v2等 PASS；本轮不重跑模拟来替代浏览器证据 |
| HOST-02 预习入口和恢复 | 引用其真实浏览器/HTTP四阶段证据；本轮未改预习获取、恢复、命令身份路径，成功 release 亦相同；未重复验收 |

合成材料没有真实字幕/音频文件，卡片显示“没有找到这条原文对应的字幕或音频文件”。两卡加载中共出现 4 条资源 404；补充只读 HTTP 检查确认 `host-02-synthetic` 的 transcript/chunkData 均为 404，见 `synthetic-media-check.json`。这些提示与合成材料准备相符，揭示/评分/刷新保存均成功；本轮不把音频及外部翻译当成已验收功能，也不扩展成素材修复任务。控制台 404 未逐条记录原请求 URL，因此不宣称 console 全部无错误。

历史旧数据问题仍未确认，没有读取、清洗旧库，也不宣称历史 `Command ID was reused` 或历史健康超时已全部解决。本轮没有跨机器、Tailnet、全六域、长期健康或完整音频验收。

## 5. 证据、数据保留和停止

证据目录：

`C:\Users\0\.codex\visualizations\2026\09\26\01a0dd7e-e676-7f73-9dbc-b7d6dee26469\host-03\`

主要文件：`browser-evidence.json`（各阶段 UI与真实 HTTP snapshot、命令结果）、`checks.json`（实际记录比较）、`health.json`、`initial-copied-snapshot.json`、`test-domain-initialization.json`、`synthetic-card-preparation.json`、`startup-health-inspection.json`、两份 `copied-invalid-*-checkpoint.json`、`synthetic-media-check.json`、`build.log`、`stop.log`、`workspace-baseline.json`。单次操作/比较脚本也保留在证据目录，未登记为产品测试或新验收平台。截图包括 `main-entry.png`、`first-card.png`、`first-reveal.png`、`first-saved-next-card.png`、`second-reveal.png`、`second-saved.png`、`refreshed-main.png`、`refresh-reopen.png`。证据没有 token 或既有私人词库。

本轮合成持久化数据保留在：

`E:\ReadWebData\SubtitleWorkflow-Optimization\.read-web-application\host-03-20260926\profiles\optimization\owners\`

保留两域 Owner、receipts 和新路径的 checkpoint 以便复核，没有删除原 HOST-02 数据、默认 profile 或其他实验根。后续启动此数据需显式指定本轮 authority isolation root，不能把两域测试准备视为默认环境已经全域切换。

隔离浏览器已关闭。执行 `scripts/launch-optimization-preview.ps1 -Stop -NoOpen` 停止本任务 production-host、capability-host 和 front-door；停止后核对 loopback 5184/8776/5200 没有监听，磁盘评分和 ledger 与最终 HTTP 一致。临时 instance 目录由启动器处理，专用合成持久化根保留。没有操作 Tailnet 的独立监听。

本次 Host 保存与入口维修按约定范围完成；历史旧数据问题未确认。
