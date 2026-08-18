# 22. Current State Audit, Comparison, and Remaining Gaps

Status: **audit snapshot / non-normative**  
Canonical: [Implementation Status](../IMPLEMENTATION_STATUS.md)  
Normative: **no; measured snapshot and design assessment only**  
Snapshot date: **2026-08-11**  
Scope: текущий working tree, включая незакоммиченные пользовательские изменения; proposal
сравнивается с реально существующими packages, extensions, manifests и hosts.

Этот документ не заменяет [`docs/IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) и не
становится второй status source. Он отвечает на более узкий вопрос: какие части этого proposal уже
поддержаны текущей архитектурой, где находится migration gap и какие решения ещё недостаточно
точны для реализации stable v1.

## 1. Как выполнена проверка

Проверены:

- canonical architecture и asset capability specification;
- `@modkitx/core`, `assets`, `runtime`, `vfs`, `language-contracts`, `viewer-shell`, `workbench`;
- domain processing registries и generated codec catalog;
- SC2 data/layout/language/viewer/runtime paths;
- SC2 runtime codec (former `packages/sim`/`packages/engine` implementation), map/model/replay
  presentation paths;
- extension/codec/provider manifests и их validators;
- Multiverse format/engine drafts;
- все документы этого proposal поиском повторяющихся решений и несовместимых терминов.

Текущий inventory пересчитывается так:

```powershell
rg --files -g codec.manifest.json
rg --files -g game.manifest.json
rg --files extensions -g extension.json
pnpm codecs:validate
pnpm providers:validate
```

В этом working tree найдено **227 `codec.manifest.json`**, **6 `game.manifest.json`**, **28
`extension.json`** и **7 source-provider manifests**. Официальный codec-валидатор объединяет первые
две группы в 233 manifest sources и сообщает `Validated 233 codec manifest(s)`. Это терминология
валидатора, а не шесть дополнительных файлов codec. Generated baseline дополнительно фиксирует 202
non-game и 31 game entries, 140 entries under extension roots и 93 under legacy roots.

Это намеренно inventory рабочего дерева, а не свежего clone. В том же snapshot
`git ls-files '*codec.manifest.json'` сообщает **220** tracked codec manifests; остальные 7
относятся к незакоммиченной migration work. Proposal documents сейчас также untracked.
Поэтому первый operational gate — поместить Proposal и его entry в documentation index под version
control до того, как CI, blame/review, parallel-agent handoff или destructive clean считаются
надёжными. Tracking не делает Proposal canonical.

| Kind     | Count | Kind         | Count |
| -------- | ----: | ------------ | ----: |
| archive  |    44 | image        |    53 |
| model    |    30 | game         |    31 |
| document |    17 | map          |     7 |
| audio    |    12 | video        |    12 |
| data     |     7 | localization |     5 |
| script   |     3 | mod          |     3 |
| replay   |     3 | vector       |     3 |
| save     |     1 | layout       |     1 |
| runtime  |     1 |              |       |

Status distribution: **63 supported**, **122 partial**, **48 unsupported**. Manifest presence не
равна полной реализации: `status`, runtime variant, capabilities, traits и `limitations` нужно
читать вместе.

## 2. Current implementation vs proposal

| Область                       | Что уже есть                                                                                                                       | Чего не хватает до proposal                                                                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Errors/diagnostics            | `ModkitError`, structured context/cause/hint, asset/runtime diagnostics                                                            | `ModkitErrorCode` остаётся closed union; нет extension `ErrorDefinitionRegistry`, transport schema и namespaced remediation catalog                                                                                                                                                           |
| Asset contracts               | Serializable `AssetDescriptor`, traits, operations, contributions, source descriptors, companions, operation sessions              | Нет target `AssetOrigin` с first-class `single/bundle/namespace/derived`, binding revision vector и общей multi-source transaction                                                                                                                                                            |
| Subject model                 | `SubjectDescriptor`, `subjectOf()` и viewer-shell composition уже существуют                                                       | Нет `SubjectHandle`, `SubjectProvider`, `SubjectIndex`, stable cross-workspace `SubjectRef`, generic lazy relation/projection runtime                                                                                                                                                         |
| Traits/capabilities           | Runtime `CapabilityId` допускает custom string IDs; 19 manifests объявляют 25 unique traits                                        | Codec manifest принимает только `KnownCapabilityId`; нет registry/schema/version для extension-defined manifest traits и presence/evidence semantics; `pnpm codecs:traits:check` сейчас обнаруживает stale index и должен стать обязательным aggregate gate                                   |
| Operations                    | Serializable operation descriptors, handler IDs, permissions и scoped sessions                                                     | Нет global operation-provider resolution, cross-provider composition, transaction coordinator и common conflict/undo protocol                                                                                                                                                                 |
| Codec manifests               | Versions, kinds, status, traits, languages, runtime variants, OS/architecture, permissions, dependencies и validators              | Нет rich virtual `ProviderOffer`, contract ranges/outputs per function, augmentation DAG, exact provider composition lock и world/UI contribution roles                                                                                                                                       |
| Extensions/distribution       | `extension.json`, dependency relations, inventory и постепенно extracted extension packages внутри migration monorepo              | Target требует main repo/default install только с `common`, independent vendor/game repositories, immutable artifacts, federated catalogs, install lock, rollback и product recommendations; эти flows пока не реализованы                                                                    |
| Generated catalogs/resolution | Build-time validated catalogs и target-specific registries по domain/environment                                                   | 668 registrations дают 646 unique codec IDs; 22 duplicate rows в 11 node/node-worker registries включают четыре настоящие пары runtime variants. Нужны отдельные detection `(id, environment)` и activation `(id, variantId, environment)` catalogs, canonical ordering и lazy detect imports |
| VFS                           | Mounts, overlays, random access, provider manifests/catalog, file/browser/memory/HTTP/Git/GitHub providers и VS Code host provider | Большинство implementations физически живёт в `packages/vfs`; нет общего extension install/lock/credential broker flow для внешнего custom provider                                                                                                                                           |
| Domain processing             | Архивы, images, audio, video, models и semantic game registries используют общий registry base или adapters                        | Сохраняются несколько typed facades и exact-ID registries; parsing/preview/edit/export не разрешаются одним general contract solver                                                                                                                                                           |
| Composite formats             | Parent source chain, content mounts/resolver и companions покрывают часть nested/container use cases                               | Нет одного полноценного input planner для multi-file bundles, CASC-like namespace origin, derived provenance и atomic multi-owner writes                                                                                                                                                      |
| Models/rendering              | `RenderModel`, M3/WC3 adapters, Three.js/raw WebGL/headless paths, map/replay 3D work                                              | Нет общего projection/resolution contract между native model, `RenderModel`, UMF, renderer features и conversion loss report во всех hosts                                                                                                                                                    |
| Viewer shell                  | Generic `SubjectDescriptor` уже композируется в stage/tree/panels/actions/fallback                                                 | Текущий `composeViewerShell` принимает только descriptor/options; нужен global installed-offer join, чтобы независимый viewer выбирался без собственного ID в codec descriptor                                                                                                                |
| Language                      | `@modkitx/language-contracts`, contribution registry и unified LSP host существуют; SC2 languages богаты                           | Текущий package импортирует LSP/TextDocument types и потому не является lower-than-LSP neutral semantic contract из proposal; CLI loader сейчас знает explicit SC2 extension и не умеет merge второго provider                                                                                |
| Entity cards/relations        | SC2 Unit cards, mod wiki, relation graph, CodeLens, icons/models/audio уже работают                                                | Это SC2-specific path; нет generic `SemanticLocation -> SubjectRef -> Subject Viewer`, общих typed relation roles и nested UI-template cards                                                                                                                                                  |
| SC2Layout/UI                  | Parser, schema/checker, templates, frames, property binds, browser-safe structural HTML и language service существуют              | HTML path уже годится как `preview: structural`, но нет nested SubjectRef с case-insensitive/N:1 semantics, generic CodeLens и fidelity contract; portable UI остаётся за two-format gate                                                                                                     |
| Runtime                       | Game-neutral `RuntimeSession`; `sc2-runtime` Node/browser-worker variants; deterministic SC2 sim commands/events/snapshot/hash     | `Sc2RuntimeSession.restore` не очищает лишнее state/queues и не восстанавливает accumulator/local sequence; continuation/envelope proof отсутствует. Registry всё ещё создаёт session по exact provider ID                                                                                    |
| Simulation                    | SC2 `SimUnit`, movement, A* pathing, collision, combat, shields, economy, production, behaviors, AI и deterministic tests          | Tick содержит 12 `step*` functions и 15 планируемых units с четырьмя cadence calls; declarations/slots отсутствуют. Первый честный slot — вся `stepRegen`, не отдельные shields                                                                                                               |
| Replay/maps                   | Tracker timeline, scene sampling, map preview/launch и optional runtime assistance                                                 | Нет common world profile, fidelity contract и exact composition negotiation для replay simulation/seek across games                                                                                                                                                                           |
| AI/automation                 | CLI/workbench command surfaces, schema-like command descriptors и headless operations                                              | Нет законченного MCP/automation facade над subjects/relations/transactions, policy broker, provenance report и simulation test orchestration                                                                                                                                                  |
| Cross-host                    | Node, browser targets, workers, CLI, VS Code, webviews и runtime-target metadata уже используются                                  | Нет одной conformance suite; browser-safe consumers ещё достигают части `@modkitx/core` через root вместо узкого `events` subpath, а language contracts связаны с LSP DTOs                                                                                                                    |
| Security                      | Permissions, budgets, cancellation, browser boundaries и structured degraded states частично реализованы                           | Три permission vocabularies расходятся; concrete broker check найден только в одном provider. Нет end-to-end grants/brokers, signed trust, sandbox profiles, revocation/quarantine и supply-chain policy                                                                                      |

## 3. Что proposal теперь исправляет явно

После external audit текущая редакция устраняет наиболее опасные внутренние противоречия:

1. **Shared mechanic не равен shared implementation.** Component contract, system provider и
   authored definition layer имеют разные identity/version.
2. **Namespaced-first не является абсолютным правилом.** Extension может сразу использовать
   consciously standardized minimal neutral contract, а game-specific semantics хранить в
   дополнительном facet/component. Несовместимые semantics получают другой ID/major.
3. **Kernel не является скрытым RTS engine.** `movement`, `health`, `combat`, `resources` и
   pathfinding принадлежат mechanic contributions, собираемым в
   `multiverse/foundations/<foundation-id>` presets, либо game extension.
4. **UI document не является единственным UI object.** Source asset, nested template/frame/style,
   runtime instance и derived preview имеют разные identity/lifecycle.
5. **Нормативные типы имеют владельцев.** Provider resolution — документ 23, security — 24,
   subject/editing — 25, World composition — 26; дубликаты `ProviderOffer`, `SubjectRef` и
   transaction enum удалены.
6. **Operation resolver не равен install resolver.** Первый остаётся в `@modkitx/assets` v1;
   catalog/install solving и install lock принадлежат document 28 и не вызываются из operation hot
   path.
7. **Traits не переименовываются в universal capabilities.** Descriptor traits, coarse codec verbs,
   typed contracts, operations, facilities и permissions разведены; отдельный capability package
   не создаётся в v1.
8. **Security claims ограничены enforcement boundary.** Node in-process ambient access не
   объявляется sandbox; broker/dispatch и isolation проверяются отдельно.
9. **World начинается с работающего кода.** Текущий `SimEngine` становится World v0 proof;
   standalone kernel/storage/ABI и Rust/WASM открываются gates, а не roadmap optimism.
10. **Numeric/snapshot claims стали честнее.** V0 использует `f64-observed`; chunked World snapshot
    требует additive payload contract и не считается уже реализованным generic snapshot-ом.
11. **Detection и activation catalogs разведены.** Одна format registration не уничтожает несколько
    runtime variants одного codec/environment.
12. **Editing semantics ортогональны.** Mutation mode, commit guarantee, result status и undo больше
    не смешиваются в один enum; контракт приезжает только с первым production save consumer.
13. **World block остаётся neutral.** `SystemDeclaration<TContext>` знает только tick/delta;
    `GalaxyGameState` остаётся в SC2 adapter.

Follow-up audit comments про undefined `SystemContext`, missing cadence, incomplete lock key,
slash-form trait ID, duplicate permission error ID, mixed relation role и две revision models
относятся к pre-audit draft. Текущая редакция определяет `WorldTickContext`, cadence, typed
`WorldAccessKey`, отдельный `SubjectSnapshotRef`, dot-form trait IDs, один
`org.modkitx/permission-denied`, provider-native `relation` плюс optional `semanticRole` и lock key с
normalized range/outputs/preferences/workload. Это пока не реализованные target contracts, но уже не
внутренние противоречия Proposal.

Также запрещены два неявных порядка: directory/install order не определяет data overlays, а
`last loaded wins` не заменяет executable system. Composition фиксируется graph/lock, system
replacement — explicit exclusive slot. Canonical-wins banner/divergence register также не позволяют
Proposal молча переопределять текущее package ownership.

## 4. Согласованность с текущими Multiverse drafts

Proposal совместим с главной идеей UMF/URMF/UMSF: native preservation, namespaced extensions,
deterministic boundary и optional common profiles. Он не обещает переводить произвольный Galaxy,
Lua или UI script в один semantic AST. Lowerer переводит только доказанный общий subset; остальное
остаётся native representation/host call с fidelity diagnostic.

Есть узкое требующее отдельного согласования расхождение с
[`ARCH_MULTIVERSE_ENGINE.md`](../multiverse/engine/ARCH_MULTIVERSE_ENGINE.md): его tick/status tables и
заранее выделенные hot arrays не являются authority текущей реализации. При этом §6.3 того draft
также не требует предварительного полного ECS rewrite, поэтому оба направления согласны начинать с
`SimEngine` proof. Proposal оставляет arrays storage optimization выбранного profile/composition;
Implementation Status остаётся единственным владельцем current-state facts.

Организационно Proposal subordinate canonical
[`MODKIT_ARCHITECTURE.md`](../architecture/MODKIT_ARCHITECTURE.md). Механический порядок переноса
(TypeScript proof, закрытый divergence, обновление canonical и замена Proposal section ссылкой)
зафиксирован в [Proposal README](README.md#divergence-register). До выполнения всех условий этот
каталог остаётся rationale/design workspace, а не второй source of truth.

## 5. Сравнение по критериям

Оценка использует шкалу `1..5`: это архитектурная оценка текущего состояния и design proposal,
не измеренный benchmark.

| Критерий                                        | Current |    Proposal | Где лучше   | Цена/риск proposal                                                                    |
| ----------------------------------------------- | ------: | ----------: | ----------- | ------------------------------------------------------------------------------------- |
| Работоспособность сегодня                       |       4 |           1 | Current     | Большая часть target contracts ещё не реализована                                     |
| Простота локального feature fix                 |       4 |           2 | Current     | Solver/contracts добавляют ceremony                                                   |
| Добавление неизвестного заранее format/provider |       3 |           5 | Proposal    | Нужны catalog authority и runtime loading                                             |
| Cross-extension composition                     |       2 |           5 | Proposal    | Сложные cycles, ownership и version conflicts                                         |
| Отсутствие giant DTO                            |       2 |           5 | Proposal    | Требует миграции SC2 fat state и projections                                          |
| Version/OS/ABI reproducibility                  |       3 |           5 | Proposal    | Draft lock schema определена, но implementation/migration/conformance ещё отсутствуют |
| Graceful degradation                            |       4 |           5 | Proposal    | Нужно распространить существующий descriptor pattern на все domains                   |
| Производительность hot runtime                  |       3 | 4 potential | Не доказано | Indirection опасен без compiled plans/numeric IDs/benchmarks                          |
| Память и startup небольшого embed               |       2 | 4 potential | Proposal    | Tree-shaking/dynamic loading должны быть измерены                                     |
| Node/web/Electron/VS Code portability           |       3 |           5 | Proposal    | Требуется очистить package boundaries и LSP coupling                                  |
| UI/language reuse                               |       3 |           5 | Proposal    | Neutral contracts и SubjectRef пока не стабилизированы                                |
| Runtime/mod mechanics extensibility             |       2 |           5 | Proposal    | World ABI — самый дорогой и рискованный новый слой                                    |
| Security untrusted extensions                   |       2 |           4 | Proposal    | Sandbox/signing/permissions пока design, не implementation                            |
| Независимая работа людей/AI agents              |       3 |           5 | Proposal    | Contract governance и generated fixtures обязательны                                  |
| Риск миграции                                   |       4 |           2 | Current     | Big-bang недопустим; нужны vertical adapters                                          |

Итог: текущая реализация сильнее как работающий SC2-heavy product и набор format parsers.
Proposal заметно сильнее как долгосрочная composition architecture, но пока слабее как executable
specification. Его следует внедрять vertical slices, не переписывать Modkit с нуля.

Готовность нельзя выводить только из архитектурной оценки. После integrity-аудита 2026-08-11 нужно
показывать разные величины, а не один усреднённый score:

| Что именно готово                                | Оценка | Интерпретация                                                     |
| ------------------------------------------------ | -----: | ----------------------------------------------------------------- |
| Архитектурное направление                        | 8.5/10 | Границы подходят для bounded proofs                               |
| Начало independent comparator/core-events slices |   7/10 | Можно начинать после обычной task authorization                   |
| Формальная готовность новых v2 contracts         |   4/10 | Нет committed schemas/fixtures/validator proofs                   |
| Массовая migration codecs/extensions             | 3.5/10 | Coordinate, adapters, service resolution и parity ещё не доказаны |

Prose boundaries согласованы, однако ни один новый serializable public contract ещё не имеет
committed machine-readable schema и полного набора conformance fixtures. Это не блокирует
independent prototypes; это блокирует stable API и массовую migration.

## 6. Что ещё недостаточно определено

После решений, детализированных в документах
[23](23-contract-identity-schema-resolution-and-lock.md),
[24](24-extension-security-execution-and-lifecycle.md),
[25](25-subject-identity-editing-transactions-and-cache.md) и
[26](26-world-state-scheduler-snapshots-and-domains.md), архитектурные границы P0 выбраны. Ниже
остаются concrete schemas/algorithms/proofs, без которых нельзя объявить stable v1.

### P0 — доказать текущими TypeScript implementations

1. **Tracked process, semantic closure and baselines.** Сначала track Proposal/index; затем unique
   definitions, reference closure, ID/link checks, divergence register, browser/startup/language/
   edit/simulation baselines и explicit review checklist для semantic invariants.
2. **Deterministic/browser primitives.** UTF-8/ASCII canonical order вместо locale-sensitive
   generator/protocol sort, узкий `core/events` boundary и target `Trait*`/facility/access
   terminology.
3. **Subject identity.** Serializable SubjectRef и adapters для SC2 entity, layout FQN и archive
   entry с round-trip/equality tests.
4. **Catalog split before resolver.** Detection registrations `(id, environment)` отделены от всех
   activation offers `(id, variantId, environment)`; ни один реальный runtime variant не теряется.
5. **Machine-readable candidate contracts.** Contribution envelope, codec/service-provider and
   document 28 release/artifact/install-lock/product-evidence/match-rule JSON schemas с positive/
   negative fixtures; TypeScript/schema drift check. Схемы доказывают форму, не resolver/install/
   inventory behaviour.
6. **Operation/service provider resolver.** Exact request/offer/result/project-lock schemas и staged
   algorithm внутри `@modkitx/assets`; lock key учитывает range/outputs/preferences/workload и имеет
   reviewable target-selection table.
7. **Extension-manifest v2.** Реализовать open contract-typed shallow discovery, единый contribution
   envelope, definition-first validation, orphan checks и adapters для всего текущего manifest
   catalog без второго постоянного catalog model. Adapter сохраняет current contribution
   coordinates независимо от owning extension.
8. **Visible resolver proof.** Existing SC2 Unit `visual.icon` relation проходит через
   `common.image/decoded@1`, project lock и текущий entity-card/viewer shell с optional degradation.
9. **Service/open-intent proofs.** Cross-extension 7z/LZMA resolution с lock/degradation/error
   distinction и KTX2 metadata/preview/full counters по bytes/modules/memory/budget.
10. **Lazy catalog/traits.** Lazy detector entrypoints и measured backfill пяти routed traits без
    ложного `missing = unsupported`.
11. **Language L0–L6.** Neutral browser-safe contracts, извлечённый stateful `language-host` и
    protocol-only `@modkitx/lsp`, поэтапная SC2 strings/data/layout/Galaxy parity.
12. **Editing/security.** Сначала production save consumer/commit owner, затем revisions/receipt;
    honest broker/dispatch enforcement без заявления Node sandbox.
13. **World restore prerequisite.** Exhaustive 16-field synced-domain inventory, domain-separated compatibility envelope,
    restore-continuation parity и исправление текущего SC2 runtime adapter до scheduler work.
14. **World v0 proof.** 12 systems/15 tick-unit declarations с cadence, same-order/hash golden test,
    `f64-observed` fixtures и `blizzard.sc2/vitals-regeneration` slot; без нового kernel/storage.

### P1 — решить до stable ecosystem

1. Multi-backend transaction optimization, semantic merges и distributed recovery beyond filesystem
   proof.
2. Independent extension artifact install/update/uninstall, federated catalogs, install lock,
   product inventory/recommendations, signature chain, quarantine и credential UI; manifest/API
   boundaries и local-artifact proof предшествуют full remote marketplace, permission declarations/
   enforcement входят в P0.
3. Marketplace namespaces, ownership transfer, abandoned contract/provider policy.
4. Performance budgets: startup, memory, provider-resolution, per-frame/tick, JS/WASM boundary.
5. Save/replay/network compatibility and negotiation for removed/upgraded components.
6. Remote/process providers: transport, backpressure, cancellation, crash recovery and leases.
7. AI/MCP mutation confirmation, provenance, deterministic test plans and untrusted output policy.
8. Accessibility, localization, font/text shaping and input-method contracts for game UI.
9. Observability schema and privacy rules across extensions/hosts.
10. Licensing/provenance policy for native tools, generated schemas, codecs and reference fixtures.
11. Extension-defined manifest trait registry/governance beyond current known trait IDs.
12. Contract-specific World/game-UI contribution `spec` schemas после TypeScript proofs; open root
    discovery envelope уже выбран в document 27.
13. Foundation semantics и portable `UiRuntimePlan` только после second-game/renderer gates.

## 7. Recommended next proof

Не начинать с Rust rewrite. Каноническая последовательность следующих работ находится в
[09-development-roadmap.md](09-development-roadmap.md).
Первый сквозной proof проходит существующими TypeScript implementations:

1. track Proposal/index, then docs semantic/reference checks + canonical UTF-8 comparator and
   baselines;
2. split detection/activation catalogs без потери четырёх multi-runtime codecs;
3. stable `SubjectRef` для SC2 Unit, SC2Layout template и archive entry;
4. operation resolver/target-table lock внутри `@modkitx/assets`;
5. extension-manifest v2/contribution envelope + adapters без big-bang migration;
6. visible SC2 Unit icon через SubjectRef/relation/provider lock;
7. lazy catalog + audited five-trait backfill;
8. neutral language slices с извлечением `language-host` и сокращением `@modkitx/lsp` до adapter;
9. первый production save consumer, затем transaction semantics;
10. synced-state inventory + compatibility envelope + restore continuation repair;
11. 15-unit `SimEngine` schedule + vitals-regeneration slot;
12. только после gates — standalone packages или Rust/WASM ABI prototype.

Этот proof одновременно проверяет asset, subject, language, viewer, provider resolution и World
composition, не требуя предварительно мигрировать весь codec manifest catalog. Точный текущий
baseline всегда берётся из generator/report scripts, а не из этого плана.

## 8. Обновление аудита — Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable)

Закрыто в лаборатории (см. документ [32](32-execution-boundary-and-method-surfaces.md),
`IMPLEMENTATION_NOTES.md`): второй продуктовый путь открытия (G‑APP‑1) удалён — один
`openSubject`; execution backend SPI с trusted backend и честной диагностикой; capability‑RPC как
единая граница исполнения с conformance kit; method surfaces как authority contract definitions
(allowlist `DATA_SOURCE_METHODS`/`REMOTE_VALUE_METHODS` **удалён** 2026‑08‑18 вместе с переводом
Electron subject‑IPC на capability‑RPC — R6/S4); Node worker backend с verified multi‑file loading
— реальные bundled‑расширения выполняются brokered, и все Node composition roots резолвят открытие
для realm'а `node-worker` (S1b). Открыто: browser worker backend, `process-brokered`,
VFS/container, MK2‑конвертер (документ 09 §14).
