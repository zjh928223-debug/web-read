# Backend HTTP Benchmark

`scripts/perf/backend-http-benchmark.py` 为 Material Workflow 的轻量只读 HTTP routes 建立可重复基线。默认行为是自行启动 `127.0.0.1:8766`，并将 `READ_WEB_SUBTITLE_DATA_ROOT` 指向一次性临时目录；benchmark 结束、失败或被中断时，仅关闭自己持有的 `Popen` process，随后由 `TemporaryDirectory` 删除隔离数据。

脚本明确拒绝 port 8765，也不会探测、复用或终止该日用服务。若 8766 已有 listener，脚本会直接失败，不会接管现有实例。

## 覆盖 routes

- `GET /api/health`
- `GET /api/history?limit=50`
- `GET /api/recent?limit=10`

这些请求只读取临时 service state。默认先对每个 route warmup 5 次，再对每个 route 测量 30 次。

## 运行

```powershell
python E:\read-web-next\scripts\perf\backend-http-benchmark.py
```

小轮 smoke validation：

```powershell
python E:\read-web-next\scripts\perf\backend-http-benchmark.py --warmup 1 --rounds 3
```

可以指定其他非 8765 的隔离端口，以及 JSON 文件或目录：

```powershell
python E:\read-web-next\scripts\perf\backend-http-benchmark.py --port 18766 --output E:\ReadWebData\Diagnostics
```

默认输出到 `output/performance/backend-http-<UTC>.json`。该目录是被 Git 忽略的本机性能产物，不应提交。

## 输出

JSON 包含：

- git SHA、采集时间、Python service PID、service version 和 startup duration。
- warmup、measured rounds、timeout 与精确 routes。
- 每个 endpoint 和 overall 的 request/success/error 数、error rate、HTTP status counts。
- 成功请求的 p50、p95 和 max duration。
- 每轮原始 duration、status code 和脱敏后的 error category，供后续 baseline diff 使用。

`isolation.dailyPort8765Accessed` 固定为 `false`，`temporaryDataRoot` 固定为 `true`。结果不保存临时目录路径、response body、credentials 或环境变量值。

脚本在任何 measured request 失败时仍原子写出证据，并以 exit code 2 结束；启动或配置失败使用 exit code 1。JSON 使用同目录 temporary file、`fsync` 和 `os.replace` 发布，避免半写入结果。
