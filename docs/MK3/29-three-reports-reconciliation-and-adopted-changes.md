# 29. Reconciliation of the Architecture Reports and Contract Challenge

Status: **non-canonical decision record for the Proposal workspace**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Inputs: [REPORT-1](../tasks-active/platform-architecture/REPORT_1_review_consistency_and_traits.md),
[REPORT-2](../tasks-active/platform-architecture/REPORT_2_target_platform_and_distribution.md),
[REPORT-3](../tasks-active/platform-architecture/REPORT_3_multiverse_specs_and_proof_game.md),
[REPORT-4A](../tasks-active/platform-architecture/REPORT_4A_sol_contract_challenge.md)  
Reconciled: 2026-08-11

Этот документ не создаёт ещё одну архитектуру. Он фиксирует, какие выводы трёх отчётов приняты,
какие скорректированы и какие остаются гипотезами. Нормативная форма каждого контракта по-прежнему
принадлежит его документу-владельцу из [README](README.md).

## 1. Проверенный baseline

Текущие числа нельзя копировать в долгоживущие acceptance criteria. Они пересчитываются командой:

```text
node scripts/report-platform-architecture-review-baseline.mjs
```

Снимок 2026-08-11 для текущего worktree:

| Метрика                                                       |                                                                                                                         Значение |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------: |
| Catalog entries                                               |                                                                                                                              233 |
| Non-game / game entries                                       |                                                                                                                         202 / 31 |
| Entries under extension roots / legacy roots                  |                                                                                                                         140 / 93 |
| Physical extension roots                                      |                                                                                                                               28 |
| Unique declared traits / declarations / manifests with traits |                                                                                                                     25 / 66 / 19 |
| Unique operations / declarations                              | 56 / 466 (was 463 earlier the same day, before `game.discover-install`/`game.inspect` probe rows landed on three game manifests) |

Migration buckets из обязательного migration-status audit: 133 moved, 47 pending, 22 manifest-only
stubs, 31 game entries. `pnpm codecs:validate` проходит для 233 manifests, а
`pnpm codecs:traits:check` сейчас корректно обнаруживает stale trait index. Поэтому числа 242, 236,
223 и связанные с ними target allocations в старых снимках не являются текущими gates.

## 2. Принято без изменения направления

1. Универсальны protocol boundaries, composition и доказанные profiles, а не один giant asset,
   entity, UI или World DTO.
2. Trait, operation, runtime contract, facility и permission являются независимыми понятиями.
3. Viewer/editor/language offers сопоставляются с materialized subject через глобальный installed/app
   contribution catalog. Descriptor может содержать hints, но не полный список известных UI
   implementations.
4. Кодек формата, container, compression/elementary-media service, projection и renderer имеют
   разные композиционные роли. Они могут поставляться разными extensions.
5. Main repository/default generic product содержит platform и явно выбранный bundled-common
   profile. Vendor/game extensions живут в независимых repositories; specialized apps могут
   встраивать и pin-ить их заранее.
6. Portable provider-policy lock, target-scoped install lock, machine activation snapshot и World/
   session compatibility composition остаются отдельными.
7. D1 должен доказать независимый extension artifact на существующем manifest v1. Manifest v2 не
   является предварительным условием дистрибуции.
8. Modkit владеет subjects, sources, provider resolution, authoring и запуском runtime session.
   Multiverse владеет World state, scheduler, storage, snapshots и deterministic session state.
   Multiverse не зависит от Modkit; adapter extension может зависеть от обоих public contracts.
9. `SimEngine`/`GalaxyGameState` являются migration oracle и proof input, а не нейтральным World API.
10. Rust/WASM, отдельный provider host, portable UI contracts и general augmentation DAG извлекаются
    только после потребительского/performance/isolation proof.

## 3. Trait declaration model after REPORT-4A

REPORT-1 правильно выделил независимые смысловые оси, но ошибочно собрал их в один authored claim.
Приняты четыре разных records с разными owners:

| Record                    | Author/owner                     | Содержание                                                                         |
| ------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `TraitDeclaration`        | extension release                | ID, representation, `may-expose`/`will-expose`, prerequisites, evidence refs       |
| `TraitEvidenceRecord`     | publication/conformance pipeline | provider/release/contract/target class, dependency+corpus digests, strength/result |
| `ProbedTraitAvailability` | machine activation cache         | variant/input/facility-specific bounded probe result                               |
| `TraitInstance`           | materialized subject/runtime     | observed state/fidelity, parameters and diagnostics                                |

`may-expose` годится для shortlist/install suggestion, но не удовлетворяет hard singleton viewer
requirement. `will-expose` позволяет planning только после match и prerequisites. Окончательное
сопоставление с viewer/editor выполняется по observed descriptor вместе с operations/contracts.
Отсутствие manifest claim означает `undeclared`, а не `unsupported`.

Backfill остаётся consumer-driven. Сначала исправляются trait-index gate, presence/evidence и
representation semantics, затем пять реально используемых routing families. Полное механическое
заполнение всех manifests запрещено как ложная уверенность.

## 4. Скорректированные выводы отчётов

### 4.0 Global contributions and optional tools

Global join принят, но не как один omniscient resolver. Application/workbench оркестрирует bounded
stages `subject facts → semantic offers → activated provider/security selections → presentation
plan`. Descriptor остаётся portable; inventory/policy/facilities/grants и selected factories являются
snapshot inputs. Concrete table/tree/property/timeline/graph/2D/3D/language/LSP/automation tools
опциональны и физически включаются product profile. Executable contribution имеет independently
testable library/provider surface и thin Modkit adapter; minimal host допускается, full workbench —
нет.

### 4.1 Extension security declaration

REPORT-2 ошибочно трактует `ExtensionSecurityDeclaration` только как generated catalog view. Это
противоречит исходному брифу и принятому ранее требованию reviewable manifest declaration.

Принята target-scoped модель:

1. Каждый executable runtime variant является авторитетным источником своих requested permissions,
   target constraints и execution profile.
2. Extension manifest содержит authored `security` review rows по contribution/variant/target.
3. Validator требует точного совпадения каждой строки с executable declaration. Расхождение,
   пропуск, phantom или broadened row блокирует packaging.
4. Catalog публикует verified projection и provenance до variant manifests. Ни summary, ни catalog
   record не выдают permission и не расширяют права variant.
5. Host grants и реальный enforcement остаются отдельными. `trusted-in-process` честно обозначает
   ambient authority, а не sandbox.

### 4.2 Generated state

Root `generated/` не является глобальным registry и не хранит installed state или locks. Каждый
scope имеет своего владельца и lifecycle: platform development, extension release staging,
federated catalog, app bundle, user installation, project/session и disposable cache.

### 4.3 Provider identity, locks and composition

- Provisional M3 contract принадлежит authority specification/conformance suite
  (`org.modkitx.contracts/m3-open` до governance proof), а native format identity отдельно равна
  `blizzard.m3`; provider, extension release, variant и ABI имеют другие coordinates.
- Project provider-policy lock хранит logical contract/provider majors и allowed fallbacks без
  OS/architecture/variant/tools/facilities/grants. Install lock хранит target artifacts. Machine
  activation snapshot и deterministic session composition — отдельные records.
- V1 поддерживает primary/replacement и named operations. General augmentation DAG deferred; M3
  animation augmentation допускается только после explicit input/output/ownership/conflict proof.

### 4.4 Multiverse format corrections

- Официальный `MSFT_lod` сохраняет свою спецификацию (`ids` на node/material). Старый
  `UV_game_lod` superseded: selection/hysteresis, batching hints и impostor relation разделены на
  provisional `MODKITX_*` incubation extensions; shared `UV_*` имя требует governance/proof.
- `.mvx` освобождается: UVM имеет `.uvm.glb`/directory representation, а generic multi-asset/mod bundle
  не получает extension до появления отдельного consumer и specification.
- `.mva` остаётся provisional UVM profile, но не становится interoperable extension без profile,
  validation и fixture.
- UVW `regionsCrs` является manifest field и уже должен присутствовать в schema/fixture.
- UVS требует canonical serialization, time-unit rules и campaign integrity; UVD — schemas,
  fixtures, canonicalization и content-hash policy до runtime adoption.
- UVS не использует universal ceil: compiled integer ticks связываются с time profile, per-field
  quantization и compiler version. Core AI v0 содержит provider/profile refs, а script binding —
  digest, entrypoint, runtime contract major, determinism class, World requirements и composition ID.

### 4.5 World and game-package boundary

- `SPEC_GAME_PACKAGE.md` пока является experimental profiled subject bundle requirements, не stable
  format. Stable minimum извлекается после standalone Multiverse load, Modkit edit и второго adapter;
  executable entrypoints/product discovery/generic kind в minimum не входят, `.mvx` не назначается.
- Public deterministic identity — versioned domain-separated envelope: World-state, continuation,
  composition and content roots plus envelope root. Current `hashWorld` — migration oracle.
- World kernel ограничен registration/storage/query/scheduling/clock/RNG/snapshot/hash/lifecycle.
  Mechanic identity включает contract major и schema/behavior digests; slot modes не допускают silent
  priority override. RTS vocabulary остаётся profile/foundation, не World core.

## 5. Не приняты как готовые требования

Следующие пункты полезны как experiment hypotheses, но не являются обещаниями архитектуры:

- конкретные performance budgets из REPORT-2/3 до первого representative baseline;
- форк Spring/Recoil или немедленный переход движка на Rust;
- публикация нового generic mod-package формата без consumer;
- promotion trait/profile только по похожести терминов;
- portable UI similarity percentage;
- массовое физическое извлечение extensions до D1/D2 и build-boundary proof.

## 6. Обязательные proof slices после документационного закрытия

1. **Evidence integrity:** generated baseline, trait-index check и documentation checker становятся
   воспроизводимыми gates.
2. **Canonical ordering:** protocol/generator/lock ordering не использует locale-sensitive compare.
3. **Independent artifact D1 on v1:** isolated non-common artifact устанавливается в common-only
   host; linked-root development также собирается без ручного root switch.
4. **Bounded global viewer join:** installed viewer выбирается без упоминания ID в descriptor;
   subject, activation/security and presentation stages invalidируются независимо.
5. **Open contribution definitions:** manifest v2 доказывает custom trait/error/viewer provider без
   изменения core property list, сохраняя v1 coordinates через adapter.
6. **Open-to-save:** минимум один non-SC2 artifact проходит open → edit → grant → commit receipt →
   reopen с revision check.
7. **World v0:** current `hashWorld` сохраняется oracle-ом, а versioned World/continuation/
   composition/content envelope roots проходят restore-and-continue и exhaustive state inventory.
8. **Proof game:** отдельный extension repository использует обычные UVD/UVW/UVS/UVM inputs и
   public World/Modkit contracts, без собственного привилегированного пути.
9. **Optional standalone tools:** один viewer/renderer/language provider проходит direct-library,
   minimal-host и Modkit-adapter tests; минимальный audio/web profile физически не содержит
   table/3D/LSP/automation implementations.

## 7. Оставшиеся вопросы для финальной ревизии

1. Полная role-to-grammar таблица ID, canonical actor aliases и окончательный M3 contract authority.
2. Machine-readable schemas для declaration/evidence/probe/instance и corpus invalidation.
3. Authored target-scoped security rows и mismatch diagnostics.
4. Доказан ли вообще stable profiled-subject/game bundle после двух independent consumers.
5. Exact compatibility-envelope serialization/domain tags и exhaustive inclusion inventory.
6. Governance и окончательные имена split UVM LOD/batching/impostor extensions.
7. Default bundled-common profiles: минимальный fallback/tool набор для CLI, Electron, IDE, PWA,
   web component и library; generic codecs/tools сверх минимума остаются opt-in.
8. Где проходит минимальная host boundary для independently usable VFS/document/GPU providers и как
   conformance testkit проверяет их без full Modkit app.

## 8. Post-REPORT-4 addendum (BRIEF-5, 2026-08-11)

Разделы 1–7 — история сверки REPORT-1/2/3/4A и не переписываются. REPORT-4 закрыл исходный scope;
BRIEF-5 повторно открыл только новые пробелы, и их решения зафиксированы так:

| Новый пробел                          | Решение                                                                                                                        | Владелец                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Знание о формате без executable codec | Data-only `FormatDefinition` + augmentation/collision rules; contribution kinds `format-definition`/`corpus-evidence` в v2     | [30 §2](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md); [27 §6](27-final-target-tree-extension-manifest-and-format-catalog.md) |
| Неизвестный формат как subject        | Root `SubjectRef` без формата в identity; interpretation add/remove не меняет refs                                             | [25 §20](25-subject-identity-editing-transactions-and-cache.md); [30 §5](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)        |
| Engines/middleware/content platforms  | Один `EcosystemReference` с `kind`; `content-platform` ≠ runtime target                                                        | [30 §3](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)                                                                         |
| Отношения форматов                    | `FormatRelationClaim` (≠ subject relations из 25 §13); framing reuse через `uses-framing`                                      | [30 §4](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)                                                                         |
| Логические ссылки не-path природы     | `ResourceLocatorRef`: contract-based scheme + opaque payload + bounded scope; resolution через обычный 23-путь                 | [16 §15](16-composite-assets-and-origins.md)                                                                                                      |
| Key material                          | `KeyMaterialRequirement`/`OpaqueKeyHandle`; requirement ≠ broker ≠ decrypt service ≠ container codec; секреты не сериализуются | [24 §12.1](24-extension-security-execution-and-lifecycle.md)                                                                                      |
| Corpus evidence                       | `CorpusEvidenceManifest`, пять provenance classes, шесть invalidation axes, hash-only inventory                                | [30 §6](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)                                                                         |
| Энциклопедия как stress corpus        | `FormatStressProfile` + двусторонняя проекция; команда `formats:stress` — future task, не существующий gate                    | [30 §8](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md); [10 §20](10-acceptance-and-conformance.md)                             |

Все записи — candidate до proof-слайсов PR-16…PR-24 (REPORT-5). Canonical promotion этим
addendum-ом не выполняется.

## 9. Post-REPORT-5 simplification addendum (BRIEF-6, 2026-08-12)

Контракты REPORT-5 сохранены; сжат механизм композиции и физическая топология. Owner decision:
**target-first** — внешних пользователей API нет, переходные публичные слои не строятся; канон §1/§14
обновлён, adapters-first superseded.

| Решение                                                                                         | Форма                                                                                                                                                                                                                   | Владелец                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform packages: 7 + 2 обоснованных (`lsp` protocol adapter, `xml` format library вне kernel) | `core`/`sdk`/`vfs`/`host`/`ui`/`runtime`/`testkit`; правило физического выделения                                                                                                                                       | [27 §0.1/§0.4](27-final-target-tree-extension-manifest-and-format-catalog.md); [15 §0](15-package-boundaries-and-extension-layout.md)                 |
| Один discovery pattern `contributionManifests` вместо category globs                            | contract живёт в child envelope; большой `contributes[]` — generated projection                                                                                                                                         | [27 §0.3/§5](27-final-target-tree-extension-manifest-and-format-catalog.md)                                                                           |
| Contribution `version` убран как обязательное поле                                              | Локи → `(extension coordinate, contribution id, contract major)`                                                                                                                                                        | [27 §0.5.1](27-final-target-tree-extension-manifest-and-format-catalog.md)                                                                            |
| Whole-unit `status` понижен до display-подсказки                                                | manifest-only stubs → data-only `FormatDefinition`                                                                                                                                                                      | [27 §0.5.2](27-final-target-tree-extension-manifest-and-format-catalog.md); [30 §2](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md) |
| Один authored владелец security                                                                 | child manifests авторитетны; root/release review table — generated verified projection (уточняет §4.1: авторитетность authored rows переходит к child manifests, требования reviewability/target-scoped rows сохранены) | [24 §3](24-extension-security-execution-and-lifecycle.md)                                                                                             |
| FormatDefinition governance без discovery order                                                 | explicit coordinate binding + `augments: {formatId, owner}`; competing definitions с diagnostics                                                                                                                        | [30 §2.1](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)                                                                           |
| Без root `generated/` в ideal authored tree                                                     | derived artifacts у lifecycle owners                                                                                                                                                                                    | [27 §0.6/§1.3](27-final-target-tree-extension-manifest-and-format-catalog.md)                                                                         |
| Терминология: `capability` вне normative wire vocabulary                                        | traits/operations/offers/permissions/facilities; малый словарь из 10 понятий                                                                                                                                            | [02 §1](02-capabilities-and-contracts.md)                                                                                                             |
| Session identity не несёт definition revisions                                                  | compiled artifact/content/composition fingerprints; source revision — provenance compilation receipt                                                                                                                    | [20](20-world-api-abi-and-multiverse-integration.md); REPORT-6 §12 case 17                                                                            |
| Target-first slices S0–S7                                                                       | final contracts → bounded proof → direct port → перевод consumers → deletion                                                                                                                                            | [09 §Strategy note](09-development-roadmap.md); канон §14                                                                                             |

Границы §6 BRIEF-6 (identity≠interpretation≠representation≠provider; declaration≠grant≠enforcement;
lock scopes; control≠hot plane; Modkit≠Multiverse и др.) не слиты — проверка по 20 cases в
REPORT-6 §12.

## 10. Canonical reconciliation addendum (BRIEF-7, 2026-08-12)

REPORT-6 нашёл малую форму; BRIEF-7 довёл её до канона и добавил engine/AI/knowledge планы:

| Решение                                                                                                                                                                                          | Владелец                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 7+2 package set промотирован в canonical §6.1 с mapping-таблицей старых имён; прежний канонический каталог понижен до non-normative appendix (§§6.4–6.7)                                         | MODKIT_ARCHITECTURE §6                                                        |
| Proposal 27 перестал быть «candidate»: §0 — adopted boundary, §§2–5/10 — явный appendix                                                                                                          | 27 (status header)                                                            |
| Runbooks получили target-first executable rules; future facade-инструкции удалены, completed notes явно исторические, deletion oracle закрывается owning slice                                   | RUNBOOK_application_topology_migration, RUNBOOK_vfs_source_provider_migration |
| Lock identity после отмены contribution.version: `ProviderPolicySelection = {extension coordinate, releaseRange?, contributionId, contractMajor}`; digest/variant — в install/activation records | 23 §11                                                                        |
| Engine execution plan: logical subsystem map ≠ physical tree; Gate G0 P0–P6; сетевые модели и initial topology; post-G0 stages 1–17; Rust/WASM/Spring gates                                      | docs/multiverse/engine/ROADMAP_ENGINE.md                                      |
| AI plane: tool=OperationOffer view; skill/knowledge/eval — data-only kinds; adapter topology; AI-0…AI-6                                                                                          | 31 §1; 27 §0.3                                                                |
| Knowledge/localization plane: 4 домена; stable field-help identity; packs/packaging/hybrid distribution; KH-0…KH-6                                                                               | 31 §2                                                                         |
| Session identity: только compiled content/composition/engine-protocol/numeric-profile roots; receipt — provenance                                                                                | ROADMAP_ENGINE §4; 20                                                         |

Исторические REPORT-4/5/6 не переписаны; их errata — в REPORT-7 §2–3.

## 11. Entry-simplification addendum (2026-08-12, post-REPORT-7)

Ядро 7+2 дальше не сжимается по split-правилу (проверено: `runtime` держится как постоянная
Modkit↔Multiverse граница, `vfs` — stateful sessions + /node closure, `lsp`/`xml` — прежние
обоснования). Упрощение входа выполнено слоем поверх, без новых пакетов и без потери функций:

| Решение                                                                                                                 | Owner                |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Один authored-файл: `package.json#modkit`; `extension.json` только без package.json; dual publishing по построению      | 27 §0.2/§0.3         |
| Authored-TS builders → published канонический JSON; каталог никогда не исполняет код                                    | 27 §0.3              |
| Взгляд автора «4 понятия»; golden path scaffold→test→explain→pack; DX-метрики в testkit                                 | 27 §0.2; 19 §16      |
| Conformance badges вместо заявлений; финальная замена whole-unit status                                                 | 10 §21               |
| Целевая структура bundled common family (+media-слияние audio/video, +text-data, +knowledge baseline; documents opt-in) | 27 §0.7              |
| Static-first federated catalog; именованные product profiles                                                            | 28 §16               |
| Engine: determinism test lab в testkit; editor = клиент публичного inspection-API; продуктовая лестница по стадиям      | ROADMAP_ENGINE §3/§8 |

Operation-first API (одни operations из библиотеки/CLI/MCP/HTTP/UI) уже принят решением 60 и
Proposal 31 §1; здесь только подтверждён как правило golden path.

## 12. Universal Verse addendum (BRIEF-9, 2026-08-12)

| Решение                                                                                                                                               | Owner                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Семейство UV из 12 форматов; атомарный rename UMF/URMF/UDEF/UMSF → UVM/UVW/UVD/UVS и `.mv*` → `.uv*` до публикации `$id`; migration note с provenance | docs/multiverse/README.md §1–2.1                                                        |
| Новые accepted-форматы со stub-владельцами: UVE (`.uve`, заменил `.modkitx-extension`), UVP (`.uvp`, закрыл `.mvx`), UVR, UVT, UVA, UVV, UVF, UVG     | docs/multiverse/{extension,package,ruleset,texture,audio,video,font,vector}/SPEC_UV*.md |
| UVE/UVP trust boundary; `.mva` retired в UVM-профиль                                                                                                  | README §2.1; SPEC_UVE/SPEC_UVP                                                          |
| Closure classes: bootstrap = core+sdk+vfs+host; testkit dev-only; ui/runtime/lsp/xml — optional modules (contracts в sdk subpaths)                    | canon §6.1                                                                              |
| Отложенные кандидаты (UVI interface + UVY style / UVL / rich-text / replay / save / materials / particles / nav / code / documents)                   | README решение 74; REPORT-9 §12 и последующее P0 naming-разделение                      |
| Common family: + `common/fonts`; vector переориентирован на UVG-профиль                                                                               | Proposal 27 §0.7                                                                        |

Исторические REPORT-1…8 сохраняют старые имена как history.

## 13. Execution boundary addendum — Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable)

Принято без изменения направления: одна граница исполнения (capability‑RPC `x3.host/rpc`), method
surface в contract definitions (обе ветки), стандартные surfaces в sdk с типовым pin, runtime‑ABI
surfaces host‑internal, Node worker backend как SB‑1 с verify‑at‑evaluation и host policy. Скорректированы
относительно ранних набросков: `leased-value` вместо смены ABI, данные гибридов внутри handle ref,
копирование аргументов вместо переноса, `undefined` внутри объектов, profile‑имена по Q77 в §5
документа 24. Подробно — документ [32](32-execution-boundary-and-method-surfaces.md), решение — [ADR‑HOST‑001](adr/ADR-HOST-001-capability-rpc-and-method-surfaces.md).
