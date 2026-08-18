# Modkit Core Proposal

> **Перенос (2026‑08‑18).** С этой даты каталог `modkitX3/docs/MK3` — рабочее место документации MK3;
> копия в `modkitx/docs/MK3` считается замороженным снимком на 2026‑08‑14. Ссылки вида
> `../architecture/*` и `../tasks-active/*` указывают на репозиторий `modkitx` (`modkitx/docs/architecture`,
> `modkitx/docs/tasks-active`); внутри `modkitX3` их аналоги пока не переносились.
> Что добавлено при переносе: документ [32](32-execution-boundary-and-method-surfaces.md) (execution boundary: capability‑RPC, method surfaces,
> worker backend), [ADR‑HOST‑001](adr/ADR-HOST-001-capability-rpc-and-method-surfaces.md), датированные секции «Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable)» в 02/23/24/27/10/11/09/22/29.

Status: **non-canonical design workspace**  
Canonical: [`../architecture/MODKIT_ARCHITECTURE.md`](../architecture/MODKIT_ARCHITECTURE.md) (в репозитории `modkitx`)  
Normative: **no, кроме явно помеченных normative-candidate sections**  
Created: 2026-08-10  
Updated: 2026-08-18
Scope: новое расширяемое ядро Modkit без переписывания рабочих реализаций форматов.

Этот каталог описывает предлагаемую модель ядра, в которой одиночный файл, составной
набор файлов, namespace/content store, документ, игровая сущность, лист таблицы,
embedded script и целый мод представлены общей абстракцией `SubjectHandle`. Наблюдаемые данные
описаны traits, действия — operations, runtime APIs — contracts; всё связывается relations и поздно
связываемые providers.

Документы здесь пока не являются канонической архитектурой и не заменяют:

- [`../architecture/MODKIT_ARCHITECTURE.md`](../architecture/MODKIT_ARCHITECTURE.md);
- [`../architecture/ASSET_CAPABILITIES.md`](../architecture/ASSET_CAPABILITIES.md);
- активные execution plans в `docs/tasks-active/`.

После согласования отдельные решения должны либо перейти в каноническую
архитектуру, либо быть отклонены и зафиксированы в журнале решений.

Текущий executable-spec basis после owner decision Q78–Q85:

- [BRIEF-13A R4](../tasks-active/platform-architecture/BRIEF_13A_mk3_extension_reference_spec.md) —
  MK3 extension ABI + `common/plain-text`, accepted as basis, **not frozen** до A-5/A-8 proofs;
- [BRIEF-13B R4](../tasks-active/platform-architecture/BRIEF_13B_mk3_text_data.md) —
  `common/text-data`, implementation после A-8;
- [BRIEF-13C R3](../tasks-active/platform-architecture/BRIEF_13C_universal_asset_viewers.md) —
  universal viewers поверх data plane, implementation после A-6;
- [BRIEF-13D R3](../tasks-active/platform-architecture/BRIEF_13D_universal_asset_editing.md) —
  editing/transaction seam до ABI freeze, implementation после TD-6.

Эти briefs являются bounded execution specifications и не повышают Proposal выше canonical owners.

При любом расхождении до принятия ADR действует canonical architecture. Читатель не выбирает
удобную версию самостоятельно: расхождение сначала фиксируется в таблице ниже, затем разрешается
TypeScript proof/ADR и только после этого переносится в canonical document.

## Divergence register

| Тема                                                         | Canonical architecture                                                                                                                                                                                   | Proposal                                                                                                                                                           | Статус                                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Владение VFS implementations                                 | `@modkitx/vfs` владеет source/mount/cache contracts; concrete file/browser/VS Code adapters host-owned, HTTP optional common, Git/GitHub/API/cloud — extensions                                          | Та же модель                                                                                                                                                       | Resolved и промотировано в канон §5.9 (2026-08-12)                                                                                                                                                      |
| Catalog/install solver, operation resolver и activation host | Канон §6.1: `@modkitx/host` владеет install/catalog модулями и activation/isolation (бывшие `codec-marketplace`/`codec-host` — модули, не packages)                                                      | v1 operation resolver остаётся в `sdk`; document 28 определяет отдельные catalog/install boundaries and lock; ideal activation boundary — internal module boundary | Topology promoted в канон §6.1 (2026-08-12); worker/process isolation proof остаётся open                                                                                                               |
| Extension manifest/discovery                                 | Канон §5.8/§5.13: `package.json#modkit` (или standalone `modkit.extension.json`, ровно один authored container) + явный `contributionManifests` список; hosts не глоббят категории                       | Та же модель (27 §0.2–0.3); authored TS builders → published canonical JSON                                                                                        | Discovery topology промотирована в канон (2026-08-12); executable contribution schemas приняты Q78–Q85/BRIEF-13A R4 как basis, **not frozen** до A-5/A-8 proofs                                         |
| Contribution coordinates                                     | Current codec/game manifests use `org.modkitx/<id>` while extension publishers are grouped                                                                                                               | V2 keeps contribution/provider ID independent from owning extension and preserves current coordinates through adapters                                             | Open; shuffled-order matching/lock regression required before v2 adoption                                                                                                                               |
| Extension repository/distribution topology                   | Current migration monorepo physically contains vendor/game extensions; canonical marketplace assumes later extraction                                                                                    | Main repo ships platform + bundled `common`; vendor/game/community extensions publish from independent repositories through federated catalogs/direct artifacts    | Open; independent-artifact and embedded-app proofs from document 28 required before physical extraction                                                                                                 |
| Language lifecycle owner                                     | Current language lifecycle и LSP transport сосуществуют в `@modkitx/lsp`                                                                                                                                 | Stateful neutral `language-host`; `@modkitx/lsp` только protocol adapter без compatibility facade                                                                  | Open; breaking L0–L6 migration и browser/CLI parity required                                                                                                                                            |
| Ideal physical package tree                                  | Канон §6.1: 7+2 catalog + closure classes; старые имена — модули owners (mapping table в §6.1); живые секции §4/§5/§15/§16 переименованы 2026-08-12                                                      | Document 27 §0 — принятая topology; §§2–5,10 — non-normative appendices                                                                                            | Topology промотирована в канон §6.1/§5.13 (2026-08-12); physical extraction остаётся за gates, никакого bulk move                                                                                       |
| Capability terminology/package                               | `ASSET_CAPABILITIES.md` остаётся normative v1 wire contract и пока использует TypeScript names `CapabilityInstance`/`CAPABILITY_IDS`; canonical architecture различает codec capabilities и asset traits | Proposal 02 разделяет traits/contracts/operations и предлагает будущий mechanical rename в `TraitInstance`/`TRAIT_IDS` без смены wire meaning                      | Семантическое разделение принято; Q80 закрепляет standard-only generic routing и explicit routing по registered namespaced custom traits. Новый package и физический TypeScript rename не промотированы |
| Multiverse engine tick/storage/status                        | [`ARCH_MULTIVERSE_ENGINE.md`](../multiverse/engine/ARCH_MULTIVERSE_ENGINE.md) содержит собственный draft tick/storage roadmap и status table                                                             | World v0 компилирует текущие 15 tick units поверх `SimEngine`; standalone storage/ABI gated                                                                        | Open; implementation status и canonical architecture выше обоих drafts                                                                                                                                  |

Новое расхождение должно появиться в register до implementation work. Блок нормативных типов может
быть только один на domain: `16` владеет asset origin/input, `23` — provider resolution, `24` —
security/execution, `25` — subject/editing, `26` — World target vocabulary, `27` — physical target
tree/contribution envelope, `28` — federated distribution/catalog/install/product inventory.
Остальные документы дают rationale и ссылки.

Решение переносится в canonical architecture только когда одновременно:

1. есть TypeScript vertical proof с tests/fixtures;
2. по теме нет открытой строки divergence register;
3. canonical text обновлён, а соответствующая Proposal section заменена ссылкой/rationale.

Непроверенное design-решение не становится canonical только потому, что подробно описано.

**Правило демоции (принято 2026-08-12).** Промоция обратима той же процедурой в обратную сторону:
если промотированное решение опровергнуто практикой, демоция фиксируется (1) новой строкой
divergence register с датой и причиной, (2) записью в decision journal
([11-open-questions.md](11-open-questions.md) / документ 29), (3) откатом canonical text и
восстановлением Proposal section как candidate. Молча «пере-решить» промотированное нельзя ни в
одну сторону; демоция без записанной причины — такая же ошибка, как промоция без proof.

## Короткая формулировка

> Modkit открывает не только файлы, а адресуемые subjects. Codec является одним из
> видов provider. Subject публикует traits, operations и typed relations.
> Workspace выбирает любую совместимую реализацию virtual contract из установленных
> extensions. Viewers, editors и language services подключаются по требованиям к
> traits/contracts, а не по имени формата или package.

## Порядок чтения

| Документ                                                                                                                                           | Содержание                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00-goals-and-decisions.md](00-goals-and-decisions.md)                                                                                             | Цели, ограничения, принятые исходные решения                                                                                                                                                                    |
| [01-domain-model.md](01-domain-model.md)                                                                                                           | Source, asset, subject, trait, operation, relation, provider                                                                                                                                                    |
| [02-capabilities-and-contracts.md](02-capabilities-and-contracts.md)                                                                               | Traits, coarse codec capabilities и virtual contracts                                                                                                                                                           |
| [03-providers-and-resolution.md](03-providers-and-resolution.md)                                                                                   | Несколько реализаций, optional integrations, solver и lockfile                                                                                                                                                  |
| [04-subjects-relations-projections.md](04-subjects-relations-projections.md)                                                                       | Игровые сущности, typed relations и derived projections                                                                                                                                                         |
| [05-codecs-and-asset-pipeline.md](05-codecs-and-asset-pipeline.md)                                                                                 | Универсальный codec lifecycle и составные форматы                                                                                                                                                               |
| [06-viewers-editors-language.md](06-viewers-editors-language.md)                                                                                   | Viewer/editor contributions, LSP и единая модель редактирования                                                                                                                                                 |
| [07-workspace-security-lifecycle.md](07-workspace-security-lifecycle.md)                                                                           | Workspace indexes, безопасность, permissions, кеши и lifecycle                                                                                                                                                  |
| [08-format-landscape.md](08-format-landscape.md)                                                                                                   | Текущий и потенциальный набор форматов, архитектурные stress cases                                                                                                                                              |
| [09-development-roadmap.md](09-development-roadmap.md)                                                                                             | Пошаговый план реализации и миграции                                                                                                                                                                            |
| [10-acceptance-and-conformance.md](10-acceptance-and-conformance.md)                                                                               | Acceptance scenarios, conformance suites и обязательные gates                                                                                                                                                   |
| [11-open-questions.md](11-open-questions.md)                                                                                                       | Вопросы, требующие решения до стабилизации contract v1                                                                                                                                                          |
| [12-errors-and-diagnostics.md](12-errors-and-diagnostics.md)                                                                                       | Расширяемые ошибки, diagnostics, resolution states и transport                                                                                                                                                  |
| [13-vfs-providers-and-sources.md](13-vfs-providers-and-sources.md)                                                                                 | Подключаемые VFS/source providers, credentials, cache и offline policy                                                                                                                                          |
| [14-processing-and-codec-layering.md](14-processing-and-codec-layering.md)                                                                         | Контейнеры, media codecs, byte transforms и processing package boundaries                                                                                                                                       |
| [15-package-boundaries-and-extension-layout.md](15-package-boundaries-and-extension-layout.md)                                                     | Границы packages, language/viewer hosts и рекомендуемый layout extensions                                                                                                                                       |
| [16-composite-assets-and-origins.md](16-composite-assets-and-origins.md)                                                                           | Single, bundle, namespace и derived assets; multi-source revisions и transactions                                                                                                                               |
| [17-runtime-launch-and-automation.md](17-runtime-launch-and-automation.md)                                                                         | Simulation runtime, replay assistance, запуск игр и безопасная AI/MCP automation                                                                                                                                |
| [18-provider-augmentation-targets-and-ranking.md](18-provider-augmentation-targets-and-ranking.md)                                                 | OS/architecture/ABI targets, расширение providers из других extensions и operation-specific ranking                                                                                                             |
| [19-host-portability-performance-and-extension-dx.md](19-host-portability-performance-and-extension-dx.md)                                         | Node/Electron/web/VS Code portability, hot-path performance и параллельная разработка extensions                                                                                                                |
| [20-world-api-abi-and-multiverse-integration.md](20-world-api-abi-and-multiverse-integration.md)                                                   | Расширяемый World API/ABI, Multiverse runtime composition, SC2/Spring/SAGE profiles и migration                                                                                                                 |
| [21-game-ui-layouts-rendering-and-bindings.md](21-game-ui-layouts-rendering-and-bindings.md)                                                       | Игровые UI/layout codecs, portable projection, renderers, world bindings и editing                                                                                                                              |
| [22-current-state-audit-and-gaps.md](22-current-state-audit-and-gaps.md)                                                                           | Сверка с текущим кодом, comparison matrix, противоречия и недостающие решения                                                                                                                                   |
| [23-contract-identity-schema-resolution-and-lock.md](23-contract-identity-schema-resolution-and-lock.md)                                           | Logical IDs, schema fingerprints, compatibility, deterministic resolver и project/session lock                                                                                                                  |
| [24-extension-security-execution-and-lifecycle.md](24-extension-security-execution-and-lifecycle.md)                                               | Deny-by-default permissions, execution profiles, grants, provider lifecycle, updates и failures                                                                                                                 |
| [25-subject-identity-editing-transactions-and-cache.md](25-subject-identity-editing-transactions-and-cache.md)                                     | Stable SubjectRef, revision vectors, nested editing, transactions, undo, concurrency и cache                                                                                                                    |
| [26-world-state-scheduler-snapshots-and-domains.md](26-world-state-scheduler-snapshots-and-domains.md)                                             | Numeric World data plane, scheduler, commands/events, domains, snapshots, replay и presentation                                                                                                                 |
| [27-final-target-tree-extension-manifest-and-format-catalog.md](27-final-target-tree-extension-manifest-and-format-catalog.md)                     | Единое финальное target tree, extension-manifest v2, contribution envelope и полный planned extension/format catalog                                                                                            |
| [28-extension-distribution-catalog-installation-and-product-discovery.md](28-extension-distribution-catalog-installation-and-product-discovery.md) | Независимые extension repositories, federated catalogs, installation, product inventory/recommendations и scopes generated artifacts                                                                            |
| [29-three-reports-reconciliation-and-adopted-changes.md](29-three-reports-reconciliation-and-adopted-changes.md)                                   | Reconciliation REPORT-1/2/3 и contract challenge REPORT-4A: принятые, скорректированные и отложенные решения, evidence baseline и proof gates; §8 — post-REPORT-4 addendum (BRIEF-5)                            |
| [30-format-definitions-ecosystems-corpora-and-unknown-subjects.md](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)               | Format-knowledge plane: data-only `FormatDefinition`, ecosystem references, format relations, corpus evidence, unknown-subject invariant, encyclopedia stress profile                                           |
| [31-agent-tools-knowledge-and-localization.md](31-agent-tools-knowledge-and-localization.md)                                                       | Agent tooling plane (tools/skills/knowledge/evals над public operations, adapter topology, safe authoring) и knowledge/localization plane (4 домена, stable field-help identity, packs/packaging, KH/AI routes) |

## Основные решения proposal

1. `Subject` — общий знаменатель для файла и логической сущности.
2. `Asset` — subject с `AssetOrigin`: один source, именованный bundle, namespace или
   derived provenance. Главный файл необязателен.
3. `Codec` — provider, который после bounded probe превращает собранный `AssetInput` в
   `AssetHandle`.
4. Trait описывает наблюдаемые данные; coarse codec capability — manifest verb; contract —
   типизированный runtime API; operation отдельно описывает действие и его mutability; facility и
   permission не выводятся из traits.
5. Relation связывает subjects и assets без прямого импорта чужого codec.
6. Provider выбирается по versioned virtual contract, environment, permissions и
   требуемым output traits/contracts.
7. Отсутствие optional provider или совместимого runtime target приводит к degraded state и
   диагностике, но не ломает основной subject.
8. Viewer/editor/language contribution регистрируется глобально и выбирается по
   требованиям через bounded subject/activation/presentation stages. Subject не должен перечислять
   все известные UI implementations или installed state.
9. LSP является transport adapter над neutral language contracts, а не API codec.
10. Существующие codecs мигрируют через adapters и parity tests, без полного rewrite.
11. В v1 standard traits (`TraitInstance`, target rename текущего `CapabilityInstance`) остаются в
    browser-safe subpath `@modkitx/assets`; отдельный `@modkitx/capabilities` отложен. Extension
    traits требуют
    namespaced schema/registry extension, а typed APIs публикуются contracts.
12. Custom errors не являются capabilities. Extensions регистрируют namespaced error
    definitions, а runtime передаёт serializable `ModkitError`/diagnostic envelopes.
13. Custom Git/API/cloud/game-store VFS sources могут подключаться providers из extensions.
    Текущие foundational implementations остаются в `@modkitx/vfs` согласно canonical ownership;
    их возможное извлечение не входит в v1.
14. Container format, elementary media codec, byte transform и decoded representation
    являются разными слоями и разрешаются через отдельные virtual contracts.
15. `language-contracts` отделён от stateful `language-host`; существующий `@modkitx/lsp`
    становится protocol adapter без второго workspace/session model и без временного public facade.
    `viewer-shell` отделён от `workbench`. Dependency направлена от host/application к portable
    contracts и shell.
16. Extension, provider implementation, contract и runtime variant имеют независимые
    версии. Consumer может запросить любой совместимый provider, предпочесть или жёстко
    закрепить конкретный.
17. Provider выбирается для конкретного contract/operation. Parsing, preview, editing и
    export одного asset могут выполняться разными extensions.
18. Simulation runtime и запуск внешней игры являются разными APIs: runtime создаёт
    управляемую session, launch является явно разрешаемой side-effect operation.
19. AI не получает привилегированный обход ядра. MCP/automation host использует те же
    schema-described operations, subjects, relations, permissions и budgets.
20. OS, architecture, ABI и host features являются runtime-target constraints, а не
    версиями. Один contract может иметь независимые TypeScript, WASM и native variants.
21. Extension не изменяет runtime другого extension. Оно предоставляет replacement,
    named operation или viewer offer через публичный contract. General augmentation/projection DAG
    deferred; первый M3 augmentation требует отдельного proof.
22. Provider выбирается по конкретной операции и workload intent; native не получает
    безусловный глобальный приоритет над WASM/TypeScript.
23. Универсальны протоколы композиции, versioned profiles и boundaries. Native/game/vendor
    semantics остаются extension traits/contracts и native representations, а не полями одного
    гигантского DTO.
24. `World API/ABI` не является частью `@modkitx/core` или asset codec. Gate G0 выполняется как
    минимальный target-native Multiverse World proof; текущий SC2 runtime codec служит parity
    oracle и источником переносимых алгоритмов, но не временным owner нового API. Один root runtime
    владеет world/tick/state.
25. Game UI content отделён от Modkit workbench/viewer UI. Native layout/script representations
    сохраняются, portable UI projection является optional, а UI изменяет simulation только через
    validated input/world commands.
26. Целевой Multiverse kernel содержит только handles/storage/tick/commands/events/snapshot/linking
    и lifecycle. В World v0 existing SC2 storage не переписывается; foundation preset появляется
    только после доказанных mechanic boundaries.
27. Component contract, system implementation и authored definition overlay имеют разные
    identity/version. Один contract ID/major/schema hash создаёт одно storage; несовместимые
    movement/pathfinding/health semantics не склеиваются по похожему имени.
28. World data/system order задаётся explicit composition graph и lock. Data overlays могут быть
    layered, но executable system заменяется только через declared exclusive slot/replacement.
29. UI source asset, nested template/frame/style/animation subject, runtime instance и derived
    preview являются разными объектами. Generic Subject Viewer и `SubjectRef` заменяют
    format-specific wiki/card API.
30. Contract/provider/extension/package/runtime-variant identity и version разделены. Portable
    provider-policy lock, target-scoped install lock, machine activation snapshot и deterministic
    session composition являются разными records.
31. Codec runtime variants декларативно объявляют permissions и остаются **единственным authored
    источником** требуемых прав (уточнено решением 56: сводная target-scoped review table у
    root/release — generated verified projection, не вторая authored таблица; drift невозможен по
    построению). Flat union
    является generated UI convenience. Ни review table, ни catalog record не выдают permission. Missing permission означает deny,
    необходимость approval определяет host policy. Installed local
    extensions пока trusted по provenance, но restricted operations используют grants и реальные
    execution boundaries; `trusted-in-process` явно имеет ambient authority.
32. Subject identity отделена от path/revision. Nested edits создают typed plan для owner asset,
    проходят optimistic revision validation и возвращают transaction/undo receipt.
33. World data plane использует index/generation handles, compiled component/resource storage,
    scheduler DAG, typed commands/events и schema-aware snapshots. Первая implementation
    single-threaded; parallel executor является совместимым будущим слоем.
34. `extension-manifest v2` обнаруживает contract-typed contributions через deterministic shallow
    globs. Один contribution envelope покрывает codecs/providers/projections/presets/bridges/UI/World;
    generated catalogs disposable, а physical target tree принадлежит документу 27.
35. Reusable typed compute implementation без source identity является отдельным
    `ServiceProviderContribution`, а не file codec и не новым `ProviderOfferKind`.
36. Codec v2 описывает несколько `FormatRole`, source topology, `ArtifactStage` и supported
    `OpenIntent`. Artifact stage и output representation являются разными осями; v1 `kind` и
    `source|compiled|runtime` мигрируют только через adapter.
37. `open()` получает runtime intent и resource budget. Manifest/JSON Schema claim не доказывает
    bounded behaviour; bytes/modules/memory/time проверяются executable fixtures.
38. Extension publisher/vendor, contribution/provider ID и physical folder разделены. V2 migration
    не меняет текущие codec/game coordinates и tie-break неявно.
39. Editor создаёт edit plan, codec/writer его валидирует, host выполняет transaction. Byte ranges
    уже принадлежат `SourceEdit`, а multi-plan atomicity — transaction semantics.
40. Engine identity/release, Modkit integration contracts и `testedGames` evidence разделены. Game
    может ссылаться на несколько engine/middleware ecosystems без превращения engine name в runtime
    contract version.
41. Main Modkit repository и generic installation содержат platform + bundled `common`, но не весь
    vendor/game ecosystem. Остальные extensions являются независимыми release artifacts из внешних
    repositories/catalogs или build-time embedded dependencies специализированного продукта.
42. Catalog search, install resolution, operation provider resolution и World linking являются
    разными стадиями и имеют разные locks. Catalog metadata читается без activation; recommendation
    ничего не устанавливает.
43. `generated/` является scope-local output, а не глобальным authority: extension build, catalog,
    app bundle, user install, project/session и disposable cache имеют разных owners/lifecycle.
44. Installed-product inventory использует permissioned generic collectors и catalog-supplied
    declarative rules. Core не содержит game/program paths; browser получает inventory только через
    user input или trusted native/embedding bridge.
45. `TraitDeclaration`, generated `TraitEvidenceRecord`, machine-local `ProbedTraitAvailability` и
    observed `TraitInstance` являются разными records. `may-expose` не удовлетворяет hard viewer/
    operation requirement; fidelity принадлежит observed instance.
46. Table/tree/property/timeline/graph/2D/3D/render/language/LSP/automation implementations являются
    optional tool contributions. Product profiles включают только нужные bundles.
47. Executable extension unit имеет independently testable library/provider surface и thin Modkit
    adapter; full workbench не является prerequisite для unit/conformance tests.
48. Deterministic compatibility использует versioned World-state/continuation/composition/content
    roots и envelope root; current `hashWorld` остаётся migration oracle.
49. Знание о формате отделено от executable codec: data-only `FormatDefinition` (+augmentation)
    описывает формат до существования provider и не даёт executable полномочий; его vocabulary —
    knowledge claim уровня `may-expose`, не runtime offer.
50. Unknown source — полноценный persistent subject: формат не входит в root `SubjectRef`;
    установка/удаление codec добавляет/убирает interpretation, не меняя identity и существующие
    ссылки.
51. Engines, middleware и content platforms выражаются одним `EcosystemReference` с `kind`;
    `content-platform` (магазин/дистрибуция) и runtime target (OS/architecture/environment) —
    разные оси, слово `platform` без квалификатора в новых контрактах не используется.
52. Encryption algorithm — обычный byte-transform service; key material — отдельный security
    concern: authored `KeyMaterialRequirement`, brokered non-serializable `OpaqueKeyHandle`,
    секретные байты никогда не входят в manifests/locks/logs/serializable subjects.
53. Corpus evidence имеет пять provenance classes (official-spec / published-reverse-engineering /
    clean-room / corpus-inferred / implementation-observed) и шесть invalidation axes; provenance
    class не является trust elevation.
54. Migration — **target-first** (owner decision 2026-08-12): slice строится на final contracts,
    переносит consumers и удаляет старый путь; переходные публичные facades, dual v1/v2 runtime,
    legacy roots и generated adapters не входят в final target. Постоянные adapters — только
    реальные границы (LSP transport, hosts, execution targets, format→neutral projection,
    published-major bridge, Modkit↔Multiverse).
55. Целевая package-топология — семь platform packages (`core`, `sdk`, `vfs`, `host`, `ui`,
    `runtime`, `testkit`) плюс обоснованные `lsp` и `xml`; новый package — только по правилу
    27 §0.4, subpath по умолчанию.
56. Один contribution mechanism: root manifest объявляет только `contributionManifests` pattern;
    contract identity и security-авторитетность живут в child envelope; сводные таблицы —
    generated verified projections. Contribution не несёт собственную обязательную версию;
    whole-unit `status` — display-подсказка.
57. Нормативный wire-словарь не использует слово `capability`: traits / operations / offers /
    permissions / facilities; asset = subject + `SourceBinding` + representations + traits.
58. Ideal authored tree не содержит root `generated/`; каждый derived artifact живёт у своего
    lifecycle owner, manifests — единственная authority.
59. 7+2 package set, минимальное extension tree и один `contributionManifests` pattern
    **промотированы в canonical** (MODKIT_ARCHITECTURE §6.1, 2026-08-12); прежние развёрнутые
    деревья — non-normative appendix.
60. AI automation — first-class plane над публичными typed operations: agent tool = typed view
    существующего `OperationOffer`; skill/knowledge/eval — data-only contributions без новых
    полномочий; MCP/LLM SDK — host adapters, не kernel dependency; untrusted mod text не
    становится instruction.
61. Localization/help разделены на четыре домена (product UI / schema-field help /
    subject-encyclopedia knowledge / game-content strings); field help привязан к versioned exact
    schema identity, не к display name; fallback детерминирован; packs — data-only.
62. Standalone knowledge library — отдельный источник (текущая энциклопедия = prototype corpus);
    portable KnowledgePack встраивается snapshot-ом или публикуется отдельным extension; `common`
    несёт только bounded curated baseline.
63. Multiverse Engine исполняется proof-first: Gate G0 (P0–P6) до любого Rust/WASM/Spring
    решения; initial network proof сохраняет текущую authoritative-server + client-snapshots
    модель, а lockstep/hybrid сравниваются отдельным post-G0 experiment; dedicated/headless server
    обязателен в плане (owner: docs/multiverse/engine/ROADMAP_ENGINE.md).
64. Authored-дом extension-манифеста — блок `"modkit"` в `package.json`; standalone-контейнер
    `modkit.extension.json` (та же schema) — только для non-npm layout (native-only, Rust/WASM,
    data-only packs, GitHub-Releases-only). Ровно один authored-контейнер на artifact (оба —
    packaging error); оба нормализуются в один контракт `ExtensionManifest`. npm-extension по
    построению — одновременно обычная библиотека (dual publishing).
65. Authoring-форма ≠ published-форма. **Data-only — это discovery-контур, не весь артефакт**:
    canonical contribution JSON читается без исполнения (каталог/установка/inspection), а
    implementation entrypoints (JS/WASM/native) исполняются только после resolution и permissions.
    Typed TS builders — авторская форма; `pack` замораживает их в канонический JSON.
66. Golden path автора — 4 понятия (Subject, Contribution, Contract, Operation) и путь
    scaffold → test → explain → pack; остальные плоскости — слои «когда понадобится»
    (owner: 19 §16). Метрики DX измеряются testkit-отчётом; «10–20 минут» — hypothesis до
    usability-теста.
67. Conformance badges (Detect/Read/Preview/Edit/Round-trip/Browser/Headless/Fuzzed) — generated
    из testkit/evidence, не self-declared; финально замещают whole-unit `status` (owner: 10 §21).
68. Дистрибуция static-first: подписанный статический Git/HTTPS JSON-каталог до любого
    marketplace-сервиса; именованные product profiles (SC2 Mod Studio, Universal Asset Explorer,
    Headless Mod CI, AI Modding Toolkit и др.) — данные, не форки кода (owner: 28 §16).
69. Семейство interchange-форматов — **Universal Verse (UV)**: короткий реестр из 12 форматов
    (UVE/UVP/UVD/UVW/UVS/UVR/UVM/UVT/UVA/UVV/UVF/UVG) с physical mapping на открытые стандарты
    (glTF 2.0, KTX2, Matroska/EBML, OpenType/WOFF2, secure SVG 2); прежние UMF/URMF/UDEF/UMSF и
    `.mv*` переименованы атомарно до публикации каких-либо `$id` (owner:
    docs/multiverse/README.md §2.1 migration note).
70. UVE ≠ UVP trust boundary: UVE — единственный UV-формат с executable payloads (deterministic
    signed ZIP, review до activation); UVP — data-only package без executable authority (скрипты
    внутри inert до явного script-host + policy + composition lock).
71. «7+2» — это publication units, не обязательные зависимости: bootstrap closure минимального
    host = `core`+`sdk`+`vfs`+`host`; `testkit` — dev-only; `ui`/`runtime`/`lsp`/`xml` —
    optional modules по product profile, их contracts живут в sdk subpaths (canon §6.1 closure
    classes).
72. Три publication-случая: pure npm library (без contribution); npm package + Modkit extension
    (package.json#modkit; dual publishing); non-npm UVE artifact (modkit.extension.json →
    `.uve`). Pure utility library не обязана иметь extension manifest.
73. `.mva` retired (animation bank = UVM profile в `.uvm.glb`); `.mvx` superseded назначенным
    `.uvp`; glTF vendor-префикс UMF\_\* → UV\_\* (не был опубликован); MODKITX\_\* incubation
    остаётся до governance.
74. Дополнительные UV-кандидаты по admission-rule: UVI (interface) + UVY (style) deferred как
    связанная пара до portable-UI gate; UVL
    (localization) = UVP/contribution profile, не формат; rich text = bounded message AST; replay
    — без имени до World API/ABI; save = World ABI envelope (не раньше G0); materials/particles —
    UVM/UVD extensions; nav/physics — UVW payloads + provider caches; code — native source + UVS
    IR; documents — subjects/UVP payloads.
75. Sandbox future — gate-driven лестница SB-0…SB-5 (24 §6.1, принято 2026-08-12): SB-0 (единая
    permission taxonomy, deny-by-default dispatch + grant intersection, broker checks в реальных
    I/O providers, full-authority diagnostic, browser-boundary proof) обязательна до массовой
    миграции кодеков и до первого mutating AI tool; worker isolation, WASM restricted imports,
    sandboxed OS process, signatures/quarantine и remote trust строятся строго по своим gates;
    понижение execution profile никогда не происходит молча — недоступный требуемый профиль даёт
    `unresolved`, а не более слабую границу.

## Матрица охвата

| Область                                          | Механизм proposal                                                                   | Состояние после этой редакции                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Один файл, directory, archive entry              | `ArtifactSource` + `AssetOrigin`                                                    | Определено                                                      |
| Image + palette, CUE/BIN, model sidecars         | `bundle` с именованными bindings                                                    | Определено                                                      |
| CASC, Git tree, SC2Map directory                 | `namespace`/VFS mount без обязательного primary                                     | Определено                                                      |
| Image/audio/video/model/container                | Traits + независимые processing/service contracts                                   | Определено                                                      |
| Universal model preview/conversion               | Native representation + `RenderModel` projection + conversion report                | Определено                                                      |
| Game entities and relations                      | `SubjectHandle` + typed lazy relations                                              | Определено                                                      |
| LSP, table/tree/text editing                     | Neutral language contracts + language host + adapters                               | Определено                                                      |
| Runtime, replay, external game launch            | Runtime session + explicit launch operation                                         | Определено                                                      |
| Extensible Multiverse world runtime              | Target-native G0 proof; SC2 runtime codec — partial parity oracle, не API owner     | Определено как proposal; proof не реализован                    |
| Shared и game-specific mechanics                 | Minimal neutral contracts + namespaced facets/systems; explicit semantic profiles   | Определено как proposal; exact schemas открыты                  |
| 2D/3D movement, pathfinding, health models       | Разные optional foundation/game contracts, не один `movement`/`health` DTO          | Определено концептуально; нужны conformance fixtures            |
| Game UI/layout parsing and rendering             | Native codec + optional portable UI projection + renderer/binding providers         | Определено как proposal                                         |
| AI/MCP                                           | Automation adapter над schema-described operations                                  | Определено как host layer                                       |
| Native/WASM/TypeScript portability               | `RuntimeTarget` + operation-specific provider ranking                               | Определено                                                      |
| Расширение codec из другого extension            | Replacement/augmentation/projection/operation offers                                | Определено                                                      |
| Node/Electron/web/VS Code/embed                  | Portable contracts + host facilities/adapters                                       | Определено                                                      |
| Parallel extension development                   | Namespaces, generated catalogs, SDK/testkit, no central switches                    | Определено                                                      |
| Independent extension repositories               | Bundled `common` + external immutable artifacts + federated catalogs/direct install | Определено как target; independent artifact proof не реализован |
| Extension recommendation from installed software | Generic consented inventory evidence + declarative catalog rules                    | Определено как target; native/browser proofs не реализованы     |
| Legacy migration                                 | Adapters, conformance и parity slices                                               | Определено; реализация поэтапная                                |
| Формат без executable codec                      | `FormatDefinition` + augmentation (30 §2)                                           | Определено как candidate; PR-17                                 |
| Неизвестный/opaque source                        | Root subject без формата в identity + interpretations (25 §20, 30 §5)               | Определено как candidate; PR-16                                 |
| Engines/middleware/content platforms             | `EcosystemReference` с kind (30 §3)                                                 | Определено как candidate                                        |
| Non-path logical references                      | `ResourceLocatorRef` contract-based schemes (16 §15)                                | Определено как candidate; PR-20                                 |
| Encrypted content + keys                         | Key requirement/broker/decrypt split (24 §12.1)                                     | Определено как candidate; PR-18                                 |
| Corpus/provenance знание                         | `CorpusEvidenceManifest`, 5 classes / 6 axes (30 §6)                                | Определено как candidate; PR-19                                 |
| Энциклопедия как stress corpus                   | `FormatStressProfile` + двусторонняя проекция (30 §8)                               | Определено как candidate; PR-22                                 |

Слова `Определено` в этой таблице означают, что выбрана архитектурная граница, а не что API уже
реализован или готов к stable v1. Фактическое состояние и незакрытые implementation decisions
собраны в [22-current-state-audit-and-gaps.md](22-current-state-audit-and-gaps.md).

## Promotion map

Единая карта состояния: что уже принято canonical owners, что остаётся candidate v2, что требует
proof. Основание — REPORT-4 (§3/§12) и REPORT-5.

| Статус                                      | Материал                                                                                                                                                                                                                                                                                                             | Где                                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adopted в canonical**                     | Data-layer rule §6.0; traits/operations manifest surface + namespaces; four-record trait gap note; runtime variants; `MSFT_lod` неприкосновенен; формат-именование пере-принято UV-реестром 2026-08-12 (историю `.mvx`/`.mva` см. MIGRATION_LEGACY_NAMES)                                                            | MODKIT_ARCHITECTURE; ASSET_CAPABILITIES §§4–5, 13; multiverse README/specs                                                                     |
| **Adopted в canonical (2026-08-12)**        | 7+2 catalog + closure classes (§6.1); принятая extension topology 27 §0 → канон §5.8/§5.13 (`package.json#modkit`, явный `contributionManifests`, конвенция vs taxonomy); terminology pass живых секций §4/§5/§15/§16 на old package names; UV family registry 12 форматов + candidates UVI/UVY; навигационный обзор | MODKIT_ARCHITECTURE §§4–6, 15–16; multiverse README §1–2.1 + INDEX §Format maturity; architecture/TARGET_ARCHITECTURE_OVERVIEW.md (non-owning) |
| **Accepted basis, not frozen (2026-08-14)** | Read-only codec/service/viewer contribution specs, sessions, host activation/presentation slice, `common/plain-text`; owner decisions Q78–Q85                                                                                                                                                                        | BRIEF-13A R4; 02/05/06/11/12/19/27/30; gates A-1…A-8                                                                                           |
| **Candidate v2, own proofs remain**         | `format-definition`/`corpus-evidence` publication, open definition registries, distribution/install locks, permission/execution expansion and provider-policy lock v1                                                                                                                                                | 27 §6; 30; 24 §3; 23 §11                                                                                                                       |
| **Candidate, ждёт own proof**               | Four trait records (PR-1); bounded global join (PR-4); envelope roots (PR-10); unknown root (PR-16); FormatDefinition (PR-17); key material (PR-18); corpus invalidation (PR-19); locators (PR-20); stress conformance (PR-22)                                                                                       | 02/29; 06; 26; 25 §20; 30; 24 §12.1; 16 §15                                                                                                    |
| **Deferred до consumer/benchmark**          | Game package stable v1; general augmentation DAG; behavior IR; Rust/WASM; portable UI protocol; standalone provider-host/language-host packages                                                                                                                                                                      | 29 §5; divergence register                                                                                                                     |

## Consolidation map (BRIEF-6)

Куда сходятся 32 файла workspace после promotion; уникальные решения и evidence не удаляются.

| Роль                                | Файлы                                                                                                                                                | Судьба                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Постоянные owners                   | 16, 23, 24, 25, 26, 27, 28, 30                                                                                                                       | Остаются нормативными владельцами своих плоскостей                                                                       |
| Terminology/domain owners           | 00, 01, 02                                                                                                                                           | Остаются; 02 §1 — финальный словарь                                                                                      |
| Механизмы, сходящиеся во владельцев | 03, 05, 14, 18 → 23/27/30; 04 → 25; 06, 21 → ui-owner (06); 07 → 24/25; 13 → vfs-owner (13 остаётся до promотирования в канон §5.9); 17 → runtime/24 | Становятся короткими ссылками/appendices после соответствующих proof                                                     |
| Roadmap/acceptance                  | 09, 10, 11                                                                                                                                           | 09 — target-first route; 10 — gates; 11 — ADR-журнал                                                                     |
| Аудит/сверка                        | 22, 29                                                                                                                                               | 22 — dated evidence (история); 29 — decision journal                                                                     |
| Кандидаты на архив после promotion  | 08, 12, 15, 19, 20                                                                                                                                   | 08 → энциклопедия/30; 12 → core errors канона; 15 → 27 §0; 19 → REPORT-метрики; 20 → Multiverse repo docs при извлечении |

## Правила изменения proposal

- Существенное изменение добавляется сначала в
  [11-open-questions.md](11-open-questions.md).
- После решения вопрос переносится в раздел `Resolved decisions` с датой и
  аргументацией.
- Примеры API считаются иллюстративными до утверждения contract version.
- Volatile repository counts всегда снабжаются датой и способом пересчёта.
- Proposal не должен утверждать, что feature реализована, если она только
  спроектирована.
