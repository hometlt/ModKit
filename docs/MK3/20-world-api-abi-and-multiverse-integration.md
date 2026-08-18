# 20. World API/ABI and Multiverse Integration

Status: **non-canonical proposal / discussion draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; document 26 owns the World normative-candidate block**  
Scope: первая версия расширяемого игрового World API/ABI, его package ownership,
подключение к Modkit и поэтапная миграция текущих `engine`/`sim`/`sc2-runtime`.

Relevant canonical/draft owners also include
[Multiverse Engine](../multiverse/engine/ARCH_MULTIVERSE_ENGINE.md) и
[Implementation Status](../IMPLEMENTATION_STATUS.md). Этот обзор не объявляет уже реализованными
standalone packages, IDL, ABI или универсальный kernel.

Этот документ остаётся архитектурным обзором. Детальная выбранная модель handles, storage,
scheduler, commands/events, domains, clocks, snapshots/replay и minimal v1 находится в
[26-world-state-scheduler-snapshots-and-domains.md](26-world-state-scheduler-snapshots-and-domains.md).

## 1. Решение в одном абзаце

`World API/ABI` не является asset codec и не входит в `@modkitx/core`. Это целевой независимый
versioned contract Multiverse для мира, definitions, runtime components, commands,
queries, events, systems и script imports. Первая proof implementation — минимальный target-native
Multiverse G0; текущий SC2 runtime codec служит parity oracle и источником алгоритмов, но не
временным owner. Физические `@multiverse/*` packages следуют split rule ROADMAP_ENGINE §3. Game extensions не добавляют
поля в giant `Entity` DTO: они используют совместимые neutral contracts либо регистрируют
game-specific profiles, component schemas, definition facets, operations, events, systems и
bindings через public ABI. Совпадающее бытовое название механики не считается доказательством
совместимости её semantics.

## 2. Почему World API не должен быть частью Modkit core

`@modkitx/runtime` описывает lifecycle любой stateful execution session: clock,
execute, events, diagnostics, snapshot/restore, cancellation и budgets. Он полезен для
game simulation, document macros, shader preview и других runtimes.

World contract уже по назначению и богаче по данным:

- entity/definition handles;
- runtime component stores;
- deterministic tick phases;
- world queries, commands и events;
- player/team/world state;
- simulation systems;
- script host imports;
- deterministic snapshot/hash/replication requirements.

Если эти типы поместить в `@modkitx/core` или `@modkitx/runtime`, image/archive/document
hosts получат ненужную game dependency. Если поместить Modkit types в Multiverse Engine,
движок нельзя будет использовать как standalone Rust/WASM/native library.

Целевая ownership схема после прохождения gate:

```text
@modkitx/core
  errors, diagnostics, generic lifecycle

@modkitx/runtime
  generic RuntimeProvider/RuntimeSession control plane

@multiverse/world-contracts
  standalone logical World API + IDL/schema + generated ABI types

@multiverse/engine
  standalone simulation implementation

independent modkit-extension-multiverse-runtime/runtime-providers/multiverse-runtime
  adapter: @multiverse/engine <-> @modkitx/runtime
```

До G0 минимальная target-native World implementation владеет v0, `@modkitx/runtime` — generic
Modkit session control plane, а SC2 runtime codec остаётся внешним oracle. Public dependency
direction проверяется в proof; package boundaries создаются только там, где проходят split rule.

## 3. Что уже реализовано и переиспользуется

Первая версия не начинается с пустого места:

- [`@modkitx/runtime`](../../packages/runtime/src/contracts.ts) уже содержит provider,
  session, deterministic clock, events, diagnostics и snapshot/restore contracts;
- [`SimCommandQueue`](../../extensions/blizzard/starcraft-2/codecs/sc2-runtime/src/sim/commands.ts) уже сортирует команды по
  `(tick, player, seq)` независимо от arrival order;
- [`SimEventQueue`](../../extensions/blizzard/starcraft-2/codecs/sc2-runtime/src/sim/events.ts) уже отделяет игровые события от
  непосредственного исполнения Galaxy triggers;
- [`SimWorld`](../../extensions/blizzard/starcraft-2/codecs/sc2-runtime/src/sim/world.ts) уже владеет tick, command/event queues,
  diagnostics и fixed tick rate;
- [`SimEngine`](../../extensions/blizzard/starcraft-2/codecs/sc2-runtime/src/sim/sim-engine.ts) уже выполняет systems в фиксированном
  порядке и поддерживает snapshot/hash;
- current replay-player [`SceneFrame`](../../extensions/blizzard/starcraft-2/codecs/sc2-replay/src/player-core/scene.ts) extraction уже
  выдаёт reusable typed arrays, поэтому presentation proof не нужно начинать с нового renderer DTO;
- [`sc2-runtime`](../../extensions/blizzard/starcraft-2/codecs/sc2-runtime/) уже адаптирует
  Galaxy/SC2 simulation к `RuntimeSession` и имеет Node/browser-worker variants;
- `EngineProgram` и Galaxy/Trigger lowerers уже являются основой SC2 script runtime IR; имя файла
  `ast.ts` не делает этот IR универсальным.

Текущие ограничения становятся migration targets, а не поводом для rewrite:

- `SimEvent.payload` использует `GalaxyValue`;
- `SimWorld` оборачивает `GalaxyGameState`;
- `SimCommand` содержит SC2/RTS-specific union;
- provider registry пока создаёт session по exact ID;
- systems не объявляют формально read/write sets, profile imports и ABI versions.

## 4. Control plane и data plane

```text
Modkit/provider resolver                 Multiverse hot runtime
------------------------                 -----------------------
discover extensions                     numeric component ids
resolve versions/targets                 packed command/event buffers
check trust/permissions                  pre-linked system dispatch
assemble definitions/world/scripts  ->   deterministic tick loop
compile and lock session plan            typed component storage
load selected implementation             snapshot/hash
```

Resolver, manifests, strings и capability lookup не вызываются внутри per-entity или
per-tick hot loop. Session стартует только после компиляции immutable
`WorldCompositionPlan`.

## 5. Root runtime и расширения

В одной world session ровно один root runtime владеет:

- clock и tick;
- entity allocator;
- component storage;
- command/event queues;
- scheduler;
- snapshots и state hash;
- resource budgets и disposal.

Этот список является почти всем обязательным kernel. В нём нет встроенных `Unit`, `health`,
`shields`, `movement`, `pathfinding`, `weapon`, `resource` или `RTS` rules. Даже часто
используемые mechanics поставляются поверх kernel обычными versioned extensions.

Поддерживаемые наборы публикуются под `multiverse/foundations/<foundation-id>` как presets из
меньших mechanic contributions, а не как один привилегированный foundation package. Например, RTS
preset может выбрать spatial, ownership, vitals, movement, orders, combat, resources и production
contracts/providers, но пользователь или game profile вправе подключить его частично, заменить
provider либо не устанавливать вообще. Root runtime не проверяет identity preset по имени; он
проверяет только World ABI, composition plan и declared obligations.

Остальные contributions не являются конкурирующими владельцами мира:

| Contribution           | Назначение                                              |
| ---------------------- | ------------------------------------------------------- |
| `world-profile`        | Versioned vocabulary компонентов, operations и events   |
| `definition-adapter`   | Native catalog/data -> neutral definitions/facets       |
| `world-adapter`        | Native map/world -> neutral world representation        |
| `script-lowerer`       | Native AST/semantic model -> runtime IR/imports         |
| `script-host`          | Galaxy, Lua, JASS, WASM или другой execution host       |
| `simulation-system`    | Movement, combat, production или game-specific mechanic |
| `runtime-augmentation` | Дополнительный component/system/profile bundle          |
| `render-extractor`     | World state -> presentation snapshot                    |
| `replay-adapter`       | Replay inputs/tracker frames -> commands/corrections    |

Root runtime может быть заменён другой совместимой реализацией. Augmentations должны
зависеть только от versioned World ABI, а не от private classes root implementation.

## 6. World profiles

Один giant universal API запрещён. `multiverse.world/core` обязателен в целевом контракте,
остальные contracts/profiles
опциональны и могут собираться preset-ом:

```text
multiverse.world/core
  handles, lifecycle, tick, RNG, commands, events, snapshots

multiverse.world/presentation
  read-only presentation snapshots and event bridge

multiverse.world/spatial
multiverse.world/ownership
multiverse.vitals/single-pool
multiverse.motion/planar
multiverse.motion/volumetric
multiverse.navigation/grid-2d
multiverse.navigation/navmesh
multiverse.navigation/volume-3d
multiverse.foundation/rts
  optional neutral contracts commonly bundled by foundation, not kernel

blizzard.sc2/profile
opensource.spring/profile
org.modkitx.opensource.warzone-2100/profile
ea.sage/profile
  game/engine-specific additions
```

Profile имеет собственную версию и может требовать другие profiles:

```ts
interface WorldProfileDescriptor {
  readonly id: string
  readonly version: string
  readonly requires?: readonly ContractRequirement[]
  readonly components?: readonly ComponentSchemaRef[]
  readonly operations?: readonly WorldOperationRef[]
  readonly events?: readonly WorldEventRef[]
  readonly determinism: 'required' | 'presentation-only' | 'host-defined'
}
```

Потребитель может запросить, например, `multiverse.navigation/grid-2d` major `1` range `^1`, не
зная, какая
extension предоставит implementation. Точное extension/provider/runtime variant фиксируется
lock. Request к `movement` без semantic profile недостаточен: planar movement над grid,
continuous navmesh steering и true 3D flight являются разными contracts.

## 7. Extensible components вместо giant Entity DTO

Runtime state разделяется по scope:

```ts
type WorldComponentScope = 'entity' | 'player' | 'team' | 'world' | 'session'

interface WorldComponentDefinition {
  readonly id: string
  readonly version: string
  readonly scope: WorldComponentScope
  readonly schema: SchemaRef
  readonly schemaHash: string
  readonly semanticsProfile: ContractRequirement
  readonly storage?: ComponentStorageHint
  readonly deterministic: boolean
  readonly snapshot: 'required' | 'derived' | 'excluded'
  readonly replication: 'input-only' | 'state' | 'presentation' | 'none'
}
```

Definitions используют параллельный механизм `DefinitionFacetDefinition`: runtime
component описывает изменяемое состояние instance, facet — immutable/default данные
definition.

Нужно различать три identity:

1. **component/facet contract** — ID, major version, schema hash и semantics;
2. **system implementation** — provider, который читает/изменяет этот contract;
3. **definition/data layer** — конкретные authored defaults и overlays игры/мода.

Root runtime создаёт одно storage на один resolved component contract. Два extensions,
зависящие от одного `multiverse.rts/shield-state` major `1`, видят один и тот же component, а не два поля
`shield`. Повторная декларация того же exact ID/version допустима только с тем же canonical
`schemaHash`; другой hash является catalog error. Provider version при этом может отличаться от
component contract version.

Примеры:

| Игра               | Definition facet                         | Runtime component                               |
| ------------------ | ---------------------------------------- | ----------------------------------------------- |
| SC2                | max shields, regen delay/rate            | shared shield state + SC2 regen facet/component |
| Warzone 2100       | aircraft ammunition capacity/rearm rules | current ammunition/rearm state                  |
| SAGE               | front/side/rear armour coefficients      | current armour modifiers/damage state           |
| Простая RTS        | one life pool                            | current/max life                                |
| Fallout-like actor | body-part graph, part maxima and effects | per-part damage/cripple state                   |

Нейтральный contract создаётся только для сознательно зафиксированной минимальной semantics.
Например:

```text
multiverse.rts/shield-state, major 1
  current, maximum

blizzard.sc2/shield-regeneration   version: 1.x
  delay, rate, disabled-until-tick

org.modkitx.opensource.warzone-2100/aircraft-ammunition
ea.sage/directional-armour
```

SC2 extension может использовать общий `shield-state`, а свою regeneration semantics оставить
отдельным facet/component/system. Другая extension может заменить shield resolution system,
продолжая читать тот же state contract. Если её shields принципиально имеют другую модель
состояния, она публикует другой contract или новый major, а viewer лишь группирует оба в одну
presentation-секцию `Shield`.

То же правило применяется к movement, pathfinding и health:

| Бытовое понятие | Совместимые части                                             | Несовместимые части не склеиваются                                                |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Movement        | entity handle, transform query, velocity sample, move intent  | 2D plane, surface/navmesh, orbital/true 3D, teleport-only semantics               |
| Pathfinding     | request/result lifecycle, cancellation, path cost diagnostics | grid A*, navmesh, flow field, voxel/volume, external engine path service          |
| Health          | pool identity, current/maximum query, damage event envelope   | one unit pool, body-part graph, armour-only durability, wounds without hit points |
| Shields         | minimal current/maximum state when explicitly shared          | absorption order, damage types, regeneration, segmentation and overload rules     |

Promotion в neutral contract требует contract review, independent consumers и conformance
fixtures. Совпадающее имя поля, похожая карточка в UI или возможность конвертировать число не
доказывают одинаковую simulation semantics.

### 7.1 Models, render assets и runtime entity state

Game extension не добавляет gameplay state напрямую в common `RenderModel`:

- authored/static model data остаются в native model representation, `RenderModel`/UVM
  profile или namespaced model extension;
- изменяемое состояние instance остаётся World component;
- `render-extractor` связывает World components с presentation parameters/events;
- renderer получает compiled render asset и instance state, но не mutable simulation
  object.

Например, SC2 shield имеет definition facet и runtime component, а его bubble/impact visual
описывается model/effect profile либо presentation event. SAGE directional armour влияет на
damage system, но renderer может отдельно получить damage/decal parameters. Это сохраняет
`RenderModel` универсальным renderer-neutral representation и не превращает его в giant
game entity DTO.

## 8. Operations, queries и events

World API разделяет чтение и изменение:

```ts
interface WorldQueryDefinition {
  readonly id: string
  readonly version: string
  readonly input: SchemaRef
  readonly output: SchemaRef
  readonly access: readonly WorldAccessClass[]
  readonly batchable: boolean
}

interface WorldCommandDefinition {
  readonly id: string
  readonly version: string
  readonly input: SchemaRef
  readonly issuer: 'player' | 'script' | 'system' | 'host'
  readonly validation: 'required'
}

interface WorldEventDefinition {
  readonly id: string
  readonly version: string
  readonly payload: SchemaRef
  readonly visibility: 'synced' | 'scoped' | 'presentation'
}
```

Примеры shared и extension-specific additions:

```text
multiverse.rts/query-shield-state
multiverse.rts/modify-shield-state
multiverse.rts/shield-damaged

blizzard.sc2/reset-shield-regeneration-delay

ea.sage/query-directional-armour
ea.sage/apply-directional-damage
ea.sage/armour-segment-broken
```

Script frontend связывает native functions с operations явно. Имена функций не
сопоставляются эвристикой:

```text
Galaxy UnitCreate(...)       -> multiverse.world/spawn
Spring.CreateUnit(...)       -> multiverse.world/spawn
SAGE-specific armour call    -> ea.sage/apply-directional-damage
```

Если side effects неэквивалентны, lowerer оставляет game-specific operation или разворачивает
в проверенную последовательность common commands.

## 9. Systems и детерминированный scheduler

```ts
interface WorldSystemOffer {
  readonly id: string
  readonly version: string
  readonly mechanic: {
    readonly contract: ContractId
    readonly major: number
    readonly schemaDigest: string
    readonly behaviorDigest: string
  }
  readonly phase: WorldPhase
  readonly cadence?: { readonly everyTicks: number; readonly offsetTicks?: number }
  readonly mode: 'cooperative' | 'exclusive' | 'decorator' | 'adapter' | 'replacement'
  readonly slot?: string
  readonly replaces?: readonly ContractRequirement[]
  readonly orderKey: string
  readonly before?: readonly string[]
  readonly after?: readonly string[]
  readonly reads: readonly WorldAccessKey[]
  readonly writes: readonly WorldAccessKey[]
  readonly consumesEvents?: readonly ContractRequirement[]
  readonly emitsEvents?: readonly ContractRequirement[]
  readonly deterministic: true
  readonly implementation: RuntimeEntrypointRef
}
```

World v0 использует только занятые phases текущего `SimEngine`:

```text
input
update
event-delivery
```

Snapshot и presentation extraction являются host boundary operations, пока в них нет планируемых
systems. Profile может определить более точный порядок через dependencies, например `script`,
`navigation`, `movement`, `interaction` и `combat`, но не менять semantics kernel phase. Scheduler
проверяет cycles, write conflicts и deterministic order до старта session. Dynamic registration
после старта запрещена; смена composition требует reopen/restore через совместимый snapshot
migration.

`last loaded wins` запрещён. Mechanic identity равна contract+major+schema/behavior digests, а не
display name или похожему полю. `decorator` обязан назвать wrapped slot и ordering; `adapter` —
explicit source/target contracts; `replacement` — compatible slot и заменяемый provider. Эти режимы
не дают silent priority override и включаются только после соответствующего proof. Для
взаимозаменяемой mechanics объявляется stable exclusive
`slot`, например первый SC2 proof `blizzard.sc2/vitals-regeneration`. В одном composition plan слот получает ровно
одного implementation, выбранного resolver-ом или explicit `replaces`. Независимые systems
используют `cooperative`, разные IDs/subphases и declared read/write sets: shield damage,
regeneration, presentation extraction и UI binding не обязаны быть одним provider.
`exclusive`/`replacement` system обязан назвать slot; `cooperative` system не может неявно занять или
заменить slot. `replaces` действительно только внутри того же compatible slot contract/version.

Порядок самих data/profile extensions также не выводится из filesystem/install order. Manifest
объявляет `requires`, `extends`, `before`, `after`, `replaces` и optional layer/order key. Resolver
строит DAG, отклоняет cycles/conflicts и записывает exact linearization в
`WorldCompositionLock`, например:

```text
foundation -> game profile -> dependency mods -> map -> user patch
```

Definition overlays могут применяться в этой линейной последовательности. Замена executable
system всегда требует explicit slot/replacement rule и не происходит как побочный эффект data
overlay order.

Systems не получают ambient I/O, wall clock или private RNG. Они работают через scoped
world views, deterministic RNG streams и command/event buffers.

## 10. Execution domains и доступ

Spring/Recoil-подобное разделение фиксируется как общий contract:

```ts
type WorldExecutionDomain =
  'simulation-synced' | 'presentation-unsynced' | 'server-authoritative' | 'replay' | 'editor'

interface WorldAccessScope {
  readonly domain: WorldExecutionDomain
  readonly player?: WorldHandle
  readonly team?: WorldHandle
  readonly visibility: 'full' | 'allied' | 'observed' | 'public'
}
```

Presentation/UI code не получает mutable simulation view. User input возвращается в
simulation только как validated input/command и становится частью replay/network log.

## 11. Logical API и binary ABI (gated future)

После TypeScript World v0 и performance gate одна доказанная схема может стать source of truth. Из
неё тогда генерируются:

- TypeScript API types;
- JSON/structured-clone transport schemas для control plane и tests;
- Rust types;
- WASM host/import bindings;
- binary layout descriptors;
- conformance fixtures и validators.

Иллюстративные будущие ABI primitives:

```ts
type AbiTypeId = number
type AbiOperationId = number
type AbiEventTypeId = number

interface WorldHandle {
  readonly index: number
  readonly generation: number
}

interface WorldCommandEnvelope {
  readonly tick: number
  readonly issuer: WorldHandle | null
  readonly sequence: number
  readonly operation: AbiOperationId
  readonly payload: Uint8Array
}
```

Logical contract IDs связываются с numeric IDs при compilation/linking. Hot path не
сравнивает strings. Payload layout определяется operation schema и ABI version; generic
JSON допускается в debug/control transport, но не является обязательным hot ABI.

WASM/native boundary предпочитает batch buffers и linear-memory views. Нельзя делать
JS<->WASM вызов для каждого компонента каждого entity.

Точные alignment/padding и memory ownership правила фиксируются только после TS/WASM
vertical prototype, но contract уже обязан различать:

- owned/borrowed buffers;
- read-only snapshot views;
- command buffers;
- event buffers;
- lifetime одного tick/session;
- maximum sizes и budget failures.

## 12. Snapshot, hash, replay и network obligations

`RuntimeSession` lifecycle переиспользуется, но текущий generic JSON snapshot не объявляется
готовым binary World format. Additive `SnapshotPayload`/`RuntimeSnapshotV2` boundary и различие
JSON/binary chunks определены в
[26-world-state-scheduler-snapshots-and-domains.md](26-world-state-scheduler-snapshots-and-domains.md#15-snapshot).
Portable save/replay schema остаётся отдельным будущим контрактом.

Deterministic extension state обязано участвовать в:

1. snapshot/restore;
2. canonical state hash;
3. replay seek/reconstruction;
4. save/load compatibility;
5. network replication либо deterministic input reconstruction;
6. version migration diagnostics.

Component definition без serializer/hash policy не может зарегистрироваться в
`simulation-synced` domain. Derived caches исключаются из snapshot только если существует
детерминированный rebuild.

Snapshot header фиксирует минимум:

```text
world contract version
composition plan hash
exact profiles/components/systems/script hosts
definition/world content revisions
tick and clock state
RNG streams
entity allocator generations
command/event/timer queues
script VM state when resumable
```

Replay codec остаётся работоспособным без runtime. Runtime assistance требует совместимый
composition lock; tracker-authoritative correction и approximate fidelity сообщаются явно.

## 13. Resources, players и global state

Resource names и economics не hardcode-ятся в `World` или `Player`:

```text
ResourceType definitions
  id, model, storage, flow/deposit/regrowth semantics, presentation metadata

Player/Team ResourceLedger component
  resource type id -> current/capacity/income/expense/reserved
```

Игра может добавить новые resource facets и systems без изменения World core. Аналогично:

- player tech/research state;
- faction/race selection;
- diplomacy;
- fog/vision;
- global weather/day cycle;
- scenario variables;
- game-specific score/state.

Common semantics живут в optional profiles/foundation contracts; уникальные остаются
namespaced components. `ResourceLedger` не входит в kernel только потому, что он часто нужен RTS.

## 14. Modkit integration and manifests

`multiverse-runtime` является runtime-provider contribution только как deployable Modkit adapter;
сам `multiverse/engine` не является codec и не зависит от Modkit:

```text
modkit-extension-multiverse-runtime/       independent adapter repository
├── extension.json
├── runtime-providers/
│   └── multiverse-runtime/
│       ├── contribution.manifest.json
│       ├── src/index.ts
│       ├── src/wasm.ts
│       └── src/native.ts
└── test/
```

Game extension может содержать:

```text
modkit-extension-starcraft-2/             independent game repository
├── codecs/
│   ├── sc2-data/       native data -> definitions/facets
│   ├── sc2-map/        native map -> world
│   └── galaxy/         language AST/semantic/lowering
├── runtime-providers/
│   └── sc2-runtime/    native adapter + SC2 simulation composition
├── world/
│   ├── profiles/
│   └── systems/
└── game-ui/
```

Generic Modkit не bundle-ит эти repositories по умолчанию. Specialized proof-game/SC2 product может
embed exact releases; generic host получает их через catalog/direct artifact flow документа 28.
Multiverse engine source repository и Modkit adapter extension также могут быть разными release
units, сохраняя dependency direction `engine -X-> Modkit`.

Manifest vocabulary должна различать root runtime и augmentations. Conceptual offer:

```json
{
  "kind": "runtime",
  "id": "multiverse-runtime",
  "provides": [
    { "contract": "common.runtime/session", "version": "^1" },
    { "contract": "multiverse.world/core", "version": "^1" }
  ],
  "accepts": [
    { "contract": "multiverse.world/profile", "version": "^1" },
    { "contract": "multiverse.world/system", "version": "^1" }
  ]
}
```

Текущие v1 codec/extension schemas ещё не выражают открытый набор composition roles; показанный
`provides`/`accepts` является conceptual runtime-provider `spec`. Extension-manifest v2 переносит
такие units в contract-typed contribution manifests, а не расширяет codec `kind` бесконечным enum.

World contribution manifest дополнительно обязан выражать component schema hashes, exclusive
system slots, cooperative/exclusive mode, definition overlay layers и ordering edges. Target
extension inventory перечисляет World/game-UI roles через open contract-typed globs; current v1
inventory этого общего механизма не имеет.

## 15. SC2, Spring/Recoil и Tiberium Wars

### SC2

```text
SC2 catalogs -> UVD/common + blizzard.sc2 facets
SC2Map       -> UVW/common + blizzard.sc2 world extensions
Galaxy       -> EngineProgram/runtime IR + explicit blizzard.sc2 native mappings
sc2-runtime  -> SC2 systems/native mappings over World ABI
```

Большая часть Galaxy natives может постепенно получить explicit mapping. Неотображённые
natives остаются в `blizzard.sc2/profile` или native Galaxy host; это не блокирует common
runtime.

### Spring/Recoil

Spring extension может поддерживать два независимых пути:

1. import/adaptation в Multiverse definitions/world/runtime IR;
2. optional compatibility runtime provider, который управляет установленным Recoil через
   отдельный native/process/RPC boundary.

Первый путь portable, но может быть partial. Второй точнее, но зависит от платформы,
permissions, версии движка и лицензирования. Они не должны притворяться одной реализацией.

### Tiberium Wars / SAGE

SAGE codecs поставляют native parsing и projections. Directional armour, tiberium field
regrowth, squads, veterancy или другие verified mechanics сначала регистрируются в
`ea.sage/profile`/`ea.cnc3/profile` profiles. Common promotion выполняется позже по фактическим
cross-game совпадениям.

## 16. Migration plan

### W0 — target-native baseline и декларации, сверяемые со SC2 runtime oracle

- зафиксировать current system order, existing hash oracle и tick benchmark;
- описать 12 systems и все 15 текущих tick units как generic TypeScript declarations рядом с
  implementation;
- добавить cadence четырём периодическим AI functions и три занятые phases;
- определить только необходимые IDs, dependencies, reads/writes, phase и mode;
- не создавать новый kernel, packages, IDL или ABI;
- сохранить current behavior и fixtures.

### W1 — Compiled schedule World v0

- компилировать system DAG в тот же current order;
- проверять cycles, missing dependencies и incompatible writes до tick;
- добавить versioned World/continuation/composition/content compatibility roots и envelope root;
- сохранить current `SimCommand`/`SimEvent` и storage без rewrite.

### W2 — Replaceable mechanic proof

- определить `blizzard.sc2/vitals-regeneration` exclusive slot вокруг всей `stepRegen`, не выделяя
  shields искусственно;
- подключить два fixture providers без private imports друг друга и покрыть оба текущих пути вызова;
- доказать deterministic selection и неизменность остальных systems;
- зафиксировать `multiverse.numeric/f64-observed` fixtures Node/browser-worker;
- продвигать слот в `multiverse.rts/*` только после совместимого second-game proof.

### W3 — SC2 boundary adapters

- постепенно адаптировать command/event/snapshot boundaries только там, где proof это требует;
- связать один доказанный `EngineProgram` native call с versioned World operation через explicit
  SC2 mapping;
- оставить Galaxy-specific semantics и state как native representation;
- не вводить universal script AST или Lua только ради архитектурного теста.

### W4 — Second-game/independent-consumer gate

- проверить реальную потребность Spring/SAGE либо standalone consumer;
- только после неё выделять `@multiverse/world-contracts`, engine package и foundation presets;
- переносить по одной доказанной mechanic boundary с parity/conformance tests;
- не повышать SC2-specific contract до common без второго consumer.

### W5 — Performance gate для Rust/WASM ABI

- профилировать TS hot path и сначала устранять allocation/layout bottlenecks;
- проектировать batch buffers/IDL только для измеренного bottleneck;
- требовать snapshot/hash parity TS vs WASM/native;
- не использовать язык implementation как доказательство determinism.

### W6 — Spring and SAGE proofs

- один Spring definition + Lua call mapping;
- один Spring order/event round trip;
- один SAGE directional-armour component/system;
- доказать отсутствие SC2 fields в common World core.

## 17. Acceptance criteria

1. Empty Modkit host импортирует core/runtime без Multiverse packages.
2. World v0 работает в минимальном target-native Multiverse proof без dependency на Modkit
   workspace/VFS/sdk; SC2 runtime codec используется только в parity fixtures.
3. Compiled scheduler сохраняет current order/hash на всех существующих SC2 fixtures.
4. `sc2-runtime` сохраняет текущие deterministic fixtures через существующий runtime boundary.
5. SC2 и второй shield provider используют один `shield-state` component contract; replacement
   system выбирается explicit slot, а SC2 regeneration остаётся отдельным facet.
6. Warzone ammunition и SAGE directional armour одновременно работают в одном engine
   build через независимые profiles.
7. Extension system участвует в snapshot, hash и replay seek.
8. Missing optional game profile даёт structured dependency diagnostic.
9. Conflicting system writes/order cycles блокируют session до первого tick.
10. Node и browser-worker проходят `f64-observed` logical conformance suite; native/WASM остаются
    gated future work.
11. Resolver не вызывается внутри measured hot tick loop.
12. Presentation/UI code не получает mutable synced world state.
13. Planar/grid movement и true-3D/volume movement одновременно доступны как разные profiles и
    не выбираются по общему слову `movement`.
14. Single-pool health и body-part health не требуют изменения kernel и не теряют native state.
15. Изменение install/directory enumeration order не меняет composition lock или system order.

## 18. Proof-gated questions after World v0

Три занятые World v0 phases уже определены в документе 26. Следующие вопросы не блокируют первый
TypeScript proof:

1. Должен ли future component ABI стандартизировать SoA layout или только reflection/layout
   descriptors?
2. Как кодируется version migration snapshot для удалённого extension component?
3. Какие queries допускаются синхронно в script VM, а какие обязаны быть batched?
4. Нужен ли portable bytecode после второго script runtime, или текущий SC2-oriented
   `EngineProgram` остаётся implementation-specific executable IR?
5. Какие foundation contracts достаточно доказаны SC2/Spring/SAGE, чтобы считать их neutral,
   и кто владеет review/schema registry?
6. Как composition lock связывается с multiplayer protocol/version negotiation?
7. Может ли external native Recoil provider считаться root runtime при process/RPC
   transport, и какие permissions для этого обязательны?
8. Какие exact semantics входят в `shield-state`, `single-pool-health`, planar transform и
   navigation request v1, чтобы похожие названия не создали ложную совместимость?
9. Как разрешаются несколько definition overlay branches, если их partial order не даёт
   единственной линейной последовательности?
