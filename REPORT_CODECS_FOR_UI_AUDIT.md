# Codecs for UI — phase A audit

Date: 2026-08-16

Verdict: `READY WITH NON-BLOCKING GAPS` — P0/P1/P2 implementation completed and verified; ranged
parser diagnostics remain an incremental codec-quality track.

## Authority and invariants

- Traits describe observed data, while editing and commands remain operations: MK3 document 02
  §2–3 and §10–12.
- Subjects expose semantic facts and logical data-source contracts but never installed viewer IDs:
  MK3 document 06 §1–2 (Q84).
- Thumbnail work has its own budget and must not activate a heavy editor runtime: document 06 §4.
- Discovery is declarative and activation occurs only after resolution and grants: document 24
  §4–8. All long operations remain budgeted and cancellable (§13).
- Unknown-format detection evidence is persistent subject data, not a transient probe message:
  document 30 §5.1.3.

## Measured codec inventory

Every reference codec also publishes `common.view/byte-range-source@1`; it is added by the shared
codec-kit. Every row currently has at least one metadata group and parameters on every declared
trait in the measured fixture.

| Codec    | Additional standard data sources | Metadata                                               | Operations                   |
| -------- | -------------------------------- | ------------------------------------------------------ | ---------------------------- |
| ZIP      | tree, namespace-entry            | ZIP directory counts and sizes                         | shared three + extract-entry |
| PNG      | tree, raster-image               | dimensions, bit depth, channels, chunks/frames         | shared three                 |
| JPEG     | tree, raster-image               | dimensions, components, JFIF/EXIF/segments             | shared three                 |
| MP3      | tree, transport, audio-media     | MPEG/ID3 stream facts                                  | shared three                 |
| Ogg      | tree, transport, audio-media     | pages, logical streams, codecs, duration               | shared three                 |
| MP4      | tree, transport, video-media     | brand, box/track counts, duration                      | shared three                 |
| WebM     | tree, transport, video-media     | doctype and track count                                | shared three                 |
| SVG      | text, tree, vector-scene         | bounds and scene-element counts                        | shared three                 |
| OBJ      | text, tree, model-scene          | geometry, groups, materials and bounds                 | shared three                 |
| glTF     | text, tree, model-scene          | scene/resource/material/animation counts               | shared three                 |
| Markdown | text, tree                       | lines, outline, links and block counts                 | shared three                 |
| RTF      | tree                             | groups, control words, flow and embedded-object counts | shared three                 |

The shared operations are `view.inspect`, `asset.validate`, and `export.raw`. ZIP additionally
declares `org.modkitx/archive-zip.extract-entry`. All are read-only in this slice.

### UI gaps found in the baseline

1. MP3, Ogg, MP4 and WebM publish `TransportSnapshot.controls: {}`. The source shape is valid at
   TypeScript level because the members are optional, but it cannot drive `TransportBar`; a
   transport source must either bind real operation IDs or be treated as metadata-only by the
   presentation resolver.
2. Probe evidence is format-specific, but `open()` does not carry it into the descriptor. All
   codecs replace it with the same synthetic `identity.detection` row
   (`structure`, `opened-and-validated`). This does not satisfy persistent detection-evidence UI.
3. Codec parsing failures are generally thrown. Successful descriptors have an empty diagnostics
   list; no reference codec currently demonstrates a structured diagnostic with a source range.
4. Metadata and trait parameters are already present for all twelve reference codecs. P1 must
   improve their semantics and conformance tests, not add duplicate generic groups.

## P0-1 reproduction

Baseline commands:

```text
pnpm build
pnpm vitest run packages/testkit/test/reference-codecs.test.ts
node examples/modkit-ui-gallery/scripts/build.mjs --serve
```

Node baseline: 21 reference-codec tests pass and all twelve codecs probe/open.

Chromium at `http://localhost:8730/` under the production CSP:

- JSON, JSONC, XML, YAML, TOML, INI, CSV and TSV all report
  `codec open failed: ModkitError: subject descriptor assembly failed validation`;
- the gallery records nine `script-src — eval` violations from `main.js`;
- a separate `style-src-elem — inline` row belongs to the gallery's intentional forbidden-style
  probe and is not part of the AJV defect;
- `?csp=eval` is only a comparison mode and is not an acceptable fix.

The call path is:

```text
codec.open
  -> codec-kit createInspectionCodec.open
  -> host assembleSubjectDescriptor
  -> sdk validateSubjectDescriptorV2
  -> validateWithSchema
  -> new Ajv().compile
  -> new Function (blocked by CSP)
```

`validateWithSchema` has four production caller families: descriptor assembly, extension manifest
normalization, contribution/spec validation, and data-source definition registration. Therefore the
fix must cover all platform schemas, not only `subject-descriptor.v2`.

## Implementation decision for P0-1

Platform-owned schemas will use build-time AJV standalone validators with a byte-drift gate. The
browser/runtime SDK must not import the AJV compiler or contain a runtime compilation fallback.

The open registry also accepts schemas not known to the platform build. Such a schema cannot be
silently compiled in a CSP browser. It must be paired with a precompiled validator bound to its
schema fingerprint, or fail closed as an unavailable schema authority. Node-only authoring tooling
may compile and emit that validator, but the compiler is not part of the browser SDK entrypoint.

This preserves the open extension model without weakening CSP or turning the SDK into a second
hand-written JSON Schema implementation.

## Implemented outcome

- P0-1: all platform schemas now have build-time AJV standalone validators keyed by canonical
  schema fingerprint. Open schemas require an explicitly bound precompiled validator and fail
  closed otherwise. `schemas:check` checks the generated registry and every validator byte.
- The production browser test opens JSON, JSONC, XML, YAML, TOML, INI, CSV and TSV under the real
  CSP and asserts that the violation list is empty. Production bundles are checked for
  `ajv/dist/2020`, `new Function` and `unsafe-eval`.
- P0-2: `common.view/relation-graph-source@1` is a **data-source contract**. glTF publishes paged
  nodes and edges, full-snapshot type counts, stable snapshot identity and visible dead edges for
  unresolved external resources. The UI adapter applies independent node/edge caps and preserves
  `complete | capped | partial` disclosure.
- P0-3: `common.view/subject-facts-source@1` is a **data-source contract**. glTF publishes file
  identity and origin, grouped facts with per-value provenance and related embedded subjects. The
  default host/UI adapter composes `CardSection[]`; the codec never names a viewer or a card
  implementation.
- P1: descriptor detection evidence now preserves the codec's measured probe fact rather than the
  synthetic `opened-and-validated` row. Audio/video transports expose real operation IDs and
  stateful handlers for play/pause, seek, rate and track selection. All twelve reference codecs are
  gated for non-empty metadata and non-empty trait parameter objects.
- Thumbnail intents for PNG, JPEG, MP4 and WebM run with a separate constrained budget. The test
  installs a decoder-start sentinel and proves zero pixel/frame decoder starts; PNG additionally
  suppresses its decoded-region capability in thumbnail sessions.
- P2: gallery and browser-e2e share manifest-oriented discovery. Contribution facts determine
  codec/provider entrypoints; a test renames the containing extension directory and proves
  resolution still succeeds.

No new presentation-preference, service-provider, operation-contract or host-facility contract was
introduced. The four transport actions are ordinary declared operations, not a new contract kind.

## Decisions applied after P0-1

- P0-2 first real relation-graph consumer: glTF.
- glTF invalid structural indices remain validation errors. A missing external buffer/image URI is
  represented by a placeholder node plus a visible `dead` edge.
- A host/UI adapter will page the source into the existing eager renderer and preserve explicit
  `complete | capped | partial` completeness. The renderer remains format-neutral.
