# A1 — Electron viewing completeness (2026-08-19)

Written by Root from A1's returned report; the agent's harness blocks subagents from writing `.md`
files, so the record is transcribed here rather than lost.

## What landed

`scripts/emit-app-catalogs.mjs` (`previewPolicy` only) grew from 6 to 11 entries, ordered by
descending contribution priority so the app's ranking and the host's default agree without a second
mount: `code` (monacoEditor, editable), `video`, `image`, `audio`, `model`, `vector`, `table`,
`tree`, `text` (textEditor, editable), `virtual-text`, `hex` (hexEditor, editable). Five of those
are new. `apps/electron/test/preview-catalog.test.ts` turns "the policy names every stage
contribution" into a gate by comparing the emitted catalog against every `spec.kind === 'stage'`
manifest in `packages/ui/contributions` and `extensions/common/ui-monaco/contributions`, so a new
stage nobody wires now fails a test.

**The view picker offers every applicable stage.** `resolvePresentationPlan` keeps one stage per
`singletonGroup` — right for "what opens first", wrong for "what can this be shown as", so a PNG
offered `Image` and could never offer `Hex`. The renderer now hands `createCodecPreview` a session
without the plan, so the previewer evaluates every stage in the app policy against the descriptor's
own `dataSources`, and `preferredStage(applicable, plan.activeStage)` restores the host's choice of
default. The plan still decides what opens; it no longer decides what is offered.

**Two surfaces the generator cannot express**, composed by the app from the same kind of table
(`apps/electron/src/view-policy.ts`): the archive stage (`namespaceViewer` to browse, an entry
preview beside it, entry bytes read through the codec's own non-mutating extraction operation,
entry→path resolved by a bounded walk in `namespace-index.ts` — ≤5000 entries, depth ≤12) and the
image-edit stage.

**The image editor does not pretend to save.** It is registered as a plain stage, not `editable`,
so `createCodecPreview` never hands it the four ports; it carries `readonly`, reads out "Edits are
in memory only: this host has no save path for image bytes yet", and its Save control is disabled
with that sentence as its title. Nothing re-encodes; nothing writes.

**An inspector dock** (`operations`, `transport`, `metadata`, `properties`, `diagnostics`) beside
the editor area, following the focused tab. Mutating operations stay refused by the host's own gate:
main opens with `classes: ['read-source']`.

## Two defects the live run exposed

**No byte-carrying result could cross the Electron subject RPC.** The endpoint transfers result
`ArrayBuffer`s; Electron's `MessagePortMain.postMessage` accepts only `MessagePortMain` values in a
transfer list and rejects the rest with `Port at index 0 is not a valid port`. JSON operations
succeeded, byte ones did not — `export.raw`, archive entries, and the encoded representation behind
the image, audio, video and model stages — and the viewers degrade honestly enough that it stayed
invisible until an operations probe existed. Fixed app-side by A1, then generalised by Root in
`framePortFromMessagePort` (commit `d2ec87e`).

**The page CSP lacked two allowances `VIEWER_CSP` already carries.** `media-src` was absent, so
`default-src 'none'` refused the audio and video players; `img-src` lacked `blob:`, so the vector
stage's sanitised-SVG blob URL was refused. `apps/electron/scripts/build-app.mjs` now emits
`img-src 'self' data: blob:; media-src 'self' blob:;` and nothing else. `VIEWER_CSP` is untouched.

## The live run

`node scripts/build-app.mjs && electron electron/main.cjs --open <samples> --selftest`, on the
committed `dist-app`:

```
selftest: 18 entries in samples
selftest: sample.csv -> views [code, table, text, virtual-text, hex] mounted=true
selftest: sample.jpg -> views [image, image-edit, tree, hex] mounted=true
selftest: sample.obj -> views [code, model, tree, text, virtual-text, hex] mounted=true
selftest: sample.obj stages code=ok model=ok(degraded) tree=ok text=ok virtual-text=ok hex=ok
selftest: sample.svg -> views [code, vector, tree, text, virtual-text, hex] mounted=true
selftest: sample.webm -> views [video, tree, hex] mounted=true
selftest: sample.webm panels [operations, transport, metadata, properties, diagnostics] ... ok
selftest: sample.zip -> views [archive, tree, hex] mounted=true
selftest: 18 tabs open in 1 group(s); after split groups=2, rendered=2
selftest: save -> "SAVED BY SELFTEST"
selftest: hex ascii "i" -> "A" tabMarked=1
selftest: sample.csv operations view.inspect=ok/json asset.validate=ok/none export.raw=ok/bytes
selftest: archive entry clicked=true preview=true status="readme.txt · 45 bytes"
```

`ok` means a viewer surface mounted; `ok(degraded)` means it mounted and then said it could not
render. Neither asserts pixel-level correctness.

## Honest limits

- The WebM sample is a valid EBML/Matroska header with a VP9 track and no clusters; the MP3 is one
  real MPEG-1 Layer III frame. Both exist because the repo ships no playable media a first-party
  codec accepts.
- `sample.mp3` showed hex only, because the MP3/OGG codec manifests lacked the `full` open intent
  that `main.cjs` opens with. Root had already fixed those manifests on the branch A1 forked from.
- `model=ok(degraded)` was reported as flaky. It was not flaky: see `1214d90` — the protocol refused
  every typed array that was not a `Uint8Array`, so `ModelPrimitive.positions` (a `Float32Array`)
  could never cross. Fixed at the protocol layer, with a conformance case so every transport proves
  it.
- The picker's trait filter is implemented and unit-tested but carries no data yet: the catalog
  generator does not emit `requiresTraits`.

## Requests to Root

1. `SubjectPreviewSession.operations()` — **done**, `d2ec87e`; the app's 116-line client fork is now
   a 46-line alias.
2. Transfer-list decision inside `framePortFromMessagePort` — **done**, `d2ec87e`.
3. `full` open intent on the MP3/OGG codec manifests — **done** before this branch.
4. `scripts/emit-app-catalogs.mjs`: allow non-`stage` kinds and zero-source contributions, and emit
   `requiresTraits`. **Open.**
5. `packages/ui`: (i) a viewer contribution for `createImageEditor` — **open**; (ii) let
   `createCodecPreview` pass an `operations` port to mounted viewers — **done**; (iii)
   `fallbackStages` sets no `id`, so unclaimed files show a contract id in the picker — **done**.
6. Editing ports for the renderer — **done** for text and hex (S14 + A7); an image writer (Path B
   `common.edit/writer@1`) is still missing, so the image stage stays read-only. **Open.**
7. Model geometry unreliable over the RPC — **done**, `1214d90`, and it was impossible rather than
   unreliable.
8. `transportViewer`: `model.events(...)` is not async iterable over the RPC surface. **Open.**
