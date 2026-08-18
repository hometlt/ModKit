# 30. Format definitions, ecosystems, corpora and unknown subjects

Status: **non-canonical candidate contracts (format-knowledge plane)**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Created: 2026-08-11 (BRIEF-5)

Этот документ владеет **format-knowledge plane**: machine-readable знанием о форматах,
экосистемах, их отношениях и corpus evidence — отдельно от executable codecs. Он также фиксирует
инвариант неизвестного subject. Он **не** повторяет чужие домены: subject identity принадлежит
[25](25-subject-identity-editing-transactions-and-cache.md), resolution/locks —
[23](23-contract-identity-schema-resolution-and-lock.md), security/key material —
[24](24-extension-security-execution-and-lifecycle.md), logical locators и companions —
[16](16-composite-assets-and-origins.md), pipeline layering —
[14](14-processing-and-codec-layering.md), distribution/catalog —
[28](28-extension-distribution-catalog-installation-and-product-discovery.md). Раздел 9 — карта
владельцев.

Ни один тип ниже не реализован. Все — candidate contracts до proof-слайсов PR-16…PR-24
(REPORT-5 §…). Формы записаны, чтобы их можно было опровергнуть фикстурой, а не чтобы объявить
платформу готовой.

## 1. Три разных вещи, которые сейчас называются «формат»

```text
format definition   != codec/provider implementation != runtime variant
format version/dialect != provider version           != extension release
format identity     != detected interpretation of one source
```

Сегодня знание о формате появляется только вместе с executable codec
(`codec.manifest.json#match/standards/references`) либо живёт в энциклопедии
(`modkitx.encyclopedia/v1`, YAML front matter) без контракта с платформой. Оба источника полезны и
оба недостаточны: manifest не существует без реализации, энциклопедия не имеет schema-владельца в
платформе. `FormatDefinition` закрывает разрыв: формат можно описать **до** существования provider,
и это описание не даёт никаких executable полномочий.

## 2. `FormatDefinition` (candidate, A/P)

```ts
interface FormatDefinition {
  readonly schemaVersion: 1
  /** Native format identity: `blizzard.m3`, `riff`, `wwise.bnk`. Same identity axis as S0. */
  readonly formatId: string
  readonly displayName: string
  readonly aliases?: readonly string[] // display only, never equality
  /** Candidate selectors, never proof of identity. */
  readonly extensions?: readonly string[]
  readonly mediaTypes?: readonly string[]
  readonly family?: string // 'riff', 'iso-bmff', 'ebml', 'opc', vendor family
  readonly dialect?: string // build- or fork-specific dialect id
  readonly profile?: string
  /** Version/build applicability of THIS knowledge record, not of any provider. */
  readonly versionConstraint?: string
  readonly sourceTopology: SourceTopology // owner: 05 §1.1
  readonly roles: readonly FormatRole[] // owner: 05 §1.1
  readonly artifactStages?: readonly ArtifactStage[] // owner: 05 §1.1
  /** Declarative evidence hints (magic bytes, structural markers) — data, not a detector. */
  readonly detectionHints?: readonly DetectionHint[]
  readonly ecosystems?: readonly EcosystemReference[]
  readonly relations?: readonly FormatRelationClaim[]
  /**
   * Knowledge claims about the vocabulary this format CAN carry. They shortlist and document;
   * they are not runtime offers and never satisfy a hard route (same rule as `may-expose`).
   */
  readonly vocabulary?: {
    readonly traits?: readonly string[]
    readonly operations?: readonly string[]
    readonly contracts?: readonly string[]
  }
  readonly references?: readonly FormatReference[] // spec links + license
  readonly provenance: KnowledgeProvenance
}

interface DetectionHint {
  readonly kind: 'magic' | 'structure' | 'companion' | 'path' | 'context'
  readonly description: string
  readonly bytes?: string // hex, for magic
  readonly offset?: number
}

interface FormatReference {
  readonly title: string
  readonly url?: string
  readonly license?: string
}
```

An augmentation may also target a Universal Verse profile rather than define a new native format.
It uses the same explicit owner-coordinate rule and declares a contract-typed contribution such as
`uv-format-extension`, with target format/profile, required contract major and the offered
schema/reader/writer/validator/renderer/editor/conversion operations. For example, the SC2 extension
may contribute the M3 preservation vocabulary for UVM. Such a contribution does not claim ownership
of UVM and does not make the base reader depend on SC2.

Правила:

1. Definition — data-only. Он не исполняется, не активируется, не выдаёт permissions и не
   участвует в install planning как executable unit.
2. `extensions`/`mediaTypes`/`detectionHints` — кандидаты для shortlist. Идентичность формата у
   одного source доказывает только structural probe исполняемого detector (v1 правило канона §5
   не меняется).
3. `vocabulary` — knowledge claim уровня `may-expose`: полезен для discovery, каталога и
   энциклопедических проекций; hard routing по нему запрещён.
4. `formatId` — та же ось native format identity, что и в S0 (`blizzard.m3`). Definition не
   создаёт вторую identity; он даёт этой identity машинную запись.

### 2.1 Ownership, augmentation и коллизии (уточнено BRIEF-6)

Ownership не зависит от discovery order и не решается «первым publisher» в каком-либо scope —
в федеративных каталогах такого порядка не существует.

- Владелец definition — это **explicit coordinate binding**: пара `formatId ↔ owning extension
coordinate`, зафиксированная публикацией definition в release record этого extension. Каталог
  может дополнительно связывать vendor-префиксы format IDs (`blizzard.*`) с publisher
  namespaces своей trust policy; это политика каталога, не платформенный порядок.
- Augmentation называет **точную owner-координату**:
  `augments: { formatId, owner: '<extension coordinate>' }` (все остальные поля optional, свой
  `provenance` обязателен). Augmentation никогда не переопределяет owner-поля молча.
- Два definitions одного `formatId` от разных coordinates без `augments` — это **competing
  definitions**, не merge и не гонка: каждый несёт своего владельца-координату, consumer/catalog
  строит merged view с provenance у каждого значения, конфликт виден как diagnostic, приоритет
  выбирает читатель по своей политике evidence classes (§6) и trust.
- Один и тот же `formatId` из одного coordinate дважды в одном catalog — collision diagnostic.

### 2.2 Physical placement и миграция v1

Кандидат: `definitions/formats/<id>/format.json` внутри extension tree; contribution kind
`format-definition` в manifest v2 (владелец envelope —
[27 §6](27-final-target-tree-extension-manifest-and-format-catalog.md)). Папка не заменяет
контракт: definition без валидной schema-записи — просто файл.

Миграция без flag day: генератор выводит скелет `FormatDefinition` из существующих
`codec.manifest.json` (`match` → detectionHints/extensions, `standards`/`references` → references,
`kind`+`sourceKinds` → roles/topology draft) и из encyclopedia records
(`modkitx.encyclopedia/v1`: category/family/scope/extensions/engines/middleware →
соответствующие поля). Оба источника остаются рабочими; definition становится единственным
платформенным носителем формата-знания только после PR-17.

### 2.3 Связь с энциклопедией

Энциклопедия — сегодняшний prose+YAML предшественник и **stress corpus** (§8), а не второй
владелец. Направление данных:

```text
encyclopedia record (modkitx.encyclopedia/v1)  ──migration/generator──►  FormatDefinition
FormatDefinition + codec manifests             ──generated projection──►  encyclopedia views, codecs/ compat view
```

`codecs/` view энциклопедии уже объявлен generated compatibility view — это правило сохраняется.

## 3. `EcosystemReference` (candidate, A/P)

Один тип с ролью, не три:

```ts
interface EcosystemReference {
  readonly kind: 'engine' | 'middleware' | 'content-platform'
  readonly id: string // 'spring-engine', 'wwise', 'steam'
  readonly releaseConstraint?: string // build/version range this claim applies to
  readonly profiles?: readonly string[]
  readonly evidence?: string // free-form provenance note or corpus/evidence id
}
```

Обоснование одного типа: у всех трёх ролей одинаковый wire shape (id + release constraint +
profiles + evidence); три типа утроили бы schema без различий на проводе. Consumer фильтрует по
`kind`.

Правила:

- Формат/игра может нести **несколько** references (engine + N middleware + content-platform).
- Fork/lineage/game-specific fork — не поля reference, а отношения между ecosystem definitions
  (`forked-from`, `lineage`), когда ecosystem получает собственную definition-запись.
  Build-sensitive dialect выражается парой `FormatDefinition.dialect` +
  `EcosystemReference.releaseConstraint`.
- Физический `definitions/ecosystems/<id>/` оправдан только когда второй publisher реально
  дополняет чужую ecosystem-запись; до этого достаточно schema field. Не создавать каталог ради
  классификации.
- **Терминология (нормативная для этого plane):** `content-platform` — магазин/дистрибуция
  (Steam, Battle.net, itch); **runtime target** — OS/architecture/environment
  (`windows/x64/node`), владелец — существующий `RuntimeTargetConstraint`
  ([23 §8](23-contract-identity-schema-resolution-and-lock.md)). Слово «platform» без
  квалификатора в новых контрактах не используется. Encyclopedia `platforms/` (pc/macos/…)
  сегодня смешивает обе оси — маппинг при миграции: OS-значения → runtime target, store-значения
  → `content-platform`.

## 4. `FormatRelationClaim` (candidate, A/P)

Отношения **форматов** — не runtime `SubjectRelation`
([25 §13](25-subject-identity-editing-transactions-and-cache.md) владеет relation record между
subjects; сравнение — [04 §3](04-subjects-relations-projections.md)).

```ts
type FormatRelationKind =
  | 'profile-of'
  | 'variant-of'
  | 'uses-framing'
  | 'container-of'
  | 'derived-from'
  | 'supersedes'
  | 'superseded-by'
  | 'compatible-with'
  | 'embeds'
  | 'carries-stream'

interface FormatRelationClaim {
  readonly kind: FormatRelationKind
  readonly target: string // formatId
  readonly versionConstraint?: string
  readonly provenance: KnowledgeProvenance
}
```

Направление задаёт `kind` (`supersedes`/`superseded-by` — взаимно обратные записи; писать
достаточно одну, merged view достраивает обратную). Исторический relation не записывается как
факт без provenance.

Framing reuse без giant codec: `riff`, `iso-bmff`, `ebml`, `opc` — самостоятельные
`FormatDefinition` с ролью `container` и relation/contract framing semantics; `wav`, `avi` объявляют `uses-framing: riff`,
`mp4` — `uses-framing: iso-bmff`, `docx/xlsx/pptx` — `uses-framing: opc`. Structural
parser такого framing — declarative/service tier (§7), которым пользуются многие semantic
codecs через contract; сам framing не становится семантическим кодеком каждого формата.

## 5. Неизвестный формат как полноценный subject

### 5.1 Инвариант (accepted basis Q83; proof pending PR-16/A-7)

Для формата № N+1, которого никто не предвидел:

1. source открывается без codec;
2. получает стабильный source-root `SubjectRef` (владелец —
   [25 §3](25-subject-identity-editing-transactions-and-cache.md): root = `<source-uri>`,
   `identity.key == ''`; **формат в root identity не входит**), observed `content.binary` и
   host-owned byte-range data source;
3. detection evidence, unresolved/ambiguous candidate set и diagnostics — persisted state этого
   subject, не одноразовый вывод;
4. subject участвует в bookmarks, relations, automation и project state наравне с известными;
5. установка совместимого codec добавляет тому же root новую interpretation/projection, не меняя
   существующие ссылки;
6. удаление codec возвращает degraded unknown state без потери identity;
7. конкурирующие interpretations сосуществуют; выбор персистится только там, где он реально нужен
   (Open With pin, provider-policy lock entry с subject scope), — не глобально.

Unknown path не моделируется фиктивным universal `binary` codec. Raw subject, byte-range handler и
fallback принадлежат host; `view.hex` объявляется только когда handler доступен и не выводится из
`content.binary` автоматически. `common/plain-text` является обычной optional interpretation того
же root subject, а не владельцем binary fallback.

### 5.2 Interpretation и representation refs (candidate, R/P)

```ts
interface InterpretationRef {
  readonly subject: SubjectRef // owner: 25
  readonly formatId?: string // owner: этот документ; absent = unknown
  readonly codecId?: string // selected provider, если есть
  readonly confidence: number
  readonly evidence: readonly DetectionEvidence[] // существующий v1 тип
}

interface RepresentationRef {
  readonly interpretation: InterpretationRef
  readonly representation: string // output representation axis, owner: 01 §13
}
```

Current fact (не target): v1 `AssetIdentity` требует выбранные `pluginId`/`formatId`
(packages/assets/src/descriptor.ts:62–74), а `subjectOf()` подставляет `formatId` в display-kind
(descriptor.ts:255–263). Это проекция, не identity — root `SubjectRef` из 25 §3 формата не
содержит, поэтому цель достижима adapter-ом без смены identity grammar. Persistence и
reclassification semantics принадлежат 25; здесь — только связка interpretation ↔ formatId.

## 6. `KnowledgeProvenance` и `CorpusEvidenceManifest`

### 6.1 Evidence classes

```ts
type KnowledgeProvenanceClass =
  | 'official-spec'
  | 'published-reverse-engineering'
  | 'clean-room'
  | 'corpus-inferred'
  | 'implementation-observed'

interface KnowledgeProvenance {
  readonly class: KnowledgeProvenanceClass
  readonly references?: readonly string[] // FormatReference/corpus ids
}
```

Это классы происхождения знания, **не** гарантии законности, качества или trust. Provenance
никогда не является автоматическим trust elevation (правило 24 §2 действует).

### 6.2 `CorpusEvidenceManifest` (candidate, G/P)

```ts
interface CorpusEvidenceManifest {
  readonly corpusId: string
  readonly version: string
  readonly digest: string // digest of the hash-only inventory
  readonly itemCount: number
  /** Hash-only inventory: per-item content hashes + derivation policy. Никаких proprietary bytes. */
  readonly inventoryPolicy: 'hash-only'
  readonly sourceClass: KnowledgeProvenanceClass
  readonly coverage: {
    readonly representative?: number
    readonly edge?: number
    readonly malformed?: number
    readonly unsupported?: number
    readonly builds?: readonly string[]
    readonly runtimeTargets?: readonly string[]
  }
  readonly legal: {
    readonly license?: string
    readonly redistribution: 'public' | 'private' | 'local-only'
  }
  readonly generatedBy: { readonly tool: string; readonly version: string }
  /** Claims/operations/traits, которые этот corpus подтверждает. */
  readonly evidenceLinks?: readonly string[]
}
```

Результаты прогонов по corpus: `positive | negative | partial | unknown | unsupported` —
отрицательный и частичный результат такие же first-class, как положительный.

**Шесть осей инвалидации** evidence-записи (единый список; REPORT-4 §13.4 исправлен под него):
extension release, provider, contract version, target class, dependency set digest, corpus
digest. Изменение любой оси делает evidence несоответствующим выбранному offer.

## 7. Пять tiers codec-реализаций (сводка; execution semantics — 24)

| Tier | Что это                                       | Trust/activation                                                                         | Conformance                       |
| ---- | --------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| 1    | Data-only format/association definition (§2)  | Не исполняется; читается каталогом                                                       | schema + collision rules          |
| 2    | Declarative detector/schema/structural parser | Bounded interpreter платформы; без ambient authority                                     | fixtures против объявленных hints |
| 3    | Portable TypeScript/WASM provider             | Budgeted worker где возможно ([24 §5](24-extension-security-execution-and-lifecycle.md)) | direct-library + minimal-host     |
| 4    | Worker/native/external-tool/remote provider   | Explicit install + capability approval; broker                                           | + per-target evidence             |
| 5    | Game-semantic resolver/runtime bridge         | Как 3/4 + content resolver contracts                                                     | + semantic fixtures               |

Декларативная запись (tier 1–2) не может маскировать исполняемый код: у tier 1 нет entrypoint
вообще; tier 2 исполняется интерпретатором платформы по bounded schema, не своим модулем.
Исполняемый provider (3–5) остаётся independently testable без Modkit workbench
(Proposal 29 §6.9).

## 8. Encyclopedia stress profile (candidate schema)

Энциклопедия используется как машинно проверяемый набор контрпримеров, не как backlog
реализации. Из каждой записи выводится `FormatStressProfile`:

```ts
interface FormatStressProfile {
  readonly encyclopediaId: string
  readonly axes: {
    readonly topology: FormatDefinition['sourceTopology']
    readonly framingChain?: readonly string[] // nested container/framing/transform ids
    readonly compression?: readonly string[]
    readonly encryption?: { readonly algorithm?: string; readonly keyMaterial: boolean }
    readonly ecosystems?: readonly EcosystemReference[]
    readonly dialectConstraints?: readonly string[]
    readonly locatorKinds?: readonly string[] // 16 §… locator contract ids
    readonly vocabulary?: FormatDefinition['vocabulary']
    readonly partialSupport?: readonly string[] // feature-scoped provider split
    readonly projections?: readonly string[] // native/neutral
    readonly writeback?: 'none' | 'export-only' | 'round-trip'
    readonly corpus?: 'public' | 'private' | 'local-only' | 'absent'
    readonly hostRestrictions?: readonly string[]
  }
  /** Может ли каждый axis быть выражен public contracts без core PR. */
  readonly expressibility: Readonly<Record<string, 'expressible' | 'gap' | 'unknown'>>
}
```

Замыкание в обе стороны:

```text
format/extension manifests -> generated encyclopedia/catalog projections
encyclopedia entry -> stress profile -> expressibility/conformance result
```

Команды **не существует**; целевая — `pnpm formats:stress --check` рядом с
`scripts/validate-encyclopedia.ts` (соответствующий implementation task в REPORT-5). Текущий
валидатор энциклопедии: `pnpm exec tsx scripts/validate-encyclopedia.ts` (235 записей на
2026-08-11; npm-скрипта нет).

## 9. Карта владельцев (что живёт НЕ здесь)

| Материал                                                    | Владелец                                                                      | Что добавлено в этом проходе  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| Subject identity, unknown-root persistence/reclassification | [25](25-subject-identity-editing-transactions-and-cache.md)                   | §5.1 unknown-root persistence |
| Logical resource locators, companion discovery              | [16](16-composite-assets-and-origins.md)                                      | §13 locator contract          |
| Key material, secret lifecycle, permission mapping          | [24](24-extension-security-execution-and-lifecycle.md)                        | §12.1 key material            |
| Encryption/transform layering                               | [14](14-processing-and-codec-layering.md)                                     | §2 distinction note           |
| Provider resolution/locks                                   | [23](23-contract-identity-schema-resolution-and-lock.md)                      | — (переиспользуется)          |
| Manifest v2 envelope + new contribution kinds               | [27](27-final-target-tree-extension-manifest-and-format-catalog.md)           | §6 candidate kinds            |
| Catalog/distribution knowledge flow                         | [28](28-extension-distribution-catalog-installation-and-product-discovery.md) | — (переиспользуется)          |
| Acceptance proofs                                           | [10](10-acceptance-and-conformance.md)                                        | stress-profile proof          |
| Adopted-changes journal                                     | [29](29-three-reports-reconciliation-and-adopted-changes.md)                  | post-REPORT-4 addendum        |

Promotion map: все контракты этого документа — candidate до PR-16 (unknown root), PR-17 (format
definition + два provider/dialect), PR-18 (key material), PR-19 (corpus invalidation), PR-20
(locators), PR-22 (stress conformance). До их зелёного состояния в canonical docs не переносится
ничего, кроме терминологии `content-platform`/`runtime target`, если владелец решит принять её
раньше.
