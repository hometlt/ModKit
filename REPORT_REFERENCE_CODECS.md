# MK3 Assets Capabilities and reference codec report

Date: 2026-08-16

Status: implementation complete; full repository gate green

## Result

The codec layer is no longer one extension and no viewer needs to recognize PNG, MP3, OBJ, or any
other native format. The implementation has three explicit planes:

1. a native codec parses and validates its own format;
2. it publishes presentation-neutral Assets Capabilities and leased data sources;
3. a separately loaded viewer consumes a logical source, while optional decoder/renderer providers
   can add expensive functionality.

Native source bytes and provenance remain authoritative. UVG/UVA/UVV/UVT/UVM are serialization,
interchange and cache targets; opening a file does not require an eager conversion to a second full
copy.

## Assets Capabilities added

The SDK standard registry now contains eleven data-source contracts. The six existing text/tree/
table/bytes/transport/namespace contracts remain unchanged; five media contracts were added:

| Contract                            | Purpose                                                       | Bounded/lazy boundary                        |
| ----------------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `common.view/raster-image-source@1` | image facts, encoded representation, optional decoded regions | region coordinates, pixel format, `maxBytes` |
| `common.view/vector-scene-source@1` | static vector facts and isolated UVG-compatible SVG document  | document byte ceiling in viewer              |
| `common.view/audio-media-source@1`  | tracks, duration, encoded stream, optional PCM                | frame range and `maxBytes` for PCM           |
| `common.view/video-media-source@1`  | tracks, duration, encoded container, optional decoded frame   | timestamp, format and `maxBytes`             |
| `common.view/model-scene-source@1`  | paged nodes/meshes and optional decoded primitives            | pages and primitive `maxBytes`               |

`StandardTraitParameterMap` now types the media trait parameters (`image.*`, `vector.*`,
`model.*`, `audio.*`, `video.*`, `media.*`) without closing the standard vocabulary or weakening
custom-trait version rules.

The contracts intentionally distinguish full data from metadata-only access. For example, a glTF
scene with unresolved external buffers is useful for hierarchy/asset inspection but cannot expose a
decoded primitive method.

## Extension and dependency layout

| Extension package       | Codecs        | Why this boundary exists                                   |
| ----------------------- | ------------- | ---------------------------------------------------------- |
| `common/archives`       | ZIP           | namespace/container and decompression concerns             |
| `common/images`         | PNG, JPEG     | zero-dependency raster parsing; separate codec entrypoints |
| `common/audio`          | MP3, Ogg/Opus | audio metadata/encoded playback closure                    |
| `common/video`          | MP4, WebM     | independent future demux/WASM dependency closure           |
| `common/vector`         | SVG           | secure static vector policy                                |
| `common/models`         | OBJ, glTF     | scene/geometry and companion-buffer concerns               |
| `common/text-json`      | JSON, JSONC   | one shared `jsonc-parser` family                           |
| `common/text-delimited` | CSV, TSV      | one dependency-free lazy row family                        |
| `common/text-ini`       | INI           | dependency-free standalone text extension                  |
| `common/text-xml`       | XML           | XML-only parser dependency                                 |
| `common/text-yaml`      | YAML          | YAML-only parser dependency                                |
| `common/text-toml`      | TOML          | TOML-only parser dependency                                |
| `common/documents`      | Markdown, RTF | common document structure, separate from data syntax       |

Grouping is by cohesive dependency closure, not by extension spelling. PNG+JPEG or MP3+Ogg may
share a package because they currently share no heavy parser dependency, but they never import one
another: every manifest points to `src/formats/<format>/codec.js`. Package indexes export only the
contribution glob. If one format later needs FFmpeg, libjpeg, Basis, Three.js, or another large
dependency, that implementation becomes a separate provider extension/package.

`@modkitx-x3/codec-kit` contains only lifecycle, descriptor assembly and generic source adapters;
its `./text` subpath owns format-neutral text lifecycle/data-source helpers. It contains no format
IDs, parsers, registries, renderers or decoder libraries and is not in the bootstrap import closure.

## Implemented codec behavior

| Codec    | Native behavior                                                                                                   | Neutral source / honest limit                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| ZIP      | central-directory validation, safe paths, stored/deflate extraction                                               | namespace + tree; no eager child-codec imports                                                                     |
| PNG      | signature, chunk bounds/CRC, IHDR/APNG facts; lazy bounded RGBA8 decode for supported 8-bit non-interlaced images | raster source; other bit depths/interlace use encoded/provider path                                                |
| JPEG     | marker/SOF/JFIF/EXIF structure and dimensions                                                                     | raster encoded source; entropy decoder is a separate provider                                                      |
| MP3      | ID3/MPEG frame facts and duration estimate                                                                        | audio encoded source + transport; no bundled PCM decoder                                                           |
| Ogg      | page/logical-stream scan, Opus/Vorbis detection, granule duration                                                 | audio encoded source + transport; rejects non-audio Ogg in this extension                                          |
| MP4      | bounded ISO-BMFF box tree, brands, tracks/codecs, dimensions and movie duration                                   | video encoded source + transport; frame decoder is separate                                                        |
| WebM     | EBML/WebM identity and supported video/audio codec discovery                                                      | video encoded source + transport; duration index/frame decode remain providers                                     |
| SVG      | bounded hierarchy and vector facts                                                                                | only `uvg.secure-static.v1`; scripts, DTD/entities, events, active animation and external CSS/content are rejected |
| OBJ      | validated indices, fan triangulation, bounds, groups/material references                                          | model source with real `Float32Array` positions and `Uint32Array` indices                                          |
| glTF     | bounded glTF 2 JSON graph, scene/resource/material/animation catalog                                              | model metadata source; external buffers/images remain explicit companions                                          |
| Markdown | bounded outline, links, lists, quotes and code blocks                                                             | text + tree                                                                                                        |
| RTF      | header/group/control-word validation and flow/embed facts                                                         | tree + bytes; no fake layout renderer                                                                              |

## UI modules

Five independent media viewers are public package subpaths and contribution entrypoints:

- `@modkitx-x3/ui/image` consumes raster-image-source and prefers decoded regions before a browser
  encoded fallback;
- `@modkitx-x3/ui/vector` consumes only the secure static vector profile and renders it as an
  isolated Blob image;
- `@modkitx-x3/ui/audio` consumes audio-media-source, reduces PCM decoded by the platform to bounded
  waveform peaks, and uses a native audio element for playback;
- `@modkitx-x3/ui/video` consumes video-media-source and uses the platform player for the encoded
  representation;
- `@modkitx-x3/ui/model` consumes model-scene-source and provides a zero-dependency 2D wireframe
  fallback for decoded primitives; a GPU renderer can replace it without changing codecs.

Loading any of these entrypoints does not import another viewer entrypoint or a format codec.

## Adding a codec

For an INI-like format in an existing dependency family:

1. add `src/formats/ini/codec.js` (or one small family profile if syntax is genuinely shared);
2. add `contributions/codec-ini.json` with probe budgets, traits and published sources;
3. export nothing from the package index—the glob and wildcard subpath already discover it;
4. add positive, malformed, budget and import-isolation fixtures.

For a format with a large or native dependency, make a new extension/provider package and keep the
same contribution/data-source ABI. Do not add the dependency to UI, SDK, host, `codec-kit`, or a
family index.

## Verification

The current tree passes:

- strict production and tooling typecheck;
- schema emission/check: 14 artifacts;
- UI manifest check: 16 manifests (15 viewers + one editor);
- media/reference source suite: 21 tests across 12 codecs;
- real browser viewer tests;
- per-codec and package-index import-isolation checks;
- clean packed-tarball installation of all reference codec families;
- deterministic single-file bundles for all 34 public entries;
- universal-data performance budgets;
- ESLint, Prettier, token and forbidden-legacy gates;
- full Vitest gate: 44 files / 378 tests.

## Remaining deliberate provider/spec work

- UVT/UVA/UVV/UVG wire drafts are not yet frozen; no codec fabricates final wire bytes.
- Full JPEG/MP3/Ogg/video decode, KTX2/Basis, FFmpeg and GPU renderers belong to optional provider
  extensions with their own dependency closure.
- glTF external buffers/images and OBJ MTL/texture companions require artifact-bound host planning.
- The lightweight model viewer is a conformance fallback, not the final UVM renderer.
- App adapters for VS Code, Electron and ordinary web pages consume the same UI entrypoints but are
  outside this format-extension slice.

These are explicit next-layer capabilities, not reasons to merge the extensions or reintroduce a
global codec catalog.
