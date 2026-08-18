# 14. Processing and Codec Layering

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Проблема

Формат файла, контейнер, алгоритм сжатия и способ кодирования media часто пересекаются,
но не являются одним и тем же:

- `.7z` задаёт структуру archive, а entries могут использовать LZMA/LZMA2/Deflate;
- MP4 задаёт boxes/tracks, но payload может быть H.264/AV1 и AAC/Opus;
- WAV задаёт RIFF framing, но samples могут быть PCM, ADPCM или другими codecs;
- DDS задаёт texture layout, а subresources могут быть BC1/BC7/uncompressed;
- standalone `.lzma` содержит framing вокруг того же algorithm, который используется
  внутри container.

Если всё назвать codec и соединять direct imports, implementations нельзя независимо
заменять. Если дать solver свободно искать любую transform chain, resolution становится
непредсказуемым и небезопасным.

## 2. Четыре runtime слоя

| Слой              | Ответственность                                          | Примеры                                                                                                                                                        |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container/framing | Структура, headers, indexes, entries/tracks/subresources | 7z, ZIP, MP4, WAV, DDS                                                                                                                                         |
| Elementary codec  | Семантика encoded media payload                          | AAC, Opus, H.264, AV1, BC7                                                                                                                                     |
| Byte transform    | Reusable bytes-to-bytes algorithm                        | LZMA, Deflate, Zstd, Oodle, encryption **algorithm** (key material — отдельный security concern, [24 §12.1](24-extension-security-execution-and-lifecycle.md)) |
| Representation    | Decoded domain data/API                                  | byte stream, PCM, frames, pixels, scene/model                                                                                                                  |

Format adapter может охватывать несколько structural concerns, но обязан явно запросить
чужой runtime layer через virtual contract.

Эти runtime layers не являются mutually exclusive `codec.kind`. Source format описывается
множеством `FormatRole[]` и topology из документа 05; reusable implementation слоя публикуется как
`ServiceProviderContribution`, если у неё нет собственной source identity.

## 3. Resolution rule

```text
format parser reads authoritative method/tag/fourcc/schema field
  -> maps value to a versioned virtual contract
  -> creates ProviderRequest with options/limits
  -> resolver selects compatible installed provider
  -> provider returns declared representation
```

Format parser, а не generic solver, определяет, какой contract нужен. Mapping основан на
загруженной структуре/specification, не на string guessing. Solver выбирает только
implementation конкретного contract.

Не используется автоматический unbounded graph search вида «попробовать любую цепочку
decrypt/decompress/transcode до получения pixels». Допустимые multi-step pipelines
объявляются format adapter или versioned projection provider и имеют budget/cycle limits.

## 4. Contract examples

```text
common.compression/lzma-decode
common.compression/deflate-decode
common.audio/aac-decode
common.audio/ms-adpcm-decode
common.video/h264-decode
common.image/bc7-decode
common.container/7z-open
common.container/mp4-demux
```

Inputs/outputs должны быть typed и bounded:

```ts
interface ByteTransformRequest {
  readonly input: ByteStream
  readonly expectedOutputBytes?: number
  readonly maximumOutputBytes: number
  readonly parameters: JsonValue
  readonly cancellation: CancellationToken
}
```

Decoded-size limit обязателен для защиты от archive bombs и malformed headers.

## 5. Worked compositions

### 7z + LZMA

```text
7z AssetCodec
  -> parses folder/stream graph and method IDs
  -> requests common.compression/lzma-decode
  -> exposes decoded entry ArtifactSources
  -> child assets return to generic AssetCodecHost
```

7z provider владеет archive semantics и solid-block scheduling. LZMA provider владеет
algorithm. Ни один из них не выбирает codec дочернего файла.

### MP4 + H.264 + AAC

```text
MP4 demux/container provider
  ├── video track source + contract common.video/h264-decode
  ├── audio track source + contract common.audio/aac-decode
  ├── subtitle/text track
  └── metadata track
```

Video preview может работать без audio decoder. Timeline projection синхронизирует уже
доступные tracks и явно показывает partial state.

### WAV + ADPCM

WAV adapter читает validated format tag и channel/rate/block parameters, затем запрашивает
`common.audio/ms-adpcm-decode`. PCM payload может экспонироваться напрямую без отдельного
decoder provider, если contract это явно допускает.

### DDS + BC7

DDS adapter отвечает за mip/layer/face layout и DXGI mapping. BC7 provider преобразует
один encoded block surface в pixels. Image capability собирает subresources; renderer
может выбрать native GPU compressed representation без обязательного CPU decode.

### Standalone LZMA

Extension может зарегистрировать два offers:

1. `AssetCodec` для `.lzma` framing/source detection;
2. `ServiceProviderContribution` для `common.compression/lzma-decode`.

Они могут разделять internal implementation, но имеют разные public contracts/lifecycles.

## 5.1 Service provider contribution

Service contribution реализует reusable typed compute contract, не владеет source identity и сам не
выполняет пользовательскую transaction. Поэтому ему не нужны format detection, path match или
container operations:

```ts
interface ServiceProviderContributionSpec {
  readonly provides: readonly ContractOffer[]
  readonly requires?: readonly ContractRequirement[]
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly variants: readonly RuntimeVariantDeclaration[]
}
```

Contribution type и runtime offer kind являются разными осями. Service contribution после
activation создаёт обычные `ProviderOffer` (`primary`, `replacement`, `augmentation` или
`projection` по смыслу); слово `service` не добавляется в `ProviderOfferKind`. Один extension может
одновременно публиковать standalone `.lzma` codec, decode/encode services и несколько runtime
variants.

## 6. Processing packages не являются format registries

`packages/assets` и его browser-safe `./traits`/contract subpaths содержат mechanism/portable
contracts. Они не
должны стать складом всех domain algorithms.

```text
packages/image-processing
  pixel formats, color, resize, mipmaps, image representations

packages/audio-processing
  PCM, channels, resampling, waveform and audio representations

packages/media-processing
  tracks, timestamps, seek/synchronization and frame scheduling

packages/models-processing
  renderer-neutral geometry/material/skeleton/scene algorithms

packages/container-processing
  bounded binary container/index/stream primitives

packages/compression-processing (только если оправдано зависимостями)
  shared transform interfaces/helpers, not installed algorithm catalog
```

Конкретные formats/providers живут в extensions. Processing package может содержать
reference algorithm только если это сознательно выбранная reusable library ownership,
но runtime discovery всё равно идёт через scope-local embedded/installed generated provider catalog,
а не remote marketplace index.

## 7. Когда создавать отдельный package

Отдельный package оправдан, если есть хотя бы одна сильная граница:

- собственные heavy/native/WASM dependencies;
- другой runtime target или browser safety;
- independent lifecycle/versioning;
- самостоятельный reusable data model;
- заметно другой performance/security test matrix;
- несколько независимых consumers/providers.

Если различие только в folder organization и dependencies одинаковы, допустимы explicit
subpaths одного processing package. Package split не должен создавать циклы или root
barrel, втягивающий все domains в browser bundle.

## 8. Naming rules

- `container.*` — framing/index/entry/track structure.
- `compression.*` — reversible bytes transform без file identity.
- `audio.*`, `video.*`, `image.*` decode — encoded media to representation.
- `transcode.*` — representation/encoded stream to another format/profile.
- `render.*` — representation to visual/audio output, не serialization.
- `common.format/<id>-open` / `common.format/<id>-write` — source format lifecycle.

Все virtual contract IDs используют grammar `namespace/name`; legacy dotted aliases запрещены.

`ArchiveCodec`, `ImageCodec` и подобные имена допустимы как typed helpers/contract views, но не как
mutually exclusive foundation hierarchy или отдельные public authorities.

## 9. Failure and degradation

- Unknown method/tag создаёт structured diagnostic с исходным numeric/string identifier.
- Missing optional decoder оставляет container metadata/track relation доступными.
- Missing required transform блокирует только affected entry/track/capability.
- Decoder не имеет права вернуть пустой valid representation при corrupt payload.
- Provider output claims проверяются conformance fixtures.
- All decode/transcode calls имеют cancellation и resource budgets.

## 10. Migration

1. Зафиксировать current format behavior и dependency imports.
2. Выделить authoritative mapping method/tag -> virtual contract.
3. Обернуть reusable algorithm service provider contract.
4. Мигрировать in-scope legacy direct calls на final resolver route.
5. Добавить composition/parity/corruption/budget tests.
6. Перевести format adapter на resolver.
7. Удалить replaced direct dependency и старый route в том же slice после
   отсутствующего-provider test.
8. Перемещать package ownership отдельно от semantic migration.

## 11. Acceptance criteria

- 7z codec использует взаимозаменяемый LZMA provider из другого extension без direct
  implementation import.
- Удаление LZMA provider оставляет archive index доступным и переводит только affected entries в
  `dependency-required`.
- Два LZMA providers выбираются одинаково при пяти перемешанных discovery orders; exact selection
  записывается в lock.
- Missing provider и corrupt LZMA stream имеют разные stable error codes.
- MP4 metadata/video остаются доступны без audio provider.
- DDS может выбрать CPU BC7 decoder или native GPU representation по host requirements.
- Standalone `.lzma` и 7z reuse один service contract.
- Unknown codec tag сохраняется в diagnostic/context без guessed routing.
- Resource limit останавливает decompression bomb до unbounded allocation.
- Empty provider catalog не ломает host; unavailable layers дают bounded degraded state.
