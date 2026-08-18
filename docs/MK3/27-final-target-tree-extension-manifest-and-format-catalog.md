# 27. Final Target Tree, Extension Manifest, and Format Catalog

Status: **adopted boundary + detailed owner**: the 7+2 package set, minimal extension tree and
single `contributionManifests` discovery pattern (§0) are **promoted to canonical**
[MODKIT_ARCHITECTURE §6.1](../architecture/MODKIT_ARCHITECTURE.md) on 2026-08-12; this document
remains the detailed Proposal owner for envelope/spec shapes and the extension layout, and its
§§2–5 expansion material is a non-normative appendix.  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Updated: **2026-08-12**

Этот документ показывает только идеальную конечную структуру. Он не утверждает, что все packages,
applications, contracts или providers уже реализованы. Текущий ownership сохраняется до отдельного
proof/migration decision по canonical-wins rule.

Физические tree examples в документе 15 являются объяснением package boundaries. При расхождении
целевого дерева или extension layout внутри Proposal этот документ имеет приоритет.

## 0. Сжатая целевая топология (BRIEF-6; при конфликте выигрывает этот раздел)

Owner decision 2026-08-12 (target-first, без переходных публичных слоёв) сжимает физическую
модель ниже. Детальные деревья §§2–4 и большой пример §5 остаются как развёрнутый материал и
candidate-инвентарь, но нормативная целевая топология — эта:

### 0.1 Platform packages: семь + два обоснованных

```text
packages/
├── core/      IDs, errors, diagnostics, ordering, cancellation, lifecycle, serialization basics
├── sdk/       extension/contribution/subject/format/trait/contract/operation/representation APIs
│              (subpaths: /subjects /formats /language /ui-contracts /model-contracts …)
├── vfs/       sources, locators, mounts, streams, random access, source transactions
├── host/      inventory, resolver, activation, security broker, workspace, catalog/install/profile
│              (subpaths: /resolution /language /inventory /install …)
├── ui/        optional viewer/editor/workbench/embed contracts + implementations
│              (subpaths: /viewer /workbench /embed /code /hex; physical exclusion — bundle tests)
├── runtime/   neutral launch/session/simulation bridge contracts (не Multiverse implementation)
└── testkit/   minimal host, conformance suites, fixtures, extension harness (dev-only closure)
```

Обоснованные дополнительные publication units (правило §0.4):

- `lsp` — постоянный protocol adapter (реально иная dependency closure:
  `vscode-languageserver*`; consumer — VS Code host). Semantic owner — `sdk/language` +
  `host/language`, не LSP.
- `xml` — reusable format-technology library (много потребителей-кодеков), **не** обязательная
  kernel-зависимость minimal host.

Multiverse — отдельная package family/repository; в `packages/` ядра не входит. Судьба текущих
имён: `assets`→`sdk`; `games`+catalog/installer/inventory/provider-host/workspace→модули `host`;
`language-contracts`→`sdk/language`; `viewer-shell`/`entity-cards`/`workbench`/`embed`/
`code-viewer`/`hex-viewer`→subpaths `ui`; `*-processing` алгоритмы→библиотеки внутри
common/format extensions (публикуются отдельно только при реальном втором consumer);
renderer-neutral DTO (`RenderModel`, scene contracts)→`sdk`; конкретные Three/WebGL backends→
optional contributions/extensions.

### 0.2 Минимальный extension tree

```text
modkit-extension-<id>/
├── package.json            обычный npm-манифест; блок "modkit" = authored extension manifest
├── contributions/*.json    каждый — ContributionManifest со своим contract
├── src/                    внутренняя структура на усмотрение автора; index.ts — библиотечный вход
├── test/
├── fixtures/               только если нужны
├── README.md
└── LICENSE
```

**Один authored-файл вместо двух (уточнение 2026-08-12).** Authored-дом extension-манифеста —
блок `"modkit"` в `package.json` (та же schema: `publisher`, `id`, `contributionManifests`;
`version`/`license` наследуются из npm-полей). Отдельный standalone-контейнер
`modkit.extension.json` (та же schema) допустим **только** для layout-ов без `package.json` —
native-only, Rust/WASM, data-only knowledge/localization packs, дистрибуция только через
GitHub Releases; у одного artifact ровно один authored-контейнер — оба сразу дают packaging
error. Оба контейнера нормализуются в один контракт `ExtensionManifest`: физически контейнеров
два, нормативная форма одна. Это же делает каждый extension одновременно обычной npm-библиотекой
(direct-library use без Modkit) — публикация в npm и в Modkit-каталог не различаются по source
layout, различаются только release-артефактом.

`definitions/`, `codecs/`, `games/`, `viewers/`, `world/` и другие категории — optional authoring
conventions больших репозиториев, **не** protocol taxonomy: runtime identity задаётся только
manifest coordinates (§1.6). Обычная independently discoverable unit = один manifest + один
entrypoint/module; conformance ссылается на fixtures без обязательного README/schema/test
поддерева в каждом `<id>`.

**Взгляд автора: четыре понятия на golden path.** Чтобы выпустить работающий codec, автору нужны
только `Subject`, `Contribution`, `Contract`, `Operation`. Traits, format definitions, locators,
key material, corpus evidence — слои «когда понадобится», они не участвуют в первом happy path и
не требуются валидатором минимального contribution. Документация обязана держать это расслоение
(golden path — [19 §16](19-host-portability-performance-and-extension-dx.md)).

### 0.3 Один discovery pattern вместо category globs

```jsonc
// package.json (fragment)
{
  "name": "@example/modkit-homeworld",
  "version": "1.0.0",
  "license": "MIT",
  "modkit": {
    "schemaVersion": 1,
    "publisher": "org.example",
    "id": "homeworld",
    "contributionManifests": ["./contributions/*.json"],
  },
}
```

**Authoring-форма ≠ published-форма.** Contribution-манифесты могут авторски существовать как
typed TypeScript (`defineCodec(...)` и другие builders поверх одного envelope) — `modkit pack`
замораживает их в канонический JSON. **Data-only — это discovery-контур артефакта, а не весь
артефакт**: artifact, разумеется, содержит исполняемый код реализации —

```text
artifact
├── canonical contribution JSON   читается каталогом/установкой/inspection БЕЗ исполнения
└── implementation entrypoints    (JS/WASM/native) исполняются только после resolution/permissions
```

Linked-dev режим может исполнять builder в доверенном workspace разработчика; это не меняет
правило для опубликованных артефактов. Published archive-форма extension-а — [UVE](../multiverse/extension/SPEC_UVE.md) (`.uve`).

Contract identity живёт в самом contribution manifest (`contract` выбирает строгую schema для
`spec`). Root manifest не повторяет contract categories: генератор/validator получает полный
inventory чтением data-only child envelopes без исполнения кода. Большой `contributes[]` из §5
superseded как обязательная форма; он допустим лишь как generated projection для catalog/поиска.

Открытый набор contribution kinds включает (BRIEF-7) data-only `agent-skill`, `agent-eval`,
`knowledge-pack` и `localization-bundle` — spec-shapes у
[31](31-agent-tools-knowledge-and-localization.md); envelope и discovery у них те же, executable
authority они не получают.

### 0.4 Правило физического выделения package

> Отдельный package нужен только при независимом deployment/runtime target, security boundary,
> существенно иной dependency closure, независимом version/release ownership или как минимум двух
> реальных consumers. Архитектурное существительное само по себе package не создаёт.

### 0.5 Envelope: три упрощения

1. **`version` у contribution убран** как обязательное поле: release/version принадлежит
   immutable extension artifact, совместимость — versioned contract/schema. Локи ссылаются на
   `(extension coordinate, contribution id, contract major)`; отдельная версия contribution
   возвращается только при доказанном независимом lifecycle.
2. **Whole-unit `status` понижен** до optional display-подсказки: support/fidelity различаются
   per operation/output/target и выражаются записями и evidence, не одним словом. Бывшие
   `status: unsupported` manifest-only stubs в целевой модели — это data-only
   `FormatDefinition` ([30 §2](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)),
   а не «кодек без реализации».
3. **Один authored владелец security**: runtime variants + permissions авторитетны только в child
   contribution manifests; сводная review table у root/release — **generated verified projection**
   (см. [24 §3](24-extension-security-execution-and-lifecycle.md), правка BRIEF-6). Двух authored
   таблиц с exact-match валидатором больше нет — drift невозможен по построению.

### 0.6 Без корневого `generated/`

Ideal authored tree не содержит root `generated/`. Derived artifacts живут у lifecycle owners:
`dist/`/build staging (release output), bundler virtual modules (web/app static catalog),
installed artifact store, application cache, project/session records. Manifests и contribution
files — единственная authority; см. таблицу владельцев в REPORT-6 §10.

### 0.7 Bundled common family: целевая структура базовых расширений

Bundled-семья строится на фактической (`extensions/common/` сегодня: archives, audio, images,
models, vector, video; `uncommon/documents` — кандидат, не default):

| Extension                 | Содержимое                                                                                                                                                                         | В default-профиле? |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `common/archives`         | zip + universal framing/compression services (deflate, lzma-контракты)                                                                                                             | да                 |
| `common/images`           | png/jpeg/tga/dds/ktx2/…; block-decode services                                                                                                                                     | да                 |
| `common/models`           | gltf/glb/obj/stl/…; RenderModel-производящие codecs (контракты — в `sdk`)                                                                                                          | да                 |
| `common/media-foundation` | data-only framing definitions (RIFF/ISO-BMFF/EBML) + shared stream/timestamp contracts; альтернативa — библиотечный модуль SDK до второго потребителя                              | да                 |
| `common/audio`            | audio codecs/operations (свой dependency closure: аудиоплеер не тянет video stack)                                                                                                 | да                 |
| `common/video`            | video codecs/operations (декодеры/бюджеты/презентация отличаются от audio)                                                                                                         | да                 |
| `common/vector`           | UVG/SVG-профиль + обычные vector-кодеки/sanitizers                                                                                                                                 | да                 |
| `common/fonts`            | UVF/OpenType-WOFF2 профиль + обычные font-кодеки/операции                                                                                                                          | да                 |
| `common/ui-web`           | UVI HTML-interface + UVY CSS-style portable profiles, DOM/headless renderer and sanitizers; **candidates until the two-source-family gate**                                        | нет до gate        |
| `common/plain-text`       | один read-only `plain-text` codec; text/hex UI поставляет platform viewer family                                                                                                   | да                 |
| `common/text-data`        | `json`, `jsonc`, `xml`, `yaml`, `toml`, `ini`, `csv`, `tsv`: independent inspection/validation codecs and their default syntax providers; editing подключается отдельным 13D slice | да                 |
| `common/knowledge`        | curated baseline KnowledgePack: платформа, universal concepts, самые общие форматы ([31 §2.4](31-agent-tools-knowledge-and-localization.md))                                       | да                 |
| `uncommon/documents`      | office/OPC и др.                                                                                                                                                                   | **нет** (opt-in)   |

Пользователь видит **один preset `Common`**; физически это семейство независимых расширений, чтобы
специализированный продукт (аудиоплеер, model viewer) брал только нужную часть. Каждое
common-расширение использует то же минимальное дерево §0.2 (package.json#modkit +
contributions/ + src/), внутри — convention-папки по вкусу. Один contribution-файл = одна unit
(18 кодеков images = 18 маленьких JSON) — это осознанно: независимые diff/ownership/badges.
Vendor/game-расширения (blizzard/starcraft-2 и др.) — та же форма, независимые репозитории после
D1/D2.

`common/text-data` — стандартное расширение профиля, но не platform package и не часть bootstrap
closure. Его codecs и syntax providers выбираются resolver'ом по контракту и фиксируются в lock;
порядок регистрации или активации не является authority. Поэтому иной XML provider может заменить
default implementation без изменения `core`, `sdk`, `vfs` или `host`. Временная low-level
`@modkitx/xml` library допустима только как implementation detail такого provider: она не владеет
пользовательским XML codec и не является обязательной зависимостью semantic codecs.

`common/plain-text` также не является universal binary codec. Source без совместимого codec —
host-owned raw subject с `content.binary`; host публикует byte-range data source и объявляет
`view.hex` только при наличии handler. Установка `plain-text` добавляет text interpretation, но не
подменяет identity или fallback неизвестного source.

**Post-snapshot allocation, принято 2026-08-14:** новые MK3 contributions CSV/TSV получают
координаты `org.modkitx/text-csv` и `org.modkitx/text-tsv`. Текущая measured строка `csv` у
`org.modkitx.uncommon/documents` в §8 остаётся без изменений до отдельной миграции MK2; это решение
не добавляет phantom manifests в snapshot.

### 0.8 Execution boundary в целевом дереве — Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable)

- `packages/host/src/execution/` — capability‑RPC core (`protocol`, `handles`, `surface`,
  `endpoint`), `surface-adapter` (surface registry: sdk‑таблица + aux + ABI + definitions),
  `abi-surfaces` (`x3.abi/*`), `worker-policy`; публикуется как `@modkitx-x3/host/execution`;
- `packages/host/src/node/worker-backend.ts` + `worker-bootstrap.ts` (собственная entry
  `@modkitx-x3/host/node/worker-bootstrap`) — Node worker backend;
- `packages/sdk/src/asset-capabilities/data-source-surfaces.ts` — стандартные surfaces;
- `packages/testkit/src/capability-rpc/**` (conformance kit, loopback, MessagePort adapter, worker
  harness), `packages/testkit/fixtures/hostile-worker/**` — acceptance‑материал транспортов и
  backend'ов.

## 1. Инварианты целевой структуры

1. `packages/` содержит portable contracts, hosts и reusable algorithms, но не concrete installed
   game/format implementations.
2. Main repository `extensions/` содержит только bundled `common` family и development fixtures.
   Vendor/game/community extensions target independent repositories с тем же contribution layout.
3. Ideal authored tree не содержит root `generated/` (§0.6). Каждый derived artifact живёт у
   своего lifecycle owner (build staging, bundler virtual module, installed store, app cache,
   project/session records — owners из документа 28). Сегодняшний root `generated/` — migration
   state, а не цель.
4. `apps/` содержит только leaf composition roots. Переиспользуемый embed UI является package.
5. `multiverse/` не импортирует Modkit и может быть извлечён в отдельный repository без изменения
   public contracts.
6. Folder path показывает ownership/convention, но runtime identity задаётся manifest coordinates.
7. Package tree показывает package ownership и public subpaths, а не требует разложить каждый
   internal module по отдельной директории.
8. Playback реплея не зависит от simulation runtime. AI/MCP automation не имеет privileged path в
   runtime/core.
9. Fixtures принадлежат конкретному contribution/package и хранятся рядом с владельцем.
10. Один extension является одной licensing/distribution unit и может публиковаться независимо от
    Modkit repository. Git path/repository name не является runtime identity.

## 2. Appendix (non-normative): развёрнутое дерево основного repository

> **Superseded scope note (BRIEF-6).** Нормативная package-топология — §0.1 (7+2 units). Дерево
> ниже сохранено как развёрнутый ownership-инвентарь: его листья читаются как модули/subpaths
> соответствующего §0.1-package, а не как самостоятельные publication units, пока конкретный лист
> не пройдёт правило §0.4.

Leaf directories под `packages/processing/`, `packages/rendering/` и `multiverse/` являются
самостоятельно публикуемыми packages. Вложенность группирует ownership и не образует root runtime
barrel.

Это ideal end-state tree, а не команда заранее создать пустые packages. `provider-host`, standalone
Multiverse packages и другие extracted boundaries появляются только после gates из документов 09,
20 и 26; до этого их ответственность остаётся в указанном transitional owner.

```text
modkitx/
├── AGENTS.md
├── PROMPT.txt
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── modkit.extensions.json
│
├── schema/
│   ├── extensions-config.v2.schema.json
│   ├── extension-manifest.v2.schema.json
│   ├── contribution-manifest.v1.schema.json
│   ├── codec-contribution.v1.schema.json
│   ├── service-provider-contribution.v1.schema.json
│   ├── codec-manifest.v1.schema.json       compatibility during migration
│   ├── game-manifest.v1.schema.json        compatibility during migration
│   ├── contract-definition.v1.schema.json
│   ├── trait-definition.v1.schema.json
│   ├── error-definition.v1.schema.json
│   ├── subject-kind.v1.schema.json
│   ├── provider-policy-lock.v1.schema.json
│   ├── extension-release-record.v1.schema.json
│   ├── extension-install-lock.v1.schema.json
│   ├── installed-product-evidence.v1.schema.json
│   ├── extension-product-match.v1.schema.json
│   ├── runtime-snapshot.v2.schema.json
│   ├── contribution-specs/
│   └── fixtures/
│       └── contributions/
│           ├── valid/
│           └── invalid/
│
├── packages/
│   ├── core/
│   ├── tsconfig/
│   ├── xml/
│   ├── assets/
│   ├── vfs/
│   ├── workspace/
│   ├── games/
│   ├── language-contracts/
│   ├── language-host/
│   ├── lsp/
│   ├── viewer-shell/
│   ├── entity-cards/
│   ├── workbench/
│   ├── embed/
│   ├── runtime/
│   ├── provider-host/
│   ├── extension-catalog/
│   ├── extension-installer/
│   ├── product-inventory/
│   ├── replay-player/
│   ├── extension-sdk/
│   ├── extension-testkit/
│   │
│   ├── processing/
│   │   ├── compression/
│   │   ├── containers/
│   │   ├── archives/
│   │   ├── images/
│   │   ├── audio/
│   │   ├── video/
│   │   ├── media/
│   │   ├── vector/
│   │   ├── models/
│   │   ├── documents/
│   │   ├── data/
│   │   ├── scripts/
│   │   ├── layouts/
│   │   ├── localization/
│   │   ├── maps/
│   │   ├── mods/
│   │   ├── replays/
│   │   └── saves/
│   │
│   └── rendering/
│       ├── contracts/
│       ├── scene-3d/
│       ├── rendering-3d/
│       ├── terrain/
│       ├── camera/
│       ├── headless/
│       ├── webgl/
│       └── three/
│
├── multiverse/
│   ├── world-contracts/
│   ├── engine/
│   ├── ui-contracts/
│   └── foundations/
│       └── <foundation-id>/
│
├── extensions/
│   └── common/
│       └── <bundled-common-extension-id>/
│
├── apps/
│   ├── modkit-cli/
│   ├── electron/
│   ├── web/
│   ├── server/
│   ├── modkit-vscode/
│   ├── automation-host/
│   ├── model-viewer/
│   └── rts/
│       ├── client/
│       ├── server/
│       └── shared/               product-local protocol/session composition only
│
├── generated/
│   ├── bundled-common/
│   │   ├── extension-catalog/
│   │   ├── contribution-catalog/
│   │   ├── detection-catalog/
│   │   └── activation-catalog/
│   ├── development-catalog/
│   ├── schema-bindings/
│   ├── trait-index/
│   ├── contract-index/
│   └── error-index/
│
├── tooling/
│   ├── generators/
│   ├── catalog-sources/
│   │   └── format-allocation.v1.json
│   ├── validators/
│   ├── extension-scaffolder/
│   ├── extension-packer/
│   ├── catalog-fragment/
│   ├── dependency-checker/
│   ├── conformance-runner/
│   └── benchmark-runner/
│
├── docs/
├── testdata/
├── test-replays/
├── assets/
├── -references/
└── .github/
    └── workflows/
```

`apps/model-viewer` остаётся reference distribution renderer stack. `apps/rts/client` и
`apps/rts/server` являются leaf composition roots. `apps/rts/shared` допускается для product-local
client/server protocol, session wiring и DTO, которые не имеют независимого consumer; reusable
RTS/world mechanics и contracts принадлежат `multiverse/*`, foundations или обычным packages. Это
сохраняет product-local shared boundary из canonical architecture, не превращая её в второй engine.

Tree показывает available publication units, а не dependency closure каждой установки. Concrete
`rendering/headless|webgl|three`, language host/LSP, viewer/editor tools, replay player and automation
host являются optional leaves. Product/app profile перечисляет и bundle-ит только нужные units;
audio-only/headless/minimal web component не получает 3D/table/LSP transitively. Если concrete
backend получает independent release/ownership pressure, он может поставляться common/community
extension-ом поверх `rendering/contracts` без изменения consumer contract.

SC2/C&C/Spring и другие coordinates из §8 не добавляются в это repository tree. Их independent
repository, catalog, installed-store и app-bundle topologies определены в
[28-extension-distribution-catalog-installation-and-product-discovery.md](28-extension-distribution-catalog-installation-and-product-discovery.md).

## 3. Appendix (non-normative): прежний package ownership (читается как module map §0.1)

| Package               | Public responsibility                                                                                                           | Не владеет                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `core`                | errors, diagnostics, events, lifecycle, logging, portable serialization                                                         | assets, formats, UI, Node-only activation                                 |
| `xml`                 | optional generic parse/serialize, offsets, raw-preserving splice implementation                                                 | SC2/GameData/Layout semantics, format routing, default provider selection |
| `assets`              | subjects, origins, traits, relations, operations, transactions, provider resolution/portable policy lock                        | concrete codecs и workspace application state                             |
| `vfs`                 | paths, sources, mounts, overlays, streams, brokers, provider contracts                                                          | credentials UI и arbitrary remote implementations                         |
| `workspace`           | project composition, indexes, identity map, revisions, commit coordinator                                                       | format implementations                                                    |
| `games`               | generic game/profile/engine reference contracts; the old compatibility facade is historical current-code evidence, not a target | generic installed-program inventory, game-specific data/schema/runtime    |
| `language-contracts`  | transport-neutral DTOs и provider interfaces                                                                                    | sessions, caches, LSP transport                                           |
| `language-host`       | transport-neutral sessions, composition, indexes, invalidation, scheduling                                                      | LSP/VS Code protocol types                                                |
| `lsp`                 | LSP server/transport adapters over `language-host`                                                                              | language semantics                                                        |
| `viewer-shell`        | one-subject view session, stage/tree/panels/timeline/fallback composition                                                       | application workspace/tabs                                                |
| `entity-cards`        | game-neutral card projection model and relation/card graph                                                                      | SubjectRef ownership, rendering shell и concrete SC2 cards                |
| `workbench`           | application tabs/navigation/search/problems/settings/extensions/lock review                                                     | embeddable single-subject lifecycle                                       |
| `embed`               | reusable web components/adapters around viewer/language public APIs                                                             | application composition root                                              |
| `runtime`             | portable runtime provider/session/command/event/clock/snapshot/launch contracts                                                 | tracker-only replay playback и automation host                            |
| `provider-host`       | in-process/worker/process/WASM/native activation, isolation, grants, cancellation                                               | resolution policy and format contracts                                    |
| `extension-catalog`   | transport-neutral catalog query, release metadata and offline snapshots                                                         | installation side effects, provider activation                            |
| `extension-installer` | artifact planning/store, install lock, update/remove/rollback; native host implementation behind explicit boundary              | operation provider selection, catalog code execution                      |
| `product-inventory`   | neutral installed-product evidence/match/recommendation contracts; consented host collectors in explicit target subpath         | hardcoded game/tool paths, automatic installation                         |
| `processing/replays`  | replay parsing/index/timeline contracts                                                                                         | simulation runtime и UI playback state                                    |
| `replay-player`       | runtime-independent clock, seek, scene-frame/audio playback orchestration                                                       | replay parsing, codec processing and game simulation                      |
| `rendering/*`         | renderer-neutral `RenderModel`/`Scene3D` contracts and concrete headless/WebGL/Three backends                                   | native model parsing                                                      |
| `extension-sdk`       | manifest/registration builders and typed authoring helpers                                                                      | host runtime ownership                                                    |
| `extension-testkit`   | manifest/provider/host/determinism/security conformance                                                                         | production activation                                                     |

`extension-catalog`, `extension-installer` и `product-inventory` являются target ownership names, а
не командой немедленно создать packages. До gates документа 09 их contracts/implementations могут
оставаться в существующем host/tooling owner. Distribution semantics определены документом 28.

Recommended public subpaths include:

```text
@modkitx/core/errors, /diagnostics, /events, /lifecycle, /logging
@modkitx/xml/parse, /serialize, /offsets, /raw-preserving (optional low-level library; not a codec API)
@modkitx/assets/subjects, /origins, /traits, /relations, /operations,
  /transactions, /providers, /resolution
@modkitx/vfs/paths, /sources, /mounts, /overlays, /streams, /brokers
@modkitx/games, @modkitx/games/node
@modkitx/extension-catalog
@modkitx/extension-installer/node
@modkitx/product-inventory, @modkitx/product-inventory/node
@modkitx/viewer-shell/stage, /tree, /panels, /cards
@modkitx/replays-processing, @modkitx/replay-player
```

Наличие internal folder не создаёт public subpath автоматически. Public surface задаётся только
`package.json#exports` и boundary tests.

`entity-cards` определяет projection DTO/model и relation/card graph;
`@modkitx/viewer-shell/cards` отображает эту модель внутри view session. `replay-player` остаётся
корневым package, потому что он оркестрирует clock/seek/timeline/scene/audio поверх результатов
parsing и optional runtime simulation, а не является replay codec или processing layer.

## 4. Appendix (non-normative): развёрнутая структура independent extension repository

> **Superseded scope note (BRIEF-6).** Обязательный минимум — дерево §0.2; категории ниже —
> optional authoring conventions больших репозиториев, не protocol taxonomy.

Все области опциональны. Extension создаёт только те contribution units, которыми реально владеет.
Target vendor/game/community extension является корнем собственного repository, а не обязан лежать
под main-repo `extensions/<publisher>/`. `dist/`, `node_modules/` и build staging output не являются
частью authored tree.

```text
modkit-extension-<id>/
├── modkit.extension.json      # appendix: старая форма extension.json нормализуется в тот же ExtensionManifest
├── package.json
├── README.md
├── LICENSE
├── schema/              extension-owned schemas only
│
├── definitions/
│   ├── contracts/<id>/
│   │   ├── contribution.manifest.json
│   │   ├── README.md
│   │   ├── schema.json
│   │   ├── conformance/
│   │   └── src/                 optional executable helper
│   ├── traits/<id>/
│   ├── operations/<id>/
│   ├── relation-kinds/<id>/
│   ├── subject-kinds/<id>/
│   ├── errors/<id>/
│   ├── formats/<id>/            data-only FormatDefinition (owner: 30 §2); no entrypoint
│   ├── ecosystems/<id>/         optional, gated by a second augmenting publisher (30 §3)
│   └── corpora/<id>/            CorpusEvidenceManifest, hash-only inventory (30 §6.2)
│
├── codecs/<id>/
│   ├── contribution.manifest.json
│   ├── README.md
│   ├── src/
│   ├── schemas/
│   ├── fixtures/
│   └── test/
│
├── games/<id>/
│   ├── contribution.manifest.json
│   ├── README.md
│   ├── src/
│   ├── fixtures/
│   └── test/
│
├── source-providers/<id>/
├── subject-providers/<id>/
├── language-providers/<id>/
├── service-providers/<id>/
├── operation-providers/<id>/
├── runtime-providers/<id>/
│   ├── contribution.manifest.json
│   ├── src/
│   ├── fixtures/
│   └── test/
│
├── projections/<id>/
├── presets/<id>/
├── contract-bridges/<id>/
├── subject-viewers/<id>/
├── subject-editors/<id>/
│
├── world/
│   ├── profiles/<id>/
│   ├── components/<id>/
│   ├── resources/<id>/
│   ├── commands/<id>/
│   ├── events/<id>/
│   ├── systems/<id>/
│   ├── script-runtimes/<id>/
│   └── mechanics/
│
├── game-ui/
│   ├── documents/<id>/
│   ├── renderers/<id>/
│   ├── bindings/<id>/
│   ├── input-intents/<id>/
│   ├── animations/
│   └── previews/
│
├── src/
│   ├── activate.ts      optional extension-level lifecycle, never discovery
│   ├── shared/
│   └── internal/
│
├── fixtures/
├── test/
│   └── integration/
└── .github/workflows/
```

Bundled common extensions могут использовать тот же layout под main repository
`extensions/common/<id>/`. Publication pipeline создаёт immutable artifact/catalog fragment во
внешнем staging, не копирует global marketplace index в source repository.

Каждый `<id>` под `*-providers`, включая `service-providers`, `projections`, `presets`, `contract-bridges`, `subject-viewers`,
`subject-editors`, exported `world/*` и exported `game-ui/*` использует тот же layout:

```text
<id>/
├── contribution.manifest.json
├── README.md       required for public/stable contributions
├── src/            optional; pure library/provider + thin Modkit adapter for executable units
├── fixtures/       optional, owned here
├── conformance/    required before a public stable claim
└── test/           library/direct + minimal-host tests for executable public units
```

Folder/file names inside `src` are conventions rather than discovery semantics. Nevertheless, an
executable public unit must expose a library/provider surface that can be tested without workbench and
a thin adapter that registers the same implementation in Modkit. A provider may require a minimal
contract host (VFS, document session, GPU lifecycle), but not the full application. Product profiles
may omit unrelated viewer/editor/renderer/language/LSP contributions physically; no all-tools bundle
is implied by the contribution envelope.

Каждый `<id>` под `definitions/*` также является contribution: рядом с его
`contribution.manifest.json` лежат schema/transport definitions, а executable implementation
необязательна.

Для extension-owned contract suite находится в `definitions/contracts/<id>/conformance`. Для
standard contract, которым владеет package, эквивалентные fixtures находятся в public
`<package>/conformance/<contract-id>` и исполняются тем же `extension-testkit`/conformance runner.
В обоих случаях suite имеет stable ID/hash; расположение не является identity.

`definitions/traits/<id>` объявляет trait vocabulary и schema. Поле `spec.traits` в codec/provider
manifest только заявляет evidence/support уже определённых trait IDs; оно не определяет новые traits.

`projections` преобразуют одну representation/view model в другую без подмены native representation.
`presets` являются data-only user-intent selections над installed/missing contributions; discovery
ничего не устанавливает. `contract-bridges` являются явными adapters между major contract versions:
до отдельного proof resolver возвращает unsupported-kind, а после включения никогда не применяет
bridge автоматически и обязан записать выбор в lock/trace.

Root `src/activate.ts` необязателен и не участвует в catalog discovery. Он не имеет права обходить
manifest permissions или eagerly регистрировать скрытые contribution units; contribution runtime
активируется через собственный catalog entrypoint и provider-host lifecycle.

`world/mechanics` и `game-ui/animations|previews` могут быть internal implementation. Как только
unit становится independently discoverable/replaceable, он получает собственный contribution
manifest.

## 5. Appendix (non-normative): развёрнутый `extension-manifest v2` пример

> **Superseded form note (BRIEF-6).** Обязательная root-форма — один discovery pattern
> `contributionManifests` (§0.3); contract identity живёт в child envelope. Список
> contract-типизированных globs ниже — generated projection/подробный пример, не authored
> требование; authored root security-таблица заменена generated projection (§0.5.3).

Целевой extension manifest не содержит закрытый объект из заранее известных `codecs`/`games`.
Он объявляет открытый список contract-типизированных manifest globs:

Main-repository development configuration обнаруживает только bundled common packages и explicit
developer links. Installed/embedded external artifacts поступают из install/app catalog документа
28, а не добавляются authored строкой в этот файл:

```json
{
  "$schema": "./schema/extensions-config.v2.schema.json",
  "schemaVersion": 2,
  "roots": ["extensions/common/*"],
  "linked": []
}
```

Final target не содержит `legacyCodecRoots`. `modkit.extensions.json` не является marketplace или
installed-extension database и не сканирует внутренние contributions; после нахождения bundled/
linked extension эту роль полностью берёт его authored `ExtensionManifest`
(package.json#modkit либо modkit.extension.json). Installer/app builder формирует
собственный installed/embedded catalog без правки main-repository config.

```json
{
  "$schema": "https://schemas.modkitx.dev/extension-manifest.v2.json",
  "schemaVersion": 2,
  "publisher": "org.modkitx.blizzard",
  "id": "starcraft-2",
  "version": "1.0.0",
  "license": "MIT",
  "metadata": { "vendor": "Blizzard Entertainment" },
  "security": {
    "schemaVersion": 1,
    "permissionModel": "contribution-runtime-variants",
    "runtimeVariants": [
      {
        "contributionId": "org.modkitx/sc2-data",
        "variantId": "portable",
        "target": { "environment": ["browser-worker", "node-worker"] },
        "executionProfile": "trusted-in-process",
        "requestedPermissionClasses": ["read-source"]
      }
    ]
  },
  "contributes": [
    {
      "contract": { "id": "org.modkitx/contract-definition", "major": 1 },
      "manifests": "./definitions/contracts/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/trait-definition", "major": 1 },
      "manifests": "./definitions/traits/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/operation-definition", "major": 1 },
      "manifests": "./definitions/operations/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/relation-kind-definition", "major": 1 },
      "manifests": "./definitions/relation-kinds/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/subject-kind-definition", "major": 1 },
      "manifests": "./definitions/subject-kinds/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/error-definition", "major": 1 },
      "manifests": "./definitions/errors/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/format-definition", "major": 1 },
      "manifests": "./definitions/formats/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/corpus-evidence", "major": 1 },
      "manifests": "./definitions/corpora/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/codec-contribution", "major": 1 },
      "manifests": "./codecs/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/game-contribution", "major": 1 },
      "manifests": "./games/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/source-provider-contribution", "major": 1 },
      "manifests": "./source-providers/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/subject-provider-contribution", "major": 1 },
      "manifests": "./subject-providers/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/language-provider-contribution", "major": 1 },
      "manifests": "./language-providers/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/service-provider-contribution", "major": 1 },
      "manifests": "./service-providers/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/operation-provider-contribution", "major": 1 },
      "manifests": "./operation-providers/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/runtime-provider-contribution", "major": 1 },
      "manifests": "./runtime-providers/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/projection-contribution", "major": 1 },
      "manifests": "./projections/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/preset-contribution", "major": 1 },
      "manifests": "./presets/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/contract-bridge-contribution", "major": 1 },
      "manifests": "./contract-bridges/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/subject-viewer-contribution", "major": 1 },
      "manifests": "./subject-viewers/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/subject-editor-contribution", "major": 1 },
      "manifests": "./subject-editors/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/world-profile-contribution", "major": 1 },
      "manifests": "./world/profiles/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/world-component-contribution", "major": 1 },
      "manifests": "./world/components/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/world-resource-contribution", "major": 1 },
      "manifests": "./world/resources/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/world-command-contribution", "major": 1 },
      "manifests": "./world/commands/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/world-event-contribution", "major": 1 },
      "manifests": "./world/events/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/world-system-contribution", "major": 1 },
      "manifests": "./world/systems/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/world-script-runtime-contribution", "major": 1 },
      "manifests": "./world/script-runtimes/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/game-ui-document-contribution", "major": 1 },
      "manifests": "./game-ui/documents/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/game-ui-renderer-contribution", "major": 1 },
      "manifests": "./game-ui/renderers/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/game-ui-binding-contribution", "major": 1 },
      "manifests": "./game-ui/bindings/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "org.modkitx/game-ui-input-intent-contribution", "major": 1 },
      "manifests": "./game-ui/input-intents/*/contribution.manifest.json"
    },
    {
      "contract": { "id": "community.example/custom-thing", "major": 1 },
      "manifests": "./custom/*/contribution.manifest.json"
    }
  ]
}
```

`security` является authored target-scoped review table. Каждая строка сохраняет contribution,
runtime variant и target; её exact normalized contents проверяются против executable declarations по правилам
[24 §3](24-extension-security-execution-and-lifecycle.md#3-declarative-security-metadata-with-target-scoped-review-rows).
Flat total union разрешён только как generated catalog/UI projection. Ни review table, ни projection
не выдают permissions и не заменяют variant declarations или повторную проверку artifact.

### 5.1 Glob rules

1. Разрешён один shallow `*` segment; recursive `**`, absolute paths, `..` и escape через symlink
   запрещены.
2. Generator разворачивает globs без исполнения extension и сортирует normalized relative paths
   canonical UTF-8 comparator-ом.
3. Один manifest обязан совпасть ровно с одной declaration. Zero matches разрешаются только для
   explicit optional contribution group; duplicate matches являются ошибкой.
4. Validator отдельно перечисляет все `contribution.manifest.json` внутри extension root и выдаёт
   orphan diagnostic для файла, не покрытого ни одним glob.
5. Manifest `contract` обязан совпадать с contract declaration, под которой он найден.
6. Custom contribution contracts разрешаются namespaced definition registry. Definition contracts
   загружаются/валидируются первым pass, остальные manifests — вторым.
7. Catalog хранит expanded explicit entries; runtime никогда не интерпретирует globs.
8. Contribution contract ID и major находятся в разных полях. Литерал вида
   `org.modkitx/codec-contribution@1` является display-only и не проходит grammar документа 23.

Такой glob является декларативным catalog input, а не handwritten switch: параллельный автор
добавляет новую `<id>` directory без редактирования общего массива extension manifest.

## 6. Unified `contribution.manifest` envelope

Все contribution categories используют один transport envelope. Contract выбирает schema для поля
`spec`, поэтому runtime targets, dependencies, permissions и limitations не расходятся между
codec/language/viewer/system manifests.
Версии независимы: `extension-manifest v2` версионирует discovery package, а
`ContributionManifestV1` — envelope отдельной contribution unit; совпадение номеров не требуется.

```ts
interface ContributionManifestV1<TSpec = unknown> {
  readonly schemaVersion: 1
  readonly contract: {
    readonly id: ContractId
    readonly major: number
  }
  readonly id: string // independent stable identity; contract-specific grammar
  readonly displayName: string
  readonly status: 'supported' | 'partial' | 'unsupported' | 'experimental'
  readonly runtimeVariants?: readonly RuntimeVariantDeclaration[]
  readonly dependsOn?: readonly ScopedContractRequirement[]
  readonly limitations?: readonly string[]
  readonly spec: TSpec
}
```

`RuntimeVariantDeclaration` принадлежит
[24 §3](24-extension-security-execution-and-lifecycle.md#3-declarative-security-metadata-with-target-scoped-review-rows)
и импортируется в schema/type generation; этот document не определяет вторую форму runtime variant.
`ScopedContractRequirement` и строгая semantics `required/default/suggested/integrates` принадлежат
[23 §8](23-contract-identity-schema-resolution-and-lock.md#8-normative-candidate-provider-types-v1).
Contribution не имеет отдельной release version: release/digest задаёт owning extension artifact,
а совместимость contribution задаёт его contract id/major и contract-specific `spec`.

Rules:

- contribution/provider coordinate независим от owning extension coordinate и не наследуется из
  extension `publisher/id`; release fragment и scope-local expanded catalog хранят оба;
- v1 adapter сохраняет текущие `org.modkitx/<codec-or-game-id>` coordinates, даже когда owning
  extension использует grouped publisher вроде `org.modkitx.blizzard/starcraft-2`;
- contribution version и extension package version являются разными coordinates;
- static definition может не иметь `runtimeVariants`;
- executable variant объявляет environment, OS, architecture, ABI/features, entrypoint, permissions
  и host facilities в общем envelope;
- codec `match`, traits, inputs/outputs и operations находятся в codec-specific `spec`;
- codec v2 `spec` также различает `FormatRole[]`, source topology, `ArtifactStage`, supported
  `OpenIntent`, detection и per-output/operation fidelity; legacy closed `kind` остаётся только во v1
  adapter;
- service-provider `spec` объявляет typed inputs/outputs, contract requirements, budgets и runtime
  variants, но не source detection/identity;
- game `spec` хранит zero-or-more `EngineReference` entries отдельно от `testedGames` evidence;
  engine release/version scheme и Modkit contract ranges не смешиваются;
- World system phase/slot/reads/writes/cadence находятся в world-system `spec`;
- source schemes/auth/offline policy находятся в source-provider `spec`;
- unknown contract не активируется, но manifest остаётся inspectable и диагностируется без
  execution.

`publisher` extension manifest является distribution authority namespace. Checkout group/path не
является identity; publisher-qualified coordinate сохраняется при link/vendor/embed. Original
format/game vendor хранится metadata и не выдаётся за publisher реализации. Намеренное
переименование contribution coordinate выполняется отдельным
migration slice с mapping, resolver-version bump и lock review, потому что текущий codec matcher
использует coordinate как deterministic tie-break.

`provider.manifest.json` не вводится: это имя не переиспользуется между generic и VFS providers.
Целевое единое имя — `contribution.manifest.json`.

**Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable).** Для `org.modkitx/contract-definition` `spec` (обе ветки `data-source`/`service`)
может нести `surface` — method surface контракта (документ [32](32-execution-boundary-and-method-surfaces.md) §3). Bundled определения
`common.text-data/*-syntax` уже несут surface провайдера; стандартные data‑source surfaces — в sdk.

## 7. License, generated output и imports

```text
ExtensionManifest#license (package.json#modkit / modkit.extension.json)
    лицензия всей extension distribution unit

contribution subdirectories
    не создают отдельные license units

static import через incompatible license boundary
    запрещён policy/generator-ом

runtime composition через public contract/provider boundary
    разрешается host policy
```

Authored extensions не содержат `dist/` и generated release output. Publication output создаётся во
внешнем build staging directory и включает immutable artifact + catalog fragment. Main repository
root `generated/` — migration state и исчезает по §0.6: bundled-common/development catalogs
переезжают в build staging / bundler virtual modules. Marketplace CI, application
build и user installer создают собственные catalogs/indexes/locks согласно
[document 28](28-extension-distribution-catalog-installation-and-product-discovery.md#10-семантика-generated).

Единственные разрешённые зависимости на concrete extension entrypoints находятся в scope-local
generated app/installed lazy loaders. Platform package никогда не импортирует concrete extension
implementation authored edge-ом.

**Правило worker‑загрузки, Принято 2026‑08‑18 (лаборатория modkitX3, Root = Fable).** В `worker-brokered` файлы artifact'а исполняются только из
байтов, сверенных с per‑file digests inventory; относительный/абсолютный импорт, выходящий за artifact
root, отклоняется; bare‑зависимости (`node_modules`, workspace links) и их внутренности грузятся
без верификации (SB‑1; digests зависимостей — SB‑4). Entrypoint остаётся файлом внутри artifact'а
(§0.2/§7), может быть многофайловым.

## 8. Полный целевой каталог уже названных extensions и formats

Этот каталог должен распределять **текущий generated measured set**, а не сохранённое вручную число.
Snapshot 2026-08-11, пересчитанный
`node scripts/report-platform-architecture-review-baseline.mjs`, содержит:

```text
233 catalog entries total
202 non-game contributions
31 game contributions
140 entries under extension roots
93 entries under legacy roots
```

Это design allocation, а не утверждение, что physical migration уже выполнена. IDs сохраняются до
отдельного compatibility decision. `—` означает отсутствие contribution данной категории.
Measured counts охватывают только существующие codec/game concepts; новые service providers,
viewers/editors/projections/World/UI units из target tree не подмешиваются в baseline до появления
реальных manifests. Target extension-coordinate count является результатом allocation generator,
а не стабильной константой Proposal.

Таблица не поддерживается как полностью ручная копия catalog и не выводится целиком из текущих
путей. Источник имеет hybrid модель:

```text
current owner
  current manifests under extensions/ (140 entries in the 2026-08-11 snapshot)
  -> derived from the owning authored ExtensionManifest (не из folder string)

target owner
  current legacy manifests (93 entries in the 2026-08-11 snapshot)
  -> required authored allocation

  already migrated contribution with planned split/rename/move
  -> authored target override

  otherwise
  -> current owner default
```

Например, физический `org.modkitx.common/archives` целевым plan разделяется на compression и
containers, поэтому один только path не может сгенерировать §8. Authored source
`tooling/catalog-sources/format-allocation.v1.json` хранит legacy allocations и explicit overrides;
generator соединяет его с measured catalog и создаёт Markdown table/counts. `docs:check` отклоняет
пропуски, дубликаты, phantom IDs, stale counts и override, который больше не нужен. Authoring set
уменьшается по мере migration, но не обязан стать нулём при намеренных distribution splits.

Следующее дерево является логической группировкой target coordinates в federated catalog, а не
directory tree основного Modkit repository. Каждая leaf обычно публикуется независимым repository/
artifact; `common/*` может быть bundled main-repo family.

```text
federated extension coordinates/
├── adobe/flash/
├── annihilation/gas-powered/
├── audiokinetic/wwise/
├── blizzard/
│   ├── archives/
│   ├── common-formats/
│   ├── diablo/
│   ├── starcraft-1/
│   ├── starcraft-2/
│   ├── warcraft-2/
│   ├── warcraft-3/
│   └── world-of-warcraft/
├── cavedog/total-annihilation/
├── common/
│   ├── audio/
│   ├── compression/
│   ├── containers/
│   ├── images/
│   ├── models/
│   ├── vector/
│   └── video/
├── ea/
│   ├── archives/
│   ├── dune-2000/
│   ├── emperor/
│   ├── models/
│   ├── sage/
│   ├── tiberian-sun/
│   └── westwood/
├── epic-games/unreal-engine/
├── firelight/fmod/
├── frost-giant/stormgate/
├── microsoft/
│   ├── age-series/
│   └── halo-wars/
├── new-world-computing/
│   ├── heroes-3/
│   └── heroes-4/
├── opensource/
│   ├── spring/
│   └── warzone-2100/
├── petroglyph/glyphx/
├── rad-game-tools/video/
├── realitypump/
│   ├── earth-2150/
│   └── earth2160/
├── relic/
│   ├── essence/
│   └── models/
├── slitherine/starship-troopers-terran-command/
├── stainless-steel-studios/empire-earth/
├── tindalos/battlefleet-gothic-2/
├── ubisoft/heroes-6/
├── uncommon/documents/
└── unity/engine/
```

Folder segments являются convention. Authoritative coordinates находятся в таблице и manifests.

| Target extension coordinate                               | Codec/format/runtime contribution IDs                                                                                                                           | Game contribution IDs                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `org.modkitx.adobe/flash`                                 | `fla`, `flv`, `swf`                                                                                                                                             | —                                                                                   |
| `org.modkitx.annihilation/gas-powered`                    | `supcom-scm`, `supreme-commander-map`, `supreme-commander-script`                                                                                               | `supreme-commander`                                                                 |
| `org.modkitx.audiokinetic/wwise`                          | `bnk`, `wem`, `wwise-pck`                                                                                                                                       | —                                                                                   |
| `org.modkitx.blizzard/archives`                           | `casc`, `mpq`                                                                                                                                                   | —                                                                                   |
| `org.modkitx.blizzard/common-formats`                     | `blizzard-tbl`, `blp`                                                                                                                                           | —                                                                                   |
| `org.modkitx.blizzard/diablo`                             | `diablo2-character-model`, `diablo2-data`, `diablo2-dc6`, `diablo2-dt1`, `diablo2-save`, `diablo3-app`, `diablo3-sno-data`, `diablo3-tex`                       | `diablo-2`, `diablo-3`                                                              |
| `org.modkitx.blizzard/starcraft-1`                        | `starcraft-chk`, `starcraft-grp`, `starcraft-replay`                                                                                                            | `starcraft-1`                                                                       |
| `org.modkitx.blizzard/starcraft-2`                        | `galaxy`, `m3`, `sc2-bank`, `sc2-data`, `sc2-document-metadata`, `sc2-layout`, `sc2-map`, `sc2-mod`, `sc2-replay`, `sc2-runtime`, `sc2-strings`, `sc2-triggers` | `heroes-of-the-storm`, `starcraft-2`                                                |
| `org.modkitx.blizzard/warcraft-2`                         | `warcraft2-pud`                                                                                                                                                 | `warcraft-2`                                                                        |
| `org.modkitx.blizzard/warcraft-3`                         | `war3-mdx`, `warcraft3-map`, `warcraft3-object-data`, `warcraft3-replay`, `warcraft3-script`, `warcraft3-wts`                                                   | `warcraft-3`                                                                        |
| `org.modkitx.blizzard/world-of-warcraft`                  | `wow-m2`                                                                                                                                                        | `world-of-warcraft`                                                                 |
| `org.modkitx.cavedog/total-annihilation`                  | `gaf`, `ta-hpi`                                                                                                                                                 | —                                                                                   |
| `org.modkitx.common/audio`                                | `aac`, `flac`, `m4a`, `mp3`, `ogg`, `opus`, `wav`                                                                                                               | —                                                                                   |
| `org.modkitx.common/compression`                          | `brotli`, `bzip2`, `lzma`, `zstd`                                                                                                                               | —                                                                                   |
| `org.modkitx.common/containers`                           | `7z`, `cab`, `dmg`, `gzip`, `iso`, `pe`, `ps1-cue-bin`, `ps1-xa`, `rar`, `tar`, `xz`, `zip`                                                                     | —                                                                                   |
| `org.modkitx.common/images`                               | `ani`, `avif`, `basis`, `bmp`, `cur`, `dds`, `exr`, `gif`, `hdr`, `ico`, `jpg`, `ktx`, `ktx2`, `pal`, `pcx`, `png`, `tga`, `tiff`, `webp`                       | —                                                                                   |
| `org.modkitx.common/models`                               | `dae`, `glb`, `gltf`, `obj`, `ply`, `stl`                                                                                                                       | —                                                                                   |
| `org.modkitx.common/vector`                               | `emf`, `svg`, `wmf`                                                                                                                                             | —                                                                                   |
| `org.modkitx.common/video`                                | `avi`, `mp4`, `mpeg`, `ogv`, `webm`, `wmv`                                                                                                                      | —                                                                                   |
| `org.modkitx.ea/archives`                                 | `mix`                                                                                                                                                           | —                                                                                   |
| `org.modkitx.ea/dune-2000`                                | `dune2000-map`                                                                                                                                                  | `dune-2000`                                                                         |
| `org.modkitx.ea/emperor`                                  | `emperor-bag`, `emperor-map`, `emperor-rfh-rfd`, `emperor-xbf`                                                                                                  | `emperor`                                                                           |
| `org.modkitx.ea/models`                                   | `sage-w3x`, `westwood-w3d`                                                                                                                                      | —                                                                                   |
| `org.modkitx.ea/sage`                                     | `big`, `cnc3-data`, `cnc3-localization`, `cnc3-map`, `sage-asset-bundle`, `sage-skudef`                                                                         | `cnc3-tiberium-wars`, `cnc4-tiberian-twilight`, `generals-zero-hour`, `red-alert-3` |
| `org.modkitx.ea/tiberian-sun`                             | `red-alert2-vxl`                                                                                                                                                | `red-alert-2`, `tiberian-sun`                                                       |
| `org.modkitx.ea/westwood`                                 | `cps`, `r16`, `r8`, `shp`, `tmp`, `vpl`, `wsa`                                                                                                                  | —                                                                                   |
| `org.modkitx.epic-games/unreal-engine`                    | `uasset`, `unreal-actorx`, `unreal-iostore`, `unreal-pak`, `unreal-uasset`, `unreal-uasset-texture`, `unreal-uasset-video`                                      | —                                                                                   |
| `org.modkitx.firelight/fmod`                              | `fsb`                                                                                                                                                           | —                                                                                   |
| `org.modkitx.frost-giant/stormgate`                       | —                                                                                                                                                               | `stormgate`                                                                         |
| `org.modkitx.microsoft/age-series`                        | `age-bar`, `age-drs`, `age-of-mythology-brg`, `bti`, `cub`, `ddt`, `mtrl`, `prt`, `sld`, `slp`, `smp`, `smx`                                                    | `age-of-empires-4`, `age-of-mythology`                                              |
| `org.modkitx.microsoft/halo-wars`                         | `halo-era`, `halo-wars-ugx`                                                                                                                                     | `halo-wars`                                                                         |
| `org.modkitx.new-world-computing/heroes-3`                | `def`, `heroes3-lod`                                                                                                                                            | —                                                                                   |
| `org.modkitx.new-world-computing/heroes-4`                | `heroes4-resource`                                                                                                                                              | —                                                                                   |
| `org.modkitx.opensource/spring`                           | `spring-rapid`, `spring-s3o`, `spring-vfs`                                                                                                                      | `beyond-all-reason`                                                                 |
| `org.modkitx.opensource/warzone-2100`                     | `warzone-img`, `warzone-lev`, `warzone-pie`, `warzone-wrf`, `warzone-wz`, `warzone2100-map`                                                                     | `warzone-2100`                                                                      |
| `org.modkitx.petroglyph/glyphx`                           | `grey-goo-alo`, `grey-goo-map`, `petroglyph-meg`                                                                                                                | `grey-goo`                                                                          |
| `org.modkitx.rad-game-tools/video`                        | `bink`, `smacker`                                                                                                                                               | —                                                                                   |
| `org.modkitx.realitypump/earth-2150`                      | `earth-par`, `earth-res`, `earth-tex`, `earth2150-map`                                                                                                          | `earth-2150`                                                                        |
| `org.modkitx.realitypump/earth2160`                       | `earth2160-map`, `earth2160-model`, `wd`                                                                                                                        | `earth-2160`                                                                        |
| `org.modkitx.relic/essence`                               | `dawn-of-war-map`, `relic`, `relic-rgm`, `relic-sga`, `relic-ucs`, `rgt`, `rrtex`, `rsh`, `rtx`, `wtp`                                                          | `company-of-heroes-2`, `company-of-heroes-3`, `dawn-of-war`                         |
| `org.modkitx.relic/models`                                | `relic-sgm`, `relic-whm`                                                                                                                                        | —                                                                                   |
| `org.modkitx.slitherine/starship-troopers-terran-command` | —                                                                                                                                                               | `starship-troopers-terran-command`                                                  |
| `org.modkitx.stainless-steel-studios/empire-earth`        | `empire-earth-ssa`, `sst`, `texcache`                                                                                                                           | —                                                                                   |
| `org.modkitx.tindalos/battlefleet-gothic-2`               | —                                                                                                                                                               | `battlefleet-gothic-2`                                                              |
| `org.modkitx.ubisoft/heroes-6`                            | `heroes6-orc`                                                                                                                                                   | —                                                                                   |
| `org.modkitx.uncommon/documents`                          | `ai`, `blend`, `cdr`, `csv`, `docx`, `drawio`, `figma`, `markdown`, `max`, `odp`, `ods`, `odt`, `pdf`, `pptx`, `psd`, `rtf`, `txt`, `visio`, `xlsx`             | —                                                                                   |
| `org.modkitx.unity/engine`                                | `unity`, `unity-assets`, `unity-mesh`, `unity-ress`, `unityfs`                                                                                                  | —                                                                                   |

## 9. Explicitly planned candidate extensions/codecs

Следующий список покрывает все formats/ecosystems, уже названные в Proposal format landscape. Он
проверяет extensibility target, но не обещает implementation order. Candidate IDs до первого
manifest не являются stable coordinates. Строка описывает target distribution coordinate, а не
обещает directory в main repository; кроме bundled `common`, реализация обычно живёт в independent
publisher repository и появляется через catalog/direct artifact.

| Candidate target extension                | Planned candidate codec/contribution IDs                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org.modkitx.common/containers`           | `installer-package`, `patch-bundle`, `delta-bundle`, `content-store-index`                                                                                                                         |
| `org.modkitx.common/images`               | `heif`, `jpeg-xl`, `qoi`, `astc`, `pvr`, `etc2`, `openraster`, `krita`, `xcf`, `sprite-atlas`, `material-graph`, `texture-graph`, `virtual-texture`                                                |
| `org.modkitx.common/audio`                | `aiff`, `alac`, `wma`, `midi`, `mod`, `xm`, `s3m`, `it`                                                                                                                                            |
| `org.modkitx.common/video`                | `mkv`, `mov`, `mpeg-ts`, `h264`, `h265`, `av1`, `mve`                                                                                                                                              |
| `org.modkitx.common/models`               | `fbx`, `usd`, `usdz`, `alembic`, `cad-model`                                                                                                                                                       |
| `org.modkitx.common/fonts`                | `ttf`, `otf`, `woff`, `woff2`, `bmfont`, `bitmap-font`                                                                                                                                             |
| `org.modkitx.common/subtitles`            | `srt`, `webvtt`, `ass`, `subrip-caption-track`                                                                                                                                                     |
| `org.modkitx.common/localization`         | `po`, `mo`, `xliff`, `resx`, `fluent`, `icu-messageformat`, `json-localization`, `yaml-localization`, `csv-localization`                                                                           |
| `org.modkitx.common/code`                 | `lua`, `python`, `csharp`, `javascript`, `typescript`, `glsl`, `hlsl`, `wgsl`, `spirv`, `shader-graph`, `behavior-tree`, `dialogue-graph`, `quest-graph`                                           |
| `org.modkitx.uncommon/documents`          | `epub`, `html`, `latex`, `jupyter`, `eml`, `msg`, `mbox`, `onenote`, `sqlite`, `parquet`, `arrow`, `messagepack`, `protobuf`, `flatbuffers`, `yaml`, `toml`, `ini`, `cad-document`, `gis-document` |
| `org.modkitx.valve/source`                | `vpk`, `source-bsp`, `source-mdl`, `source-vtx`, `source-vvd`                                                                                                                                      |
| `org.modkitx.valve/source2`               | `source2-resource` с reuse совместимого `vpk` provider                                                                                                                                             |
| `org.modkitx.id-software/id-tech`         | `wad`, `pk3`, `roq`                                                                                                                                                                                |
| `org.modkitx.activision/infinity-ward`    | `iwd`                                                                                                                                                                                              |
| `org.modkitx.bethesda/creation-engine`    | `bsa`, `ba2`, `nif`                                                                                                                                                                                |
| `org.modkitx.rockstar/rage`               | `rpf`                                                                                                                                                                                              |
| `org.modkitx.criware/media`               | `cpk`, `adx`, `hca`, `acb`, `awb`, `usm`, `sfd`                                                                                                                                                    |
| `org.modkitx.microsoft/xact`              | `xwb`, `xsb`                                                                                                                                                                                       |
| `org.modkitx.nintendo/audio`              | `dsp`, `bfstm`                                                                                                                                                                                     |
| `org.modkitx.sony/audio`                  | `vag`, `atrac`                                                                                                                                                                                     |
| `org.modkitx.crytek/cryengine`            | `cgf`, `chr`                                                                                                                                                                                       |
| `org.modkitx.godot/engine`                | `godot-pck`, `tscn`, `tres`                                                                                                                                                                        |
| `org.modkitx.mojang/minecraft`            | `minecraft-region`, `nbt`                                                                                                                                                                          |
| `org.modkitx.paradox/clausewitz`          | `paradox-data`, `paradox-mod`, `paradox-save`                                                                                                                                                      |
| `org.modkitx.wube/factorio`               | `factorio-mod`, `factorio-data`, `factorio-save`                                                                                                                                                   |
| `org.modkitx.ludeon/rimworld`             | `rimworld-defs`, `rimworld-mod`, `rimworld-save`                                                                                                                                                   |
| `org.modkitx.openra/engine`               | `openra-mod`, `openra-map`, `openra-replay`                                                                                                                                                        |
| `org.modkitx.ea/westwood`                 | `vqa`                                                                                                                                                                                              |
| `org.modkitx.wildfire-games/0-ad`         | `0ad-data`, `0ad-mod`, `0ad-pmd`, `0ad-psa`; reuse common `dae` и `zip`                                                                                                                            |
| `org.modkitx.creative-assembly/total-war` | `total-war-pack`                                                                                                                                                                                   |
| `org.modkitx.relic/homeworld`             | `homeworld-big`, `homeworld-hod`                                                                                                                                                                   |
| `org.modkitx.ubisoft/anno`                | `anno-rda`                                                                                                                                                                                         |
| `org.modkitx.uber/planetary-annihilation` | `papa`                                                                                                                                                                                             |

Planned non-codec provider extensions:

| Target extension                     | Planned providers                               |
| ------------------------------------ | ----------------------------------------------- |
| `org.modkitx.sources/git`            | Git repository/history/worktree VFS provider    |
| `org.modkitx.sources/github`         | GitHub repository/release/API source provider   |
| `org.modkitx.sources/http-api`       | Generic authenticated HTTP/API source provider  |
| `org.modkitx.sources/s3`             | S3-compatible object storage provider           |
| `org.modkitx.sources/steam-workshop` | Workshop subscription/content source provider   |
| `org.modkitx.sources/database`       | SQL/document database-backed namespace provider |

Additional planned game profiles whose format codecs are already allocated above:

```text
org.modkitx.cavedog/total-annihilation          -> total-annihilation
org.modkitx.new-world-computing/heroes-3       -> heroes-3
org.modkitx.new-world-computing/heroes-4       -> heroes-4
org.modkitx.ubisoft/heroes-6                    -> heroes-6
org.modkitx.stainless-steel-studios/empire-earth -> empire-earth
org.modkitx.microsoft/age-series                -> age-of-empires-2
org.modkitx.wildfire-games/0-ad                 -> 0-ad
org.modkitx.creative-assembly/total-war         -> total-war
org.modkitx.relic/homeworld                     -> homeworld-remastered
org.modkitx.ubisoft/anno                        -> anno
org.modkitx.valve/source2                       -> source-2
org.modkitx.uber/planetary-annihilation         -> planetary-annihilation
```

`age-of-empires-2` является новым planned game contribution поверх уже аллоцированных
`age-drs`/`age-bar`/`slp`/`smx`/`sld`; он намеренно не добавлен в measured §8, чтобы точная
проверка текущего generated catalog оставалась воспроизводимой. 0 A.D., Spring и Warzone 2100
являются кандидатами second-game proof; выбор делается по первой полной cross-game conformance
fixture, а не заранее по названию игры.

Архитектура остаётся открытой: этот список полный только для уже явно названных планов. Неизвестные
будущие extension/contract IDs не требуют изменения core schema или authored central switch.

## 10. Appendix (non-normative): полная целевая поверхность independent SC2 extension repository

Это target independent repository root. Текущий linked checkout внутри Modkit development tree —
implementation fact, не distribution или install identity; independent-artifact proof проверяет,
что repository действительно самодостаточен.

```text
modkit-extension-starcraft-2/
├── modkit.extension.json      # appendix: старая форма extension.json нормализуется в тот же ExtensionManifest
├── definitions/
│   ├── contracts/
│   ├── traits/
│   ├── subject-kinds/
│   └── errors/
├── codecs/
│   ├── galaxy/
│   ├── m3/
│   ├── sc2-bank/
│   ├── sc2-data/
│   ├── sc2-document-metadata/
│   ├── sc2-layout/
│   ├── sc2-map/
│   ├── sc2-mod/
│   ├── sc2-replay/
│   ├── sc2-strings/
│   └── sc2-triggers/
├── games/
│   ├── starcraft-2/
│   └── heroes-of-the-storm/
├── subject-providers/
│   ├── catalog-entity/
│   ├── unit/
│   ├── ability/
│   ├── effect/
│   ├── actor/
│   ├── model/
│   ├── localization-matrix/
│   └── layout-template/
├── language-providers/
│   ├── gamedata/
│   ├── gamestrings/
│   ├── galaxy/
│   └── sc2layout/
├── projections/
│   ├── catalog-entity-card/
│   ├── localization-table/
│   ├── m3-scene-3d/
│   └── sc2-map-scene/
├── presets/
│   ├── explorer/
│   ├── authoring/
│   └── simulation/
├── subject-viewers/
│   ├── entity-card/
│   ├── catalog-browser/
│   ├── map-viewer/
│   ├── replay-viewer/
│   ├── save-viewer/
│   └── ui-template-viewer/
├── subject-editors/
│   ├── entity-properties/
│   ├── localization-table/
│   ├── bank-editor/
│   └── layout-editor/
├── operation-providers/
│   ├── launch-map/
│   ├── validate-mod/
│   ├── convert-model/
│   ├── edit-catalog/
│   └── patch-bank/
├── runtime-providers/
│   ├── galaxy/
│   └── sc2-runtime/
├── world/
│   ├── profiles/
│   ├── components/
│   ├── resources/
│   ├── commands/
│   ├── events/
│   ├── systems/
│   ├── script-runtimes/
│   └── mechanics/
├── game-ui/
│   ├── documents/
│   ├── renderers/
│   ├── bindings/
│   ├── input-intents/
│   ├── animations/
│   └── previews/
├── src/shared/
└── test/integration/
```

SC2 Unit preview не импортирует DDS/M3/string implementations directly. Он публикует relations и
запрашивает compatible contracts; resolver/lock выбирает installed providers.

## 11. Dependency direction

```text
apps
  -> workbench / viewer-shell / language-host / lsp adapters
  -> workspace / assets / runtime
  -> portable contracts

viewer-shell/cards
  -> entity-cards projection model
  -> assets subject/relation contracts

replay-player
  -> processing/replays + rendering contracts + optional runtime contracts
  -X-> concrete simulation/game implementation

independent/bundled extension artifacts
  -> public package contracts and processing/rendering libraries
  -X-> private implementations of another extension

scope-local generated app/installed catalogs
  -> the only host-owned lazy imports of extension entrypoints

federated marketplace catalog
  -> metadata/artifact links only
  -X-> extension runtime activation during query/matching

multiverse
  -X-> Modkit

game extension
  -> Modkit contracts
  -> Multiverse contracts
```

## 12. Acceptance criteria

1. New custom contribution category is discoverable through a namespaced contract without changing
   the core extension-manifest property list.
2. Shallow globs expand deterministically; orphan, duplicate, escaping and contract-mismatch cases
   fail validation.
3. All executable contribution kinds share one runtime-target/permission envelope.
4. Empty host imports no concrete game/format implementation.
5. No package has an authored dependency on a concrete extension entrypoint.
6. Every entry in the current generated codec/game catalog has exactly one target owner in section
   8; deleted or newly added manifests change the generated allocation report, not this sentence.
7. Extension license is singular and preserved in its release fragment, app/installed catalog and
   provenance.
8. Package exports, not internal folder names, define public API.
9. Replay playback works without simulation runtime.
10. AI/MCP automation uses the same public operations/transactions as CLI/workbench.
11. Multiverse packages compile without Modkit dependencies.
12. SC2 extension can remove optional DDS/M3/language/runtime providers and degrade without losing
    inspectable native subjects.
13. Contract-owner conformance fixtures are addressable by stable suite ID/hash and reusable by a
    foreign implementation without importing owner runtime code.
14. Preset discovery executes no code and does not imply installation; contract bridge use is
    explicit, policy-checked and recorded in resolution trace/lock.
15. `subject-viewers` target Modkit Subject UI, while `game-ui` represents content rendered by a
    game/runtime; conformance rejects category/contract mismatch.
16. Root schema compatibility keeps the existing `schema/` owner; extension migration does not
    require a repository-wide rename to `schemas/`.
17. Every public contribution directory shown in section 4, including source/subject/language/
    service/operation/runtime providers and subject editors, is covered by exactly one manifest glob.
18. V1 adapter preserves independent codec/game coordinates and coordinate-based matching order;
    extension ownership is separate catalog data.
19. Machine-readable allocation source plus current extension manifests reproduce the current
    generated catalog and section 8 counts without duplicate, phantom or missing IDs.
20. `RenderModel`/`Scene3D` have one target owner in `rendering-3d/scene`; model processing and
    concrete codecs depend on that contract rather than redefining it.
21. Main repository/default generic installation contains only platform + bundled `common`; section
    8 vendor/game coordinates do not imply main-repository directories.
22. Independent SC2/non-common artifact can be loaded without source checkout, workspace enrollment
    or authored root switch.
23. Main root `generated/`, extension release fragment, federated catalog, app bundle catalog,
    installed index and project locks have distinct output paths/owners.
24. Catalog/product matching reads only metadata and declarative rules; it never activates extension
    entrypoints.
25. Specialized web/app build can embed/pin an external extension while preserving its original
    extension/contribution identities.
