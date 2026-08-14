# Read-Web 测试分层门

本文记录 Phase 2 的测试入口设计。当前脚本可以直接通过 Node 运行；`package.json` 接线由后续集成步骤统一完成。

## 设计原则

- 每个门在执行前打印完整 included/excluded 清单，避免把“没有运行”误报为“已经覆盖”。
- 每个命令串行执行并在首个失败处停止，输出失败的阶段名和退出码。
- `verify-fast` 不启动服务、不访问网络、不读取真实学习数据或 credential。
- `verify-full` 仅使用 `4193` 和 `4194`；不得启动、停止或复用原版 `5173/8765`。
- `READ_WEB_PYTHON`（其次 `PYTHON`）可以指定隔离 Python；未设置时使用 PATH 中的 `python`。

## Fast gate

运行：

```powershell
node scripts/verify-fast.mjs
```

只查看计划：

```powershell
node scripts/verify-fast.mjs --list
```

包含：

- Node/npm/lockfile 工具链契约；
- playback helper、annotation resolver 与 annotation bundle merge 行为；
- Vocabulary Acquisition、Learning Events 与 SRS v2 行为；
- Material Workflow client、loader 与 secret seam；
- Python `service` profile dependency inventory。

排除：浏览器 journey、build、Python integration suite、实时网络/AI/TTS/词典/YouTube 操作，以及尚未实现的 release gates。现有 source-shape compatibility scripts 仍可按需运行，但不作为 fast gate 的主要行为证据。

## Full gate

运行：

```powershell
node scripts/verify-full.mjs
```

只查看计划：

```powershell
node scripts/verify-full.mjs --list
```

包含：

1. 完整 `verify-fast`；
2. Vite production build；
3. `4193` 上的现有 load/playback/interaction browser journeys；
4. `4194` 上的 production preview load；
5. 在 `tools/subtitle-workflow` working directory 中运行 Python backend unittest suite。

Full gate 不启动真实 Material Workflow service。当前 Python suite 使用 in-process FastAPI Adapter；独立 `8766` production host、Material panel、SRS/Preview 浏览器 journey、故障注入与资源生命周期覆盖将在相应实现完成后加入。

## Release gate（当前明确阻断）

`verify-release` 不应只是 `verify-full` 的别名。其最低范围为：

- clean-room `npm ci` 与隔离 Python hash-lock 安装；
- 固定 fixture 的性能预算和长时间资源稳定性；
- secret、license、SBOM 与 release artifact 扫描；
- production host `8766`、Release Manifest 与 artifact hash；
- 全应用 backup/restore、migration dry-run 和 rollback drill。

当前 `verify-release` 会先列出并阻断未完成的 12.2、12.3 和 12.7；`--list` 只查看清单并以成功退出，默认执行以非零退出表示不可发布。`npm run verify:backup-restore-rehearsal` 的产物明确标记为 **isolated application-state foundation**，只证明临时 `application-state.json`、journal、rollback 和 quarantine 文件的校验/CAS/故障语义，不证明真实 IndexedDB/localStorage/workflow profile 的全应用恢复。该 rehearsal 由 `package.json` 的 `verify:backup-restore-rehearsal` 直接拥有，不能替代 12.2/12.3。

在 12.2、12.3 和其余 pending gates 完成前，任何 Full/基础 rehearsal 通过都不代表可以切换桌面快捷方式或接触真实学习数据。

## 已知基线问题

Windows 下 `test_cancel_marks_running_job_canceled` 偶尔会在 `TemporaryDirectory` 清理期间遇到后台线程仍写入 `.workflow_state`，报 `WinError 145`。Full gate 保留该失败，不自动 retry 或忽略；应在 workflow lifecycle 阶段修复线程终止与测试清理后再将其标记为稳定。
