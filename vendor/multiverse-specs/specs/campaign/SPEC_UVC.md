# SPEC — UVC: Universal Campaign 1.0

Status: **candidate**. Admission to `registered` requires one real two-mission campaign
slice (SC2) carried over and replayed. Normative artifacts:
[`schema/uvc.campaign.v1.schema.json`](schema/uvc.campaign.v1.schema.json), fixtures
under [`fixtures/`](fixtures/), executable assertions in
`../conformance/schema-assertions.json`. Design rationale (Russian):
`../../design/DRAFT_SPEC_UVC.md`.

## 1. What UVC is

A thin family: the campaign manifest inside a UVP package of `kind: campaign`. Heavy
lifting is reused — missions are map packages (UVP), progression logic is a UVS chart
at campaign scope, carried-over values are typed like UVD fields.

## 2. Model

- **Entries**: a directed graph; each entry references a map package by id and version
  range and may declare an `unlock` condition — a pure expression over carryover
  variables only (`const/var/and/or/not/cmp`; no intrinsic calls: campaign gating reads
  what missions banked, nothing else).
- **Shared layers**: packages composed into EVERY entry's run (the campaign's extra
  rules and data), with explicit order — the same discipline as UVP ranks.
- **Carryover**: the typed declaration of everything that crosses missions. Types are
  the deterministic set (`bool, i64, fixed64, strref, enum, list` thereof); world
  references cannot carry over — a mission's entities die with its world. Everything
  outside the declaration does NOT persist: the boundary is the schema, not convention.
- **Campaign chart**: an optional UVS document (by digest) driving progression at
  `campaign.*` event scope.

## 3. State

Campaign state = position in the graph + carryover values + campaign chart state.
Saved and hashed by the stage-4 rules; a mission save references the campaign state it
was launched from, so campaign replays are reproducible as a chain.
