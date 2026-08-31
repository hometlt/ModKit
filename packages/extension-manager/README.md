# Modkit Extension Manager

This package is the neutral discovery and installation layer between Modkit hosts and extension
repositories. It does not contain a list of games and it does not give the core a dependency on any
game extension.

The manager reads three small, versioned documents:

- `modkit.workspace.json` selects sources, a profile and an optional lock file;
- `modkit.repository.json` describes the extension roots owned by one repository;
- `modkit.extensions.lock.json` pins exact versions and byte digests for repeatable loading.

The source URI is opened through `@modkitx-x3/vfs`. The Node entry registers `file:`, `memory:`,
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

`@modkitx/extension-manager/node` exports `createNodeExtensionManager({ root, catalog, ... })` for
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

## Extension and contribution subjects

`projectExtensionSubjects(...)` turns one validated extension root and its validated contribution
manifests into ordinary Modkit subjects backed by `SubjectFactsSource`. The extension card links to
every contribution card, and every contribution links back to its owner. `contractGroups` groups
contributions by the exact manifest coordinate (`contract.id@contract.major`) for application trees;
it never invents a separate codec entity. Hosts remain responsible for rendering cards and invoking
enablement actions. `extensionSubjectRecordToWire(...)` materializes one card as function-free JSON
for Webview, worker and RPC boundaries; `subjectFactsSourceFromWire(...)` restores the neutral facts
ABI after transport.

## Localization contributions

`org.modkitx/localization-contribution@1` is a data-only contribution. Its manifest points to
extension-relative JSON message catalogs and requests the message-key prefixes each catalog needs.
The manager discovers and enables the owning extension exactly like any other package; it does not
parse UI messages or execute a language module.

Applications open catalog resources through the manager's Node or browser VFS, then the host checks
artifact confinement, the recorded file SHA-256 and the raw byte limit before JSON decoding. The
application remains the authority for message-prefix grants and passes only validated, function-free
catalogs to a renderer or webview. English and Russian are embedded by the applications, so extension
storage, registry or catalog failures cannot prevent the interface from starting.
