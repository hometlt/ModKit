# SPEC — World state, saves and replays 1.0

Status: **candidate** (stage 4 of PLAN_MULTIVERSE_RU made normative; admission to
`registered` requires a kernel executing the invariants below on a composed world).
Normative artifacts: [`schema/save.envelope.v1.schema.json`](schema/save.envelope.v1.schema.json),
[`schema/replay.journal.v1.schema.json`](schema/replay.journal.v1.schema.json),
[`schema/observations.v1.schema.json`](schema/observations.v1.schema.json), fixtures
under [`fixtures/`](fixtures/), executable assertions in
`../conformance/schema-assertions.json`. Lessons of the phase-1 wasm spike
(`../../spike/wasm-kernel/REPORT.md`) are folded in as rules, not footnotes.

## 1. Three kinds of data (normative)

| Kind | Mutability | Saved | Hashed | Examples |
|---|---|---|---|---|
| Composition | immutable | by reference (`compositionHash`) | yes — run identity | resolved UVD, UVW, UVS/UVB, media |
| State | mutable | yes, fully | yes — `stateHash` per tick | entities/components, order & event queues, **players** (resources, technologies, alliances), timers, RNG streams, chart state, tick counter, **topology deltas** (connection state, created portals, destroyed terrain) |
| Derived | transient | never | never | spatial indices, path caches, render data |

A value that is not in State cannot influence a tick. A value in Derived that could is
a kernel defect, and the save/restore invariant is the test that catches it.

### Bounded sourced-stat profile (2026-09-25)

The first executable `entity.stat@1` profile reads a `fixed64` field declared by the
verified UVD kind-schema. The base field remains unchanged. Each nonzero
`entity.set-stat-modifier@1` value replaces one contribution keyed by entity, field and
stable source string; zero removes only that source. The effective value is the exact
integer sum of the base and all live contributions, range-checked once as signed Q32.32.
An invalid field/source or overflow cannot commit a partial State change. Source
identities and values are authoritative State, included in `stateHash` and the version 3
entities save section. This profile does not define duration, stacking beyond one value
per source, part slots, weapons, or game-specific modifier order.

### Quantized entity orientation profile (2026-10-01)

`entity.orientation-component@1` and `entity.set-orientation@1` use a quantized
XYZW unit quaternion relative to the entity's position space. Orientation is State,
included in entity section version 8 and StateHash, with atomic restore validation.
Its norm envelope, canonical sign, admission identity and source API are defined
once in [ADR-RUNTIME-006](../runtime/ADR-RUNTIME-006-entity-orientation.md).
Earlier binding profiles keep their original save bytes; they cannot admit these
intrinsics while omitting their State from the hash.

The executable bounded player accounts use the same State and a `players` save
section v1; exact balances, zero omission, profile-based section presence and
atomic restore rules are specified in `../runtime/SPEC_PLAYER_RESOURCES.md`.
This does not yet define native resource policy or a complete economy.

**One vocabulary.** The intrinsic table's writable state areas (`entities, orders, players,
timers, rng, scenario, space`) are the normative list; save sections are derived from it
(`space` → `space-deltas`) plus the event queue and campaign state. `defs` is composition,
never saved. A writable area without a section is a specification defect, not a kernel choice.

## 2. Save envelope

A save is a **manifest plus typed sections**, never a memory dump. The spike proved a
`memcpy` of one static block works exactly until a heap exists; this spec does not
carry that debt forward.

- The envelope names `compositionHash`, the kernel `moduleDigest`, the `tick`, the
  kernel `stateHash` at that tick, and one entry per section: subsystem id, section
  schema version, byte length, digest.
- Section payloads are separate canonical blobs (binary or canonical JSON per
  subsystem); the envelope is what the schema validates. `envelopeHash` covers the
  envelope's canonical form: SHA-256 of RFC 8785/JCS bytes with `envelopeHash` omitted.
- Sections are versioned independently so a migration touches one subsystem at a
  time; a save whose section versions the kernel cannot migrate is refused by name,
  never loaded partially.
- **Kernel layout rule** (spike finding): every `#[repr(C)]` state block the kernel
  hashes carries a compile-time size assertion; padding bytes are forbidden in hashed
  blocks. Uninitialised padding reaching a hash is a false non-determinism.

## 3. Replay journal

Replay = composition + input journal. The journal records every external input by
tick: player commands (order-like records addressed through the intrinsic vocabulary),
scenario messages, and topology mutations that came from outside the kernel. It never
records kernel outputs; those are recomputed. Optional expected checkpoints let a
replay self-verify against the original run.

### 3.1 Imported observations companion (amendment 1, 2026-09-28)

An imported replay from another engine is **not** an `uv.replay` until its
composition, kernel digest, seed and complete external input journal are known.
The `uv.observations` v1 companion records what the source actually reports,
without fabricating those values. Its `source.artifactDigest` identifies the
original native artifact; `source.game`, `format` and optional `version` state
the decoder context. `clock.domain` names the native clock. An optional positive
rational `ticksPerSecond` is a measured conversion, never an assumed simulation
tick rate. Native `tick` values are unsigned decimal integers and `sequence`
orders observations within one tick. The pair must increase strictly. A stable
`sourceEventId` cannot repeat in one bundle.

Each observation names an entity (native ID **and generation**), player or
world subject. `fields` lists exactly the known paths and values; a missing
field, subject or whole tick remains **unknown**. `null` is a recorded value,
not absence of information. `coverage: complete-subject` means complete for
the source-declared field set at that event, not for all game state. Only an
explicit `action: remove` on a specific entity generation removes it.
Presentation interpolation is Derived and cannot be inserted into this bundle
as a measured observation. The Replay adapter retains source-event provenance
and untranslatable native inputs separately; it must never convert an unknown
input into a successful intrinsic or a no-op.

`observationsDigest` is SHA-256 of RFC 8785/JCS bytes of the `observations`
array alone. The verifier checks chronology, unique IDs, entity generations,
unique field paths, no reuse of a removed generation, and this digest after
schema admission. The read-only `observedStateAt` reference projection samples
native tick/sequence without interpolation: fields carry forward with their
source event provenance until explicitly replaced or removed. This is a
portable observation view, not a Runtime correction or game-state simulation.
A reconstruction
identity must additionally commit to source artifact identity, time conversion,
composition, command journal, correction policy/version and correction stream;
`observationsDigest` alone is not a replay or simulation receipt. Checkpoints
from an assisted reconstruction assert only our kernel state, never exact state
of the foreign engine. Exact `uv.replay` v1 remains unchanged. A future
versioned reconstruction protocol will bind observations and corrections to
Runtime State/seek; the companion is the read-only imported observation input.

## 4. Invariants (executable when the kernel lands; already proven on the spike kernel)

1. **Continuity**: `N ticks` ≡ `K ticks + save + restore + (N−K) ticks` — identical
   `stateHash`.
2. **Instance isolation**: two instances of the same module with the same composition
   and journal never diverge, even with a third instance interleaved.
3. **Replay**: composition + journal reproduces every recorded checkpoint.
4. **Migration**: a save at section version v migrated to v+1 and continued matches a
   fresh run continued at v+1 from the same tick (the plan's "two test versions").
