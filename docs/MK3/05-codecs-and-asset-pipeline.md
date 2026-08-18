# 05. Codecs and Asset Pipeline

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Универсальный codec lifecycle

```ts
interface AssetCodec {
  readonly descriptor: CodecDescriptor

  probe(source: ArtifactSource, context: ProbeContext): Promise<ProbeResult>

  planInput?(candidate: ArtifactSource, context: InputPlanningContext): Promise<AssetInputPlan>

  open(input: AssetInput, request: OpenRequest, context: OpenContext): Promise<AssetHandle>
}
```

Общими являются только detection, open, diagnostics, lifecycle и descriptor. Image,
audio, model и archive data рекламируются traits, а typed APIs предоставляются contracts открытого
handle/session.

`probe()` всегда bounded и может начинаться с одного candidate source. `planInput()` не
читает весь filesystem: он декларативно сообщает host, какие bindings или namespace
нужны для полного `open()`. Для single-file codec host создаёт `AssetInput` без
дополнительного planning.

`open()` всегда получает намерение и budget. Bounded `probe()`/`AssetReadOptions.maxBytes` ограничивает
только detection input и не запрещает codec полностью разобрать BLEND, CASC или SC2Map ради metadata
либо thumbnail:

```ts
type OpenIntent = 'probe' | 'inspect' | 'thumbnail' | 'full' | 'stream' | 'export'

interface ResourceBudget {
  readonly maximumInputBytes?: number
  readonly maximumOutputBytes?: number
  readonly maximumMemoryBytes?: number
  readonly deadlineMilliseconds?: number
}

interface OpenRequest {
  readonly intent: OpenIntent
  readonly budget?: ResourceBudget
  readonly requestedTraits?: readonly string[]
  readonly requestedRepresentations?: readonly string[]
  readonly signal?: AbortSignal
}
```

`CodecContributionSpecV1.openIntents` является статическим claim для planning; реальное соблюдение
проверяется счётчиками bytes/modules/time в conformance tests. `inspect`/`thumbnail` не имеют права
неявно инстанцировать тяжёлый transcoder, а превышение budget отличается от unsupported format.

### 1.1 Format roles, topology и artifact stage

Текущий closed `kind` сохраняется в manifest v1 и compatibility adapter. V2 не заменяет его одним
новым `layer`: format может иметь несколько ролей одновременно, а reusable compute service вообще не
обязан быть format codec.

```ts
type FormatRole = 'container' | 'media' | 'byte-transform' | 'semantic' | 'index' | 'sidecar'

type SourceTopology = 'single' | 'bundle' | 'namespace' | 'derived'
type ArtifactStage = 'authored' | 'compiled' | 'runtime'

interface CodecContributionSpecV1 {
  readonly formatRefs: readonly FormatRef[]
  readonly roles: readonly FormatRole[]
  readonly sourceTopology: SourceTopology
  readonly artifactStages: readonly ArtifactStage[]
  readonly openIntents: readonly OpenIntent[]
  readonly match: MatchRules
  readonly probe: ProbePlan
  readonly companions?: readonly CompanionRule[]
  readonly representations: readonly RepresentationDecl[]
  readonly publishesDataSources: readonly DataSourceRef[]
  readonly fidelity?: FidelityClaims
  readonly requires?: readonly ContractRequirement[]
  readonly operations: readonly OperationDecl[]
  readonly mayExpose?: readonly TraitClaim[]
  readonly implementationTier: ImplementationTierClaim
  readonly budgets: ResourceBudgetWire
}
```

Это полный набор осей codec contribution, принятый решением владельца 2026-08-14 как basis для
BRIEF-13A: format identity, roles, topology, artifact stages, open intents, bounded detection,
companions, representations/data sources, fidelity/dependencies/operations/trait claims,
implementation tier и budgets не сворачиваются в один `kind`. Basis **не frozen**: schema
замораживается только после восьми stress fixtures A-5; до этого документ не заявляет implemented
v1 ABI.

`ArtifactStage` отвечает на вопрос, на какой стадии находится прочитанный игровой артефакт. Output
representation отвечает на другой вопрос: native M3 или `RenderModel`, encoded или decoded,
indexed или materialized, transferable или host-local. Эти оси не называются одним полем
`representation`.

Текущее `CodecTraitRepresentation = source | compiled | runtime` не переписывается отдельным
manifest-v1 слайсом. Переход `source -> authored` выполняется только v2 adapter/schema migration,
чтобы не создавать промежуточную миграцию 19 manifests и генератора.

## 2. Нужны ли ImageCodec/AudioCodec/ModelCodec

Как mutually exclusive foundation interfaces — нет.

Допустимы:

- typed adapters;
- contract-scoped convenience views without a second registry authority;
- domain-specific convenience views;
- conformance helper interfaces.

```ts
const image = await host.openAs(source, ImageRaster)
const archive = await host.openAs(source, ContainerEntries)
```

Старые registries временно фильтруют общий catalog по required capability.

## 3. Pipeline

```text
Candidate ArtifactSource
  -> manifest shortlist
  -> bounded detection through one (codecId, environment) registration
  -> provider resolution across preserved (codecId, variantId, environment) activation offers
  -> AssetInputPlan
  -> resolve bindings/namespace
  -> lazy runtime activation
  -> AssetHandle
  -> descriptor/capabilities/relations
  -> projections
  -> viewer/editor/language contributions
```

## 4. Detection

Candidate ranking использует:

- magic/validated structure;
- path/source context;
- media type;
- extension как слабое evidence;
- enclosing artifact relation;
- user override;
- provider conformance/priority.

Нельзя маршрутизировать SC2 Data только по `.xml`. Нельзя считать любой `.bank`
одинаковым format.

## 5. Nested assets

Container codec возвращает child sources:

```ts
interface ContainerEntriesApi {
  entries(query?: EntryQuery): AsyncIterable<ContainerEntry>
  openEntry(id: string): Promise<ArtifactSource>
}
```

Дочерний source снова передаётся в host:

```ts
const container = await artifact.require(ContainerEntries)
const childSource = await container.openEntry(entry.id)
const child = await host.open(childSource)
```

Parent codec не выбирает child codec напрямую.

## 6. Формы asset input

| Форма       | Когда используется                                   | Primary                             |
| ----------- | ---------------------------------------------------- | ----------------------------------- |
| `single`    | DDS, WAV, JSON, один archive entry                   | Binding является единственным input |
| `bundle`    | Image + palette, CUE/BIN, model + animation sidecars | Необязателен                        |
| `namespace` | Directory project, SC2Map, CASC, Git tree            | Не требуется                        |
| `derived`   | Thumbnail, localization matrix, converted model      | Нет; есть provenance inputs         |

Codec не должен превращать namespace в искусственный список всех файлов. Он получает
VFS mount и открывает entries лениво. Bundle содержит только компоненты identity/round
trip asset, а не все достижимые external resources. Детальная модель приведена в
[16-composite-assets-and-origins.md](16-composite-assets-and-origins.md).

## 7. Video/audio tracks

Demux provider открывает container и публикует track sources:

```text
MP4
├── video track -> H264/AV1 provider
├── audio track -> AAC/Opus provider
├── subtitle track -> text provider
└── metadata track
```

Video container не обязан декодировать audio.

## 8. Embedded textures/models/scripts

Model/scene provider публикует relations:

```text
embeds visual.texture -> child source
references visual.texture -> external AssetReference
companion model.animation -> sidecar
```

Triggers/layout/document provider публикует virtual sources для embedded language
blocks с source maps.

## 9. Container, media codec и byte transform

Нужно разделять четыре слоя:

```text
container/framing       7z, MP4, WAV, DDS structure and indexes
elementary stream codec AAC, Opus, H.264, Vorbis, BC7
byte transform          LZMA, Deflate, Zstd, Oodle
representation          bytes, PCM samples, frames, pixels, meshes
```

Compression обычно является service provider, а не file codec:

```ts
interface CompressionProvider {
  readonly algorithm: string
  decode(input: ByteStream, options: JsonValue): Promise<ByteStream>
  encode?(input: ByteStream, options: JsonValue): Promise<ByteStream>
}
```

Format-specific framing остаётся в codec. Общие algorithms разрешаются по contracts:

```text
common.compression/deflate-decode
common.compression/zstd-decode
common.compression/oodle-decode
```

Encryption/checksum/transcoding используют тот же service pattern.

Format adapter читает declared method/tag/fourcc из структуры source и формирует точный
`ProviderRequest`. Solver выбирает реализацию этого contract, но не пытается найти
произвольную цепочку transforms графовым поиском.

Примеры:

```text
7z method LZMA -> common.compression/lzma-decode
MP4 audio track AAC -> common.audio/aac-decode
WAV codec tag MS ADPCM -> common.audio/ms-adpcm-decode
DDS DXGI BC7 -> common.image/bc7-decode
```

Standalone `.lzma` provider может одновременно зарегистрировать `AssetCodec` для framing
формата и service offer для reusable LZMA transform. Детальная модель описана в
[14-processing-and-codec-layering.md](14-processing-and-codec-layering.md).

## 10. Companions

Codec объявляет `CompanionSpec`, а resolver ищет companions только в разрешённых
scopes:

```ts
interface CompanionSpec {
  readonly role: string
  readonly required: boolean
  readonly patterns: readonly string[]
  readonly expected?: TraitQuery
  readonly searchScopes: readonly string[]
}
```

Никаких глобальных filesystem scans или угадывания sidecar по произвольным string
patterns вне declaration.

`CompanionSpec` является input-discovery механизмом, а не окончательной моделью asset.
Host materializes найденные required/owned companions в `AssetOrigin.bundle`. Optional
или shared dependencies могут остаться typed relations. Если required binding не найден,
`open()` не вызывается, а resolution возвращает structured missing-input diagnostic.

Optional companion не превращается в required только потому, что улучшает preview. Текущие SHP/TMP
с PAL являются proof для optional cross-codec binding: с PAL получается true-color output, без PAL —
явно degraded grayscale fidelity. M3/M3A и ALO/ALA отдельно проверяют same-codec semantic sidecars, а
Unity assets/ress/UnityFS — namespace graph и cycle protection.

## 11. Directory и archive parity

Semantic codecs должны работать поверх generic container/VFS contract:

```text
SC2Map directory -> ContainerEntries
SC2Map MPQ       -> ContainerEntries
SC2Map overlay   -> ContainerEntries
```

SC2 Map provider читает virtual paths и не зависит от MPQ implementation.

## 12. Asset session

```ts
interface AssetSession {
  readonly handle: AssetHandle
  readonly revision: AssetRevision
  readonly operations: OperationSession
  dispose(): Promise<void>
}
```

Session владеет workers, caches, object URLs, native handles и temporary files.
`AssetRevision` является deterministic hash/revision vector всех owned bindings,
namespace snapshot и provider versions, влияющих на semantic result.

## 13. Operations и создание новых assets

`open()` работает с существующим `AssetInput`. Encode/create лучше разрешать как
operations:

```text
image.encode
audio.encode
archive.create
model.export
document.serialize
map.pack
```

```ts
const encoder = await operations.resolve(ImageEncode, {
  format: 'org.modkitx.format/png',
  environment: 'browser-worker',
})
```

Writer возвращает `AssetWritePlan`: какие bindings будут созданы/изменены/удалены и
какие transaction guarantees доступны. Multi-source save не может скрываться за записью
только primary file.

## 14. Model representations и conversion

`RenderModel` остаётся стандартной renderer-neutral проекцией, но не объявляется
универсальным lossless document для любого model format:

```text
Native model document
  -> RenderModel/Scene3D projection
  -> interactive/headless renderer
  -> export/conversion provider
```

Codec может одновременно публиковать native format capability, unknown chunks и
`model.geometry`/`model.animations`. Conversion возвращает отчёт:

```ts
interface ConversionReport {
  readonly preserved: readonly string[]
  readonly approximated: readonly string[]
  readonly omitted: readonly string[]
  readonly diagnostics: readonly Diagnostic[]
  readonly providers: readonly ResolvedProviderRef[]
}
```

Это позволяет просматривать M3/MDX/BLEND через общий renderer, не обещая lossless
round-trip свойств, которых `RenderModel` не представляет.

Текущие [`ModelCodec`/`RenderModel`](../../packages/models-processing/src/core/codec.ts) и
[`ModelOpenService`](../../packages/models-processing/src/open.ts) являются подходящей
миграционной базой: registry/open/export остаются, а вход расширяется до `AssetInput`,
provider selection разделяется по open/render/export, и существующий multi-file encode
result материализуется как output origin плюс `ConversionReport`.

Целевой владелец `RenderModel`/`Scene3D` contracts — browser-safe
`@modkitx/rendering-3d/scene`. `@modkitx/models-processing` владеет model processing/conversion
contracts и зависит от scene types; native M3/MDX/VXL documents остаются у format extensions. Это
следует canonical §6.3 и закрывает ранее неявный ownership без создания второго scene DTO.

## 15. Package ownership

```text
packages/assets
  contracts, host, registries, descriptors
  browser-safe ./traits and ./subjects subpaths

packages/image-processing
  pixels, color, resize, mipmaps

packages/audio-processing
  PCM, channel layouts, resampling, waveform contracts

packages/media-processing
  tracks, timestamps, frame/audio synchronization

packages/models-processing
  model processing/conversion algorithms; imports rendering scene contracts

packages/rendering-3d/scene
  renderer-neutral RenderModel/Scene3D contracts

packages/container-processing
  reusable container/index/stream primitives

extensions/common/images/codecs/png
  bundled common concrete PNG implementation

independent modkit-extension-starcraft-2/codecs/m3
  concrete M3 semantics/provider offers
```

Processing package не должен перечислять installed concrete formats.
Текущие `archives-processing` и другие legacy owners сохраняются до adapter/parity
migration; новое target ownership не является причиной немедленно перемещать рабочий код.

## 16. Compatibility migration

Для каждого legacy codec:

1. зафиксировать ID, detection и behavior fixtures;
2. добавить manifest/offer;
3. обернуть старую реализацию в `AssetCodec`;
4. описать traits, contracts, operations и relations;
5. добавить parity tests старого и нового пути;
6. перевести consumer на host trait/contract query;
7. переместить implementation в extension;
8. удалить handwritten registry entry;
9. удалить adapter только после исчезновения consumers.
