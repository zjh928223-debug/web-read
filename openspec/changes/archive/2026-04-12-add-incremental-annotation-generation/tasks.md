## 1. Target Identity And Diff Helper

- [x] 1.1 复核并固定 unified target source 当前用于增量判断的稳定 target identity，明确以 `occurrenceKey` 为主键，并记录其与 `occurrenceGlobalStart` / `occurrenceGlobalEnd` 的关系。
- [x] 1.2 新增一个轻量 `annotation-generation-diff` helper 或等价模块，集中读取当前 unified target source 与当前 document scope 的 generated bundle。
- [x] 1.3 在 diff helper 中输出 `allTargetsCount`、`generatedTargetsCount`、`missingTargets` 和 `missingTargetKeys`，并确保 repeated word occurrence 按 identity 正确区分。
- [x] 1.4 确认当前 target 集中已被取消标记、不再属于 unified target source 的 target 不会继续被计入 current missing targets。

## 2. Generation Entry And Controller Incremental Wiring

- [x] 2.1 保留现有“生成全文注释”入口，但将点击后的主流程升级为“先 diff、后决定是否发请求”。
- [x] 2.2 在 `annotation-generation-controller.js` 中收敛增量 orchestration：读取当前 diff 结果，并在 `missingTargets = 0` 时直接返回 no-op 终态。
- [x] 2.3 确保 no-op 路径不发 provider request、不写入假的 generated item、也不破坏现有 restore / refresh 行为。
- [x] 2.4 在有 missing targets 时，让 controller 只把 missing target 子集交给后续 planning / generation 路径，而不是让 `app.js` 自己拼装业务规则。

## 3. Planner Subset Planning And Request Minimization

- [x] 3.1 为 `annotation-block-planner.js` 增加最小输入 seam，使其能够只围绕指定 target 子集规划，而不必重新处理全量 targets。
- [x] 3.2 确保 planner 仍保留现有 sentence / block / cap 规则，只改变输入 target 集，不改 block 语义。
- [x] 3.3 让 missing targets 很少时优先收敛成最少 block 数，能一块完成时只发一次 provider request。
- [x] 3.4 让 missing targets 较多时，按现有 block cap 拆成最少必要 requests，而不是回退到整篇重跑。

## 4. Incremental Merge, Restore, And Refresh

- [x] 4.1 复用或收敛现有 generated item merge seam，明确默认语义为“补缺合并，不默认替换旧结果”。
- [x] 4.2 当同一 `occurrenceKey` 的旧 item 已存在时，默认不重复插入，也不静默覆盖旧 item。
- [x] 4.3 增量生成完成后，将新 items 合并进当前 document scope 的 generated bundle，并保持旧 items 不丢失。
- [x] 4.4 确保 merge 后的 generated bundle 仍能被现有 storage save / restore、generated index refresh、click resolver 和 bubble consumption 正常消费。
- [x] 4.5 确保一次增量生成刚完成并完成 merge/refresh 后，重复点击不会继续把刚生成的 targets 误判为 missing。

## 5. Honest Incremental Status Semantics

- [x] 5.1 为 entry/status 增加一个与普通 `complete` 可区分的 no-op 终态，例如 `up-to-date`、`no-missing-targets` 或等价状态。
- [x] 5.2 让该 no-op 终态明确表达“本次无需生成，未发 provider request”，且不落到 `failed`。
- [x] 5.3 在有 missing targets 并成功补生成时，更新 status message，使用户能看出这次是补生成若干项，而不是整篇重跑。
- [x] 5.4 保持当前主按钮文案不变，只做最小状态与 message 语义更新。

## 6. Verification

- [x] 6.1 验证首次生成时，所有 targets 都是 missing，系统按现有链路正常生成。
- [x] 6.2 验证第二次点击生成且没有新增标记时，不发 API 请求，并明确显示无缺口 no-op 状态。
- [x] 6.3 验证新增一两个 marked targets 后，再点生成时只为新增 targets 调用 API。
- [x] 6.4 验证已生成 targets 不会重复请求，且 generated bundle 合并后旧结果不丢失。
- [x] 6.5 验证刷新页面后，diff 仍基于 restore 后的数据正常工作。
- [x] 6.6 验证 missing targets 很少时只需一次 provider request；missing targets 很多时按现有 block cap 拆成最少 requests。
- [x] 6.7 验证取消标记后的 target 不再算作当前 missing target。
- [x] 6.8 验证同一个单词在不同位置出现多次时，diff 仍按 target identity 区分，不能误判为已生成。
- [x] 6.9 验证生成后新增结果继续可点击显示，且现有 click resolver / bubble 消费链路不受影响。
- [x] 6.10 运行 `node --check` 覆盖新增和修改的相关文件。
