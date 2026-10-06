# Complete game-extension workflow

Use this reference for an entire game, a family of games or a missing subsystem. Apply only the
agreed scope. A game without a particular subsystem needs no placeholder module for it. The detailed
workspace handbook is `docs/MK3/GAME_EXTENSION_AGENT_GUIDE.md`; this reference remains usable without it.

## Scope and ownership

Record the supported games, editions, versions, platforms, inputs and user actions. Inspect actual
repository inventories, contribution manifests, SDK exports, implementations, tests and parity
receipts. Compare legacy behavior where applicable before deleting a path.

Use a compact coverage matrix: subsystem/format/version → existing owner and contract → missing
behavior → runtime/source support → public-route evidence → limitation. Do not equate a list of
file extensions with a complete game extension.

Create `modkit-extensions-<domain>` only if no existing repository owns the game or technology.
Several games may share a publisher/engine repository. Preserve separate game and extension IDs;
keep common engine/middleware codecs as dependency packages, with one implementation per format.
Wwise/FMOD resources reuse their middleware extensions. Installation/package semantics stay at the
game owner. Common algorithm primitives reuse codec-kit; game-specific formats stay outside Core.

Use current `modkit.repository.json`, package metadata, game subjects and contribution schemas.
Follow the existing module layout, commonly `modules/<area>/{codecs,providers,services,shared,test}`.
Do not invent `defineGameExtension` or treat a data-only pilot index as a runtime API. No empty
subsystems, extra abstraction framework or mandatory second game merely for scaffolding.

## Installation and content sources

Reuse `InstallationProbes` and `common.game/installation-discovery`. Discover installations through
the supported registry/store/known-folder probes, verify game markers and retain explicit user
selection through content sources and downstream services. Test multiple installations, relocation,
no installation and an incorrect candidate; a stored absolute path is not discovery.

Compose sources through ContentSources/VFS. Supported sources can include installation storage,
directories, archives, cache, saves, documents and online packages. Preserve physical source identity
while showing semantic package names: a cached map can display its native map name while retaining
its actual cache filename. Support reveal/open-folder where a real filesystem location exists.
Deduplicate workspace mounts. Use `storageOf`, resource lookup and the current source contracts;
do not add another store reader or filesystem facade.

Opening a file in any supported package representation must select its correct ModContext, dependency
closure and writable layer. Distinguish nested package, loose input, foreign game and missing metadata.
Report incomplete dependencies and provenance. If official content requires synthesized metadata,
expose it as virtual source content through the ordinary loader with explicit provenance; do not
rewrite user metadata or maintain a second dependency path.

Keep loaded mods at the common context/server owner until explicit unloading. Closing a document
must not erase the semantic resource tree. Reuse revisions and caches from that owner; do not implement
a per-game daemon to compensate for a missing shared lifecycle.

## Data, languages and semantic resources

Each module has one canonical model/schema: data definitions and inheritance, script syntax/API,
strings/locales, styles and templates. Resolve cross-module and cross-file references through these
owners. Preserve lexemes where native precision or expressions require them; record effective values,
origin, defaults, overrides and writable destinations. Constants and structure defaults belong to
their native data scopes, not to a global unrelated list.

Describe every supported type and field: meaning, allowed values, units, bounds, defaults, references,
editability, validation and knowledge targets. Generate structural knowledge from the schema; add
curated explanations/examples without duplicating the schema in UI, LSP, MCP or AI recipes.

Language contributions use common LSP/document-analysis and the same module specification. Verify
highlighting, dirty-document completion, hover, signatures, diagnostics, navigation, rename and
verification where applicable. For structured text, check every nesting level and native trigger
syntax, including attribute/value lists and indexed snippets. Scope suggestions by the native schema;
do not hardcode one filename as the supported case.

Resources expose effective definitions, locale/string groups, script symbols, styles/constants/font
groups, templates and other actual semantic contents per loaded mod. File entries have their own
group. Standard cards/tables show provenance, relations and typed editable fields; linked media uses
existing image/audio/model viewers. Verify is a capability-backed shared action, not an always-enabled
button. MCP, CLI, VS Code and other claimed interfaces call the same owners.

## Media, maps and conversion

Reuse media/container codecs; native models publish a common model scene and use UVM materialization.
Keep texture, bank and companion resolution in Host resources. A model codec does not decode its own
image formats. Portable export includes the admitted resource closure and explicit losses.

Map support uses current common map preview/resolved-workspace/native-encoder contracts. Cover the
game's actual terrain, materials, cliffs, water, placements, players and pathing as applicable.
Prove coordinates, scale, precision and transforms against independent native evidence, including
shared model placement. A visually plausible preview is not proof of correct world semantics.

Use pinned Multiverse profiles: UVM models, UVW worlds, UVD definitions, UVS scenarios, UVB behavior
and UVP packages have separate guarantees. Do not force unsupported worlds into a heightfield or call
a renderable export playable. Native writers preserve unknown fields/companions or refuse the lossy
operation. Reopen and verify edited native state; a universal projection alone proves no native write.

## Online and launch, when requested

Use the Host credential broker and game launch-plan owner. Declare public listing, authenticated own
content, downloading, publishing and removal independently. Login does not authorize publication or
deletion. Do not expose absent remote capabilities as working commands or put secrets in files/logs.
Check receipts before retrying an unknown mutating outcome. The game extension supplies a launch
plan and log interpretation; Host executes it.

## Completion and integration

Develop a first vertical slice before broadening the corpus: real input → correct context → standard
view → supported edit → reopen/verify. Extend it through needed sources, languages, resources, media,
maps and exports. Implement only the relevant stages of the handbook's E0–E12 roadmap.

Validate compiled entrypoints and generated manifests, deterministic dependencies/revisions, declared
runtime variants, meaningful fixture cases and discovered real-content public routes. Confirm test
tier inclusion and strict handling of missing corpus. Measure cold/warm latency and repeated opens;
share caches rather than parsing every resource for every hover or tree expansion.

For installed acceptance, verify the clean profile/bundle: choose installation, open resource,
inspect resolved context, navigate semantic resources, edit and reopen, preview a linked resource and
read back a supported export. Follow the project order for application/native acceptance. Keep
declared, implemented, exposed, installed and verified states distinct.

Give Integrator exact commits and changed IDs/API requirements, executed tests and skips, package
entrypoints, dependencies, pinned artifacts/specs, limitations and a concrete installed-test scenario.
Shared Core builds, vendor updates, acceptance snapshots, registry and release packaging remain with
their assigned owner. No automatic messaging or publication is authorized by this reference.
