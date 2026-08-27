# StarCraft II game and workspace providers

Provider for `common.game/installation-discovery@1`. It verifies user-selected, platform-default
and Windows uninstall-registry candidates using the active CASC build record and the bounded
`SC2Data/config`, `SC2Data/data` and `SC2Data/indices` marker set.

This extension does not recursively scan disks, provision or launch the game, or enumerate
Steam/Epic manifests. A host resolves this service from inventory, verifies one installation and
hands the returned install path to its registered file VFS; ordinary subject resolution then
selects the CASC codec and exposes the read-only namespace. The game provider never imports CASC.

The same extension provides `common.mod/workspace-composition@1`. It consumes bounded, JSON-safe
source/root descriptors, resolves declared SC2 references by source priority, injects the engine's
Core/Liberty/Swarm/Void, campaign and multiplayer layering, and returns a deterministic immutable
workspace lock with unresolved/cycle diagnostics. `loadOrder` is dependency-first for semantic
merges; `logicalRoots` is the exact reverse, winner-first order for VFS/resolver lookup. Logical
root and dependency paths reject absolute and parent-escaping paths.

For post-open model resources, the provider also projects that exact winner-first root order into
bounded namespace prefixes below each root's `base.sc2assets`. The host's generic workspace
namespace origin consumes those prefixes and resolves exact logical resource IDs through
`ResourceSessionPort`; neither layer constructs ambient filesystem paths or lets a codec enumerate
the installation.

Content mounting, DocumentInfo decoding, persistent caches, remote depot downloads, disabled-mod
configuration and edit transactions are deliberately outside this first workspace slice.

The extension also provides `common.data/catalog-analysis@1`. It parses bounded ordered catalog
XML, applies schema-driven scalar/append/indexed patch rules, resolves parent inheritance and
returns immutable semantic entities with provenance. The bootstrap schema intentionally covers
twelve common classes only, including the schema-confirmed effect links on `CEffectSet` and
`CEffectApplyBehavior`. Its v1 service and result wire remain the legacy bounded query surface.

The additive `common.data/resolved-workspace@1` service plans catalog reads in dependency-first
`loadOrder` and localization reads in locale-priority, winner-first `logicalRoots` order. The host
executes those confined reads through a revision-pinned `ResourceSessionPort`; the provider then
publishes immutable effective definitions, explicit localization fallback/provenance and typed
incoming/outgoing relation facts as bounded leased tree, table and relation sources. Snapshot
identity hashes the actual document content and revisions, cursors are snapshot-bound, and missing
planned reads or dead references stay named diagnostics. This is a live normalized projection, not
a portable UVD artifact. Generated full-schema coverage, omitted catalog kinds and fields, tokens,
validators, locale enumeration beyond the requested bounded set, rename, writers and export remain
explicit follow-up work.

The extension also provides `common.map/semantic-analysis@1`. It opens bounded, already-extracted
placed objects, regions and an HMAP terrain summary, publishes the catalog queries required by
placed units, and binds them to resolved schema-backed entities when the matching catalog snapshot
is supplied. Container extraction, other map internals, rendering, triggers, localization, writing
and packing remain outside this slice.

Block 15 adds `common.map/resolved-workspace@1` without changing that frozen v1 semantic surface.
The provider plans confined active-root reads and the generic host resolves every byte through a
revision-pinned `ResourceSessionPort`; the result embeds the authoritative semantic snapshot plus
bounded native navigation samples and the versioned publisher contract
`org.modkitx.blizzard.starcraft2/world-scene-source@1`. Its generic structural adapter pages stable
terrain, object, region, catalog-resource and navigation identities with coordinate, unit, bounds,
LOD, provenance and loss metadata. When the caller's explicit cell/node budgets retain every HMAP
tuple, terrain is available as an exact native `height-grid` LOD; cell size, origin, vertical
quantization and the canonical transform remain unknown. It is explicitly a publisher candidate:
it is not registered as `common.view/world-scene-source@1`, is not a second eager world DTO, and
publishes no writer. Block
18 is the earliest admission boundary; if that block standardizes the common coordinate, this
publisher must adapt/dual-publish during migration rather than silently changing this contract.
