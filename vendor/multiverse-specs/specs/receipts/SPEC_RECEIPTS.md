# SPEC — Runtime receipts 1.0: Lowering, Composition, Simulation

Status: **candidate** (schemas executable via `../conformance/schema-assertions.json`;
admission to `registered` alongside the runtime-interchange-v1 scope — receipts are the
evidence that ladder climbs on). Normative artifacts:
[`schema/`](schema/) (three schemas; their field descriptions are normative),
fixtures under [`fixtures/`](fixtures/).

## 1. Why receipts are a spec

The whole programme's discipline is that claims carry proof. Three receipt kinds extend
the existing Projection/Materialization chain into the runtime plane:

| Receipt | Produced by | Proves |
|---|---|---|
| **LoweringReceipt** | a game adapter | native content became UVD/UVS/Luau→UVB with named coverage and named refusals; originals kept by digest |
| **CompositionReceipt** | the composition tool | which layers, in which order, under which requirements produced this run identity (`compositionHash`) — or which typed refusal stopped it |
| **SimulationReceipt** | the kernel/harness | a composed world ticked deterministically: checkpoint state hashes, and the save/restore invariant `N ≡ K + dump + restore + (N−K)` |

A receipt records an outcome — including a refused one. Verdicts are explicit; a
missing receipt is never evidence of anything.

## 2. Shared rules

1. **No absolute paths, no machine identity.** Sources and artifacts are named by
   algorithm-qualified digests plus logical names. A receipt that leaks `C:\...` is
   invalid by schema (the webview-receipt rule of the Modkit acceptance chain, kept).
2. Digests are `sha256:<64 hex>` over canonical forms (binary for UVB and wasm,
   canonical JSON for documents).
3. Refusals are typed `{ rule, unit, reason }` and every lowering refusal names the
   digest of the preserved original fragment — silent loss is unrepresentable.
4. Receipts chain by digest: a SimulationReceipt names its `compositionHash`; a
   CompositionReceipt names its layer content digests; a LoweringReceipt names both
   its source and its outputs. Evidence is a chain, not a pile.

## 3. Honesty notes

The simulation fixture in `fixtures/` carries the REAL values of the phase-1 wasm
spike (`../../spike/wasm-kernel/receipt.json`): actual module digest, actual checkpoint
hashes, actual save/restore outcome. Fixtures that pretend are worth less than
fixtures that happened.
