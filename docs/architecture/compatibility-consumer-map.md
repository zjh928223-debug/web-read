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

The snapshot also contains deterministic `storeConsumers` entries for every loaded `src/stores/*.js` file and `criticalSurfaces` entries for `__state` and `bridgeToPinia`. Their reader/writer locations are sorted and exclude the defining store file, so a zero-consumer deletion decision is auditable. The current snapshot records 97 compatibility surfaces: 65 have static readers, 71 have static writers, and 72 are defined after startup. It records 17 loaded scripts, including three remaining compatibility store scripts. The negative assertions explicitly require `__uiStore`, `__transcriptStore`, `__chunkStore`, `__annotationStore`, `/src/stores/ui.js`, `/src/stores/transcript.js`, `/src/stores/chunk.js`, and `/src/stores/annotation.js` to remain absent. Startup exercised three callable facades. A targeted probe observed `bridgeToPinia` once and `window.__state` zero times for the probed interaction; this is useful prioritization evidence, not proof that either surface is globally unused.
