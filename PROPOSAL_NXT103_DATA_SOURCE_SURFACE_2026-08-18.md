# NXT‑103‑P — proposal: method surface как authority contract‑definition (data plane)

Статус: **proposal only** (review data для Root). Не wire authority: production‑схема, TS‑типы, таблица
стандартных surfaces и drift‑гейты приземляются Root‑ом в `packages/sdk` (ROOT‑03B). Автор: Fable,
2026‑08‑18. Потребитель: capability‑RPC core (`packages/host/src/execution/*`, NXT‑105) через порт
`SurfaceRegistry`; текущий Electron‑allowlist `apps/electron/electron/main.cjs#DATA_SOURCE_METHODS`
и `REMOTE_VALUE_METHODS` — то, что этот документ делает ненужным (review F‑01/F‑02, D‑7).

## 0. Что решается

Сегодня «какие методы у `common.view/text-data-source@1` и что они возвращают» знают только TS‑интерфейс
в `sdk` (не читается без исполнения) и ручной allowlist в приложении. RPC‑прокси и любой транспорт
должны выводить method surface **из contract definition** — иначе новый data‑source контракт (открытый
registry, A‑33/A‑39) не проходит границу без правки host/app. Surface — это _данные_ о контракте:
имя метода, вид результата, где идёт `AbortSignal`, обязателен ли метод, какие схемы у аргументов/
результата и какие лимиты. Никакой исполняемой authority он не даёт.

## 1. Виды методов (kind) и что они означают на границе

| kind       | Возвращает на ABI                                                                   | На границе                                            | Освобождение                                                   |
| ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| `value`    | JSON‑данные, `bigint`, `Uint8Array` (в т.ч. вложенный, напр. `RasterRegion.pixels`) | копия/transfer, один `return`                         | нет                                                            |
| `lease`    | `Lease<T>` (`{value, release}`) **или** bare capability object                      | handle kind `lease` с surface `result`                | `release` frame; каскад к детям; для bare — через `releaseVia` |
| `iterable` | `AsyncIterable<T>` (pull)                                                           | handle kind `iterator`; `next` → `return`/`done`      | `release`/`return()`                                           |
| `events`   | `AsyncIterable<T>` (push, живой поток)                                              | handle kind `events`; `subscribe` → `event…` → `done` | `unsubscribe` + `release`                                      |

Правила: `lease` обязан назвать `result` (surface результата) и `wrapper` (`'lease'` → на consumer
материализуется `{value, release}`; `'bare'` → сам объект, чей `releaseVia` метод освобождает handle);
остальные kinds `result` не имеют. `signal: 'last'` — исполняющая сторона добавляет `AbortSignal` последним
аргументом (отмена приходит `cancel` frame'ом); `'none'` (default) — метод не отменяем изнутри, но
caller всё равно может отменить ожидание. `optional: true` — метод может отсутствовать у конкретной
реализации (ABI‑`?`‑методы: `readRegion?`, `readPcm?`, `readFrame?`, `primitive?`); см. §5 п.1.

## 2. Schema‑фрагмент (JSON Schema 2020‑12) — расширение data‑source arm `contract-definition-spec.v1`

```jsonc
// $defs/dataSourceSurfaceV1 — новое optional поле `surface` в data-source arm
{
  "type": "object",
  "additionalProperties": false,
  "required": ["methods"],
  "properties": {
    "releaseVia": { "type": "string", "pattern": "^[a-z][a-zA-Z0-9]{0,63}$" },
    "methods": {
      "type": "object",
      "minProperties": 1,
      "propertyNames": { "pattern": "^[a-z][a-zA-Z0-9]{0,63}$" },
      "additionalProperties": {
        "type": "object",
        "additionalProperties": false,
        "required": ["kind"],
        "properties": {
          "kind": { "enum": ["value", "lease", "iterable", "events"] },
          "signal": { "enum": ["last", "none"] },
          "optional": { "type": "boolean" },
          "wrapper": { "enum": ["lease", "bare"] },
          "result": {
            "type": "object",
            "additionalProperties": false,
            "required": ["contract", "major"],
            "properties": {
              "contract": { "$ref": "#/$defs/qualifiedId" },
              "major": { "type": "integer", "minimum": 0 },
            },
          },
          "args": { "type": "array", "items": { "$ref": "#/$defs/jsonSchemaRef" }, "maxItems": 16 },
          "returns": { "$ref": "#/$defs/jsonSchemaRef" },
          "limits": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "maxPageItems": { "type": "integer", "minimum": 1 },
              "maxBytes": { "type": "integer", "minimum": 0 },
              "maxStringLength": { "type": "integer", "minimum": 0 },
            },
          },
        },
        "allOf": [
          {
            "if": { "properties": { "kind": { "const": "lease" } } },
            "then": { "required": ["result"] },
          },
          {
            "if": { "not": { "properties": { "kind": { "const": "lease" } } } },
            "then": { "not": { "required": ["result"] } },
          },
          {
            "if": { "not": { "properties": { "kind": { "const": "lease" } } } },
            "then": { "not": { "required": ["wrapper"] } },
          },
        ],
      },
    },
  },
}
```

`args` — по позициям **без** trailing `signal`; `returns` — схема значения (для `iterable`/`events` — схема
элемента). `jsonSchemaRef` — тот же artifact‑bound `$ref`, что уже используется в spec'ах (проходит
существующие schema‑gates и packed‑proof). Отсутствие `args`/`returns` = «валидируется только как
bounded wire value» (текущий уровень RPC‑core), присутствие — Ajv‑валидация на обеих сторонах.

## 3. TS shape (sdk, Root)

```ts
export type DataSourceMethodKindV1 = 'value' | 'lease' | 'iterable' | 'events'
export interface DataSourceMethodSurfaceV1 {
  readonly kind: DataSourceMethodKindV1
  readonly signal?: 'last' | 'none'
  readonly optional?: boolean
  readonly wrapper?: 'lease' | 'bare'
  readonly result?: { readonly contract: ContractId; readonly major: number }
  readonly args?: readonly JsonSchemaRef[]
  readonly returns?: JsonSchemaRef
  readonly limits?: {
    readonly maxPageItems?: number
    readonly maxBytes?: number
    readonly maxStringLength?: number
  }
}
export interface DataSourceSurfaceV1 {
  readonly methods: Readonly<Record<string, DataSourceMethodSurfaceV1>>
  readonly releaseVia?: string
}
// DataSourceContractDefinitionSpecV1Wire gets `readonly surface?: DataSourceSurfaceV1`
```

**Drift‑гейт, который стоит добавить сразу:** имена методов стандартной surface пришпиливаются к
ABI‑интерфейсу типом — `STANDARD_DATA_SOURCE_SURFACES['common.view/text-data-source'] satisfies
{ methods: Record<keyof TextDataSource, DataSourceMethodSurfaceV1> }` (для optional‑методов —
`Partial<>` + `optional: true`). Тогда добавить метод в интерфейс и забыть про surface — не
скомпилируется.

## 4. Таблица 13 стандартных surfaces (review data, не production)

Источник — текущие TS‑интерфейсы `packages/sdk/src/asset-capabilities/{data-sources,media-data-sources}.ts`.
`sig` = `signal:'last'`. Все — `major 1`.

| contract                             | method       | kind         | sig | optional | примечание                                                                    |
| ------------------------------------ | ------------ | ------------ | --- | -------- | ----------------------------------------------------------------------------- |
| `common.view/text-data-source`       | `info`       | value        |     |          |                                                                               |
|                                      | `slice`      | value        | ✓   |          | `TextSliceRequest → TextSlice`                                                |
|                                      | `search`     | iterable     | ✓   |          | items `SourceSpan`                                                            |
| `common.view/byte-range-source`      | `size`       | value        |     |          | `bigint`                                                                      |
|                                      | `read`       | value        | ✓   |          | args `(bigint, number)` → `Uint8Array`; `limits.maxBytes` = budget            |
| `common.view/tree-data-source`       | `root`       | value        |     |          |                                                                               |
|                                      | `children`   | value        | ✓   |          | `Page<TreeNodeRef>`, `limits.maxPageItems`                                    |
|                                      | `facts`      | value        |     |          |                                                                               |
|                                      | `search`     | iterable     | ✓   |          |                                                                               |
| `common.view/table-data-source`      | `shape`      | value        |     |          |                                                                               |
|                                      | `rows`       | value        | ✓   |          | `Page<Row>`                                                                   |
|                                      | `cell`       | value        |     |          |                                                                               |
|                                      | `search`     | iterable     | ✓   |          | items `CellCoord`                                                             |
| `common.view/transport-source`       | `snapshot`   | value        | ✓   |          |                                                                               |
|                                      | `events`     | events       | ✓   |          | заменяет snapshot‑only IPC (NXT‑401)                                          |
| `common.view/namespace-entry-source` | `list`       | value        | ✓   |          | `Page<NamespaceEntry>`                                                        |
|                                      | `openEntry`  | lease        | ✓   |          | `Lease<AssetSourceRef>` — **лизинг данных**, см. §5 п.2                       |
| `common.view/raster-image-source`    | `info`       | value        | ✓   |          |                                                                               |
|                                      | `encoded`    | lease (bare) | ✓   |          | result `common.view/encoded-media@1` (§5 п.3)                                 |
|                                      | `readRegion` | value        | ✓   | ✓        | `RasterRegion` c вложенным `Uint8Array pixels`; `limits.maxBytes`             |
| `common.view/vector-scene-source`    | `info`       | value        | ✓   |          |                                                                               |
|                                      | `document`   | value        | ✓   |          |                                                                               |
| `common.view/audio-media-source`     | `info`       | value        | ✓   |          |                                                                               |
|                                      | `encoded`    | lease (bare) | ✓   |          | args `(trackId?)`; result `common.view/encoded-media@1`                       |
|                                      | `readPcm`    | value        | ✓   | ✓        |                                                                               |
| `common.view/video-media-source`     | `info`       | value        | ✓   |          |                                                                               |
|                                      | `encoded`    | lease (bare) | ✓   |          |                                                                               |
|                                      | `readFrame`  | value        | ✓   | ✓        |                                                                               |
| `common.view/model-scene-source`     | `info`       | value        | ✓   |          |                                                                               |
|                                      | `nodes`      | value        | ✓   |          | `Page<ModelNode>`                                                             |
|                                      | `meshes`     | value        | ✓   |          | `Page<ModelMesh>`                                                             |
|                                      | `primitive`  | value        | ✓   | ✓        | args `(primitiveId, ModelPrimitiveRequest)`; `limits.maxBytes`                |
| `common.view/relation-graph-source`  | `summary`    | value        | ✓   |          |                                                                               |
|                                      | `nodes`      | value        | ✓   |          | `Page<…>`                                                                     |
|                                      | `edges`      | value        | ✓   |          | `Page<…>`                                                                     |
| `common.view/subject-facts-source`   | `summary`    | value        | ✓   |          |                                                                               |
|                                      | `groups`     | value        | ✓   |          |                                                                               |
|                                      | `facts`      | value        | ✓   |          | args `(groupId, PageRequest)`                                                 |
|                                      | `relations`  | value        | ✓   |          |                                                                               |
| _aux_ `common.view/encoded-media`    | `descriptor` | value        |     |          | вспомогательный объект `EncodedMediaSource`, не data‑source контракт (§5 п.3) |
|                                      | `read`       | value        | ✓   |          | `(bigint, number) → Uint8Array`                                               |

Сверка с сегодняшним `DATA_SOURCE_METHODS` в `main.cjs`: полностью покрывает его 13 записей и
`REMOTE_VALUE_METHODS.encoded`; `search` там материализуется ≤1000 элементов — здесь становится
настоящим `iterable`; `transport-source.events` там отсутствует — здесь `events`.

## 5. Открытые пункты (решения Root/owner до приземления)

1. **Optional‑методы и materialize.** ABI различает «метод отсутствует» (`readRegion?`) от «метод есть».
   Materialized proxy сегодня всегда определяет метод (executing side отвечает
   `x3.host/rpc-method-unavailable`). Чтобы consumer видел `undefined`, handle‑ref lease‑результата
   должен нести присутствие optional‑методов. Предложение (protocol v1.1, обратно совместимо):
   `HandleRef['@x3.handle'].has?: readonly string[]` — только для методов с `optional: true`;
   consumer не определяет отсутствующие. Альтернатива — метод `capabilities()` у каждого источника —
   хуже (лишний round‑trip, второй словарь).
2. **`openEntry(): Lease<AssetSourceRef>` — лизинг данных, а не capability.** У RPC‑core `lease` =
   handle на объект с методами; лизинг plain‑значения не смоделирован. Варианты: (а) объявить kind
   `value` с результатом `{ ref: AssetSourceRef, lease: HandleRef }` — уродливо; (б) ввести kind
   `leasedValue`: на wire `return { value, lease: HandleRef }` (handle без surface, только release);
   (в) переопределить `openEntry` в ABI как `lease` capability `common.view/entry-source@1` c методом
   `ref()`. Рекомендация — (в) при следующем ABI‑patch (владелец A‑1 ABI — Root), до этого — (б) как
   protocol‑only расширение.
3. **`EncodedMediaSource` — вспомогательный объект без собственного контракта.** Нужен surface‑id.
   Предложение: `common.view/encoded-media@1` как contract‑definition kind `data-source`
   (data‑only, без registry‑offer'ов), либо явный список aux‑surfaces в `sdk`. Первое чище: тот же
   механизм, никаких исключений в host.
4. **`iterable` и стоимость pull‑per‑item.** `search` через `next` на каждый элемент — корректно, но
   дороже IPC‑батча. Предложение v1.1: `limits.batch` → executing side отвечает `return {items: […]}`
   (протокол получает `nextBatch`). Не блокирует v1.
5. **Где живут ABI‑surfaces (module/codec/session/provider/operation‑session).** Это не data‑source
   контракты и не публичные данные — host‑internal набор (`packages/host/src/execution/abi-surfaces.ts`,
   Root), пришпиленный тем же `satisfies keyof …` к runtime‑ABI интерфейсам `sdk`. RPC‑core их не
   содержит.
6. **Adapter в host.** `DataSourceSurfaceV1 → CapabilitySurface` (порт NXT‑105): 1:1 по полям + `validateArgs`/
   `validateReturn` из `args`/`returns` через существующий `validateWithSchema` (Ajv, precompiled) и
   `limits`. Файл Root: `packages/host/src/execution/surface-adapter.ts`.

## 6. Что это меняет для NXT‑105 (уже реализовано и совместимо)

`CapabilitySurface`/`MethodSurface` в `packages/host/src/execution/surface.ts` — прямой образ этого
proposal'а (kind, `signal`, `wrapper`, `result`, `releaseVia`, `validateArgs`/`validateReturn`
как функции). Отсутствуют только `optional`/`has` (п.1) и `limits`‑как‑данные (п.6 — заменяются
функциями‑валидаторами). Никаких стандартных данных RPC‑core не содержит и не должен содержать.
