# 25. Subject Identity, Editing, Transactions, and Cache

Status: **non-canonical design draft**  
Canonical: [`../architecture/MODKIT_ARCHITECTURE.md`](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **normative-candidate for SubjectRef/editing v1 only**  
Updated: 2026-08-10

Этот документ уточняет stable subject identity, revisions composite assets, nested editing,
transactions, undo/concurrency, relation indexes и cache invalidation. Он развивает
[04-subjects-relations-projections.md](04-subjects-relations-projections.md) и
[16-composite-assets-and-origins.md](16-composite-assets-and-origins.md).

## 1. Решение

Subject identity не равна path или content hash. Codec/source использует native ID или stable
semantic key; workspace identity map отслеживает rename/move там, где source не предоставляет
identity. Revision отделена от identity. Nested subject редактируется через owner asset transaction,
а не притворяется отдельным writable file.

```text
stable SubjectRef
    + current revision vector
    ↓
typed EditPlan
    ↓ optimistic validation
transaction coordinator
    ↓
commit/rollback receipt
    ↓
targeted index/cache invalidation
```

## 2. Identity, location и revision

Это разные понятия:

| Понятие  | Пример                                        |
| -------- | --------------------------------------------- |
| Identity | SC2 Unit `Marine`, UI template declaration ID |
| Location | XML source range, VFS path, archive entry     |
| Revision | Git object, ETag, file revision, content hash |

Rename меняет location, edit меняет revision, но ни одно действие автоматически не меняет identity.

## 3. Многоуровневая subject identity

Codec/source выбирает stable `key` в порядке:

1. Native stable ID из формата/schema.
2. Stable semantic key, определённый codec.
3. Source-owned stable entry/object identity.
4. Workspace identity map для rename/move.
5. Content/signature matching только как диагностический fallback.

```ts
/** Identity-only projection of the existing AssetSourceDescriptor. */
interface SourceRef {
  readonly id: string
  readonly parent?: SourceRef
}

interface SubjectIdentity {
  readonly kind: string // namespaced subject kind
  readonly key: string // '' means the asset/root subject itself
}

interface SubjectRef {
  readonly workspace?: string
  readonly source: SourceRef
  readonly identity: SubjectIdentity
}
```

Связанные opaque-but-serializable refs, используемые ниже, имеют одну форму:

```ts
interface RevisionRef {
  readonly kind:
    | 'content-hash'
    | 'git-object'
    | 'etag'
    | 'database-version'
    | 'provider-token'
    | 'overlay-generation'
  readonly value: string
  readonly algorithm?: string
}

type AssetRef = SubjectRef
type SemanticPath = readonly (string | number)[]

interface ProviderRef {
  readonly id: string
  readonly version: string
  readonly runtimeVariant?: string
}
```

`RevisionRef.value` является opaque внутри выбранного `kind`; сравнение разных kinds не даёт
эквивалентность автоматически. Persistent `RevisionId` — lossless canonical projection
`<kind>[.<algorithm>]:<pct(value)>` with uppercase percent escapes; it is not a second equality
plane. `AssetRef` является type alias, потому что asset — это subject с origin, а не отдельная
identity hierarchy.

`SourceRef` переиспользует `AssetSourceDescriptor.id/parent`; `providerId`, path metadata и
`versionToken` намеренно не входят в identity projection. Source provider выбирается через source
registry/lock и может меняться без смены SubjectRef.

Равенство сравнивает `workspace`, рекурсивную цепочку `source.id`, `identity.kind` и `identity.key`.
Revision намеренно не помещается в identity DTO. Когда consumer должен закрепить состояние, он
использует отдельный `SubjectSnapshotRef`/revision vector; это не создаёт две формы равенства
`SubjectRef`.

Canonical URI serialization:

```text
x3-subject:<encoded JSON tuple>               canonical lossless form
<safe-source-uri>                             compact root form, key == ''
<safe-source-uri>#<pct(kind)>/<pct(key)>      compact nested form
modkit-derived:<operation-id>/<inputs-hash>   reserved future derived address
```

The versioned `x3-subject:` tuple carries workspace, the complete recursive source-parent chain,
kind and key. Compact form is permitted only when it round-trips injectively: source IDs containing
`#`, beginning with the reserved prefix, or carrying workspace/parent context use the extended
form. Nested kinds are qualified IDs and nested keys are non-empty. Parse followed by serialize
must reproduce the canonical input exactly.

Примеры:

| Subject            | Serialized ref                                                                |
| ------------------ | ----------------------------------------------------------------------------- |
| DDS file           | `file:///c:/mods/x.dds`                                                       |
| SC2 Unit           | `modkit-vfs://ws/#blizzard.sc2%2Funit/Marine`                                 |
| SC2Layout template | `modkit-vfs://ws/UI/Main.SC2Layout#blizzard.sc2%2Fui-template/GameUI%2FPanel` |
| Excel sheet        | `file:///c:/docs/x.xlsx#common.table%2Fsheet/Sheet1`                          |

Rename/move меняет source locator; workspace identity map создаёт подтверждённый redirect/alias.
Без доказательства rename старый ref становится stale/ambiguous, а не silently переназначается.
Workspace-backed files используют `modkit-vfs://<workspace>/<path>` вместо absolute `file://`, чтобы
ref переживал clone/перенос workspace. Archive repack меняет revision tokens, не entry identity, если
source provider способен восстановить тот же logical entry.

## 4. Identity map

Workspace identity map нужен только там, где native/semantic identity недостаточна. Он хранит:

- stable workspace key;
- previous/current source locator;
- evidence rename/move;
- codec/identity strategy version;
- last confirmed revision;
- ambiguous/conflict state.

Он не записывает UUID внутрь пользовательского asset без разрешения формата/пользователя.

Git rename heuristic или content matching не превращается в silently authoritative identity: при
неоднозначности создаётся diagnostic/resolution choice.

Контракт identity map принадлежит browser-safe subject boundary в `@modkitx/assets`; persistent
implementation принадлежит workspace host/`mod-workspace`, потому что только он владеет mount,
workspace lifecycle и storage. Подтверждённый VFS rename/move event может создать alias. Git rename
является дополнительным evidence. Одинаковый content hash без source event остаётся диагностикой и
не создаёт authoritative redirect автоматически.

## 5. Nested subjects

Nested subject independently addressable, но owner остаётся asset/document/database:

```text
SC2Mod asset
    Unit subject

SC2Layout document asset
    template subject
    frame subject

XLSX asset
    sheet subject
    table subject
```

Nested ref содержит owner identity и semantic path/key. Runtime UI instance или materialized game
entity не становится persisted nested subject автоматически.

## 6. Revision vector (target after the first editing consumer)

Composite asset не сводится к одному `mtime`:

```ts
interface AssetRevision {
  readonly bindings: Readonly<Record<string, RevisionRef>>
  readonly namespaceRevision?: RevisionRef
  readonly compositionFingerprint: string
}

interface SubjectSnapshotRef {
  readonly subject: SubjectRef
  readonly revision: AssetRevision
}
```

RevisionRef может ссылаться на:

- content hash;
- Git object ID;
- HTTP ETag/version;
- database transaction/version;
- VFS provider opaque token;
- archive directory/entry revision;
- workspace overlay generation.

`compositionFingerprint` учитывает binding selection/input plan, а не только bytes.

## 7. Subject edit target (gated with the first editing consumer)

```ts
interface SubjectEditTarget {
  readonly subject: SubjectRef
  readonly ownerAsset: AssetRef
  readonly semanticPath: SemanticPath
  readonly expectedRevision: AssetRevision
}
```

Редактирование Unit/template/sheet создаёт changes owner asset. Оно не мутирует private parser object
за transaction boundary.

## 8. Edit plan

Target расширяет существующий `AssetEditPlan` и мигрирует `AssetEditTransaction`, а не вводит
параллельную иерархию patch types. Эти поля не добавляются раньше первого реального host consumer:

```ts
interface AssetEditPlan {
  readonly edits: readonly SourceEdit[]
  readonly diagnostics: readonly AssetDiagnostic[]
  readonly preservesUnknownData: boolean
  readonly semantics: TransactionSemantics
  readonly expectedRevisions?: Readonly<Record<string, string>> // sourceId -> versionToken
}

interface AssetEditTransaction {
  readonly plans: readonly AssetEditPlan[]
  validate(): Promise<void>
}

interface AssetEditCommitHost {
  commit(transaction: AssetEditTransaction): Promise<TransactionReceipt>
}
```

Existing `SourceEdit` уже покрывает raw-preserving text/binary/create/delete/rename. Structured/VFS/
provider-native plans добавляются только после реального codec proof и не обязаны сводиться к JSON
Patch. `AssetRevision` остаётся richer target model; первый optimistic-concurrency proof использует
уже существующий `AssetSourceDescriptor.versionToken`.

Сегодня девять SC2 transaction factories имеют тесты, но ни один production consumer в `apps/` не
выполняет их как полный save pipeline; большинство `apply()` только материализуют prepared outputs.
Поэтому writer ownership фиксируется явно: codec строит/валидирует plans, а host commit coordinator
повторно проверяет revisions, получает permission grants и выполняет VFS/filesystem writes. Текущий
`apply()` мигрирует только вместе с первым end-to-end consumer и не считается commit boundary.

Editor создаёт semantic change/plan, но не владеет сохранением. Existing `SourceEdit.range + bytes`
уже покрывает binary-region patches, поэтому generic `edit.binary-range` не вводится. Одна
конкретная semantic operation может вернуть несколько plans; атомарность/rollback принадлежат
transaction semantics, поэтому пустой generic `edit.batch` также не вводится.

## 9. Mutation mode, commit guarantee, and result status

Режим изменения и гарантия фиксации являются независимыми осями:

```ts
type MutationMode = 'read-only' | 'export-only' | 'mutate'

type CommitGuarantee =
  | 'atomic' // одна неделимая фиксация
  | 'transactional' // prepare/commit/rollback, partial state не наблюдается
  | 'recoverable' // journal/staging восстанавливает возможный partial state
  | 'best-effort' // partial failure возможен и явно сообщается

type TransactionSemantics =
  | { readonly mutationMode: 'read-only' }
  | {
      readonly mutationMode: 'export-only' | 'mutate'
      readonly commitGuarantee: CommitGuarantee
    }

type TransactionStatus = 'committed' | 'partially-applied' | 'rolled-back' | 'not-applied'
```

Export одного нового файла может быть atomic, поэтому `read-only`/`export-only` не входят в шкалу
commit guarantees. Необратимость также не является commit guarantee: она выражается отдельным
`UndoGuarantee` в receipt. При миграции legacy mutating plan без declaration безопасный default —
`{ mutationMode: 'mutate', commitGuarantee: 'best-effort' }`.

Coordinator выполняет:

1. Собрать read/write set.
2. Проверить current revisions и permissions.
3. Проверить cross-provider/backend composition.
4. Подготовить staging/journal.
5. Непосредственно перед первым side effect повторно проверить revisions, затем применить writes в
   declared order.
6. Commit либо rollback/recovery.
7. Сформировать transaction receipt.
8. Обновить revisions/indexes/caches.

Операция с недостаточной гарантией требует explicit confirmation/policy, а не притворяется atomic.

## 10. Multi-owner edits

Если operation затрагивает sources разных owners/backends, coordinator определяет общий максимум
только для `CommitGuarantee`; multi-source/multi-backend operation никогда не объявляет `atomic` без
одной реально атомарной backend transaction. `MutationMode` комбинируется отдельно: `mutate`
доминирует над `export-only`, а `export-only` над `read-only`. Двухфазный commit используется только
для providers, которые его поддерживают. Иначе plan явно получает `recoverable`/`best-effort` и
recovery instructions.

Пример model edit:

```text
model.m3        structured/native patch
animation.m3a   binary patch
texture.dds     replacement
metadata.json   text patch
```

Каждый binding имеет expected revision и независимый write result.

## 11. Undo and redo

Receipt объявляет guarantee:

```ts
type UndoGuarantee = 'inverse' | 'snapshot' | 'replay' | 'none'

interface TransactionReceipt {
  readonly transactionId: string
  readonly mutationMode: MutationMode
  readonly commitGuarantee?: CommitGuarantee // absent only for read-only
  readonly status: TransactionStatus
  readonly undo: UndoGuarantee
  readonly before: Readonly<Record<string, string>>
  readonly after: Readonly<Record<string, string>>
  readonly outputs?: readonly AssetOutput[]
  readonly recovery?: { readonly kind: 'journal' | 'staging'; readonly ref: string }
}
```

`partially-applied` обязан иметь recovery/diagnostics и не является success. `rolled-back` означает,
что side effects происходили, но coordinator восстановил наблюдаемое состояние; `not-applied` — что
commit не начался. Boolean `applied` недостаточен для этой разницы.

- `inverse`: exact inverse patch;
- `snapshot`: staged ranges/files/objects;
- `replay`: deterministic command-log reconstruction;
- `none`: irreversible action, explicit confirmation required.

Redo повторно валидирует revisions и не является blind write.

## 12. Optimistic concurrency

Edit plan привязан к expected revisions:

```text
read revision A
    ↓ build plan
commit checks A
    ├── current A -> apply
    └── changed B -> conflict
```

Conflict provider может предложить:

- rebase text/binary ranges;
- schema-aware merge;
- three-way merge;
- regenerate plan from semantic intent;
- conflict subject для manual resolution;
- exclusive lease для inherently non-mergeable operation.

`last write wins` не является default.

## 13. Relation index

Relations вычисляются lazy и materialize по revisions:

```ts
interface RelationRecord {
  readonly source: SubjectRef
  readonly target: SubjectReference
  readonly relation: string // provider-native word/path, например WeaponArray.0.Link
  readonly semanticRole?: string // optional common role, например visual.icon
  readonly provider: ProviderRef
  readonly sourceRevision: RevisionRef
  readonly targetRevisionHint?: RevisionRef
  readonly evidence?: SemanticLocation
}
```

Это единственный normative-candidate serializable relation shape в Proposal. `relation` сохраняет
provider-native field/path/edge kind и не обязан входить в core enum. `semanticRole` является
optional общей проекцией (`visual.icon`, `dependency.required` и т. п.). Overview documents 01/04
не определяют параллельный `kind + role` DTO.

Index edge хранит provenance/provider/schema strategy. При изменении зависимой revision edge
помечается stale и пересчитывается по запросу/background budget.

Full eager graph всего CASC/repository не является обязательным startup step.

## 14. Cache identity

Derived cache key включает:

```text
input revision/content identity
input composition fingerprint
provider ID + version
contract ID + major
operation ID
normalized options
runtime target
dependency revisions
provider composition/session fingerprint
```

Semantic schema fingerprint добавляется в key только после отдельного canonicalization proof из
документа 23; он не является вычислимым обязательным полем cache v1.

Используется tiered caching: дешёвые revision tokens для быстрого lookup, content hash при
необходимости доказать exact content. Credential values не входят в key.

## 15. Invalidation

Изменение одной binding не обязано сбрасывать весь asset cache. Projection/provider объявляет
dependency set:

```text
M3 geometry preview -> model binding
M3 textured preview -> model + texture bindings
animation timeline -> animation binding
Unit card title -> localization + Unit definition
```

Невозможность точно определить dependency приводит к conservative invalidation, не stale result.

## 16. Examples

### SC2 Unit

- identity: catalog/entity ID;
- owner: resolved mod workspace/data source set;
- revision: contributing XML/string/schema revisions;
- edit target: unflattened owning definition/source;
- relations: model/icon/weapon/ability/localization;
- write: raw-preserving/schema-aware operation.

### SC2Layout template

- identity: document owner + declaration semantic ID;
- location: current source range;
- revision: text snapshot/document revision;
- edit: text/structured plan owner document;
- preview cache: template + includes + assets + fixture/context revisions.

### CASC namespace

- asset origin: namespace;
- entry subjects: provider-stable entry identity where available;
- revision: namespace/build plus entry tokens;
- default mode: read-only unless a writer/patch bundle provider supplies transaction guarantee.

## 17. Инварианты

1. Identity не равна path/revision.
2. Rename не создаёт новый subject без evidence of semantic replacement.
3. Nested subject не становится fake writable file.
4. Plan не применяется при stale required revision без merge/rebuild.
5. Provider private mutable object не пересекает transaction boundary.
6. Partial write не возвращается как success.
7. Undo guarantee объявлена до confirmation.
8. Relation/cache result имеет revision/provenance.
9. Secrets не входят в plan/receipt/cache.
10. Flattened/derived representation не выбирается write owner без explicit reversible mapping.

## 18. Acceptance criteria

- Rename file/template сохраняет SubjectRef либо выдаёт explicit ambiguity diagnostic.
- Edit nested template изменяет owner document одной transaction.
- Изменение одной bundle binding инвалидирует только зависящие projections, где dependency известна.
- Concurrent stale plan отклоняется до write.
- Text-preserving edit сохраняет unrelated source formatting.
- Multi-source failure возвращает rollback/recovery receipt и не скрывает partial state.
- Relation index удаляет/обновляет stale edges по revision.
- Cache key меняется при provider/schema/options/dependency revision change.
- Irreversible operation требует explicit confirmation и не обещает undo.

## 19. Следующие шаги

1. Зафиксировать serializable `SubjectRef`/`SourceRef` без revision и отдельную snapshot/revision
   schema.
2. Реализовать identity strategies для обычного file, SC2 entity и SC2Layout template.
3. Подключить одну реальную VS Code save command как первый consumer и назначить host commit owner.
4. Вместе с consumer ввести `MutationMode`, `CommitGuarantee`, `TransactionStatus` и revision
   double-check перед write.
5. Добавить filesystem atomic/recoverable transaction adapter.
6. Добавить nested SC2Layout и SC2 Unit raw-preserving vertical proofs.
7. Реализовать revision-aware relation/cache invalidation с `relation`/`semanticRole`.
8. Только затем добавлять generic multi-backend two-phase coordination.

## 20. Unknown source-root subject: persistence и reclassification (candidate, BRIEF-5)

Инвариант неизвестного формата (полный список —
[30 §5](30-format-definitions-ecosystems-corpora-and-unknown-subjects.md)) опирается на §3: root
subject = `<source-uri>` с `identity.key == ''`, и **формат никогда не входит в root identity**.
Отсюда:

1. Source без единого совместимого codec — полноценный persistent subject: он несёт
   `content.binary`, detection evidence, ambiguous candidate set и diagnostics как состояние, а
   не как одноразовый вывод; участвует в bookmarks/relations/automation/project state.
2. Установка codec **добавляет** interpretation (`InterpretationRef`, 30 §5.2) тому же root;
   существующие `SubjectRef` не меняются и не переписываются. Удаление codec возвращает degraded
   unknown state; identity и накопленные relations сохраняются.
3. Reclassification (другая выбранная interpretation) — это смена selection, не смена identity;
   pin сохраняется как subject-scoped запись в provider-policy lock
   ([23 §11](23-contract-identity-schema-resolution-and-lock.md)) только там, где выбор
   действительно нужен.
4. Nested subjects, созданные interpretation (`#kind/key`), живут и умирают со своей
   interpretation; их refs становятся stale/ambiguous по правилам §3, а не молча переназначаются
   на другую interpretation.

Current fact: v1 `AssetIdentity` требует выбранный `pluginId`/`formatId`
(packages/assets/src/descriptor.ts:62–74), а `subjectOf()` копирует `formatId` в display-kind.
Это projection-слой; adapter выполняет цель без изменения identity grammar. Proof — PR-16.
