# SPEC — UVP: Universal Package 1.0

Status: **candidate** (named by scope `runtime-interchange-v1`; admission to
`registered` requires the composition tool executing the declared vectors and one real
map package per game). Normative artifacts: [`schema/uvp.manifest.v1.schema.json`](schema/uvp.manifest.v1.schema.json)
(the schema's field descriptions are normative text), fixtures under [`fixtures/`](fixtures/),
executable assertions in `../conformance/schema-assertions.json`, declared composition
contract in `../conformance/uvp/vectors.json`. Design rationale (Russian):
`../../design/DRAFT_SPEC_UVP.md`.

## 1. What a package is

The unit of shipping and dependency. A game base, a mod, a map and a campaign entry are
one kind of object distinguished by `kind`. A shipped map is a package holding exactly
one UVW world plus whatever the map carries besides terrain — map-local UVD overlays,
UVS charts, UVB modules, media — mirroring how a real SC2Map archive and a Warzone `.wz`
actually bundle content. UVW itself stays pure world.

## 2. Composition contract (normative, executable with the composition tool)

1. Layers apply in rank order `base < official < map < mod`; inside one rank the
   explicit `order` field decides. Two same-rank dependencies without `order` refuse.
2. Dependency cycles refuse by name before any content loads.
3. Aggregated `requires` (intrinsics, capabilities) are checked against the intrinsic
   table and granted rights BEFORE content bytes load.
4. Content hashes are canonical-form hashes: directory and archive packings of the same
   content share identity. Run identity is the composition hash, not any package hash.
5. Every refusal is typed and names the package, the rule and the members involved.
6. The root joins composition at the rank of its own kind: `map` roots at `map`, `mod` roots
   at `mod`, `campaign` roots at `official` (their shared rules sit under maps and mods),
   `game-base` and `library` roots at `base`.
7. One package declared at two different orders inside one rank, or at two ranks, refuses
   (`conflicting-order`, `conflicting-rank`) — never first-wins.
8. `requires.capabilities` is checked against the classes the host/trust chain granted;
   an ungranted class refuses (`capabilities-granted`) before content loads. The kind name
   `universe` is reserved (multi-world packages) and not admitted by this version.

## 3. Trust

Package signing and digests reuse the Modkit Extension Manager chain (Ed25519 +
content digests verified before activation); this spec does not define a second trust
mechanism.
