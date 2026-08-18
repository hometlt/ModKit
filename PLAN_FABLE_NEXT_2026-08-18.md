# План Fable после NXT‑105 (2026‑08‑18)

Baseline: `00e1f06` (Root) + незакоммиченные Fable NXT‑105/103‑P/OPUS‑request. Подчинён
`PLAN_NEXT_A2_A3_WORKER_VFS_APPS_2026-08-18.md` и `TASK_ASSIGNMENTS_POST_FABLE_REVIEW_2026-08-18.md`
(exclusive scopes §2, merge order §8). Ничего из ниже не расширяет публичный SDK ABI и не меняет
owner‑документы; каждый пункт имеет свой file scope, свои gates и «готово».

## 0. Состояние дерева на момент плана

- Root закрыл NXT‑104 (`7ce98ad`), NXT‑100/101 (`88a957d`), NXT‑109 (`c0134fb`), implicit universal
  match (`05f518f`) — коммитами; NXT‑105/103‑P/OPUS‑request Fable лежат незакоммиченными
  (`packages/host/src/execution/{protocol,surface,handles,endpoint,index}.ts`,
  `packages/host/test/execution-*.test.ts`, два документа, запись в IMPLEMENTATION_NOTES).
- Полный `pnpm check` **был красным** на trunk независимо от файлов Fable: `tsc -p tsconfig.tooling.json`
  падал на `packages/host/test/subject-open.test.ts:638/658` (`globalThis.__x3EmptyMatchImports` без
  `declare global`). Исправлено Fable трёхстрочным объявлением в тесте (файл Root, правка только
  типовая; сообщено явно).
- Второй полный `pnpm check` поймал два своих: (1) `check:legacy` — в `execution/endpoint.ts`
  ключ/параметр `capability:` (5 мест) — переименовано в `remote`, wire‑domain стал `x3.host/rpc`
  (решение 57: слово `capability` не входит в wire‑словарь; «capability‑RPC» остаётся только
  названием в прозе); (2) `reference-codecs-packed`/`text-data-packed` упали по таймауту `pnpm pack`
  (300 s) под нагрузкой параллельных dev‑серверов (`--serve` watchers) — в изоляции проходят за
  16 s / 75 s; это environmental flake, не дефект кода.
- Третий полный `CI=true pnpm check` (2026‑08‑18, HEAD `00e1f06` + незакоммиченные файлы Fable):
  **зелёный** — `catalogs:check`, typecheck, bundle 40 entries, 70 test files / 539 tests,
  `apps:check` 16 cases, `legacy gate` clean (375 files), `app-import gate` clean (171),
  `extension-inventory gate` clean (18); `CHECK_EXIT=0`. F0 со стороны Fable выполнен; коммит — за Root.
- Побочный факт для Root: `pnpm build` перезаписал `scripts/bundle-hashes.json` (одна запись —
  `packages/host/dist/index.js`). Причина не в файлах Fable (модули `execution/{protocol,…}` не
  экспортируются из `host/src/index.ts`, в бандле их нет), а в `88a957d`/`05f518f`: host‑бандл
  получил `ExecutionBackendRegistry`, а хэш‑файл последний раз обновлялся в `7ce98ad`. Без этой
  перезаписи `pnpm bundle:check` на trunk красный — файл нужно включить в ближайший коммит Root.
- **F0 закрыт Root** — `4d2220f feat(host): add bounded capability rpc core` (полный check зелёный,
  541 tests); Root добавил учёт отменённых запросов в лимите pending и immutable snapshot surfaces.
  Root разрешил F1 в `packages/testkit/src/capability-rpc/**` + `packages/testkit/test/**`.
- **F1 выполнен** (2026‑08‑18, незакоммичено): conformance kit + self‑test (8 тестов: loopback
  microtask/macrotask, Node `MessageChannel` в двух стилях listener, 4 негативных «сломанных»
  транспорта). Kit нашёл первый реальный дефект core — fire‑and‑forget `release` после late reply
  ломал endpoint (`unknown-reply-target`) на реальных event‑loop hops; исправлено в `endpoint.ts`
  (`discardHandle`) с регрессионным тестом на macrotask‑wire. Одно enabling‑изменение вне testkit:
  subpath export `@modkitx-x3/host/execution` в `packages/host/package.json` (41 bundle entry).
  Подробности — IMPLEMENTATION_NOTES «F1 — FramePort conformance kit».
- **F4b выполнен** (2026‑08‑18, незакоммичено): Node worker harness (`spawnFixtureWorker`,
  reference supervisor `superviseFixtureWorker`, `demoWorkerPair`) в
  `packages/testkit/src/capability-rpc/node/`, 14 hostile fixtures `packages/testkit/fixtures/hostile-worker/*.mjs`
  (HW‑01…08, 10…12, 14 + `demo-worker`), acceptance `packages/testkit/test/hostile-worker.test.ts`
  (14 тестов над реальными `worker_threads`), kit получил **host‑only режим** и проходит через
  реальный поток (`runFramePortConformance(identity => demoWorkerPair(identity))`: 16 passed /
  5 skipped). HW‑09/13 и acc‑6/7/8/9/11/12 — против backend‑а R3. Механические продолжения вынесены в
  `REQUEST_AGENT_TESTKIT_FOLLOWUPS_2026-08-18.md` (для Opus/Sonnet). Подробности — IMPLEMENTATION_NOTES
  «F4b», threat model §5.1.
- **Root = Fable (с 2026‑08‑18, по решению владельца).** Закоммичено как Root: F1/F4b handoff
  (`357c520`, `172a255`, `09b1e61`), gate‑ignore для `NexusForgeUI/` (`9dea937`), **R1** NXT‑103 в SDK
  (`004206f`), **R2** adapter + ABI surfaces + protocol v1.1 kinds (`6456fc1`, `f76c173`), **R3a** Node
  worker backend (`b68f58a`), **R3b‑1** verified multi‑file loading — реальный `text-json` codec в worker'е
  (`4fed319`), **R3b‑2** signal/progress в объектах‑аргументах, `contracts.resolve` из worker'а, service‑arm
  surfaces, реальный `open()` в worker'е (`aa5e59b`); follow‑ups Opus приняты (`745a7f6`), fix bundle
  tsbuildinfo (`221cc09`). Opus параллельно ведёт `REQUEST_AGENT_TESTKIT_FOLLOWUPS` в
  `packages/testkit/**` (не коммичу его файлы). Дальше: R3b (per‑file digests в inventory → gate
  передаёт entrypoint digest; `contracts`/`operations` marshalling; wiring backend в composition roots
  с policy; acc‑8/acc‑12), затем R4/R5 (NXT‑101B, probe grant), R6 (Electron IPC → capability‑RPC).
- **Состояние гейтов после F1** (та же последовательность, что `pnpm check`, но lint/format без
  `NexusForgeUI/`): build 41 entries, bench gate, eslint, prettier, **71 test files / 551 tests**,
  schemas/manifests/tokens/icons/facilities, `apps:check` 16 cases, `legacy gate` clean (380),
  `app-import gate` clean (176), `extension-inventory gate` clean (18) — `CHECK_EXIT=0`. Обновлён
  `scripts/test/bundle.test.ts` (список published entries +1 — следствие subpath export). Полный
  `pnpm check` как есть **красный только из‑за посторонней
  директории `NexusForgeUI/`** в корне репозитория (21 файл, untracked, создана 2026‑08‑18 10:37, не
  Fable): `eslint .` даёт 19 ошибок в её `.js`, `prettier --check .` — 20 файлов. Fable её не трогает;
  решение (вынести из репозитория или добавить в ignore) — за владельцем/Root.

## 1. Инварианты, которые план обязан сохранить

1. Один продуктовый путь открытия — `openSubject`; RPC‑core не создаёт второй.
2. Method surface — одна authority (NXT‑103 в `sdk`); RPC‑core, Electron IPC и transports **не**
   держат собственных allowlist'ов.
3. `worker-brokered` становится доступным только с реальным backend; понижения профиля нет.
4. Транспорт проходит **тот же** hostile‑suite, что и loopback‑пара; «свой» протокол у транспорта запрещён.
5. Fable не редактирует `subject-open.ts`, `security/**`, `resolution/**`, `execution/backend*.ts`,
   `apps/**`, `packages/sdk/**` (только review), root `package.json` (кроме команды Root).

## 2. Последовательность (F‑шаги Fable, R‑шаги Root; merge order §8 assignments)

| #   | Шаг                                                                                                                                                                                                                                                                                                                                                                                                                          | Кто                                | Scope (files)                                                                                                                                                                                                            | Готово, когда                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| F0  | Handoff NXT‑105: полный `pnpm check` зелёный, коммит `feat(host): capability-rpc core v1` + docs (по слову Root либо самим Root)                                                                                                                                                                                                                                                                                             | Fable → Root                       | только уже созданные файлы Fable + фикс типа в `subject-open.test.ts`                                                                                                                                                    | `pnpm check` зелёный на trunk с NXT‑105 внутри                                                                |
| F1  | **Готово (2026‑08‑18).** **FramePort conformance kit**: `packages/testkit/src/capability-rpc/{loopback,conformance}.ts` — переиспользуемая loopback‑пара (структурный clone + transfer, порядок, injection/taps) и функция `runFramePortConformance(createPair)`, которая гоняет round‑trip + весь hostile‑suite против **любого** транспорта                                                                                | Fable                              | новые файлы в `packages/testkit/src/capability-rpc/**`, тест `packages/testkit/test/capability-rpc-conformance.test.ts` (loopback проходит сам себя); host‑тесты остаются unit‑suite (host не может зависеть от testkit) | kit зелёный на loopback; Root подключает его к NXT‑114/115/401 как обязательный тест                          |
| R1  | Root review + landing NXT‑103 в SDK/schema с drift‑gates (по `PROPOSAL_NXT103_…`)                                                                                                                                                                                                                                                                                                                                            | Root                               | `packages/sdk/**`                                                                                                                                                                                                        | схема, типы, 13+aux surfaces, `satisfies keyof` гейт                                                          |
| F2  | **Review NXT‑103 landing** (read‑only): чек‑лист §3.1 ниже; hostile fixtures для malformed surface; тест «foreign contract с surface проходит RPC через adapter без правок host»                                                                                                                                                                                                                                             | Fable                              | review‑документ `REVIEW_FABLE_NXT103_<date>.md`; фикстуры в моих host‑тестах                                                                                                                                             | ACCEPT/REVISE; P0 нет                                                                                         |
| R2  | Adapter `DataSourceSurfaceV1 → CapabilitySurface` + ABI‑surfaces (module/codec/session/provider) в host                                                                                                                                                                                                                                                                                                                      | Root                               | `packages/host/src/execution/surface-adapter.ts`, `abi-surfaces.ts`                                                                                                                                                      | RPC‑core резолвит все 13 стандартных surfaces из adapter'а; loopback round‑trip реальных data‑source объектов |
| F3  | **Protocol v1.1 в своём scope** по решениям R1: `optional`‑методы + `has[]` на handle‑ref, `leasedValue`/`entry-source` для `openEntry`, `nextBatch` для `iterable`, API эмиссии `progress` на исполняющей стороне                                                                                                                                                                                                           | Fable                              | `packages/host/src/execution/{protocol,endpoint,handles,surface}.ts`, `execution-*.test.ts`                                                                                                                              | обратная совместимость с v1 доказана тестом; hostile‑suite расширен                                           |
| F4  | **Threat model + acceptance для Node worker backend (NXT‑114)** до реализации: verify‑after‑load, `resourceLimits`, generation bump on restart, watchdog terminate, brokered source reads; затем pre‑merge аудит реализации Root. **Документ готов**, **fixtures + harness + acceptance готовы (F4b)** — `THREAT_MODEL_WORKER_BOUNDARY_2026-08-18.md` (T1–T14, acc‑1…12, HW‑01…14, чек‑лист аудита, 4 открытых вопроса Root) | Fable                              | документ `THREAT_MODEL_WORKER_BOUNDARY_<date>.md`; hostile fixtures: `packages/host/test/fixtures/hostile-worker/*.mjs` (worker, шлющий мусор/зависающий/падающий/раздувающий transfer)                                  | Root‑backend проходит conformance kit + hostile workers; аудит без P0                                         |
| R3  | Node worker backend (`worker_threads`) с termination, cancellation, `resourceLimits`                                                                                                                                                                                                                                                                                                                                         | Root                               | `packages/host/src/execution/node-worker*.ts`, `host/node/**`                                                                                                                                                            | F4 acceptance                                                                                                 |
| R4  | NXT‑101B: bounded data‑only signature index, renamed PNG `.dat`                                                                                                                                                                                                                                                                                                                                                              | Root                               | `subject-open.ts`, resolver                                                                                                                                                                                              | fixtures F6                                                                                                   |
| F6  | **Detection hostile fixtures + review** для R4/R5: renamed PNG, polyglot PNG+ZIP, коллизия magic, signature‑index читает ≤ N байт, probe grant ⊂ open grant, чтение вне probe‑диапазона через worker‑proxy отбивается host‑broker'ом                                                                                                                                                                                         | Fable                              | fixtures под `packages/host/test/fixtures/detection-hostile/**` (данные) + review                                                                                                                                        | R4/R5 зелёные на них                                                                                          |
| R5  | Отдельный probe grant через brokered execution seam                                                                                                                                                                                                                                                                                                                                                                          | Root                               | `security/**`, `subject-open.ts`                                                                                                                                                                                         | F6                                                                                                            |
| R6  | Electron IPC → capability‑RPC (`main.cjs` без `DATA_SOURCE_METHODS`/`REMOTE_VALUE_METHODS`/handle map; preload как `FramePort` над `MessagePort`)                                                                                                                                                                                                                                                                            | Root                               | `apps/electron/**`                                                                                                                                                                                                       | F5                                                                                                            |
| F5  | **Аудит R6**: conformance kit против Electron‑порта; renderer bundle без кодеков (гейт остаётся); cancel из UI доходит до `cancel` frame; utечка handles = 0 после закрытия вкладок                                                                                                                                                                                                                                          | Fable                              | review + запуск kit из `apps/electron/test`                                                                                                                                                                              | без P0                                                                                                        |
| F7  | После стабилизации worker/VFS: дизайн MK2‑конвертера (по `REPORT_MK2_ALLOCATION_*`) и parity‑harness; review VFS‑контрактов V1 (`common.vfs/mount                                                                                                                                                                                                                                                                            | container`) при старте NXT‑200/201 | Fable                                                                                                                                                                                                                    | документы + `scripts/report-*`; код по отдельному согласованию                                                | отдельный план |

Параллельность: F1 и F4 не ждут R1; F2 ждёт R1; F3 ждёт решений R1 (D‑7); F5/F6 ждут
соответствующих R‑шагов. Root‑последовательность (1 → 6 из его отчёта) не меняется; F‑шаги
вставляются перед/после нужных R‑шагов как gate‑условия.

## 3. Чек‑листы приёмки

### 3.1 NXT‑103 landing (F2)

- schema data‑source arm: `surface.methods[name] = {kind, signal?, optional?, wrapper?, result?, args?, returns?, limits?}`; `lease` ⇒ `result` обязателен, иначе — запрещён; `releaseVia` указывает на `value`‑метод; `propertyNames` = lowerCamel; drift‑гейт emitted JSON ↔ TS.
- `STANDARD_DATA_SOURCE_SURFACES` пришпилены `satisfies Record<keyof <Interface>, …>` (optional через `Partial` + `optional: true`) для всех 13 + `common.view/encoded-media@1`.
- adapter даёт `validateArgs`/`validateReturn` из `args`/`returns` (Ajv precompiled) и лимиты; отсутствие схем = только bounded‑wire‑value.
- негативы: unknown kind, lease без result, `wrapper` у non‑lease, `releaseVia` на iterable, дубликат метода в двух regs, foreign contract без surface → inspectable, но не активируемый через RPC.
- **позитив A‑33‑класса**: новый data‑source контракт (fixture) с surface → проходит RPC round‑trip без изменения host/app кода.
- в `main.cjs` после R6 не остаётся ни `DATA_SOURCE_METHODS`, ни `REMOTE_VALUE_METHODS`.

### 3.2 Node worker backend (F4 → R3)

- entry загружается только после ticket/digest/entrypoint checks; **verify‑after‑load** (перехеш артефакта после `ready`, terminate при расхождении); `resourceLimits` заданы и превышение даёт structured failure; hang → deadline/watchdog → `terminate` → новая generation; crash → `peerClosed` → pending rejected `x3.host/rpc-peer-exited`, leases освобождены; никаких путей/credentials в `load` кроме module URL артефакта; байты источника — только через host‑broker (RPC callbacks), не `node:fs` в worker'е (SB‑2 честно не обещается: diagnostic говорит это словами).
- transport проходит `runFramePortConformance` + hostile‑workers (мусорные кадры, non‑monotonic id, oversize transfer, prototype‑pollution keys, duplicate reply, cross‑generation handle).

### 3.3 Electron IPC (F5 → R6)

- один RPC‑core, один surface adapter; renderer получает `materialize()`‑объекты, ничего не знает о методах вне surface; `cancel` из UI → `cancel` frame; закрытие вкладки → `release` каскадом; счётчики `counters()` = 0 после закрытия всех сессий; bundle gate `renderer.js` без кодеков — без изменений.

## 4. Риски и как они закрыты

- **Двойная authority surface** (главный риск review): закрывается R1+R2 и чек‑листом 3.1; до этого RPC‑core не подключается к продуктовому пути.
- **Транспорт со «своей» семантикой**: закрывается F1 (обязательный kit) — Root не пишет transport без прогонки kit'а.
- **Красный trunk в общем дереве**: правило — каждый handoff завершается полным `pnpm check`; тип‑ошибка в `subject-open.test.ts` показала, что «scoped tsc» недостаточно — в чек‑лист handoff'а добавить `tsc -p tsconfig.tooling.json`.
- **Ползучее расширение SDK ABI со стороны Fable**: F3 остаётся в `execution/*`; всё, что требует ABI‑patch (`entry-source`, progress options), идёт через Root.

## 5. Что Fable начинает немедленно (не ждёт решений)

1. F0 — довести полный `pnpm check` до зелёного и передать Root на коммит.
2. F1 — conformance kit в `packages/testkit/src/capability-rpc/**` (loopback + `runFramePortConformance`), перевод `execution-endpoint.test.ts` на kit; согласование scope testkit с Root — одно слово, файлов Root не касается.
3. F4 — threat model worker boundary + hostile worker fixtures (без транспорта: fixtures = скрипты и ожидаемые исходы).

Остальное — по мере приземления R1/R3/R4/R6.
