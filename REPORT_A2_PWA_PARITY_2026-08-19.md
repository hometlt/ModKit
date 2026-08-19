# A2 — PWA workbench parity (2026-08-19)

Written by Root from A2's returned report; the agent's harness blocks subagents from writing `.md`
files, so the record is transcribed here rather than lost.

## What landed

Before: `apps/web/src/shell.ts` picked one file, opened it worker-brokered and printed the raw
descriptor. After: the browser runs the workbench Electron runs — explorer tree, tabs and split
groups, a stage for every first-party viewer the ui package ships, a per-tab view picker, a
diagnostics/operations panel, and a settings surface with the six shipped themes — over the same
`createWebSubjectServices` open path, with nothing evaluating extension code on the page thread.

**`apps/web/src/files.ts`** — `createDirectoryAccess(handle)` turns a `showDirectoryPicker()` handle
into the ui package's `FileAccess`. Entry ids are paths relative to the grant, and a path is only
ever resolved through a handle the session already listed — never by re-parsing a string, so an id
cannot point outside the grant. Sizes come from `getFile()` during the listing, which is what lets
an over-large file be refused before it is read. A listing stops at 2000 entries and says so.
`createSingleFileAccess(file)` turns a picked file, a drop or a `?open=` fetch into a one-entry
folder, so every stage behaves as it does over a granted folder. `describeFileCapability` states in
one sentence which of the three shapes this browser gives the user.

**`apps/web/src/views.ts`** — fourteen stages (image, vector, model, audio + transport, video,
entries, table, tree, text, streaming text, metadata, hex, text editor, hex editor) in preference
order. Applicability is the previewer's own rule over the descriptor's `dataSources` and `traits`;
the shell never filters the list itself. The two editable stages were declared and then dropped,
because this build passed no `editorPorts` — the UI said so out loud rather than offering a save
that could not work. (A8 supersedes that; see its report.)

**`apps/web/src/inspector.ts`** — the diagnostics panel and operation toolbar are panel/toolbar
contributions, not stages, so they are mounted in the workbench panel region with the subject's real
operation session. Only non-mutating operations are offered, and the _descriptor_ is filtered rather
than the buttons, so a mutating operation is never drawn and then refused on click.

**`apps/web/src/settings.ts`** — the portable settings document in `localStorage`, written with
`serializeSettings` so the bytes match what any other host would write. Reading never throws: bad
JSON degrades to defaults plus the reason. Six themes applied live.

**Offline** — `apps/web/public/service-worker.js` gained two tiers: stable names precached with
`addAll` (a miss is a broken build), optional names added with `allSettled` (a theme that was not
built cannot fail the installation), and everything else same-origin cached on first use — which is
what makes a format the user has already opened openable again offline. Caching an extension
artifact is safe: the browser worker backend re-verifies every file's bytes against the catalog
digests before it becomes evaluable, so a cached copy is trusted no further than a fresh one.

## The real bug this uncovered

**Every structured-text codec could not open in the browser at all.** `createWebSubjectServices`
registered no service-contract definitions, so the nested provider a text codec resolves while
opening failed with `x3.host/rpc-bad-argument: resolve: arguments do not name a registered surface`
and the whole open came back `unresolved`. The PWA silently had no CSV, no TSV and no INI, since S6.
It now takes `serviceDefinitions` exactly as the Node twin does, defaulting to a bundled registry
over the attested catalog's own inventory, registered fail-closed. Proven live: `sample.csv` opens
with `org.modkitx/csv-syntax-default` activated worker-brokered beside `org.modkitx/text-csv`.

## The live run

`node apps/web/scripts/build.mjs --serve`, then `/?selftest`:

```
selftest: favicon-32.png -> views [Image, Tree, Metadata, Hex] mounted=true
selftest: sample.csv -> views [Table, Text, Text (streaming), Metadata, Hex] mounted=true
selftest: sample.ini -> views [Tree, Text, Text (streaming), Metadata, Hex] mounted=true
selftest: sample.svg -> views [Vector, Tree, Text, Text (streaming), Metadata, Hex] mounted=true
selftest: sample.zip -> views [Entries, Tree, Metadata, Hex] mounted=true
selftest: 6 tab(s) open, groups=2
selftest: settings groups=2 appearance options=8
selftest: inspector operations=3 diagnosticGroups=4
selftest: editable stages offered=false (expected false: no browser editing backend)
selftest: theme nexus-forge accent #b6f04a
```

`apps/web` went from 10 tests / 2 files to 43 / 5, all in Node against structural fakes, with the
stage policy asserted against descriptors real codecs produced through the production open path.

## Honest limits

- `showDirectoryPicker()` needs a user gesture and a permission dialog the embedded browser pane
  cannot grant, so the folder path is proven by unit tests against fake handles, not live. The
  `?open=`, drop and file-picker paths are proven live.
- Service-worker _registration_ fails inside the embedded preview pane (a known property of this
  environment, not a regression); the worker was verified statically instead, and offline behaviour
  is unverified on this branch.
- `text-json`, `text-toml`, `text-xml` and `text-yaml` still do not open in the browser: their
  parsers are not vendored for the worker. The catalog says so and the settings panel shows the
  reasons verbatim.
- `main.js` is 3.2 MB unminified — importing the ui package root pulls every viewer, and no size
  gate covers `dist-app`.

## Requests to Root

1. `PreviewStage.module` typed `ViewerModule` although an editable stage carries an `EditorModule` —
   **done**, the field is now the union and the app's casts can go.
2. The previewer mounted viewers with no operations at all — **done**, a session that can invoke now
   lends its operation session to every stage it mounts.
3. The explorer tree lost `size` when it rebuilt an entry from a node — **done**, the tree node
   carries it.
4. `createExplorer`'s file picker and drop were hard-wired to its own preview pane, so a host that
   replaced the pane saw the picker mount into a detached node and drops stop working entirely —
   **done**, both route through `onOpen`, and the drop target can be nominated.
5. The settings extensions group was unconditionally editable — **done**, `extensionsReadOnly`
   states the reason once and draws no control that would fail.
6. Entry bytes need a host-level answer: `openEntry` returns a reference and no host API reopens a
   nested source, so the only way to show an entry's bytes is a codec-specific extraction operation.
   **Open** — it wants either a standard operation id or host-side nested-source reopening.
7. A browser editing backend — **done** in `packages/host/src/browser/editing-backend.ts` (S13); A8
   wires it into the PWA.
8. Browser extension loading needs a verified install path — assigned to A9 with the trust model
   decided by Root: no signature, page-computed digests that pin bytes between read and evaluation
   (not a provenance claim), worker-only execution.
9. The `workbench.*` parts ship no layout, so every host writes its own grid. **Open** — either ship
   a default or document that the frame is host-owned.
10. Record the service-definition finding in `IMPLEMENTATION_NOTES.md`, and check whether the VS
    Code webview adapter has the same hole. **Recorded; the VS Code check is open.**
