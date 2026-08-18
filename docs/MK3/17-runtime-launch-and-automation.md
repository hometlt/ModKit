# 17. Runtime, Launch, and Automation

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Зачем нужен отдельный слой

Открытие asset, simulation runtime, replay playback, запуск установленной игры и вызов
AI tool имеют разный lifecycle и side effects. Их нельзя объединять одним `execute()` у
codec.

Proposal различает:

```text
data operation       inspect, validate, convert, edit, pack
runtime session      deterministic/stateful execution with events and snapshots
external launch      side-effect operation starting a game/tool/process
automation adapter   schema-driven consumer of public queries and operations
```

## 2. Покрытие Modkit

| Функция                      | Вход                    | Core mechanism                      | Optional provider/contribution      |
| ---------------------------- | ----------------------- | ----------------------------------- | ----------------------------------- |
| Metadata/hex/text inspection | Asset/subject           | Capabilities + viewer fallback      | Format codec                        |
| Archive/CASC browsing        | Namespace/container     | VFS mount + child sources           | Archive/content-store provider      |
| Images/audio/video           | Asset input             | Format + stream/transform contracts | Decoder/viewer/editor               |
| Model view/conversion        | Native asset            | `RenderModel`/Scene3D projection    | Renderer/exporter                   |
| SC2 Unit/entity preview      | Logical subject         | Properties + typed relations        | DDS/M3/audio/localization providers |
| Object relation graph        | Workspace subjects      | ReferenceGraph/index                | Game semantic provider              |
| LSP/table/tree editing       | Document session        | Neutral language/value assistance   | Language/editor contribution        |
| Map/mod build and validation | Workspace snapshot      | Typed operations                    | Game pack/validate provider         |
| Replay analysis/playback     | Replay subject/session  | Timeline/playback capabilities      | Optional simulation assistance      |
| Game simulation              | Workspace/runtime input | Managed runtime session             | Game runtime provider               |
| Launch installed game        | Map/mod/workspace       | Explicit external operation         | Game launch provider                |
| AI/MCP inspection/editing    | Workspace session       | Automation adapter over public APIs | Optional MCP/AI host                |

Core задаёт contracts, lifecycle, resolution, policy и transport. Он не реализует
конкретную игру, renderer, LLM или executable discovery.

### 2.1 Engine/ecosystem references

Game, engine release и Modkit integration contract имеют разные identity/version. Game contribution
может ссылаться на несколько engines/middleware stacks:

```ts
interface EngineReference {
  readonly engineId: string
  readonly release?: {
    readonly scheme: 'semver' | 'date' | 'build' | 'opaque'
    readonly range: string
  }
  readonly requiresContracts?: readonly ContractRequirement[]
  readonly profileRequirements?: readonly ContractRequirement[]
}
```

`engineId` используется для discovery/taxonomy, `release` описывает оригинальный engine build, а
`requiresContracts` — версии Modkit integration API. Их нельзя объединять одним SemVer range.
`testedGames` сохраняется как evidence фактически проверенной совместимости и не заменяется engine
reference. Codec может объявить engine applicability/profile evidence, но generic format codec не
становится зависимым от engine только из-за тестовой fixture.

## 3. Runtime input

Runtime обычно требует не один файл, а согласованный snapshot:

```ts
interface RuntimeInput {
  readonly workspace: WorkspaceSnapshotRef
  readonly entrySubjects: readonly SubjectRef[]
  readonly assets?: readonly AssetRef[]
  readonly dependencyState: string
  readonly locale?: string
  readonly configuration?: JsonValue
}
```

Для SC2 сюда входят map/mod namespace, dependency chain, catalog data, strings, triggers,
Galaxy code и resolved assets. Для document macro runtime это может быть workbook
snapshot и embedded scripts. Input фиксирует revisions, поэтому runtime не видит
случайную смесь старых и новых файлов.

## 4. Runtime provider и session

```ts
interface RuntimeProvider {
  readonly offer: ProviderOffer

  start(
    input: RuntimeInput,
    options: RuntimeStartOptions,
    context: RuntimeContext,
  ): Promise<RuntimeSession>
}

interface RuntimeSession {
  readonly id: string
  readonly inputRevision: string

  execute(command: RuntimeCommand, signal?: AbortSignal): Promise<RuntimeResult>
  events(query?: RuntimeEventQuery): AsyncIterable<RuntimeEvent>
  snapshot?(signal?: AbortSignal): Promise<RuntimeSnapshot>
  restore?(snapshot: RuntimeSnapshot, signal?: AbortSignal): Promise<void>
  dispose(): Promise<void>
}
```

Runtime manifest объявляет determinism profile, clock ownership, native/script support,
snapshot support, resource budgets, environment и permissions. `runtime.execute` не
означает permission запускать OS process.

Текущий `RuntimeSnapshot` остаётся generic JSON-oriented control contract. World может начать с
него, но binary/chunked state требует additive `SnapshotPayload`/`RuntimeSnapshotV2` boundary из
[26-world-state-scheduler-snapshots-and-domains.md](26-world-state-scheduler-snapshots-and-domains.md#15-snapshot);
существующий snapshot не объявляется уже совместимым с этим target без изменений.

Runtime provider выбирается тем же target-aware resolver по contract/output requirements, а
не прямым hardcoded ID. OS/architecture/ABI и native/WASM/TypeScript variants описываются
`RuntimeTarget`; operation/workload preference не меняет deterministic semantics выбранного
contract. См.
[18-provider-augmentation-targets-and-ranking.md](18-provider-augmentation-targets-and-ranking.md).

Примеры:

- Galaxy VM;
- SC2 gameplay simulation;
- trigger evaluator;
- document macro sandbox;
- shader/material preview runtime;
- replay-assisted simulation.

### 4.1 World runtime composition

Game simulation логически использует два независимых слоя:

```text
@modkitx/runtime
  Modkit session lifecycle/control plane

target-native Multiverse World v0
  game-world systems/composition proof; SC2 runtime codec is parity oracle
```

`World API/ABI` не является asset codec. G0 переносит и доказывает declarations, compiled schedule и
mechanic slot в минимальном target-native World, сверяя результат с текущим `SimEngine` oracle.
Физические Multiverse package splits и тонкий Modkit runtime adapter следуют split rule. В одной session ровно
один root world runtime владеет clock/state/scheduler; game extensions добавляют
definition/world adapters, profiles, components, systems и script hosts.

Mechanics используют consciously shared neutral contract только при совпадающей semantics;
иначе регистрируют namespaced contract. Например, SC2 может переиспользовать minimal
`shield-state`, но оставить regeneration отдельным SC2 facet/system. Warzone ammunition, SAGE
directional armour, planar/volumetric movement и разные health models не расширяют common
`Entity` TypeScript interface и не monkey patch runtime. Deterministic state обязан объявить
schema hash, snapshot/hash/order/replication policy до старта session.

Resolver компилирует exact `WorldCompositionPlan`, definition overlay linearization, numeric
component/operation/event IDs и explicit system slots/order. Dynamic provider lookup внутри tick
запрещён. Полный план приведён в
[20-world-api-abi-and-multiverse-integration.md](20-world-api-abi-and-multiverse-integration.md).

## 5. Replay не равен runtime

Replay codec должен уметь читать header/events/timeline без game runtime. Playback может
иметь уровни:

```text
parsed event timeline
tracker/state reconstruction
scene sampling
optional runtime-assisted simulation
```

Missing runtime provider ухудшает только последний уровень. Replay identity, metadata и
доступные события остаются работоспособными.

## 6. External game launch

Запуск установленной игры моделируется operation, а не обычной capability:

```ts
interface LaunchRequest {
  readonly target: SubjectRef
  readonly workspaceRevision: string
  readonly profile?: string
  readonly arguments?: JsonValue
}

interface LaunchResult {
  readonly state: 'started' | 'completed' | 'failed' | 'cancelled'
  readonly process?: ProcessSessionRef
  readonly diagnostics: readonly Diagnostic[]
  readonly artifacts?: readonly AssetRef[]
}
```

Operation descriptor объявляет минимум:

```text
effects: launch-process, external-tool
permissions: process.launch, installation.read
mutates: none | workspace
confirmation: always | policy-controlled
```

До установки game extension generic product inventory документа 28 может только рекомендовать его
по neutral OS/store evidence и declarative catalog rule. После установки game discovery provider
выполняет точное vendor/game-specific разрешение installation/toolchain. Launch provider строит
аргументы, temporary package/overlay и управляет process lifecycle. Generic map codec и product
inventory core не импортируют executable-specific implementation.

Отказ в launch permission не блокирует inspect, edit, validate, pack или preview.

## 7. Build, pack, test и deploy

Эти функции остаются schema-described operations:

| Operation class    | Примеры                            | Типичный effect                            |
| ------------------ | ---------------------------------- | ------------------------------------------ |
| Pure/read          | validate, dependency report, index | `read`                                     |
| Derived output     | thumbnail, convert, pack           | `read`, output asset                       |
| Workspace mutation | rename, patch, import              | `write` + transaction                      |
| Runtime            | simulate, execute tests            | `execute-runtime`                          |
| External           | launch game, invoke compiler       | `external-tool`, возможно `launch-process` |

Операция может использовать provider resolver для внутренних services, но её descriptor
заранее сообщает side-effect class, input/output schemas, permissions и cancellation.

## 8. Automation и AI

Core не вводит `ai.capability` и не зависит от LLM SDK. AI, scripts и MCP clients являются
automation hosts над теми же public APIs, что CLI/workbench:

```text
Workspace/Subject indexes
  -> schema-described queries
  -> relations/capabilities
  -> schema-described operations
  -> diagnostics/progress/provenance
  -> MCP/CLI/custom automation adapter
```

Минимальный descriptor экспортируемого tool:

```ts
interface AutomationToolDescriptor {
  readonly id: string
  readonly title: string
  readonly inputSchema: string
  readonly outputSchema: string
  readonly effects: readonly OperationEffect[]
  readonly requiredPermissions: readonly string[]
  readonly confirmation: 'never' | 'policy-controlled' | 'always'
  readonly operation?: string
  readonly maxBudget?: ResourceBudget
}
```

Не каждая operation автоматически становится AI tool. Provider/workspace policy должен
явно разрешить automation exposure. Generic read-only queries можно экспортировать через
standard tool facade.

## 9. Рекомендуемый AI/MCP facade

Первый безопасный набор:

```text
workspace.index
subject.describe
subject.relations
subject.search
asset.list
asset.read-bounded
workspace.validate
runtime.status
```

Mutating/expensive/external operations публикуются отдельно:

```text
subject.edit
workspace.rename
asset.convert
workspace.pack
runtime.start
game.launch
```

Для них обязательны expected revisions, declared effects, budgets, permissions и
confirmation policy. Tool result содержит changed/output subjects, diagnostics и
provenance, а не только human-readable text.

## 10. Работа AI со связями и previews

AI не должен угадывать asset IDs из строк. Он использует schema-backed relations и
workspace indexes:

```text
SC2 Unit subject
  -> visual.primary-model relation
  -> M3 asset
  -> model.geometry capability
  -> render.scene-3d provider
  -> derived thumbnail/scene description
```

Если M3 или renderer provider отсутствует, tool возвращает available metadata и
structured degraded state. Установка extension не происходит автоматически.

Language features используются тем же способом: automation host обращается к neutral language
provider через `language-host` либо minimal direct host, а не поднимает LSP JSON-RPC только ради
hover, references или diagnostics.

## 11. Security и reproducibility

1. AI не получает ambient filesystem/network/process access.
2. Tool call проходит обычную operation policy и permission broker.
3. Provider-policy lock фиксирует logical providers/fallbacks; provenance tool call дополнительно
   фиксирует фактически активированные artifact variants без записи machine facts в project policy.
4. Input/output и diagnostic transport применяет secret redaction.
5. Long-running calls поддерживают cancellation, progress и bounded results.
6. Mutations требуют expected revision и возвращают `ChangeSet`/transaction result.
7. External launch не выполняется из preview, trait или untrusted content.
8. Read tool не может скрыто активировать writer/native/external provider.
9. Tool provenance записывает caller class, operation, providers и affected subjects.
10. Отсутствие automation adapter не меняет domain behavior core.

## 12. Package ownership

Текущий owner и gated target (future строки не создаются до roadmap gates):

```text
@modkitx/runtime
  portable Modkit runtime input/provider/session/event/snapshot contracts

SC2 runtime codec [oracle]
  current SC2 simulation; no ownership of neutral World API

@multiverse/world-contracts
  standalone World API/IDL, profiles, components, commands, events and systems

@multiverse/engine
  standalone root runtime implementation; no Modkit workspace/VFS/assets dependency

@multiverse/ui-contracts  [future gate]
  standalone game UI documents, presentation bindings and input intents

@modkitx/assets / workspace layer
  operation schemas, subject/index/relation APIs, policy hooks

game extensions
  concrete runtime/game profiles/systems/script hosts/UI providers and external launch
  providers

optional MCP/automation host
  tool projection, protocol transport, confirmation UX
```

Отдельный `runtime-host` package нужен только если orchestration/scheduling становится
повторно используемым между CLI, workbench и server. До этого stateful ownership может
оставаться в workspace/application host без изменения portable runtime contracts.

## 13. Migration from current functionality

Новая модель не требует переписывать существующие runtime paths:

- [`@modkitx/runtime` contracts](../../packages/runtime/src/contracts.ts) уже содержат
  provider/session, clock, events и snapshot/restore основу; их нужно адаптировать к
  `RuntimeInput`/provider resolver и отделить game-specific implementation;
- текущие `engine`/`sim` и SC2 runtime provider становятся implementations одного
  versioned runtime contract;
- `SimCommand`, `SimEvent`, `SimWorld` и SC2 natives сначала получают World ABI adapters;
  physical extraction neutral systems происходит только после parity;
- `sc2-runtime` сохраняет stable codec/provider identity и постепенно становится
  compatibility composition поверх Multiverse root runtime и SC2 profiles;
- Spring/Recoil и SAGE/Tiberium Wars подключаются независимыми adapters/profiles; native
  compatibility runtime и portable Multiverse import не объявляются одной реализацией;
- [SC2 map launch](../../extensions/blizzard/starcraft-2/codecs/sc2-map/src/launch/) уже
  изолирован в Node/game extension path и должен рекламироваться как external operation;
- replay processing сохраняет самостоятельный parsing/timeline path и подключает runtime
  только как optional enhancement;
- AI/MCP server пока является planned host в
  [release-hardening plan](../tasks-active/release-hardening/PLAN_release_hardening.md),
  поэтому сначала стабилизируются public query/operation schemas, а не LLM integration.

Это migration/convergence work: существующие runtime, replay и launch реализации
переиспользуются через adapters и conformance tests.

## 14. Acceptance criteria

- Runtime принимает consistent multi-source workspace snapshot.
- SC2 runtime provider можно заменить без изменения SC2 Unit/map subjects.
- Replay parsing работает при физически отсутствующем runtime extension.
- Map inspection работает при denied external launch permission.
- External launch возвращает lifecycle handle и structured diagnostics.
- Read-only MCP facade работает без UI/LSP/LLM-specific imports в core.
- Mutating tool не применяется к stale revision.
- AI не может автоматически установить или активировать untrusted provider.
- Один lock воспроизводит runtime, model conversion и language provider selections.
- Extension добавляет entity/player/world component и system без изменения common runtime
  DTO и участвует в snapshot/hash.
- Game UI runtime физически отсутствует без ошибки headless simulation bootstrap.
