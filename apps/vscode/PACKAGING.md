# Packaging the VS Code extension

## Official command

Run the pinned local packager through the app script:

```powershell
pnpm --filter @modkit/modkit-vscode package:vsix -- --out C:\drop\modkit-vscode.vsix
```

The command refuses to overwrite an existing artifact. It builds into a new staging directory
beside the requested output, validates the candidate VSIX, and atomically renames the verified
candidate into place. A failed build or validation does not leave a partial official artifact.

## Release manifest

The workspace manifest remains `@modkit/modkit-vscode` for monorepo ownership. Packaging writes a
release-only manifest in staging with the valid extension identity `modkit.modkit-vscode`, removes
workspace dependencies and lifecycle hooks, and includes only `dist-app`, localization catalogs,
and media. `@vscode/vsce` is an exact local development dependency; no global packager is used.

The staged manifest is never edited by hand and never runs a `workspace:*` prepublish. The source
engine floor matches the VS Code API types used to compile the extension.

## Bundled Common roots

`generated/bundled-catalog.json` is the authority for the roots shipped by this app; the build and the
VSIX gate read it rather than a fixed list. Today it names nine:

- `archives`
- `audio`
- `data`
- `documents`
- `images`
- `models`
- `translation`
- `vector`
- `video`

They are copied to `dist-app/extensions/<root>`. Their shared physical runtime closure is copied to
`dist-app/extensions/node_modules`, where normal Node package lookup reaches it without a Git
checkout, pnpm workspace link, junction, or absolute repository path.

The build does not copy source `node_modules`. It resolves declared dependencies, optional
dependencies, and peers to physical packages, rejects name/version conflicts, copies workspace
packages through their production `files` whitelist, and copies already-published external package
payloads without their nested `node_modules`. At minimum the closure must contain
`@modkit/codec-kit`, `@modkit/core`, `@modkit/host`, `@modkit/sdk`, and `@modkit/vfs`.

Before a build succeeds it recursively rejects links, verifies the exact root set, and checks every
bare JavaScript import in the root/closure tree for a resolvable physical package. The final VSIX
gate checks the unscoped release identity, every catalog root manifest, and the required `@modkit`
package manifests.

## Determinism and installed acceptance

`pnpm --filter @modkit/modkit-vscode dist-app:check` compares two clean recursive builds with the
generated `dist-app`; files, directories, and bytes must match. `vsce` records ZIP timestamps, so
separately produced VSIX files are not claimed to be byte-reproducible. Acceptance records one
artifact's SHA-256 and reuses that exact file for installation and both application generations.

The permanent external acceptance is:

```powershell
pnpm --filter @modkit/modkit-vscode test:e2e:installed -- `
  --artifact-out C:\drop\modkit-vscode.vsix `
  --receipt C:\drop\installed-acceptance.json `
  --screenshot C:\drop\installed-dds.png
```

It uses isolated user/extension stores in the ordinary installed VS Code, never an Extension
Development Host. It installs the VSIX through the VS Code CLI, selects `Modkit Asset Preview`
through **Reopen Editor With**, checks the A7 runtime inventory and a non-empty DDS raster/metadata
view, fully exits VS Code, and repeats with the same profile and artifact.
