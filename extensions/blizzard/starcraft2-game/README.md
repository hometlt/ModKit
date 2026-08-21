# StarCraft II game and workspace providers

Provider for `common.game/installation-discovery@1`. It verifies user-selected, platform-default
and Windows uninstall-registry candidates using the active CASC build record and the bounded
`SC2Data/config`, `SC2Data/data` and `SC2Data/indices` marker set.

This extension does not recursively scan disks, provision or launch the game, mount CASC content,
or enumerate Steam/Epic manifests. Automatic mounting and semantic data/map composition belong to
the following vertical-slice passes.

The same extension provides `common.mod/workspace-composition@1`. It consumes bounded, JSON-safe
source/root descriptors, resolves declared SC2 references by source priority, injects the engine's
Core/Liberty/Swarm/Void, campaign and multiplayer layering, and returns a deterministic immutable
workspace lock with unresolved/cycle diagnostics.

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
