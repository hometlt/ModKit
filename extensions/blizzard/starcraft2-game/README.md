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
returns immutable semantic entities with provenance. The bootstrap schema intentionally covers ten
common classes only; generated full-schema coverage, tokens, localization, references, rename and
export remain explicit follow-up work.

The extension also provides `common.map/semantic-analysis@1`. It opens bounded, already-extracted
placed objects, regions and an HMAP terrain summary, publishes the catalog queries required by
placed units, and binds them to resolved schema-backed entities when the matching catalog snapshot
is supplied. Container extraction, other map internals, rendering, triggers, localization, writing
and packing remain outside this slice.
