# 26. World State, Scheduler, Snapshots, and Domains

Status: **non-canonical proposal / detailed design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **normative-candidate for future World composition/data-plane contracts**  
Updated: 2026-08-10

Other owners: [Multiverse Engine](../multiverse/engine/ARCH_MULTIVERSE_ENGINE.md) and current-state
[Implementation Status](../IMPLEMENTATION_STATUS.md). If they disagree with this document, the
canonical documents win. This document is the **normative candidate** for the future World
composition/data-plane contract, not an implemented ABI.

Этот документ уточняет World data plane: entity handles, component storage, authored definitions,
systems/scheduler, commands/events, deterministic domains, clocks, snapshots/replay, presentation и
multi-world bridges. Он детализирует обзорный
[20-world-api-abi-and-multiverse-integration.md](20-world-api-abi-and-multiverse-integration.md).

## 1. Решение

Multiverse kernel не содержит gameplay mechanics. До старта session linker компилирует выбранные
component/resource/system schemas и foundation/game profiles в numeric storage/schedule plan. Hot
runtime использует handles/direct accessors/buffers и не вызывает Modkit resolver/codecs.

Первая реализация этого направления не является новым standalone engine: существующие
`SimWorld`/`SimEngine` служат World v0 proof. Новые package boundaries, numeric storage и binary ABI
появляются только после доказательства system declarations, compiled order и replaceable mechanic
slot на текущих SC2 fixtures.

```text
manifests + schemas + definitions
    ↓ control-plane resolver/linker
composition lock + numeric plan
    ↓ session start
World data plane
    entities + components + resources
    scheduler + commands + events
    snapshots + presentation extraction
```

## 2. Kernel и foundations

Kernel владеет только:

- entity/resource handles;
- component/resource storage registry;
- tick/clock coordination;
- command/event buffers;
- scheduler execution;
- deterministic RNG/profile hooks;
- snapshot/hash/restore protocol;
- budgets/cancellation/lifecycle;
- domain/bridge boundaries.

В kernel нет обязательных `Unit`, health, shields, movement, pathfinding, combat, resources, player
economy или RTS phases.

## 3. Modular foundation presets

Foundation — обычный extension composition preset, не privileged engine layer. Следующий список —
кандидаты на reusable mechanic boundaries, а не уже утверждённые neutral contracts. До второй игры
SC2 proof использует `blizzard.sc2/*`; promotion в `multiverse.rts/*` требует совместимой semantics и
conformance fixture минимум ещё одного game/runtime provider.

```text
multiverse.foundation/rts
├── spatial
├── movement
├── navigation
├── ownership
├── teams
├── vitals
├── orders
├── combat
├── projectiles
├── production
├── economy
└── visibility
```

Будущий standard distribution сможет поставлять доказанные mechanics вместе, но каждая получит
отдельные contract/schema/provider/system IDs и сможет активироваться/заменяться отдельно.
Third-party implementation сможет заменить одну mechanic, не fork всего preset.

Session выбирает один primary preset и дополнительные совместимые profiles:

```text
primary: { contract: multiverse.foundation/rts, major: 1 }
additional:
    { contract: multiverse.profile/volumetric-flight, major: 1 }
    { contract: multiverse.profile/body-part-health, major: 1 }
    { contract: ea.sage/directional-armour, major: 1 }
```

## 4. Definition и runtime instance

Authored/native data не читаются codec из tick:

```text
native Subject/Asset
    ↓ definition projection
immutable DefinitionRevision
    ↓ spawn/materialization plan
runtime components/resources
    + optional DefinitionRef/provenance
```

Runtime entity хранит materialized values, нужные systems. `DefinitionRef` позволяет editor/replay/
diagnostics связать state с source, но не создаёт hot dependency на workspace/VFS.

Native definition и common foundation projections сосуществуют. Conversion report отмечает
preserved/approximated/omitted semantics.

## 5. Entity handles

Разделы 5–6, 20–22 описывают gated target после World v0, а не обязательные структуры первого
proof. Они не открывают package/storage/parallel ABI без gates раздела 23.

```ts
interface EntityHandle {
  readonly index: number
  readonly generation: number
}
```

Index обеспечивает быстрый access. Generation предотвращает использование stale handle после
destroy/reuse slot. Handle локален session/domain и не является save/editor identity.

Persistent identity при необходимости хранится отдельным component/resource mapping:

- save object ID;
- editor `SubjectRef`;
- replay actor ID;
- network identity;
- game catalog/definition ID.

## 6. Components и storage plans

Logical schema не фиксирует один storage для всех типов. Linker выбирает strategy:

```text
dense-column     frequent numeric state
sparse-set       uncommon optional component
tag-bitset       marker/boolean membership
blob-arena       variable-size native data
relation-table   graph/edges
shared-resource  scope-level state
provider-native  explicitly isolated native storage
```

```ts
interface LinkedComponent {
  readonly numericId: number
  readonly contract: ContractId
  readonly schemaFingerprint: string
  readonly storageStrategy: string
  readonly accessMode: 'synced' | 'derived' | 'presentation'
}
```

Systems получают generated typed accessors/queries. String contract lookup и dynamic resolver не
выполняются в hot loop.

## 7. Shared contracts и game-specific facets

Один contract ID/major/schema fingerprint создаёт одно storage в composition scope. Совместимые
extensions используют его, а не дублируют поля.

```text
shared: { contract: multiverse.rts/shield-state, major: 1 }
    current
    maximum

SC2-specific:
    { contract: blizzard.sc2/shield-regeneration-state, major: 1 }
    { contract: blizzard.sc2/shield-regeneration-system, major: 1 }
```

Несовместимые semantics не склеиваются:

```text
movement.planar != movement.volumetric
navigation.grid != navigation.navmesh != navigation.volume
vitals.single-pool != vitals.body-parts
```

## 8. Scoped resources

World/player/team/global data не складываются в giant DTO:

```ts
type ResourceScope = 'world' | 'player' | 'team' | 'entity-group'
```

Примеры:

```text
multiverse.world/time
multiverse.world/map-bounds
multiverse.rts/resource-types
multiverse.rts/diplomacy
blizzard.sc2/game-speed
opensource.spring/wind
ea.sage/command-points
```

Linker выдаёт numeric resource handles. Systems декларируют reads/writes аналогично components.

## 9. Systems и phases

Asset operation resolver и World linker используют разные offer types. `ProviderOffer` из
[23-contract-identity-schema-resolution-and-lock.md](23-contract-identity-schema-resolution-and-lock.md)
выбирает codec/service для операции; `WorldOffer` собирает одну locked simulation session:

```ts
type WorldOfferKind =
  | 'profile'
  | 'component'
  | 'resource'
  | 'system'
  | 'script-host'
  | 'render-extractor'
  | 'definition-adapter'

interface WorldOffer extends OfferHeader {
  readonly kind: WorldOfferKind
  readonly provides: readonly ContractOffer[]
  readonly requires?: readonly ContractRequirement[]
  readonly schemaFingerprint?: string
  readonly phase?: WorldPhase
  readonly mode?: 'cooperative' | 'exclusive'
  readonly slot?: ContractId
  readonly reads?: readonly WorldAccessKey[]
  readonly writes?: readonly WorldAccessKey[]
  readonly before?: readonly string[]
  readonly after?: readonly string[]
}
```

Это единственный normative-candidate block `WorldOffer` в Proposal. Он намеренно не входит в
`ProviderOfferKind`: operation resolution и World composition имеют разные invariants, locks и
failure modes. В World v0 manifest пока не расширяется: declarations создаются TypeScript adapter-ом
рядом с существующими systems.

World v0 планирует только реально существующие части текущего tick:

```text
input
update
event-delivery
```

Snapshot и presentation extraction остаются host boundary operations. Они становятся scheduler
phases только после появления первой реальной планируемой system в соответствующей фазе. Foundation
может вводить semantic ordering через dependencies, но не меняет kernel order скрыто.

```ts
type WorldPhase = 'input' | 'update' | 'event-delivery'

type WorldAccessKey = string

interface WorldTickContext {
  readonly tick: number
  readonly delta: number
}

interface SystemDeclaration<TContext extends WorldTickContext = WorldTickContext> {
  readonly id: string
  readonly phase: WorldPhase
  readonly cadence?: {
    readonly everyTicks: number
    readonly offsetTicks?: number // default 0
  }
  readonly before?: readonly string[]
  readonly after?: readonly string[]
  readonly reads: readonly WorldAccessKey[]
  readonly writes: readonly WorldAccessKey[]
  readonly mode: 'cooperative' | 'exclusive'
  readonly slot?: string
  readonly replaces?: readonly string[]
  readonly step: (context: TContext) => void
}
```

`Sc2SystemContext extends WorldTickContext` добавляет текущие `GalaxyGameState`, `SimWorld` и
per-system dependencies только в SC2 adapter; ни один из этих типов не входит в neutral block.
`everyTicks` обязан быть positive safe integer. Четыре текущие AI functions получают cadence,
остальные выполняются каждый tick.

World v0 использует conservative hierarchical keys:

```text
units
units.orders
players
players.resources
players.ai
world.time
world.globals
commands
events
terrain
diagnostics
```

Broad parent key пересекается с descendants; declarations должны выбирать наиболее узкий честный
key. Это proof conflict diagnostics, а не доказательство безопасного parallel execution. Linker
строит DAG. Cycle, missing dependency и two winners exclusive slot блокируют session start. Две
unordered cooperative systems с пересекающимися writes также требуют explicit ordering либо
отклоняются. Install order не является tie-break.

Current SC2 tick компилируется в 15 units: `commands.apply`, 12 фактических `step*` functions,
`galaxy.engine.tick` и `events.drain`. Increment `world.tick` остаётся host boundary после delivery.
`effects.ts` не является отдельной unit: его mutation выполняется внутри `behaviors`/`combat` и
учитывается в их access declarations. Golden fixture строится по исполняемому коду, а не по
расходящимся docstrings текущего `SimEngine`.

## 10. Commands и mutation boundary

Scheduled system получает direct typed access только к declared writes. Внешние actors используют
validated commands:

```text
scripts
UI
network
AI agent
editor runtime controls
    ↓ WorldCommand
schema + permission + state validation
    ↓ scheduled execution
```

Command имеет identity/schema, issuer/context, target tick/domain, arguments и deterministic ordering
key. Accepted/rejected result можно записать replay/automation report.

## 11. Events

Typed channel объявляет delivery policy:

```text
local-immediate   current system only, no arbitrary reentrant mutation
phase-deferred    declared later phase
tick-deferred     next tick
presentation      copied to unsynced presentation domain
```

Cross-system mutation из event handler идёт через deterministic command/event buffers. Buffers
merge по stable system/entity/sequence order.

## 12. State and execution domains

```text
synced
    authoritative gameplay
    snapshot/hash
    deterministic ordering

derived
    rebuildable indexes/caches
    declared dependencies
    excluded from canonical save

presentation
    render/UI/audio/camera/particles
    cannot mutate synced storage directly

external
    filesystem/network/game process
    prohibited inside deterministic tick
```

Provider/component/system обязан объявить domain. Presentation/external state не попадает в synced
hash по ошибке; synced gameplay state не может быть silently excluded.

## 13. Clock domains

```text
simulation clock     fixed deterministic ticks
presentation clock   variable/interpolated
replay clock         seek/pause/speed
editor clock         explicit preview time
external game clock  observed/synchronized
```

Conversions объявлены явно. UI animation/replay seek не изменяют authoritative simulation clock.

## 14. Numeric profiles

World v0 фиксирует единственный честно измеримый profile:

```text
multiverse.numeric/f64-observed
```

Он означает: JavaScript `number`/IEEE-754 binary64, canonical serialization, запрещённые либо
fixture-проверяемые platform-sensitive operations и наблюдаемая parity на поддерживаемых Node и
browser-worker targets. Он **не** обещает strict cross-engine equivalence только из-за имени `f64`.

Профиль обязан фиксировать observed/allowed набор arithmetic operations, rounding/overflow,
NaN/infinity canonicalization, RNG, serialization и перечень запрещённых приблизительных
`Math.*` calls. Cross-engine sqrt fixture и N-tick world fixture являются частью conformance.
Presentation остаётся non-authoritative и может использовать обычную быструю математику.

Audit baseline 2026-08-10 для production SC2 runtime `src/sim` (без specs): `max` 41, `min` 21,
`floor` 21, `sqrt` 12, `abs` 8, `trunc` 5, `imul` 4, `round` 3 и одна константа
`Math.SQRT1_2`; `pow`/`atan2` встречались только в комментариях. Это стартовый observed set, не
вечный allowlist: implementation fixture/check должен обновлять его осознанно.

`deterministic-fixed-32/64`, strict float profiles, SIMD и native-fast profiles остаются research до
реализации, измерений и междвижковой parity; их имена не входят в World v0 contract.

## 15. Snapshot

Generic `RuntimeSession` lifecycle сохраняется, но его текущий JSON-oriented snapshot недостаточен
для binary/chunked World state. Additive boundary-контракт:

### Synced-domain inventory prerequisite

До заявления compatibility-envelope/restore completeness SC2 adapter обязан классифицировать все 16 полей
текущего `GalaxyGameState`:

```text
globals, constants, units, players,
timers, triggers, unitGroups, playerGroups,
points, regions, dialogs, banks,
time, realTime, randomSeed, nextId
```

К ним добавляются `SimWorld.tick`, `SimEngine.accumulator`, `nextLocalSequence`, command/event queues,
diagnostics/timings, cooperative threads, terrain/catalog/composition inputs и scheduler fingerprint.
Для каждого поля таблица proof обязана указать domain (`synced`, `composition-immutable`, `derived`,
`presentation`, `external`), owner, mutable/read paths и отдельную policy для snapshot, hash, restore и
replay input.

Текущий `hashWorld` покрывает только tick и четыре поля state (`time`, `randomSeed`, `units`,
`players`). Это полезный tick-state baseline, но не доказательство полной session determinism.
Например, `globals` уже читается gameplay logic; такое поле нельзя исключить только потому, что его
не включал старый hash. Любое значение, способное изменить future synced behavior, либо входит в
snapshot/hash/restore, либо фиксируется как immutable composition input и входит в composition
fingerprint. `realTime`, banks/dialogs и другие ambient/presentation candidates требуют явной
boundary policy; молчаливое исключение запрещено.

```ts
interface SnapshotChunk {
  readonly id: ContractId
  readonly schemaFingerprint?: string
  readonly provider?: ProviderId
  readonly data: Uint8Array
}

type SnapshotPayload =
  | { readonly encoding: 'json'; readonly value: RuntimeValue }
  | { readonly encoding: 'binary'; readonly chunks: readonly SnapshotChunk[] }

interface RuntimeSnapshotV2 {
  readonly schemaVersion: 2
  readonly providerId: ProviderId
  readonly clock: RuntimeClockState
  readonly payload: SnapshotPayload
  readonly fingerprint?: string
}
```

Это proposal boundary, а не утверждение, что текущий `RuntimeSnapshot` уже поддерживает chunks.
Первый adapter может выдавать `encoding: 'json'`; binary chunks добавляются совместимо после
реального storage proof. Формат portable save/replay этим интерфейсом ещё не стандартизован.

Целевая World snapshot structure schema-aware и chunked:

```text
header
    World ABI/version
    composition/session fingerprint
    tick/clocks
    numeric profile
    RNG state

component/resource chunks
    contract ID
    schema fingerprint
    entity/resource mapping
    encoded data

provider-native chunks
    provider/version/ABI identity

queues
    pending commands/events
```

Memory dump не является portable save. Incompatible chunk требует explicit migration provider или
native/emulation fallback.

## 16. Replay

Hybrid replay содержит:

- initial composition fingerprint/snapshot;
- input/command stream;
- deterministic events/markers;
- periodic keyframes;
- divergence hashes;
- optional native game chunks;
- presentation/timeline metadata.

Replay может открываться без simulation provider в data/timeline mode. Optional runtime позволяет
seek/resimulate intervals, effects, abilities и projectiles с declared fidelity.

## 17. Presentation extraction

Renderer/UI/audio не читают mutable World storage напрямую:

```text
synced/derived world
    ↓ explicit host presentation extraction
immutable incremental presentation delta
    ├── RenderScene/RenderModel instances
    ├── map layers
    ├── visibility-scoped UI view
    ├── audio events
    └── timeline markers
```

Delta может содержать asset/`SubjectRef`; Modkit presentation host разрешает M3/DDS/audio providers
вне deterministic tick.

## 18. UI world bindings

UI читает compiled visibility-scoped projection. Input возвращается typed command:

```text
World -> access/visibility policy -> UI read projection -> compiled binding
UI action -> command schema/validation -> synced World
```

UI extension не получает mutable world и не обходит fog-of-war/player permissions.

## 19. Script runtimes

Galaxy, Lua, visual triggers и будущие languages сохраняют native AST/runtime semantics. World v0
не объявляет neutral Call ABI: SC2 extension содержит explicit mapping отдельных native functions в
World operations с вручную заданными argument/result schemas. Общий World Call ABI открывается
только после второго независимого runtime mapping и доказанного subset. Кандидатами его полей будут:

- operation/function IDs;
- argument/result schemas;
- handles;
- command emission;
- event subscription;
- deterministic host calls;
- budgets/cancellation;
- execution domain.

Текущий `EngineProgram` остаётся SC2/Galaxy-oriented executable IR. Common runtime IR используется
только для доказанного compatible subset. Произвольный Galaxy/Lua не переводится в один giant
universal AST; существующий Spring Lua parser является static data extraction, не вторым script
runtime.

## 20. Controlled definition hot reload

Definition update создаёт plan с policy:

```text
future-spawns-only
update-unmodified-fields
rebuild-component
provider-migration
restart-required
```

Synced change записывается command/log и проверяет definition/schema revisions. Structural ABI
change без migration не применяется live.

## 21. Multiple world domains

Root runtime может владеть несколькими несовместимыми domains:

```text
root runtime
├── SC2/RTS world
├── vehicle/physics world
├── script runtime domain
└── presentation world
```

Bridge contracts:

- typed event bridge;
- command bridge;
- entity projection/mapping;
- time synchronization;
- state replication.

Совместимые mechanics могут жить в одном domain. Разные clocks/numeric profiles/foundation ABI не
смешиваются автоматически.

## 22. Parallel scheduler

Architecture допускает parallel execution при совместимых read/write sets и отсутствии dependency.
Каждый worker пишет local command/event buffers, которые deterministic merge сортирует по stable
keys.

Первая implementation остаётся single-threaded. Parallel executor добавляется только после:

- deterministic single-thread baseline;
- race/read-write validation;
- snapshot/hash parity;
- repeatable multi-run tests;
- measured workload benefit.

## 23. World v0 proof и целевой minimal v1

World v0 реализуется как минимальный target-native Multiverse proof, сверяемый с существующим SC2
runtime codec, и содержит только:

```text
SystemDeclaration<TContext> для 12 systems и 15 планируемых tick units
cadence для четырёх периодических AI functions
compiled single-thread schedule, совпадающий с текущим literal order
cycle/missing-dependency/write diagnostics
один exclusive mechanic slot с двумя test providers
versioned domain-separated compatibility envelope
f64-observed determinism fixtures
исправленный restore-continuation proof поверх существующего SimWorld
```

World v0 сохраняет существующий `hashWorld` как migration oracle/diagnostic, но не объявляет два flat
hash API долгоживущим compatibility contract. Новый versioned envelope содержит domain-separated:

```text
worldStateRoot     canonical synchronized World state
continuationRoot   world root + scheduler/queues/timers/RNG/script continuations/accumulator
compositionRoot    linked schemas/systems/profiles/numeric+time/compiler contracts
contentRoot        immutable definitions/maps/scenario/script/artifact content identities
envelopeRoot       version + protocol profile + все roots выше
```

Lockstep сравнивает `continuationRoot`; admission сравнивает protocol/profile и composition/content;
save/resync сохраняет полный envelope. `state.globals`, `state.nextId`, command/event queues,
`nextLocalSequence`, timers/triggers и другие поля распределяются exhaustive inventory с rationale и
fixtures; omission не считается автоматически безопасным.

World v0 envelope implementation живёт рядом со state/restore semantics в target-native World;
`sc2-runtime` остаётся parity oracle и отдельным Modkit runtime provider. Stable portable wire
contract публикуется только после P0–P1 conformance и split-rule proof.

Hash canonicalization не полагается на insertion order, возвращённый `structuredClone` или
`Object.values`: map/object keys сортируются canonical UTF-8/ASCII comparator-ом перед hash, а
clone/restore fixture проверяет идентичные bytes/hash после продолжения.

До scheduler adapter обязателен restore-continuation test: snapshot, дополнительные N ticks,
restore, повтор тех же N ticks и сравнение всех применимых envelope roots с непрерывным прогоном.
SC2 runtime adapter
должен очищать лишние state keys/transient queues и восстанавливать accumulator/local sequence через
`SimEngine.restore` либо строго эквивалентный путь. Hash только в момент restore недостаточен.

Первый replacement slot — вся текущая `stepRegen` под SC2-qualified ID
`blizzard.sc2/vitals-regeneration`, включая оба места legacy/deterministic invocation. Отдельные
shields не годятся первым proof: regeneration объединяет life/energy/shields, а shield damage живёт
внутри effects. Promotion слота в `multiverse.rts/vitals-regeneration` открывается только после
second-game semantic fixture.

В World v0 **не** входят новые packages, новый entity allocator/storage, IDL, binary ABI,
parallelism или перенос systems. Это TypeScript proof совместимости поверх работающей SC2
симуляции.

После успешного proof целевой minimal v1 может содержать:

```text
single root + one World domain
index/generation entity handles
dense and sparse component storage
scoped resources
single-thread scheduler DAG
one fixed simulation clock
synced + derived + presentation domains
commands
deferred events
chunked snapshot/hash
presentation extraction
```

Не блокируют v1:

- parallel executor;
- multiple roots/world domains;
- network rollback;
- general hot schema migration;
- all numeric profiles;
- universal physics;
- remote systems;
- complete RTS foundation.

## 24. Инварианты

1. Kernel не содержит gameplay fields/mechanics.
2. Foundation — replaceable preset/contributions.
3. Resolver отсутствует в tick.
4. Entity runtime handle не является persistent identity.
5. Один compatible component contract создаёт одно storage.
6. System writes ограничены declaration/plan.
7. UI/scripts/external actors мутируют synced state через commands.
8. Presentation/external state не влияет на synced hash.
9. Snapshot имеет schema/provider/composition identities.
10. Install order не определяет schedule/replacement.
11. Native definitions сохраняются рядом с optional common projections.
12. Parallel и single-thread executors дают одинаковый canonical result.

## 25. Acceptance criteria

- Текущие 12 `SimEngine` systems и все 15 tick units описаны декларативно без изменения поведения.
- Cadence четырёх периодических functions совпадает с текущим tick modulo behavior.
- Compiled order равен current literal order на golden fixture, а registration order его не меняет.
- Restore + continuation даёт те же применимые envelope roots, что непрерывный прогон, до scheduler adapter.
- Все 16 `GalaxyGameState` fields и engine/session fields классифицированы; perturbation каждого
  synced field меняет соответствующий root, а каждое excluded field имеет проверяемый boundary rationale.
- Current `hashWorld` oracle и новые envelope roots воспроизводимы до и после scheduler adapter.
- Один SC2 vitals-regeneration slot имеет два test providers; lock выбирает ровно один.
- Cycle, missing dependency, conflicting exclusive slot и несовместимые writes отклоняются до tick.
- `f64-observed` fixture повторяется на поддерживаемых Node и browser-worker targets.
- Empty future kernel запускает tick/snapshot без RTS contracts после открытия second-game gate.
- RTS preset подключается полностью и отдельными mechanics после World v0 proof.
- Planar и volumetric movement profiles не конфликтуют по generic name.
- Single-pool/body-part health не требуют изменения kernel.
- Stale entity handle отклоняется generation check.
- Deterministic replay hash повторяется в одинаковой locked composition.
- Presentation renderer физически не получает mutable synced storage.
- Snapshot можно инспектировать по known component chunks без game runtime.
- Unknown native chunk сохраняется/диагностируется по fidelity policy.
- Definition hot reload structural conflict требует migration/restart.
- Script language вызывает World operation только через registered ABI mapping.

## 26. Следующие шаги

1. Зафиксировать baseline order/hash/tick benchmark текущего `SimEngine`.
2. Классифицировать все 16 `GalaxyGameState` fields и session/transient state, затем добавить
   compatibility envelope и исправить/доказать restore continuation текущего runtime.
3. Описать 12 systems и 15 tick units как generic `SystemDeclaration<Sc2SystemContext>` с cadence,
   не перемещая implementation.
4. Скомпилировать DAG в тот же порядок и добавить cycle/missing/write diagnostics.
5. Добавить composition hash, numeric profile и явный список resumable/excluded state.
6. Сделать `blizzard.sc2/vitals-regeneration` exclusive slot с двумя fixture providers, покрывающий
   оба вызова `stepRegen`.
7. Добавить `f64-observed` linter/fixtures для Node и browser-worker; не обещать chunks раньше
   реализации.
8. Открывать `EntityHandle`, numeric storage и отдельные packages только при второй игре или
   независимом consumer и подтверждённых benchmark'ах.
9. Прототипировать Rust/WASM hot ABI только если TS profiling показывает конкретный bottleneck и
   cross-engine fixtures уже проходят.
