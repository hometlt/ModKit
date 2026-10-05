# Repository layout, ownership and capability documentation

Read this reference when creating or reorganizing an extension/codec, documenting a provider,
or extracting repeated code. Follow the workspace's actual schemas and build/packaging rules.

## Distinguish the units

- A repository is a development/distribution source. Name new sources `modkit-extensions-<domain>`.
- An extension is an explicitly registered artifact root with a stable publisher/id, a validated
  extension manifest, contribution declarations and declared dependencies.
- A codec/provider is a contribution of its owning extension, not automatically another package.
- `shared/src` is a build-time library unless it deliberately has its own extension manifest and
  repository entry. Compile its transitive runtime imports into each consuming artifact, or use an
  already owned public package. Never import a sibling artifact's private source/dist at runtime.

## Keep common mechanisms at their owners

Before extracting code, compare bodies, dependencies, callers, budgets, errors and native meaning.
Matching function names or printed bodies alone do not establish interchangeable behavior.

| Mechanism                                                        | Current public owner                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Bounded binary ranges, views, NUL names, counts/products         | `@modkit/codec-kit/binary`                                            |
| Node installation path identity and bounded candidate merging    | `@modkit/host/node`: `collectInstallationCandidates`                  |
| Ordered archive acquisition and partial-failure cleanup          | `@modkit/vfs/content-sources`: `openArchiveLayers`                    |
| Existing container-entry layer construction with failure cleanup | `@modkit/codec-kit`: `openContainerEntryLayer`                        |
| Canonical model projection and UVM export request lifecycle      | `@modkit/uv/model/materializer` and `@modkit/uv/model/export-handler` |

Game markers, product/version selection, native load order, units, transforms, material meaning and
dependency rules stay with their format/game owner. Publisher formats such as Blizzard build-info
and Unity packed vectors belong with the publisher/engine, not Core. Reuse an existing owner before
adding any helper. Preserve identities and error/budget/cancellation semantics when replacing a copy.
Adding a common export requires its consumers, package exports, worker maps and vendor compatibility
checks under the actual integration process; an unavailable API is not fixed by a private import.
Whole-document language projections (symbols, CodeLens, folding, links, colors) use Host's
bounded document result allowance; completion and search retain their smaller interactive allowance.
Prove the last entity in a real large document is reachable through the installed editor, and keep
overflow/malformed-result rejection tests. A truncated provider list is not complete coverage.
Verify stateful owner reuse through the compiled publication entrypoints in the same realm:
separately bundled copies of a WeakMap lose snapshot identity even when source tests pass.
Do not replace boundary validation with trust in caller-frozen objects or a mutable global cache.
Host context capture is published by `@modkit/host/language`. Host source consumers use relative
imports of that owner; the production bundler preserves those as package self-references outside
the language entry. Reuse the bundler's policy in graph reports, and verify native package resolution.
Build and pack from committed inputs using the repository's package manager; pnpm pack resolves
workspace dependency specifiers while npm pack may leave them in the archive. Before publishing a
vendor update, verify frozen/offline installation, the complete consumer build and installed bytes
against the candidate tarball. Preserve the dependency/lockfile pair and unrelated paused changes.
Replacing a file tarball at the same path/version can leave installed files stale even after lock
integrity changes. Re-materialize it in the isolated candidate (frozen/offline install with `--force`
when needed), rebuild, and compare installed package files with archive members before publication.
Do not treat a successful install/build or a matching lock digest alone as proof of installed bytes.
Preserve published CommonJS/UMD code when materializing a runtime closure. Minifying its identifiers
can erase the export names Node uses for native ESM imports, even when require() still works.
Minify ESM only with an explicit module suffix/package scope, including nested package boundaries.
Verify native import/behavior from the materialized artifact, not only the source checkout.
An activated language route or a successful fallback on a small fixture does not prove that its
ContentSources/dependency context loaded; inspect public diagnostics and a real installed source.

## Use simple, executable packaging

Native logic is strict TypeScript. A runtime entrypoint is compiled JS inside its own artifact.
An empty `codec.js`/`runtime.js` re-export is optional. Remove it only after callers and manifest paths
are updated; verify the full compiled import closure and declared runtime dependencies.

A `vendor/` folder is not required for every package or repository. A repository can share one root
`vendor/` and lockfile across several extension roots. Local tarballs
are the current workspace integration mechanism, not a universal runtime manifest field. Do not
copy the vendor folder into every extension. A standalone distribution must obtain/include its
actual dependency closure without relying on a parent repository or sibling checkout.
Keep currently required pinned `file:vendor/*.tgz` dependencies in Git until reproducible installation
from immutable versioned artifacts is implemented and checked. Do not pack the entire workspace/Core
to supply a single dependency. Vendored third-party sources (for example the pinned Luau VM) retain
their provenance and license requirements; they are not disposable build output.
The separate optional `presentation.vendor` identifies a product vendor; `publisher` identifies the
extension publisher. Do not invent a vendor or misattribute another studio's game for completeness.

Require emission configs inside their owning registered extension root, normally `tsconfig.build.json`
with additional native/portable profiles where needed. A root `tsconfig.json` is valid when the repository
itself is the registered extension root (`path: "."`). Keep only shared flags, editor `noEmit` checks and
orchestration in a multi-extension repository root; never inherit another extension's emission config.
JS-only roots need no empty placeholder config. Preserve inherited `rootDir`, relative include/outDir
paths, compiled entrypoints and shared-source inclusion. Compare effective TypeScript options/input
files and update build discovery, catalog generation and packaging when moving an existing config.
An independent support library may keep its own root build config; a repository name alone does not
make it a registered extension. Check its manifest and inventory before inventing an extension root.
Keep a repository Vitest config only for real root/include/setup/runtime needs; it is developer
tooling, not an extension requirement. Run existing script commands after changing its placement.

Do not add reproducible dist files, bundles, source maps or build caches to Git by default. Build them
before tests and packing; verify that standalone distributions include the complete runtime closure.
Canonical schema/data, golden fixtures, immutable migration receipts and explicitly approved checked-in
PWA assets have different owners and are not automatically disposable. Moving already pinned release
assets out of Git requires immutable storage, digest verification and reproducible hydration/builds
first. Removing a large file from the current tree does not remove it from historical Git commits.

`modkit.repository.json` currently owns the inventory of roots and vendor/game subject profiles.
Root `package.json` owns npm/build metadata; each extension's `package.json.modkit` owns its extension
envelope. Do not copy the repository inventory into a second hand-maintained block. Nested inventory
inside package.json needs explicit support across local/VFS/linked loaders and distribution tooling
before a migration; changing a filename alone does not make a nested document readable.

## Place descriptions with the owning declarations

`subjects/vendors` and `subjects/games` describe vendor/game identity and knowledge, not a second
codec/provider registry. Core derives extension/contribution cards from the validated manifests.
Use supported `displayName`, `status`, `limitations`, operation/schema documentation and the existing
knowledge-pack mechanism for users/AI. JSON cannot contain source comments.
Check the actual schema before adding fields: the current strict contribution envelope does not
admit top-level `description` even though the card projector has an optional read path for it.
A richer capability summary needs a coordinated schema/type/validator/card change, not an extra
subject file or an unvalidated manifest field.

Small contributions directories can remain flat with explicit `codec-*.json`/`provider-*.json` names.
For larger extensions group by domain/kind using the established module layout and update the
owning manifest's paths. Verify discovery, catalog generation and installed Host loading.
Current repository discovery supports exact paths, `*.json` and at most one whole-directory `*`;
do not assume recursive `**` works everywhere. Explicit manifest paths are the portable fallback.

## Mandatory source documentation

Every new or substantively changed first-party codec/provider/support source starts with a factual
capability header. Cover its full implemented surface: role and owner; formats/versions; probe,
read/inspect/resolve/edit/verify/export/write as applicable; public interfaces; context/companions;
native order/units/preservation; runtime, budgets, cancellation/disposal; limitations and refusals.
For a small helper cover its narrower surface without unrelated headings or invented capabilities.
Link the canonical manifest/schema/spec instead of copying complete field/operation lists.
State unsupported writing/export/runtime paths explicitly when readers could otherwise infer them.

Document every named function, named local function adapter and method with its role: what it
provides to the caller and why it exists. Include important invariants (source identity, bounds,
units, revisions, ownership/disposal, refusal) where they apply. A one-line role comment is enough
for a simple function. Do not narrate each statement or require boilerplate param/return sections.
Do not rewrite generated or vendored third-party sources for these comments; document their
first-party adapter and provenance. Update comments and capability declarations together when
behavior changes. Review actual implementations; a comment or declared operation is not evidence
that a codec supports native writing or a runtime variant.
