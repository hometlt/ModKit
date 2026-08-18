# 08. Format Landscape

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Measured repository snapshot

Source: `generated/codec-catalog/codec-catalog.json`, measured 2026-08-11 against the current working
tree.

```text
227 codec manifests + 6 game manifests = 233 catalog entries
140 catalog entries under extension roots
93 catalog entries under legacy roots
63 supported
122 partial
48 unsupported
25 unique declared traits / 66 declarations
19 manifests declaring v1 traits
28 extension roots
```

Эти значения volatile. Перед использованием их нужно пересчитывать из generated
catalog, а не переносить в implementation status вручную. `extensions/` и 28 roots описывают
текущий migration monorepo, не target distribution: generic Modkit ships bundled common, а
vendor/game/community coordinates из landscape публикуются independent repositories/artifacts по
документу 28.

## 2. Current domains

| Kind         | Count | Representative formats                                              |
| ------------ | ----: | ------------------------------------------------------------------- |
| archive      |    44 | ZIP, 7z, RAR, TAR, MPQ, CASC, BIG, SGA, UnityFS, Unreal Pak/IoStore |
| image        |    53 | DDS, BLP, PNG, JPG, TGA, PSD, KTX, AVIF, sprites/palettes           |
| vector       |     3 | SVG, EMF, WMF                                                       |
| audio        |    12 | WAV, MP3, OGG, Opus, FLAC, AAC, WEM, BNK, FSB                       |
| video        |    12 | MP4, WebM, AVI, Bink, Smacker, SWF, FLV                             |
| model        |    30 | M3, MDX, W3X, glTF, OBJ, DAE, BLEND, Unity, Unreal, S3O, PIE        |
| document     |    17 | DOCX, XLSX, PPTX, PDF, ODF, CSV, Markdown, Figma, Drawio, Visio     |
| data         |     7 | SC2 Data, CNC3 Data, Warcraft object data, Warzone data             |
| localization |     5 | SC2 Strings, CNC3 localization, WTS, TBL, UCS                       |
| map          |     7 | SC2, CNC3, Warcraft, StarCraft, Warzone, Supreme Commander          |
| game         |    31 | Blizzard, SAGE, Spring, Relic, Petroglyph and others                |
| mod          |     3 | SC2 Mod, SAGE SKUVD, Spring VFS                                     |
| replay       |     3 | SC2, StarCraft, Warcraft III                                        |
| save         |     1 | SC2 Bank, Diablo II save                                            |
| script       |     3 | Galaxy, SC2 Triggers, Warcraft, Supreme Commander                   |
| layout       |     1 | SC2Layout                                                           |
| runtime      |     1 | SC2 runtime                                                         |

Status `supported` не означает полную authoring parity, а `unsupported` может быть
только declaration без runtime. Architecture обязана считать partial/missing
providers нормальным состоянием.

Current `kind` является compatibility classifier и местами смешивает container, transform и
semantic domain. Target v2 не переписывает эту таблицу одним новым kind: codec получает несколько
`FormatRole`, source topology и artifact stage, а LZMA/BC7/AAC implementations могут отдельно
публиковаться service-provider contributions.

## 3. Likely future formats

Список не является backlog. Он показывает нагрузку на contracts.

### Containers and packages

```text
VPK, WAD, PK3, IWD
BSA/BA2, RPF, CPK
Quake/Source BSP containers
Godot PCK
Minecraft region/NBT containers
installers and disk images
content-addressed stores
patch/delta bundles
```

Architecture pressure: nested sources, encryption, compression providers, huge
indexes, remote blocks, locale/build variants.

### Images/textures/design

```text
HEIC/HEIF, JPEG XL, QOI
ASTC, PVR/PVRTC, ETC families
OpenRaster, Krita, XCF
sprite atlases and animation sheets
material/texture graphs
engine-specific virtual textures
```

Pressure: mipmaps, arrays, faces, animation, palettes, color profiles, layers,
embedded resources, GPU-native decode.

### Audio

```text
AIFF, ALAC, WMA
MIDI
MOD/XM/S3M/IT trackers
CRI ADX/HCA/ACB/AWB
XACT/XWB/XSB
Nintendo DSP/BFSTM
Sony VAG/ATRAC
additional FMOD/Wwise banks
```

Pressure: containers vs elementary streams, external banks, loop points, events,
multiple decoders, platform codecs.

### Video/time media

```text
MKV, MOV, MPEG-TS
H264/H265/AV1 elementary streams
ROQ, VQA, MVE
CRI USM/SFD
console cinematics
interactive timelines
```

Pressure: demux/decode separation, audio/subtitle tracks, seekability, external
runtimes, animated-image overlap.

### Models/scenes

```text
FBX
USD/USDZ
Alembic
NIF
Source MDL/VTX/VVD
CryEngine CGF/CHR
engine-specific skeleton/animation/material formats
CAD interchange formats
shader/material node graphs
```

Pressure: format families, companions, embedded textures, partial traits, scenes
containing multiple models, renderer-neutral representation.

### Documents/data

```text
EPUB, HTML, LaTeX
Jupyter notebooks
email EML/MSG/MBOX
OneNote-like notebooks
SQLite
Parquet/Arrow
MessagePack/Protobuf/FlatBuffers
YAML/TOML/INI
CAD/GIS documents
```

Pressure: pages vs flow, tables, embedded media, formulas, schemas, relationships,
incremental editing and multiple views.

### Fonts and text presentation

```text
TTF, OTF, WOFF/WOFF2
bitmap fonts, BMFont
game-specific glyph atlases and metrics
subtitle/caption formats
```

Pressure: glyph/metrics/character-map traits, font shaping/runtime facilities, embedded fonts,
texture-backed glyphs, localization fallback and subtitle timeline integration. Текущий font preview
не заменяет отдельный font codec/contribution contract.

### Localization

```text
PO/MO
XLIFF
RESX
Fluent FTL
ICU MessageFormat
JSON/YAML/CSV localization tables
dialogue/subtitle databases
```

Pressure: multi-locale aggregation, placeholders, markup, plural rules, fallback,
cross-file editing.

### Code and visual scripting

```text
Lua, Python, C#, JavaScript/TypeScript
GLSL, HLSL, WGSL, SPIR-V
Unreal Blueprint-like graphs
shader graphs
behavior trees
dialogue/quest graphs
embedded DSLs
```

Pressure: generic syntax plus game semantics, embedded documents, virtual sources,
workspace indexes and LSP-neutral features.

### Game ecosystems

```text
Source/id Tech
Source 2 compiled resources
Bethesda
Godot
Minecraft
Paradox
Factorio
RimWorld
OpenRA
0 A.D. (XML data, PMD/PSA, ZIP mods)
Total War PACK
Homeworld BIG/HOD
Anno RDA
Planetary Annihilation PAPA
Age of Empires II game profile over existing Age formats
additional Unity/Unreal games
console RTS/mod ecosystems
```

Pressure: game-specific subjects, dependency/load order, compiled vs source data,
save/replay/runtime variants and provider federation.

## 4. Architectural stress cases

Следующие cases должны использоваться для проверки design, даже если codecs ещё не
реализованы:

1. GIF/APNG: image + timeline, но не обычное video.
2. MP4: container + video + audio + subtitles.
3. XLSX: document + sheets + tables + formulas + embedded images.
4. BLEND: project + scene + multiple models + embedded/external assets.
5. SC2Map: directory/MPQ + map semantics + dependencies + scripts + previews.
6. CASC: namespace/content-addressed store without primary file + locale/build variants +
   remote fallback.
7. Unreal package: generic exports, затем typed texture/audio/model adapters.
8. SC2 Unit: assembled subject with optional model/icon/audio/localization.
9. Localization matrix: derived subject over many source files.
10. Trigger XML with embedded Galaxy: nested language document/source map.
11. Model with owned animation sidecar and shared external textures.
12. CUE/BIN and indexed image/palette: multi-source identity and transactional save.
13. TypeScript/WASM/Windows-native/Linux-native M3 providers plus independent
    animation/preview/export augmentations.
14. Runtime/launch split: inspectable map, optional simulation and permissioned game start.
15. AI/MCP client: bounded relation queries and schema-described edits without private APIs.
16. Second-game World proof: Spring, Warzone 2100 or 0 A.D. passes the same contract-owned
    conformance fixture without SC2 types in the neutral contract.
17. KTX2/DDS: multi-role texture container/encoded stream, CPU service decode vs native GPU output,
    bounded `metadata`/`preview`/`full` intents.
18. Wwise BNK: event/bank container with independently decoded media payloads.
19. SHP/TMP + PAL: optional cross-codec companion with explicit true-color/degraded-grayscale
    fidelity.
20. Unity assets/ress/UnityFS: namespace graph with cyclic companion declarations and cycle limits.

## 5. Priority strategy

Не следует реализовывать formats по размеру списка. Приоритет имеют representative
vertical slices:

1. ZIP — container/source recursion.
2. PNG/DDS — image capability and preview.
3. WAV/OGG — audio stream/playback.
4. GIF или MP4 — multi-capability/time media.
5. M3 — model traits, companions and alternate providers.
6. SC2 Strings — document + localization + table + language.
7. SC2 Unit — logical subject composition.
8. SC2 Triggers — embedded Galaxy.
9. SC2Map — composite workspace/container/map.
10. XLSX/BLEND — non-game proof that the architecture is general.

Пять schema fixtures для первого codec/service contract pass: KTX2, MP4, Wwise BNK, BLEND и
SC2Map. SHP+PAL, M3+M3A и Unity graph являются отдельными composition fixtures; одна fixture не
должна театрально «доказывать» все виды bundle/namespace/service composition.
