# SC2 bank — M2 port-ready, 2026-09-04

M2 завершён в техническом scope и сдан владельцу на приёмку. Перенесены исходники и тесты банка,
работают шесть legacy-операций через native MK3 handlers, подтверждены data surface и запись через
host с повторным открытием. **Это `port-ready`; M3 начинается после отдельной приёмки M2.**

[Сводный receipt](port-bank-m2/receipt.json), [manifest архива](port-bank-m2/manifest.json),
[финальные команды и exit codes](port-bank-m2/final-gates/commands.json),
[точные шесть claims](port-bank-m2/claims.json).

## Исходники и границы переноса

Оракул — Git blobs `references/modkitmk2` на
`1a14ba4eddd0ae88de273348ebd44cfb98a0581d`. Его dirty-дерево не исправлялось и не использовалось
как доказательство этого SHA. Каждый реально загруженный файл, dependency snapshot, loader,
параметры операции и corpus manifest входят в проверяемый ключ оракула.

- Декларация: `migration/mk2-copy/sc2.json`, scope `sc2-bank` — **87 файлов, 217 import occurrences**
  с библиотеками M1. Отдельный scope M1 остался **50 файлов, 97 imports**.
- Банк добавляет **37 новых канонических файлов**; его исходный префикс содержит 38, включая
  общий SHA1, уже перенесённый в M1. Канонические назначения этих 38 файлов: **4044 строки,
  141828 байт**; учитываются runtime, тесты, fixture и документация.
- Runtime: `modkit-extensions-blizzard/starcraft2/src/lib/mk2/codecs/sc2-bank/`;
  тесты и fixture: `starcraft2/test/mk2/codecs/sc2-bank/`.
  Единственный SHA1: `modkit-core/packages/codec-kit/src/crypto/sha1.ts`, публичный импорт
  `@modkit/codec-kit/crypto/sha1`. В банке 18 новых runtime TS-файлов; SHA1 переиспользуется.
- Для банка зарегистрированы **32 правила / 33 occurrences** переписывания импортов.
  Copy gate проверяет, что публичный импорт SHA1 ведёт прямо к тому же каноническому файлу.
- Полные source/destination SHA256: [provenance](port-bank-m2/inputs/MK2-PORT-PROVENANCE.json)
  и входные декларации в `port-bank-m2/inputs/`. Exact copies защищены от форматирования и
  перевода строк. Legacy-алгоритмы не переписывались.
- В `migration/mk2-divergence/sc2.json` три **test-only** адаптации: путь browser-graph теста
  к тем же каноническим файлам; путь manifest fixture; три registry-теста, перенесённые на
  настоящий MK3 host (routing, unknown, duplicate). Поддельного registry нет.
  Обоснование: `migration/mk2-divergence/sc2-bank-test-adaptations.md`.

## Функции MK2 → реализация и поверхность MK3

Следующая карта покрывает 21 исходную функцию строки `row-sc2-bank.json`. Копирование и API-тесты
не закрывают автоматически 21 feature claim: они остаются `pending` до M7.

| Функции исходной строки                                                 | Каноническая реализация / адаптер                                                         | Поверхность и текущая граница                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Detect, typed open/read, descriptor, view.inspect                       | `detect.ts`, `document.ts`, `describe.ts`, `core/bank.ts`; native `src/sc2-bank/codec.ts` | S1/S8: descriptor и настоящий inspect handler; полные metadata contracts — M7                                    |
| Structural validation, typed values, custom child nodes                 | `core/validate.ts`, `core/bank.ts`; handler `validate`                                    | S8: exact validation JSON; зрелые MK3 XML/budget guards сохранены                                                |
| Raw-preserving edit.content, export.raw, full source.save-as            | `core/patcher.ts`, `core/bank.ts`; `patch-value`, `export-raw`, `save-as`                 | S4/S8/S9: исходные байты, edit plan, host commit/reopen; save-as возвращает XML как JSON string по контракту SDK |
| Signature calculation/patch, verify, path inference/override, SHA1      | `core/bank.ts`, `patcher.ts`, `path-core.ts`; canonical codec-kit SHA1                    | S8/S9: native sign/verify, per-document operation state, явная identity либо inference                           |
| SC2BankEditor, deterministic sort, value coercion/creation              | `core/editor.ts`, `core/bank.ts`                                                          | Публичный `/bank/core`; собственные MK2 API-тесты. Полная UI-проекция этих возможностей — M7                     |
| BankList parse/serialize/names/match, recursive discovery, load/save IO | `core/bank-list.ts`, `path.ts`, `io.ts`                                                   | `/bank/core` и `/bank/node`; зрелые BankList/workspace relations сохранены, семейная композиция — следующие вехи |
| CLI и разделение browser-safe core / Node entrypoint                    | `core/cli.ts`, `core.ts`, `node.ts`; package exports и bin `modkitx-bank`                 | CLI-тесты и public help; реальная browser bundle и strict TS consumer; installed UI acceptance — M8              |

| Legacy operation                  | Native operation / handler            | Successful identical | Both refused | Different |
| --------------------------------- | ------------------------------------- | -------------------: | -----------: | --------: |
| `view.inspect`                    | `view.inspect` / `inspect`            |                   40 |            0 |         0 |
| `asset.validate`                  | `asset.validate` / `validate`         |                   41 |            0 |         0 |
| `export.raw`                      | `export.raw` / `export-raw`           |                   40 |            0 |         0 |
| `edit.content`                    | `edit.content` / `patch-value`        |                   39 |            2 |         0 |
| `source.save-as`                  | `source.save-as` / `save-as`          |                   40 |            0 |         0 |
| `save.sign`                       | `blizzard/sc2-bank.sign` / `sign`     |                   39 |            1 |         0 |
| Дополнительный class API `verify` | `blizzard/sc2-bank.verify` / `verify` |                   40 |            0 |         0 |

Native codec подключён через `adaptGameArtifactCodec`. Публичные typed exports:
`@modkit/blizzard-starcraft2/bank/core`, `/bank/node`, `/bank/codec`.
Старый JS entrypoint делегирует скомпилированному TS-адаптеру.

Общие изменения ядра: `InspectionResult.operationStates` с валидацией известных уникальных IDs;
явный custom handler может заменить одноимённую default operation без дубликата;
diagnostic source использует native owner, legacy source сохраняется в `data.legacySource`;
добавлены прямые публичные exports контрактов assets/codec-manifest и detection types.
Mutation grants, edit plans и запись остаются у host. Без identity подпись disabled.
Улучшение raw-byte/BOM preservation в native MK3 сохранено и проверено отдельно.

Загрузчик настоящего MK2 теперь сохраняет также required и установленные optional peerDependencies
(в частности, пару LogTape). SHA256 проверенной версии loader:
`aff3a93efd6d5fc05864c7655b4a31e19fba2e5b4a2df301589f26bfd7912a7d`.
Scoped claims gate принимает только непустой точный список известных требований одного кодека,
всегда сохраняя global integrity; полный closure этим списком не заменяется.

## Оракул, корпус и отказы

Все семь финальных запусков использовали настоящий pinned `Sc2BankCodec` и pinned
`createMemoryAssetSource` против собранного native MK3 codec. Сравнивались реальные handlers,
а не вручную воспроизведённые metadata. Для каждого из шести ledger proofs зафиксированы
исполненный handler/contribution и успешные случаи из живого корпуса и pinned fixture.

Корпус: **38 реальных пользовательских SC2Bank**, одна pinned fixture и адресная синтетика.
Реальные банки читались на месте с проверкой SHA256; их байты в архив не копировались и не менялись.
[Повторная проверка всех оригиналов](port-bank-m2/final-gates/real-corpus-unchanged.json).
Fixture — `endofdreamsbank2.SC2Bank`, 696 байт,
SHA256 `925126109547379dd4325d3fe1ff8690255f51566786805794f8c415fc69d9ee`.
Использован точный `fast-xml-parser@4.5.6`. Подтипы SC2Bank здесь представлены typed values и
custom child nodes; это не бинарные подформаты.

Шесть legacy-операций: **242 случая = 239 successful identical + 3 both-refused + 0 different**.
Дополнительный verify: **40 successful identical**. Всего: **282 = 279 + 3 + 0**.
Синтетика проверяет int/fixed/flag/point/string, custom nodes, UTF-8, неизвестную цель patch и
валидационные границы, которых может не быть в живой выборке. Она дополняет реальный корпус.

Два отказа patch сопоставлены по `PATCH_REFUSED` с исходной причиной: legacy structured result
и SDK-wrapped exception — разные транспортные формы одного отказа. Подпись `ZArchive` с `<Bank/>`
отказывается с обеих сторон из-за отсутствия закрывающего тега. Отказы не считаются успешной записью.
См. `oracle/logs/sign-refusal-boundaries.json` и сохранённый результат до нормализации транспорта.

Отдельные шесть negative runs дали **7 different, 0 identical, 0 both-refused**. Они показывают
границы strict XML guards и отсутствующей signature identity: legacy CONFIG_INVALID против native
disabled operation. Эти результаты сохранены красными и **не применены как acceptance evidence**.
Положительный scope не заявляет одинаковое поведение на этих invalid/unconfigured inputs;
legacy-алгоритмы сохранены, зрелые guards MK3 не ослаблены, owner-drop не вводился.

Точные `cwd`, argv, exit codes и counts всех oracle runs:
[final-run.json](port-bank-m2/oracle/logs/final-run.json).
Receipt каждой операции хранит source closure digest, dependency/loader digests, corpus и input
hashes; snapshots источников и зависимостей сохранены отдельно с исходной картой связей.

## Выполненные проверки

| Проверка                                          | Найдено / выполнено / результат                                      | Доказательство                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Собственные тесты MK2                             | 12 файлов, 54 найдено, 54 выполнено, **54 passed**, 0 failed/skipped | `adapter/mk2-final.log`                                                       |
| Native codec + настоящий host + зрелые bank tests | 3 файла, **15/15**, 0 skipped                                        | `adapter/native-final.log`                                                    |
| Blizzard `pnpm run test:quick`                    | **204 passed**, 3 прежних M3 corpus skips; новых skip нет            | `adapter/blizzard-quick-final.log`                                            |
| Strict StarCraft2 TS build                        | exit 0                                                               | `adapter/freeze.json`                                                         |
| Public TS consumer, `skipLibCheck:false`          | exit 0 через реальные package exports                                | `adapter/public-consumer/command.txt`, `exit-code.txt`                        |
| Browser bundle public core и codec                | 248 inputs, 598 edges, **0 Node / 0 external imports**               | `adapter/public-consumer/browser-check.json`, `adapter/browser/metafile.json` |
| Публичный compiled CLI `--help`                   | exit 0                                                               | `adapter/cli-public-final.log`                                                |
| Core migration infrastructure                     | **91/91**                                                            | `core-seam/migration-tests-final.log`                                         |
| Core codec-kit                                    | **39/39**                                                            | `core-seam/codec-kit-tests-final.log`                                         |
| Core quick Vitest component                       | 23 файла, **386/386**; не выдаётся за весь корневой quick pipeline   | `core-seam/core-quick-final.log`                                              |
| Core ts-strict                                    | 8 packages, 0 structural/compiler errors                             | `core-seam/strict-gate-final.log`                                             |
| algorithms / legacy gates                         | 6 repos, debt 51, canonical 5, failures []; legacy clean 560 files   | `core-seam/*gate-final.log`                                                   |

Все перечисленные положительные команды завершились `exit 0`. Команды адаптера зафиксированы в
`adapter/freeze.json`; промежуточные pending/диагностические логи в архиве отражают момент запуска,
итог задают этот отчёт, сводный receipt и `final-gates/commands.json`.

После изменения loader повторены **все пять** принятых texture-харнессов:
DDS **1284**, BPTC **6400**, compressed **417**, encode **770**, image ops **1895**;
у каждого `exit 0`, `different 0`, stdout и corpus совпали с M1.
Общий счётчик 10766 сравнений включает 144 подтверждённых both-refused и три malformed encoder
cases без полной классификации. Отдельно зафиксированы 1280 legacy-only refusals: они не входят
в 10766 сравнений, MK3 для них не вызывался.
Это проверка отсутствия регрессии относительно M1, не утверждение об успешном декодировании
каждого отказа. [Отдельный receipt](port-bank-m2/loader-texture-regression/receipt.json)
сохраняет прежнюю классификацию. Принятые архивы M0/M1 не менялись.

## Поверхности и реестр

Оркестратор повторил из `modkit-extensions-blizzard`:

```text
node scripts/check-port-surfaces.mjs --codec sc2-bank --scope m2 --out ../artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/adapter/root-surfaces
```

[Receipt](port-bank-m2/adapter/root-surfaces/receipt.json): **pass, exit 0, 8 tests passed,
0 failed/skipped/todo; 12 scoped claims**. Проверены facts data source, шесть legacy handlers,
verify, host edit/commit/reopen, unsigned writer no-op commit/reopen, manifest и activation.
CLI отклоняет unknown codec, scope `full` и отсутствие явного `--out` (exit 2).

Это минимальная S6/S8/S9 поверхность M2. S1–S5 и S7 (полнота metadata/tree/table/text/subjects/
selector), S13 knowledge, полный S14 ledger и S15 end-user coverage остаются работой M7/M8.
Полнота S6/S8/S9 также требует семейной приёмки M7. Применимость S10 language, S11 runtime,
S12 media для bank будет явно зафиксирована в семейной матрице; M2 не объявляет их закрытыми.
Browser bundle проверяет import boundary; установленный browser/VS Code host им не заменяется.

Шесть operation claims переведены `pending → adapted` только через шесть успешных вызовов
`apply-port-evidence.mjs` с receipt-ами, затем `emit-codec-map.mjs` обновил производную карту.
[Журнал применения](port-bank-m2/core-seam/evidence-apply-final.json).
Изменены точные IDs `legacy/codec-manifest/modkit/sc2-bank/operation/` с суффиксами
`asset.validate`, `edit.content`, `export.raw`, `save.sign`, `source.save-as`, `view.inspect`.
**Aggregate capability IDs/уровни E не изменены:** `capabilities.yaml` и исторический bank E1 /
knownLoss остались прежними до полной приёмки; это не новая потеря и не её принятие.
Три защищённых E5 и прежние proof сохранены.

| Gate                                                             | Итог                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `check-mk2-copy --family sc2 --scope sc2-bank`                   | exit 0, 87 файлов / 217 imports                                  |
| `check-mk2-copy --family sc2 --scope m1-libs`                    | exit 0, 50 / 97                                                  |
| `check-feature-ledger --claims reports/port-bank-m2/claims.json` | exit 0, selected 6, pending 0                                    |
| Ledger integrity                                                 | exit 0, 891 total / 885 pending                                  |
| SC2-family closure                                               | **exit 1**, 303 pending; 21 bank feature claims входят в остаток |
| Project-global closure                                           | **exit 1**, 885 pending                                          |
| SC2-family source closure                                        | **exit 1**, pending M3                                           |
| Все 8 команд `migration:check`                                   | exit 0; integrity, не full closure                               |

Ожидаемые красные closure gates фиксируют открытый scope; красный closure не считается pass.

```text
migration:check registry: known debt 38 (must be empty by wave 6), new problems 0, stale baseline entries 0, unavailable checks 1 (must be restored by wave 6)
```

Unavailable common-coverage crosscheck остаётся прежним обязательством wave 6, а не зелёной проверкой.
Замороженный инвентарь — 206 legacy manifests; новая sc2-campaign учитывается authored-строкой.

## Ветки, фиксация и оставшаяся работа

| Репозиторий                | Ветка                  | Коммиты реализации                                |
| -------------------------- | ---------------------- | ------------------------------------------------- |
| modkit-core                | `sol/port-libs`        | `ce05ac2e`; принятую базу M1 `7ff0a9e2` не меняли |
| modkit-extensions-blizzard | `sol/port-sc2`         | `7af0b1c`, затем `ad53661` (scoped surfaces CLI)  |
| references/modkit-docs     | `sol/port-plan-review` | `b7b791d` (приёмка M1 и явные M2 gates)           |

Сводный receipt, manifest, этот отчёт и ledger фиксируются сопровождающим evidence-коммитом core.
Перед упаковкой Blizzard `git status --porcelain` пуст; core содержит только перечисленные M2
ledger/map и evidence-файлы. В docs сохранены пять прежних чужих untracked документов:
`CLAUDE_GA_IMPLEMENTATION_AND_KODA_REVIEW_2026-09-03.md`, `KODA-ARCHITECTURE-AUDIT.md`,
`KODA-SUGGESTIONS.md`, `KODA_AUDITORY.md`, `KODA_COMPETITORS.md` (все под `MK3/`).
Снимок команд и статуса до evidence-коммита — `port-bank-m2/final-gates/repositories.json`.
Merge, rebase и push не выполнялись.

Проверка `git diff --cached --check` для авторских изменений прошла. Для всего архива она даёт
exit 2: 755 замечаний к пробелам в исходных логах и снимках. Их байты сохранены вместе с hashes;
переформатирование доказательств не выполнялось. Это не результат runtime-тестов или closure.

| Остаток                                                                             | Владелец шага / зависимость                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| M3 — полная копия SC2-family                                                        | Оркестратор назначает исполнителя после приёмки M2; codec-kit builder P10 готов до второго кодека |
| M4–M6 — контейнерная композиция и остальные кодеки, новая campaign                  | Владельцы codec packages; P11 до контейнеров; campaign по CMP, без выдуманного legacy parity      |
| M7 — 21 bank feature claim, полный operation/feature/surfaces ledger, S1–S15 matrix | Исполнитель Blizzard + владельцы host/subject contracts; зависит от P1–P12 и M3–M6                |
| M8 — установленная приёмка SC2 в VS Code и семейный full closure                    | Оркестратор и владелец VS Code host; зависит от M7 и SC2 discovery P12                            |
| M9/M10 — project-global closure и retirement                                        | Оркестратор следующих волн; не блокирует техническую M2                                           |

Новых owner-drop/исключений не вводилось. Приёмка M2 владельцем пока `pending`.

Архив сохраняет исходные команды/пути и снимки байтов. Для свежего oracle replay нужен тот же
внешний корпус и исходный layout (либо его восстановление по snapshot links).
`node reports/port-bank-m2/verify.mjs` проверяет hashes архива и отчёта; это проверка целостности
сохранённых доказательств, не повтор тестов и не решение владельца о приёмке.
