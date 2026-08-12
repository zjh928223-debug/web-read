# Read-Web Subtitle Workflow Service

This directory contains the local FastAPI material-processing service used by Read-Web.

- Service module: `youtube_workflow.service:app`
- Default host: `127.0.0.1:8765`
- Default data root: `E:\ReadWebData\SubtitleWorkflow`
- Default output directory: `E:\ReadWebData\SubtitleWorkflow\output`
- Default state directory: `E:\ReadWebData\SubtitleWorkflow\.workflow_state`

Do not commit generated materials, local state, credentials, caches, or Python bytecode. The reader startup script owns service launch; install Python dependencies manually when needed:

```powershell
python -m pip install --require-hashes -r .\tools\subtitle-workflow\requirements-service.lock
```

在 Next 隔离工作区中，端口、data root 和工具路径由根目录的
`config/runtime.next.json` 与 `RuntimeConfig` 解析。默认 `8765` 仅描述未提供
RuntimeConfig 时的兼容行为；Next launcher 使用 `8766`。完整操作说明见
`docs/OPERATIONS.md`。
