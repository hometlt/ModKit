# 11. Open Questions and Decision Log

Status: **non-canonical decision log**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; resolved entries remain Proposal decisions until promotion gates pass**

После взаимного аудита Sol/Claude формальных owner-decision blockers для старта proof slices нет:
Q75–Q77 решены 2026-08-13, Q78–Q85 — 2026-08-14 проходом BRIEF-13A A-0. Следующие решения
остаются Proposal decisions до соответствующих proof и canonical promotion gates.

## Resolved by the 2026-08-18 lab decisions (Root = Fable; документ [32](32-execution-boundary-and-method-surfaces.md), [ADR‑HOST‑001](adr/ADR-HOST-001-capability-rpc-and-method-surfaces.md))

### 2026‑08‑18 — Q86 — Method surface как authority contract definition

`surface` в обеих ветках `contract-definition-spec.v1`; стандартные data‑source surfaces в sdk с
типовым pin к ABI; foreign — в своём definition; host не угадывает. `arity` вместо `args`‑схем в v1;
`limits` — данные без политики в стандартной таблице.

### 2026‑08‑18 — Q87 — `leased-value` вместо смены ABI `openEntry`

`Lease<AssetSourceRef>` пересекает границу как значение + release‑only handle; ABI не меняется.
Вспомогательная surface `common.view/encoded-media@1` — в стандартной таблице, не исключение host'а.

### 2026‑08‑18 — Q88 — Данные гибридов внутри handle ref

`fields` объекта копируются внутрь ref (`data`), где бы ref ни шёл (lease/ready/args); один механизм
для `AssetSession.revision`, `ArtifactByteSource.size`, `AssetInput` и т.п.

### 2026‑08‑18 — Q89 — Signal/progress внутри объектов‑аргументов

Placements `signal: {arg,key}`/`progress: {arg,key}`; consumer вынимает, executor воссоздаёт;
`resultFromArgs` по `{arg,key}` → `contracts.resolve` из worker'а. `has` (присутствие
optional‑методов) и `nextBatch` (opt‑in `iteratorBatchItems`) приземлены 2026‑08‑18 (S2); открыта
только `nextBatch`‑конвенция для стандартных surfaces.

### 2026‑08‑18 — Q90 — Transfer policy и wire values

Аргументы копируются, результаты/события переносятся; detached буферы отбиваются; `undefined` внутри
объектов допустим (на верхнем уровне — нет).

### 2026‑08‑18 — Q91 — Worker backend: policy, загрузка, честность

Policy только у composition root с жёсткими ceilings (отклонение, не clamp); per‑file digests inventory
→ gate → backend → module hooks (verify‑at‑evaluation); зависимости без верификации (SB‑4 позже);
без карты — только entrypoint, импорты `artifact-not-pinned`; диагностика
`x3.host/worker-shared-process`; profile‑имена по Q77.

## Resolved by the 2026-08-14 owner decision (BRIEF-13A A-0)

### 2026-08-14 — Q78 — Disposition лаборатории modkitX3

Status: **resolved — REVISE, owner decision 2026-08-14.** `modkitX3` продолжает быть
лабораторией под package namespace `@modkitx-x3/*`; completed S0–S4 не переименовываются и не
создают вторую production authority. Живые MK2 extensions этим решением не меняются. Каждый
перенесённый extension использует только MK3 contribution schema; promotion в `@modkitx/*`
разрешается после A-8 proofs из
[BRIEF-13A](../tasks-active/platform-architecture/BRIEF_13A_mk3_extension_reference_spec.md).

### 2026-08-14 — Q79 — Read-only v1 и обязательные sessions

Status: **resolved — owner decision 2026-08-14.** Первый slice включает serializable
`AssetDescriptor`, `AssetSession` и малый `OperationSession`. В read-only v1 входят inspect, hex,
validate, search и export; edit, save и transaction contracts принадлежат
[BRIEF-13D](../tasks-active/platform-architecture/BRIEF_13D_universal_asset_editing.md) и не
притворяются частью первого implementation slice. При изменении source открытая session переходит
в `stale-revision`; silent reload запрещён, caller явно открывает новую session.

### 2026-08-14 — Q80 — Standard и extension-defined traits

Status: **resolved — owner decision 2026-08-14.** Если наблюдаемая семантика уже имеет standard
trait, contribution обязана использовать его. Custom trait допустим только как зарегистрированный
namespaced ID и сохраняется opaque для незнающего consumer. Generic platform routing использует
только standard traits; specialized contribution может явно потреблять зарегистрированный custom
trait. Регистрация custom ID не является его promotion в standard vocabulary.

### 2026-08-14 — Q81 — Единый `SourceSpan`

Status: **resolved — owner decision 2026-08-14.** Binary coordinate system — полная пара byte
offset/length; на JSON wire оба значения являются non-negative decimal u64 strings. Text coordinate
system — UTF-16 offset/length плюс zero-based line/column. Когда mapping известен, span может нести
обе полные системы; пустая или половинчатая система и неявная конверсия запрещены.

### 2026-08-14 — Q82 — Полный host slice BRIEF-13A

Status: **resolved — owner decision 2026-08-14.** Порядок proof: artifact-bound activation ticket,
затем projection offers и replayable lock, затем sessions, затем presentation resolution. Ticket
проверяет contribution-contract plane отдельно от offered logical-contract plane и привязан к
inventory record, manifest/artifact digest и artifact root; внешний manifest/base URL не являются
authority activation request.

### 2026-08-14 — Q83 — `common/plain-text` и неизвестный binary

Status: **resolved — owner decision 2026-08-14.** Bundled common family получает один
`common/plain-text` codec. Универсальный `binary` codec не создаётся: unknown source остаётся
host-owned raw subject с `content.binary` и byte-range data source. Операцию `view.hex` объявляет
host только при наличии соответствующего handler; trait сам по себе операцию не подразумевает.

### 2026-08-14 — Q84 — Три плоскости viewer orchestration

Status: **resolved — owner decision 2026-08-14.** Persistent subject facts принадлежат
`AssetDescriptor` и содержат только traits, operations, constraints и ссылки на логические
data-source contracts. `ViewerContributionSpecV1` живёт в global catalog. Session-local
`PresentationPlan` выбирает активированные реализации. Descriptor никогда не сериализует
installed viewer/provider IDs или machine-local plan. Сначала это разделение вносится в
канонический `ASSET_CAPABILITIES.md`; до этого A-6 и viewer implementation заблокированы.

### 2026-08-14 — Q85 — Проверяемые authoring profiles

Status: **resolved — owner decision 2026-08-14.** SDK предоставляет `pure-transform`,
`source-reader`, `node-only` и escape hatch `explicit`. Profile задаёт только проверенный permission
default; targets всегда объявляются явно. Каждый заявленный target обязан иметь собственный smoke
test. Network/native/credential cases используют явные targets/permissions через `explicit`.

## Resolved by the 2026-08-13 owner decision (BRIEF-12 X3-S0.0 corrective pass)

### 2026-08-13 — Q75 — Root extension dependencies: точная authored-форма

Status: **resolved — owner decision 2026-08-13.** Принят вариант A с ужесточением: поле
`dependsOn?: readonly ExtensionRequirement[]`, где `ExtensionRequirement = { extension:
ExtensionId (publisher-qualified); range?: string (SemVer, default '*'); mode: 'required' |
'default' | 'suggested' | 'integrates'; scope: { kind: 'contribution' | 'offer' |
'operation' | 'intent' | 'variant' | 'profile' | 'projection' | 'slot'; id: string } }` —
**`scope` обязателен** (не optional), и это отдельный тип `ExtensionRequirement`, а не
contract-based Requirement 23 §8. В S0–S4 поле только валидируется и сохраняется; install
solver не создаётся; `integrates` не образует install edge; `conflicts`/`replaces`/
`provides` отложены до будущей версии install-схемы. X3-S0.3 разблокирован.

Context: канон §5.13 прямо требует, чтобы extension manifest нёс «dependencies on other
extensions», а его таблица `requires/defaults/suggests/integrates/conflicts/replaces/
provides` покрывает «codec/extension manifests». При этом принятая минимальная
authored-форма (27 §0.2; решение 64: `publisher`, `id`, `contributionManifests`,
унаследованные `version`/`license`) такого поля не определяет; его нет ни в v2-примере
27 §5, ни в минимальном примере REPORT-6 §6. Строгая S0-schema
(`additionalProperties: false`) обязана либо знать точную форму поля, либо осознанно
отвергать манифесты с зависимостями — молча выбрать нельзя.

Options:

1. **A (рекомендация lab):** optional `dependsOn?: readonly ScopedExtensionRequirement[]`
   в authored-контейнере: `{ extension: ExtensionCoordinate; releaseRange?: string
(default '*'); mode: 'required' | 'default' | 'suggested' | 'integrates'; scope?:
{ kind, id } }` — одна Requirement-модель (mode/scope-семантика 23 §8 verbatim),
   субъект — publisher-qualified extension coordinate (distribution plane; потребитель —
   install solver документа 28). S0–S4 валидирует только форму, ничего не решает.
   `conflicts`/`replaces`/`provides` не входят в authored-минимум до появления install
   solver (28).
2. **B:** поля нет в v1 schema; манифест с зависимостями невалиден до v2 — противоречит
   прозе канона §5.13.
3. **C:** полная таблица семи полей канона §5.13 как есть — противоречит конвергенции
   REPORT-6 §9 («4 поля + codec deps → одна Requirement»).

Consequences of A: S0.3-schema получает optional поле; никакой solver-семантики до
документа 28; независимые contributions продолжают объявлять contract-зависимости через
`dependsOn` envelope (27 §6) — две оси не смешиваются.

### 2026-08-13 — Q76 — Standalone-контейнер: источник `version`/`license`

Status: **resolved — owner decision 2026-08-13.** Утверждено: normalized manifest всегда
имеет `version` и `license`; `package.json#modkit` получает их **только** из верхнего
уровня `package.json`; standalone `modkit.extension.json` обязан содержать собственные
`version` и `license`; дубли внутри `#modkit` — packaging error.

Context: 27 §0.2 говорит «`version`/`license` наследуются из npm-полей», но standalone
`modkit.extension.json` существует именно для layout-ов без `package.json`; 27 §7 при этом
показывает `ExtensionManifest#license` из обоих контейнеров.

Recommendation: standalone-контейнер несёт **собственные обязательные** `version` +
`license`; блок `package.json#modkit` их **не дублирует** (один источник на артефакт;
дубликат = packaging error, симметрично правилу «оба контейнера сразу»). Negative fixtures
в обе стороны: standalone без полей = ошибка; `#modkit` с дублем npm-полей = ошибка.

### 2026-08-13 — Q77 — Один enum `executionProfile` в документе 24

Status: **resolved — owner decision 2026-08-13.** Утверждён единый wire-enum
`ExecutionProfile = 'browser-sandbox' | 'worker-brokered' | 'process-brokered' |
'wasm-brokered' | 'trusted-in-process' | 'remote-provider'`; старые названия §5 остаются
только пояснениями (prose mapping). Поддержка remote/process/WASM исполнения сейчас не
требуется.

Context: в 24 два словаря: typed enum §3 (`browser-sandbox`, `worker-brokered`,
`process-brokered`, `wasm-brokered`, `trusted-in-process`) и каталог профилей §5
(`trusted-in-process`, `wasm-sandbox`, `worker-isolated`, `sandboxed-process`,
`remote-provider`) — имена расходятся, `remote-provider` в enum отсутствует. 27 §6
импортирует `RuntimeVariantDeclaration` из §3, т.е. §3 — wire authority.

Recommendation: единый authored enum = §3 + `remote-provider` (шесть значений); заголовки
§5 становятся прозаическими описаниями с mapping `wasm-sandbox`→`wasm-brokered`,
`worker-isolated`→`worker-brokered`, `sandboxed-process`→`process-brokered`. Второго
словаря не существует; SB-лестница (§6.1) не меняется.

## Resolved by the 2026-08-11 follow-up audit

### Q63 — Service provider, format roles и bounded open

Reusable typed compute contract без source identity/detection публикуется отдельным
`ServiceProviderContribution`. Codec v2 использует `FormatRole[]`, source topology и
`ArtifactStage`; один `layer` не вводится. Runtime `open()` принимает `OpenIntent` и resource budget,
а manifest/schema claim подтверждается bytes/modules/memory/time fixtures.

### Q64 — Contribution coordinate и publisher

Owning extension и contribution/provider имеют независимые coordinates. Current
`org.modkitx/<codec-or-game-id>` сохраняется v2 adapter независимо от grouped extension publisher;
vendor является metadata. Неявное наследование запрещено, потому что меняет codec matching
tie-break и lock.

### Q65 — Trait/session/operation classification

Observable UI document/tree/template/style/binding/timeline и syntax-tree data могут быть traits.
Language completion/hover/rename/formatting, workspace indexes, runtime/UI sessions и world command
input являются provider operations/services/sessions. Legacy `project.editable`/`media.seekable`
мигрируют вместе с v2/первым consumer, без массовой правки manifests сейчас.

### Q66 — Editing ownership

Editor создаёт plan, codec/writer валидирует, host commit coordinator выполняет transaction через
source/VFS provider. `SourceEdit` уже покрывает byte range, а multi-plan atomicity принадлежит
transaction, поэтому generic `edit.binary-range`/`edit.batch` не вводятся.

### Q67 — Specification и implementation lanes

Candidate JSON schemas/fixtures/validator идут параллельно comparator/core-events/terminology/
SubjectRef slices. Дорожки сходятся на manifest v2 и service/open-intent resolver proofs; schemas не
доказывают runtime behaviour. Git staging не является публикацией: CI/review требуют path-scoped
commit и его передачи.

### Q68 — Engine ecosystem metadata

Game contribution может ссылаться на несколько `EngineReference`. Engine identity/release scheme,
Modkit integration contract ranges и `testedGames` evidence хранятся отдельно; engine name не
становится contract version и не заменяет фактическую compatibility evidence.

## Resolved by the 2026-08-10 mutual audit

### Q62 — Extension contribution discovery and manifest family

Target `extension-manifest v2` использует open contract-typed `contributes[]` с deterministic
shallow globs. Codec/game/source/subject/language/service/operation/runtime provider, projection,
preset, bridge, subject-viewer/editor, World и game-UI categories используют один
`ContributionManifestV1<TSpec>` envelope; contract выбирает schema поля `spec`.
Validator выполняет definition-first two-pass validation, orphan/duplicate/escape checks и не
исполняет extension. Extension остаётся одной license unit, а scope-local bundled/app/installed
generated catalogs являются disposable expanded lazy-entrypoint outputs. Marketplace release index
и install/project locks имеют других owners по document 28. Generic `providers/` folder отсутствует; conventions
разделяют definitions, `*-providers`, subject product UI и game UI. Полный target находится в
[document 27](27-final-target-tree-extension-manifest-and-format-catalog.md).
Repository schema owner остаётся `schema/`; target не переименовывает его в `schemas/` и не требует
массово переписать `$schema` references v1 manifests.

### Q1 — Trait ID и runtime contract ID

Descriptor trait и typed runtime contract — разные coordinates с explicit mapping.
`model.geometry` сообщает observable data, а parser/projection API выбирается по
contract/operation. Универсальный `SubjectHandle.get(capability)` не вводится.

### Q4 — Codec, projection, operation и contribution

Codec владеет bounded detection/source open и lifecycle входного handle. Projection не имеет
собственного source и потребляет public traits/handles уже открытого subject. Operation живёт в
operation session и не создаёт новый формат identity. Contribution является packaging/discovery
envelope для codec, provider, projection, operation, UI или language unit, а не отдельной
поведенческой категорией. Folder layout не определяет runtime boundary.

### Q5 — Contributions в SubjectDescriptor

Поле сохраняется как codec-provided hint/compatibility preference. Global catalog добавляет и
фильтрует contributions по traits, operations и host; отсутствие descriptor contribution означает
`undeclared`, а не отсутствие viewer.

### Q6/Q7 — Version и transport extension traits

Semantic version/schema и transport принадлежат future trait-definition registry. До registry custom
traits сохраняются opaque и не участвуют в generic routing. Временный PR в standard `TRAIT_IDS` не
является целевой архитектурой независимых repositories.

### Q10 — Несколько codecs подтвердили source

Declarative match и bounded probes ранжируются по required outputs и detection confidence. При
неразрешимом равенстве возвращается ambiguity, а не discovery order; lock/user choice разрешает её.
После структурного подтверждения формата corruption не маскируется fallback-ом на другой codec.
Detection catalog не схлопывает activation variants.

### Q11 — Relation roles

V1 хранит `relation` как provider-native word/path и optional `semanticRole` для общей семантики.
Registry roles отложен до второй игры; relation не является `ContractId`.

### Q12 — Cross-workspace subjects

`SubjectRef` другого workspace разрешается только если workspace смонтирован в текущей session.
Иначе результат `unresolved`, без скрытого cross-workspace mount/permission protocol v1.

### Q14 — Contract ownership

Definitions публикуются только в qualified owned namespaces. Promotion в trusted common namespace
явный и требует governance/conformance; first-publisher-wins для global unqualified ID запрещён.

### Q15 — Minimal trait backfill

Первая волна покрывает только маршрутизируемые traits: `image.raster`, `model.geometry`,
`container.entries`, `content.text`, `game.map`. Отсутствие остаётся `undeclared`; остальные traits
добавляются вместе с consumer query.

### Q16 — Manifest kind

`kind` сохраняется как discovery/generated-registry namespace и текущая граница codec-local
operation IDs, но запрещён как runtime type-dispatch switch. V2 добавляет roles/topology/stage, не
переписывая v1 `kind` отдельным migration slice.

### Q17 — Subject/card ownership

`SourceRef`/`SubjectRef`/identity и serialization принадлежат `@modkitx/assets/subjects`; card model и
relation graph остаются в `entity-cards`; `SemanticLocation -> SubjectRef` принадлежит portable
language contract; viewer orchestration — `viewer-shell`. Новый package не нужен.

### Q18 — Provider hot swap

Provider не меняется внутри открытого handle/session. Смена pin/lock требует reopen affected
handles; `SubjectRef` сохраняется, UI state мигрирует явно. В deterministic runtime session hot swap
запрещён.

## Proof-gated questions, not v1 design blockers

- canonical semantic schema fingerprint algorithm;
- first real custom trait definition registry/transport;
- facility-specific target profiles сверх environment/OS/architecture lock table;
- transaction commit contract после первого production save consumer;
- portable UI subset после conformance двух разных UI formats;
- neutral script-call ABI после второго runtime mapping;
- execution/resolution semantics для `augmentation`, `projection`, `operation` и explicit
  `contract-bridge` offer kinds после primary/replacement proof;
- exact data-only preset schema и его input boundary с будущим install/marketplace solver;
- выбор первой complete second-game fixture между Spring, Warzone 2100 и 0 A.D.;
- exhaustive synced-domain classification всех 16 `GalaxyGameState` fields и session/transient
  state до объявления compatibility-envelope/restore complete;
- machine-readable schemas, compatibility vectors и conformance fixtures для каждого контракта,
  который предлагается повысить из proof API в stable public API.

Follow-up audit также поднял три вопроса, которые текущая редакция уже закрывает и поэтому не
возвращает в open list:

- записью владеет host/VFS commit coordinator; codec только планирует и материализует outputs;
- detection catalog сохраняет все `(codecId, variantId, environment)` activation offers, включая
  четыре текущие multi-runtime семьи, а resolver выбирает по operation/outputs/target;
- первый SC2 mechanic slot охватывает всю `stepRegen`; отдельные shields не выделяются до
  независимого semantic proof.

## Resolved decisions

### 2026-08-10 — Q2 — ownership standard traits (revised after audit)

Context: capability применяется к source, asset, logical subject, workspace, service и
view session; `asset-capabilities` слишком узко называет модель.

Decision: для v1 target `TRAIT_IDS`/`TraitInstance` и standard trait definitions остаются в explicit
browser-safe subpath `@modkitx/assets`. Текущие `Capability*` TypeScript symbols переименовываются
без JSON migration. Отдельный `@modkitx/capabilities` отложен.
Extension-specific definitions остаются namespaced, но manifest support требует отдельного schema
slice, потому что текущий validator принимает только known IDs.

Consequences: нет package churn/compatibility re-exports в v1; browser-boundary tests остаются.
Future extraction допустим только при измеримой dependency/bundle причине.

Rejected alternatives: немедленный новый package; смешение traits, codec verbs и typed APIs в одном
registry.

Follow-up: K2 roadmap и [02-capabilities-and-contracts.md](02-capabilities-and-contracts.md).

### 2026-08-10 — Q19 — custom errors

Context: codecs/extensions должны создавать собственные machine-readable failures.

Decision: custom errors регистрируются отдельным namespaced ErrorDefinition catalog.
Runtime использует `ModkitError`, serializable envelope и neutral diagnostics. Errors не
являются capabilities; cross-process consumers не полагаются на custom `instanceof`.

Consequences: error schema, redaction и transport conformance входят в core v1.

Rejected alternatives: error capability; только custom subclasses; string-only messages.

Follow-up: [12-errors-and-diagnostics.md](12-errors-and-diagnostics.md).

### 2026-08-10 — Q20 — custom VFS providers

Context: Git, sites/API и private sources нельзя перечислить заранее и нельзя помещать их
credentials/network implementations в core.

Decision: `@modkitx/vfs` сохраняет canonical contracts/mounts/overlays/brokers и текущие
foundational providers. Custom source/VFS providers могут поставляться extensions. Возможный перенос
существующих Git/HTTP implementations — открытый divergence, не v1 migration.

Consequences: manifest описывает schemes, permissions, credentials и offline policy;
secret values никогда не сохраняются в lock/catalog.

Rejected alternatives: hardcoded VFS provider list; каждый codec самостоятельно читает
Git/HTTP; credentials в provider options/URI.

Follow-up: [13-vfs-providers-and-sources.md](13-vfs-providers-and-sources.md).

### 2026-08-10 — Q21 — language и viewer package boundaries

Context: portable extension contracts не должны зависеть от stateful application hosts.

Decision, amended 2026-08-11: neutral `language-contracts` отделяется от stateful
`language-host`; существующий `@modkitx/lsp` становится protocol adapter. Проект не имеет внешних
пользователей API, поэтому временный facade не создаётся. `viewer-shell` и `workbench` разделяются.
Зависимости направлены `@modkitx/lsp -> language-host -> language-contracts` и
`workbench -> viewer-shell`.

Consequences: contracts/host/shell можно использовать в CLI, worker, hover, wiki и standalone
harness без LSP transport; нужны dependency-boundary tests и breaking migration текущих internal
call sites.

Rejected alternatives: единый package с двунаправленными imports; workbench API в viewer
contributions.

Follow-up: [15-package-boundaries-and-extension-layout.md](15-package-boundaries-and-extension-layout.md).

### 2026-08-10 — Q22 — containers, media codecs и compression

Context: 7z/LZMA, MP4/AAC/H.264, WAV/ADPCM и DDS/BC7 требуют reusable implementations на
разных structural levels.

Decision: container/framing, elementary stream codec, byte transform и decoded representation
являются разными runtime contracts. Format adapter читает authoritative method/tag и запрашивает
точный virtual contract; resolver выбирает implementation. File format описывается несколькими
roles, а source-less reusable algorithm — service-provider contribution.

Consequences: shared algorithm можно заменить независимо; generic unbounded transform
graph search запрещён.

Rejected alternatives: direct import algorithm из container; универсальный codec с
optional methods; автоматический перебор произвольных transform chains.

Follow-up: [14-processing-and-codec-layering.md](14-processing-and-codec-layering.md).

### 2026-08-10 — Q23 — extension `src` layout

Context: простые manifests и крупные multi-provider extensions требуют разной глубины.

Decision: `src` не является runtime requirement. Compact extension может быть плоским;
shared compilable runtime крупного extension хранится в `src`, codec-owned unit может
использовать `codecs/<id>/src`. Catalog discovery не зависит от имени source directory.

Consequences: tooling/validator обязан поддерживать оба documented profile и запрещать
неясное дублирование ownership.

Rejected alternatives: обязательный root `src` для каждого extension; полное flattening
всех codec implementations на один уровень.

Follow-up: [15-package-boundaries-and-extension-layout.md](15-package-boundaries-and-extension-layout.md).

### 2026-08-10 — Q3 — rich provider offers

Context: string `provides` не выражает contract range, outputs, environment, runtime
variant, permissions и conformance.

Decision: canonical catalog использует typed `ProviderOffer`. String form допускается
только как migration shorthand и нормализуется до object form до resolution.

Consequences: extension, provider implementation, contract и runtime variant имеют
отдельные coordinates; resolver может выбирать implementation по требуемым outputs.

Rejected alternatives: string-only `provides`; один global codec ID для всех операций.

Follow-up: [03-providers-and-resolution.md](03-providers-and-resolution.md).

### 2026-08-10 — Q8 — mutable runtime state

Context: playback position, animation player, simulation clock и map camera не являются
persisted source data.

Decision: mutable execution/playback state принадлежит explicit runtime/view session с
dispose/cancellation и optional snapshot/restore. Persisted change выполняется только
operation/transaction.

Consequences: runtime state не сериализуется в `SubjectDescriptor`; runtime и external
process launch имеют разные contracts и permissions.

Rejected alternatives: хранить runtime state в asset capability; общий codec `execute()`.

Follow-up: [17-runtime-launch-and-automation.md](17-runtime-launch-and-automation.md).

### 2026-08-10 — Q13 — composite origins and cross-source edits

Context: image/palette, CUE/BIN, model sidecars, directories и CASC не укладываются в
обязательный один `AssetDescriptor.source`.

Decision: asset использует `single | bundle | namespace | derived` origin. `primary`
необязателен. Multi-source writer публикует независимые `MutationMode`, `CommitGuarantee` и
`TransactionStatus`; normative-candidate vocabulary находится в
[25 §9](25-subject-identity-editing-transactions-and-cache.md#9-mutation-mode-commit-guarantee-and-result-status).

Consequences: source, asset и subject identities разделены; cache/lock/edit используют
binding revision vector; required bindings отделены от external relations.

Rejected alternatives: fake main file для CASC/directory; companions только как paths;
неявная запись sidecars после primary.

Follow-up: [16-composite-assets-and-origins.md](16-composite-assets-and-origins.md).

### 2026-08-10 — Q24 — version requirements and provider pinning

Context: native, WASM и TypeScript providers могут иметь разные implementation versions,
поддерживать разные contract ranges и поставляться разными extensions.

Decision: consumer version отсутствует/`*` для any, либо использует exact/compatible/
bounded SemVer range. Selector имеет `any | prefer | require` и может ограничить provider,
extension и runtime variant. Environment/OS/architecture/ABI/features передаются отдельным
`RuntimeTarget`. Lock всегда exact.

Consequences: human examples могут опускать `@1`; provider definition остаётся exact,
включая draft `0.x`; parsing, preview, export и editing разрешаются независимо.

Rejected alternatives: одна версия для extension и contract; обязательный exact codec ID
в каждом consumer; silent highest-version selection без lock.

Follow-up: [02-capabilities-and-contracts.md](02-capabilities-and-contracts.md),
[03-providers-and-resolution.md](03-providers-and-resolution.md).

### 2026-08-10 — Q25 — runtime, launch and AI boundary

Context: simulation, replay assistance, OS process launch и AI tool invocation имеют
разные effects и trust requirements.

Decision: runtime создаёт managed session над workspace snapshot; game launch является
explicit external operation; AI/MCP — optional adapter над public schema-described
queries/operations без privileged core path.

Consequences: operation descriptors получают effect classification; launch denial не
ломает inspection; automation следует permissions, revisions, budgets и provenance.

Rejected alternatives: `ai-capability` с прямым доступом к internals; launch method у
generic map codec; один универсальный execution interface.

Follow-up: [17-runtime-launch-and-automation.md](17-runtime-launch-and-automation.md).

### 2026-08-10 — Q9 — provider quality and preference

Context: provider может self-declare priority/quality, но это нельзя считать достаточным
основанием предпочесть native, WASM или TypeScript implementation.

Decision: compatibility/trust/required outputs являются hard filters. Затем применяются
lock/user policy, conformance, operation intent/workload и host-measured/signed evidence.
Self-declared cost classes являются только hints. Tie-break deterministic.

Consequences: ranking выполняется per operation; native может выигрывать batch workload, но
не получает unconditional global priority и не обходит exact lock.

Rejected alternatives: максимальный integer priority wins; всегда native first; случайный
install/enumeration order.

Follow-up:
[18-provider-augmentation-targets-and-ranking.md](18-provider-augmentation-targets-and-ranking.md).

### 2026-08-10 — Q26 — cross-extension provider augmentation

Context: отдельный extension должен иметь возможность добавить animations/viewer/export или
OS port к уже поддерживаемому format без изменения base extension.

Decision: используются replacement, augmentation, projection и operation offers, упакованные как
contributions. Augmentation потребляет только public versioned transport-safe contracts,
representations и handles; private implementation import/mutation запрещены.

Consequences: base и advanced providers обновляются независимо; resolver строит bounded DAG;
write ownership и cycles проверяются; session reopen фиксирует новый plan.

Rejected alternatives: monkey patch runtime; merge чужого manifest; обязательный fork base
codec; один package на все будущие features.

Follow-up:
[18-provider-augmentation-targets-and-ranking.md](18-provider-augmentation-targets-and-ranking.md).

### 2026-08-10 — Q27 — universal core and host portability

Context: Modkit должен работать как Node library/service, Electron/PWA/web component, VS Code
или другой host и при этом не превращаться в giant universal domain model.

Decision: универсальны protocols, versioned profiles, runtime targets и host facilities.
Format/game/vendor semantics остаются namespaced traits/contracts/native representations. Host
выбирается по facilities, не app name; unavailable native feature деградирует явно.

Consequences: provider resolution остаётся control plane; compiled session plan/direct handles
используются в hot path; SDK/per-release fragments и scope-local generated catalogs позволяют
independent repository ownership.

Rejected alternatives: `UniversalAsset` со всеми полями; app-name allowlists; central
handwritten registry; одинаковые fake capabilities во всех hosts.

Follow-up:
[19-host-portability-performance-and-extension-dx.md](19-host-portability-performance-and-extension-dx.md).

### 2026-08-10 — Q28 — extensible World API/ABI and Multiverse ownership

Context: SC2, Spring/Recoil, Warzone 2100 и SAGE требуют разных entity/player/world
properties, mechanics, commands, events и script functions. Добавление всех полей в common
`Entity`/`Player` DTO разрушит portability и производительность.

Decision: целевой `@multiverse/world-contracts` является standalone versioned boundary, а первая
реализация выполняется как минимальный target-native World v0 declarations/compiled schedule.
SC2 runtime codec служит parity oracle; физические package/engine/IDL splits проходят единое
правило ROADMAP_ENGINE §3, а не создаются как переходный слой.
Один root runtime владеет world/tick/state; extensions добавляют
neutral либо namespaced definition facets, components, profiles, operations, events, systems и
script imports через public ABI. Component contract, system provider и definition layer имеют
отдельные identity/version. Composition фиксируется до старта session; deterministic state обязан
участвовать в snapshot/hash/order policy.

Consequences: SC2 shields, Warzone ammunition и SAGE directional armour не меняют common DTO;
resolver отсутствует в hot tick. Сначала нужны TypeScript declarations, deterministic fixtures и
slot proof; numeric IDs/generated TS/Rust/WASM bindings остаются gated. Похожее имя mechanics не
создаёт compatibility без общего explicit contract/schema.

Rejected alternatives: giant universal entity; one runtime per mechanic; monkey patch
engine; game fields в `@modkitx/core`; dynamic provider lookup на каждом tick.

Follow-up:
[20-world-api-abi-and-multiverse-integration.md](20-world-api-abi-and-multiverse-integration.md).

### 2026-08-10 — Q29 — game UI layouts, rendering and world bindings

Context: SC2Layout, Spring LuaUI/RmlUi, Flash/Scaleform и proprietary layouts имеют разные
semantic models, но должны поддерживать parsing, preview, editing, runtime rendering и
связь с игровыми данными.

Decision: game UI content отделён от Modkit viewer-shell/workbench UI. Codec сохраняет
native AST/semantic representation и может публиковать optional portable UI projection,
renderer, editor и binding contributions. UI работает в presentation-unsynced domain,
читает visibility-scoped world view и изменяет simulation только через typed input/world
commands. Custom nodes/properties/renderers остаются namespaced profiles.

Consequences: SC2Layout может иметь native-compatible renderer без обязательной полной
конвертации; missing renderer оставляет text/tree/raw fallback; нужен standalone
`@multiverse/ui-contracts` boundary и UI/world binding conformance.

Rejected alternatives: один lossless Universal UI DOM; React components в capability
descriptors; direct mutable SimWorld access из HUD; автоматическое исполнение UI scripts при
inspection.

Follow-up:
[21-game-ui-layouts-rendering-and-bindings.md](21-game-ui-layouts-rendering-and-bindings.md).

### 2026-08-10 — Q30 — minimal kernel, shared mechanics and composition order

Context: movement может быть planar или true 3D, pathfinding — grid/navmesh/volume, health —
single pool или graph частей. При этом два extensions с совместимыми shields должны использовать
одно state property, а не дублировать его.

Decision: World kernel не содержит gameplay mechanics. `multiverse/foundations/<foundation-id>`
собирается как preset из меньших ordinary mechanic contributions. Minimal neutral component
contract фиксирует ID/major/schema hash/semantics и
получает одно storage. Game extension может использовать его и добавлять namespaced facets.
Несовместимая semantics получает другой ID/major. Executable system replacement использует
exclusive slot; data overlay и system order фиксируются declared graph и composition lock, не
install order.

Consequences: SC2 shield state может быть shared, а regeneration — SC2-specific. Planar/3D
movement и single-pool/body-part health сосуществуют без giant DTO. Нужны schema governance,
contract fixtures, overlay linearization и system-slot validation.

Rejected alternatives: health/movement в kernel; одинаковое имя означает одинаковую mechanics;
duplicate shield fields per extension; `last loaded wins`; privileged hardcoded foundation.

Follow-up:
[20-world-api-abi-and-multiverse-integration.md](20-world-api-abi-and-multiverse-integration.md).

### 2026-08-10 — Q31 — UI asset, nested subjects and generic viewer

Context: один UI file может быть коллекцией templates/frames/styles/animations; runtime tree и
preview имеют другой lifecycle. SC2 Unit wiki/card и будущий template preview должны использовать
одну navigation model.

Decision: source/bundle является Asset, document — root Subject, declarations — nested Subjects с
stable `SubjectRef`, runtime instances — `UiRuntimeSession` state, preview/screenshot/compiled plan
— derived results. Language provider возвращает `SemanticLocation -> SubjectRef`; generic
`Open Subject`/`Preview` actions заменяют format-specific card API. Preview получает explicit
fixture/context, а public `UiRuntimePlan` переиспользуется editor/runtime renderers.

Consequences: template открывается из CodeLens, tree, search, CLI или AI; existing HTML renderer
становится одним DOM provider; Lua-generated UI не обязано притворяться static UiDocument.

Rejected alternatives: каждый template как fake file; runtime frame как persisted subject;
hardcoded SC2 template card command; implicit live-game state при preview.

Follow-up:
[21-game-ui-layouts-rendering-and-bindings.md](21-game-ui-layouts-rendering-and-bindings.md).

### 2026-08-10 — Q32 — contract identity, schemas, resolution and lock

Context: независимые repositories должны предоставлять несколько implementations одного
function/contract, включая разные TypeScript/WASM/native targets и несовместимые major versions.

Decision: logical contract, provider, extension, package и runtime variant имеют отдельные
identity/version. Control plane использует serializable schemas, hot data plane — отдельные ABI
schemas. Совместимость подтверждают structural diff, author declaration и fixtures. Staged resolver
применяет constraints/target/permissions/preferences/stable tie-break и записывает exact project
lock/session fingerprint. Разные majors не смешиваются без bridge.

Consequences: install order/self-priority не выбирают implementation; resolver отсутствует в hot
path; нужны canonical semantic schema normalization, request/offer/lock schemas и explanation trace.

Rejected alternatives: package name как contract identity; raw-file schema hash; первый найденный
provider; full SAT solver в v1; automatic cross-major coercion.

Follow-up:
[23-contract-identity-schema-resolution-and-lock.md](23-contract-identity-schema-resolution-and-lock.md).

### 2026-08-10 — Q33 — extension permissions, isolation and lifecycle

Context: проект пока разрабатывается одним автором и не требует signature marketplace, но native,
network/VFS и remote providers уже нуждаются в честных permission boundaries.

Decision: local installed extensions пока trusted по provenance, но security declaration обязательна
и missing permission означает deny. Operation получает scoped grant; nested calls могут только
сузить его. Execution profiles включают explicit ambient `trusted-in-process`, WASM, worker,
sandboxed process и remote variants. Provider объявляет lifecycle; existing session остаётся pinned
на старую implementation при update.

Consequences: minimal permission/grant enforcement нужен с первой версии; настоящий sandbox зависит
от host boundary; signatures/quarantine остаются future layer без изменения contract APIs.

Rejected alternatives: permissions optional; trust означает unrestricted; worker автоматически
считается security sandbox; silent hot replacement; fallback после mutation.

Follow-up:
[24-extension-security-execution-and-lifecycle.md](24-extension-security-execution-and-lifecycle.md).

### 2026-08-10 — Q34 — stable subjects and transactional editing

Context: path/content hash недостаточны для identity, а nested Unit/template/sheet и composite model/
namespace edits не должны обходить owner revisions, undo и concurrency.

Decision: SubjectRef использует native/semantic identity и optional workspace rename map; revision
отделена и для composite asset является vector. Nested subject создаёт typed EditPlan owner asset.
Host commit coordinator проверяет optimistic revisions, `MutationMode`/`CommitGuarantee`,
commit/rollback и возвращает `TransactionStatus` receipt с undo/recovery/provenance.
Relations/caches materialize lazy и invalidируются по revisions/dependencies.

Consequences: нужны serializable identity/revision/edit schemas и vertical proofs для SC2 Unit,
SC2Layout template и filesystem bundle; universal JSON Patch не требуется.

Rejected alternatives: path или content hash как identity; UUID внутри каждого source; direct
private-object mutation; last-write-wins; full eager relation graph.

Follow-up:
[25-subject-identity-editing-transactions-and-cache.md](25-subject-identity-editing-transactions-and-cache.md).

### 2026-08-10 — Q35 — World storage, scheduler, domains and snapshots

Context: SC2/Spring/SAGE и другие foundations требуют extensible fast runtime без giant Entity DTO,
codec lookup в tick и потери native definitions.

Decision: World v0 компилирует system declarations в deterministic scheduler DAG поверх текущего
storage. Целевой linker позже может компилировать schemas в index/generation handles и numeric
component/resource storage. Kernel остаётся без gameplay mechanics; modular foundation
preset можно включать полностью/частично. External actors используют commands, events имеют declared
delivery, state разделён на synced/derived/presentation/external domains. Snapshot/replay schema-aware;
renderer/UI получают presentation extraction. World v0 использует explicit SC2 native-to-operation
mappings; common World Call ABI появляется только после второго runtime proof, не как universal AST.
V1 single-threaded, parallel execution позже сохраняет canonical merge order.

Consequences: declarations/slot/conformance fixtures на текущем `SimEngine` должны появиться до
standalone kernel или Rust/WASM оптимизации; numeric storage/time profiles и ABI migration rules
остаются следующими gated decisions.

Rejected alternatives: UUID/map objects в hot storage; hardcoded RTS kernel; direct UI/script
mutable access; memory-dump saves; renderer читает ECS; arbitrary parallel merge.

Follow-up:
[26-world-state-scheduler-snapshots-and-domains.md](26-world-state-scheduler-snapshots-and-domains.md).

### 2026-08-11 — Q69 — Где живут extensions в target architecture?

Context: текущий migration monorepo содержит vendor/game extensions, но generic Modkit не должен
устанавливать весь ecosystem и каждый publisher должен выпускать extension независимо.

Decision: main repository/default installation содержит platform + bundled `common`. Vendor/game/
community extensions публикуются из independent repositories как immutable artifacts. Specialized
apps могут embed/pin curated releases.

Consequences: document 27 показывает main repo отдельно от extension repo; physical extraction
происходит только после independent-artifact proof. Main workspace path не является identity.

Rejected alternatives: permanent monorepo всех vendors; automatic install всех известных games;
extension identity из GitHub organization/path.

Follow-up:
[28-extension-distribution-catalog-installation-and-product-discovery.md](28-extension-distribution-catalog-installation-and-product-discovery.md).

### 2026-08-11 — Q70 — Один ли это catalog/lock/resolver?

Context: remote release search, dependency installation, runtime provider selection и World system
linking имеют разные inputs, side effects и reproducibility obligations.

Decision: federated catalog, install resolver/lock, operation resolver/provider lock и World linker/
composition lock разделены. Remote catalog не участвует в operation hot path и не меняет installed
selection молча.

Consequences: schemas/versioning/owners различны; installer может отсутствовать в browser/embed host,
не ломая embedded providers.

Rejected alternatives: один giant lock; resolveProvider автоматически скачивает codec; catalog
priority выбирает runtime implementation.

Follow-up: documents 23 and 28.

### 2026-08-11 — Q71 — Что означает root `generated/`?

Context: extension build, marketplace index, app bundle, installed state, project locks и caches
нельзя безопасно считать одним repository build output.

Decision: generated artifacts scope-local. Main repository root хранит только development/
bundled-common outputs. Catalog CI, app build и installer владеют собственными indexes; locks имеют
явные persistent schema owners.

Consequences: independent extension repository не пишет в Modkit root; user installed state не
коммитится как disposable generated output.

Rejected alternatives: один глобальный catalog всех extensions в main repo; authored generated
loaders; locks внутри artifact bundle.

Follow-up: document 28 §10.

### 2026-08-11 — Q72 — Как рекомендовать extensions по установленным программам?

Context: desktop Modkit может обнаружить игры/tools, но core не должен знать SC2/Steam/Blender paths,
а browser не имеет ambient machine access.

Decision: consented generic inventory collectors публикуют neutral product evidence; catalogs
поставляют declarative bounded match rules. Complex locator является уже установленным permissioned
inventory/source provider. Recommendation не выполняет install/activation.

Consequences: нужны evidence/rule/recommendation schemas, explanation/redaction tests и manual
fallback. Browser использует user input или trusted native bridge.

Rejected alternatives: hardcoded central switch; скрытое сканирование; запуск кода ещё не
установленного extension для поиска его игры; automatic install.

Follow-up: document 28 §9.

Формат будущей записи:

```text
YYYY-MM-DD — Q<number> — решение
Context:
Decision:
Consequences:
Rejected alternatives:
Follow-up:
```

### 2026-08-11 — Q73 — Format-knowledge plane: кто владеет знанием о формате без codec?

Context: знание о формате существовало только внутри codec.manifest либо в энциклопедии без
platform schema; неизвестный формат не имел контрактного места, ключи шифрования смешивались с
byte transforms, а ecosystem/«platform» терминология была двусмысленной.

Decision: отдельная format-knowledge plane в
[30-format-definitions-ecosystems-corpora-and-unknown-subjects.md](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md):
data-only `FormatDefinition` + augmentation, один `EcosystemReference` с kind
`engine|middleware|content-platform`, typed `FormatRelationClaim`, `CorpusEvidenceManifest` c
пятью evidence classes и шестью invalidation axes; unknown-root persistence в 25 §20; locators в
16 §15; key material в 24 §12.1. Всё candidate до PR-16…PR-24.

Consequences: manifest v2 получает contribution kinds `format-definition`/`corpus-evidence`
(27 §6); слово `platform` без квалификатора запрещено в новых контрактах
(`content-platform` vs runtime target).

Rejected alternatives: формат-знание только внутри codec manifest (не описывает формат до
реализации); три отдельных ecosystem types (одинаковый wire shape); закрытый enum locator
schemes по играм; key material как обычный byte transform.

Follow-up (открыто): governance/registry locator schemes; форма `pnpm formats:stress --check`;
gate физического `definitions/ecosystems/` (второй augmenting publisher); миграционный генератор
codec.manifest+encyclopedia → FormatDefinition.

### 2026-08-12 — Q74 — Sandbox future: gate-driven лестница вместо единовременного sandbox

Context: v1 честно объявляет `trusted-in-process` ambient authority (Q33), но не фиксировал, когда
и в каком порядке появляются реальные enforcement boundaries. «Sandbox» рисковал либо остаться
вечным future-словом, либо превратиться в speculative infrastructure до первого untrusted
provider.

Decision: sandbox future исполняется gate-driven лестницей SB-0…SB-5
([24 §6.1](24-extension-security-execution-and-lifecycle.md)). **SB-0** — честный deny-by-default
v1 (одна permission taxonomy, dispatch + grant intersection, broker checks в реальных I/O
providers, full-authority diagnostic, browser-boundary proof) — без gate и обязателен до массовой
миграции кодеков (S3c) и до первого mutating AI tool (AI-2). **SB-1** worker/renderer isolation —
с первым host-ом, исполняющим кодеки в workers по умолчанию. **SB-2** WASM restricted imports — с
первым untrusted/native-origin codec. **SB-3** sandboxed OS process — с первым native codec
внешнего publisher либо security review перед marketplace beta. **SB-4**
signatures/quarantine/revocation — с первым внешним distribution channel (вместе с R7/EX-8).
**SB-5** remote provider trust — с первым реальным remote provider. Понижение профиля никогда не
молчаливое: недоступный требуемый профиль даёт `unresolved`/degraded, а не запуск под более слабой
границей.

Consequences: execution profile остаётся полем runtime variant — лестница не меняет
operation/provider APIs; каждая ступень добавляет conformance fixtures и строку честных обещаний в
24 §6; register/board получают задачи SEC (SB-0) и SB-1…SB-5 с их gates; threat coverage каждой
ступени явная (24 §6.1 правило 5).

Rejected alternatives: единовременный «полный sandbox» до первого untrusted provider; молчаливый
fallback на `trusted-in-process`; worker как security boundary; подпись artifact как замена
permissions.

Follow-up: [24 §6.1](24-extension-security-execution-and-lifecycle.md); задачи SEC/SB в
`docs/tasks-active/MASTER_TASK_REGISTER.md` §1.7 и на engine/platform board.
