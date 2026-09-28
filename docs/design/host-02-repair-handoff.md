# HOST-02 预习入口命令 ID 排查交接

日期：2026-09-26。结论：**本轮合成路径未复现，未改产品代码。** 首次打开、关闭重开和刷新重开均执行成功，不是因入口受阻而跳过。历史 `Command ID was reused` 是否仍能被旧数据触发尚未确认，不能据此宣称历史问题已修复。

本次仅执行 [Host 最小修复方案](./host-minimal-repair-plan.md) 第 4 节。按用户提供的状态，HOST-01 已独立审核 PASS；保留其修复及其他工作区差异。不恢复 H3–H5，不执行 HOST-03，不自动提交。

## 1. 环境和实际操作

- 先阅读 `AGENTS.md`、维修方案及 HOST-01 交接，记录原工作区状态。启动前优化 loopback 5184/8776 没有监听实例。
- 使用 `config/runtime.optimization.json` 和现有启动器：

  ```powershell
  & scripts/launch-optimization-preview.ps1 -NoOpen -EnableOwnerMigration -EnableOwnerPromotion -ApplicationProfileAuthorityIsolationRoot 'E:\ReadWebData\SubtitleWorkflow-Optimization\.read-web-application\host-02-20260926'
  ```

- 正常浏览器入口为 `http://127.0.0.1:5184/`；sidecar 为 8776，启动器选择内部 Host 5200。release 为 `read-web-optimization-v2-c9c18b1add51-742357250b65-b692895de6ba`，instance 为 `3d62a1c98c0540aab307217d44b13e35`。启动器在 staging 中构建当前工作区，包含 HOST-01 修复；未单独重复构建。
- 使用项目现有 Playwright Chromium、隔离 context、1365×900。会话未提供 Browser 插件，故沿用已有 Playwright 方式。未拦截请求、模拟 Owner 响应或注入预习业务处理器。
- 新测试根初始为 `pre-cutover`。曾尝试现有文件切换工具，因运行中 Host 持有目标锁，返回 `BACKUP_PATH_LOCK_TIMEOUT`；这属于测试环境准备，没有作为预习入口结果。随后通过实际 HTTP 查询确认两个目标域为空，用现有 `/api/app/owner-promotion/commit` 管理接口登记空快照指纹，使 `vocabulary-srs` 和 `passage-preview` 两域启用。其他域未切换。此步骤仅搭建合成测试环境，不是现存数据迁移或全六域验收。
- 词包仅有 `cobalt` / `lantern`，中文义为“钴”/“灯笼”。短句和翻译均为合成内容，来源明确标为 `HOST-02 synthetic local text`；没有使用真实用户词库、外部句源或 AI 请求。
- 从主页面现有 `.passage-preview-file-input` 导入合成 JSON，进入首次预习；点击“看看这个词怎么用”注册 cobalt。
- 点击“返回阅读器”，再点击主页面“待预习”；确认 cobalt 仍已揭示，且仍在第 1 词。
- 点击“下一词”，揭示并注册 lantern；确认第 2 词。
- 刷新正常主页面，再点击“待预习”；恢复到已揭示的 lantern，进度为“预习 2 / 2”。未点击完成批次、进入今日复习或执行 SRS 评分。

## 2. 检查结果

以下存储结果均由真实浏览器入口触发，再通过真实 `/api/app/owner` HTTP 查询 Python Owner 读回；不是仅调用 Python 类或内存模拟。

| 阶段 | 词库 revision | learning unit 数 | 业务回执数 | 学习事件数 | UI / 进度 |
|---|---:|---:|---:|---:|---|
| 首词揭示注册完成 | 6 | 1 | 4 | 3 | cobalt，1 / 2，已揭示 |
| 关闭重开 | 6 | 1 | 4 | 3 | cobalt，1 / 2，仍已揭示 |
| 第二词揭示注册完成 | 12 | 2 | 8 | 6 | lantern，2 / 2，已揭示 |
| 刷新重开 | 12 | 2 | 8 | 6 | lantern，2 / 2，仍已揭示 |

- 对首词注册完成与关闭重开，以及两词注册完成与刷新重开，比较完整 learning unit 摘要、业务回执内容及事件内容，均相同。不是只比较行数。
- cobalt unit：`article-acquisition:c2be2dafff40ec0669ecbedff1a3c082:unit`；lantern unit：`article-acquisition:c5f8df2522119b8bc8b8692bf88acdb3:unit`。两者均保持 `acquiring`，原创建/引入时间及 context ID 未变。
- 每词持久化 `queue`、`sense`、`introduce`、`context` 四个业务命令回执；重开和刷新没有重复业务回执或事件。
- 批次保持 `batch:08c2854f`，最终 `currentIndex=1`，`host-02:cobalt` 和 `host-02:lantern` 的 revealed 均为 true。预习 durable-state revision 从 4 到 8 的变化来自现有进度/材料保存，不等于重复获取事件。
- 正常页面标题和入口正确，页面非空，没有框架错误覆盖层；停服前保存的证据中 pageerror、console warning/error、alert 均为 0。捕获的 20 次 Owner command 全部 `committed`，没有失败 outcome。
- 本轮未出现业务 `IDEMPOTENCY_CONFLICT`、transport 冲突或 `Command ID was reused`，因此没有“两份冲突 payload”的实际证据，不猜测根因或修改命令身份。
- 真正的“同 ID 改内容仍拒绝”检查引用 HOST-01 已通过的定向回归，本轮未重复运行；本轮没有修改内容指纹保护。
- `git diff --check` PASS。原 7 个已修改文件的 diff numstat 与开场一致；本轮只新增本交接文档，没有修改产品、测试脚本、package 或启动配置。按无代码修改分支，没有另跑构建或获取服务回归。

## 3. 证据、数据和停止结果

证据目录：

`C:\Users\0\.codex\visualizations\2026\09\26\01a0dd70-c172-7990-963c-24dc57432b08\host-02\`

其中 `two-words.json` 是实际导入词包，`browser-evidence.json` 保存四阶段 UI、Owner 读回及请求 outcome，`checks.json` 保存比较结果，`setup-initialization.json` 说明空测试域初始化。截图为 `first-reveal.png`、`close-reopen.png`、`before-refresh.png`、`refresh-reopen.png`。证据不含 token，也不包含既有私人词库。早期未成功的临时初始化脚本已移除。

合成持久化数据保留在：

`E:\ReadWebData\SubtitleWorkflow-Optimization\.read-web-application\host-02-20260926\profiles\optimization\owners\`

含 `vocabulary-srs/vocabulary-srs-owner.json`、`passage-preview/passage-preview-owner.json` 及各自 receipts。该专用根还保留两域 checkpoint 和早期空 source 准备目录；没有清洗既有用户记录或其他实验根。

停服后只读核对这两个 JSON 文件：词库 revision 12、2 个 learning unit、8 条业务回执；预习 revision 8、同一批次、currentIndex 1、两词均已揭示，与最后一次 HTTP 读回一致。

执行 `scripts/launch-optimization-preview.ps1 -Stop -NoOpen` 成功停止本任务的 production-host、capability-host 和 front-door；临时 instance 目录已由启动器删除。隔离浏览器已关闭，5184/8776/5200 不再有 loopback listener。另见 `tailscaled`（PID 12536）在 Tailnet 地址监听 5184，未操作该进程；本轮没有验证 Tailnet 入口。

## 4. 下一项注意事项

- HOST-02 的结论限定为“本轮合成路径未复现，未改代码”。没有读取或清洗旧库，不代表旧数据问题已解决。
- HOST-03 尚未执行。今日复习正常入口评分、快速重复输入和刷新读回仍待它确认；本轮的预习入口及恢复证据可以按方案引用，无需重复做同一路径。
- 后续若要复用此合成 Host 数据，启动器需继续显式指定上述 authority isolation root；正常默认 authority 根与本轮专用根不同。不要把仅两域启用的测试准备当成默认环境或全六域迁移通过。
- 若后续更改预习获取、恢复或命令身份路径，本轮证据不再自动适用。保持内容指纹保护，先记录实际 command type/ID 和差异字段，再作最小修复。
- 本轮不宣称“Host 保存与入口维修完成”，没有自动提交。
