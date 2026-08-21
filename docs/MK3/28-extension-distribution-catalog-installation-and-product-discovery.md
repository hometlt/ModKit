# 28. Extension Distribution, Catalogs, Installation, and Product Discovery

Status: **non-canonical normative candidate**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; this is the Proposal owner for federated extension distribution and installation**  
Updated: **2026-08-11**

Этот документ определяет целевую distribution-модель Modkit. Он отделяет четыре разные задачи:

1. публикацию extension из независимого repository;
2. поиск доступных releases в одном или нескольких catalogs;
3. установку exact artifacts на конкретный host;
4. выбор provider для операции внутри проекта.

Последняя задача принадлежит operation resolver документа 23. Первые три не должны быть скрыты
внутри codec/provider discovery или одного repository-level `generated/` каталога.

## 1. Решение

Generic Modkit installation содержит platform packages/apps и bundled `common` extension family.
Game/vendor/community extensions не являются постоянными директориями основного Modkit repository:
они публикуются из независимых Git repositories и устанавливаются отдельно.

```text
Modkit repository
  platform + schemas + SDK + bundled common

independent extension repositories
  authored source + manifests + tests + release pipeline

catalog repositories/services
  metadata + signed immutable release records + artifact/source links

application/user installation
  artifact store + install lock + enabled set + generated activation catalog
```

Website, web component или специализированное приложение может embed/pin extensions на build time.
Generic Electron/CLI/IDE installation не получает игровые extensions автоматически.

## 2. Инварианты

1. Main Modkit repository не является source monorepo всех известных extensions.
2. Extension source repository, release artifact, catalog record, installed artifact и active
   runtime instance имеют разные identities и provenance.
3. Catalog metadata читается без загрузки или исполнения extension code.
4. Catalog listing/recommendation ничего не устанавливает и не активирует.
5. Install resolver выбирает exact extension artifacts и dependencies. Operation resolver выбирает
   installed provider для contract/operation. Их locks и versioning независимы.
6. Default install включает только `common`; game/vendor extensions требуют explicit bundle policy
   или user-approved installation.
7. Direct local/release/Git-derived installation остаётся возможной без official catalog.
8. Multiple official/community/private catalogs могут сосуществовать. Catalog priority не меняет
   extension или contribution identity.
9. Один root `generated/` не является authority для marketplace, installed state, app bundle,
   project provider-policy lock и runtime session composition.
10. Product inventory выполняется только с consent. Core не содержит hardcoded paths или список
    известных игр/programs.
11. Browser-only host не сканирует local machine и не активирует native code без trusted bridge.
12. Ни source URL, ни Git branch не являются reproducible release identity без immutable artifact
    digest.

## 3. Repository topology

### 3.1 Основной Modkit repository

Основной repository владеет:

- portable contracts и host implementations;
- schemas, SDK/testkit, validators и catalog/install API boundaries;
- generic applications;
- bundled `common` extension family;
- fixtures и development catalogs, нужные для проверки самой платформы.

Он не владеет исходниками SC2, SAGE, Spring, Warzone и остальных vendor/community extensions в
целевой структуре. Текущее размещение таких directories является migration state.

### 3.2 Независимый extension repository

Обычно один repository публикует одну distribution unit. Publisher может поддерживать несколько
repositories или явно versioned suite, но install identity не выводится из Git organization/name.

```text
modkit-extension-starcraft-2/
├── package.json            # + блок "modkit" (authored ExtensionManifest; non-npm → modkit.extension.json)
├── package.json
├── README.md
├── LICENSE
├── schema/
├── definitions/
├── codecs/
├── games/
├── source-providers/
├── subject-providers/
├── language-providers/
├── service-providers/
├── operation-providers/
├── runtime-providers/
├── projections/
├── subject-viewers/
├── subject-editors/
├── presets/
├── world/
├── game-ui/
├── fixtures/
├── test/
└── .github/workflows/
```

Все области опциональны. Маленький extension содержит только authored manifest
(`package.json#modkit`), одну contribution directory, fixtures/tests и license.

### 3.3 Catalog repository/service

Catalog содержит release records, а не implementation source:

```text
modkit-extension-catalog/
├── catalog.json
├── publishers/
├── releases/
│   └── <extension-coordinate>/<version>.json
├── revocations/
├── schemas/
└── generated/
    ├── search-index/
    ├── compatibility-index/
    └── product-match-index/
```

Authored publisher/review records и generated indexes должны быть различимы. Static Git catalog,
HTTP service и private organization catalog используют один transport-neutral record model.

### 3.4 Installed/app-bundled layout

Конкретная физическая директория является host policy, но logical layout содержит:

```text
extension-store/
├── artifacts/<digest>/
├── catalog-snapshots/
├── install.lock.json
├── enabled-profiles/
└── generated/
    ├── installed-index/
    ├── detection-catalog/
    ├── activation-catalog/
    └── license-sbom/
```

Artifacts immutable и content-addressed. User settings, grants и project locks не записываются
внутрь artifact directory.

## 4. Identity и version planes

Следующие coordinates нельзя смешивать:

| Plane                 | Пример                                       | Назначение                             |
| --------------------- | -------------------------------------------- | -------------------------------------- |
| Catalog               | `org.modkitx.catalog/official` + revision    | источник release metadata              |
| Publisher             | `org.modkitx.blizzard`                       | authority публикации extension         |
| Extension             | `org.modkitx.blizzard/starcraft2@2.4.0`      | distribution unit/version              |
| Artifact              | algorithm + immutable digest                 | точные bytes release bundle            |
| Source                | repository URL + commit/tag evidence         | аудит исходников, не runtime identity  |
| Contribution/provider | текущий `org.modkitx/<id>` + version         | discoverable implementation/definition |
| Runtime variant       | environment/OS/architecture/ABI + variant ID | executable target                      |
| Contract              | `(contractId, major/range)`                  | API compatibility                      |
| Installed instance    | extension release + artifact digest + target | факт установки на host                 |
| Project selection     | portable provider-policy entry               | logical implementation/fallback policy |
| World composition     | World composition lock                       | schema/system/mechanic composition     |

Original format/game vendor хранится metadata и не выдаётся за publisher реализации. Один
extension coordinate с одинаковой version и разными artifact bytes является integrity conflict.

## 5. Release record и publication flow

Минимальный release record содержит:

- catalog schema version;
- extension coordinate/version и manifest digest;
- immutable artifact URL(s), size, digest и media type;
- source repository URL и optional exact source commit;
- supported Modkit contract/schema ranges;
- runtime targets, permissions summary и external-tool requirements;
- dependency requirements и optional integrations;
- license/provenance/SBOM references;
- conformance suite IDs/results/evidence digests;
- yanked/revoked/security-advisory state;
- optional declarative installed-product match rules.

Publication flow:

```text
authored extension repository
  -> validate manifests/schemas
  -> run conformance/fixtures
  -> build immutable artifact in staging
  -> emit catalog fragment + SBOM/licenses + digests
  -> publisher signature/attestation
  -> catalog review/aggregation
  -> generated search/compatibility indexes
```

Catalog никогда не выполняет extension build script при query. Catalog fragment, подпись и artifact
могут публиковаться разными transports, но digest связывает exact bytes.

## 6. Catalog и installation APIs

Target control plane должен позволять host-у:

- перечислять configured catalogs и их revisions/trust state;
- искать extensions и читать metadata без activation;
- перечислять installed releases и enabled app/project profiles;
- строить dry-run install/update/remove plan;
- показывать dependency, license, permission, size и target compatibility diff;
- устанавливать из catalog release, local bundle, direct immutable URL или Git-derived local build;
- pin/rollback exact artifact;
- экспортировать/importировать reproducible install lock;
- работать offline по installed artifacts и cached catalog snapshot.

Mutating install APIs являются explicit side-effect operations с permission и confirmation. Search/
inspection APIs остаются read-only. App embedding может предоставить собственную реализацию этих APIs
или объявить installation unavailable.

Logical API roles (names are target vocabulary, not yet stable package exports):

| Role                          | Representative operations                                                 | Side effects                |
| ----------------------------- | ------------------------------------------------------------------------- | --------------------------- |
| `ExtensionCatalogReader`      | list catalogs, search, get release/dependency/security metadata, snapshot | none                        |
| `ExtensionInstallPlanner`     | dry-run install/update/remove, explain conflicts and budgets              | none                        |
| `ExtensionArtifactStore`      | fetch/import, verify, install, remove, rollback, export lock              | filesystem/network mutation |
| `InstalledExtensionInventory` | list exact artifacts, enabled profiles and compatibility state            | none                        |
| `ProductInventoryHost`        | collect consented neutral installed-product evidence                      | privileged host read        |
| `ExtensionRecommender`        | apply declarative rules and explain recommendations                       | none                        |

CLI/workbench/embedding APIs адаптируют эти роли, а не получают отдельную semantic model. `install`
не вызывается неявно из `open`, `resolveProvider` или recommendation click.

## 7. Install resolver и install lock

Install resolver отвечает только за distribution dependencies:

```text
requested extension releases/ranges
  + configured catalogs/direct artifacts
  + host target and policy
  + accepted licenses/permissions
  -> exact artifact plan
  -> immutable install lock
```

Install lock хранит:

- schema/solver version;
- exact extension version и artifact digest;
- catalog/source provenance snapshot;
- resolved dependency graph;
- selected runtime-target-compatible artifacts;
- license/SBOM/conformance evidence references;
- accepted permission declaration digest;
- yanked/revoked status known at resolution time.

Credential values, raw tokens и transient catalog search results в lock не попадают.

Operation provider lock документа 23 строится только по установленному/embedded catalog. Появление
нового remote release не меняет активный project provider автоматически.

Install lock target-scoped и может различаться между Windows/Linux/browser deployments. Он не
является portable provider-policy lock. Machine activation snapshot дополнительно фиксирует
effective facilities/tools/grants и selected runtime variant; он не коммитится как project intent.
Deterministic session composition хранит только exact semantic/content compatibility и явно нужные
artifact attestations, не ambient installation state.

## 8. Default, embedded и externally managed profiles

| Host/product                    | Default extensions                    | Acquisition                                             |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| Generic CLI/Electron/IDE plugin | bundled `common` only                 | local/direct/catalog install with consent               |
| Node library                    | none or caller-supplied `common`      | embedding application injects catalogs/providers        |
| Generic PWA                     | browser-safe `common` bundle          | curated signed browser artifacts if policy allows       |
| Web component                   | one minimal embedded preset           | no general installer required                           |
| `sc2-modkit` or proof game      | pinned SC2/game/runtime extension set | build-time embedded or managed product update           |
| Headless service                | immutable deployment profile          | image/build pipeline; runtime install commonly disabled |

Bundled extension проходит тот же manifest/conformance pipeline. Bundling не превращает extension
code в core и не меняет contribution identity.

## 9. Installed product inventory и recommendations

Цель — рекомендовать extensions для уже установленного ПО без списка игр и hardcoded paths в core.

```text
permissioned inventory collectors
  -> neutral InstalledProductEvidence
  -> catalog-supplied declarative match rules
  -> ranked ExtensionRecommendation + explanation
  -> user-approved install plan
```

### 9.1 Generic collectors

Host может предоставлять collectors для:

- OS application registry/package database;
- Steam-like library manifests и generic store records;
- package managers;
- user-selected directories;
- embedding application supplied inventory;
- privacy-safe executable/file metadata fingerprints.

Collectors возвращают neutral evidence: normalized publisher/product/store IDs, display name,
version, architecture, evidence source, confidence и opaque installation/source handle. Raw
credentials не возвращаются. Path redaction является host policy.

### 9.2 Declarative product match rules

Catalog release может объявить data-only rules:

- exact store/application/product ID;
- normalized publisher/product aliases;
- bounded file/executable fingerprints;
- supported version ranges;
- required host facilities;
- recommendation strength и human-readable reason.

Matching не активирует extension code. Core исполняет только известную ограниченную rule schema.

### 9.3 Complex locators

Если generic evidence недостаточно, complex proprietary locator является отдельным inventory/source
provider. Он должен быть установлен до запуска, иметь signature/provenance, declared filesystem/
process permissions, bounded scan и sandbox profile согласно enforcement возможностям host-а.

### 9.4 Privacy и UX

- inventory scan запускается только после consent и показывает scope;
- recommendation объясняет evidence/rule match;
- recommendation не означает automatic install;
- remote catalog получает нормализованные IDs, а не local paths, если пользователь не разрешил
  иначе;
- user может отключить collectors и установить extension вручную;
- browser получает inventory только от пользователя или trusted embedding/native bridge.

## 10. Семантика `generated/`

`generated` означает derivable artifact, но не задаёт один global owner:

| Scope                  | Artifacts                                             | Owner/lifecycle                             |
| ---------------------- | ----------------------------------------------------- | ------------------------------------------- |
| Extension build        | typed bindings, validated fragment, bundle manifest   | release staging; recreated per build        |
| Catalog publication    | signed release record                                 | publisher/catalog CI; immutable per release |
| Aggregated marketplace | search, compatibility, product-match indexes          | catalog build/service                       |
| Main Modkit repository | bundled-common/development catalogs                   | platform CI only                            |
| Application bundle     | embedded extension index, lazy loaders, SBOM/licenses | app build                                   |
| User installation      | installed index, install lock, activation catalogs    | installer/store on device                   |
| Project/session        | provider/World locks and session fingerprints         | workspace/runtime host                      |
| Cache                  | detection, conversion, render and inventory indexes   | disposable local state                      |

Не все scopes обязаны называться физически `generated/`. Locks и persistent installed state должны
иметь явные имена и schema owners, а не выглядеть как disposable build cache.

## 11. Trust, security и supply chain

Первый local proof может доверять явно установленному artifact по provenance, но target model должна
сохранять:

- artifact digest verification до распаковки/activation;
- path traversal/archive bomb limits;
- publisher/catalog signature/attestation state;
- license, permission и external-tool diff до update;
- revocation/yank/security advisory;
- crash/quarantine state отдельно от install identity;
- rollback exact previous artifact;
- catalog compromise containment: installed lock не переписывается молча;
- no code execution during search, product matching or install planning.

Signed catalog не доказывает provider conformance или безопасность executable code. Runtime grants,
broker enforcement и isolation остаются отдельными gates документа 24.

## 12. Failure и offline semantics

| Ситуация                    | Поведение                                                                   |
| --------------------------- | --------------------------------------------------------------------------- |
| Catalog unavailable         | installed/embedded artifacts продолжают работать; search/update unavailable |
| Unknown catalog schema      | record inspectable as unsupported; code не исполняется                      |
| Missing optional dependency | install plan показывает degraded feature; hard dependency blocks plan       |
| Digest mismatch             | integrity conflict; artifact не устанавливается                             |
| Revoked installed release   | warning/policy block; no silent deletion or replacement                     |
| Host target incompatible    | release виден, installation plan rejected/explained                         |
| Browser without installer   | catalog browsing или curated bundle; install operation unavailable          |
| Inventory permission denied | no scan; manual search/install remains available                            |
| Matcher ambiguity           | несколько explainable recommendations; user/policy chooses                  |

## 13. End-to-end flows

### 13.1 Generic Modkit предлагает SC2 extension

```text
generic Electron installed with common
  -> user permits installed-product inventory
  -> generic OS/store collector returns SC2 product evidence
  -> cached/remote catalog rule recommends org.modkitx.blizzard/starcraft2
  -> UI shows source, version, permissions, license, size and reason
  -> user confirms dry-run plan
  -> installer verifies exact artifact digest and writes install lock
  -> installed catalog is regenerated
  -> project operation resolver may select SC2 contributions
```

SC2 path/store knowledge находится в neutral store evidence или catalog rule; core не импортирует
SC2 extension для recommendation.

### 13.2 Specialized web application

```text
application build
  -> pins browser-safe extension releases
  -> verifies artifacts/conformance
  -> generates embedded catalog + lazy loaders + licenses
  -> deploys immutable bundle

browser runtime
  -> reads embedded catalog
  -> activates only requested browser-safe contribution
  -> exposes install unavailable unless trusted embedding API exists
```

### 13.3 Manual independent extension

```text
developer builds local extension bundle
  -> Modkit validates manifest/schema/digest
  -> user approves local unsigned provenance and permissions
  -> installer records exact local artifact in install lock
  -> no official catalog entry required
```

## 14. Migration и proof gates

### D0 — Contracts and fixtures

- release record, artifact reference, install lock, catalog descriptor, inventory evidence, match rule
  and recommendation schemas;
- positive/negative fixtures and unknown-version behavior;
- no runtime code.

### D1 — Independent local artifact proof

- use the existing manifest v1/adapters; D1 must not wait for extension-manifest v2;
- move/copy one non-common extension into an isolated fixture repository/build;
- package immutable artifact;
- install manually into a clean generic host containing only common;
- load via installed catalog without authored main-repo registry edit;
- make the development bundler resolve `modkit.extensions.json#linked` roots outside the main
  workspace and prove source-build parity with the packaged artifact.

### D2 — Embedded application proof

- build one web component/specialized app with a pinned external browser-safe extension;
- generate lazy loader/SBOM/licenses;
- prove empty/common-only bundle does not import it.

### D3 — Read-only federated catalog

- static catalog with at least two publishers and two compatible providers;
- search/metadata/offline snapshot; no installation code execution;
- coordinate/integrity-conflict fixtures.

### D4 — Install planning and lock

- dry-run dependency/permission/license/size diff;
- direct artifact and catalog artifact installation;
- exact rollback/offline reproduction;
- operation provider lock remains unchanged until explicit project resolution.

### D5 — Product inventory recommendations

- one generic store/OS collector;
- declarative rules for at least two unrelated products;
- consent/redaction/explanation/manual fallback tests;
- browser reports facility unavailable without native bridge.

### D6 — External distribution security

- signatures/attestations, revocation, quarantine/rollback and private catalogs;
- only after a real external distribution channel and threat model exist.

## 15. Acceptance criteria

1. Fresh generic Modkit installation contains no game/vendor extension and remains useful with
   bundled common.
2. Independent extension artifact installs without source checkout or authored main-repo switch.
3. Catalog metadata and product matching execute no extension code.
4. Official, community, private and direct/local sources use the same release/install model.
5. Install lock reproduces exact artifact bytes offline and contains no credentials.
6. Operation provider lock, install lock and World composition lock remain separate.
7. Specialized app embeds/pins extensions without changing their contribution identities.
8. Web component works with an embedded minimal catalog and no general marketplace.
9. Generic inventory collector recommends two unrelated extensions through declarative rules without
   product-specific core code.
10. User can deny inventory permission and still search/install manually.
11. Every recommendation and rejected install plan has an explanation trace.
12. Root Modkit `generated/` contains only platform development/bundled-common outputs, not the
    global extension universe or user installed state.
13. Different catalogs publishing different bytes under one extension/version produce integrity
    conflict.
14. Catalog outage does not change installed project provider selection.
15. External repository/source URL remains provenance metadata, not contract or contribution
    identity.

## 16. Static-first federated catalog и именованные product profiles (уточнение 2026-08-12)

**Static-first.** Первая ступень дистрибуции — подписанный статический JSON-каталог в Git/HTTPS
(release records + ссылки на независимые repositories/releases), читаемый offline snapshot-ом.
Полноценный marketplace-сервис (поиск, ranking, reviews) — более поздняя ступень поверх той же
record model (§3.3/§5); D2-класс proofs выполняется на static-каталоге. Никакая ступень не меняет
инварианты: каталог не исполняет код, metadata не выдаёт permission.

**Dual publishing.** Один и тот же package публикуется как обычная npm-библиотека (direct-library
use) и как Modkit extension (release artifact в каталоге) — source layout один (27 §0.2,
package.json#modkit); отличается только канал доставки. Каталожная запись может ссылаться на npm
tarball как artifact URL при совпадении digests.

**Именованные product profiles (кандидаты).** Пользователь не видит «всю платформу»; профиль —
данные (bundled set + enabled features + UI набор), не форк кода:

| Profile                  | Состав (сверх platform+common)                                                         |
| ------------------------ | -------------------------------------------------------------------------------------- |
| SC2 Mod Studio           | starcraft-2 extension, authoring preset, GameData/Galaxy/Layout tools, SC2 help subset |
| C&C Mod Studio           | westwood/sage extensions, соответствующие tools                                        |
| Universal Asset Explorer | все common viewers, read-only, без authoring                                           |
| Headless Mod CI          | CLI/headless, validation+conversion+conformance, без UI                                |
| AI Modding Toolkit       | Headless Mod CI + agent adapters + knowledge packs (31)                                |
| Replay & Map Lab         | replay/map viewers + timeline + scene tools                                            |

Профиль ссылается на presets/extensions по координатам; физическое исключение UI/3D/LSP
доказывается bundle-тестами (S5/PR-15).
