# 16. Composite Assets and Origins

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **normative-candidate for AssetOrigin/AssetInput v1 only**

## 1. Решение

Asset не равен файлу и не обязан иметь один главный source. `ArtifactSource` остаётся
атомарным доступом к одному addressable содержимому, а `AssetOrigin` описывает, из чего
собран логический asset.

Поддерживаются четыре формы:

```text
single      один source
bundle      несколько именованных source bindings
namespace   VFS/content-store root без обязательного main file
derived     результат projection/conversion над другими subjects/assets
```

Форма origin не определяет capabilities. DDS и image+palette могут оба публиковать
`image.raster`; MPQ file и directory могут оба открыть один SC2Map subject.

## 2. Основные термины

| Термин           | Значение                                                                      |
| ---------------- | ----------------------------------------------------------------------------- |
| `ArtifactSource` | Один runtime handle: file, entry, directory, stream, range source, mount root |
| `SourceBinding`  | Именованная роль source внутри bundle                                         |
| `AssetOrigin`    | Serializable происхождение asset                                              |
| `AssetInput`     | Runtime-набор открываемых bindings/mount для codec                            |
| `InputPlan`      | Декларация codec о требуемых bindings после probe                             |
| `Relation`       | Ссылка на другой самостоятельный subject/asset                                |
| `AssetRevision`  | Revision vector/hash всех inputs, влияющих на semantic result                 |

Source, asset и subject имеют независимые identities. Path или имя primary file не
являются обязательной logical identity asset.

### 2.1 Reference types used by this contract

`SourceRef` и `SubjectRef` импортируются из
[25 §3](25-subject-identity-editing-transactions-and-cache.md#3-многоуровневая-subject-identity).
Остальные reference shapes принадлежат этому документу:

```ts
interface ArtifactSourceRef {
  readonly source: SourceRef
  readonly revision?: string
}

interface VfsMountRef {
  readonly source: SourceRef
  readonly mountId: string
  readonly revision?: string
}

interface OperationRef {
  readonly id: string
  readonly providerId?: string
  readonly providerVersion?: string
}

interface InputSearchScope {
  readonly kind:
    | 'siblings'
    | 'current-mount'
    | 'enclosing-container'
    | 'workspace-dependency-layer'
    | 'user-selection'
  readonly root?: SourceRef
}
```

Reference не содержит открытый handle, filesystem path с ambient authority или credential. Host
разрешает reference в runtime object после permission/budget checks.

## 3. Serializable origin

```ts
interface SourceBindingDescriptor {
  readonly id: string
  readonly role: string
  readonly source: ArtifactSourceRef
  readonly required: boolean
  readonly ownership: 'owned' | 'companion' | 'external'
  readonly revision?: string
  readonly mediaType?: string
}

type AssetOriginDescriptor =
  | {
      readonly kind: 'single'
      readonly binding: SourceBindingDescriptor
    }
  | {
      readonly kind: 'bundle'
      readonly bindings: readonly SourceBindingDescriptor[]
      readonly primary?: string
    }
  | {
      readonly kind: 'namespace'
      readonly mount: VfsMountRef
      readonly roots?: readonly string[]
      readonly revision?: string
    }
  | {
      readonly kind: 'derived'
      readonly inputs: readonly SubjectRef[]
      readonly recipe?: OperationRef
      readonly materialized?: ArtifactSourceRef
    }
```

`primary` — optional UX/writer hint. Он не должен:

- участвовать в type dispatch;
- быть единственным cache key;
- определять ownership остальных bindings;
- требоваться для namespace или derived asset;
- автоматически становиться target всех save operations.

## 4. Runtime input

Descriptor не содержит открытые file handles, streams или mounts. Их выдаёт runtime
`AssetInput`:

```ts
interface AssetInput {
  readonly origin: AssetOriginDescriptor

  openBinding(id: string, signal?: AbortSignal): Promise<ArtifactSource>

  openNamespace?(signal?: AbortSignal): Promise<VfsMount>
}
```

Host владеет resolved sources и закрывает их вместе с asset session. Codec не сохраняет
ambient filesystem paths и не выполняет самостоятельный global scan.

## 5. Типовые формы

| Пример                    | Origin                                            | Binding/relation policy                               |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| DDS                       | `single`                                          | Один owned source                                     |
| Indexed image + palette   | `bundle`                                          | `image` + required/optional `palette`                 |
| CUE + BIN tracks          | `bundle`                                          | CUE может быть primary; каждый required BIN — binding |
| Model + animation sidecar | `bundle`                                          | `model` + `animation` bindings                        |
| Model + shared textures   | Bundle для model sidecars; textures как relations | Shared texture не копируется в ownership model        |
| Blender file              | Обычно `single`                                   | Scenes, collections и objects — child subjects        |
| SC2Map directory          | `namespace`                                       | Mount root, virtual paths открываются лениво          |
| SC2Map MPQ                | `namespace`                                       | MPQ provider создаёт эквивалентный mount              |
| CASC installation         | `namespace`/content-store subject                 | Нет synthetic primary; entries — child sources        |
| Localization matrix       | `derived` workspace subject                       | Inputs — несколько locale catalog subjects            |
| Thumbnail/converted GLB   | `derived`                                         | Recipe, input revisions и providers в provenance      |

## 6. Input planning

Открытие составного asset проходит две стадии:

```text
candidate source
  -> bounded probe
  -> AssetInputPlan
  -> host resolves declared requirements
  -> complete AssetInput
  -> codec.open(input)
```

```ts
interface AssetInputRequirement {
  readonly id: string
  readonly role: string
  readonly cardinality: 'one' | 'zero-or-one' | 'one-or-more' | 'many'
  readonly required: boolean
  readonly ownership: 'owned' | 'companion' | 'external'
  readonly patterns?: readonly string[]
  readonly expected?: TraitQuery
  readonly scopes: readonly InputSearchScope[]
}

interface AssetInputPlan {
  readonly originKind: 'single' | 'bundle' | 'namespace'
  readonly primary?: string
  readonly requirements: readonly AssetInputRequirement[]
}
```

Patterns применяются только внутри объявленных scopes: sibling directory, current
mount, enclosing container, workspace dependency layer или explicit user selection.
Unbounded filesystem/content-store scan запрещён.

## 7. Binding или relation

Используется следующее правило:

| Вопрос                                                               | Если да | Представление                    |
| -------------------------------------------------------------------- | ------- | -------------------------------- |
| Без ресурса asset нельзя корректно идентифицировать/open/round-trip? | Да      | Required binding                 |
| Ресурс принадлежит asset и должен переноситься вместе с ним?         | Да      | Owned/companion binding          |
| Ресурс самостоятельный, shared или имеет свою identity?              | Да      | Typed relation                   |
| Ресурс физически вложен и имеет собственный формат?                  | Да      | Child source + `embeds` relation |
| Результат вычислен из нескольких subjects?                           | Да      | Derived origin                   |

Один ресурс может сначала обнаружиться через `CompanionSpec`, но после resolution host
materializes его как binding. `CompanionSpec` не является persisted asset model.

## 8. Identity и revisions

`AssetRevision` должен учитывать:

```text
origin kind
binding IDs/roles/revisions
namespace snapshot/root revision
relevant workspace dependency/locale state
codec/provider ID, version and runtime variant
open options that affect semantics
```

Порядок directory enumeration не влияет на identity. Bundle bindings canonicalized по
stable binding ID, а не по discovery order.

Перемещение всего bundle допускает сохранение logical subject ref, если host может
восстановить соответствие bindings. Изменение binding content создаёт новую revision,
но не обязательно новый subject ref.

## 9. Multi-source edits

Writer сначала возвращает plan:

```ts
interface CompositeAssetEditPlan extends AssetEditPlan {
  readonly baseRevision: AssetRevision
  readonly outputs: readonly AssetOriginDescriptor[]
}
```

Единственные `MutationMode`, `CommitGuarantee`, `TransactionStatus` и `TransactionReceipt`
определены в
[25 §9–11](25-subject-identity-editing-transactions-and-cache.md#9-mutation-mode-commit-guarantee-and-result-status).
Этот документ не вводит второй vocabulary.

Правила:

1. Нельзя скрывать изменение нескольких bindings за `source.save` одного primary.
2. Host проверяет base revision каждого binding перед commit.
3. `best-effort` требует explicit policy/confirmation и recovery report.
4. Read-only CASC может предлагать overlay/export, но не source write.
5. Archive rewrite создаёт новый container revision и инвалидирует child-source handles.
6. Cross-file language rename использует тот же transaction mechanism.

## 10. CASC и другие content stores

CASC удобнее моделировать двумя связанными уровнями:

```text
CASC installation/content store subject
  -> namespace VFS mount
  -> entries as ArtifactSource
  -> detected/opened child assets
```

Сам content store может иметь capabilities indexing/listing/resolution и diagnostics, но
не обязан притворяться архивным файлом. Concrete CASC implementation является VFS/source
provider extension. Semantic codecs SC2 работают поверх generic mounted namespace.

То же правило применимо к Git tree, remote API dataset, game installation и cloud
document workspace.

## 11. Model и document implications

Multi-source ownership не заменяет semantic representations:

- model bundle описывает physical inputs;
- native model document сохраняет format-specific данные;
- `RenderModel` является стандартной rendering projection;
- textures/animations могут быть bindings, embedded child assets или external relations;
- conversion report сообщает потери независимо от origin form.

Для documents аналогично: XLSX/BLEND может физически быть одним source, но публиковать
много child subjects; directory-based document может быть namespace; document с linked
media использует relations.

## 12. Инварианты

1. Asset не обязан иметь primary file.
2. Codec `open()` не выполняет global companion scan.
3. Namespace не materializes все entries для открытия root subject.
4. Required binding absence диагностируется до runtime parse, когда это возможно.
5. Shared external asset не становится owned binding автоматически.
6. Asset identity не равна source path.
7. Cache key учитывает весь revision vector.
8. Multi-source write всегда публикует mutation mode, commit guarantee и result status policy.
9. Child asset снова проходит generic detection/provider resolution.
10. Descriptor остаётся serializable; live sources/mounts существуют только в session.

## 13. Migration from current contracts

Текущий [`AssetSource`](../../packages/assets/src/source.ts) уже умеет представлять file,
directory, archive entry, VFS root и installation root. Проблема не в ширине source API,
а в cardinality: текущий [`AssetDescriptor`](../../packages/assets/src/descriptor.ts)
имеет одно поле `source`, а часть subject identity выводится из него.

Переход выполняется совместимо:

1. Любой legacy `descriptor.source` адаптируется в `origin.kind = 'single'`.
2. [`CompanionSpec`](../../packages/assets/src/companions.ts) становится источником
   `AssetInputPlan`, не persisted ownership model.
3. Codec runtime получает overload/adapter `open(AssetInput)`; single-file implementation
   продолжает получать свой единственный source через helper.
4. Subject identity перестаёт вычисляться из `source.id/name`; compatibility URI хранится
   как provenance alias.
5. Bundle/namespace codecs мигрируют первыми: CUE/BIN, palette formats, models с
   sidecars, SC2Map directory/MPQ и CASC.
6. После перехода consumers поле `AssetDescriptor.source` удаляется из следующей schema
   version; до этого оно может оставаться deprecated single-origin projection.

## 14. Acceptance criteria

- DDS открывается как `single` без дополнительной сложности для codec consumer.
- CUE/BIN и image/palette открываются независимо от того, какой component выбран первым.
- Model bundle различает owned animation sidecar и shared texture relation.
- SC2Map directory и MPQ дают semantic provider эквивалентный namespace contract.
- CASC открывается без fake main file и без полного eager listing.
- Derived preview сохраняет input/provider provenance.
- Stale binding блокирует transaction до частичной записи.
- Physically absent optional companion не ломает базовый asset.

## 15. Logical resource locators (candidate, BRIEF-5)

Path/URI недостаточно для CASC content keys, Unity GUID/fileID, Unreal object paths и bulk
partitions, Wwise media IDs, Blizzard SNO, archive entries и virtual/resolved game entities.
Locator — это найденное **в содержимом** ссылочное выражение, которое ещё предстоит разрешить в
`SubjectRef` ([25 §3](25-subject-identity-editing-transactions-and-cache.md)); он не является
второй формой subject identity.

```ts
interface ResourceLocatorRef {
  // R/P: serializable reference expression, contract-based, не закрытый enum игр
  readonly scheme: string // locator contract ID, например 'blizzard.casc/content-key'
  readonly schemeMajor: number
  readonly payload: JsonValue // opaque typed payload; schema принадлежит scheme owner
  readonly scope?: SubjectRef // containing subject/source, внутри которого ссылка имеет смысл
  readonly expectedTarget?: {
    readonly subjectKind?: string
    readonly formatId?: string
    readonly traits?: readonly string[]
  }
  readonly provenance?: string // где ссылка найдена (schema field, chunk, script)
}
```

Правила:

1. **Resolution — обычный provider путь.** Locator-resolver — это offer для contract
   `common.locator/<scheme>@<major>`; выбор/объяснение/ranking переиспользуют
   [23 §§8–9](23-contract-identity-schema-resolution-and-lock.md); никаких отдельных resolver
   механик. Результат различает `resolved | ambiguous | missing | permission-required |
dependency-required` — те же состояния, что у любого разрешения.
2. **Canonical serialization** — canonical-JSON тройка `(scheme, schemeMajor, payload)` плюс
   optional scope; round-trip обязан быть байт-стабильным. Нормализация payload разрешена только
   scheme owner-у: платформа не угадывает значение строки (никаких «похоже на GUID»).
3. **Scope ограничивает поиск.** Companion/resource discovery выполняется bounded-запросами
   `InputSearchScope` (§4) внутри объявленного scope; глобальный filesystem scan запрещён.
4. Ожидаемый target — подсказка для диагностики и ranking, не обещание: разрешение в subject с
   другим kind/format даёт diagnostic, не тихую подмену.

Nested-примеры, которые обязана покрыть fixture-матрица (PR-20): M3 → textures; SC2 Unit →
icon/model/strings/scripts; layout template → assets; Wwise BNK → WEM; Unreal package →
object/bulk data; Unity asset → GUID/fileID; CUE → tracks/BIN; model → отдельные
animation/palette/sidecars.
