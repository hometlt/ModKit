# 03. Providers and Resolution

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Виды providers

```text
CodecProvider       AssetInput -> AssetHandle
SubjectProvider     SubjectRef + Workspace -> SubjectHandle
SourceProvider      structured address -> ArtifactSource
VfsProvider         mount request -> hierarchical VfsMount
ProjectionProvider  traits/relations -> derived representation/subject
OperationProvider   operation request -> result/change set
LanguageProvider    document/workspace -> language features
ViewerProvider      subject capabilities -> viewer session
EditorProvider      editable capabilities -> editor session
ServiceProvider     compression/transcode/render/index services
RuntimeProvider     runtime input -> managed RuntimeSession
WorldProfileProvider versioned components/commands/events vocabulary
WorldSystemProvider world profile -> deterministic tick system
ScriptHostProvider  runtime IR/native script -> world imports and execution
UiRendererProvider  native/portable UI document -> UI runtime/view session
```

Они используют общие metadata и resolver policy, но не обязаны иметь один runtime
interface.

`ServiceProvider` — отдельный contribution type, а не новый `ProviderOfferKind`: contribution
описывает packaging/discovery reusable compute implementation, после activation она публикует
обычный `ProviderOffer` подходящего composition mode. В отличие от `CodecProvider`, service не
обязан иметь source identity, detection или пользовательскую transaction. Детали и пример LZMA
находятся в [14 §5.1](14-processing-and-codec-layering.md#51-service-provider-contribution).

Source/VFS providers могут переиспользовать identity/version/target primitives, но их mount/routing
catalog не объявляется частью operation resolver v1. Они не смешиваются с codec runtime interface.
Подробные contracts и security rules описаны в
[13-vfs-providers-and-sources.md](13-vfs-providers-and-sources.md).

World providers используют отдельные `WorldOffer`, linker и `WorldCompositionLock`: один root
runtime и множество profiles/systems/script/UI augmentations. Они не сводятся к asset `open()`
lifecycle или `ProviderOfferKind`. См.
[20-world-api-abi-and-multiverse-integration.md](20-world-api-abi-and-multiverse-integration.md).

Для World composition общий provider ranking не заменяет domain linking rules. Component
contracts deduplicate-ятся по ID/major/schema hash, definition overlays получают declared
linearization, cooperative systems проверяют read/write/order graph, а exclusive system slot
выбирает ровно одного provider. Install/directory order никогда не является tie-break.

## 2. Offer

Единственная normative-candidate normal form находится в
[23 §8](23-contract-identity-schema-resolution-and-lock.md#8-normative-candidate-provider-types-v1).
Offer относится к одному normalized runtime variant. Execution lifecycle/isolation принадлежит
activation host, а World profile/system — отдельному World composition protocol.

## 3. Request

Normative-candidate `ProviderRequest` также определён в [23 §8](23-contract-identity-schema-resolution-and-lock.md#8-normative-candidate-provider-types-v1).
Request задаёт `(contract, major, range)`, concrete target, operation/outputs/workload и optional exact
pin. Bounded source detection остаётся отдельным существующим codec matching stage; request не
переносит raw bytes/private handles.

## 4. Resolution algorithm

Staged v1 algorithm определён в [23 §9](23-contract-identity-schema-resolution-and-lock.md#9-resolution-algorithm-v1).
Он не является install/marketplace solver и не выполняет World system linking. Stable ordering
использует canonical UTF-8 byte order; для ASCII IDs обычное `a < b` эквивалентно, а
locale-dependent `localeCompare` остаётся только в UI.

## 5. Resolution result

Normative result имеет два состояния (`resolved`/`unresolved`) и typed `UnresolvedReason` из
[23 §8](23-contract-identity-schema-resolution-and-lock.md#8-normative-candidate-provider-types-v1).
Host UI может проецировать причины в richer states `installable`, `permission-required` или
`host-unavailable`, но они не создают второй resolver wire schema.

## 6. Dependency semantics

| Mode         | Значение                                                                              |
| ------------ | ------------------------------------------------------------------------------------- |
| `requires`   | Без provider основной contract не активируется                                        |
| `defaults`   | Provider выбирается по умолчанию в install plan, но пользователь может изменить выбор |
| `suggests`   | Видимая рекомендация, не устанавливаемая автоматически                                |
| `integrates` | Late-bound enhancement, если обе стороны уже активны                                  |
| `provides`   | Extension реализует virtual contract                                                  |
| `replaces`   | Совместимый successor/provider substitution                                           |
| `conflicts`  | Доказанная hard incompatibility                                                       |

Model preview для Unit — `integrates`, а XML parser для SC2 Data — `requires`.

## 7. M3 example

Subject relation:

```ts
{
  role: 'visual.primary-model',
  target: { kind: 'asset', path: 'Assets/Units/Marine.m3' },
  optional: true,
  expects: {
    all: [{ id: 'model.geometry' }],
    preferred: [
      { id: 'model.materials' },
      { id: 'model.animations' },
    ],
  },
}
```

После format detection host формирует request к provisional `org.modkitx.contracts/m3-open`. Unit provider не знает,
какая реализация будет выбрана. Отсутствие version означает любую совместимую
реализацию; logical choice появляется в provider-policy lock, exact target artifact — в install/
activation/session records.

## 8. Композиция providers по функциям

Resolver не назначает asset один глобальный codec implementation на весь lifetime.
Каждый contract, operation или derived representation разрешается отдельно:

| Задача для одного M3 asset | Возможный provider             |
| -------------------------- | ------------------------------ |
| Detection/metadata         | Лёгкий TypeScript provider     |
| Geometry/animation open    | Native или WASM provider       |
| Interactive preview        | WebGL/Three.js viewer provider |
| Headless thumbnail         | Headless renderer provider     |
| GLB export                 | Отдельный exporter             |
| Native round-trip edit     | Format-specific writer         |

Traits/representations, полученные от opener, в будущем могут дополняться projections других
providers. Read-only capabilities разрешено компоновать. Mutating providers обязаны
объявлять ownership редактируемых semantic/source regions:

```ts
type WriteOwnership =
  | { mode: 'exclusive'; regions: readonly string[] }
  | { mode: 'cooperative'; protocol: string; regions: readonly string[] }
```

Два writers с пересекающимся `exclusive` ownership не активируются одновременно.
Preview provider не получает write authority только потому, что умеет читать asset.

Extension не изменяет manifest или runtime другого extension. V1 стабилизирует replacement и named
operation offers. Следующая taxonomy становится исполнимой только после отдельного M3 proof:

| Mode         | Назначение                                                          |
| ------------ | ------------------------------------------------------------------- |
| replacement  | Независимая реализация того же contract, например Linux native port |
| augmentation | Потребляет public capability базового handle и добавляет данные/API |
| projection   | Создаёт standard/derived representation                             |
| operation    | Добавляет export/edit/analyze operation                             |

Viewer/editor/language/service являются catalog contribution categories, а не composition modes и
не добавляются в `ProviderOfferKind`.

До proof resolver возвращает `unsupported-kind` для `augmentation`/`projection`; general DAG не
входит в v1. M3 proof обязан определить explicit target contract, input/output representation,
ownership, conflict rule и deterministic order, не открывая неограниченную композицию автоматически.

Если augmenter требует format-specific intermediate state, этот state должен быть отдельной
versioned capability с объявленным transport profile. Private class/import исходного codec не
является допустимым integration contract. Детальная модель и ranking описаны в
[18-provider-augmentation-targets-and-ranking.md](18-provider-augmentation-targets-and-ranking.md).

## 9. Несколько уровней поддержки

Providers одного contract могут иметь profiles:

```text
inspect-only
geometry
geometry-materials
full-animation
full-effects
editable
```

Request указывает минимум. Более полный provider не получает автоматический приоритет:
лишние capabilities могут увеличивать startup/memory cost. Resolver учитывает preferred
outputs и operation intent, а обязательный минимум остаётся hard filter.

## 10. Portable provider-policy lock

Normative v1 fields принадлежат документу 23. Иллюстративная operation-provider запись:

```json
{
  "key": {
    "contract": "org.modkitx.contracts/m3-open",
    "major": 1,
    "normalizedRange": ">=1.0.0 <2.0.0",
    "operation": "model.preview",
    "requiredOutputs": ["model.geometry"],
    "preferredOutputs": ["model.animations", "model.materials"],
    "workload": "interactive"
  },
  "primary": {
    "extensionId": "community.example/m3",
    "providerId": "community.example/m3-reader",
    "providerMajor": 2,
    "contractMajor": 1
  },
  "allowedFallbacks": [],
  "resolverVersion": 1
}
```

Logical provider policy не меняется в активном workspace только из-за появления новой версии.
OS/architecture/runtime variant/tools/grants в эту запись не входят. Catalog/source provenance,
artifact release/digest/signature и dependency graph принадлежат target-scoped install lock; effective
variant — machine activation snapshot; exact deterministic composition — session envelope.

Lock создаётся отдельно для каждого resolved contract/operation. Поэтому один workspace
может закрепить native M3 opener, browser preview и TypeScript exporter одновременно.
Lock фиксирует exact values даже если исходный request использовал `*` или range.

## 11. Catalogs, installation и repositories

Operation resolver работает только с installed/embedded/approved providers. Он не запрашивает
remote catalogs и не устанавливает отсутствующую реализацию во время `resolveProvider()`. Полная
federated distribution model определена в
[28-extension-distribution-catalog-installation-and-product-discovery.md](28-extension-distribution-catalog-installation-and-product-discovery.md).

Отдельный catalog/install layer может предложить установку из:

- official catalog;
- approved community catalog;
- GitHub/GitLab release;
- private organization catalog;
- local extension bundle;
- development folder.

Generic Modkit по умолчанию содержит только bundled `common`; game/vendor/community extensions
публикуются из независимых repositories. Repository source не влияет на contract identity. Catalog
record, source provenance, artifact digest/signature и installed state являются отдельными planes.

При `provider.mode = 'require'` можно дополнительно зафиксировать `extensionId`, если
одинаковый provider contract реализован несколькими bundles. Catalog source не является
частью public contract identity, но сохраняется в install lock вместе с artifact digest/signature.
Два
разных источника, заявляющих один extension coordinate с разными bytes, считаются
integrity conflict, а не альтернативными версиями.

## 12. Provider activation

Lifecycle:

```text
discovered
  -> verified
  -> resolved
  -> activated
  -> healthy
  -> draining
  -> disposed

failure -> failed/disposed
repeated failure -> optionally quarantined by future host policy
```

Activation должна быть lazy. Manifest и catalog доступны без исполнения provider.

## 13. Cycles

Hard provider dependencies должны образовывать DAG. Cycle в `requires` является
ошибкой install plan.

`integrates` не создаёт activation order. Двусторонняя интеграция активируется
отдельным integration provider после готовности обеих сторон.

Пример:

```text
model provider integrates image provider
image provider integrates metadata viewer
```

Это не должно превращаться в dependency cycle.

## 14. Fallback

Fallback является explicit provider offer с более низким quality/priority:

```text
M3 full reader
M3 inspect-only reader
bounded hex/metadata fallback
raw binary fallback
```

Resolver не маскирует corrupt source выбором другого codec, если первый provider уже
структурно подтвердил формат и сообщил corruption. Fallback применяется только при
заявленной совместимости и корректной классификации ошибки.

## 15. Diagnostics

Обязательные stable codes:

```text
org.modkitx.core/provider-missing
org.modkitx.core/provider-ambiguous
org.modkitx.core/provider-version-incompatible
org.modkitx.core/provider-environment-incompatible
org.modkitx.core/provider-permission-required
org.modkitx.core/provider-external-tool-required
org.modkitx.core/provider-activation-failed
org.modkitx.core/provider-crashed
org.modkitx.core/provider-quarantined
org.modkitx.core/provider-conformance-failed
org.modkitx.core/provider-output-missing
org.modkitx.core/provider-selector-unsatisfied
org.modkitx.core/extension-integrity-conflict
org.modkitx.core/provider-target-incompatible
org.modkitx.core/provider-augmentation-cycle
org.modkitx.core/provider-write-ownership-conflict
org.modkitx.core/provider-preference-evidence-invalid
```

Diagnostic должен содержать request, rejected candidates и actionable hint. Эти codes не являются
`UnresolvedReason`: wire reason остаётся компактным закрытым enum документа 23, а diagnostic code —
qualified extension/core error identity. Mapping фиксируется validator fixture.

## 16. Determinism

При одинаковом input, catalog, policy и lock resolver обязан выбирать тот же provider.
Нельзя использовать filesystem enumeration order, package install order или display
name как tie-break. Resolver выполняется при создании session/operation plan и не является
частью hot path декодирования, rendering или simulation.
