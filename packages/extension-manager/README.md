# Modkit Extension Manager

This package is the neutral discovery and installation layer between Modkit hosts and extension
repositories. It does not contain a list of games and it does not give the core a dependency on any
game extension.

The manager reads three small, versioned documents:

- `modkit.workspace.json` selects sources, a profile and an optional lock file;
- `modkit.repository.json` describes the extension roots owned by one repository;
- `modkit.extensions.lock.json` pins exact versions and byte digests for repeatable loading.

The source URI is opened through `@modkit/vfs`. The Node entry registers `file:`, `memory:`,
`http:`, `https:`, `browser-file:` and `rapid+file:`. Local `file:` extensions stay in place. Trees from
other providers and embedded bundles are copied into an immutable digest-named cache before the
host sees them. The browser entry registers the protocols a browser can actually open without a
native bridge: `memory:`, `http:`, `https:` and `browser-file:`.

## Local workspace

```json
{
  "schemaVersion": 1,
  "activeProfile": "focused-ga",
  "lockFile": "./modkit.extensions.lock.json",
  "sources": [
    {
      "id": "vendor-a",
      "uri": "./modkit-vendor-a",
      "environment": "MODKIT_VENDOR_A_ROOT"
    }
  ],
  "profiles": {
    "focused-ga": {
      "sources": ["vendor-a"],
      "extensions": ["*"]
    }
  }
}
```

Relative paths are resolved from the workspace document. An environment variable on a source is an
explicit local override. `MODKIT_EXTENSION_WORKSPACE` can point every Node host at a different
workspace document without changing source control.

Node hosts can call `discoverLocalExtensionCandidates({ workspaceRoot })` to populate an inert
local `Available` inventory. It finds the nearest parent workspace document, applies source
environment overrides and returns repository, extension and contribution metadata without loading
an extension module. Only configured `file:` repositories are inspected; network sources are
reported as skipped, and there is no sibling-directory or recursive repository scan. Contribution
inspection accepts exact manifest paths and the direct `*.json` form used by
`./contributions/*.json`, with explicit entry, per-file and total-byte limits.

## Repository and registry sources

A directory source contains `modkit.repository.json` and lists extension package roots. An HTTP,
HTTPS or browser-file source is one repository document and can carry base64 `files` for portable
installation. A static web server can therefore act as a registry API without server-side code;
the catalog format supports Ed25519 signatures and exact SHA-256 artifact integrity.

Run `pnpm exec modkit-extensions list`, `roots` or `lock`. The first two commands never change the
workspace. `lock` is the explicit operation that writes the lock file.

## Catalog client

The package root and browser entry export `parseExtensionCatalog` and
`createExtensionManagerClient`. The client depends only on four structural ports:

- `CatalogSource.cached()` is a local, inert read; only explicit `refresh()` may contact a registry;
- `ArtifactAcquirer` obtains an explicitly requested package and reports its verified digest;
- `ArtifactStore` persists a distribution package and returns every contained extension root;
- `EnablementStore` owns the package-level enabled state.

Creating the client performs no I/O. A snapshot reads cached metadata and local stores only. Remote
installation is refused unless the registry catalog signature was cryptographically verified by the
catalog adapter and the acquired artifact reports the catalog's exact SHA-256 integrity value.
For a remote catalog, artifact transport is limited to HTTP(S), the artifact must carry SHA-256
integrity, and both catalog and artifact origins must be present in the application's explicit
allowlist. Redirects are followed manually, are bounded, and every hop is checked against the same
allowlist before any request is sent. A remote catalog can never grant itself access to `file:`,
`rapid+file:`, `browser-file:`, `memory:` or UNC locations. Node, Electron, VS Code, IndexedDB and
Cache Storage implementations remain adapters; none is imported by the browser-safe client.

## Node application adapter

`@modkit/extension-manager/node` exports `createNodeExtensionManager({ root, catalog, ... })` for
VS Code and Electron. `root` is an app-owned absolute private directory; `catalog` is a local file,
`file:` URL, or HTTP(S) URL. Apps inject trusted Ed25519 public keys by catalog `keyId`.

Construction and `snapshot()` do not create files or use the network. `refresh()` is the sole
catalog fetch operation. A `local-user` repository is retained as an explicit development link,
while managed packages must be portable repository documents with embedded regular files. The
adapter writes versioned catalog, package and enablement JSON state atomically, confines managed
paths to `root`, and rejects symlinks. `installedRoots()` returns every root from enabled packages
as `{ root, expectedId }` for app-level Host composition; the manager itself has no Host dependency.
Applications compose those roots directly on startup and reload. They keep manual folders in their
own settings, but never mirror manager-owned roots or enablement into a second durable store.

## Game support plans

The client discovers a game profile from package `presentation.games` metadata; the core contains no
SC2, Warzone or other game id list. `planGameSupport(gameId)` is a read-only preview containing the
matching packages, their desired enabled state, blockers and an ordered action list. The order is
stable: new installs first, reversible enablement changes second and non-reversible package updates
last. The portable document is described by `modkit.game-support-plan.schema.json`.

After a user confirms that preview, pass the exact document to `applyGameSupport(plan)`. The client
rebuilds the plan under its mutation lock and refuses stale or edited input before writing anything.
Successful fresh installs are enabled automatically. If a later action fails, the manager removes
new packages and restores prior enablement on a best-effort basis. The result says `rolled-back` when
that compensation is complete, or `partial` when an update already replaced bytes or any rollback
step failed. Updates are deliberately reported as non-reversible because the generic artifact-store
port does not promise old-version retention.

For a game node, an application should therefore show `plan.targets`, `plan.actions` and
`plan.blocked`, ask for confirmation, then call `applyGameSupport(plan)`. A successful result still
requires the host's normal reload/composition step before newly installed extension roots execute.

## Extension and contribution subjects

`projectExtensionSubjects(...)` turns one validated extension root and its validated contribution
manifests into ordinary Modkit subjects backed by `SubjectFactsSource`. The extension card links to
every contribution card, and every contribution links back to its owner. `contractGroups` groups
contributions by the exact manifest coordinate (`contract.id@contract.major`) for application trees;
it never invents a separate codec entity. Hosts remain responsible for rendering cards and invoking
enablement actions. `extensionSubjectRecordToWire(...)` materializes one card as function-free JSON
for Webview, worker and RPC boundaries; `subjectFactsSourceFromWire(...)` restores the neutral facts
ABI after transport.

The extension card exposes an explicit `Contributions` list. Every item carries the serialized
subject id used for navigation, its `owns` relation, enablement and exact declared contract
coordinate. Contract groups remain available on the in-process projection and contract metadata is
retained on each contribution card, but the extension card does not render a separate technical
`Contracts` section by default.

## Presentation metadata

Both `modkit.extension.json` and `package.json#modkit` may carry the same optional, data-only
`presentation` block. Local discovery, registry catalogs, installed state, manager snapshots and
extension subject cards preserve this shape:

```json
{
  "presentation": {
    "displayName": "Example tools",
    "description": "Tools for Example Game modding.",
    "vendor": { "id": "example.vendor", "displayName": "Example Vendor" },
    "games": [{ "id": "example.vendor/example-game", "displayName": "Example Game" }],
    "icon": { "path": "assets/icon.png", "mediaType": "image/png" },
    "source": { "kind": "url", "url": "https://example.invalid/tools" },
    "licenseFiles": [{ "path": "LICENSE.txt", "displayName": "MIT License" }]
  }
}
```

Asset paths and a `{ "kind": "root" }` source root are portable paths relative to the extension's
VFS mount. Absolute, drive, UNC, backslash, NUL and traversal paths are refused. The URL form accepts
only absolute HTTP(S) URLs. No filesystem handle, function or live capability crosses a manager,
Webview, worker or RPC boundary.

## Vendor and game subjects

A repository may keep its human-facing vendor and game descriptions outside individual extensions:

```json
{
  "schemaVersion": 1,
  "subjects": {
    "vendors": ["subjects/vendors/example.json"],
    "games": ["subjects/games/example-game.json"]
  },
  "extensions": []
}
```

These paths are confined to the repository VFS mount. `loadRepositorySubjectProfiles(...)` reads
only the enumerated bounded JSON files; it never imports an extension module. Vendor profiles own
the public description and official site. Game profiles own modding links plus required or
recommended extension and contribution ids. `projectVendorGameSubjects(...)` joins those ids to
the ordinary extension/contribution subjects and creates navigable Vendor and Game cards without
putting any game-specific table in Core. `subjectRecordToWire(...)` transports all four subject
kinds through the same function-free Webview/RPC document.

Local applications can show these cards for both selected and merely available repositories. A
remote registry that does not distribute the profile documents must report that rich card data is
unavailable; it must not invent descriptions or requirements from a package name.

## Localization contributions

`modkit/localization-contribution@1` is a data-only contribution. Its manifest points to
extension-relative JSON message catalogs and requests the message-key prefixes each catalog needs.
The manager discovers and enables the owning extension exactly like any other package; it does not
parse UI messages or execute a language module.

Applications open catalog resources through the manager's Node or browser VFS, then the host checks
artifact confinement, the recorded file SHA-256 and the raw byte limit before JSON decoding. The
application remains the authority for message-prefix grants and passes only validated, function-free
catalogs to a renderer or webview. English and Russian are embedded by the applications, so extension
storage, registry or catalog failures cannot prevent the interface from starting.
