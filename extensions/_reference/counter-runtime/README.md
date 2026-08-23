# Counter runtime

Reference implementation of `common.runtime/provider@1`, consumed only by
`packages/host/test/runtime.test.ts`.

Reference provider for `common.runtime/provider@1`. It creates leased
`common.runtime/session@1` counter sessions and demonstrates three numeric resource ceilings:
wall time per execution, cumulative ticks, and cumulative retained memory.

`counter.advance` accepts one integer argument. Its required `resources` reservation is admitted
before the counter changes; over-budget executions return a structured `refused` result containing
the exact reason, limit, and requested value.
