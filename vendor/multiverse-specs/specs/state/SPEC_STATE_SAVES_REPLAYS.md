# SPEC — World state, saves and replays 1.0

Status: **candidate** (stage 4 of PLAN_MULTIVERSE_RU made normative; admission to
`registered` requires a kernel executing the invariants below on a composed world).
Normative artifacts: [`schema/save.envelope.v1.schema.json`](schema/save.envelope.v1.schema.json),
[`schema/replay.journal.v1.schema.json`](schema/replay.journal.v1.schema.json), fixtures
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
  envelope's canonical form.
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

## 4. Invariants (executable when the kernel lands; already proven on the spike kernel)

1. **Continuity**: `N ticks` ≡ `K ticks + save + restore + (N−K) ticks` — identical
   `stateHash`.
2. **Instance isolation**: two instances of the same module with the same composition
   and journal never diverge, even with a third instance interleaved.
3. **Replay**: composition + journal reproduces every recorded checkpoint.
4. **Migration**: a save at section version v migrated to v+1 and continued matches a
   fresh run continued at v+1 from the same tick (the plan's "two test versions").
