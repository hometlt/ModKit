# SPEC — UVS: Universal Scenarios 1.0

Status: **candidate**. Admission to `registered` requires the composition verifier and
kernel executing `../conformance/uvs-uvb/vectors.json`, plus one real SC2 trigger set
and one real Warzone scenario lowered and replayed. Normative artifacts:
[`schema/uvs.document.v1.schema.json`](schema/uvs.document.v1.schema.json), fixtures under
[`fixtures/`](fixtures/), executable assertions in `../conformance/schema-assertions.json`.
Design rationale (Russian): `../../design/DRAFT_SPEC_UVS.md`.

## 1. What UVS is

The reactive plane: flat automata of `event → pure condition → bounded actions`.
Sources: SC2 GUI triggers, Warzone events, native Multiverse authoring. Chart state
(current state, variables, armed timers, unfinished reactions) is world state — saved,
hashed, replayed.

## 2. Semantics (normative)

1. Events come from the engine vocabulary registered with the intrinsic table; unknown
   ids refuse at composition.
2. Conditions are pure: only read-class intrinsics; the verifier proves it against the
   table. Delay is a timer plus a `timer.fired` handler — waits do not exist inside
   expressions.
3. An action is an intrinsic call (1:1 with the table), a shipped-UVB function call, or
   a chart variable write. Reaction budgets are enforced per tick; exhaustion is a
   typed scenario error naming the chart.
4. Firing order on one event is `(composition rank, chart name)` — fixed here, never by
   the implementation. Save/restore between two reactions of one event preserves the
   remainder queue and the final state hash.
5. A non-portable source construct is a `refusal` action carrying the original fragment
   and a reason. Silent loss is forbidden; a refusal without its original is invalid at
   the schema.
6. A chart-local variable has the composition-wide ID `namespace/chart/variable`, using
   the names already declared in UVS. Two documents declaring the same `namespace/chart`
   refuse at composition, even when their local variables differ; a layer does not silently
   replace a chart. `scenario.var/set-var` take this qualified ID. The verified composition
   binds the declared concrete type and initializer, not an inferred host-language type.
   UVS 1.0 initializers are bool, exact-decimal i64/fixed64, bounded UTF-8 strref or
   nonzero exact-decimal `ref<refKind>`; list and nominal record variables require a
   versioned UVS amendment. Until chart state/reactions run in the common kernel, a
   foundation session containing UVS refuses before provider-open.
