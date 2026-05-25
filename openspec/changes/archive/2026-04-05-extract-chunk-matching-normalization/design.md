## Context

当前项目已经完成两轮与 `processChunkData()` 相关的 safe split：

- 第一轮抽出 `cleanText()`、`tokenizeText()`、`findExactMatch()`、`adjustIndex()`
- 第二轮抽出 `clamp(...)`、`findExactMatchRange(...)`、`scoreMatchCandidate(...)`

但在 `processChunkData()` 中仍然存在一层更细的纯结果整理逻辑，例如：

- candidate 的标准化或规整
- range / window / candidate 参数的纯计算整理
- index correction 的纯计算段

这些逻辑虽然已经很靠近主控制流，但本质上仍然只处理数据输入和输出，不直接写 `chunkItems`，也不应碰 fallback 主骨架。因此它们是下一步 very small safe split 的自然目标。

## Goals / Non-Goals

**Goals:**
- 从 `processChunkData()` 中提取下一批纯匹配结果整理 helper
- 收束 candidate normalization、range/window 参数整理和 index correction 的纯计算段
- 保持 `processChunkData()` 原入口、原控制流、原调用顺序和现有外部行为不变
- 优先继续扩展现有 `chunk-matching-helpers.js`

**Non-Goals:**
- 不迁出 `chunkItems` 组装
- 不迁出 fallback 主控制流
- 不迁出 `getSegTimeRange()` 或任何 segment 时间范围推导
- 不迁出 `globalWordCursor` 推进
- 不修改 `if (exact) / else / fallback` 主骨架
- 不修改 UI、DOM、`renderChunkMode()`、事件绑定、播放器或高亮逻辑

## Decisions

### 1. 这次只抽“结果整理层”，不抽“输出层”和“控制层”
本次只覆盖：
- candidate normalization
- range / window / candidate 参数整理的小算法
- index correction 的纯计算段

原因是这些逻辑仍然可以通过纯数据输入和输出表达。相对地，`chunkItems.push(...)`、fallback 分支、segment 时间范围推导和 cursor 推进仍属于输出层或控制层，必须保留在 `processChunkData()` 原位。

### 2. 优先扩展现有 `chunk-matching-helpers.js`
由于前两轮 chunk matching safe split 已经把纯文本处理和纯匹配 core 聚合到 [chunk-matching-helpers.js](/E:/小新备份文件/开发项目/lunix/read-final/chunk-matching-helpers.js)，这次优先继续扩展同一个 helper 文件。

理由：
- 这次仍然属于同一条 chunk matching 边界
- 再新建文件会增加装配和理解成本
- 当前目标是 very small change，不是重新划分 chunk matching 全模块层次

只有当实现中确认该文件的语义边界已明显过宽，才考虑额外拆分。

### 3. `app.js` 内允许保留薄包装和局部命名
如果 candidate normalization 或 index correction 的纯计算段当前嵌在控制流中，本次允许：
- 在 helper 中提取纯结果整理函数
- 在 `app.js` 中保留局部命名或小型包装

这样可以：
- 保持旧调用点最小变化
- 保留原控制流顺序
- 降低行为回归风险

### 4. 不改变默认搜索语义或匹配优先级
本次提取的 normalization helper 只能做“显式化”和“参数化”，不能借机更改：
- exact match 的优先级
- anchor correction 的优先级
- fallback 触发条件
- `output.json` 兼容语义

## Risks / Trade-offs

- [Risk] normalization helper 一旦抽得过深，容易顺手把控制流判断一起带走 → Mitigation：任务中明确禁止触碰 `if (exact) / else / fallback` 主骨架和 `globalWordCursor`
- [Risk] candidate normalization 与 scoring、index correction 相邻，抽离时容易重排顺序 → Mitigation：要求 `app.js` 只做最小接线，保留原局部函数名或薄包装
- [Risk] 连续几轮都往 `chunk-matching-helpers.js` 加 helper，可能使文件语义逐渐变宽 → Mitigation：在 design 中明确这次仍属同一边界；如果后续再扩展，应单独评估是否需要更细文件切分

## Migration Plan

建议实施顺序：

1. 盘点 `processChunkData()` 中仍未外移的纯结果整理步骤
2. 判断哪些步骤属于 candidate normalization，哪些属于 range/window 参数整理，哪些属于 index correction 纯计算段
3. 以最小改动扩展 `chunk-matching-helpers.js`
4. 在 `app.js` 中用薄包装或最小接线替换相应局部逻辑
5. 运行语法检查、页面加载检查和一条 `transcript + output.json` 的最小浏览器回归

回滚点应保持很小：
- [chunk-matching-helpers.js](/E:/小新备份文件/开发项目/lunix/read-final/chunk-matching-helpers.js)
- [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js)
- [read-26.html](/E:/小新备份文件/开发项目/lunix/read-final/read-26.html)（仅在确有装配变更时）

## Open Questions

- 当前 `processChunkData()` 中剩余的“candidate normalization”边界，是否已经足够清晰到能命名为一组 helper，而不是零散片段
- range/window 参数整理更适合抽成常量导出、工厂函数，还是纯 normalize helper
- 如果这轮之后 `chunk-matching-helpers.js` 已经覆盖文本处理、匹配 core 和 normalization，后续是否应再单独规划一次 file-level split
