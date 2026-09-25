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

Dependency-aware language sessions may use one trusted host content provider. Supply its existing
configuration and a private storage directory together:

```powershell
pnpm mcp:start -- `
  --root 'C:\workspace' `
  --extension 'C:\extensions\language' `
  --content-source-config 'C:\modkit\provider.json' `
  --content-source-storage 'C:\modkit\content-state'
```

The equivalent environment variables are `MODKIT_MCP_CONTENT_SOURCE_CONFIG` and
`MODKIT_MCP_CONTENT_SOURCE_STORAGE`. Provider module paths and credentials stay in the host.

A provider that implements `openModContext()` opens a session's subject inside the content it
depends on — its game's mods, and roots the game loads with every subject such as StarCraft II
Editor wizard folders. Those layers join the session as read-only `content-source://` documents;
they never make a partial workspace complete.

## Read-only surface

- `modkit.inventory` pages through the loaded contribution inventory.
- `modkit.capabilities` reports configured roots, loaded extensions, profiles, and adapter limits.
- `modkit.language` runs analysis, completion, hover, signature help, definitions, references,
  rename preparation, formatting, colors, symbols, diagnostics, and read-only rename proposals over
  at most 32 explicitly listed files. Each file is confined to the configured roots, each file is
  limited to 4 MiB, and the combined text is limited to 16 MiB. The host marks this explicit list as
  an incomplete workspace and rejects rename edits that would claim complete project coverage.
- `modkit.language_session_open`, `modkit.language_session_update`,
  `modkit.language_session_feature`, and `modkit.language_session_close` retain a bounded
  `LanguageWorkspace` and exact overlay revisions in the host. Open accepts rooted files and
  `modkit-source:`, `modkit-container:`, `content-source:`, or `untitled:` virtual documents.
  Passing `dependencySubjectHandle` opens that subject's mod context through the provider and
  projects its loose/MPQ/CASC layers as read-only `content-source://` workspace documents. Without
  one, the first document is the subject; a virtual document opens as a file not yet saved into
  the first root (that root's mod, else the base mods). Missing or partial closure is reported through
  diagnostics and completeness. Each opened document reports the exact activated `features`;
  `analyze`, `semantic-tokens`, `diagnostics`, and `document-symbols` are the baseline analysis
  surface, while optional provider methods are listed only when present.
- `modkit.discover_installations` asks only loaded installation providers for verified candidates and
  returns opaque result locators instead of requiring path copying. `modkit.open_discovered` opens one selection
  only when its verified directory is already under a configured root; discovery never widens the
  root allowlist.
- `modkit.open_subject` opens an allowed file or directory and returns an opaque, process-local
  handle; a container with several maps also returns exact `selectionCandidates`.
- `modkit.open_selection` continues one exact candidate on the same handle, so a large CASC index
  is not opened a second time.
- `modkit.close_subject` cancels pending reads and releases a handle.
- `modkit.mod_context` opens the subject's mod context through the configured content provider
  (the game's one mod loader): its layers in load order — dependencies first, the subject last —
  with source, role, provenance and content fingerprint, and the declared packages no source holds
  (`completeness: partial`). A file in no package opens inside the base mods (`--base-mod`).
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
- `modkit.world_scene` reads the map world a subject publishes: `info` (coordinate spaces, facet
  layers, and `edit` — the operation and object edit kind that `modkit.propose_edit` takes to move
  an object) or one bounded page of the `layers`, `objects` or `regions` facet of a `layerId` from
  `info.facets`. Objects carry a stable `id` and the `objectId` an edit names.
- `modkit.invoke_readonly` invokes an exact operation ID only when the current descriptor marks it
  available and `mutatesSource: false`. A byte output whose signature is an image (PNG, JPEG, GIF,
  WebP, at most 4 MiB) also comes back as an MCP image block. `render: "image"` draws a
  `map.layer-read` grid as a grey PNG, black to white over its lowest to highest sample; that range
  is in `data.render`, the numbers stay in the JSON.
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

## Map layers

A map codec of any game publishes `map.layers`, `map.layer-read` and `map.layer-write`; the
subject descriptor carries each operation's input schema from `@modkit/sdk/maps`. A layer names its
size, integer sample bounds, whether it is editable, and what a sample means in the world
(`valueOffset + sample * valueScale`, in `unit`, at grid vertices or in cells). Rows are
row-major with row 0 at the north edge. JSON arrays in a response are capped at 200 items, so read
and write a window (`x`, `y`, `width`, `height`) rather than a whole layer; `render: "image"` on a
whole-layer read shows all of it. A write is proposed with `modkit.propose_edit` on
`map.layer-write` and applied only by `modkit.prepare_edit` and `modkit.commit_edit`; a plan made
against an older revision is refused at prepare, and `modkit.undo_edit` restores the prior bytes.

Committing needs `--allow-edits`. It also needs a fidelity proof for the codec's writer, and the
host accepts a codec's own proof only from an extension it trusts: an extension root added with
`--extension` loads as installed and its self-declared proof does not count, so a map write is
refused as `fidelity-unproven`. To write SC2 or Warzone maps, name the game extension root and add
`--trust-extensions`, which loads the roots as bundled; that is an explicit decision to run and
trust that code.

SC2 installation directories are opened through the ordinary VFS and CASC codec. After an exact
map candidate is selected, the host performs bounded `DocumentInfo` reads itself and gives the game
provider only JSON-safe text; direct and transitive SC2Mod/SC2Campaign dependencies are composed
without lending namespace or extraction authority across the worker boundary. Each metadata read
is at most 1 MiB, one round is at most 4 MiB and eight rounds are admitted. Worker calls are bounded
to 120 seconds, 2 GiB old-generation memory, 256 MiB young-generation memory, 64 MiB protocol
transfer, and four million protocol nodes; these limits admit the installed SC2 catalog while still
failing closed on oversized frames.

All file text, extension metadata, operation output, progress messages, and knowledge text are
returned as `untrusted-data`; clients must never treat them as instructions. The host is created
with inspection intent. Edit plans are inert unless startup policy explicitly enables
prepare/commit/undo/redo within configured roots. An unavailable or undeclared operation is
rejected before its session handler runs.
Closing a selected entity waits at most one second for cancelled reads; a non-cooperative source is
released with `x3.mcp/close-deadline` and `completeness: capped` instead of hanging the server.
