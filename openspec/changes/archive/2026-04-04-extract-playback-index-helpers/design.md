## Context

当前 `app.js` 的播放同步区段中同时包含两类内容：

1. 纯或近纯的时间索引 helper
   - `findChunkIndexByTime`
   - `bsFindActive`
   - `getCurrentSegmentIndex`
   - `getSegmentCheckpoints`
2. 高风险行为逻辑
   - `mainUpdateHighlight`
   - `followPlaybackTarget`
   - RAF 播放循环
   - 快进后退与句子导航

根据 `plan-reader-safe-modularization` 的 safe split 路线，第一步不应直接拆高亮心跳或 UI 行为，而应先把可参数化的时间索引 helper 抽到独立模块，作为后续更深层重构的边界基础。

## Goals / Non-Goals

**Goals:**
- 把第一批 playback index / time mapping helper 从 `app.js` 中抽离出来
- 保持这些 helper 通过显式参数接收运行时数据，不再隐式读取 DOM
- 保持 `app.js` 上层调用顺序和用户可见行为完全不变
- 让后续播放层与高亮层拆分时有一个稳定的 helper 边界

**Non-Goals:**
- 不修改 `mainUpdateHighlight`
- 不修改 RAF 播放循环
- 不修改 `renderChunkMode`、`makeSpan`、快捷键或任何事件监听
- 不顺手重写 playback 行为或修复无关 bug

## Decisions

### Decision: 只抽四个索引 helper，不扩大到行为逻辑
这次 change 必须保持 very small，因此只处理：
- `findChunkIndexByTime`
- `bsFindActive`
- `getCurrentSegmentIndex`
- `getSegmentCheckpoints`

这些函数要么已经接近纯函数，要么可以通过把 `words`、`segments`、`chunkItems`、`wordStarts`、`time` 显式传入变成纯 helper。

备选方案：
- 一并抽 `forceUpdateUI`
  - 不选，因为它直接连到 `window.mainUpdateHighlight`
- 一并抽 `smartBackward` / `smartForward`
  - 不选，因为它们属于导航行为，不只是索引计算
- 一并抽 `followPlaybackTarget`
  - 不选，因为它依赖 DOM 和滚动行为

### Decision: 新 helper 模块继续沿用当前仓库的 browser-global 模式
当前已抽出的 helper 都通过 `window.*` 暴露给 `app.js` 使用，因此这次为了最小风险，继续采用同样的模式，而不引入新的打包或模块系统。

### Decision: `app.js` 只做最小接线
`app.js` 保留现有调用点和行为顺序，只把函数定义改为引用外部 helper。这样可以最大程度降低对高亮、导航和 seek 链的影响。

## Risks / Trade-offs

- [Risk] `getCurrentSegmentIndex` 目前默认参数依赖 `audioPlayer.currentTime`
  → Mitigation：抽离后改成完全参数化，由 `app.js` 继续负责传入当前时间，保持行为不变

- [Risk] `bsFindActive` 与 `getCurrentSegmentIndex` 之间存在隐式数据依赖
  → Mitigation：在模块中保留显式组合关系，要求所有依赖通过参数传入

- [Risk] 播放相关回归很容易被用户感知
  → Mitigation：本次不触碰高亮主逻辑和事件顺序，只做 helper 搬移和最小接线，并用现有页面验证加最小浏览器验证保底

## Migration Plan

1. 新增独立 helper 文件
2. 在其中实现参数化后的 playback index helper
3. 在 `read-26.html` 中于 `app.js` 之前引入该 helper
4. 在 `app.js` 中用最小方式接线替换本地定义
5. 跑语法和页面加载验证，必要时补最小浏览器 seek/highlight 冒烟检查

## Open Questions

- 后续第二步是优先抽 chunk matching helper，还是继续收束更多 playback 计算 helper，目前留给下一个 change 决定
