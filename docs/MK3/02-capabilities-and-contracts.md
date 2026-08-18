# 02. Traits, Codec Capabilities, and Contracts

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Сначала развести термины

**Финальный словарь (BRIEF-6).** В нормативном wire-словаре слово `capability` не используется:
traits называются traits, operations — operations, предоставляемые contracts — offers,
разрешения — permissions, возможности среды — facilities. `capability` остаётся только
UI/объяснительным umbrella-термином и legacy-именем текущих полей
(`codec.manifest.json#capabilities` — coarse manifest verbs; `CapabilityInstance`/`CAPABILITY_IDS`
— текущие TypeScript-имена trait-типов, мигрирующие в `TraitInstance`/`TRAIT_IDS`). Малый
публичный словарь платформы: `Subject`, `SourceBinding`, `Interpretation`, `Representation`,
`FormatDefinition`, `TraitRecord`, `Contract`, `Operation`, `Contribution`, `HostFacility`;
`AssetDescriptor` не является отдельным фундаментом — asset это subject c `SourceBinding`,
representations и traits (typed records, не giant DTO).

Нужно различать:

1. **Trait** — какие observable data доступны у subject. В текущем API это
   `AssetDescriptor.traits`; текущие TypeScript names `CapabilityInstance`/`CAPABILITY_IDS`
   механически мигрируют в `TraitInstance`/`TRAIT_IDS`.
2. **Codec capability** — coarse manifest verb: codec умеет read/write/inspect и т. п. Это текущее
   поле `codec.manifest.json.capabilities`, не typed API.
3. **Provider contract** — какой заменяемый typed runtime service требуется для получения
   результата.
4. **Operation** — конкретное исполняемое действие с mutability/permissions/outputs.
5. **Facility** — host service, например brokered filesystem/network/GPU access.
6. **Permission** — разрешение на side effect; оно никогда не выводится из trait/capability.

Пример M3:

```text
Provider contract: org.modkitx.contracts/m3-open (provisional)

Output traits:
  model.geometry
  model.materials
  model.skeleton
  model.animations
  scene.effects
```

Viewer сопоставляется по trait `model.geometry`, а asset host для открытия/проекции разрешает
provider contract `org.modkitx.contracts/m3-open`. Отсутствие trait в сегодняшнем manifest означает «не
объявлено», а не
«формат этого не поддерживает»: backfill пока неполон.

## 2. Почему нельзя использовать только codec ID

Codec ID идентифицирует implementation package. Он не является стабильным API:

- reference implementation может быть заменена WASM или native provider;
- разные providers поддерживают разные environments;
- inspect-only provider может не предоставлять animations;
- private repository может предоставить совместимую реализацию;
- provider может быть quarantined или запрещён policy.

Exact ID остаётся только для implementation-specific integration.

## 3. Current standard и gated candidate trait families

Current standard set равен текущему `CAPABILITY_IDS`; он должен оставаться небольшим и расширяемым.
Идентификаторы ниже, которых ещё нет в этом списке (`property.graph`, `ui.*`, `code.syntax-tree`,
`state.*` и cross-game candidates), являются Proposal vocabulary, а не уже принятым standard.
Если наблюдаемая семантика уже имеет standard trait, contribution обязана использовать его.
Extension может раньше зарегистрировать qualified namespaced trait: незнающий consumer сохраняет
его opaque, а specialized contribution вправе явно потребовать этот registered ID. Generic platform
routing использует только standard set до schema/conformance promotion; регистрация custom trait не
является таким promotion. Блоки ниже являются representative vocabulary, а не второй полной копией
текущего catalog; measured source of truth остаётся в коде/generated trait index. Это решение Q80;
его implementation остаётся за BRIEF-13A gates.

### General

```text
content.metadata
content.binary
content.text
content.images
content.scripts
content.thumbnails
structure.hierarchy
structure.nodes
structure.timeline
```

### Images and vector

```text
image.raster
image.frames
image.channels
image.mipmaps
image.subresources
image.palette
vector.scene
vector.paths
```

### Audio/video/media

```text
audio.streams
audio.waveform
audio.loop-points
video.streams
video.tracks
media.duration
media.frames
```

`media.seekable` в текущем `CAPABILITY_IDS` является migration debt: возможность seek определяется
operation/session offer и не должна следовать из data trait. До v2 adapter сохраняет legacy ID, но
новые consumers запрашивают timeline data отдельно от операции seek.

### Documents/data

```text
document.flow
document.pages
document.outline
document.annotations
table.sheets
table.cells
table.formulas
presentation.slides
property.graph
ui.document
ui.tree
ui.template
ui.layout
ui.styles
ui.bindings
ui.action-declarations
ui.timeline
```

Здесь `ui.action-declarations` означает наблюдаемые authored declarations, а не право выполнить
действие. Preview context, runtime plan и active UI instance являются projection/session contracts,
не traits исходного UI subject.

### Models/scenes

```text
model.geometry
model.materials
model.textures
model.skeleton
model.animations
model.lods
scene.objects
scene.cameras
scene.lights
scene.effects
```

### Containers/workspaces

```text
container.entries
container.directories
container.nested
container.overlay
source.dependencies
```

Asset/subject indexes и reference graph предоставляются workspace services/projections. Их наличие
и query operations не кодируются traits каждого workspace subject.

### Language and semantic data

```text
code.source
code.syntax-tree
game.catalog
game.localization
game.map
game.replay
```

Diagnostics, completion, hover, navigation, rename и formatting являются language-provider
operations. `code.syntax-tree` остаётся trait, когда subject действительно экспонирует наблюдаемое
структурированное дерево независимо от конкретного language session.

### Runtime/state data

```text
state.snapshot
state.timeline
```

Snapshot/timeline могут быть observable data subjects. Runtime session, presentation view, command
input и UI runtime instance являются handles/contracts/operations и в trait vocabulary не входят.
`multiverse.world/core`, optional foundation profiles,
`blizzard.sc2/*` и подобные World profiles являются отдельными versioned provider/ABI contracts, а
не полями одного trait descriptor. `movement`, `health` или `pathfinding` без explicit semantic
profile не
являются достаточным World contract request. Полная граница описана в
[20-world-api-abi-and-multiverse-integration.md](20-world-api-abi-and-multiverse-integration.md).

Этот список не является закрытым enum для extensions. Новые cross-game candidates вводятся сначала
как extension traits с реальным routing consumer и только затем проходят promotion rule из §13.
Полезный candidate vocabulary, который нельзя объявлять standard заранее:

```text
spatial.bounds
spatial.transform
spatial.placements
terrain.heightfield
terrain.surface
terrain.material-layers
navigation.topology
navigation.cost-field
localization.plurals
localization.markup
model.collision
model.attachments
model.voxels
audio.events
audio.banks
```

`sprite.frames` не вводится, потому что его покрывает `image.frames`; `game.entities` дублирует
subjects, `game.tech-tree` обычно является derived relation graph/projection, а save state выражается
общим `state.snapshot`.

## 4. Package ownership

Ownership v1 следует текущему canonical contract:

```text
@modkitx/assets
  TRAIT_IDS, TraitInstance, trait/operation descriptors
  operation-provider resolver contracts

@modkitx/*-processing
  reusable algorithms

bundled-common or independent extension repository
  definitions/traits/<id>, definitions/contracts/<id>
  custom definitions and typed implementations
```

Portable domain DTOs остаются в своих browser-safe processing/contract subpaths. Отдельный
`@modkitx/capabilities` **не создаётся в v1**: он добавил бы package/migration до появления реальной
dependency problem. Возможный future package допускается после измеримого bundle/ownership pressure
и должен быть compatibility extraction, а не новая параллельная taxonomy.

Текущий import:

```ts
import type { TraitInstance } from '@modkitx/assets/traits'
```

Root export не должен реэкспортировать все domains и увеличивать browser bundle.

Extension-specific typed services описываются namespaced contracts рядом с extension SDK/schema;
они не превращаются в `TraitInstance` только потому, что могут быть вызваны у subject.

### Capability scopes

```text
source        доступ к bytes/path/ranges и source metadata
asset         данные, полученные из artifact source
subject       свойства logical entity, document part или aggregate
workspace     indexes, dependency graph и cross-subject services
service       reusable stateless/stateful runtime service
operation     transient data/API одного request или transaction
view-session  transient presentation/playback/navigation state
```

Scope ограничивает lifetime и допустимые dependencies, но не является closed taxonomy.
`view-session` не должен случайно сериализоваться в source. Provider contract и error
definition остаются отдельными registry types и не маскируются capability.

## 5. Extension-defined trait (target manifest support)

Runtime `CapabilityId` уже допускает custom string, но текущий codec manifest принимает
`KnownCapabilityId`. Поэтому следующий пример — target schema, а не реализованная возможность.

```json
{
  "$schema": "https://schemas.modkitx.org/trait-definition.v1.json",
  "schemaVersion": 1,
  "id": "org.modkitx.blizzard.starcraft-2.unit-stats",
  "version": "0.1.0",
  "scope": "subject",
  "parametersSchema": "./unit-stats.parameters.schema.json",
  "transport": "structured-clone",
  "documentation": "./UNIT_STATS.md"
}
```

Target typed helper может вернуть descriptor instance, но не runtime service API:

```ts
export const Sc2UnitStats = defineTrait<Sc2UnitStatsSummary>({
  id: 'org.modkitx.blizzard.starcraft-2.unit-stats',
  version: '0.1.0',
  scope: 'subject',
})
```

## 6. Registry validation

Extension-trait registry обязан проверять:

- well-formed qualified ID;
- publisher ownership;
- unique `(id, version)`;
- valid scope;
- schema availability;
- transport declaration;
- browser-safe definition entrypoint;
- incompatible duplicate definitions;
- dependency cycles в definition imports;
- documentation/provenance/license metadata.

Unknown extension trait сохраняется как opaque descriptor. До регистрации он не удовлетворяет ни
один route. После регистрации generic host может показать metadata/schema, а specialized
contribution — явно потребить ID и загрузить typed SDK.

Целевая архитектура допускает definitions из независимых extension repositories. До появления
registry custom traits не участвуют в routing вообще; после появления registry они участвуют только
в explicit specialized routing. Generic routing остаётся standard-only: добавление standard trait
через PR в `TRAIT_IDS` является promotion/migration mechanism, а не обязательной архитектурой для
third-party traits.

## 7. Версионирование

Нужно различать независимые координаты:

| Координата               | Назначение                                                                   |
| ------------------------ | ---------------------------------------------------------------------------- |
| extension version        | Установка, обновление и bundle integrity                                     |
| provider version         | Версия конкретной native/WASM/TypeScript реализации                          |
| contract version         | Совместимость typed runtime API/schema                                       |
| trait definition version | Future semantic/schema version в definition registry                         |
| trait descriptor schema  | `descriptorVersion: 1`; версия envelope, не SemVer semantics                 |
| runtime variant          | Environment/architecture implementation одного provider                      |
| provider-policy lock     | Переносимый logical provider/major и допустимые fallbacks                    |
| install lock             | Exact acquired target artifacts, digests и provenance                        |
| session composition      | Exact semantic content/runtime composition для restore/network compatibility |

OS, architecture, ABI, browser/Node/native environment и host features не являются
версиями. Это отдельный `RuntimeTarget`, по которому фильтруются implementation variants.
Одна extension/provider version может публиковать несколько target-specific artifacts, а
другая extension — совместимый port того же contract. Полная модель приведена в
[18-provider-augmentation-targets-and-ranking.md](18-provider-augmentation-targets-and-ranking.md).

Consumer requirement provider contract и future trait definition использует SemVer range:

| Requirement              | Значение                               |
| ------------------------ | -------------------------------------- |
| поле отсутствует или `*` | Любая совместимая установленная версия |
| `=1.2.3`                 | Только точная версия                   |
| `^1.2`                   | Совместимая версия того же major       |
| `>=1.2 <2`               | Явный диапазон                         |
| `>=1.2`                  | Не ниже указанной                      |
| `<2`                     | Ниже указанной границы                 |

Bare `1` не используется как range: он слишком легко смешивается с exact version или
major shorthand. В prose и коротких examples суффикс `@1` можно опускать. Отсутствие
version у consumer нормализуется в `*`; definition/provider всегда публикует exact
SemVer, включая draft versions `0.x`; provider-policy lock фиксирует logical provider major, install
lock — exact artifact release, а session composition — exact compatibility identity.

- Добавление optional parameter совместимо в текущей major contract version.
- Изменение смысла, units, cardinality или mutability создаёт новую major version.
- Provider может одновременно реализовать несколько contract versions/ranges.
- Несовместимые versions могут сосуществовать через adapters или отдельные offers.

## 8. Trait state

```ts
type TraitState = 'available' | 'partial' | 'disabled' | 'dependency-required'

interface TraitInstance<TParameters = unknown> {
  readonly id: TraitId
  readonly descriptorVersion: 1
  readonly definitionVersion?: string
  readonly state: TraitState
  readonly parameters?: TParameters
  readonly diagnosticIds?: readonly string[]
}

interface TraitRequirement {
  readonly id: TraitId
  readonly definitionRange?: string
  readonly states?: readonly TraitState[] // default: ['available']
}
```

### 8.1 Declaration, evidence, probe и observed instance

Эти четыре состояния знания нельзя сериализовать одним authored `ManifestTraitClaim`. У них разные
владельцы, жизненный цикл и ключи инвалидации:

```ts
type TraitPresence = 'may-expose' | 'will-expose'

interface TraitDeclaration {
  readonly id: TraitId
  /** Exact definition selected by the producer; consumers use a range. */
  readonly definitionVersion?: string
  readonly representation: 'source' | 'compiled' | 'runtime'
  readonly presence: TraitPresence
  readonly prerequisites?: readonly ContractRequirement[]
  readonly evidenceRefs?: readonly string[]
}

interface TraitEvidenceRecord {
  readonly id: string
  readonly trait: TraitId
  readonly extensionRelease: string
  readonly provider: string
  readonly contract: ContractRef
  readonly targetClass: RuntimeTargetConstraint
  readonly dependencyDigest: string
  readonly corpusDigest: string
  readonly strength: 'asserted' | 'fixture' | 'corpus'
  readonly result: 'pass' | 'partial' | 'fail'
}

interface ProbedTraitAvailability {
  readonly trait: TraitId
  readonly provider: string
  readonly runtimeVariant: string
  readonly inputRevision: string
  readonly result: 'available' | 'partial' | 'unavailable'
  readonly diagnosticIds?: readonly string[]
}
```

Ownership/lifecycle:

```text
TraitDeclaration          authored release metadata
TraitEvidenceRecord       generated publication/conformance evidence
ProbedTraitAvailability   machine-local activation cache
TraitInstance             observed subject/runtime descriptor
```

Routing rules:

- `may-expose` используется для shortlist, soft alternate и install suggestion, но не закрывает
  hard singleton requirement;
- `will-expose` разрешает planning только после совпадения detector/profile и всех объявленных
  prerequisites;
- probed result выбирает interpretation/input plan, но не притворяется observed data;
- hard execution и окончательный viewer/editor match требуют observed offer/operation, policy и
  grant; declaration/evidence сами по себе не являются исполнимой capability;
- отсутствие manifest claim означает `undeclared`, не `unsupported`;
- отсутствие observed trait означает `not-observed`, пока descriptor не объявил completeness для
  соответствующей query/family.

Evidence не меняет presence: большая corpus может хорошо доказать `may-expose`, но не превратить
optional data в гарантию. Evidence инвалидируется при изменении owning extension release, provider,
contract major, target class, dependency digest или corpus digest. Probe инвалидируется независимо
при изменении runtime variant, host facilities/dependencies или input revision. Fidelity принадлежит
только observed `TraitInstance`, а не authored declaration.

Текущее `CapabilityInstance.version: 1` является версией старого descriptor envelope, а не SemVer
trait. В v2 `Capability*` переименован в `Trait*` без compatibility re-export, поле envelope стало
`descriptorVersion`, а custom trait связывается с exact `definitionVersion`. Producer declaration и
observed instance несут exact version; consumer requirement/query несёт `definitionRange`.

Для `partial`, `disabled` и `dependency-required` обязательна structured diagnostic.

Пример inspect-only M3 provider:

```json
{
  "id": "model.animations",
  "descriptorVersion": 1,
  "state": "partial",
  "parameters": { "metadataOnly": true },
  "diagnosticIds": ["m3.animation-payload-unavailable"]
}
```

## 9. Trait query

Target TypeScript names use `Trait*`; current `Capability*` names are migration inputs, not a second
long-lived vocabulary.

```ts
interface TraitQuery {
  readonly all?: readonly TraitRequirement[]
  readonly any?: readonly TraitRequirement[]
  readonly none?: readonly TraitRequirement[]
  readonly preferred?: readonly TraitRequirement[]
}
```

Query используется:

- provider resolver;
- viewer/editor selection;
- asset completion;
- projection discovery;
- install suggestions;
- test conformance.

## 10. Operations отдельно

Trait не должна содержать скрытую гарантию редактирования.

```text
table.cells          — клетки читаются
edit.field           — отдельное поле можно изменить
edit.structure       — строки/sheets можно добавлять или удалять
source.save          — изменения можно записать в исходный source
source.save-as       — можно экспортировать новый source
```

Read-only XLSX и editable XLSX имеют одинаковые data traits, но разные
operations.

## 11. Provider contracts

Contract definition:

```json
{
  "schemaVersion": 1,
  "id": "org.modkitx.contracts/m3-open",
  "version": "0.1.0",
  "input": {
    "contract": "common.asset/input",
    "version": "*"
  },
  "requiredOutput": [{ "id": "model.geometry", "version": "*" }],
  "optionalOutput": [
    { "id": "model.materials", "version": "*" },
    { "id": "model.skeleton", "version": "*" },
    { "id": "model.animations", "version": "*" },
    { "id": "scene.effects", "version": "*" }
  ],
  "conformanceSuite": "common.conformance/m3-open-draft"
}
```

Contract owner не обязан быть provider owner. Это позволяет independent
implementations подтверждать совместимость.
`org.modkitx.contracts/m3-open` — provisional ID владельца specification/conformance suite, а
`blizzard.m3` — отдельная native format identity. Универсальный потребитель не запрашивает
M3-specific chunks через него: renderer/viewer использует отдельную проекцию
`common.render/scene-3d`. Third-party provider может реализовать M3 contract без принадлежности к
owning extension, если проходит опубликованный conformance suite. Окончательный authority/ID должен
быть подтверждён ID-governance proof до попадания в locks или сохранённые sessions.
В extension-manifest v2 owner хранит addressable fixtures под
`definitions/contracts/<id>/conformance/`; provider evidence ссылается на stable suite ID/hash и не
импортирует runtime code владельца.

### 11.1 Method surface — Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable)

Contract definition (обе ветки `data-source`/`service`) может нести `surface`: данные о том, как
вызывается объект контракта за границей исполнения — `methods{ name → kind, signal, arity, optional,
result, wrapper, limits }`, `releaseVia`, `fields`. Kinds: `value`, `lease`, `leased-value`,
`iterable`, `events`. Surface — единственный источник, из которого host, транспорты и приложения
выводят прокси; собственных списков методов у них нет. Стандартные data‑source surfaces живут в
`@modkitx-x3/sdk` и пришпилены к ABI‑интерфейсам типом. Слово `capability` в wire‑словаре и ключах
схем отсутствует (решение 57). Полное описание — документ [32](32-execution-boundary-and-method-surfaces.md) §2–§3, решение — [ADR‑HOST‑001](adr/ADR-HOST-001-capability-rpc-and-method-surfaces.md).

## 12. Suggested contract families

```text
common.format/<id>-detect
common.format/<id>-open
common.format/<id>-write
common.compression/<algorithm>-decode
common.compression/<algorithm>-encode
common.transcode/audio
common.transcode/video
common.render/scene-3d
common.render/document-page
common.render/game-ui
common.language/<language>-syntax
common.language/<language>-semantic
common.workspace/<game>-resolve
common.runtime/world-session
multiverse.profile/<profile>
multiverse.world/system
common.ui/layout-open
common.ui/layout-render
```

Не следует создавать contract для каждой функции, если они всегда поставляются
одной согласованной session. Слишком мелкие contracts усложняют solver.

## 13. Promotion extension trait в standard

Trait становится standard после выполнения всех условий:

1. минимум два независимых providers;
2. минимум два независимых consumers;
3. семантика стабилизировалась;
4. нет game/vendor-specific types;
5. определены transport и versioning rules;
6. существует conformance fixture.

До этого она остаётся в namespace extension.

## 14. Anti-patterns

- `UniversalCodec` с десятками optional methods.
- Trait ID, совпадающий с React component или VS Code view type.
- Extension trait definition без semantic version/schema после появления definition registry.
- `supportsX: boolean` вместо trait/operation/contract с ясной семантикой.
- Direct import provider package из consumer codec.
- Выбор provider по display name.
- Автоматическое повышение extension capability в core после одного use case.
