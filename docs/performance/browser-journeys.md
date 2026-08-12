# Browser performance journeys

`scripts/perf/browser-journeys.mjs` 是统一浏览器性能采集器的第一版骨架。它不会启动或停止任何服务；调用者必须显式提供隔离的 next URL，默认是 `http://127.0.0.1:5174`。

```powershell
$env:READ_WEB_PERF_BASE_URL='http://127.0.0.1:5174'
$env:READ_WEB_PERF_JOURNEYS='startup,panel-open'
node scripts/perf/browser-journeys.mjs
```

当前采集：

- journey 与 action duration；
- navigation timing；
- Long Task；
- console error、pageerror、unhandled rejection；
- request failure 与 HTTP 4xx/5xx；
- 失败 screenshot、Playwright trace 和 machine-readable JSON。

产物默认写入被 Git 忽略的 `output/performance/`。后续固定 fixture 会逐步增加材料打开、play/pause/seek、word/chunk 连续交互、Passage Preview 和 SRS Review；在 fixture 完成前，不把当前绝对数值当作 release gate。
