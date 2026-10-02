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
   `universe` is reserved for a later connected-world package profile. Fixed world
   instances are selected independently of package kind, as specified below.

### Portable physical packing (candidate profile 1)

A directory UVP has `uvp.manifest.json` at its root. Its single-file `.uvp` form is a ZIP
containing that same root file and the manifest's content paths, without a wrapper directory.
Dependencies remain separate UVP packages identified by the manifest, not embedded packages
with an implicit load order. UTF-8 JSON is used for the manifest; writers use canonical JCS,
while readers may accept other valid whitespace without changing semantic identity.

ZIP entry names are UTF-8, package-relative forward-slash paths accepted by the existing UVP
resource-path owner. Absolute paths, traversal, backslashes, ambiguous encoded URI segments,
duplicate names and names colliding after Unicode NFC plus case folding MUST refuse. File entries
must equal `{uvp.manifest.json} ∪ contents[].path`; directory entries are optional, cannot shadow
a file, and do not contribute to identity. The manifest must not list itself as content.
Entries use STORE or DEFLATE. Encryption, split archives and symbolic links are not admitted.
Unsupported ZIP features, malformed framing and mismatched checksums are explicit container
refusals. The host's existing archive codec owns central/local header validation, bounded
decompression, CRC and any ZIP64 support; UVP introduces no ZIP parser or second archive writer.

Archive order, timestamps, compression and directory records do not enter composition identity.
Read each content witness through the archive codec/resource session and apply the same family
hashes and verified compositor as directory content. Never hash the whole `.uvp` as its semantic
package identity or infer permissions from its filename. Readers enforce their declared entry,
compressed/decompressed byte, and total-content limits before allocation, honor cancellation,
and expose bounded virtual resources without extracting paths into the host filesystem.
This fixes the physical contract for Core's export/import; product `.uvp` I/O is not claimed
implemented by the specification tool.

### Immutable match rules (candidate runtime profile 1)

A root may select `runtimeRules: { schemaVersion: 1, worldMutation: "none" | "cell-blockers" }`.
It is a complete pre-start selection, captured immutably by the verified compositor. `none`
forbids world mutation; `cell-blockers` permits only source-keyed closures of cells already
walkable in the admitted UVW grid. Neither value admits digging, voxel edits, portals, frame
motion or geometry construction. Entity movement does not itself mutate world geometry.
Unknown versions, properties, missing members and unsupported values refuse before content
reads (`runtime-rules-invalid`); no unknown rule may be silently ignored.

Dependency packages may carry presets. If any package in the dependency closure declares
rules, the root MUST explicitly choose a complete set (`runtime-rules-root-required`). There
is no boolean union, rank-based merge or implicit dependency winner. The root can deliberately
replace a dependency preset before the match, including selecting stricter rules. A preset is
not a package compatibility requirement; executable feature requirements still need admission.
If no reachable manifest declares rules, existing bounded-profile behavior and digests remain
unchanged: cell blockers are available when the movement profile is admitted.

For a layer without rules, `contentDigest` remains SHA-256 of
`JCS({schemaVersion:1, domain:"uvp/contents", value:contents})`. A layer with rules uses
`JCS({schemaVersion:1, domain:"uvp/contents-and-runtime-rules@1", value:{contents,runtimeRules}})`.
`contents` is the verified ordered list of family/path/hash and optional layer, as in the
existing composition tool. All dependency presets therefore remain in composition identity,
even when the root selects different rules. Receipt shape and the ordered-layer hash are
unchanged; a serialized receipt alone still cannot authorize executable bindings.

Changing a rule requires a new composition and match initialization. Saves and exact replays
must keep the original composition and kernel identity. Rules are not mutable State or a new
catalog of UVD fields. The binder transports the captured policy to the authoritative kernel;
the kernel enforces it on mutation and restore. Host capabilities express trust and remain
separate: declaring a gameplay rule grants no new host right. This narrow profile is a first
execution gate, not a claim that the full universal-world contract is implemented.

### Immutable world instances (candidate profile 1)

The root may select `worldInstances: { schemaVersion: 1, instances: [...] }`.
Each instance is `{ id, packageId, path }`, where the target names exactly one
`uvw` content entry in the reachable dependency closure. IDs are unique, sorted
ASCII identifiers (`[a-z][a-z0-9-]*`, at most 48 characters); 1..64 instances and
at most 65536 qualified spaces are admitted. Paths are exact package-relative
content paths, never host URIs; empty, dot and parent segments are forbidden.
Repeated targets with different instance IDs are valid. An instance is distinct
from its immutable content identity: two uses of the same artifact have separate
entities, blockers and orders, while reusing the captured geometry document.

Dependency selections are presets, not implicit additions. If any reachable
dependency supplies one, the root must select its complete instance set explicitly
(`world-instances-root-required`). All presets are checked before artifact I/O;
malformed selections, ordering and target ambiguity refuse by name. The root
selection may omit dependency worlds; their shipped artifacts are still verified
and included in composition identity. A selected target must be a valid UVW
space-graph profile; unknown topologies/connections still refuse.

`verifiedCompositionWorldSpaces(receipt)` returns immutable entries containing
`instanceId`, source `packageId/path`, local `spaceId`, qualified `address`, and
the exact captured UVW `space` object. No second geometry model is materialized.
The qualified address is `<instanceId>/<spaceId>`, independent of array position
and source filesystem paths. It is a logical identifier, not a VFS path. UVW local
IDs, layer IDs and `surfaceLayerId` references remain unchanged. The runtime binder
qualifies both traversal and its referenced surface together. Position inputs and
script literals must use the qualified address; there is no first-world fallback
or implicit rewrite of behavior modules.

Without an explicit selection, one captured UVW retains its original bare space
IDs and existing composition hashes. Multiple captured UVWs require selection at
world binding (`world-instances-required`). An explicit single instance is still
qualified and has a different identity. The instance set is fixed before launch;
renaming, replacing a target or adding/removing an instance requires a new
composition. Saves cannot silently map an old instance to a new one.

A layer with `worldInstances` hashes
`JCS({schemaVersion:1, domain:"uvp/contents-and-world-instances@1", value:{contents,worldInstances}})`.
When rules are declared, `value.runtimeRules` contains that complete object. Layers
without selection retain the exact prior digest domains. Presets therefore remain
identity-bound even when the root chooses a different set. Receipt shape, UVW
artifact bytes, UVB `Pos`, SessionV2 and WASM ABI remain unchanged.

This first profile has fixed independent spaces with their current implicit local
frames. It does not implement frame hierarchies, shared physical embedding, multiple
supports for one movement class, portals or dynamic instance creation. `order.move`
cannot cross instances without an admitted connection. A future generation-safe
instance/explicit frame/support contract must extend this profile, not reinterpret
the old address or infer an entry floor from height.

### JSON artifact digest profile for UVD, UVW and UVS

For a `contents` entry with `family` `uvd`, `uvw` or `uvs`, its `hash` is the lowercase
`sha256:` digest of the UTF-8 RFC 8785/JCS bytes of this JSON envelope:

```text
JCS({ schemaVersion: 1, domain: "uvp/artifact/<family>@1", value: canonicalFormatDocument })
```

`<family>` is exactly `uvd`, `uvw` or `uvs`. The format owner parses source bytes with duplicate-key,
Unicode and schema checks, applies the family's canonical document ordering, and returns that
document from the same read. The compositor independently computes the digest from this document
and compares both the returned digest and manifest hash before issuing a receipt. Whitespace or
object-property order in a source file cannot change the hash; array order remains the owning
format's decision. This is an artifact digest over JCS, **not** the UV typed-form semantic digest.
For UVS, the compositor additionally checks composition-wide chart IDs and concrete variable
initializers. A verified UVS document is not proof that its reactions are executable; a foundation
session refuses it until the common scenario State and reaction profile are admitted.
Other UV families retain their own identity profiles; this clause does not redefine UVB binary
identity or media hashes.

The explicitly admitted [UVW glTF space-graph profile](../world/SPEC_UVW_GLTF.md)
uses the distinct domain `uvp/artifact/uvw-gltf@1` with the complete glTF JSON
document as `value`. The family stays `uvw`. Package-local images now follow the
closure rule below; buffers remain unadmitted. An `asset`-bearing UVW document must pass the glTF envelope check and cannot
fall back to the legacy domain. Legacy UVW bytes and their pinned hashes are unchanged;
migration creates a new composition identity and does not authorize old saves.

For `uvb`, the verified compositor requires the exact binary bytes from the same format-owner
read as its claimed digest. It decodes and re-encodes those bytes canonically, checks the module
against the intrinsic registry and granted capabilities, checks that its intrinsic requirements
are declared by the UVP manifest, and independently recomputes the UVB identity digest (excluding
the source-map section). A digest string alone is not a witness. Proposed UVB 2.0 may pass
standalone structural/static conformance but is refused by this runtime composition profile
until its VM and State encoding are admitted.
The compositor retains the verified UVB bytes under the in-process receipt identity; a serialized
copy of the receipt cannot recover or authorize them. Consumers receive copies of the bytes, so
mutating one read cannot change a later binding. A runtime binder that cannot execute the module
must refuse rather than silently omit it from the composed world.

### Verified media closure for UVW glTF

Every glTF image URI resolves relative to its world document in the same package,
using the bounded path rules in [SPEC_UVW_GLTF](../world/SPEC_UVW_GLTF.md).
The target MUST be a `media` content entry with a byte witness, not a claimed hash
alone. The compositor captures the bytes and recomputes raw SHA-256 (no domain
envelope), matching both witness and manifest digests before issuing a receipt.
Content paths within one package MUST be unique across all families.

Media is limited to 64 MiB per artifact and 256 MiB / 4096 artifacts per composition;
empty byte witnesses refuse. Each package/path is counted once even if multiple
worlds/images use it. `verifiedCompositionMedia` exposes isolated byte copies only
for receipts issued by this verifier. Legacy unrelated digest-only media retains
its existing identity, but cannot authorize UVW glTF images. Claimed image types
must agree for one target; image decoding remains with its format owner.

World JSON identity covers references; layer/composition identity covers the
referenced resource hashes through the existing ordered content list. There is no
second expected hash in the image object and no change to existing layer domains.
The verifier performs no network or filesystem reads and never searches another
package as an implicit fallback. Providers supply their witnesses through the same
artifact callback used for UVD/UVW/UVS and UVB.

### Optional verified UVM GLB witness

A `uvm` entry ending in `.uvm.glb` may supply bytes to the same artifact callback.
The compositor checks bounded GLB 2.0 framing, UVM/core markers and raw SHA-256
against the callback and manifest before retaining an isolated byte witness.
It admits at most 16 MiB per model and 128 MiB / 4096 models per composition.
`verifiedCompositionModels` exposes private byte copies to in-process consumers.
Digest-only UVM entries retain their previous manifest identity but do not prove
model contents. A UVW migration receipt with socket attachments requires verified
UVM bytes on both sides. JSON `.uvm.gltf` and other UVM profiles are outside this
byte-proof path until they have their own bounded verifier.

## 3. Trust

Package signing and digests reuse the Modkit Extension Manager chain (Ed25519 +
content digests verified before activation); this spec does not define a second trust
mechanism.
