# ModkitX3 — A‑0…A‑8, codecs, UI and application profiles completion report

Date: 2026-08-17  
Repository: `modkitX3` clean-core laboratory  
Integration commit: `5d7dd06` (`feat: integrate modular codecs ui and application profiles`)
Final UI/Electron implementation commit: `77dc5f8` (`feat(ui): add editor fallback settings and desktop shell`)
Host subject-open composition: `ad6f0cc` (`feat(host): open subjects through extension inventory`)
Product-path closure: `f510b3b` (`feat(apps): route previews through host subject sessions`)

## Verdict

**Implementation-complete and green in the laboratory; ready for owner review.** This is not a
promotion decision. Package names remain `@modkitx-x3/*`, MK2 is unchanged, and the owning
`modkitx` documentation/status register must only be advanced by a separate owner decision.

> **Correction and closure 2026-08-17 (post-report review, gap G-APP-1).** The sentence «Codecs execute in
> Node or worker realms and are not imported into renderer or webview realms» below described the
> declarative plane checked by `pnpm apps:check`, not the then-current shipping desktop shell. In the Electron
> app the composition root receives no extension inputs, `apps/electron/src/codecs.js` statically
> imports the common codecs into the renderer bundle, and `packages/ui/src/explorer/preview.ts`
> opens files by file extension without inventory, probe, resolver, lock or activation ticket. The
> A‑2/A‑3 host primitives were implemented but not yet assembled into the product open path; the
> host gate honours only `trusted-in-process`, so bundled `worker-brokered` codecs cannot be
> activated through it either. That historical gap is closed by `ad6f0cc` (host pipeline) and
> `f510b3b` (Electron composition, leased IPC, generated catalogs and architectural gates): the
> renderer imports no codec/provider implementations, trusted variants execute only in Electron
> main under explicit bundled provenance, and unknown input takes a declared Text/Hex fallback.
> Details and the deliberately deferred worker/VFS layer are recorded in `IMPLEMENTATION_NOTES.md`
> («G-APP-1»). The final repository gate passed 66 test files / 476 tests, 14 schemas, 16 UI
> manifests and all app/import/inventory/performance checks.

The completed line contains:

- the S0–S4 bootstrap proof and A‑0 governance baseline;
- the independently accepted A‑1 schema/public-ABI slice, including the closed source-span drift
  P1;
- A‑2 inventory, projection, resolution, policy lock and artifact-bound activation;
- A‑3 descriptors, read-only sessions, lifecycle, revisions and v2→v1 catalog projection;
- A‑4 authoring helpers, profiles, explain output and codec scaffold;
- A‑5 multi-family schema/ABI stress;
- A‑6 bounded standard data sources and deterministic presentation;
- A‑7 external plain-text vertical slice;
- A‑8 clean packed-consumer and host-boundary handoff;
- BRIEF‑13B/13C/13D text-data, viewer, editing and scale implementations;
- modular text, document, archive, image, audio, video, vector and model reference extensions;
- shared browser UI, component/tokens system and application composition profiles.

## A‑0…A‑8 result by slice

| Slice | Delivered result                                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A‑0   | Governance/status boundary. The lab remains non-authoritative and non-promoted.                                                                                                              |
| A‑1   | Exact public wire/schema and runtime ABI, emitted schemas, `FromSchema` drift gates, branded leaf IDs and compile/adversarial fixtures. Opus accepted the slice; P1 was closed by `286b674`. |
| A‑2   | Owner-atomic inventory, contract-owned fact/offer projection, service facets, deterministic resolver/policy lock and artifact-bound activation.                                              |
| A‑3   | Descriptor assembly, read-only asset/operation sessions, lifecycle/revision rejection states and bounded v2→v1 catalog adapter.                                                              |
| A‑4   | Authoring profiles/builders, target smoke evidence, explain output and minimal four-concept codec scaffold.                                                                                  |
| A‑5   | Eight-family portability and schema stress proving the ABI is not coupled to one format family.                                                                                              |
| A‑6   | Bounded byte/text/table sources plus presentation planning, fallback/singleton validation and session-preserving stage changes.                                                              |
| A‑7   | External `common/plain-text` extension through inventory, activation, descriptor, sources and format-neutral viewer routing.                                                                 |
| A‑8   | Clean tarball installs, host-free direct API and fail-closed/available runtime-host boundary. Success opens owner review; it does not promote automatically.                                 |

## Codec structure

The final split follows **dependency closure and capability**, not one package per extension and not
one global codec bundle:

- JSON + JSONC share `common/text-json` because they share one syntax family;
- CSV + TSV share `common/text-delimited` for the same reason;
- INI, XML, YAML and TOML are separate install units so a parser dependency is never pulled in by
  an unrelated codec;
- Markdown + RTF live in `common/documents`, separate from structured-data syntax;
- archives, images, audio, video, vector and models are independent extension families;
- every format still owns an activation entrypoint under `src/formats/<format>/codec.js`;
- package indexes and discovery metadata do not eagerly import format implementations.

`@modkitx-x3/codec-kit` contains only platform-neutral lifecycle, descriptor and generic source
adapters. Its `./text` subpath contains format-neutral text helpers. It contains no format IDs,
parser registry, renderer or heavy decoder dependency. Loading one codec therefore does not load a
sibling codec or its format-specific library.

## Reference codec coverage

| Family          | Formats                                     | Implemented level                                                                                               |
| --------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Structured text | JSON, JSONC, CSV, TSV, INI, XML, YAML, TOML | bounded detection, parsing/provider contracts, text/tree/table sources as applicable                            |
| Documents       | Markdown, RTF                               | bounded document structure and text/tree/byte facts; no fake layout engine                                      |
| Archive         | ZIP                                         | bounded central-directory validation, safe paths, stored/deflate extraction and namespace/tree source           |
| Raster          | PNG, JPEG                                   | dimensions/metadata and encoded source; PNG has bounded RGBA8 decoding for supported 8-bit non-interlaced input |
| Audio           | MP3, Ogg                                    | stream/container metadata, duration facts and encoded transport; PCM decode remains an optional provider        |
| Video           | MP4, WebM                                   | bounded container/track metadata and encoded transport; frame decode remains an optional provider               |
| Vector          | SVG                                         | bounded secure-static vector profile; active content and external content are rejected                          |
| Model           | OBJ, glTF                                   | OBJ triangle geometry and bounds; bounded glTF scene/resource metadata with unresolved companions explicit      |

The neutral raster/vector/audio/video/model source contracts let separately loaded UI modules render
or play content without importing native format parsers. Full JPEG/audio/video decoding, FFmpeg,
Basis/KTX2 and GPU model rendering remain optional provider extensions with their own dependency
closures.

## UI and application composition

The UI package provides independent image, vector, audio, video and model entrypoints alongside
text, hex, tree, table, namespace, metadata, graph, panels, editor and workbench primitives. A host
loads only the selected contribution entrypoint.

Application profiles cover:

- headless/automation and server composition;
- browser/PWA worker + renderer topology;
- Electron main/preload/renderer topology;
- VS Code extension-host/webview topology.

The shared explorer now guarantees a bounded fallback for every file: NUL-free UTF-8 receives Text
and Hex views, while arbitrary binary receives Hex. The editor area adds persistent tab mounts,
focused split groups, breadcrumbs and per-view selection without reloading an unrelated codec. A
portable settings document controls appearance and extension enablement; Electron persists it
atomically behind preload IPC and exposes native File/View actions without enabling Node in the
renderer.

`pnpm apps:check` validates sixteen extension-set/realm combinations, exact inventory isolation and
target selection. ~~Codecs execute in Node or worker realms and are not imported into renderer or
webview realms.~~ _(The original blanket claim was struck because the declarative gate did not prove
the product path. The corrected, narrower claim is now enforced: Electron codecs run in main and
the renderer bundle contains no codec/provider implementation; other realms remain governed by
their declared target and available activation adapter.)_
Electron now has a real native-menu/preload/renderer shell and reproducible app
build; independently packaged installer/process-launch E2E remains the next distribution layer,
not an A‑0…A‑8 blocker.

## Verification reproduced before this report

Full `pnpm check` passed on the integrated implementation:

- strict production/tooling typecheck and deterministic bundle build;
- universal-data performance gate:
  - CSV million-row: 226.8934 ms, 10.62 MiB heap delta, 3 materialized rows;
  - virtual 100 MiB text line: 0.2757 ms, 0.004 MiB heap delta, 65,536-byte maximum request;
  - bigint hex window: 1.5176 ms, 0.016 MiB heap delta, 4,096 bytes requested;
- ESLint with zero warnings and Prettier;
- 59 Vitest files / 445 tests passed;
- 14 emitted schemas and standalone CSP-safe validators;
- 16 UI manifests (15 viewers + one editor);
- 190 design tokens and three palettes;
- 28 standard host facilities plus one isolated legacy facility;
- sixteen application extension-set/realm cases;
- 178 files scanned by the forbidden-legacy gate.

The complete `CI=true; pnpm check` sequence passed at production commit `77dc5f8`; the report and
status edits that follow are documentation-only.

## Honest remaining boundaries

These are deliberate next-layer tasks, not hidden A‑0…A‑8 failures:

1. Owning-document promotion/status synchronization in sibling `modkitx` requires owner approval.
2. UVT/UVA/UVV/UVG wire formats are not frozen; codecs publish typed neutral sources and do not
   fabricate final universal-format bytes.
3. glTF external buffers/images and other multi-file companions require the artifact-bound host
   planner; unresolved resources stay explicit.
4. Heavy native/browser decoders and GPU renderers remain independently selectable providers.
5. VS Code and Electron installers/process-launch E2E remain distribution work; the Electron shell
   itself is implemented and its security/settings contracts are unit- and browser-tested.
6. The testkit `offersFromInventory` compatibility harness is not evidence for the A‑2
   contract-owned `spec.provides` projector; that non-claim remains explicit.

## Handoff

The laboratory is suitable for detailed owner review and a promotion decision. Promotion must
choose one authority, update the owning status/task register, and avoid a long-lived parallel ABI
between `@modkitx-x3/*` and `@modkitx/*`.
