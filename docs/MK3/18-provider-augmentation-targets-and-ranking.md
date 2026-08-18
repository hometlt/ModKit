# 18. Provider Augmentation, Runtime Targets, and Ranking

Status: **non-canonical design draft**  
Canonical: [Modkit Target Architecture](../architecture/MODKIT_ARCHITECTURE.md)  
Normative: **no; see README ownership map for normative-candidate sections**

## 1. Решение

Один format/contract может обслуживаться несколькими extensions и runtime implementations.
Resolver выбирает provider не «для файла навсегда», а для конкретного contract или named operation.
V1 стабилизирует `primary`/`replacement` и named operations. General augmentation/projection DAG
остаётся deferred; он не является обязательной возможностью resolver v1.

Три правила являются обязательными:

1. OS/architecture/ABI/features являются target constraints, а не versions.
2. Extension расширяет другое extension через public offers/contracts, а не mutation/import
   private implementation.
3. Предпочтение native/WASM/TypeScript зависит от required outputs, host и operation intent,
   а не от глобального порядка технологий.

## 2. Независимые coordinates

| Coordinate                   | ID/example                                        | Version/range          | Назначение                                                                |
| ---------------------------- | ------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| contract                     | provisional `org.modkitx.contracts/m3-open`       | `^1.2` или `*` request | Spec/conformance-owner API; native format identity отдельно `blizzard.m3` |
| extension                    | `vendor/m3-native`                                | `2.4.1` exact          | Install/update/trust unit                                                 |
| provider                     | `vendor/m3-parser`                                | `3.1.0` exact          | Implementation identity                                                   |
| runtime variant              | `linux-x64-gnu-native`                            | provider-owned         | Конкретный entrypoint/artifact                                            |
| runtime target               | Node/Linux/x64/gnu                                | не version             | Host compatibility                                                        |
| project provider-policy lock | Request class + logical provider majors/fallbacks | portable policy        | Cross-host intent                                                         |

Нельзя сравнивать provider version с contract version или считать Linux port новой contract
version только из-за другой платформы.

## 3. Runtime target

Concrete `RuntimeTarget` request и `RuntimeTargetConstraint` offer определены только в
[23 §8](23-contract-identity-schema-resolution-and-lock.md#8-normative-candidate-provider-types-v1).
Они являются адаптерами существующих `CodecRuntimeTarget`/`CodecRuntimeVariant`, а не новым
параллельным manifest vocabulary.

Common values стандартизируются core catalog. Дополнительные ABI/features используют
qualified namespaced IDs, поэтому новый GPU API, WASM proposal или native ABI не требует
немедленно расширять closed enum core.

Примеры targets:

```text
browser-worker / wasm32 / SIMD
node-worker / windows / x64 / napi-9
node-worker / linux / x64 / gnu
native / linux / arm64 / musl
browser-main / WebGPU
```

## 4. Provider offer normal form

Extension manifest может группировать несколько variants, но scope-local embedded/installed
generated runtime catalog создаёт
отдельный normalized offer для каждой target-specific реализации:

Единственная normative-candidate normal form определена в
[23 §8](23-contract-identity-schema-resolution-and-lock.md#8-normative-candidate-provider-types-v1).

Normalized offer упрощает lock, diagnostics и deterministic selection: resolver работает с
реальными candidates, а не с объединённой «суммой возможностей» несовместимых variants.

## 5. Способы расширения и v1 boundary

| Вид offer      | Что делает                                    | Пример                             |
| -------------- | --------------------------------------------- | ---------------------------------- |
| `primary`      | Основная реализация contract                  | TypeScript M3 parser               |
| `replacement`  | Та же семантика, другая implementation/target | Linux native M3 parser             |
| `augmentation` | Добавляет capability к уже открытому handle   | M3 animation decoder               |
| `projection`   | Создаёт derived standard representation       | Model → thumbnail                  |
| `operation`    | Добавляет действие                            | GLB export или advanced validation |
| `contribution` | Добавляет UI/language surface                 | Alternative model viewer           |

Replacement provider не требует базовый provider. Augmentation provider, напротив,
объявляет `augments`/`requires` и активируется только после появления подходящего contract/trait.
Строки `augmentation`/`projection` выше описывают целевую taxonomy, но operation resolver v1 возвращает
для них `unsupported-kind`. Первый допустимый promotion — отдельный M3 animation proof с explicit
target contract, input/output representation, ownership, conflict rule и deterministic order. Он не
создаёт general augmentation DAG автоматически.

World `profile/component/resource/system/script-host/render-extractor/definition-adapter` являются
отдельными `WorldOfferKind` и разрешаются World linker, не asset operation resolver. См.
[26 §9](26-world-state-scheduler-snapshots-and-domains.md#9-systems-и-phases).

## 6. M3 composition example

```text
org.example/m3-typescript
  provides org.modkitx.contracts/m3-open
  targets browser/node, any OS
  outputs m3.document, model.geometry, model.materials

org.example/m3-native-windows
  provides org.modkitx.contracts/m3-open
  targets node-worker/windows/x64/napi
  outputs m3.document, model.geometry, model.materials, model.animations

community/m3-native-linux
  provides org.modkitx.contracts/m3-open
  targets node-worker/linux/x64/gnu
  outputs m3.document, model.geometry, model.materials, model.animations

community/m3-advanced-animations
  kind augmentation
  consumes m3.document
  provides model.animations, scene.effects

community/m3-headless-preview
  offer kind projection
  packaged as projection contribution
  consumes model.geometry + model.materials
  provides content.thumbnails
```

Base extension ничего не знает о later extensions. После установки augmenter host заново
строит provider composition plan для новой session; открытый handle не monkey-patched in place.

Для World runtime `profile`, `system` и `binding` offers компилируются до старта session.
Один root runtime владеет state/tick; augmenter обязан объявить component schemas,
read/write sets, phase/order и snapshot/hash policy. Dynamic system injection в работающий
tick loop запрещён. Подробности приведены в
[20-world-api-abi-and-multiverse-integration.md](20-world-api-abi-and-multiverse-integration.md).

## 7. Public intermediate contract

Augmentation безопасна только поверх стабильного public contract:

```ts
interface M3DocumentApi {
  readonly revision: string
  sections(query?: M3SectionQuery): AsyncIterable<M3SectionDescriptor>
  openSection(id: string): Promise<ReadonlyByteSource>
}
```

Definition должна объявить:

- owner/namespace;
- exact version и compatibility rules;
- transport profile: in-process, structured clone, RPC handle, stream/transferable;
- lifetime/cancellation;
- immutable/mutable semantics;
- conformance fixtures.

Private TypeScript class, undocumented object layout или direct import provider package не
являются integration contract. Если подходящего public intermediate нет, independent provider
может повторно открыть `AssetInput`, но обязан сообщить дополнительную стоимость.

## 8. Composition plan

Resolver строит bounded DAG:

```text
primary/replacement opener
  -> native capabilities
  -> zero or more explicit augmentations/projections
  -> operation/viewer contributions
```

Правила:

1. Все hard `consumes` должны быть удовлетворены до activation.
2. Cycles в required augmentation graph являются ошибкой.
3. Optional projections не блокируют native handle.
4. Read capabilities можно объединять по definition merge policy.
5. Mutating providers объявляют exclusive/cooperative write ownership.
6. Provider не может заменить уже выбранную capability silently после открытия session.
7. Изменение provider plan требует close/reopen affected handles.
8. Generic unbounded transform search не используется; разрешаются только explicit offers и
   зарегистрированные projection paths с depth/budget limits.

## 9. Operation intent

```ts
interface OperationIntent {
  readonly profile:
    | 'interactive'
    | 'batch'
    | 'low-latency'
    | 'low-memory'
    | 'best-quality'
    | 'portable'
    | 'sandboxed'
    | 'deterministic'

  readonly workload?: {
    readonly itemCount?: number
    readonly estimatedInputBytes?: number
    readonly expectedReuseCount?: number
  }

  readonly prefer?: readonly (
    | 'low-startup-cost'
    | 'high-throughput'
    | 'low-memory'
    | 'native'
    | 'wasm'
    | 'portable'
    | 'isolated'
  )[]
}
```

Пример: TypeScript parser может выиграть при одном маленьком interactive preview из-за
нулевой startup cost. Native provider может выиграть в batch conversion. WASM может быть
единственным portable high-throughput вариантом для browser worker.

## 10. Preference evidence

Provider не может получить абсолютный приоритет только self-declared числом:

```ts
interface ProviderPreferenceEvidence {
  readonly startupCost?: 'low' | 'medium' | 'high'
  readonly memoryClass?: 'low' | 'medium' | 'high'
  readonly throughputClass?: 'low' | 'medium' | 'high'
  readonly qualityProfiles?: readonly string[]
  readonly isolation?: 'in-process' | 'worker' | 'process' | 'sandboxed-wasm'
  readonly evidence?: readonly EvidenceRef[]
}
```

Self-declared classes являются hints. Сильнее них:

1. compatible project provider-policy lock;
2. explicit user/workspace policy;
3. conformance results;
4. host-maintained benchmark history на том же target/workload class;
5. signed/reference evidence;
6. deterministic stable tie-break.

Host benchmark не меняет logical provider policy silently. Он влияет только на machine activation
в пределах разрешённых logical providers либо на explicit policy update review.

## 11. Resolution order

```text
contract/version
  -> exact selector/lock compatibility
  -> runtime target compatibility
  -> trust/permissions/tools
  -> required outputs/operations
  -> bounded detection
  -> conformance
  -> user/workspace preference
  -> operation intent/workload evidence
  -> deterministic ambiguity/tie policy
```

Native implementation никогда не обходит missing required output. Если native parser не
предоставляет animations, request может выбрать richer portable provider или составить native
base + compatible animation augmenter.

## 12. Locks and activation

Portable project provider-policy lock хранит logical choice без OS/architecture/runtime variant,
tools, grants или artifact hash:

```json
{
  "contract": "org.modkitx.contracts/m3-open",
  "contractMajor": 1,
  "extension": "community/m3-native-linux",
  "provider": "community/m3-parser",
  "providerMajor": 3,
  "allowedFallbacks": ["org.modkitx/m3-typescript@2"]
}
```

Install lock отдельно фиксирует acquired target artifacts/digests. Machine activation snapshot
выбирает variant/facilities/tools/grants. Deterministic session composition отдельно фиксирует exact
semantic composition/content и необходимые artifact attestations. После M3 augmentation proof его
consumed providers входят в session composition, а не превращают portable policy в machine lock.

## 13. Current-code migration

Текущий [`CodecRuntimeVariant`](../../packages/assets/src/codec-manifest.ts) уже содержит
environment, OS, architecture, host/Web API requirements, permissions и capabilities.
[`selectCodecRuntimeVariants`](../../packages/assets/src/codec-manifest.ts) корректно
фильтрует target compatibility.

Пробелы текущего пути:

- selection возвращает compatible variant IDs и union claims, но не operation-specific plan;
- [`matchCodecRegistry`](../../packages/assets/src/codec-matching.ts) ранжирует detection
  confidence, coordinate и variant ID, но не workload/performance evidence;
- `provides: string[]` не выражает augmentation inputs/outputs/target/conformance;
- runtime registry paths, где provider выбирается exact ID, мигрируют на общий resolver.

Переход выполняется через normalized generated offers и compatibility adapters без изменения
существующих codec implementations на первом этапе.

Текущий codec/game contribution coordinate `org.modkitx/<id>` не наследуется заново из grouped
extension publisher. V2 catalog хранит independent contribution/provider ID и owning extension ID
отдельно. Иначе schema-only migration меняет coordinate tie-break и результат resolution. Любое
намеренное переименование получает migration map, resolver version bump и отдельный lock review.

## 14. Acceptance criteria

- Windows native, Linux native, WASM и TypeScript providers реализуют один contract без
  platform hardcode в consumer.
- Linux port поставляется другим extension и выбирается по target автоматически.
- Independent animation augmenter добавляет capability без изменения base extension.
- Removing augmenter возвращает base capabilities без ошибки открытия asset.
- Interactive small input и batch workload могут выбрать разные providers по policy.
- Native provider не выигрывает при missing required capability или denied permission.
- User pin и project provider-policy lock сильнее benchmark preference.
- Augmentation cycles и write ownership conflicts диагностируются deterministically.
- Resolver не вызывается внутри decoder/render/runtime hot loop после session plan creation.
- V1/v2 catalog adapters сохраняют coordinate-based tie-break при пяти shuffled discovery orders.
