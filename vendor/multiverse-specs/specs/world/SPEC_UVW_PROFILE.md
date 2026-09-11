# SPEC — UVW profile 1.0: the space-graph envelope

Status: **profile** (succeeds the candidate as the current UVW document form; the
candidate stays valid until Modkit's UVW writer migrates in GA wave 4, then retires).
Normative artifacts: [`schema/uvw.profile.v1.schema.json`](schema/uvw.profile.v1.schema.json),
fixtures under [`fixtures/`](fixtures/) (`uvw-profile-*`), executable assertions in
`../conformance/schema-assertions.json`. Design rationale (Russian, owner-driven
stress test incl. RA1–RA3, planets, universes, Minecraft-scale portals, dynamic
topology): `../../design/DESIGN_UVW_TOPOLOGIES.md`.

## 1. The envelope

A world is a **graph of spaces**: each space carries exactly one primitive topology and
its own local coordinates; typed connections join spaces. Every current SC2/Warzone map
is the degenerate graph — one heightfield space, zero connections — and a candidate
document is exactly a profile document with its body wrapped as that single space
(mechanical migration, no data change).

## 2. What this version admits

- Topologies: `heightfield` (full body — the candidate's basis/bounds/layers,
  unchanged). `tile-grid`, `node-graph` and `volume` are reserved names: taken so the
  day a publisher lands the name is already right, refused until their amendment.
- Connections: **reserved at zero entries.** The amendment defines `portal` (point
  anchors, pass rules, affine mapping including scale — the Minecraft 1:8 case lives
  here) and `seam` (boundary gluing including self-seams for wrap/torus worlds) and
  lifts the cap when the first consumer lands. Minting connection schemas nobody
  publishes would repeat the mistake the world-interchange registry note forbids.

## 3. Semantics fixed now (so consumers build once)

1. A position is `(space, local coordinates)`; there are no global coordinates.
2. Space ids are unique; uniqueness across documents is a composition check.
3. Viewers pick the entry space by lowest id unless a package states otherwise.
4. The initial topology lives in this artifact; RUNTIME topology changes (door state,
   created portals, destructible terrain deltas) are world STATE — saved, hashed,
   replayed — never mutations of the artifact.

## 4. Migration and admission

- Wave 4 (GA): Modkit UVW writer emits profile documents; viewers consume the graph
  envelope (single-space worlds require no viewer changes beyond the wrapper).
- `world-interchange-v1` scope stays reserved; block 18 owns its admission. This
  profile does not mint the scope.
- Programme B: the tile-grid amendment (adjacency square4/square8/hex, occupancySlots)
  lands with the RA/SC1 adapters; connections amendment with the first
  multi-space consumer.
