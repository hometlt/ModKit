# 10. Acceptance and Conformance

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Test layers

```text
Documentation contract checks
Contract unit tests
Manifest/schema tests
Provider conformance suites
Resolver/lock tests
Codec parity fixtures
Cross-provider integration tests
Host/viewer/LSP tests
Performance/resource tests
Security/failure tests
Real-data smoke tests
```

### Documentation contract checks

Proposal CI is meaningful only after every Proposal document and its index entry are tracked. The
checker must do more than count duplicate declarations:

- exactly one normative owner/definition for every owned core type;
- referential closure for types used by normative TypeScript blocks, with explicit imports and a
  small built-in allowlist rather than accepting every unknown symbol;
- qualified-ID grammar validation for literals in normative blocks and examples;
- a curated one-concept/one-ID table for shared errors, traits, relations and contracts;
- local Markdown file, anchor and explicit document/section-reference resolution;
- formatting and forbidden-stale-term checks.

These checks prevent structural regressions. They do not prove semantic completeness of a provider
lock key, snapshot domain, transaction guarantee or scheduler declaration; those require the
specific conformance fixtures below.

## 2. Core contract tests

- Subject без source сериализуется и открывается.
- Asset является корректным Subject.
- Single-file asset использует один binding без synthetic bundle.
- Bundle asset открывается без primary и сохраняет binding roles/revisions.
- Namespace asset открывается через mount без перечисления всех entries заранее.
- Derived asset сохраняет input provenance и recipe/provider versions.
- Unknown extension capability сохраняется round-trip.
- Capability version mismatch диагностируется.
- manifest `may-expose` участвует в shortlist, но не удовлетворяет hard singleton viewer query;
- matched `will-expose` допускает planning, но nested subject traits не считаются observed до
  materialization/describe;
- asserted/fixture/corpus verification не меняет presence, а stale evidence digest блокирует claim;
- отсутствие manifest claim означает undeclared, а не unsupported.
- `get()` возвращает absence, `require()` бросает structured error.
- Extension-defined error проходит worker/process round-trip без зависимости от
  extension-specific `instanceof`.
- Unknown namespaced error definition отображается generic host.
- Error redaction исключает credentials и secret-marked context.
- Descriptor не принимает function/DOM/worker/file handle.
- Dispose idempotent.
- Cancellation не публикует stale result.
- Contract/package/provider/runtime-variant identities не смешиваются.
- Schema documentation/formatting change не меняет semantic fingerprint.
- ABI-relevant field/type change меняет fingerprint и compatibility result.
- Subject identity сохраняется при подтверждённом rename и меняет revision при edit.

## 3. Provider resolver tests

### Selection

- один compatible provider;
- несколько providers с explicit deterministic rank;
- portable project provider-policy lock plus separate exact install/activation/session evidence;
- exact extension/provider/runtime-variant selector;
- target filtering по environment, OS, architecture, ABI и namespaced runtime features;
- omitted version нормализуется в `*`, а lock фиксирует exact version;
- exact, compatible, bounded, minimum и maximum version ranges;
- explicit user override;
- incompatible version;
- missing required output trait;
- environment/OS/architecture filtering;
- missing permissions/external tool;
- deterministic tie handling.
- opener, preview и exporter одного asset разрешаются независимо.
- Linux native replacement provider выбирается без изменения consumer/base extension.
- interactive small workload и batch workload могут выбрать разные providers.
- native hint не обходит required outputs, trust, permissions, conformance или lock.
- одинаковый rank разрешается canonical UTF-8/ASCII tie-break, а не locale/discovery order.

### Optionality

- missing optional provider не ломает parent;
- missing hard provider блокирует только dependent feature;
- `integrates` не создаёт install dependency;
- provider появляется после activation refresh;
- provider removal переводит feature в degraded state.
- alternate VFS/source provider выбирается deterministically и фиксируется lock.
- locked revision не обновляется silently из remote source.
- discovery order не меняет project lock bytes/semantic content.
- разные contract majors не смешиваются без explicit bridge.
- resolver explanation trace показывает отклонённые target/schema/permission constraints.

## 4. Provider conformance suite

Каждый virtual contract имеет fixtures и assertions.

Пример provisional `org.modkitx.contracts/m3-open` с отдельно заданным contract version/range:

- bounded detection;
- valid minimal model;
- geometry counts;
- materials/texture relations;
- skeleton/animation semantics;
- unknown chunks preserved or reported;
- corrupt offsets produce error, not empty model;
- cancellation and cleanup;
- output trait claims match runtime descriptor/evidence;
- browser/native variant behavior;
- no undeclared permissions.

Provider не считается совместимым только потому, что объявил `provides`.

### Extension-manifest v2 discovery

- shallow `*` manifest globs expand in canonical UTF-8 order;
- recursive `**`, absolute paths, `..` and symlink escape fail validation;
- zero-match non-optional group, orphan manifest, duplicate match and contract mismatch fail;
- custom namespaced contribution contract is validated in a definition-first second pass;
- codec/game/source/subject/language/service/operation/runtime provider, projection, preset, bridge,
  subject-viewer/editor, World and game-UI examples share one contribution envelope;
- runtime variants, permissions, dependencies and limitations have one schema owner;
- authored root security review table exactly equals normalized **per contribution/runtime-variant/
  target rows**; missing, phantom or widened rows block packaging;
- a flat total permission union, when shown by catalog/UI, is generated convenience metadata only and
  is never the authored authority or the target-scoped approval request;
- generated security catalog projection preserves provenance but cannot grant a permission absent
  from the selected runtime variant;
- generated expanded catalog contains explicit paths and no runtime glob evaluation;
- adding a contribution directory does not edit an authored central registry/barrel;
- extension license is copied into provenance and incompatible static-link composition is rejected.
- root configuration resolves schemas from existing `schema/`; migration does not rename that
  directory or rewrite every v1 `$schema` reference.
- contract-owner conformance fixtures have stable IDs/hashes and are addressable by foreign
  implementation evidence.
- data-only preset activates no code; before bridge proof its manifest produces unsupported-kind,
  and after that kind is enabled an explicit major-version bridge is recorded in the provider lock
  while an unrequested bridge is never inserted automatically.
- every public contribution directory in document 27 is covered by exactly one glob, including
  service providers and subject editors;
- manifest contract ID and major are separate fields; display literals with `@1` fail schema;
- v1 adapter preserves current contribution coordinates and coordinate-based matching order.
- game `EngineReference`, engine release constraint, Modkit integration-contract range and
  `testedGames` evidence remain separate axes and round-trip independently.
- validator emits a self-contained publication fragment from an independent extension repository;
  no main-repository path or workspace package name enters extension identity.

JSON Schema acceptance proves transport shape, required fields and local constraints. It does not
prove provider selection, optional degradation, resource use or transaction behaviour; those require
resolver/integration/performance tests below.

## 5. Empty host scenario

```text
Given: no format/game extensions installed
When: Modkit CLI/workbench starts
Then:
  bootstrap host works
  catalog can be empty
  text/hex/diagnostic fallbacks remain available
  no game package is imported
```

## 6. ZIP vertical scenario

```text
Given: common archives extension installed
When: ZIP source opens
Then:
  provider detected lazily
  ContainerEntries available
  child source opens through generic host
  removing extension does not stop host startup
```

## 7. SC2 Unit scenario

### Base

Installed: SC2 Data only.

Expected:

- subject identity/properties/provenance;
- relations listed unresolved;
- raw IDs visible;
- optional preview diagnostics;
- editing only where source writable.

### Add DDS

- icon relation resolves;
- image viewer appears through global contribution catalog;
- SC2 subject code does not change/import DDS.

### Add M3 provider A

- model relation resolves;
- `model.geometry` stage appears;
- partial effects are reported.

### Switch to provider B

- explicit provider selection updates lock;
- subject address unchanged;
- provider-specific runtime resources disposed;
- result reproducible after restart.

### Remove optional providers

- Unit remains open;
- contributions disappear/degrade predictably;
- no unhandled module-not-found error.

## 8. Embedded Galaxy scenario

```text
Given: SC2 Trigger with ScriptCode block
When: Trigger opens without Galaxy provider
Then: raw embedded document is accessible

When: Galaxy provider is installed
Then:
  diagnostics/completion/hover work
  ranges map to parent XML
  rename returns parent source edits
  provider removal restores raw-only mode
```

## 9. Localization scenario

- enUS/ruRU/deDE catalogs form workspace matrix.
- Missing and placeholder mismatch diagnostics are cross-file.
- Text, table and tree map to same SemanticLocation.
- Completion/hover results match across surfaces.
- Cell edit changes one source file with expected revision.
- Raw formatting/encoding/order preservation follows codec contract.
- Concurrent stale edit is rejected.

## 10. Composite format scenarios

### MP4

- container lists tracks;
- audio track opens through audio provider;
- video track opens through video provider;
- missing audio provider does not remove video metadata.

### 7z/LZMA

- 7z method ID maps to `common.compression/lzma-decode`;
- 7z и LZMA fixture providers находятся в разных extensions;
- alternate conforming LZMA provider работает без изменения 7z codec;
- standalone `.lzma` и 7z reuse один service contract;
- output budget останавливает decompression bomb;
- missing LZMA provider блокирует affected entries, но не archive index.
- два LZMA providers выбираются одинаково при пяти shuffled discovery orders и фиксируются lock;
- missing provider и corrupt stream возвращают разные stable errors.

### KTX2/OpenIntent

- `metadata` не активирует transcoder;
- `preview` и `full` записывают фактически прочитанные bytes, activated modules, peak memory и time;
- до реализации committed fixture фиксирует числовой gate; целевой proof требует не менее чем 10x
  меньшего чтения bytes для `preview` относительно `full` и меньшего числа activated modules, а не
  только отсутствия падения;
- budget exhaustion отличается от unsupported format и corrupt payload;
- CPU decode и native GPU compressed representation разрешаются как разные output requests.

### XLSX

- workbook/sheets/tables/formulas advertised separately;
- embedded image opens through image provider;
- current UI sheet not persisted accidentally;
- edit/save capabilities tested independently.

### BLEND

- multiple objects/models exposed;
- embedded/external textures are relations;
- missing external companion diagnostic;
- inspect-only provider does not claim full scene.

### CUE/BIN required bundle

- все required bindings входят в один bundle origin;
- порядок обнаружения candidate files не меняет asset identity;
- missing required binding диагностируется до codec `open()`;
- edit plan перечисляет каждый изменяемый source;
- shared external resources остаются relations, а не копируются в bundle.

### SHP/TMP + PAL optional cross-codec companion

- PAL является отдельным codec contribution;
- найденный/выбранный PAL даёт true-color output;
- отсутствие optional PAL оставляет preview доступным, но descriptor/diagnostic сообщает degraded
  grayscale fidelity;
- смена выбранной palette меняет revision/cache key результата, но не identity SHP/TMP subject;
- M3/M3A и ALO/ALA отдельно тестируют same-codec semantic sidecars, а Unity
  assets/ress/UnityFS — namespace graph и cycle protection.

### CASC/content store

- namespace открывается без главного файла;
- paging/list/range access не требует materialize всех entries;
- content-store revision участвует в asset/workspace cache key;
- read-only provider не рекламирует write operation;
- entry открывается как child source через generic asset host.

### SC2Map

- directory and MPQ inputs expose equivalent virtual paths;
- map provider does not import MPQ implementation;
- dependency chain provenance visible;
- 2D preview survives missing 3D model provider.

### Transactional editing

- nested subject edit пишет owner asset, не fake child file;
- stale revision vector отклоняется до first write;
- filesystem adapter возвращает atomic/recoverable receipt;
- multi-binding partial failure rollback/recovery видим в receipt;
- inverse/snapshot/replay/none undo guarantee объявлена до confirmation;
- relation/cache invalidation следует declared dependency revisions.

## 11. Viewer tests

- Contribution selected by trait/operation query, not format switch.
- Independent extension can add viewer.
- Removed viewer leaves fallback.
- Install/remove, facility, policy, grant and provider-pin revisions invalidate only the affected
  bounded resolution stage; serializable SubjectDescriptor stays byte-equivalent.
- Subject-fact resolver, provider/security resolver and presentation planner are independently
  testable and no resolver receives all VFS/catalog/security/UI implementation objects.
- Singleton stage deterministic, alternatives preserved.
- Nested viewer disposal closes child handles.
- Thumbnail mode respects smaller budget.
- Editor requires explicit writable operations.

## 12. Language/LSP tests

- Neutral language provider works in CLI without LSP.
- `language-host` starts with empty provider catalog without loading LSP transport.
- `@modkitx/lsp` contains protocol adapters and does not own a second workspace/session model.
- Language extension проходит conformance через minimal host без LSP transport.
- Несколько language extensions композируются; discovery order не выбирает winner.
- LSP conversions preserve ranges/diagnostics/edits.
- Incremental document revisions cancel stale requests.
- Embedded document source maps are bidirectional.
- Workspace references/rename span virtual/archive sources.
- Table ValueAssistance parity with text LSP.
- Missing optional asset preview never fails completion list.

## 13. Runtime, launch и automation tests

- Runtime session принимает workspace snapshot, а не требует один source file.
- Runtime clock/events/snapshot/restore/cancel/dispose проходят contract tests.
- Replay parsing/playback работает без simulation runtime.
- Optional runtime assistance добавляется и удаляется без смены replay identity.
- External launch требует `process.launch`/`external-tool`, но runtime simulation — нет.
- Launch denial не ломает map inspection, validation или packaging.
- Read-only automation tools используют public subject/index/relation APIs.
- Mutating и launch tools требуют declared effects, permissions и confirmation policy.
- Tool cancellation, budgets, redaction и provenance сохраняются через MCP/RPC boundary.
- AI/MCP adapter физически отсутствует в empty-host scenario.

### Extensible World API/ABI

- Текущие 12 `SimEngine` systems получают declarations без изменения observable behavior.
- Compiled schedule равен current literal order на golden fixture.
- Shuffled registration order не меняет schedule/composition hash.
- Cycles, missing dependencies, conflicting writes и два winners exclusive slot отклоняются до tick.
- SC2 и alternative shield systems используют один `shield-state` schema hash/storage; explicit
  exclusive slot выбирает ровно один resolution system.
- `multiverse.numeric/f64-observed` sqrt и N-tick fixtures совпадают на поддерживаемых Node и
  browser-worker targets.
- Composition/session hash включает schedule, numeric profile и заявленное queue/accumulator state.
- `Sc2RuntimeSession.restore` восстанавливает всё state, заявленное snapshot contract.
- Tick benchmark остаётся в заранее заданном regression budget.

Standalone `@multiverse/engine`, numeric storage, IDL, TS↔WASM/native parity, Spring/SAGE shared
profiles и complete foundation проверяются только после соответствующих gates из roadmap S9.

### Game UI/layouts and bindings

- SC2Layout text/tree/property/preview работают поверх одной document revision.
- SC2Layout template/frame/style/animation доступны как nested subjects без fake files.
- Generic CodeLens разрешает `SemanticLocation -> SubjectRef` и открывает Subject Viewer.
- Native UI AST остаётся доступным без portable projection и specialized renderer.
- Custom UI node/renderer добавляется extension без common UiNode union edit.
- Layout viewer не импортирует DDS/M3/audio implementation напрямую.
- HUD читает visibility-scoped presentation view, а не mutable simulation storage.
- UI input становится local action или validated synchronized WorldCommand.
- Static inspection не исполняет Lua/Galaxy/ActionScript/UI scripts.
- Removing game UI runtime оставляет headless simulation и native document inspection.
- Replay seek обновляет world bindings без изменения authoritative simulation snapshot.
- DOM/Canvas/WebGPU/native renderers дают одинаковый semantic/accessibility result в
  пределах объявленного conformance profile.
- Preview fixture фиксирует viewport/locale/parameters/bindings/timeline и даёт воспроизводимый
  headless result.
- Editor и runtime renderer принимают один public `UiRuntimePlan` без private codec imports.

## 14. Security tests

- Invalid artifact hash/signature отклоняется, когда выбранная host policy требует verification.
- Trusted local-development mode не отменяет mandatory permission declaration.
- Remote reference does not auto-install provider.
- Missing permission блокирует operation dispatch до выдачи brokered handle/side effect через
  broker.
- Nested provider grant не шире parent operation grant.
- Native/external tool requires explicit approval.
- `trusted-in-process` явно диагностирует ambient authority и не обещает sandbox.
- Crashing restricted provider очищает leases; quarantine остаётся optional future policy.
- Worker lifecycle/crash/cancellation budget проверяется; worker не объявляется security sandbox
  при наличии ambient host APIs.
- Path traversal from archive/companion rejected.
- Untrusted embedded script is never executed from trait alone.
- Lockfile tampering detected.
- Credential values отсутствуют в VFS URI, lock, diagnostics и logs.
- Remote redirect/symlink не выходит за granted mount/network scope.

## 15. Host portability tests

- Portable provider даёт одинаковые domain descriptors/results в Node и browser-worker.
- Electron renderer получает native facilities только через explicit broker/preload adapter.
- VS Code host использует native editor/commands без переноса domain logic в extension entry.
- Web component открывает один subject с minimal preset без full workbench/marketplace.
- Headless service запускает parsing/index/operations без DOM/viewer imports.
- Unsupported native/process feature возвращает host-unavailable diagnostic и alternative.
- Host выбирается по facilities/target, а не app-name allowlist.
- RPC/structured-clone/transferable adapters сохраняют revisions, cancellation и diagnostics.
- Physically absent native/WASM/UI adapter не ломает shared contracts.

### Federated distribution and installed-product discovery

- Fresh generic CLI/Electron/IDE host contains platform + bundled `common`, no game/vendor code.
- One extension built from an independent repository installs from immutable local artifact without
  source checkout, workspace enrollment or authored main-repository switch.
- The `Blizzard/StarCraft2` and `WZ2100Project/Warzone2100` extraction fixtures each build against
  public Modkit contracts only, retain distinct license/provenance metadata and contain every
  game-specific discovery, codec, map/model transform, script and runtime adapter for that game.
- The generic host and bundled `common` dependency graph reaches neither extracted extension, and
  neither extracted extension imports the other's implementation.
- Catalog query, release inspection, declarative product matching and dry-run plan activate no
  extension code.
- Official, community, private and direct/local artifacts preserve the same extension/contribution
  identities.
- Install lock records exact artifact digest/dependencies/provenance and remains separate from
  project provider/World locks.
- Catalog outage/new release does not alter an installed project selection.
- Specialized app/web component embeds a pinned external browser-safe extension with generated lazy
  loader, SBOM/licenses and no general installer.
- Generic collector plus declarative rules recommends extensions for two unrelated installed
  products without product-specific core paths/code.
- Denied inventory permission leaves manual search/install available; browser reports inventory
  unavailable without a trusted bridge.
- Different catalogs publishing different bytes under one coordinate/version produce integrity
  conflict.
- Root Modkit `generated/` does not contain marketplace universe, user installed state or project
  locks.

## 16. Package boundary tests

- target `@modkitx/assets/traits` browser-safe и не загружает codec implementations через root;
  migration from current `capabilities` subpath has compile-time coverage.
- `language-contracts` не зависит от `@modkitx/lsp`, VS Code, LSP transport или `node:*`.
- `viewer-shell` запускается в standalone harness без workbench.
- Workbench зависит от viewer/language hosts только в разрешённом направлении.
- Processing packages не импортируют concrete extension provider catalog.
- Manifest validator одинаково поддерживает compact extension и multi-provider `src`
  layout.
- Runtime contracts не импортируют game launch implementation.
- MCP/automation adapter не является dependency core, codecs или runtime providers.
- Extension augmentation компилируется только против public contract/SDK, не private base
  implementation.
- Node/headless import не достигает React/workbench/viewer runtimes.
- Browser provider graph не достигает Node/native/external-tool entrypoint.
- Every executable public contribution exposes a direct library/provider test and a minimal-host
  conformance test without workbench; LSP is absent unless it is the contribution under test.
- Isolated extension build resolves no private main-monorepo paths/workspace aliases and its Modkit
  adapter imports only public contracts/SDK.
- Audio-only, headless-converter and minimal-web-component profiles physically omit unrelated table,
  3D, language, LSP and automation implementations while shared contracts still load.
- New bundled/linked/installed extension manifest обнаруживается scope-local generated catalog без
  authored main-repository switch.
- `@modkitx/runtime` не импортирует Multiverse World/UI contracts.
- До открытия gate не создаются пустые `@multiverse/engine`/UI contract packages только ради
  target tree.

## 17. Performance gates

Exact budgets устанавливаются после baseline, но обязательны измерения:

- cold/warm catalog load;
- first subject open;
- first thumbnail;
- bytes read, modules activated и peak memory по `metadata`/`preview`/`full` intent;
- provider activation;
- provider plan compilation;
- relation query with limits;
- completion query over large asset index;
- large archive paging;
- namespace listing и composite-input assembly;
- runtime tick/snapshot и replay seek;
- World v0 declaration compilation/session hash overhead;
- batch HUD/UI binding update без per-widget provider/RPC lookup;
- memory after close/dispose;
- cancellation latency;
- generated catalog/check duration.
- catalog search/install-plan and installed-catalog regeneration duration;
- installed-product inventory latency/scope and zero code activation during matching;
- batch transport overhead и отсутствие per-element RPC/capability lookup.

Gate должен ограничивать regression relative to committed baseline, а не использовать
необоснованные абсолютные числа.

## 18. Repository gates

Перед завершением milestone:

```text
manifest/schema validation
generated catalogs --check
trait/operation/provider conformance
dependency boundaries --converged
narrow package tests/typecheck
browser import boundary
formatting/lint
strict implementation verifier where applicable
```

No Proposal contract is called a stable public API merely because its Markdown block is consistent.
Before stable promotion, every serializable public contract in the promoted slice must have:

- a machine-readable schema (JSON Schema or an explicitly justified equivalent);
- canonical serialization and compatibility/version vectors;
- positive, negative and unknown-field conformance fixtures;
- at least one production consumer/provider proof;
- generated TypeScript/schema drift checks in CI.

At the current audit snapshot these artifacts do not yet exist for the new Proposal contracts, so
proof-slice readiness and stable-API readiness are deliberately reported separately.

## 19. Definition of Done для одного codec/provider

Provider готов, если:

1. manifest и offer валидны;
2. bounded detection существует;
3. runtime claims подтверждены conformance;
4. diagnostics structured;
5. cleanup/cancellation протестированы;
6. optional dependencies действительно могут отсутствовать;
7. declared traits совпадают с runtime output;
8. security/environment requirements полны;
9. preview/edit consumers не импортируют implementation;
10. parity с legacy behavior подтверждена или различие документировано.
11. required bindings, namespace needs и write transaction guarantees объявлены;
12. conversion provider сообщает preserved/approximated/omitted features;
13. implementation, contract и runtime variant versions не смешаны.
14. runtime target содержит применимые OS/architecture/ABI/features constraints;
15. augmentation использует public versioned transport contract;
16. preference claims имеют evidence и operation/workload scope;
17. provider plan разрешается до benchmarked hot path;
18. extension проходит applicable Node/browser/native host conformance matrix.

## 20. Format-knowledge and stress-profile gates (candidate, BRIEF-5)

- `FormatDefinition`/augmentation fixtures: положительная, коллизионная (два owner без
  `augments`), и merged-view с конкурирующими claims + provenance
  ([30 §2](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)).
- Unknown-root lifecycle: PR-16 — source без codec получает стабильный root `SubjectRef`,
  переживает install/remove codec без смены identity ([25 §20](25-subject-identity-editing-transactions-and-cache.md)).
- Locator matrix: PR-20 — фикстуры CASC/Unity/Unreal/Wwise/CUE со стабильным round-trip
  ([16 §15](16-composite-assets-and-origins.md)).
- Key material: PR-18 — encrypted container + opaque key broker + rotation; секрет не появляется
  ни в одном serializable артефакте ([24 §12.1](24-extension-security-execution-and-lifecycle.md)).
- Corpus evidence: PR-19 — изменение любой из шести осей инвалидации ломает соответствие
  evidence ↔ offer ([30 §6](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)).
- Encyclopedia stress: PR-22 — `FormatStressProfile` по минимум 12 различающимся записям даёт
  expressibility-результат без core PR; целевая команда `pnpm formats:stress --check`
  (не существует; фиксируется как implementation task, не как выполненный gate).

## 21. Conformance badges (уточнение 2026-08-12)

Поддержка формата доказывается fixtures и отчётами, а не прозой. Badge — **generated** проекция
из testkit-прогонов и evidence (30 §6), никогда не self-declared поле манифеста:

| Badge        | Что доказывает                                                 | Источник                    |
| ------------ | -------------------------------------------------------------- | --------------------------- |
| `Detect`     | positive+negative structural detection на corpus               | detection fixtures          |
| `Read`       | parse representative+edge corpus без крэшей; бюджеты соблюдены | golden fixtures             |
| `Preview`    | render/extraction в hosted профиле                             | preview harness             |
| `Edit`       | typed patch + dry-run + commit receipt                         | transaction fixtures        |
| `Round-trip` | byte- или semantics-preserving re-emit c loss report           | round-trip suite            |
| `Browser`    | worker-профиль собирается и проходит suite                     | bundle+run в browser-worker |
| `Headless`   | Node/CLI профиль без UI                                        | headless suite              |
| `Fuzzed`     | property/fuzz прогон N итераций без violations                 | fuzz report                 |

Правила: badge привязан к `(contribution, operation/target, corpus digest, testkit version)` и
инвалидируется по тем же шести осям, что evidence; каталог показывает badges из verified
release-отчёта; отсутствие badge = «не доказано», не «не работает». Whole-unit `status` этим
окончательно замещён (27 §0.5.2).

## 22. Execution boundary conformance — Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable)

- **Транспорт** обязан пройти `runFramePortConformance` (25 кейсов round‑trip/lifecycle/hostile над
  любой парой `FramePort`; host‑only режим для удалённой стороны) до подключения к приложению;
  негативные транспорты (дубликаты, потери, синхронная доставка, отказ от raw) — ловятся kit'ом.
- **Backend** обязан воспроизвести реакции reference supervisor'а над hostile‑worker fixtures
  (HW‑01…14; acc‑1…acc‑12 в THREAT_MODEL_WORKER_BOUNDARY §4/§5.1) и пройти тесты
  `node-worker-backend.test.ts`: activation через SPI, verify‑at‑evaluation, containment, policy
  ceilings, идемпотентный release, реальное расширение (`text-json` probe/open в worker'е).
- **Definitions** с `surface` валидируются production‑registry (`check:extensions`), стандартная
  таблица — schema + типовыми pin'ами (`data-source-surfaces*.test.ts`).
  Подробности — документ [32](32-execution-boundary-and-method-surfaces.md) §7.
