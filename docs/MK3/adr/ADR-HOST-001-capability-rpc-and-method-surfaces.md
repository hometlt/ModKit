# ADR-HOST-001 — One execution boundary: capability-RPC over contract-owned method surfaces

Status: **Accepted** (2026-08-18, lab Root = Fable by owner decision)
Applies to: `modkitX3/packages/host` (execution, node worker backend, gate), `packages/sdk`
(contract-definition `surface`), every transport and application adapter, `packages/testkit`
Supersedes: the per-application method allowlists (`DATA_SOURCE_METHODS`/`REMOTE_VALUE_METHODS`
in the Electron main realm) as the authority for what crosses an execution boundary — they still
exist in `apps/electron/electron/main.cjs` as a temporary allowlist of the old IPC and are removed
when that IPC moves onto capability-RPC (R6, document 09 §14)

## Context

Codecs and providers had to run either fully trusted in-process or behind an application-specific
IPC that hard-coded which data-source methods may cross. Adding a data-source contract meant editing
host/app code; a worker profile existed in manifests (`worker-brokered`) without a backend, and the
resolver could not honestly offer it. Document 24 §6.1 rule 1 forbids silent profile downgrade, and
document 27 §7 forbids authored dependencies on extension entrypoints — the missing piece was one
boundary protocol whose vocabulary comes from contract definitions.

## Decision

1. Every execution boundary speaks the same capability-RPC (`x3.host/rpc` v1): envelope with
   `session`/`generation`, one reply per request, fail-closed on violations, handles with owner
   prefix and cascading release, bounded structured-clone wire values (arguments copied, results
   and events transferred), no stacks across the wire.
2. `contract-definition-spec.v1` (data-source and service arms) carries an optional `surface`
   (`methods` with kinds `value | lease | leased-value | iterable | events`, `signal`/`progress`
   placements, `arity`, `optional`, `result`/`wrapper`, `limits`; `releaseVia`; `fields`). The
   standard data-source surfaces live in `@modkitx-x3/sdk` and are pinned to the ABI interfaces at
   compile time; foreign contracts bring their surface in their definition; the host never guesses.
3. Runtime-ABI objects (codec module, codec, asset session, operation session, artifact source,
   asset namespace, asset input, diagnostic sink, contract resolver) have host-internal surfaces
   `x3.abi/*@1`, pinned to the SDK ABI; data+method hybrids cross as one handle ref with `data`.
4. `worker-brokered` on `node` is implemented as a `worker_threads` backend with a host policy
   (V8 resource limits, deadlines, grace, stdio caps — refused above hard ceilings), verified loading
   from per-file inventory digests through module hooks, and the honest SB-1 diagnostic
   `x3.host/worker-shared-process`. Bare dependencies load unverified; in-artifact escapes and
   files the inventory never listed are refused; without a digest map only the entrypoint is
   verified and its imports are `x3.host/artifact-not-pinned`.
5. Transports prove themselves with the testkit conformance kit; backends with the hostile-worker
   acceptance; both run in `pnpm test`.

## Consequences

- Adding a data-source or provider contract that must cross a boundary means adding `surface` to
  its definition — no host or application code changes.
- Codecs written for in-process use run brokered unchanged (the bundled `text-json` codec probes and
  opens in a worker with a host-resolved provider); their buffers stay usable because arguments are
  copied.
- `optional` methods are still defined on proxies (an absent implementation answers
  `x3.host/rpc-method-unavailable`) until `has[]` lands; iterables pull item by item until
  `nextBatch`.
- The worker profile is not a sandbox: reads outside the grant remain possible from worker code
  (document 24 §6.1 SB-1 row); `process-brokered`/`wasm-brokered` remain the enforceable rungs.

## Alternatives considered

- Per-transport allowlists (rejected: a second authority next to the contract definition; every
  new contract touches host/app code).
- Redefining `NamespaceEntrySource.openEntry` on the ABI to return a capability (rejected in favour
  of the `leased-value` kind — no ABI change).
- Transferring arguments for speed (rejected on evidence: it detached buffers ABI code reuses).
- `data:` evaluation of the entrypoint only (rejected: real entrypoints are multi-file; module hooks
  verify every artifact file and keep `import.meta.url` intact).
- Clamping an over-ceiling worker policy (rejected: a misconfigured root must notice).

## Evidence

- Protocol/core: `packages/host/src/execution/protocol.ts`, `endpoint.ts`, `handles.ts`,
  `surface.ts`; tests `packages/host/test/execution-endpoint.test.ts`,
  `execution-protocol.test.ts`, `execution-handles.test.ts`.
- Surfaces: `packages/sdk/src/schemas/contribution-specs.ts` (`dataSourceSurfaceV1Schema`),
  `packages/sdk/src/asset-capabilities/data-source-surfaces.ts`,
  `packages/sdk/test/schema-drift.ts`, `packages/sdk/test/data-source-surfaces.test.ts`,
  `packages/sdk/test/data-source-surfaces-types.ts`; adapter/registry
  `packages/host/src/execution/surface-adapter.ts`, `abi-surfaces.ts`,
  `packages/host/test/execution-surface-adapter.test.ts`.
- Worker backend: `packages/host/src/node/worker-backend.ts`, `worker-bootstrap.ts`,
  `packages/host/src/execution/worker-policy.ts`, `packages/host/src/security/gate.ts`
  (`fileDigests`, worker diagnostic), `packages/host/src/node/loader.ts` (per-file digests);
  tests `packages/host/test/node-worker-backend.test.ts` (real `text-json` probe and open in a
  worker).
- Acceptance: `packages/testkit/src/capability-rpc/**`, `packages/testkit/fixtures/hostile-worker/**`,
  `packages/testkit/test/capability-rpc-conformance.test.ts`, `hostile-worker.test.ts`.
- Command: `pnpm check` on 2026-08-18 — 75 test files / 625 tests, all repository gates green
  (`IMPLEMENTATION_NOTES.md`, entries NXT-105 … R3b-2).
