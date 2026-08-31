# Packaging the VS Code extension — a named plan for block 14

## The debt, precisely

`ext:build` produces `dist-app/` — the extension entry, the webview bundle and the worker bootstrap
— and that is everything a packaged `.vsix` would carry. It carries **no extension roots**, so
outside a checkout the host resolves its generated catalog against a directory that is not there.

Slice 13C fixed the half that was dangerous. The catalog is now committed data
(`generated/bundled-catalog.json`), the host resolves it rather than scanning, and a root that is
named and missing is reported into the Extensions view, the output channel and the extension's own
`activate()` return — the smoke's activation scenario fails on it. A packaged build that carries no
codecs can no longer look like a healthy product.

It fixed the half that was _dangerous_, not the half that is _missing_. A `.vsix` built today would
activate, say plainly that it holds none of its 18 roots, and open everything as hex.

## Why the obvious fix is not one

Copying `extensions/*` into `dist-app/extensions/` was tried in 13C and reverted in the same
slice. An extension root reaches the SDK through `node_modules/@modkitx-x3`, a pnpm workspace link;
a copy without it is a directory that satisfies `looksLikeExtensionDirectory` and cannot load. The
build that did this turned every bundled codec off — PNG, ANI and ASTC all fell back to hex — while
producing an artifact that looked complete. That is a worse failure than the one it was fixing, and
it is why the roots are named and not copied.

## Three routes, with their costs

### A. Vendor the SDK per root

Copy each root plus a real `node_modules/@modkitx-x3/{sdk,core}` into `dist-app/extensions/`.

- **Cost:** the SDK is duplicated 18 times unless the copy is deduplicated into one shared
  `node_modules` at the `extensions/` level and each root's link recreated as a junction — which is
  platform-specific behaviour inside a `.vsix`, where symlinks are not reliably preserved.
- **Size:** SDK dist is ~4.6 MB; naive duplication is ~80 MB of extension.
- **Risk:** the thing that breaks is silent (a root that fails to load), which is exactly the failure
  mode the catalog check now catches — so at least it fails loudly.
- **Verdict:** workable, ugly, and the least new machinery.

### B. Bundle each root's codecs

Run esbuild over every contribution entry the way the PWA already bundles its worker, emitting
self-contained modules with no `node_modules` at all.

- **Cost:** the contribution manifests point at source paths (`src/ani/codec.js`); bundling means
  rewriting those paths in the emitted manifests, so the build gains a manifest transform and the
  emitted catalog has to record the rewritten identity. Digests change shape.
- **Benefit:** it is what the PWA does, so the mechanism exists and is proven — `apps/web/scripts/build.mjs`
  is the template, and the worker bootstrap already loads bundled modules in this host.
- **Risk:** a bundled codec is no longer byte-identical to the checkout's, so `dist-app:check`'s
  determinism claim needs to cover the transform too.
- **Verdict:** the right long-term answer, and the most work.

### C. Ship the catalog as a separate artifact

Publish extension roots as their own installable bundle (a folder the user points `modkit.extensions`
at), leaving the `.vsix` with no bundled catalog at all.

- **Cost:** the product's out-of-the-box experience becomes "install a second thing", which is a
  product decision, not a packaging one.
- **Benefit:** no duplication, no transform, and the mechanism already exists — this is exactly what
  the smoke does today with the `ea/` roots through `modkit.extensions`.
- **Risk:** it makes the §4.2 preset question explicit rather than answering it, which may be a
  feature: `Common/Documents`, `SC2 Mod Studio` and the rest are compositions, and a catalog artifact
  per preset is a coherent shape.
- **Verdict:** cheapest, and it changes what the product _is_ — so it is the owner's call, not the
  build's.

## Recommendation

**B for the bundled `common` catalog, C for everything else.** The roots the product claims to ship
should be inside the `.vsix` and self-contained; publisher-specific catalogs are
already opt-in through a setting and match C's shape without any new mechanism. A is the fallback if
the manifest transform in B turns out to be worse than the duplication it avoids.

None of this is decided here. What block 13 leaves behind is: the composition is data, the drift is
checked, and the failure is loud.

## Related

- `generated/bundled-catalog.json` — what this build says it ships.
- `scripts/emit-vscode-catalog.mjs` — how that is derived, and the `--check` that guards it.
- `scripts/build-extension.mjs` — the comment at the copy site explaining why nothing is copied.
- `reports/vscode-smoke/receipt.json` — `activation.details.missingCatalogRoots`, empty in a checkout
  and the thing that will be non-empty in the first packaged build.
