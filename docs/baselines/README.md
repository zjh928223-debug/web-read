# Read-Web Next Baseline

`scripts/capture-next-baseline.ps1` 用于在架构稳定化开始前，生成一份可比较、machine-readable 的本机只读快照。它不会启动、停止、重启或打开任何服务，也不会修改 Git、端口、进程或学习数据。

## 采集内容

- 当前 repository 的 git SHA、branch、dirty 状态与 `git status --short --branch`。
- Node、npm、Python、pip 和 PowerShell 版本；缺失工具会记录为 `command-not-found`。
- 5173、5174、8765、8766 的 TCP listener、PID、process name 和只读 HTTP probe：
  - 5173/5174 请求 `/`，只记录 status、duration 和 content type。
  - 8765/8766 请求 `/api/health`，只摘取 status、service、serviceVersion 和启用的 feature name。
- RuntimeConfig 相关环境变量是否存在以及存在于哪些 scope。

脚本不会记录环境变量值、原始 health body、process command line、API key、token、cookie 或 proxy 内容。

## 使用方式

从任意目录执行均可，repository root 会根据脚本位置解析：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\read-web-next\scripts\capture-next-baseline.ps1
```

默认输出到 `E:\read-web-next\output\baselines\next-baseline-<UTC>.json`。`output/baselines/` 是本机生成物目录，不应提交 Git。

可以传入完整 JSON 文件名：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\read-web-next\scripts\capture-next-baseline.ps1 -OutputPath E:\ReadWebData\Diagnostics\before-phase-1.json
```

也可以传入目录；脚本会在目录中生成带 UTC timestamp 的文件：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File E:\read-web-next\scripts\capture-next-baseline.ps1 -OutputPath E:\ReadWebData\Diagnostics
```

JSON 先写入同目录的临时文件，再通过原子 replace/move 发布。重复指定同一文件时，不会留下半写入的目标文件。

## 结果判读

- `captureMode` 必须是 `read-only`。
- `repository.isDirty` 表示快照时是否存在未提交修改；这不是采集失败。
- `ports[].listeners` 为空表示采集瞬间没有 listener，脚本不会尝试启动它。
- `ports[].probe.reachable` 为 `false` 时查看 `error`，该字段只保存异常类型，不保存可能包含本地路径或响应正文的错误消息。
- `runtimeEnvironment.<NAME>.isSet` 和 `scopes` 只说明配置是否存在，不证明配置内容有效。
- `redaction` 的三个字段必须均为 `false`，用于证明敏感原始值没有进入快照。

该 baseline 是 Phase 1 的事实记录，不代替后续的 performance journey、数据恢复演练或 release verification。
