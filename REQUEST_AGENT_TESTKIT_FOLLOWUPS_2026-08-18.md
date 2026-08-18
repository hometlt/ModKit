# Задачи для агента (Opus/Sonnet): follow‑ups conformance kit и hostile‑worker acceptance

Дата: 2026-08-18  
Автор: Fable. Заказчик: Root (Sol) — распределяет и принимает.  
Контекст: NXT‑105 (capability‑RPC core, `4d2220f`), F1 (conformance kit) и F4b (hostile‑worker
harness + fixtures) лежат в дереве (см. `IMPLEMENTATION_NOTES.md` — записи «F4b», «F1»,
«NXT‑105»; `THREAT_MODEL_WORKER_BOUNDARY_2026-08-18.md` §5.1). Ниже — **механические, полностью
специфицированные** продолжения. Всё, что требует решений (SDK ABI, backend policy, loader), сюда
не входит и остаётся за Root/Fable.

## 0. Как работать в этом репозитории (обязательно прочитать)

- Репозиторий: `C:\FILES\SC2Files\coding\modkitX3`, ветка `spec/mk3-extension-reference`. Все
  команды — из корня репозитория. **Коммиты не делать** — только Root по своему решению.
- Ничего не импортировать из `modkitx` (соседний репозиторий) ни в каком виде. Пакеты лаборатории
  — `@modkitx-x3/*`, публиковать нельзя.
- Директорию `NexusForgeUI/` в корне **не трогать** (посторонняя, untracked); из‑за неё полный
  `pnpm check` красный на lint/format. Проверяйте так:
  ```bash
  pnpm build && pnpm exec eslint . --max-warnings 0 --ignore-pattern 'NexusForgeUI/**' && pnpm exec prettier --check . '!NexusForgeUI/**' && CI=true pnpm test && pnpm check:legacy && pnpm check:imports && pnpm check:extensions
  ```
- Гейт словаря `pnpm check:legacy` **запрещает слово `capability` как ключ объекта/поля/свойства**
  (`capability:`), в том числе в TS‑интерфейсах и деструктуризации. Называйте поля `remote`,
  `handle`, `lease`; в прозе/комментариях слово допустимо. Ключи `capability-rpc` в путях — ок.
- Не вставляйте в исходники управляющие символы (NUL и т.п.) буквально — только escape (`\u0000`).
- Форматирование: `pnpm exec prettier --write <files>`; lint: `pnpm exec eslint <paths>` (strict
  typescript‑eslint; `.mjs` fixtures тоже линтуются: без unused vars, без пустых функций).
- Разрешённый scope этих задач: `packages/testkit/src/capability-rpc/**`,
  `packages/testkit/fixtures/hostile-worker/**`, `packages/testkit/test/**`,
  `IMPLEMENTATION_NOTES.md` (одна запись в конце вашей работы). **Запрещено:** `packages/host/**`
  (в т.ч. `execution/*`), `packages/sdk/**`, `apps/**`, root `package.json`, `scripts/**`.
  Если для задачи «нужно» тронуть что‑то вне scope — остановиться и написать в отчёт, почему.
- Тесты запускать точечно: `CI=true pnpm exec vitest run packages/testkit/test/<file>.test.ts`.
  Перед этим `pnpm exec tsc -b packages/testkit` (fixtures `demo-worker.mjs` импортируют собранный
  `dist`).
- Kit и harness — публичный API testkit: `runFramePortConformance`, `createLoopbackPair`,
  `framePortFromMessagePort`, `createDemoWorld`/`DEMO_SURFACES`, `spawnFixtureWorker`,
  `superviseFixtureWorker`, `HOSTILE_WORKER_FIXTURES` (см. `packages/testkit/src/index.ts`).

## 1. Задачи

### T‑A. In‑process hostile‑кейсы kit, зеркалящие worker‑fixtures (приоритет 1)

Файл: `packages/testkit/src/capability-rpc/conformance.ts` (массив `CASES`, секция `hs-*`).
Добавить кейсы, использующие `ctx.postRawToHost(...)` / `ctx.fresh()` по образцу
`hs-malformed-frames`. **Каждый такой кейс помечать `hostile: true, needsLocalWorker: true`** — в
host‑only режиме (пара без `worker`, `farSide: 'demo-world'`, см. тест «host-only mode over a real
thread») raw‑инъекция недоступна и такие кейсы должны попадать в `skipped`, а не в `failures`;
обновите ожидаемый список `skipped` в этом тесте (порядок = порядок в `CASES`).

1. `hs-proto-pollution-reply` — после `openSession()` открыть **pending** вызов
   `const pending = remote.call('hang', [{}]).catch(e => e)`, дождаться
   `ctx.host.counters().pendingCalls === 1`, найти id этого `call` в `ctx.spy.records`
   (`from === 'host' && frame.t === 'call' && frame.method === 'hang'`) и послать на него raw
   ответ от имени worker‑а:
   `ctx.postRawToHost({ ...ctx.envelope('worker'), t: 'return', inReplyTo: <id>, value: JSON.parse('{"id":"demo","__proto__":{"admin":true}}') })`
   (`JSON.parse` даёт **собственный** ключ `__proto__`; литерал объекта его не создаёт).
   Ожидание: `host.state === 'failed'`, `failures.host[0].code === 'forbidden-key'`,
   `Object.prototype` без `admin`, `await pending` — ошибка с кодом `x3.host/rpc-protocol-violation`.
2. `hs-bad-values-reply` — то же с пятью вариантами на **свежих** парах (`ctx.fresh()`):
   `{ n: Number.NaN }` → `bad-value`; `new Uint8Array(new ArrayBuffer(16), 4, 4)` →
   `partial-typed-array`; `new Uint8Array(new SharedArrayBuffer(8))` → `shared-buffer` (если
   транспорт не переносит SAB — `TransportRefusedRaw` → кейс будет `skipped`, это допустимо);
   40 вложенных `{ d: … }` → `depth-exceeded`; валидный `return` + лишний ключ `extra: 1` →
   `unknown-key`.
3. `hs-event-unknown-subscription` — raw `event` с `subscription: 'ws1-999'` и `value: 1` →
   endpoint остаётся `open`, `counters().droppedEvents` увеличился на 1, никаких failures.
4. `hs-progress-after-settle` — вызвать `descriptor` (дождаться), затем raw `progress`
   `{ t: 'progress', inReplyTo: <id того call>, progress: { completed: 1 } }` → endpoint `open`,
   failures пусты (по `endpoint.ts`, handler `case 'progress'`: progress после settle —
   «harmless noise»); вторая половина кейса на свежей паре: `progress` с `inReplyTo: 999_999`
   (никогда не открывался) → violation `unknown-reply-target`, `state === 'failed'`.
   Endpoint **не** менять.

Приёмка: `CI=true pnpm exec vitest run packages/testkit/test/capability-rpc-conformance.test.ts` —
все 8 тестов зелёные (в т.ч. loopback/`MessageChannel` проходят новые кейсы; «strict» транспорт
переводит новые hostile‑кейсы в `skipped` — проверьте, что тест `a validating transport …` по‑
прежнему ожидает ровно тот `skipped`‑список, который вы получите, и обновите ожидание, если он
включает ваши новые кейсы). `CONFORMANCE_CASE_IDS` — обновится сам. Обновить число кейсов в
docstring‑е `conformance.ts` («21 cases» → фактическое) и в IMPLEMENTATION_NOTES одной строкой.

### T‑B. Большие переносы и порядок через границу потока (приоритет 2)

Файл: `packages/testkit/test/hostile-worker.test.ts`, describe «positive control». Добавить тест
`demo-worker: 8 MiB transfer both ways keeps bytes intact and detaches the sender`:

- `const s = supervise('demo-worker')`, `openSession(s.endpoint)`;
- `const big = new Uint8Array(8 * 1024 * 1024); big.fill(0xab); big[0]=1; big[big.length-1]=2;`
- `const back = await (session['echo'] as (v: unknown) => Promise<Uint8Array>)(big)`;
- ожидания: `back.byteLength === 8 MiB`, `back[0] === 1`, `back[back.length-1] === 2`,
  `big.byteLength === 0` (detached после transfer);
- затем 200 параллельных `checked(i)` → массив `2*i` в порядке (`Promise.all`);
- `await s.release('done')` → `kind: 'closed'`, `exit.code: 0`.
  Лимит по умолчанию `maxTransferBytes` = 64 MiB — укладываемся.

Плюс новый fixture `packages/testkit/fixtures/hostile-worker/noisy.mjs` (HW «stderr flood»,
acc‑10): после `ready` пишет в `process.stdout` и `process.stderr` по 1 MiB текста (порциями по
64 KiB через `process.stdout.write`), потом обслуживает `terminate` как обычно
(`serveDemoChain({})`). Добавить id `'noisy'` в `HostileWorkerFixtureId` и `HOSTILE_WORKER_FIXTURES`
(`packages/testkit/src/capability-rpc/node/worker-harness.ts`), тест: `supervise('noisy', {
outputCapBytes: 16 * 1024 })`, `openSession`, подождать ~200 мс, `release` → `spawned.output.stdout.length <= 16*1024`,
то же для stderr, `spawned.output.truncated === true`.

### T‑C. acc‑9: идемпотентный `release()` (приоритет 2)

Тест в `hostile-worker.test.ts`: `supervise('demo-worker')`, `openSession`, затем
`await Promise.all([s.release('a'), s.release('b'), s.release('c')])` и ещё один `await s.release('d')`
после — все четыре промиса резолвятся **одним и тем же** объектом `end` (`toBe`), `terminations`
пуст, `exit.code === 0`, никаких unhandled rejections (vitest их поднимет как ошибку). То же для
`ignore-terminate`: три параллельных `release` → ровно **одна** запись в `terminations`.

### T‑D. acc‑8: stale generation через harness (приоритет 3)

В `wrong-session.mjs` добавить вариант `previous-generation` (`generation - 1`). В `hostile-worker.test.ts`
(describe «protocol violations») добавить `await violation('wrong-session', { variant: 'previous-generation' }, 'stale-generation')`.
Затем «restart»‑тест: `supervise('demo-worker', { session: 'restart-1', generation: 1 })` →
`openSession` → `release`; затем `supervise('demo-worker', { session: 'restart-1', generation: 2 })`
→ `openSession` работает; старый `remote` (из первой сессии) → `remote.call('descriptor')` отклоняется
`x3.host/rpc-endpoint-closed` (старый endpoint закрыт). Это фиксирует, что рестарт = новый endpoint +
generation, без «переезда» старых handles.

### T‑E (опционально). Мини‑README kit/harness

`packages/testkit/README.md` (нового файла нет — создать): 30–50 строк: что такое conformance kit,
как транспорт подключается (`runFramePortConformance(() => pair)`), как читать отчёт
(`describeConformanceReport`), как запускать hostile fixtures (`superviseFixtureWorker`), ссылка на
threat model §5.1. Без обещаний про production backend.

## 2. Отчёт (формат)

В конце — короткий отчёт Root‑у: список файлов, число тестов до/после (`pnpm test` — «Test Files /
Tests»), вывод гейтов из §0, найденные проблемы (если endpoint ведёт себя не так, как ожидает
кейс — **не править `packages/host`**, описать в отчёте с минимальным воспроизведением). Одна
запись в `IMPLEMENTATION_NOTES.md` (сверху, формат существующих записей: «что есть / что
доказано / что не входит»).
