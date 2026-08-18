# Threat model и acceptance для Node worker backend (NXT‑114, ступень SB‑1)

Дата: 2026-08-18
Автор: Fable (шаг F4 из `PLAN_FABLE_NEXT_2026-08-18.md`)
Статус: **design/acceptance до реализации**; реализация backend — Root (R3), Fable проводит
pre‑merge аудит по §6 этого документа.
Основания: `docs/MK3/24` §6.1 (лестница SB‑0…SB‑5, правило 1 «понижение профиля никогда не
молчаливое», таблица threat coverage), §2.1 (digest verification), `docs/MK3/27` §6–§7;
код: `packages/host/src/execution/{protocol,handles,endpoint,surface}.ts` (NXT‑105),
`packages/host/src/execution/backend.ts` (NXT‑100, Root).

## 0. Что именно моделируется

Backend `worker-brokered` для target `node`: host создаёт `worker_threads.Worker` из фиксированного
bootstrap‑файла host‑а, передаёт ему `MessagePort`, поверх которого обе стороны запускают
`createEndpoint` (роли `host`/`worker`), и по `load` frame worker импортирует entrypoint расширения.
Модуль расширения виден host‑у только как `RemoteCapability` + `materialize()`; никакой объект
расширения не пересекает границу иначе, чем через wire values и handle refs.

Позиционирование честное и обязательное к повторению в diagnostics/README backend‑а:

| Угроза (таблица §6.1 doc 24)        | Что даёт NXT‑114                                                               | Не даёт                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Crash/зависание кодека роняет host  | **да** — процесс host не падает; сессия завершается структурно                 | —                                                                                          |
| Resource abuse (CPU/память)         | **частично** — `resourceLimits` (heap/stack), watchdog + `terminate()`         | CPU‑квоты, ограничение I/O, лимит на потоки/`Atomics.wait`                                 |
| Чтение вне grant из кода расширения | **нет** — worker разделяет процесс: `node:fs`, `net`, `child_process` доступны | это SB‑2 (WASM) / SB‑3 (helper process + OS sandbox); отдельный `process-brokered` backend |
| Запись/exfiltration вне grant       | только на brokered paths (RPC не даёт лишних handles)                          | ambient I/O внутри worker не отозван                                                       |
| Подмена/tampering artifact          | digest перед `import` (gate) + verify‑after‑load в worker (§3 T5)              | подпись/revocation — SB‑4                                                                  |

Следствие для policy (doc 24 §6.1 правило 1 и 4): `worker-brokered` через NXT‑114 — это **изоляция
отказов и протокола, не security sandbox**. Backend обязан публиковать это как `diagnostic`
(аналог `full-process-authority` для trusted) — код предлагается `x3.host/worker-shared-process`
(окончательное имя — Root; в wire‑словарь слово `capability` не входит). Тихая замена профилем
`trusted-in-process` при недоступности `worker_threads` запрещена — только `unresolved`/degraded.

## 1. Активы и границы

- **A1 host process**: inventory, gate, tickets, locks, `SurfaceRegistry`, файлы workspace.
- **A2 worker thread**: код entrypoint расширения (недоверенный по происхождению `installed`/`linked`,
  first‑party для `bundled`), bootstrap host‑а (доверенный), общий адресный пространство процесса.
- **A3 канал**: `MessagePort`, structured clone + transfer list; кадры протокола `x3.host/rpc` v1.
- **A4 источники данных**: `RandomAccessSource`/`AssetSession` и прочие leases, которые host
  **выдаёт** worker‑у как handles (host исполняет — `expose`); worker выдаёт host‑у codec/session/
  iterator/events handles.
- **A5 диагностика**: `onFailure`/`onDiagnostic`/`onTerminate`, stdout/stderr worker‑а, exit code.

Доверие: host доверяет **только** тому, что прошло `validateFrame`/`validateWireValue` и
`SurfaceRegistry`; worker симметрично валидирует host (защита от багов host‑а, не от злого host‑а —
злой host вне модели). Никакая сторона не доверяет содержимому `message` ошибок как коду.

## 2. Жизненный цикл, который backend обязан реализовать

```
activate(context)                     ← ticket уже прошёл identity/digest/target (gate)
  ├─ new Worker(bootstrap, {workerData:{session, generation, limits, artifactRoot}, resourceLimits, env:{}, argv:[], execArgv:[], stdout:true, stderr:true, trackUnmanagedFds:true, name})
  ├─ MessageChannel → port1 host / port2 worker (transferList)
  ├─ endpoint(host) = createEndpoint({role:'host', port: FramePortOver(port1), session, generation, surfaces, limits, onFailure, onDiagnostic})
  ├─ await endpoint.load({moduleUrl, contributionId, variantId, artifactDigest}, {deadlineMs: loadDeadline, signal})
  └─ ExecutionModuleLease{ module: endpoint.materialize(root), release }
release()                             ← идемпотентен (backend.ts уже оборачивает)
  ├─ endpoint.close('released')       → terminate frame → worker: onTerminate → process.exit(0)
  ├─ ждать 'exit' ≤ graceMs, иначе worker.terminate()
  └─ counters(): localHandles=remoteHandles=pendingCalls=subscriptions=0
onFailure(violation)                  ← fail‑closed: endpoint уже 'failed' и все leases invalidated
  └─ worker.terminate() немедленно; module lease → released; вызовы получают ModkitError x3.host/rpc-protocol-violation
'exit'/'error' Worker events          → endpoint.peerClosed(reason) → x3.host/rpc-peer-exited для всех pending
watchdog                              → cancel frame → grace → terminate() (см. T3)
restart                               → новый Worker, новый port, generation+1; старые refs → x3.host/rpc-generation-invalidated; никакого прозрачного повтора in‑flight вызовов
```

Инварианты: одна пара endpoint‑ов на один `Worker`; один `Worker` на одну activation (никакого
пула с общим модулем в v1 — общий worker сделал бы crash одного расширения крашем всех); `session`
случайный (≥ 128 бит), `generation` монотонный внутри `session`.

## 3. Каталог угроз → митигирование → приёмка

Обозначения: «core» = уже в NXT‑105 (с указанием места), «backend» = обязанность NXT‑114,
«fixture» = hostile worker из §5, «acc» = критерий из §4.

| #   | Угроза / вектор                                                                                           | core (NXT‑105)                                                                                                                                                                                         | backend (NXT‑114)                                                                                                                                                                     | fixture / acc              |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| T1  | Мусорные/враждебные кадры: чужой `domain`/`version`/`session`, `__proto__`, лишние ключи, глубина, размер | `validateFrame`/`validateWireValue` — exact‑key, prototype‑safe, лимиты depth/nodes/string/array/transfer; любое нарушение → `fail()` → `terminate` frame, все pending отклонены, `onFailure`          | по `onFailure` — `worker.terminate()` без ожидания; в diagnostics — код violation, не payload                                                                                         | HW‑01, HW‑02 / acc‑3       |
| T2  | Crash worker‑а (uncaught, `process.exit`, OOM)                                                            | `peerClosed` → `x3.host/rpc-peer-exited` (retryability `conditional`), teardown освобождает локальные targets, iterators, subscriptions                                                                | подписка на `'error'`/`'exit'` **до** первого frame; `resourceLimits` → `ERR_WORKER_OUT_OF_MEMORY` — это тоже exit                                                                    | HW‑03, HW‑04 / acc‑1,2     |
| T3  | Зависание: нет ответа на `call`/`next`/`load`; бесконечный цикл; `Atomics.wait`                           | per‑call deadline (`defaultCallDeadlineMs`, `deadlineMs`), `cancel` frame, `x3.host/rpc-deadline-exceeded`; исполняющая сторона обязана ответить `throw cancelled` — но зависший event loop не ответит | watchdog: после deadline+grace без ответа на `cancel` — `terminate()`; отдельный `loadDeadline`; `terminate()` — единственный способ прервать sync‑цикл                               | HW‑05, HW‑06 / acc‑4       |
| T4  | Resource abuse: heap, стек, transfer‑flood, handle‑flood, event‑flood, pending‑flood                      | `maxTransferBytes`, `maxHandles`, `maxIterators`, `maxSubscriptions`, `maxQueuedEvents` (`x3.host/rpc-events-overflow` закрывает подписку), `maxPendingCalls`, `maxArgs`                               | `resourceLimits: {maxOldGenerationSizeMb, maxYoungGenerationSizeMb, codeRangeSizeMb, stackSizeMb}` из policy/variant; stdout/stderr — pipe с cap и обрезкой                           | HW‑07, HW‑08 / acc‑5       |
| T5  | Tampering/TOCTOU: файл entrypoint изменён между `verifyArtifactDigest` в gate и `import()` в worker       | `LoadRequest.artifactDigest` доходит до worker‑loader; `load` без loader → `x3.host/rpc-no-loader`                                                                                                     | **verify‑after‑load**: worker читает байты, считает digest тем же определением, что inventory; mismatch → `throw` `x3.host/artifact-digest-mismatch`, модуль не исполняется. См. §3.1 | HW‑09 / acc‑6              |
| T6  | Ambient authority в worker (`node:fs`, `net`, `child_process`, `process.env`, `--inspect`)                | вне протокола                                                                                                                                                                                          | `env: {}` (не `SHARE_ENV`), `argv: []`, `execArgv: []` (не наследовать `--inspect*`/`--require`), `eval: false`; **не заявлять** запрет I/O — diagnostic §0                           | acc‑7 (документальный)     |
| T7  | Подделка/путаница handles: чужой owner‑prefix, чужая generation, released, unknown, cross‑session         | `HandleTable.lookup` → live/released/unknown/foreign‑generation → `x3.host/rpc-bad-handle`/`-released-handle`/`-unknown-handle`/`-generation-invalidated`; `session` в envelope                        | новый `MessagePort` на каждый Worker; после restart — `generation+1`; старый port закрыт (`close()`), кадры с него не доставляются                                                    | HW‑10, HW‑11 / acc‑8       |
| T8  | Late/duplicate reply, reply на чужой `id`, `ready` не на `load`                                           | `PendingCalls.settle` → `settled                                                                                                                                                                       | late-after-cancel                                                                                                                                                                     | duplicate                  | unknown`; late считается (`droppedLateReplies`), duplicate/unknown → violation | —   | HW‑12 / acc‑3 |
| T9  | Утечки: leases/iterators/subscriptions после exit/terminate/release                                       | `teardown()` — `failAll`, `cancelAll`, `closeAll`, `table.invalidate()`, `report` release‑failures                                                                                                     | `release()` idempotent; после `exit` counters должны быть нулевыми; никаких таймеров, удерживающих event loop host‑а (`unref` watchdog)                                               | acc‑2, acc‑9               |
| T10 | Утечка информации в ошибках/логах: stack, `cause`, пути host‑а                                            | `toErrorDto`: stack/cause никогда не пересекают границу; message ≤ 8 KiB; не‑wire context дропается (`contextDropped`); foreign → `x3.host/rpc-foreign-error`                                          | stdout/stderr worker‑а — в diagnostics с cap, не в UI напрямую; `moduleUrl` в diagnostics — относительно `artifactRoot`                                                               | acc‑10                     |
| T11 | Worker подсовывает `moduleUrl` вне artifact / `node:`/`http:` при повторном `load`                        | `load` принимает только worker‑роль; `moduleUrl` — строка, семантику проверяет loader                                                                                                                  | worker‑loader принимает **ровно один** `load` за жизнь worker‑а, только `file:` URL внутри `artifactRoot` из `workerData`, без symlink‑escape (realpath ⊂ root)                       | HW‑13 / acc‑11             |
| T12 | SharedArrayBuffer/partial views/`Atomics` через wire                                                      | `shared-buffer` и `partial-typed-array` — violations                                                                                                                                                   | не передавать SAB в `workerData`; `transferList` только из `validateWireValue().transferables`                                                                                        | HW‑02 / acc‑3              |
| T13 | Отказ `terminate`: worker игнорирует `terminate` frame, держит порт                                       | `close()` не ждёт peer; teardown локальный                                                                                                                                                             | `graceMs` затем `worker.terminate()`; `release()` резолвится не позже `graceMs + ε` независимо от worker‑а                                                                            | HW‑14 / acc‑4              |
| T14 | Порядок событий: `exit` раньше `ready`; `terminate` во время `load`                                       | `peerClosed` во время pending `load` → reject `x3.host/rpc-peer-exited`; `cancel` при `load` → `throw cancelled`                                                                                       | `activate()` обязан отклонить activation и убрать Worker; никакой «полуактивной» lease                                                                                                | HW‑03 (early exit) / acc‑1 |

### 3.1 Verify‑after‑load — варианты, рекомендация

Gate уже делает `verifyArtifactDigest` непосредственно перед активацией (`security/gate.ts`), но
окно между проверкой в host и `import()` в worker остаётся, а для `linked` origin файл может меняться
в любой момент. Варианты закрытия:

1. **Re‑hash в worker перед `import(file:)`** — просто; окно сужается до микросекунд, но не ноль.
2. **Evaluate‑from‑verified‑bytes** — worker читает entrypoint, проверяет digest и исполняет
   именно эти байты (`import('data:text/javascript;base64,…')` для single‑file entrypoint либо
   `module.register` loader‑hooks, отдающие проверенные байты для entrypoint и chunks). Окно = 0.
   Ограничение: относительные импорты внутри artifact требуют hooks с per‑file digest‑листом.
3. **Immutable copy** — host копирует artifact в неизменяемый cache (`installed` origin уже такой),
   `linked` — только с 1/2.

Рекомендация для v1: **(1) обязательно для всех origin + (2) для single‑file entrypoint**;
многофайловые artifact‑ы `linked` origin — с diagnostic `x3.host/artifact-not-pinned` (имя — Root)
до появления hooks. Определение digest берётся из inventory (`artifactDigest` = SHA‑256 по
канону inventory.ts) — второго определения не вводить.

## 4. Критерии приёмки (acc‑*) — обязательны до merge R3

1. **acc‑1 early exit**: worker завершился до `ready` → `activate()` отклоняется
   `x3.host/rpc-peer-exited`; `Worker` объект собран (`threadId` не в списке живых), таймеров нет.
2. **acc‑2 counters after death**: после любого из `exit`/`terminate()`/`release()`
   `endpoint.counters()` даёт `pendingCalls=activeCalls=localHandles=remoteHandles=subscriptions=0`,
   `state ∈ {closed, failed}`; каждый выданный host‑ом lease (A4) получил ровно один `release()`.
3. **acc‑3 fail‑closed**: любой fixture из HW‑01/02/12 → `state='failed'`, `violations=1`,
   `worker.terminate()` вызван ≤ 1 tick после `onFailure`; все pending — `x3.host/rpc-protocol-violation`
   с `retryability='never'`.
4. **acc‑4 hang budget**: HW‑05 (`while(true)`) — вызов отклоняется `x3.host/rpc-deadline-exceeded`
   не позже `deadline + graceMs`, worker terminated, `release()` резолвится; HW‑14 (игнорирует
   `terminate`) — то же по `graceMs`.
5. **acc‑5 limits enforced**: HW‑07 (аллокация до OOM) → exit `ERR_WORKER_OUT_OF_MEMORY` → peer‑exited,
   host RSS не растёт монотонно между 5 повторами; HW‑08 (event‑flood без подписчика/сверх
   `maxQueuedEvents`) → `x3.host/rpc-events-overflow` у потребителя, endpoint остаётся `open`.
6. **acc‑6 tamper**: HW‑09 — файл entrypoint переписан после выдачи ticket и до `load` → `load`
   отклоняется `x3.host/artifact-digest-mismatch`, модуль не исполнен (fixture пишет маркер‑файл при
   исполнении; маркер отсутствует).
7. **acc‑7 честный diagnostic**: activation под `worker-brokered`/node несёт diagnostic «shared
   process, no ambient isolation»; при недоступности `worker_threads` — `unresolved`, не trusted.
8. **acc‑8 generation**: после restart вызов по старому `RemoteCapability` →
   `x3.host/rpc-generation-invalidated`; кадры со старого порта не влияют на новый endpoint (порт
   закрыт до создания нового Worker).
9. **acc‑9 idempotent release**: `release()` ×3 параллельно и последовательно — один `terminate`, один
   `close`, без unhandled rejections; после `release()` — `call()` → `x3.host/rpc-endpoint-closed`.
10. **acc‑10 no leakage**: `throw` из worker с `Error('x', {cause})` и stack → host получает
    `x3.host/rpc-foreign-error`, без `stack`/`cause`; stderr fixture в 10 MiB обрезается до cap.
11. **acc‑11 loader scope**: второй `load`, `moduleUrl` вне `artifactRoot`, `node:fs`, symlink наружу
    → `throw` (код Root, напр. `x3.host/execution-load-rejected`), worker жив, endpoint `open`.
12. **acc‑12 conformance**: FramePort backend‑а проходит `runFramePortConformance` (F1 kit) — тот
    же hostile‑suite, что loopback в `execution-endpoint.test.ts`.

## 5. Hostile worker fixtures (спецификация; файлы — `packages/host/test/fixtures/hostile-worker/`)

Каждый fixture — самостоятельный `.mjs`, получающий `MessagePort` тем же способом, что и
production bootstrap, и **не** использующий `createEndpoint` (враждебная сторона пишет кадры руками).

| id    | файл                   | поведение                                                                                     | ожидание host                                                        |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| HW‑01 | `proto-pollution.mjs`  | `ready` с `{"__proto__":{"admin":true}}` в `exports`, затем `return` с лишним ключом          | violation `forbidden-key`/`unknown-key`; acc‑3                       |
| HW‑02 | `bad-values.mjs`       | `return` с SAB‑view, partial `Uint8Array`, `NaN`, функция, `Map`, глубина 40                  | `shared-buffer`/`partial-typed-array`/`bad-value`/`depth-exceeded`   |
| HW‑03 | `exit-early.mjs`       | `process.exit(3)` до `ready` (вариант: сразу после `ready`)                                   | acc‑1 / acc‑2                                                        |
| HW‑04 | `throw-uncaught.mjs`   | `setTimeout(() => { throw new Error('boom') })` после `ready`                                 | `'error'` → `peerClosed`; pending → `x3.host/rpc-peer-exited`        |
| HW‑05 | `hang-sync.mjs`        | на `call` — `while (true) {}`                                                                 | acc‑4                                                                |
| HW‑06 | `hang-async.mjs`       | на `call` — никогда не отвечает, на `cancel` — тоже (event loop жив)                          | deadline → `cancel` → grace → terminate                              |
| HW‑07 | `oom.mjs`              | наращивает массив буферов до OOM                                                              | acc‑5                                                                |
| HW‑08 | `event-flood.mjs`      | после `subscribe` шлёт 100k `event` кадров без пауз                                           | `x3.host/rpc-events-overflow`; endpoint `open`; память host bounded  |
| HW‑09 | `tamper-marker.mjs`    | легитимный entrypoint, пишет marker‑файл при исполнении; тест меняет файл после ticket        | acc‑6                                                                |
| HW‑10 | `forged-handles.mjs`   | `call` по `h1-1` (чужой owner), по `w999-1` (unknown), по released, по generation‑1           | соответствующие `x3.host/rpc-*handle*` коды; без violation           |
| HW‑11 | `wrong-session.mjs`    | кадры с чужим `session`/`generation+5`/`domain: 'x3.host/rpc2'`                               | violation `bad-envelope` (session/domain), `stale-generation`; acc‑3 |
| HW‑12 | `reply-games.mjs`      | duplicate `return`, `return` на unknown `id`, `ready` на `call`, late `return` после `cancel` | duplicate/unknown → violation; late → `droppedLateReplies`+1         |
| HW‑13 | `second-load.mjs`      | легитимный worker‑bootstrap, но тест шлёт второй `load` и `load` с `node:fs`/`../../etc`      | acc‑11                                                               |
| HW‑14 | `ignore-terminate.mjs` | на `terminate` — молчит, порт держит, `setInterval` живой                                     | acc‑4 (`graceMs`), `terminate()` вызван                              |

Fixtures HW‑01/02/10/11/12 полезны и без Node transport — они запускаются через F1 loopback‑kit
(`inject`), поэтому пишутся первыми; HW‑03…09/13/14 требуют реального `Worker` (R3).

### 5.1 Статус (2026‑08‑18, F4b) — что уже лежит в дереве

Реализовано и проходит над реальными `worker_threads` **без** production backend‑а:
`packages/testkit/fixtures/hostile-worker/*.mjs` (raw‑protocol над `_lib.mjs`),
`packages/testkit/src/capability-rpc/node/worker-harness.ts` (`spawnFixtureWorker` с изоляционными
опциями §2 + **reference supervisor** `superviseFixtureWorker`) и acceptance
`packages/testkit/test/hostile-worker.test.ts` (14 тестов, 26 spawn‑ов, ~2.5 s).

| id    | статус                                                                                          | acc              |
| ----- | ----------------------------------------------------------------------------------------------- | ---------------- |
| HW‑01 | ✅ `proto-pollution.mjs` (own `__proto__` в return; `Object.prototype` не тронут)               | acc‑3            |
| HW‑02 | ✅ `bad-values.mjs` — варианты `nan`, `partial-view`, `shared`, `deep`, `unknown-frame-key`     | acc‑3            |
| HW‑03 | ✅ `exit-early.mjs` (код 3 до `ready`) и `exit-after-ready.mjs` (код 7 при in‑flight call)      | acc‑1, acc‑2     |
| HW‑04 | ✅ `throw-uncaught.mjs`                                                                         | acc‑2, acc‑10    |
| HW‑05 | ✅ `hang-sync.mjs` — только `worker.terminate()` завершает `for(;;)`                            | acc‑4            |
| HW‑06 | ✅ `hang-async.mjs` (+ вариант `honourCancel: true` — не терминируется)                         | acc‑4            |
| HW‑07 | ✅ `oom.mjs` — `ERR_WORKER_OUT_OF_MEMORY` при `maxOldGenerationSizeMb: 24`                      | acc‑5            |
| HW‑08 | ✅ `event-flood.mjs` — 50k событий, `x3.host/rpc-events-overflow`, endpoint `open`              | acc‑5            |
| HW‑09 | ⏳ ждёт R3 (loader backend‑а: verify‑after‑load)                                                | acc‑6            |
| HW‑10 | ✅ `forged-handles.mjs` — `unknown`, `foreign-owner` (violation), `released` (structured error) | acc‑3            |
| HW‑11 | ✅ `wrong-session.mjs` — `session`/`domain` → `bad-envelope`, `generation` → `stale-generation` | acc‑3            |
| HW‑12 | ✅ `reply-games.mjs` — `duplicate`, `unknown-id`, `ready-for-call`, `late-after-cancel`         | acc‑3            |
| HW‑13 | ⏳ ждёт R3 (loader backend‑а: один `load`, `file:` ⊂ `artifactRoot`)                            | acc‑11           |
| HW‑14 | ✅ `ignore-terminate.mjs` — `release()` резолвится за `graceMs + ε`                             | acc‑4            |
| —     | ✅ `demo-worker.mjs` — позитивный контроль: настоящий worker‑endpoint через границу потока      | positive control |

Reference supervisor **не** production policy (её вводит R3 как `WorkerBackendPolicy`, §8 п.2):
он фиксирует наблюдаемые реакции — `onFailure → terminate()`, `'exit'/'error' → peerClosed()`,
`release() → terminate frame → grace → terminate()`, `watched() → deadline → cancel → grace →
terminate()` — и именно эти реакции R3 обязан воспроизвести (acc‑1…acc‑5, acc‑10). Ещё не
покрыто: acc‑6/acc‑11 (loader), acc‑7 (diagnostic `x3.host/worker-shared-process`), acc‑8
(restart generation — логика backend‑а), acc‑9 против настоящего `ExecutionModuleLease`, acc‑12
(kit на реальной паре портов backend‑а).

## 6. Чек‑лист pre‑merge аудита R3 (Fable)

- [ ] `activate()` не оставляет Worker при любом отказе (early exit, load throw, deadline);
- [ ] подписки `'error'`/`'exit'`/`'messageerror'` установлены до первого `post`;
- [ ] `messageerror` (неклонируемое сообщение) трактуется как violation, не игнорируется;
- [ ] `env: {}`, `argv: []`, `execArgv: []`, `eval: false`, `stdout/stderr: true` + cap,
      `trackUnmanagedFds: true`, `resourceLimits` из policy; отсутствие `SHARE_ENV`;
- [ ] один `load` на Worker; loader проверяет `file:` ⊂ `artifactRoot` через realpath; verify‑after‑load;
- [ ] watchdog `unref()`‑нут; `graceMs` конфигурируем; `terminate()` ждётся, результат exit code в diagnostics;
- [ ] restart делает `generation+1` и новый порт; старый порт `close()`;
- [ ] `ExecutionModuleLease.module` = `materialize(root)`; ни один объект `module` не хранится вне endpoint;
- [ ] diagnostics: `x3.host/worker-shared-process` (или имя Root) на каждую activation;
- [ ] conformance kit (acc‑12) и HW‑01…14 включены в `pnpm test`, без `skip`;
- [ ] README backend‑а повторяет таблицу §0 (что даёт/не даёт) — правило 2 §6.1 doc 24.

## 7. Открытые вопросы (для Root/owner)

1. Имя diagnostic‑кода для «shared process» и «artifact not pinned» (§0, §3.1) — словарь `x3.host/*`.
2. Источник `resourceLimits`/`graceMs`/`loadDeadline`: policy host‑а, `RuntimeVariantDeclaration`
   (`budgets`?) или константы backend‑а с override в `ExecutionBackendActivation`?
3. Многофайловые artifact‑ы: обязателен ли single‑file entrypoint для `worker-brokered` в v1
   (упрощает §3.1 вариант 2) — решение затрагивает `docs/MK3/27` §6/§7.
4. Нужен ли `process-brokered` (child process + `--permission`/OS sandbox) сразу после NXT‑114 для
   `installed` origin, раз worker не даёт ambient boundary (SB‑3 gate по doc 24 — «первый native
   executable/library codec внешнего publisher»); до этого `installed` под node = SB‑1 с diagnostic.

## 8. Решения Root (2026‑08‑18)

Эти решения закрывают вопросы §7 для F1/R3. Они не расширяют SDK ABI и не превращают
`worker-brokered` в security sandbox.

1. **Diagnostics и product-state vocabulary.** На каждую успешную node worker activation host
   добавляет diagnostic `x3.host/worker-shared-process`; для linked многофайлового artifact-а,
   который пока нельзя исполнить из верифицированного набора байтов, применяется
   `x3.host/artifact-not-pinned`. Протокольные ошибки сохраняют семейство
   `x3.host/rpc-*`. Новый transport не создаёт собственных пользовательских состояний:
   результат всегда отображается через существующие `OpenSubjectResult`, причины
   `UnresolvedSubject`, `OperationRejection` и diagnostics. Точный перечень UX-мэппинга
   фиксируется отдельным ответом Opus до R6.
2. **Лимиты — только host policy.** R3 вводит приватную validated
   `WorkerBackendPolicy` с `resourceLimits`, `loadDeadlineMs`, `defaultCallDeadlineMs`,
   `graceMs` и лимитом stdout/stderr. Она выбирается composition root-ом по target и
   provenancе, ограничивается жёсткими host ceilings и никогда не поставляется extension
   manifest-ом либо `ExecutionBackendActivation`. Runtime variant может запросить realm,
   но не собственные значения budgets.
3. **Entrypoint v1.** Для `worker-brokered` v1 gate передаёт backend-у единственный
   проверенный `file:` entrypoint, полученный из artifact root. Loader принимает ровно один
   `load`, realpath-проверяет containment и повторно хеширует entrypoint непосредственно
   перед `import`. Исполнение из точно верифицированных байтов обязательно для single-file
   artifact-а. Linked многофайловые artifact-ы до loader hooks не активируются этим backend-ом:
   они получают `x3.host/artifact-not-pinned`, а не неявный trusted fallback. Bundled/immutable
   многофайловый artifact остаётся отдельным последующим decision после proof loader hooks.
4. **Process boundary.** `process-brokered` не входит в R3. Он становится обязательным до
   первого installed/linked native executable или native-library codec внешнего publisher,
   либо когда host policy требует SB‑3 для происхождения/сценария. До его реализации такие
   варианты остаются unresolved; понижения к `trusted-in-process` или SB‑1 нет.
5. **F1 разрешён.** Fable может начать conformance kit строго в
   `packages/testkit/src/capability-rpc/**` и `packages/testkit/test/**`. Kit обязан
   моделировать structured-clone/transfer границу, проверять cancellation, disconnect,
   back-pressure и hostile frames. Он не добавляет стандартные surfaces, SDK exports,
   host backend или product activation path; каждый реальный transport обязан пройти его
   до подключения к приложению.
