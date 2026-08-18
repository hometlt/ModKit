# `@modkitx-x3/testkit` — capability-RPC conformance kit and hostile-worker harness

Test infrastructure for the capability-RPC core (`@modkitx-x3/host/execution`). Dev-only closure:
nothing here is a production backend and nothing here is published.

## Conformance kit — is this transport allowed to carry the protocol?

A transport is conformant when a pair of its `FramePort`s carries frames **unchanged**: whole,
once, in order, asynchronously; structured-clone data (`bigint`, `Uint8Array`) survives; transfer
lists are honoured (or bytes are copied — the kit records which); malformed objects are delivered
as-is or refused at `post`; both endpoints reach the same lifecycle states they reach over the
reference loopback.

```ts
const report = await runFramePortConformance(identity => yourPair(identity))
expect(report.failures, describeConformanceReport(report)).toEqual([])
```

The factory returns one fresh `ConformancePair` per case and gets the `{ session, generation }`
the kit's host endpoint will use. Two modes:

- **in-process** — `worker` is present: the kit runs its own worker endpoint over the demo world
  and every one of the 25 cases, hostile raw-frame injection included;
- **host-only** — `worker` is absent and `farSide: 'demo-world'` promises the far end already runs
  a worker endpoint over `createDemoWorld()` (a real thread, an Electron utility process, a
  browser `Worker`). Cases that need local injection are reported as `skipped`.

Read the run with `describeConformanceReport(report)`: `passed` / `failures` / `skipped` plus
`observations` (`transfer: detached | copied`, `delivery`, `mode`). A hostile case that the
transport refuses to carry a raw object for is a `skip`, not a failure — a validating adapter is
acceptable, and worth knowing about.

Reference pairs to copy: `createLoopbackPair()` (in-memory, `structuredClone` + transfer),
`framePortFromMessagePort(port)` (DOM / Node / Electron `MessagePort`), `demoWorkerPair(identity)`
(host-only, over real `worker_threads`).

## Hostile-worker harness — does the supervisor survive a malicious peer?

`packages/testkit/fixtures/hostile-worker/*.mjs` are dependency-free fixtures that speak raw
frames by hand, so nothing the endpoint under attack does can "fix" them.

```ts
const s = superviseFixtureWorker('proto-pollution', { session, generation: 1, surfaces })
const end = await s.end // 'closed' | 'peer-exited' | 'violation' | 'peer-failure'
```

`superviseFixtureWorker` spawns the fixture in a real thread with the isolation options of
`THREAT_MODEL_WORKER_BOUNDARY` §2 and runs the **reference supervisor** over it: fail-closed →
terminate, exit → peer exit, deadline → cancel → grace → terminate, `release()` → terminate frame
→ grace → terminate. Everything it does is observable through `end`, `terminations`,
`endpoint.counters()` and `spawned.output`. A production supervisor owns its own policy; this is
the behaviour it has to reproduce — see `THREAT_MODEL_WORKER_BOUNDARY_2026-08-18.md` §5.1 for the
acceptance criteria the suite asserts.
