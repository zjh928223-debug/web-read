# Compatibility Consumer Map

This inventory separates compatibility surfaces from browser primitives and records four kinds of evidence:

- static global compatibility readers (`window.*` plus injected `globalObject`/`windowObject`/`getWindow()` aliases);
- static global compatibility writers;
- globals actually defined during an isolated browser startup;
- instrumented reads/calls during that startup, plus loaded scripts and inline DOM handlers.

Verify the committed canonical snapshot with:

```powershell
npm run verify:compatibility-consumer-map
```

The normal verify command is read-only with respect to tracked files. It writes the runtime capture to the ignored `output/architecture/compatibility-consumer-map.runtime.json`, canonicalizes the environment-specific port to `0`, and coalesces timing-sensitive startup getter reads to an observed/not-observed value in the tracked snapshot. The runtime report keeps the exact counters. The canonical result is then compared byte-for-byte with `docs/architecture/compatibility-consumer-map.json`. To intentionally refresh the tracked snapshot, use the explicit update command:

```powershell
npm run update:compatibility-consumer-map
```

The committed snapshot is deletion evidence, not permission to remove a surface by itself: a candidate still needs zero consumers plus the relevant behavior and production-startup gates.

The runtime capture uses a fresh random loopback port unless `READ_WEB_COMPAT_MAP_PORT` is explicitly set, refuses to reuse an occupied port, and terminates only the Vite process it started. It does not connect to workflow data or the legacy/current daily 5173/8765 or 5174/8766 instances.
Non-loopback browser requests are fulfilled with an empty diagnostic response, so generating the map does not depend on external networks.

The snapshot contains deterministic `storeConsumers` entries for loaded `src/stores/*.js` files and global `criticalSurfaces` entries for `__state` and `bridgeToPinia`. The current capture records 85 compatibility surfaces: 56 have static readers, 60 have static writers, and 32 are defined after startup. It records 12 loaded scripts and no loaded compatibility store scripts (`storeConsumers` is empty). Startup exercised 0 callable facades; inline DOM handlers number 0.

The negative assertions require `__uiStore`, `__transcriptStore`, `__chunkStore`, `__annotationStore`, `__themeStore`, `__audioStore`, `__marksStore`, `__piniaStores`, `__state`, and `bridgeToPinia`, together with the seven former `/src/stores/*.js` scripts, to remain absent. The current map also contains no `__clozeState`, `__glassEffects`, or `__legacyControlBindings` publication. Glass initialization and automatic legacy control binding remain through their modules.

Both global critical surfaces have empty static reader/writer lists, and the targeted probes observed `window.__state` and `window.bridgeToPinia` zero times. These are retired global publications; the current `runtimeState` and `bridgeToPinia` module interfaces still serve the reader runtime. This isolated startup capture is compatibility evidence, not proof of real Host, media, or complete user journeys.


N1（2026-10-04）仅更新 vocabulary-preview-module 的 controller publication / generated-items reader 行号。扫描结果写入已退休，整理的 bundle/result-store 读者与 controller 生命周期仍保留；独立审核 NOT_RUN。


### N1 独立收口（2026-10-04）

**N1 独立 PASS，限于方案预先重定后的验收范围，现已收口。** 独立审核未发现阻断收口的 P0–P2 问题，见[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-n1-independent-review-20261004/review.md)。最后 completion 补测已闭合精简完成、进度保存及关闭重开读取；原失败尝试保留。原手工文件 UI 旅程仍为 NOT_RUN，dictionary:test 整入口仍为既有 FAIL，按重定范围保留另案；本审核未重跑业务测试。此前执行/补充段落是各阶段历史记录，不再代表当前 N1 状态。

R5 旧扫描/双入口扫描子范围标为“因功能退休取消”，不是 R5 PASS；R5 保留本文整理职责的方案仍须定稿及明确调度，尚未启动。R5 opening 应以 N1 本次收口后的当前源码及 closing 身份为基线，见 C:/Users/0/AppData/Local/Temp/reader-n1-closeout-20261004-e83a5c18/closing-manifest.json，不以 HEAD 或清退前源码代替。未更改 R9、全仓 Last verified 或推广状态。
