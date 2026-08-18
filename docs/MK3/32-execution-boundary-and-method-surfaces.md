# Execution boundary: capability‑RPC, method surfaces и worker backend

Status: **normative‑candidate**, принято 2026‑08‑18 (лаборатория modkitX3; Root = Fable по решению
владельца). Источник истины по поведению — код и тесты, перечисленные в §9; этот документ описывает
модель и решения, а не пересказывает реализацию.  
Applies to: `modkitX3/packages/host/src/execution/**`, `packages/host/src/node/worker-*.ts`,
`packages/sdk` (contract‑definition `surface`, стандартные data‑source surfaces),
`packages/testkit/src/capability-rpc/**`, `packages/testkit/fixtures/hostile-worker/**`.  
Related: документ 02 (vocabulary), 23 (contract identity/schema), 24 (security/execution, лестница
SB‑0…SB‑5), 27 (envelope/target tree), 10 (acceptance), ADR‑HOST‑001.

## 1. Решение

1. **Одна граница исполнения — один протокол.** Всё, что host отдаёт extension‑коду за границу
   (worker thread, helper process, Electron renderer/preload, browser worker) и что extension‑код
   возвращает host‑у, ходит по одному capability‑RPC (`x3.host/rpc` v1). Транспорт (`FramePort`)
   переносит только кадры; у транспорта нет собственного протокола, allowlist'а или семантики.
2. **Method surface — данные contract definition, не код.** Какие методы у объекта контракта, что
   каждый возвращает и где лежит `AbortSignal` — это поле `surface` в `contract-definition-spec.v1`
   (обе ветки: `data-source` и `service`). Host, транспорты и приложения выводят прокси из surface;
   ни один из них не держит свой список методов как authority. Единственный остаток —
   `DATA_SOURCE_METHODS`/`REMOTE_VALUE_METHODS` в `apps/electron/electron/main.cjs`: временный
   allowlist старого IPC, лишённый статуса authority; удаляется при переводе Electron IPC на
   capability‑RPC (R6, документ 09 §14).
3. **`worker-brokered` под node — ступень SB‑1: изоляция отказов и протокола, не security sandbox.**
   Backend честно публикует это диагностикой `x3.host/worker-shared-process`; тихого понижения к
   `trusted-in-process` нет (правило 1 §6.1 документа 24).
4. **Verify‑at‑evaluation.** Файлы artifact'а исполняются из байтов, сверенных с per‑file digests,
   записанными inventory в том же обходе, что и artifact digest; между проверкой gate и исполнением
   нет окна.

## 2. Словарь (дополняет документ 02 §1 и решение 57)

| Термин               | Значение                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| method surface       | Данные о том, как вызывается объект контракта: `methods{name → kind, signal, arity, optional, result, wrapper, limits}`, `releaseVia`, `fields`.          |
| method kind          | `value` (bounded wire value), `lease` (capability с собственной surface), `leased-value` (`Lease<T>` plain‑значения), `iterable` (pull), `events` (push). |
| placement            | Где executor кладёт `AbortSignal`/progress‑callback: `signal: 'last' \| 'none' \| {arg,key}`, `progress: {arg,key}`.                                      |
| handle ref           | `{ '@x3.handle': { id, kind, contract?, major?, data? } }` — ссылка на capability на другой стороне; `data` — скопированные `fields`.                     |
| session / generation | Идентичность пары endpoint'ов; `generation` растёт при рестарте worker'а, кадры чужой generation — violation.                                             |
| wire value           | JSON‑данные, `bigint`, целый `Uint8Array`, handle ref (по позиции), `undefined` внутри объектов; никаких функций/классов/SAB/partial views.               |
| surface registry     | Порт host'а `surfaceFor(contract, major)`; собирается из стандартной таблицы sdk + aux + runtime‑ABI surfaces + surfaces зарегистрированных definitions.  |

Слово `capability` — только в прозе; в wire‑словах, ключах схем и полях его нет (решение 57;
проверяется `check:legacy`).

## 3. Method surface в contract definition (NXT‑103, документ 23 §5.1)

`contract-definition-spec.v1`, обе ветки, optional `surface`:

```jsonc
"surface": {
  "fields": ["contract"],                       // данные объекта, копируются вместе с handle
  "releaseVia": "dispose",                      // value‑метод, завершение которого освобождает handle
  "methods": {
    "parse":      { "kind": "value", "signal": { "arg": 0, "key": "signal" } },
    "dataSource": { "kind": "lease", "wrapper": "lease",
                    "result": { "contract": "common.view/tree-data-source", "major": 1 },
                    "signal": { "arg": 0, "key": "signal" } },
    "search":     { "kind": "iterable", "signal": "last" },
    "events":     { "kind": "events", "signal": "last" },
    "openEntry":  { "kind": "leased-value", "signal": "last" },
    "encoded":    { "kind": "lease", "wrapper": "bare", "arity": 1,
                    "result": { "contract": "common.view/encoded-media", "major": 1 }, "signal": "last" },
    "readRegion": { "kind": "value", "optional": true, "signal": "last" }
  }
}
```

Правила:

- схема — `oneOf` двух ветвей: только `lease` несёт `result`/`wrapper`; остальные kinds — нет.
  Ручной TS‑тип совпадает с выводом FromSchema (drift‑gate `packages/sdk/test/schema-drift.ts`);
- имена методов и полей: `^[a-z][a-zA-Z0-9]{0,63}$` (`METHOD_NAME_PATTERN` = `isMethodName` протокола);
- семантика вне схемы: `releaseVia` называет объявленный `value`‑метод; поле не может быть методом;
- **стандартная таблица** `STANDARD_DATA_SOURCE_SURFACES` (13 контрактов, major 1) + вспомогательная
  `common.view/encoded-media@1` (`EncodedMediaSource` — capability без собственного контракта,
  освобождается каскадом от родителя) — в `@modkitx-x3/sdk`, каждая запись пришпилена к
  ABI‑интерфейсу типом `SurfaceOf<T>` (пропущенный/лишний/непомеченный optional метод не компилируется);
- foreign‑контракты приносят surface в своём definition; host **никогда не угадывает** surface;
- `limits` (`maxPageItems`/`maxBytes`/`maxStringLength`) — данные; в стандартной таблице их нет
  (пределы — политика владельца по контракту), wire и так ограничен глобальными лимитами endpoint'а.

Восемь bundled определений `common.text-data/*-syntax` несут surface провайдера
(`fields: ['contract']`, `parse`/`serialize`, `dataSource` → tree/table data‑source).

## 4. Capability‑RPC v1 (+ расширения 1.1) — модель

Envelope `{domain:'x3.host/rpc', version:1, session, generation, id}`; кадры `load ready call return
throw cancel next done subscribe event unsubscribe progress release terminate` с exact‑key
валидаторами; ids монотонны на сторону.

Правила, зафиксированные тестами (`packages/host/test/execution-*.test.ts`, conformance kit):

- **ровно один ответ на запрос**, в том числе после `cancel` (поздний ответ считается и дропается,
  не путается с дубликатом); дубликат/ответ на неизвестный id — violation;
- **fail‑closed**: любое нарушение закрывает endpoint, отклоняет pending, освобождает локальные
  targets, шлёт `terminate`, вызывает `onFailure`; транспорт терминирует peer;
- handles с owner‑префиксом (`h…` host, `w…` executor) и generation; release каскадом; освобождённый
  handle — structured error, неизвестный/чужой — violation;
- **аргументы копируются, результаты/события переносятся** (transfer). ABI‑код, написанный
  in‑process, переиспользует переданный буфер (`parse`, затем `dataSource` с теми же `bytes`);
  перенос detach'ил бы его; `Uint8Array` над detached буфером отбивается явно;
- `undefined` внутри объектов/массивов допустим (structured clone сохраняет; ABI‑объекты так
  выглядят), на верхнем уровне — нет;
- лимиты endpoint'а: depth/nodes/string/array/keys/transfer/args + pending/handles/iterators/
  subscriptions/queued events/deadline; `x3.host/rpc-*` коды — structured errors, не violations;
- error DTO без stack/cause; `OperationCancelledError` остаётся отменой;
- v1.1 (обратно совместимо, wire `version` = 1, 1.0‑peer работает): `leased-value`,
  `resultFromArgs` (`ArgRef = number | {arg,key}`), `arity`, `fields` внутри handle ref,
  `signal`/`progress` placements, `load.entrypointDigest`;
- **`has`** — optional‑методы, реально реализованные объектом, перечислены в ref'е
  (`presentOptional` на стороне‑создателе); consumer определяет ровно required + `has`, поэтому
  `typeof obj.method === 'function'` — честная feature detection. Ref surface'а без optional‑методов
  байт‑идентичен 1.0;
- **`nextBatch`** — opt‑in: `iteratorBatchItems` (по умолчанию 1 — по элементу за round trip);
  выше — consumer шлёт `next { max }`, executor отвечает массивом ≤ `max`, буфер сливается локально;
- `operations().invoke` placements (`{signal, onProgress}` в третьем аргументе) переносятся
  session‑адаптером backend'а; derived asset inputs (`subjects`/`materialized` как fields,
  `openSubject`/`openMaterialized` как методы, `subjectsFor` локально).

Не сделано (открыто): per‑contract `limits` как политика владельца; `nextBatch`‑конвенция для
стандартных surfaces (какие data sources включают батчинг и с каким размером — вопрос ABI‑конвенций).

## 5. Runtime‑ABI surfaces (`x3.abi/*@1`, host‑internal)

`codec-module` (field `abiVersion`; `createCodec` → codec), `codec` (`probe`, optional `planInput`,
`open` → asset‑session), `asset-session` (field `revision`; `state`, `descriptor`, `dataSource` с
`resultFromArgs`, `operations` → operation‑session, `events`, `dispose` = `releaseVia`),
`operation-session` (`invoke` с placements `signal`/`onProgress` в options), `artifact-source`
(union: fields `ref/revision/kind/size`, optional `read/stream/openNamespace`), `asset-namespace`,
`asset-input` (union: fields `originKind/bindings/revisions/primaryBindingId`, optional
`openBinding/openNamespace`; sync `bindingsFor` вычисляется bootstrap'ом локально из `bindings`),
`diagnostic-sink`, `contract-resolver` (`resolve`/`resolveUnknown`, result из `{arg:0,key}`).
Каждая пришпилена к ABI‑интерфейсу sdk (`AbiSurfaceOf<T>`); гибриды «данные + методы» пересекают
границу как один ref с `data`.

## 6. Node worker backend (`worker-brokered`, target `node`)

Жизненный цикл (документ THREAT_MODEL_WORKER_BOUNDARY §2 в корне лаборатории — исходный design):
один `Worker` на activation из bootstrap'а host'а (`@modkitx-x3/host/node/worker-bootstrap`),
`env:{}`, `argv:[]`, `execArgv:[]`, `resourceLimits` из **host policy**, stdio захвачен и ограничен,
отдельный transferred `MessagePort`; host‑endpoint над стандартным surface registry; supervisor:
violation → `terminate()`, `'exit'/'error'` → peer exit, deadline → `cancel` → grace →
`terminate()`, `release()` → `terminate`‑кадр → grace → `terminate()`, идемпотентно.

`WorkerBackendPolicy` (`resourceLimits`, `loadDeadlineMs`, `defaultCallDeadlineMs`, `graceMs`,
`outputCapBytes`, `maxRestartsPerLease`) выбирает composition root; значения выше жёстких ceilings
**отклоняются**, не clamp'аются; manifest/variant/activation её не поставляют.

**Spawn path и адаптер — общие (S1a, 2026‑08‑18).** Один `Worker` на _поколение_ поднимается через
`spawnWorkerRealm` (`@modkitx-x3/host/node`): опции изоляции, лимиты policy, cap stdio,
выделенный transferred `MessagePort` за единственным production‑адаптером
`framePortFromMessagePort` (`@modkitx-x3/host/execution`). Тем же путём harness testkit'а
поднимает hostile‑fixtures, а conformance kit — пару над реальным потоком: то, что они доказывают,
— транспорт backend'а, а не его подобие (acc‑12); fixture `env-report` подтверждает изнутри потока
`env: {}`, `argv: []`, `execArgv: []` и `resourceLimits` policy (T6).

**Wiring в продукты (S1b, 2026‑08‑18).** Каждый Node composition root (Electron main, CLI,
server, automation host) моделирует рядом с host‑realm'ом realm `node-worker` (`nodeWorkerRealmProfile`
без собственных facilities; `nodeWorkerLinks`) и один реестр backend'ов на оба realm'а
(`createNodeExecutionBackends`: trusted‑in‑process с gate по artifact + Node worker backend под
policy root'а). Приложение **резолвит открытие для target worker‑realm'а** — по правилу R‑A2/W4
выбираются `portable` варианты, активация `worker-brokered`; понижения нет, gate отказывает.
Провайдер контракта в продукте — тоже portable: root‑surface `x3.abi/service-provider-module@1`
(`createProvider(selection, context)` → lease по контракту selection'а), host мостит worker A
(codec) → host → worker B (provider). Реестр backend'ов несёт свои bindings под глобальным символом,
поэтому раздельно собранные entries `@modkitx-x3/host` и `@modkitx-x3/host/node` понимают друг друга.

**Restart (acc‑8).** Модульная lease переживает смерть worker'а: следующий `createCodec` на той же
lease поднимает поколение +1 **той же сессии** — старый порт закрыт до появления нового Worker'а,
codec'и/сессии старого поколения остаются мёртвыми (`x3.host/rpc-peer-exited` →
`x3.host/rpc-endpoint-closed`), ни один handle не переезжает, entrypoint перепроверяется по digests,
взятым при activation (изменённый между поколениями файл — `x3.host/artifact-digest-mismatch`).
Одновременные вызовы после смерти делят один restart; число restart'ов на lease ограничено policy
(`x3.host/worker-restart-limit`, `retryability: never`); каждый restart — диагностика
`x3.host/worker-restarted`; `x3.host/worker-shared-process` — одна на activation. Восстановление
_сессий_ backend не обещает: это решение потребителя (повторный `open`), не транспорта.

Загрузка: gate передаёт backend'у per‑file digests inventory (действительны: gate только что
перепроверил artifact digest); bootstrap ставит синхронные module hooks — каждый файл внутри
artifact'а (кроме `node_modules`) читается один раз, сверяется (`x3.host/artifact-digest-mismatch`
при изменении; `x3.host/execution-load-rejected` для файла вне inventory или побега относительным
импортом) и исполняется из этих байтов; bare‑зависимости (`node_modules`, workspace links) и их
внутренности грузятся без верификации (SB‑1 честность; digests зависимостей — SB‑4). Без карты
проверяется только entrypoint (`entrypointDigest`), его импорты — `x3.host/artifact-not-pinned`.

Host‑side module adapter сохраняет **синхронный** `createCodec(context)` ABI: `diagnostics` и
`contracts` уходят worker'у как host‑capabilities, `probe`/`open` inputs — как capabilities с
полями; сессии возвращаются ABI‑образными адаптерами над `x3.abi/asset-session`.

Что даёт / не даёт (обязательная строка §6.1 документа 24): crash/hang/violation изолированы —
**да**; resource abuse — **частично** (V8 limits, watchdog); чтение/запись вне grant из кода —
**нет** (общий процесс; `node:fs` доступен) → SB‑2/SB‑3; tampering — digest gate + verify‑at‑evaluation;
подпись/revocation — SB‑4.

## 7. Acceptance (дополняет документ 10)

- **Conformance kit** (`runFramePortConformance`): 25 кейсов round‑trip/lifecycle/hostile против
  любой пары `FramePort`; host‑only режим для удалённой стороны; проверен на loopback,
  `MessageChannel`, реальном `worker_threads`; негативные транспорты ловятся.
- **Hostile worker acceptance** (`packages/testkit/fixtures/hostile-worker/*.mjs`, reference
  supervisor): acc‑1…acc‑5, acc‑9, acc‑10 закрыты над реальными потоками; acc‑6/acc‑7/acc‑11 —
  тестами backend'а; acc‑8 (restart generation — тесты backend'а над fixture `crashy`) и acc‑12
  (kit над production spawn path `spawnWorkerRealm` + production адаптером) — закрыты 2026‑08‑18;
  T6 (изоляция потока) — fixture `env-report`.
- **Продукт:** Electron открывает JSON в worker‑realm'е (`portable`, диагностика
  `x3.host/worker-shared-process` в результате открытия и в sink приложения; provider в
  отдельном worker'е) — `apps/electron/test/subject-services.test.ts`; CLI/server/automation
  пришпиливают пары realm'ов и реестр backend'ов.
- **Реальные расширения в worker'е:** bundled `text-json` codec активируется через backend SPI,
  `probe` детектит JSON, `open()` резолвит провайдер через host (`contracts.resolve`), собирает и
  валидирует descriptor, отдаёт tree data source (`packages/host/test/node-worker-backend.test.ts`).

## 8. Открытые вопросы (владелец/Root)

1. `nextBatch`‑конвенция для стандартных surfaces (какие data sources батчатся, размер) и
   per‑contract `limits` как политика — ABI‑конвенции владельца (`has`/`nextBatch`‑механизм и
   `operations().invoke`/derived inputs приземлены S2, 2026‑08‑18; сигнатурный индекс NXT‑101B и
   probe‑grant seam — S3, 2026‑08‑18: см. IMPLEMENTATION_NOTES «S3»).
2. Browser worker backend (`browser-sandbox`) на том же ядре; Electron IPC → capability‑RPC (R6).
3. `process-brokered` до первого installed/linked native codec внешнего publisher'а (SB‑3).
4. Digests зависимостей (SB‑4); политика `limits` по контрактам.
5. Wiring worker backend'а в composition roots приложений с policy; restart generation.
6. Owner‑каноника: перенос профилей `worker-brokered`/`process-brokered`/`wasm-brokered`/
   `browser-sandbox` в заголовки §5 документа 24 (Q77 уже принял единый enum).

## 9. Evidence

- `packages/host/src/execution/{protocol,surface,handles,endpoint,surface-adapter,abi-surfaces,worker-policy}.ts`;
  `packages/host/src/node/{worker-backend,worker-bootstrap}.ts`; `packages/host/src/security/gate.ts`
  (`fileDigests`, `x3.host/worker-shared-process`); `packages/host/src/node/loader.ts` (per‑file digests).
- `packages/sdk/src/schemas/contribution-specs.ts` (`dataSourceSurfaceV1Schema`, обе ветки),
  `packages/sdk/src/definitions.ts`, `packages/sdk/src/asset-capabilities/data-source-surfaces.ts`,
  `packages/sdk/test/{schema-drift,data-source-surfaces,data-source-surfaces-types}.ts`.
- `packages/testkit/src/capability-rpc/**`, `packages/testkit/fixtures/hostile-worker/**`,
  `packages/testkit/test/{capability-rpc-conformance,hostile-worker}.test.ts`.
- `packages/host/test/{execution-endpoint,execution-protocol,execution-handles,execution-surface-adapter,node-worker-backend}.test.ts`.
- Команды: `pnpm check` (2026‑08‑18: 75 test files / 625 tests, все gates зелёные);
  `pnpm check:legacy` (словарь), `pnpm check:extensions` (definitions с surface валидны).
- Лабораторные записи: `IMPLEMENTATION_NOTES.md` (NXT‑105, F1, F4b, NXT‑103, R2, R3a, R3b‑1, R3b‑2),
  `THREAT_MODEL_WORKER_BOUNDARY_2026-08-18.md`, `PROPOSAL_NXT103_DATA_SOURCE_SURFACE_2026-08-18.md`.
