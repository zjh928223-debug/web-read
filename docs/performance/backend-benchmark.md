# Backend HTTP Benchmark

`scripts/perf/backend-http-benchmark.py` 为 Material Workflow 的本地 HTTP 关键路径建立可重复基线。默认行为是在随机安全 loopback 端口自行启动一次性 workflow service，并将 `READ_WEB_SUBTITLE_DATA_ROOT` 指向临时目录；benchmark 结束、失败或被中断时，仅关闭自己持有的 `Popen` process，随后由 `TemporaryDirectory` 删除隔离数据。

脚本明确拒绝两组日常端口 `5173/8765`、`5174/8766` 和 optimization `5184/8776`，也不会探测、复用或终止这些服务。显式端口若已有 listener，脚本会直接失败，不会接管现有实例。

脚本会在临时目录中预置一个 `ready` 终态任务和一个 Edge TTS 缓存文件。它不会创建真实工作流任务，不会执行 yt-dlp、WhisperX、ffmpeg、Gemini 或 Edge TTS 网络请求。

## 覆盖 operations

- `GET /api/health`
- `POST /api/jobs/snapshot`（存在任务和缺失任务的批量快照）
- `GET /api/history?limit=50`
- `POST /api/reader/activity`（临时任务进度写入）
- `POST /api/jobs/{jobId}/reader-marks`（marks 原子写入）
- `GET /api/jobs/{jobId}/reader-marks`（marks 读取）
- `POST /api/tts/edge`（预置文件的确定性缓存命中，不访问上游）

所有读写都限定在临时 service state。默认先对每个 operation warmup 5 次，再对每个 operation 测量 30 次。

## 运行

```powershell
python E:\read-web-next-optimization\scripts\perf\backend-http-benchmark.py
```

小轮 smoke validation：

```powershell
python E:\read-web-next-optimization\scripts\perf\backend-http-benchmark.py --warmup 1 --rounds 3
```

可以指定其他非保留的隔离端口，以及 JSON 文件或目录：

```powershell
python E:\read-web-next-optimization\scripts\perf\backend-http-benchmark.py --port 43128 --output .\output\performance
```

默认输出到 `output/performance/backend-http-<UTC>.json`。该目录是被 Git 忽略的本机性能产物，不应提交。

## 输出

JSON 包含：

- git SHA、采集时间、Python service PID、service version 和 startup duration。
- warmup、measured rounds、timeout 与精确 method/routes。
- 每个 endpoint 和 overall 的 request/success/error 数、error rate、HTTP status counts。
- 成功请求的 p50、p95 和 max duration。
- 每轮原始 duration、status code 和脱敏后的 error category，供后续 baseline diff 使用。

`isolation.reservedRuntimePortsAccessed` 固定为空数组，`temporaryDataRoot` 固定为 `true`。结果不保存临时目录路径、response body、credentials 或环境变量值。

脚本在任何 measured request 失败时仍原子写出证据，并以 exit code 2 结束；启动或配置失败使用 exit code 1。JSON 使用同目录 temporary file、`fsync` 和 `os.replace` 发布，避免半写入结果。
