# Аудит паритета MK2 → MK3

Дата: 2026-08-21. Источник: соседний `C:\FILES\SC2Files\coding\modkitx`, только для
чтения. Проверены `package.json`, публичные exports и реализация под `src/`; выводы не сделаны по
одним названиям каталогов.

План называл 34 пакета. В текущем checkout находятся 35 каталогов с `package.json`: 34
runtime/library-пакета и отдельный build-only preset `tsconfig`. В таблицу включены все 35, чтобы
расхождение счёта не скрыло ни одну поверхность.

## Крупные разрывы

1. **Семантический SC2-стек отсутствует как система.** В MK2 это не только кодеки: вместе работают
   `data-processing` (schema/catalog/inheritance), `maps-processing` (terrain, regions и служебные
   бинарные части карты), `mods-processing` (dependency/workspace resolver),
   `layouts-processing`, `localization-processing`, `scripts-processing`, `language-contracts` и
   `lsp`. В MK3 теперь есть исполняемый language-analysis slice, но остальная доменная цепочка и
   полноценный LSP/workspace host всё ещё отсутствуют.
2. **World/agent plane отсутствует, runtime перенесён минимальным срезом.** MK3 теперь имеет
   budgeted executable runtime sessions, но MK2 дополнительно давал snapshots/events/clock. Кроме
   того, всё ещё нет канонического World linker/scheduler и permission-gated agent operation
   catalog с двухфазными мутациями.
3. **3D-паритет теперь имеет общий renderer plane, но SC2-модель остаётся метадатной.** MK3
   маршрутизирует renderer provider и доказывает typed geometry → RGBA на живом software backend,
   однако M3/M3A всё ещё не декодирует геометрию, материалы, скелет, анимации и particle/ribbon
   effects, а production WebGL/WebGPU backend отсутствует.
4. **SC2 installation discovery перенесён первым вертикальным срезом.** MK3 теперь маршрутизирует
   game-neutral discovery contract и подтверждает SC2 по ограниченному набору CASC-маркеров для
   явно настроенных, стандартных и найденных в Windows Registry путей. Steam/Epic enumeration,
   другие игры, launch и автоматический mount ещё не перенесены.

### Block 5 / 1.1: граница реализованного language slice

Включено: отдельный `sdk/language`, типизированный service contract
`common.language/document-analysis@1`, manifest-declaration provider offer, host-owned
document-route matcher, обычная inventory/resolution/gate activation и живой Galaxy provider,
который возвращает semantic tokens, diagnostics и document symbols. Один и тот же
protocol-neutral handle пригоден редактору, headless check и будущему LSP adapter.

Осознанно не включено в этот contract pass: LSP transport/server, workspace index, capability
merge, watched-file routing, completion, hover, rename, layout/localization language modules и
полная Galaxy semantic model. Поэтому `language-contracts` закрыт на уровне требуемого общего
контракта, а более широкая строка `lsp` остаётся частичной.

### Block 5 / 1.2: граница реализованного runtime slice

Включено: отдельный `sdk/runtime`, route-aware service contract
`common.runtime/provider@1`, leased `common.runtime/session@1`, числовые бюджеты wall time, ticks и
memory при создании сессии, host-owned matcher и activation adapter, а также живой
`reference.counter` provider. Ресурсы резервируются до изменения состояния; превышение каждого
лимита возвращает структурированный `refused` с точными `reason`, `limit` и `requested`.

Осознанно не включено в этот contract pass: snapshots/restore, event stream, virtual clock,
scheduler/World composition, native runtime adapter, фактическое OS sandboxing и независимое
измерение памяти/CPU host-ом. Поэтому минимальный `PARITY-RUNTIME` contract закрыт, но более широкая
MK2 runtime-поверхность в таблице честно остаётся частичной.

### Block 5 / 1.3: граница реализованного renderer slice

Включено: отдельный `sdk/renderer`, route-aware service contract
`common.render/scene-3d@1`, host-owned matcher по `rendererId` и `outputKind`, обычная
inventory/resolution/gate activation и живой `reference.software` provider. Запрос передаёт
ограниченный scene snapshot с `Float32Array`/`Uint32Array`, column-major camera matrix и viewport;
результат — принадлежащий frame `Uint8Array` RGBA8 с diagnostics и statistics. E2E действительно
растеризует индексированный треугольник, а не только проверяет наличие API.

Осознанно не включено в этот contract pass: DOM/canvas mount API, WebGL/WebGPU, texture sampling,
полный material graph, skinning, animation, particle/ribbon effects, PNG encoding, GPU resource
lifecycle и интеграция с декодером M3. Поэтому минимальный `PARITY-RENDERER` contract закрыт, но
широкие строки `rendering-3d` и `models-processing` остаются частичными.

### Block 5 / 2.1: граница реализованного SC2 games slice

Включено: отдельный `sdk/games`, route-aware service contract
`common.game/installation-discovery@1`, host-owned matcher по стабильному `gameId`, обычная
inventory/resolution/gate activation и живой `org.modkitx.blizzard/starcraft2-installation` provider.
Провайдер принимает явно настроенные пути, проверяет ограниченный список стандартных каталогов и
Windows Registry, затем подтверждает корень только по `.build.info` и директориям
`SC2Data/{config,data,indices}`. E2E доказывает как синтетический корень, так и установленный
`C:\Apps\StarCraft II` версии 5.0.16 без копирования приватных игровых данных в репозиторий.

Осознанно не включено: рекурсивное сканирование дисков, Steam/Epic store enumerators, другие игры,
запуск процесса, VFS/CASC mount и выбор workspace. Поэтому минимальный `PARITY-GAMES` vertical
slice закрыт и разблокирует `PARITY-MODS`, но широкая строка `games` остаётся частичной.

## Таблица

| пакет MK2                 | что он давал (проверенная реализация)                                                                                                                   | где это в MK3                                                                                                                            | вердикт                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `agent-tools`             | `AgentOperationCatalog`, JSON-schema input/output, permissions, work-unit budgets, approval и prepare/commit для мутаций; детерминированные eval traces | Host имеет grants/operation dispatch, но не agent catalog, skill schema или evaluation harness                                           | **нет — нужно** (`PARITY-AGENT`)                                                      |
| `archives-processing`     | Registry и session manager для ZIP и игровых архивов; lazy random access, VFS mount, cache, crypto/decompressors, pack/write API                        | `extensions/common/archives`, `blizzard-mpq`, `blizzard-casc`; `NamespaceEntrySource` и `container.extract`                              | **частично** — нет общего archive registry/cache/write plane и большей части форматов |
| `assets`                  | Источники, descriptors, detection, sessions, manifests, companions, operations, editing и registries                                                    | `packages/sdk` + `packages/host` разделяют wire contracts, inventory, resolution, sessions и editing                                     | **есть**                                                                              |
| `audio-processing`        | Audio registry, metadata/decode, native playback hints и injectable transcode/export                                                                    | MP3/OGG codecs, `AudioMediaSource`, encoded source и transport в common extensions/SDK                                                   | **частично** — нет decoder/transcoder/export provider plane                           |
| `code-viewer`             | Bounded text source, lazy Monaco editor/diff, lifecycle и worker factories                                                                              | `packages/ui/{code,editor,text-virtual}` и `extensions/common/ui-monaco`                                                                 | **есть**                                                                              |
| `core`                    | Ошибки, events и logging sinks                                                                                                                          | `packages/core` даёт structured errors/cancellation; host diagnostics покрывают boundary logging                                         | **есть**                                                                              |
| `data-processing`         | Game-neutral registry плюс большой SC2 schema/catalog: typed fields, namespaces, inheritance, merge и editor categories                                 | Общие table/tree/graph contracts есть; `org.modkitx/sc2-data` остаётся port-pending                                                      | **частично** — SC2 schema/catalog/resolution отсутствуют                              |
| `documents-processing`    | Document registry и SC2 DocumentHeader/DocumentInfo/Version parsing и запись                                                                            | Markdown/RTF codecs и общие document/tree contracts; SC2 metadata envelope port-pending                                                  | **частично** — SC2 metadata parser/writer отсутствует                                 |
| `embed`                   | Framework-neutral custom element и headless browser embed runtime/capture                                                                               | `apps/web/src/embed.ts`, web subjects и UI contracts дают embed/open lifecycle                                                           | **есть**                                                                              |
| `entity-cards`            | Game-neutral subjects, sections, fields, links, relation graph и card index                                                                             | `SubjectFactsSource`, `RelationGraphSource`, `packages/ui/card` и `packages/ui/graph`                                                    | **есть**                                                                              |
| `games`                   | Game catalog/registry, install probes/openers и Steam/Epic discovery; node Blizzard/CASC probe                                                          | `sdk/games` + host routing + SC2 provider: configured/default/registry; stores, другие игры и mount pending                              | **частично** — минимальный `PARITY-GAMES` vertical slice есть                         |
| `hex-viewer`              | Random-access pages, typed values, search, annotations и custom element                                                                                 | `packages/ui/hex`, `hex-editor` и SDK byte-range source                                                                                  | **есть**                                                                              |
| `image-processing`        | Image registry, DDS/TGA/PNG и plugin formats, GPU block decode, encoders, palettes, metadata и node texture tools                                       | PNG/JPEG/DDS работают; raster source и PNG writer provider существуют; остальные MK2 codecs в разной степени pending                     | **частично** — форматное и tooling-покрытие неполное                                  |
| `knowledge`               | Versioned knowledge/localization packs, deterministic fallback, provenance queries и agent bridge                                                       | Эквивалентного пакета или contribution contract нет                                                                                      | **нет — нужно** (`PARITY-KNOWLEDGE`)                                                  |
| `language-contracts`      | Document-kind routing и registry language contributions/modules/checks                                                                                  | `sdk/language` + host matcher/adapter дают типизированные routes и activation; Galaxy provider реально выдаёт tokens/diagnostics/symbols | **есть**                                                                              |
| `layouts-processing`      | Полный SC2Layout parser, expressions, schema reader/validation, hierarchy/index/workspace/xray и HTML projection                                        | `org.modkitx/sc2-layout` — port-pending, есть только общие text/tree contracts                                                           | **нет — нужно** (`PARITY-LAYOUTS`)                                                    |
| `localization-processing` | Semantic localization registry и SC2 locale-string adapter                                                                                              | `org.modkitx/sc2-strings` — port-pending                                                                                                 | **нет — нужно** (`PARITY-LOCALIZATION`)                                               |
| `lsp`                     | Protocol-neutral document router, capability merge, watched-file routing и headless checks                                                              | Protocol-neutral route и headless analysis есть; transport/server, capability merge, workspace index и watched files ещё нет             | **частично** — минимальный `PARITY-LSP` contract есть, полный host ещё нет            |
| `maps-processing`         | Не только map codec: HeightMap, cliff/terrain params, regions, objects, minimap-related data, AI/bank/includes и прочие внутренние файлы SC2Map         | `org.modkitx/sc2-map` — port-pending; MPQ умеет лишь дать байты entries                                                                  | **нет — нужно** (`PARITY-MAPS`)                                                       |
| `models-processing`       | Registry/open service, decoded render model, textures, materials, skeleton/animations, effect simulation и asset resolver                               | OBJ/glTF codecs и model source; M3/M3A публикует metadata-only scene                                                                     | **частично** — нет decoded M3 render model/effects/sidecars                           |
| `mods-processing`         | SC2 mod reader, dependency resolver, metadata cache, entities, bank list, game-data order, locale/font styles                                           | `org.modkitx/sc2-mod` — port-pending; namespace сам по себе зависимости не разрешает                                                     | **нет — нужно** (`PARITY-MODS`)                                                       |
| `rendering-3d`            | Renderer registry и полноценные WebGL/Three/WebGPU/headless backends; terrain, battle scene, particles/ribbons, skinning и compressed textures          | `sdk/renderer` + host activation и reference software RGBA backend дают общий renderer plane; production GPU backends и SC2 features нет | **частично** — минимальный `PARITY-RENDERER` contract есть, полный renderer ещё нет   |
| `replays-processing`      | Semantic replay registry и injected SC2 playback adapter                                                                                                | `org.modkitx/sc2-replay` — port-pending; generic transport не декодирует replay                                                          | **нет — нужно** (`PARITY-REPLAYS`)                                                    |
| `runtime`                 | Game-neutral provider registry, sessions, snapshots/events, clocks, cancellation и budgets                                                              | `sdk/runtime` + host activation дают leased budgeted sessions и structured refusal; snapshots/events/clock ещё не перенесены             | **частично** — минимальный `PARITY-RUNTIME` contract есть, полный runtime ещё нет     |
| `saves-processing`        | Save registry и SC2 bank adapter                                                                                                                        | `org.modkitx/sc2-bank` — port-pending                                                                                                    | **нет — нужно** (`PARITY-SAVES`)                                                      |
| `scripts-processing`      | Script registry/operations, codec identity и полноценная in-memory TriggerStore model                                                                   | Text codecs/syntax providers и Galaxy language analysis есть; Triggers envelopes pending                                                 | **частично** — нет TriggerStore и полной SC2 script semantics                         |
| `semantic`                | Game-neutral registries/contracts по data/documents/layouts/localization/maps/mods/replays/saves/scripts                                                | SDK/Host contribution, trait и service registries дают общий механизм, но доменные semantic contracts перенесены не все                  | **частично**                                                                          |
| `tsconfig`                | Два publishable TypeScript preset для вынесенных extension repositories                                                                                 | Единый `tsconfig.base.json` достаточен внутри текущего монорепозитория                                                                   | **нет — не нужно** — понадобится только при реальном выносе extensions                |
| `vector-processing`       | SVG path `d` parser/serializer, node/handle geometry и transforms для редактирования                                                                    | SVG inspection/vector scene есть                                                                                                         | **частично** — path editing model/serializer отсутствует                              |
| `vfs`                     | Mounts, overlays, cache storage и providers memory/http/git/GitHub/browser-file/file                                                                    | Portable VFS и bounded file/memory providers теперь есть; Host namespace bridge работает                                                 | **частично** — нет overlay/cache/http/git/GitHub/browser-file providers               |
| `video-processing`        | Video registry, metadata/playback hints, WASM decoder, frame extraction и transcode/export                                                              | MP4/WebM codecs, encoded/video source и transport snapshot                                                                               | **частично** — decode/frame/transcode providers отсутствуют                           |
| `viewer-shell`            | Framework-free chrome, slots/actions/metadata/diagnostics, panels, splitters и persisted layout                                                         | `packages/ui/shell`, `panels`, `metadata`, `explorer`, `workbench`                                                                       | **есть**                                                                              |
| `workbench`               | Command catalog/parser/completion, lazy handlers/runtime и testing harness; Monaco bridge                                                               | UI workbench существует, но общего command catalog/parser/runtime нет                                                                    | **частично**                                                                          |
| `world`                   | Canonical roots, compatibility envelope, deterministic hashing и Multiverse linker/scheduler                                                            | Эквивалента нет; subject identity/revision покрывает только часть canonical addressing                                                   | **нет — нужно** (`PARITY-WORLD`)                                                      |
| `xml`                     | SC2 XML parser плюс positional scanner/parser с source ranges и diagnostics                                                                             | XML codec и syntax provider умеют inspection/editing текста                                                                              | **частично** — нет общего positional XML AST/parser API                               |

## Итог

- Проверено: **34 runtime/library-пакета + 1 build preset**.
- **есть:** 8.
- **частично:** 17.
- **нет — нужно:** 9.
- **нет — не нужно:** 1.

Contract-этап Block 5 / 1 и первый вертикальный `PARITY-GAMES` slice закрыты. Следующий проход —
`PARITY-MODS`, затем `data → maps`, потому что отдельный map codec без dependency resolver и data
schema повторит только имя MK2-поверхности, а не её поведение.
