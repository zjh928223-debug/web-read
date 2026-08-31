# Browser performance journeys

`scripts/perf/browser-journeys.mjs` 是统一浏览器性能采集器的第一版骨架。它不会启动或停止任何服务；调用者必须显式提供临时 fixture 或独立 Local App Host 的 `127.0.0.1` URL，且端口必须是随机 browser-safe 端口。它没有日常端口默认值。

```powershell
# 43127 仅为示例；请替换为本次临时 fixture 实际申请的随机 browser-safe 端口。
$env:READ_WEB_PERF_BASE_URL='http://127.0.0.1:43127'
$env:READ_WEB_PERF_JOURNEYS='cold-start,material-open'
node scripts/perf/browser-journeys.mjs
```

需要脚本自行启动临时 Vite fixture 时使用 `scripts/perf/run-browser-journeys.mjs`；它默认申请随机
browser-safe loopback 端口，不复用 `5173/8765`、`5174/8766` 或 optimization 的 `5184/8776`。

当前采集：

- journey 与 action duration；
- navigation timing；
- Long Task；
- console error、pageerror、unhandled rejection；
- request failure 与 HTTP 4xx/5xx；
- 失败 screenshot、Playwright trace 和 machine-readable JSON。

产物默认写入被 Git 忽略的 `output/performance/`。后续固定 fixture 会逐步增加材料打开、play/pause/seek、word/chunk 连续交互、Passage Preview 和 SRS Review；在 fixture 完成前，不把当前绝对数值当作 release gate。
