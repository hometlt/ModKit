# 19. Host Portability, Performance, and Extension DX

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Решение

Modkit должен быть одинаково пригоден как library, service и application platform. Это не
означает одинаковый физический набор функций во всех hosts. Одинаковыми являются portable
contracts, lifecycle, diagnostics и provider-resolution semantics; конкретные capabilities
зависят от `RuntimeTarget` и host grants.

Core остаётся маленьким за счёт разделения:

```text
portable control plane
  subjects, origins, capability queries, offers, resolution, operations, diagnostics

optional data plane
  parsers, decoders, renderers, language indexes, workers, WASM, native services
```

## 2. Универсальны protocols, не giant DTOs

Не создаются:

```text
UniversalAsset со всеми image/audio/model/document/game полями
UniversalGameEntity со всеми mechanics всех игр
UniversalScriptAst, объединяющий синтаксис всех языков
```

Вместо этого универсальны:

- `SubjectHandle`, `AssetOrigin`, relations и revisions;
- capability/provider/operation contracts;
- versioned standard profiles для доказанно общей семантики;
- projection/conversion и explicit loss reports;
- extension namespaces для vendor/game/format-specific данных;
- native representations для round-trip и неподдержанной семантики.

Standard profile остаётся маленьким и не поглощает специфичное поле только потому, что оно
встречается в одном format. Promotion требует нескольких independent providers/consumers и
conformance evidence.

## 3. Host matrix

| Host                | Runtime options                                    | Extension acquisition                                                                        | UI/persistence особенности                                |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Node library        | In-process TS, worker, WASM, native addon/process  | Caller-supplied catalogs/providers; no installer required                                    | Consumer сам создаёт registry/workspace                   |
| Headless service    | Node workers, WASM, native services                | Immutable deployment profile/app bundle                                                      | Streaming/RPC, no viewer/workbench requirement            |
| Electron            | Browser renderer + main-process Node/native broker | Bundled common + user-approved local/catalog install                                         | Native dialogs/files/process behind preload boundary      |
| Browser/PWA         | Browser worker, WASM, WebGPU/WebGL                 | Curated embedded/signed browser artifacts                                                    | File handles/OPFS/range sources, no ambient native access |
| Web component/embed | Small selected provider set, lazy browser/WASM     | One build-time embedded preset                                                               | One subject/view session, no full workbench               |
| VS Code desktop     | Node extension host + browser webviews             | Bundled common + generic runtime contributions; VSIX rebuild for new static contribution IDs | Native text editors/commands and explicit webview bridge  |
| VS Code web         | Browser/WASM subset                                | Embedded browser-safe set                                                                    | No local process/native addon assumptions                 |
| Other IDE/plugin    | In-process SDK or RPC sidecar                      | Embedding host managed or catalog-backed sidecar                                             | Host adapter maps commands/editors/storage                |

Cross-host parity означает одинаковый результат там, где required facilities существуют.
Browser не притворяется способным запускать native game/tool. Вместо этого resolution
возвращает `host-unavailable`/`permission-required` с альтернативой.

## 4. Host facilities contract

Host публикует только явно доступные facilities:

```ts
interface HostProfile {
  readonly target: RuntimeTarget
  readonly facilities: readonly string[]
  readonly transports: readonly TransportProfile[]
  readonly budgets: HostBudgets
  readonly policy: HostPolicyRef
}
```

Примеры:

```text
filesystem.read-random
filesystem.atomic-replace
directory.watch
storage.durable-handles
worker.module
wasm.simd
gpu.webgpu
process.launch
native.load
credential.broker
network.range-fetch
```

Provider не определяет host по app name (`vscode`, `electron`). Он запрашивает facilities и
target constraints. Это позволяет новому IDE/service использовать существующий provider без
добавления его имени в manifest.

## 5. Composition roots

Каждый application host имеет небольшой composition root:

```text
host profile
  + bundled/installed/embedded extension catalog
  + optional catalog client or externally managed acquisition API
  + trust/permission policy
  + VFS/source mounts
  + optional viewer/language/workbench adapters
  -> Workspace
```

Node library consumer может передать providers вручную без marketplace. Generic Electron/CLI/IDE
installation содержит только bundled `common`; game/vendor extensions устанавливаются explicit
artifact/catalog flow. PWA активирует только browser-safe artifacts, доступные его bundle/policy.
Web component может импортировать один viewer preset. Full workbench добавляет settings, tabs,
catalog/install UI и provider-lock review, но не меняет domain contracts. Полная distribution model
определена в
[28-extension-distribution-catalog-installation-and-product-discovery.md](28-extension-distribution-catalog-installation-and-product-discovery.md).

VS Code имеет отдельное build-time ограничение: `contributes.customEditors`, views, commands и
некоторые activation declarations нельзя произвольно добавить после установки уже собранного host
extension. Поэтому unknown codecs/providers могут обнаруживаться и активироваться runtime через
заранее объявленные generic contribution points, но новый native VS Code custom-editor ID требует
генерации/сборки manifest. Proposal не обещает runtime mutation VS Code contribution schema.

Честная registration matrix:

- Node service/Electron main могут динамически `import()` установленный approved package;
- browser/PWA активируют только modules уже в bundle либо разрешённые policy CDN modules;
- VS Code динамически выбирает реализации за заранее собранными contribution points, но новый
  language/grammar/custom editor/view требует пересборки VSIX;
- генерируемые `contributes.languages`, `contributes.grammars` и model-viewer selector сортируются
  canonical UTF-8/ASCII order, а не host locale.

### Extension acquisition и product inventory facilities

Host может отдельно публиковать:

```text
extension.catalog.read
extension.install.plan
extension.install.mutate
product.inventory.read
product.inventory.native-bridge
```

Отсутствие install facility не ломает embedded providers. Native inventory требует consent и
возвращает neutral evidence; catalog-supplied declarative rules создают объяснимые extension
recommendations. Browser/PWA без trusted bridge сообщает facility unavailable и сохраняет manual
catalog search/user-selected source flow. Ни recommendation, ни inventory scan не активируют
рекомендуемое extension.

## 6. Control plane и hot data plane

Provider resolution выполняется при open/session/operation planning:

```text
catalog lookup -> filter/rank -> activate -> compile plan -> execute direct handles
```

После plan creation hot path не должен выполнять:

- catalog scan;
- capability string matching;
- provider graph search;
- manifest parsing;
- dynamic imports;
- fine-grained cross-worker RPC на каждый pixel/vertex/entity/row.

Runtime/session хранит прямые typed handles/function tables и заранее разрешённые operations.

## 7. Performance rules

1. Generated indexes по contract, source kind и capability заменяют full catalog scans.
2. Detection читает bounded headers/ranges и активирует runtime только после shortlist.
3. Collections используют paging/streaming, а не eager arrays.
4. Workers получают batch requests.
5. Large binary/model/map data передаются transferable buffers, shared memory views или
   range sources, а не JSON copies.
6. WASM boundary проектируется coarse-grained; memory view обновляется после growth.
7. Cache key включает asset revision vector, provider/variant versions, options и workspace
   state.
8. Interactive tasks имеют priority выше indexing/conversion background work.
9. Expensive provider startup amortized session reuse; idle resources имеют lifecycle policy.
10. Headless path не импортирует viewer/UI frameworks.
11. Viewer/embed path не импортирует все codecs через root barrel.
12. Performance claims подтверждаются repeatable target/workload benchmarks.
13. World session компилирует profile/component/operation IDs и system order до первого
    tick; provider resolver отсутствует в simulation hot loop.
14. HUD/UI bindings выполняются batch presentation query plan, а не отдельным RPC/provider
    lookup для каждого widget и frame.

Architecture overhead должен находиться в open/activation, а не масштабироваться с числом
decoded elements или simulation ticks.

## 8. Transport profiles

Public capability/provider definition объявляет допустимый transport:

```text
in-process
structured-clone
rpc-handle
stream
transferable-buffer
shared-memory-view
native-process-rpc
```

Это особенно важно для augmentation: другой extension не может рассчитывать на in-process
class, если base provider работает в WASM worker или native process. Host выбирает только
composition с совместимыми transports либо включает explicit adapter provider.

## 9. Extension authoring SDK

SDK должен включать:

- typed manifest builders;
- capability/provider/operation definitions;
- runtime-target helpers;
- source/input fixtures;
- fake/minimal hosts для Node и browser-worker;
- conformance runner;
- structured diagnostic/error helpers;
- worker/RPC adapters;
- generated schema types;
- lifecycle/leak/cancellation assertions;
- catalog preview и resolution explanation tools.

Рекомендуемый scaffolder:

```text
pnpm create modkitx-extension
modkit create codec
modkit create augmenter
modkit create viewer
modkit create language-provider
modkit create runtime-provider
modkit extension validate
modkit extension pack
modkit catalog-fragment emit
```

Он создаёт manifest, public entrypoints, fixtures, narrow tests, browser-boundary test и README без
изменения authored central registry. Pack создаёт immutable artifact/SBOM/license set во внешнем
staging; fragment содержит release metadata для catalog publication и не включает implementation
source автоматически.

### 9.1 Проверяемые authoring profiles

Authoring profile — SDK/scaffolder preset, а не runtime `ExecutionProfile` и не новый wire
authority. Он сокращает boilerplate только там, где default можно доказать:

| Profile          | Permission rule                                                                 | Target rule и gate                                                           |
| ---------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pure-transform` | `permissions: []`; implementation самостоятельно не читает source               | targets объявляются явно; static import/bundle scan + smoke на каждом target |
| `source-reader`  | `permissions: ['read-source']`; чтение только через переданный `AssetSourceRef` | targets объявляются явно; тот же scan + source-path proof + per-target smoke |
| `node-only`      | permissions объявляются явно                                                    | только `node`/`node-worker`; smoke на каждом заявленном target               |
| `explicit`       | targets и permissions полностью явные                                           | policy/conformance для network, native и credential cases + per-target smoke |

Profile задаёт permission default, но никогда не угадывает targets. Заявлены четыре окружения —
обязательны четыре smoke tests; непроверенный profile не даёт defaults и валит pack/conformance.

## 10. Independent extension repository ownership

Каждая independently releasable unit владеет своими файлами:

```text
modkit-extension-<id>/
├── package.json            # + блок "modkit" (authored ExtensionManifest; non-npm → modkit.extension.json)
├── package.json
├── README.md
├── LICENSE
├── definitions/
│   ├── contracts/
│   ├── traits/
│   ├── subject-kinds/
│   ├── relation-kinds/
│   ├── errors/
│   └── operations/
├── <typed-contribution-directory>/
│   └── <contribution-id>/
│       ├── contribution.manifest.json
│       └── src/
├── src/shared/
├── fixtures/
└── test/
```

Simple extension может использовать compact layout. Directory names не участвуют в runtime
identity; manifest/catalog являются source of truth. Полный target tree и правила
`extension-manifest v2` определены в
[document 27](27-final-target-tree-extension-manifest-and-format-catalog.md).
Typed directories включают `codecs`, `games`, `*-providers`, `projections`, `presets`,
`contract-bridges`, `subject-viewers`, `subject-editors`, `world/*` и `game-ui/*`; generic
`providers/` не используется.

## 11. Parallel people and AI agents

Чтобы независимая работа не создавала постоянные conflicts:

1. Extensions не редактируют global handwritten switch/enum/barrel.
2. Каждый independent repository публикует validated catalog fragment и immutable artifact.
3. Aggregate marketplace, application bundle и installed catalogs создаются своими integration/CI
   или installer steps; agents не правят их вручную и не копируют в extension source.
4. Qualified namespaces предотвращают случайные ID collisions.
5. Standard-contract change идёт отдельным ADR/schema change, не смешивается с codec feature.
6. Fixtures/tests находятся рядом с owner extension.
7. Main repository workspace globs охватывают только bundled common/development fixtures; внешний
   extension подключается artifact/link profile без authored root switch.
8. Shared dependencies меняются отдельными changes, а не попутно с provider implementation.
9. Conformance tests проверяют совместимость без импорта другой implementation.
10. Generated SDK/types не редактируются вручную.
11. Extension lock/manifest diff остаётся reviewable и machine-validatable.
12. Integration tests собирают несколько independently authored extensions только после их
    individual conformance.

## 12. Contract governance

| Change                                    | Ownership                                               |
| ----------------------------------------- | ------------------------------------------------------- |
| Extension-specific capability             | Extension namespace, independent release                |
| New implementation существующего contract | Новый provider offer, без core change                   |
| New OS/ABI port                           | Runtime variant/provider offer, без consumer change     |
| Promotion в standard capability           | ADR + multiple implementations/consumers                |
| Breaking standard schema                  | New major contract version + adapter strategy           |
| New host facility                         | Namespaced capability first, standardize after adoption |

Это уменьшает shared-file contention и сохраняет маленький stable core.

## 13. Testing matrix

Extension conformance запускается минимум по применимым targets:

```text
Node in-process
Node worker
browser worker
WASM browser/Node where declared
native OS/architecture CI targets where declared
empty host without optional dependencies
physically absent integrated/augmented extension
```

Host conformance проверяет одинаковые descriptors, diagnostics, revisions и outputs для shared
features. UI pixels не обязаны совпадать между native IDE editor и web viewer, но domain result
и edits должны совпадать.

## 14. Current migration

- Existing browser-safe packages сохраняются и получают explicit target/transport metadata.
- Current generated codec catalog расширяется normalized provider offers.
- Handwritten app registries мигрируют на injected composition roots.
- Current VS Code viewers становятся host adapters/contributions, а не source of domain logic.
- Processing packages остаются optional dependencies и не входят в bootstrap closure.
- Extension templates вводятся после стабилизации первых contracts, чтобы scaffolder не
  размножал временный API.

## 15. Acceptance criteria

- Empty Node/browser host запускается без concrete format/game extensions.
- Один portable codec проходит Node и browser-worker conformance.
- Native-only provider корректно unavailable в browser без bootstrap failure.
- Electron/VS Code/web component используют один subject/operation contract через разные host
  adapters.
- Provider resolution завершается до hot-loop benchmark region.
- Batch API не выполняет per-element RPC/capability lookup.
- New extension создаётся scaffolder и проходит tests без правки authored central registry.
- Два parallel test extensions объединяются без merge conflict в registry/barrel.
- Removing one optional extension не ломает compilation/bootstrap остальных.
- Extension-specific data остаются namespaced/native и не раздувают standard DTO.

## 16. Golden path автора extension (уточнение 2026-08-12)

Целевой happy path — от нуля до работающего standalone codec, ориентир **10–20 минут**
(hypothesis до usability-теста с внешним автором/AI-агентом; score ceiling DX держится этим
proof-ом):

```text
pnpm create modkitx-extension   → package.json#modkit + 1 contribution + src/index.ts + test + CI
edit defineCodec(...)           → typed builder над одним envelope (27 §0.3: authored-TS,
                                  published-JSON)
modkit test                     → direct-library suite + testkit minimal-host conformance
modkit explain <fixture>        → detection/resolution trace: offers, rejected causes, selection
modkit pack                     → канонический JSON + generated security projection + badges
publish                         → npm (как обычная библиотека) и/или static catalog entry (28 §16)
```

Правила:

1. Scaffold не создаёт optional category-папок; 4 понятия — ментальная модель, но **первый API
   ещё меньше**: `defineCodec({ id, detect, read, operations })` сам строит contribution envelope
   и подключает стандартный codec contract — новичок явно не трогает `Contribution`/`Contract`,
   пока не попросит расширенный контракт.
2. `modkit explain` — обязательная часть DX: deterministic resolution объясняется, а не
   угадывается; те же traces доступны testkit-ассертами.
3. Playground = testkit minimal host + локальный viewer profile; полный workbench не требуется.
4. Dual publishing — по построению: тот же package публикуется как npm-библиотека (direct use)
   и как Modkit extension (catalog artifact); layout один.
5. CI-шаблон из scaffold гоняет conformance профили и печатает badge-набор (10 §21).
6. **Resolver ceremony платят только альтернативы** (принято 2026-08-12): кодек, являющийся
   единственной installed implementation своего contract, выбирается с **нулевой** конфигурацией
   offers/ranking/lock — дефолтный offer строится builder-ом, дефолтный ranking тривиален, lock
   пишется автоматически. Настройку ranking/pin/replacement пишет только автор alternative
   implementation. Negative fixture этого правила входит в S3 exit evidence (09 §5).
7. **`modkit doctor`** — одна диагностическая команда, печатающая все действующие locks своего
   scope (provider-policy / install / activation snapshot / session composition / World
   composition) и отвечающая на типовые вопросы «почему выбран этот provider» и «почему
   недоступна операция» без чтения пяти файлов. Это операторская проекция тех же explanation
   traces, что и `modkit explain`.
8. **Scaffold умеет стартовать из `FormatDefinition`** (30 §2): data-only знание о формате —
   расширения, magic, ecosystem-ссылки, известные ограничения — переносится в скелет кодека и его
   manifest до написания кода; format-knowledge plane окупается раньше появления executable
   codec.

Измеримые метрики DX (фиксируются в testkit-отчёте): steps-to-first-green, files touched,
concepts required (цель: 4), time-to-badge. Для SC2-масштаба extension — те же метрики на
добавление одного нового codec в существующий.

Golden path закрепляется **executable testkit fixture** (входит в MK-S4): CI сам прогоняет
scaffold → test → explain → pack на шаблонном кодеке и записывает метрики выше как
machine-readable отчёт. Регрессия DX (лишний шаг, лишний обязательный концепт, рост
time-to-badge сверх бюджета) ломает сборку; «10–20 минут» перестаёт быть гипотезой и становится
контролируемым бюджетом.
