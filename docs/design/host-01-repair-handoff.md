# HOST-01 版本竞争修复交接

日期：2026-09-26。状态：版本竞争修复通过，正常入口待确认；尚未进行独立审核。

本次只执行 [Host 最小修复方案](./host-minimal-repair-plan.md) 的 HOST-01。验收口径沿用方案第 3 节，没有增加 H3–H5、全六域、长期健康或跨机器门禁。未执行 HOST-02，未提交代码。

## 1. 复现次序和根因

新增回归通过当前实际 JS Owner 集成与获取服务运行，两套集成共享存储：

1. A 查询 revision 0，在内存事务中计算自己的候选条目和事件。
2. 拦在 A 的提交入口，B 完成另一笔业务写入，存储 revision 变为 1。
3. 让 A 用 expectedRevision 0 提交。

修复前同一回归实际报 `vocabulary-srs Host learning-unit-of-work did not complete`，code 为 `REVISION_CONFLICT`，outcome 为 `conflict`。这是集成层确定性竞争复现，不是完整浏览器故障复现。

根因是 Owner 学习 runner 只读、算、提交各一次。另有两个重算相关问题：旧 transport key 只包含业务 command ID 和改变的行 ID；评分 callback 内会重新取 `recorded_at`。现有文章获取 batch 也会在 callback 中重新生成缺省 `createdAt`，新回归实际观察到同一条目从 08:00:02 变为 08:00:17。

## 2. 实际修改和恢复决定

| 文件 | 修改 |
|---|---|
| `src/services/vocabulary/windows-owner-vocabulary-srs.js` | 单命令和 batch 共用最多三次提交的重算逻辑；每次重新读快照、创建新内存事务；提交身份绑定请求指纹；加强未知结果回执匹配；错误文本附带原 code，保留 outcome |
| `src/services/vocabulary/srs-review-service-v2.js` | 在进入学习事务前固定本次评分 `recorded_at` |
| `src/services/vocabulary/vocabulary-acquisition-service.js` | 一个逻辑 batch 内按 command ID 保留命令时间，供重建的获取服务使用；缓存只活到该 batch 结束 |
| `src/services/vocabulary/vocabulary-service.js` | 一行修改：在进入文章获取 batch 前固定条目输入的 `createdAt` |
| `scripts/windows-owner-vocabulary-srs-conflict-check.mjs` | 472 行针对性回归，覆盖模拟存储和实际 Python Owner；只用合成数据 |
| `scripts/windows-owner-c2c-vocabulary-srs-check.mjs` | 现有未知结果模拟回执补齐 domain 和真实契约的请求指纹，未运行其整套历史流程 |
| `package.json`、`docs/architecture/test-inventory.json` | 登记新回归并同步既有生成清单；清单生成也更新了两个已有浏览器脚本的源文本证据分类，未修改这些脚本 |

关键语义：

- 只有匹配本次请求的冲突回执明确表示未提交、并且 revision 已前进，才重算。初次提交加最多两次恢复；第三次仍冲突就抛原错误。读取、业务校验、未就绪、没有匹配回执的 transport key 冲突和未知结果不进入此循环。
- 业务 command ID 不变，继续依靠原内容指纹与持久化业务回执去重。相同 ID 改内容仍为 `IDEMPOTENCY_CONFLICT`，没有随机业务 ID 或删除回执。
- transport key 的输入包含实际请求指纹，绑定 domain、operation、capability、expectedRevision、行 ID 与内容。Python Owner 会先给行补 checksum 再计算指纹，客户端按同一契约计算。
- 未知结果只查询原 key 的成功回执；核对 domain、operation、key、expectedRevision、请求指纹、提交 revision 和内容 checksum。查不到、查询失败或不匹配均保持未确认，不生成新 key 重发 mutation。
- 评分事件 ID 和发生时间来自原输入；评分记录时间、业务回执时间和获取 batch 的逻辑命令时间跨重算稳定。
- 已核对当前 callback：学习业务在 `uow` 中读写；文章 batch 使用预先准备的词条并延后外部词库最终写入，batch 内只暂存结果；评分后的 ledger 写入在学习事务返回后。默认评分调度是本地计算。后续新增 callback 仍须遵守只计算/暂存事务数据的边界，不能放入需要重放的网络或外部写入。

## 3. 验证结果

| 验证 | 结果与边界 |
|---|---|
| `npm run verify:windows-owner-vocabulary-srs-conflict` — 模拟 | PASS。实际 JS 集成的单命令/batch/评分/文章 batch 竞争；保留 B 数据；重复命令和评分不新增业务回执/事件；单命令和 batch 持续冲突均三次退出；未知结果仅一次 mutation；错误/缺失/不匹配回执不误报成功；同 ID 改内容被拒绝；记录时间稳定 |
| 同一新回归 — 真实存储 | PASS。通过标准输入桥直接调用实际 Python `VocabularySrsOwner`，两套实例共享临时文件；单命令/batch/评分/文章 batch 竞争成功；重新实例化读回；核对失败/成功 transport 回执和指纹；复用 key 改 expectedRevision 被拒绝；模拟丢失响应后通过真实持久化回执确认成功且不重发 |
| `npm run verify:windows-owner-vocabulary-srs` | PASS，13 项 Python 存储测试 |
| `npm run verify:vocabulary-acquisition-service` | PASS，JS 内存/注入依赖验证 |
| `npm run verify:vocabulary-article-acquisition` | PASS，JS 获取流程验证 |
| `npm run verify:srs-review` | PASS，既有 SRS 针对性检查 |
| `node scripts/srs-review-service-v2-check.cjs` | PASS，评分 v2 与会话 ledger 行为验证 |
| `npm run verify:srs-review-ui-v2` | PASS，组件/服务依赖注入与 SSR 检查，不是浏览器到 Host 验收 |
| `npm run verify:test-inventory`、`npm run verify:script-inventory` | PASS，既有登记检查 |
| 新回归及调整后的 C2C 脚本语法检查、`git diff --check` | PASS |
| `npm run build` | PASS，仅验证当前产品模块能完成生产构建，不代表浏览器/Host 入口验收 |

真实存储测试使用 `config/runtime.optimization.json` 选择 Python，数据在优化工作区的 `.tmp-host-01-*/storage/` 下。测试结束关闭子进程并删除本任务临时数据；早期模块加载试验留下的临时文件也已清理。没有修改日常/历史工作区、用户数据或启动配置，没有启动优化预览。

## 4. 未验证内容和下一项注意事项

- 没有进行浏览器/真实 HTTP Host 正常入口验证，没有重现或确认历史完整浏览器故障；静态/模拟及直接 Python 存储结果不能替代这项证据。
- 正常预习的 `Command ID was reused` 与健康请求超时尚未定位或修改。HOST-02 仍需从实际预习入口复现，先区分业务 `IDEMPOTENCY_CONFLICT` 与 transport/CAS 冲突；保留内容指纹保护。
- 正常入口启动、复习评分/刷新读回和预习恢复由后续 HOST-03 确认。使用现有优化启动器、5184/8776 和优化数据根，不恢复旧 H3–H5 链。
- 代码由用户决定是否提交；本次保留了原有未跟踪设计资料。
