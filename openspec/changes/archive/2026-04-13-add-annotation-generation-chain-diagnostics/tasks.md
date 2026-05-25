## 1. Diagnostics Helper

- [x] 1.1 新增一个很薄的 annotation chain diagnostics helper，统一事件名、字段结构、启停开关与 `scopeKey` 生成方式
- [x] 1.2 约定 diagnostics 输出最小公共字段：`audioKey`、`documentId`、`scopeKey`、事件阶段、计数摘要与必要的 `blockId`
- [x] 1.3 约定 diagnostics 输出只记录计数、key 和必要 identity 样本，不输出整份大 payload

## 2. Generate / Merge Instrumentation

- [x] 2.1 在 generation entry 到 controller 起点补充 diagnostics，记录当前 run 的目标总数、missing 数量与实际进入 planner 的 target 子集计数
- [x] 2.2 在 planner / block execution 路径补充每个 block 的 `targetCount`、本次请求 block 标识与关键 identity 样本
- [x] 2.3 在 provider 返回后补充 `returnedCount` diagnostics，便于与 block `targetCount` 对照
- [x] 2.4 在 merge 前后补充 generated item 数量变化 diagnostics
- [x] 2.5 在发生 identity 冲突跳过写入时补充 diagnostics，明确区分“provider 没返回”与“provider 返回了但 merge 未写入”

## 3. Save / Storage Instrumentation

- [x] 3.1 在 `annotation-generation-storage.js` 的 save 路径补充 diagnostics，记录写入的 generated/status key 或 file path
- [x] 3.2 在 save 时记录写入前后的 generated item 数量、block 数量或等价摘要
- [x] 3.3 确认初始生成与增量生成都落到同一份 generated bundle 时，有统一 diagnostics 可追踪

## 4. Restore / Refresh Instrumentation

- [x] 4.1 在 restore 链路补充 diagnostics，记录页面初始化时实际读取了哪些 generated/status key
- [x] 4.2 在 restore 后记录读回的 generated item 数量、当前 `audioKey`、`documentId` 与 `scopeKey`
- [x] 4.3 在 generated index refresh 路径记录 indexed item 数量与是否因 scope stale 被丢弃
- [x] 4.4 在刷新后再次点击生成的路径补充 diagnostics，验证 diff 基线是否来自刚恢复的数据

## 5. Render / Consumption Instrumentation

- [x] 5.1 在最终页面可交互阶段补充 diagnostics，记录当前可消费 generated annotation 数量或等价摘要
- [x] 5.2 在 click resolver / bubble 消费边界补充最小 diagnostics，确认命中前使用的 scope 和索引状态
- [x] 5.3 如果现有渲染链路能拿到 block 级 annotation 显示数量，则补充每个 block 的最终显示计数；否则至少输出整篇级消费计数

## 6. Verification And Diagnosis Output

- [x] 6.1 准备一组可重复复现“初始生成后缺项、增量后仍缺项、刷新后更不完整”的排查步骤
- [x] 6.2 跑通一次完整流程：初始生成 -> 增量生成 -> 刷新恢复 -> 页面点击消费，并收集 diagnostics 输出
- [x] 6.3 根据 diagnostics 明确区分问题发生在 generate、merge、save、restore 还是 render 层
- [x] 6.4 形成最终诊断结论，按“问题现象 / 实际发生位置 / 原因判断 / 证据”格式输出
- [x] 6.5 如果发现不止一个问题，分别归因并给出后续最小修复建议，但不在本 change 中顺手大改
