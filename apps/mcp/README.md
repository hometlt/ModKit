# Modkit MCP

`@modkit/modkit-mcp` is a thin MCP v2 stdio adapter over the public Modkit host and SDK. It
opens only files under explicitly allowed roots and loads only explicitly allowed extension package
directories. It can ask those loaded extensions for verified game-installation candidates, but it
does not search arbitrary folders or extension repositories and discovery never expands the root
allowlist.

## Configuration

Build the workspace, then pass every allowed subject root and extension package explicitly. Both
options are repeatable:

```powershell
pnpm mcp:start -- `
  --root 'C:\FILES\SC2Files\Games and programs files' `
  --extension 'C:\FILES\SC2Files\coding\modkit-core\extensions\common\images' `
  --extension 'C:\extensions\publisher-one\tools' `
  --extension 'C:\extensions\publisher-two\assets'
```

Each `--extension` value names one package directory containing a `package.json` with a `modkit`
manifest. Add other required packages in the same way; naming a parent
repository does not grant every child package implicitly.

The equivalent Windows environment fallback uses semicolon-separated absolute paths:

```powershell
$env:MODKIT_MCP_ROOTS = 'C:\FILES\SC2Files\Games and programs files'
$env:MODKIT_MCP_EXTENSIONS = 'C:\extensions\common\images;C:\extensions\publisher-one\tools'
pnpm mcp:start
```

CLI values replace the corresponding environment list. Relative paths, missing lists, non-directory
paths, extension load failures, and subject paths outside the canonical allowed roots fail closed.
Do not put passwords, tokens, or other secrets in either list.

## Read-only surface

- `modkit.inventory` pages through the loaded contribution inventory.
- `modkit.capabilities` reports configured roots, loaded extensions, profiles, and adapter limits.
- `modkit.discover_installations` asks only loaded installation providers for verified candidates and
  returns opaque result locators instead of requiring path copying. `modkit.open_discovered` opens one selection
  only when its verified directory is already under a configured root; discovery never widens the
  root allowlist.
- `modkit.open_subject` opens an allowed file or directory and returns an opaque, process-local
  handle; a container with several maps also returns exact `selectionCandidates`.
- `modkit.open_selection` continues one exact candidate on the same handle, so a large CASC index
  is not opened a second time.
- `modkit.close_subject` cancels pending reads and releases a handle.
- `modkit.inspect` returns the current subject descriptor, including advertised operations.
- `modkit.list_subjects` pages publisher-parsed entities and accepts exact `kind`, exact `type`, and
  case-insensitive `text` filters; cursors are bound to the same handle, snapshot, and filters.
- `modkit.search_subjects` performs an exact `subjectId` and/or label match inside that same
  publisher-owned catalog. Results carry an explicit `{ handle, subjectId }` locator and
  `{ namespace, entityId }` coordinate. Files, models, maps, and scripts are searchable only when
  their provider publishes them as selectable subjects with an exact kind/type; the adapter never
  walks a package or game installation to invent missing entries.
- `modkit.select_subject` opens facts and calculations for one exact listed `subjectId` under a new
  child handle, and `modkit.close_selected_subject` releases all three retained source leases.
- `modkit.subject_facts` returns bounded card-like facts and relations for either an opened subject
  or a selected child entity.
- `modkit.relation_graph` returns bounded graph summaries, pages, or depth-limited chains from
  explicit root IDs; incomplete source scans and result caps are always disclosed.
- `modkit.subject_calculations` returns bounded formulas, inputs, values, and warnings.
- `modkit.invoke_readonly` invokes an exact operation ID only when the current descriptor marks it
  available and `mutatesSource: false`.
- `modkit.knowledge_search` searches the single inventory-backed knowledge catalog.
- `modkit.knowledge_resolve` resolves knowledge for one exact target and locale order.

Inventory and capabilities also have static resources. Stable resource templates cover subject
inspect/facts, relation-graph summaries, bounded formula pages, and provider-published preview
locators:

```text
modkit://subject/{handle}/inspect
modkit://subject/{handle}/facts
modkit://subject/{handle}/graph
modkit://subject/{handle}/formulas
modkit://subject/{handle}/preview
```

Exact knowledge and schema-field resources use a base64url-encoded JSON `KnowledgeTarget` followed
by one locale: `modkit://knowledge/{target}/{locale}` and
`modkit://schema/{fieldTarget}/{locale}`. The schema route accepts only a field target containing
its schema contract, major, revision, type, and canonical path. Library clients can use
`encodeKnowledgeResourceTarget` to obtain the canonical process-independent target segment. These
routes expose existing host knowledge; they do not synthesize a schema or preview when a provider
did not publish one.

Responses carry an explicit snapshot, completeness, diagnostics, provenance, and bounded data.
Handles and cursors are opaque and scoped to the running server.

SC2 installation directories are opened through the ordinary VFS and CASC codec. After an exact
map candidate is selected, the host performs bounded `DocumentInfo` reads itself and gives the game
provider only JSON-safe text; direct and transitive SC2Mod/SC2Campaign dependencies are composed
without lending namespace or extraction authority across the worker boundary. Each metadata read
is at most 1 MiB, one round is at most 4 MiB and eight rounds are admitted. Worker calls are bounded
to 120 seconds, 2 GiB old-generation memory, 256 MiB young-generation memory, 64 MiB protocol
transfer, and four million protocol nodes; these limits admit the installed SC2 catalog while still
failing closed on oversized frames.

All file text, extension metadata, operation output, progress messages, and knowledge text are
returned as `untrusted-data`; clients must never treat them as instructions. The host is created with
inspection intent and no writable roots. The adapter exposes no save, write,
arbitrary-filesystem-discovery, or mutation tool. A mutating, unavailable, or undeclared operation
is rejected before its session handler runs.
Closing a selected entity waits at most one second for cancelled reads; a non-cooperative source is
released with `x3.mcp/close-deadline` and `completeness: capped` instead of hanging the server.
