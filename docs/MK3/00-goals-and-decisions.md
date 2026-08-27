# 00. Goals and Initial Decisions

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Проблема

Текущие форматы Modkit невозможно надёжно разложить по взаимоисключающим классам.

- Видео может содержать аудио, subtitles и metadata tracks.
- Animated image одновременно имеет raster frames и timeline.
- Model содержит meshes, materials, animations, embedded textures и ссылки на
  companions.
- Excel workbook является документом, коллекцией sheets, набором таблиц и
  контейнером embedded media.
- Blender file может быть проектом, scene, коллекцией models и контейнером.
- SC2Map одновременно является game map, контейнером, dependency workspace и
  источником scripts, strings, models и textures.
- SC2 Unit не является файлом, но имеет свойства, relations, icon, model, sounds,
  localized text и editable fields.

Жёсткая модель `ImageCodec | AudioCodec | ModelCodec | ArchiveCodec` вынуждает
либо дублировать API, либо создавать один универсальный интерфейс с десятками
optional methods. Оба результата плохо расширяются.

## 2. Цели

### G1. Единая модель просматриваемого объекта

Одиночный файл, составной набор файлов, игровая сущность, мод, namespace, sheet и
embedded document должны открываться как `SubjectHandle` и использовать общую
viewer/editor shell. Asset identity не должна зависеть от наличия одного главного файла.

### G2. Неизвестные заранее providers

Потребитель запрашивает versioned contract и требуемые результаты, а не package:

```text
request:  org.modkitx.contracts/m3-open (provisional)
requires: model.geometry
prefers:  model.animations, scene.effects
```

Реализация может поставляться официальным, community, private или local extension.
Отсутствующая версия в consumer request означает `*`, но выбранная реализация и
lockfile всегда имеют точные версии.

### G3. Graceful degradation

SC2 Unit должен оставаться доступным без DDS, M3, audio или localization provider.
Недоступные previews превращаются в диагностируемые optional slots.

### G4. Композиция форматов

Codec сначала объявляет требуемые source bindings, затем возвращает typed
relations/child sources. Вложенный ресурс снова проходит через общий host. Codec не
импортирует чужую конкретную реализацию. Bundle и namespace не обязаны иметь primary
source.

### G5. Один semantic source of truth для редакторов

Text editor, table, tree, property grid и LSP работают поверх одной versioned
`DocumentSession`. Structured edit преобразуется в минимальный source patch.

### G6. Headless-first contracts

Parsing, resolution, validation, editing и language features должны работать без
DOM, React, VS Code API или LSP transport.

### G7. Безопасная plugin model

Provider selection учитывает trust, permissions, environment, architecture,
external tools и resource budgets. Remote code не активируется только потому, что
workspace упомянул его ID.

### G8. Постепенная миграция

Рабочие MPQ, CASC, M3, SC2 Data и другие реализации сохраняются. Новые contracts
подключаются через adapters, а legacy API удаляются только после parity.

### G9. Cross-host portability

Один provider contract должен разрешаться в Node, Electron, browser/PWA, web component,
VS Code и другом embedding host через совместимые runtime variants. Одинаковы contracts и
diagnostics, но физически невозможные host features допускают explicit degraded state.

### G10. Независимая разработка extensions

Новый codec, augmenter, viewer, language/runtime provider или OS port добавляется в своём
namespace без правки central switch/enum и без импорта чужой implementation. SDK,
per-release catalog fragment и conformance testkit должны позволять нескольким людям или AI agents
работать в independent repositories параллельно с минимальными merge conflicts. Aggregated
marketplace/app/installed catalogs являются generated integration outputs своих scopes.

### G11. Расширяемый игровой runtime без giant Entity

Multiverse Engine должен принимать новые definition facets, entity/player/team/world
components, commands, queries, events, systems и script imports из extensions. Уникальные
SC2, Spring, Warzone или SAGE mechanics не добавляются optional полями в один common DTO;
они подключаются versioned profiles через public World ABI и участвуют в snapshot/hash.

### G12. Native и portable игровые интерфейсы

SC2Layout, Spring/Recoil UI, SAGE layouts и другие game UI systems должны поддерживать
native parsing/semantics/editing и optional portable projection/rendering. Game UI отделён
от Modkit workbench UI и получает world state только через presentation-scoped bindings.

## 3. Не-цели

- Не проектировать один универсальный semantic document для всех форматов.
- Не сводить игровые сущности разных игр к минимальному `Unit` DTO.
- Не включать UI components в capability descriptors.
- Не заставлять каждый codec реализовывать все операции своего domain.
- Не выбирать provider по расширению файла без bounded detection.
- Не разрешать автоматическую установку или исполнение непроверенного extension.
- Не переписывать все codecs одновременно.
- Не создавать один `UniversalAsset`, `GameEntity` или `ScriptAst` DTO со всеми возможными
  полями доменов и vendors.
- Не обещать одинаковый физический feature set в browser и native host; одинаковым
  остаётся protocol behavior при наличии required host facilities.

## 4. Архитектурные инварианты

1. Core packages не знают имён игр и concrete formats.
2. Format identity не определяет полный набор возможностей объекта.
3. Trait/capability не подразумевает edit, save, execute или trust.
4. Exact provider ID используется только при доказанной несовместимости замен.
5. Optional relation не превращается в hard install dependency.
6. Все cross-provider calls проходят через versioned contract.
7. Все runtime handles имеют явный lifecycle и cancellation.
8. Serializable descriptors не содержат functions, DOM, workers или file handles.
9. Browser-safe contract packages не импортируют `node:*`.
10. Portable provider-policy lock воспроизводит logical choice; exact install/activation/session
    state хранится отдельно.
11. Nested assets открываются через host, а не через direct codec import.
12. Extension-defined trait/contract имеет namespace, version и schema.
13. Viewer выбирается по trait/operation requirements и host support.
14. LSP является adapter, а не владельцем language semantics.
15. Изменение source выполняется transaction/operation provider с provenance.
16. Error definition и diagnostic не являются capability или operation.
17. Generic codec routing не hardcode-ит Git, HTTP API, cloud или game-store providers; custom
    sources проходят VFS provider contracts.
18. Container, elementary stream codec и byte transform не объединяются в один
    универсальный codec API.
19. Portable contracts не зависят от stateful hosts или application workbench.
20. Asset identity не выводится из одного path/source; origin и source bindings являются
    отдельными данными.
21. Provider выбирается на уровне contract/operation, а не один раз для всех функций
    asset.
22. Extension version, provider version, contract version и runtime variant не
    подменяют друг друга.
23. External game launch является явной side-effect operation и не смешивается с
    deterministic/runtime session.
24. AI/automation не обходит permissions, transactions, budgets и provenance.
25. OS, architecture, ABI и host features являются runtime-target constraints, а не
    contract/extension versions.
26. Extension расширяет чужой format через public offers/contracts, а не monkey patch,
    private imports или mutation чужого manifest/runtime.
27. Provider ranking выполняется по operation intent и evidence; self-declared priority не
    может обойти compatibility, trust, required outputs или user lock.
28. Resolver/catalog не вызываются в per-entity/per-frame/per-tick hot loop; session сначала
    компилирует execution plan.
29. Универсальность достигается стабильными protocols/profiles и loss/native preservation,
    а не полной нормализацией всех domain semantics.
30. В одной world session только один root runtime владеет clock/state/scheduler; extensions
    добавляют mechanics как проверяемые profiles/components/systems, а не как второй скрытый
    владелец мира.
31. Deterministic extension state не активируется без snapshot/hash/order obligations, а
    resolver и строковые contract IDs компилируются до начала hot loop.
32. Game UI renderer не получает mutable synced world state; user input возвращается как
    validated local action, world command или server request.
33. World kernel не содержит обязательных movement, health, combat, resource или RTS mechanics;
    first-party foundation является обычным replaceable preset.
34. Один component contract ID/major имеет одну semantics/schema hash и одно resolved storage;
    provider implementation и authored definition layer имеют отдельные versions/identity.
35. Похожие названия mechanics не доказывают совместимость: planar/volumetric movement,
    grid/navmesh/volume pathfinding и single-pool/body-part health разрешаются отдельными
    contracts.
36. Data overlay order и executable system replacement не используют install/enumeration order.
    Первый фиксируется composition graph/lock, второй — explicit exclusive slot/replacement.
37. UI source asset, nested semantic subjects, runtime instances и derived previews имеют разные
    identity/lifecycle.
38. Reusable typed compute service без source identity является service-provider contribution, а не
    file codec и не отдельным runtime offer kind.
39. Format имеет zero-or-more roles и одну source topology; artifact stage и output representation
    являются разными осями.
40. Каждый codec open получает intent и resource budget; manifest claim не заменяет runtime
    measurement/conformance.
41. Extension coordinate, contribution/provider coordinate, vendor metadata и folder path не
    наследуются друг из друга неявно.
42. Editor создаёт plan, codec/writer валидирует, host выполняет transaction и source provider
    materializes writes.
43. Engine release, integration contract version и tested-game evidence являются независимыми.

## 5. Исходные решения

### D1. Subject выше Asset

`AssetHandle extends SubjectHandle`. Entity не притворяется файлом, но имеет тот же
контракт просмотра и редактирования.

### D2. Codec является видом Provider

Codec специализируется на `AssetInput -> AssetHandle`. Bounded probe может начинаться с
одного candidate source, после чего host собирает объявленные bindings или namespace.
Projection, language, viewer и operation providers используют общий механизм
offers/requirements, но разные runtime interfaces.

### D3. Trait/contract catalogs открыты для extensions

Core публикует standard asset traits и provider contract mechanism. Extension сможет объявить
namespaced trait schema и typed contract; один `(kind, ID, major)` не может иметь два несовместимых
определения. Текущий manifest принимает только known trait IDs, поэтому custom manifest traits —
планируемое schema extension, не уже реализованная возможность.

### D4. Data, action и implementation разделены

- trait (`CapabilityInstance` сейчас, target `TraitInstance`): какие данные доступны;
- codec capability: coarse execution verb manifest-а;
- operation: что можно выполнить;
- provider contract: какой runtime API нужен;
- contribution: как использовать результат в host.

### D5. Relations являются first-class

`iconAsset: string` и `modelAsset: string` заменяются typed relations с role,
target, expected capabilities, optionality и resolution state.

### D6. Contributions глобальны

Subject описывает себя и relations. Все установленные viewers/editors объявляют
offers в contribution catalog. Subject может указывать preferred role или slot,
но не должен знать полный список UI implementations.

### D7. Missing optional provider — нормальное состояние

Normative operation resolution имеет два wire-state: `resolved`/`unresolved` с typed reason. Host UI
может проецировать reason в `missing`, `ambiguous`, `host-unavailable`, `permission-required`,
`installable`, `failed` или `quarantined`, не создавая второй resolver schema.

### D8. Workspace отвечает за композицию

Индексы assets/subjects/references, dependency chain, locale, overlay policy и хранение project lock
принадлежат workspace composition. Operation resolver contract/implementation v1 принадлежит
`@modkitx/assets` и получает catalog/policy/target от workspace; install solver имеет отдельное
будущее ownership.

### D9. В v1 definitions остаются в `@modkitx/assets`

`@modkitx/assets` владеет target `TRAIT_IDS`, `TraitInstance`, operation descriptors и
operation-provider resolution. Отдельный `@modkitx/capabilities` не создаётся до реальной
dependency/bundle причины. Domain DTOs остаются в browser-safe processing/contract subpaths;
extension-specific trait/contract definitions остаются namespaced. Текущие `CAPABILITY_IDS`/
`CapabilityInstance` переименовываются механически без изменения JSON field `traits`.

### D10. Ошибки расширяемы отдельно от capabilities

Core задаёт `ModkitError`, serializable error envelope и diagnostic model. Extension
может зарегистрировать namespaced error definition с context schema, default severity,
documentation и remediation hint. Неизвестный error code остаётся отображаемым без
загрузки extension runtime.

### D11. VFS implementations являются providers

`@modkitx/vfs` содержит canonical contracts, mount table, overlays, paths и текущие foundational
implementations. Новые Git/GitHub/API/cloud/game-store/private providers могут поставляться
extensions и объявляют schemes, permissions, cache/offline policy и credential needs. Перемещение
уже существующих implementations остаётся открытым divergence и не входит в v1.

### D12. Host packages отделены от portable contracts и embeddable shell

`language-contracts` не содержит sessions, caches, workers, LSP transport или Node API;
stateful neutral lifecycle принадлежит `language-host`, а существующий `@modkitx/lsp`
сокращается до protocol adapter. Временный LSP-shaped facade не сохраняется: проект не имеет
внешних пользователей API и может выполнить breaking migration напрямую.
`viewer-shell` открывает один subject и может встраиваться
в разные hosts; полный project/workspace UI принадлежит `workbench`.

### D13. Processing разделён по независимым runtime слоям

`assets` не поглощает image, audio, model, media, container и compression
processing. Физический package оправдан собственными dependencies, runtime/build target,
data model или lifecycle. Format adapter выбирает virtual contract из структуры файла,
а resolver выбирает реализацию; автоматический поиск произвольной цепочки transforms не
используется.

### D14. Asset origin является first-class

`AssetOrigin` имеет формы `single`, `bundle`, `namespace` и `derived`. Binding получает
stable ID, semantic role, required flag, ownership и revision. `primary` допустим только
как optional hint; CASC/content store и некоторые проекты не имеют главного файла.

### D15. Provider resolution выполняется по функции

Один asset может использовать codec provider A для parsing, provider B для preview,
provider C для export и provider D для language/index projection. Exact provider нужен
для lock, user pin или implementation-specific feature; default request выбирает любую
совместимую реализацию контракта.

### D16. Runtime, launch и automation разделены

Runtime provider создаёт управляемую session над workspace snapshot. Запуск внешней игры
является operation с `process.launch`/`external-tool` permissions. AI/MCP является host
adapter над subjects, queries и operations и не получает отдельный доверенный путь.

### D17. Language extension и host допускают независимое использование

`language-contracts` является portable SDK. `language-host` может стартовать с пустым catalog, а
extension можно тестировать через minimal in-process host. LSP является только одним adapter;
table, tree, CLI и AI используют те же neutral providers без LSP transport.

### D18. Runtime target является отдельной осью совместимости

Request передаёт полный `RuntimeTarget`: environment, OS, architecture, optional ABI,
host/web/GPU features и permissions. Provider variant объявляет constraint над target.
Неизвестные дополнительные features используют namespaced IDs без расширения core enum.

### D19. Providers расширяются композиционно

Другой extension может предоставить replacement implementation того же contract,
augmentation над публичным contract/trait, projection, новую operation или viewer. Оно не
изменяет исходный extension. Read composition допускается после dependency/cycle checks;
writes требуют ownership/conflict protocol.

### D20. Ranking зависит от операции

После hard filters resolver учитывает lock/user policy, conformance, operation intent,
workload, startup/memory/throughput evidence и deterministic tie-break. Native может быть
предпочтителен для batch workload, но не получает unconditional priority.

### D21. Core универсализирует границы, не все данные

Core boundary содержит subjects, origins, traits, relations, operations, provider resolution и
lifecycle. Общие domain profiles живут отдельно и остаются расширяемыми; format/game-specific
данные сохраняются native representation и namespaced traits/contracts.

### D22. World contract целится в standalone, но начинается с `SimEngine`

Целевая граница `@multiverse/world-contracts` задаёт profiles, components, operations, events и
systems независимо от Modkit. Первая реализация — минимальный target-native G0
declarations/compiled schedule/slot; SC2 runtime codec служит parity oracle и источником алгоритмов,
а не временным owner. Физические package/ABI splits проходят правило ROADMAP_ENGINE §3;
`@modkitx/runtime` остаётся generic session control plane. Direct mutation
private engine classes между extensions и dynamic registration после старта запрещены.

### D23. Game UI использует native representation и optional portable projection

Game UI/layout codec сохраняет native AST/semantic model и может предоставить portable
`UiDocument`, renderer, editor и world binding contributions. Portable UI не является
обязательным lossless source of truth. UI работает в presentation-unsynced domain, а
simulation-affecting input проходит через typed command/input contract.

### D24. Multiverse kernel минимален, foundation является preset

Root runtime владеет handles, component storage, tick scheduler, commands/events, deterministic
RNG, snapshot/hash, budgets и lifecycle. `multiverse/foundations/<foundation-id>` является preset
из меньших ordinary mechanic contributions. Например, RTS preset может выбрать spatial, vitals,
motion и navigation contracts/systems; его части можно заменить или не устанавливать без fork
engine.

### D25. Mechanic contract отделён от implementation и data

Component/facet contract фиксирует ID, major, schema hash и semantics. System provider реализует
поведение, а definition/data overlays задают authored defaults. Совместимые extensions используют
один contract/storage; несовместимая semantics получает другой ID/major. System replacement
происходит через explicit exclusive slot, не через `last loaded wins`.

### D26. Composition order является данными

Manifest edges `requires/extends/before/after/replaces` формируют проверяемый DAG. Exact
linearization записывается в `WorldCompositionLock`. Layered definition overlays и executable
system selection используют разные правила; filesystem/install order не влияет на результат.

### D27. UI declarations являются nested subjects

UI file/bundle остаётся Asset, весь document является root Subject, а templates, frames, styles,
animations и widgets адресуются nested `SubjectRef`. Instantiated tree принадлежит
`UiRuntimeSession`; screenshot/thumbnail/compiled plan являются derived results. Language adapters
открывают declarations через generic Subject Viewer, а не format-specific wiki API.

### D28. Contract resolution фиксируется schema и lock

Contract/provider/extension/package/runtime variant имеют отдельные identity/version. Control JSON
schemas и hot ABI schemas разделены. Resolver применяет compatibility, target, permissions,
preferences и stable tie-break, а exact result сохраняет project lock/session fingerprint. Разные
major versions не смешиваются без bridge.

### D29. Permissions обязательны с первой версии

Локальные extensions пока считаются trusted по provenance, но missing permission означает deny.
Operation grant передаётся nested providers только с сужением. `trusted-in-process` явно имеет
ambient authority; restricted execution требует реальной host boundary. Signatures/quarantine
остаются future distribution policy.

### D30. Subject editing является transactional

Identity отделена от path/revision; composite asset использует revision vector. Nested subject
создаёт typed EditPlan owner asset, проходит optimistic revision validation и возвращает transaction
receipt с declared undo/recovery guarantee. Relations/caches materialize и инвалидируются по
revisions/provenance.

### D31. World data plane компилируется до session

Linker создаёт index/generation handles, numeric component/resource storage и scheduler DAG. Systems
имеют declared reads/writes/slots, external actors используют commands, state разделён на execution
domains, snapshots schema-aware. v1 single-threaded; parallel executor не меняет public contracts и
обязан сохранять canonical result.

### D32. Extension discovery открыта и contract-typed

`extension-manifest v2` перечисляет shallow globs, типизированные contribution contracts. Codec,
provider, projection, preset, bridge, viewer, World и game-UI units используют один
`ContributionManifestV1<TSpec>` envelope; contract выбирает `spec` schema. Scope-local bundled/app/
installed generated runtime catalog является disposable deterministic output, а не source of truth.
Distribution catalogs/install locks имеют отдельных owners документа 28. Folder layout служит
convention, но identity задаётся manifest coordinates.

### D33. Service provider не является file codec

Compression, elementary decode, transcode, render/index и другие reusable compute implementations
публикуются отдельными `ServiceProviderContribution`. Standalone source format может находиться в том
же extension, но имеет самостоятельную codec identity/detection/lifecycle.

### D34. Codec v2 описывает roles, topology, stage и intent

Один format может быть container, document, package и semantic aggregate одновременно. Source
topology (`single|bundle|namespace|derived`) отделена от ролей, `ArtifactStage` — от output
representation, а `OpenIntent` передаётся каждому runtime open вместе с budget.

### D35. Contribution identity не наследуется из extension

Current `org.modkitx/<codec-or-game-id>` coordinates сохраняются v2 adapters. Owning extension
coordinate и vendor metadata записываются отдельно; перенос файла не меняет tie-break/lock без
explicit migration map и resolver-version bump.

### D36. Editor не владеет записью

Editor формирует semantic changes/plans. Codec/writer проверяет format semantics/fidelity, host
commit coordinator — revisions, permissions и transaction guarantees, source/VFS provider выполняет
write. Byte ranges уже являются `SourceEdit`, batch atomicity — свойством transaction.

### D37. Engine reference не является integration contract

Game может ссылаться на несколько engine/middleware IDs и их release schemes. Версии Modkit
contracts и `testedGames` evidence объявляются отдельно и не выводятся из engine name.

### D38. Schema и runtime proof являются разными gates

JSON Schema и positive/negative fixtures проверяют transport shape. Provider selection,
degradation, deterministic lock, byte/module budgets и transaction behaviour доказываются только
executable resolver/integration/performance fixtures.

### D39. Extension ecosystem является federated, а не monorepo-owned

Main Modkit repository и generic installation владеют platform + bundled `common` extension family.
Game/vendor/community extensions в target state публикуются из независимых repositories как
immutable artifacts. Текущее физическое размещение extensions в monorepo является migration state,
а не требованием runtime architecture.

Первыми обязательными extraction targets являются расширения `Blizzard/StarCraft2` и
`WZ2100Project/Warzone2100`: после Focused Product GA они переносятся в отдельные repositories и
сохраняют собственные license/provenance boundaries. До переноса game-specific discovery, codecs,
map/model transforms, scripts и runtime adapters остаются только внутри соответствующего extension;
platform и bundled `common` владеют лишь game-neutral contracts, host routing и conformance fixtures.
Ни один из этих extension packages не импортирует implementation другого.

### D40. Catalog, install и operation resolution разделены

Catalog перечисляет release metadata без исполнения кода. Install resolver строит exact artifact/
dependency plan и install lock. Operation resolver документа 23 выбирает provider только среди
installed/embedded offers. World linker имеет отдельный composition lock. Ни один из этих layers не
переписывает другой lock молча.

### D41. `generated` имеет scope и owner

Extension build fragment, aggregated marketplace index, application embedded catalog, installed
artifact index, project/session lock и disposable cache не являются одним root output. Root
`generated/` Modkit repository содержит только platform development/bundled-common artifacts.

### D42. Product discovery не содержит game paths в core

Permissioned generic inventory collectors создают neutral installed-product evidence. Catalog
supplies bounded declarative match rules и объяснимые recommendations. Recommendation не означает
install/activation; browser получает inventory только через user input или trusted native/embedding
bridge.

## 6. Критерии успеха ядра v1

Ядро считается доказанным, когда один и тот же SC2 Unit:

1. открывается только с SC2 Data provider;
2. показывает свойства и source provenance;
3. получает icon после подключения любого совместимого DDS provider;
4. получает 3D stage после подключения любого совместимого M3 provider;
5. показывает localized text после подключения strings provider;
6. предоставляет embedded Galaxy language features при наличии language provider;
7. продолжает работать после удаления каждого optional provider;
8. допускает выбор альтернативного provider и фиксирует logical policy в provider-policy lock;
9. редактируется из text, table и property grid через одну document revision;
10. проходит в Node и browser-safe host без game hardcode в core;
11. сохраняет custom extension error через worker/process boundary с code/context/cause;
12. открывает тот же workspace через local directory и подключаемый Git VFS provider без
    изменения semantic codecs.
13. открывает single-file, multi-file и namespace assets через один host, включая asset
    без primary source;
14. выбирает разные совместимые providers для M3 open, preview и export и фиксирует их
    независимо;
15. запускает deterministic SC2 runtime и внешнюю игру через разные permission paths;
16. предоставляет read-only AI/MCP tools без обхода operation schemas и policy.
17. выбирает Windows/Linux/macOS и native/WASM/TypeScript variants по одному contract;
18. добавляет к базовому M3 provider независимый animations/viewer/export provider без
    изменения базового extension;
19. выбирает native или portable parser по required outputs и interactive/batch intent;
20. проходит один contract conformance matrix в Node, browser-worker, Electron и VS Code
    host adapters;
21. добавляет два независимых test extensions без правки central authored registry.
22. добавляет SC2 shields, Warzone aircraft ammunition и SAGE directional armour без
    изменения common `Entity` interface;
23. snapshot/hash/replay conformance включает deterministic state extension components;
24. SC2Layout открывается как native text/tree/property/preview и использует optional
    world bindings без direct mutable simulation access;
25. World v0 в target-native Multiverse proof не импортирует Modkit workspace/VFS/sdk packages в
    hot loop; SC2 runtime codec остаётся только внешним parity oracle;
26. использует один shield-state contract с двумя взаимозаменяемыми system providers без duplicate
    component и без зависимости от install order;
27. запускает planar/grid и true-3D/volume movement как разные profiles;
28. представляет single-pool и body-part health без добавления health fields в kernel;
29. открывает SC2Layout template из generic CodeLens как nested Subject с reproducible preview
    fixture и timeline.
30. одинаково разрешает provider lock при разном discovery order и сохраняет explanation trace;
31. блокирует undeclared permission до side effect и не расширяет nested operation grant;
32. отклоняет stale nested/composite edit до write и возвращает undo/recovery receipt;
33. компилирует declarations 12 systems и всех 15 tick units с cadence в тот же order/hash и
    заменяет один SC2 mechanic slot;
34. materialize SC2 definition в runtime components без codec/VFS lookup внутри tick;
35. передаёт renderer/UI immutable presentation delta вместо mutable World storage.
36. запускает generic Modkit только с bundled `common`, без импорта SC2/C&C/Spring extensions;
37. устанавливает independent external extension artifact без checkout и правки authored registry
    основного repository;
38. читает catalog metadata и строит recommendation без activation extension code;
39. различает catalog snapshot, install lock, provider lock и World composition lock;
40. рекомендует extensions для двух несвязанных installed products через generic evidence и
    declarative rules, сохраняя manual install при отказе от scan permission.
