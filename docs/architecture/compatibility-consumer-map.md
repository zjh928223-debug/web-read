# Compatibility Consumer Map

This inventory separates compatibility surfaces from browser primitives and records four kinds of evidence:

- static `window.*` readers;
- static `window.*` writers;
- globals actually defined during an isolated browser startup;
- instrumented reads/calls during that startup, plus loaded scripts and inline DOM handlers.

Generate the machine-readable report with:

```powershell
npm run verify:compatibility-consumer-map
```

The committed snapshot is `docs/architecture/compatibility-consumer-map.json`. It is deletion evidence, not permission to remove a surface by itself: a candidate still needs zero consumers plus the relevant behavior and production-startup gates.

The runtime capture uses isolated port 4195, refuses to reuse an occupied port, and terminates only the Vite process it started. It does not connect to workflow data or the daily 5173/8765 instance.
Non-loopback browser requests are fulfilled with an empty diagnostic response, so generating the map does not depend on external networks.

The current snapshot records 76 compatibility surfaces: 32 have static readers, 67 have static writers, and 69 are defined after startup. Startup exercised three callable facades. A targeted probe observed `bridgeToPinia` once and `window.__state` zero times for the probed interaction; this is useful prioritization evidence, not proof that either surface is globally unused.
