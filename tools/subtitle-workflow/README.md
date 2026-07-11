# Read-Web Subtitle Workflow Service

This directory contains the local FastAPI material-processing service used by Read-Web.

- Service module: `youtube_workflow.service:app`
- Default host: `127.0.0.1:8765`
- Default data root: `E:\ReadWebData\SubtitleWorkflow`
- Default output directory: `E:\ReadWebData\SubtitleWorkflow\output`
- Default state directory: `E:\ReadWebData\SubtitleWorkflow\.workflow_state`

Do not commit generated materials, local state, credentials, caches, or Python bytecode. The reader startup script owns service launch; install Python dependencies manually when needed:

```powershell
python -m pip install -r E:\read-web\tools\subtitle-workflow\requirements-service.txt
```
