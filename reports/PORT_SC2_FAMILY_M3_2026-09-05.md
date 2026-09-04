# M3 — копия семейства StarCraft II и compilation closure

- **Дата:** 2026-09-05
- **Веха:** M3
- **Стадия:** `family-copy-ready`
- **Вердикт технических критериев M3:** `pass`
- **Приёмка владельцем:** `pending`
- **Следующая веха:** M4 начинается только после отдельной приёмки M3 владельцем.

## Принятый scope

M3 фиксирует полную копию исходников, тестов и библиотечной dependency closure семейства SC2. Он не
подключает тела остальных кодеков к production runtime и не заявляет Z1–Z7, `port-ready` отдельных
кодеков или `full` семейства. Принятый ранее `sc2-bank` остаётся единственным подключённым legacy
кодеком; M4–M6 выполняют контейнерную композицию и C1–C8 соответствующих кодеков.

Источник — только Git object database `references/modkitmk2` на commit
`1a14ba4eddd0ae88de273348ebd44cfb98a0581d`. M3 copy/refreeze/check вызывают pinned source с
`observeWorkingTree: false`: изменённое рабочее дерево MK2 не читается и не меняется. Отрицательный
тест заменяет tracked-файл каталогом: обычное наблюдение падает, отключённое возвращает pinned blob и
`null` для обоих полей наблюдения.

Полная декларация и provenance содержат **1460 файлов / 4840 import occurrences**:

- **842** source/support/fixture records и **618** test records;
- **50** dependency records: 32 non-builtin records поверх 14 уникальных manifest paths;
- **630** явных import dispositions;
- destination owners: core `codec-kit` — 94, Blizzard `starcraft2` — 1301, Blizzard `models` — 65;
- Heroes of the Storm source records — 0;
- bootstrap M1 и M2 переиспользованы: `m1-libs` **50/97**, `sc2-bank` **87/217**.

XML сохранён одной dependency-neutral unit в `packages/codec-kit/src/legacy/xml`; новый package XML не
создан. Чистые model-алгоритмы размещены в `codec-kit/model-math`, compatibility contracts — в
`codec-kit/legacy/models`, embedded VFS остаётся copied-unwired. Codec bodies находятся в
`starcraft2/src/lib/mk2` и `models/src/lib/mk2`, но исключены из обычных production tsconfig и exports
до соответствующего C1. Отдельный strict project компилирует только принятые M3 processing/support
units.

## Archive boundary

Все шесть исходных suite скопированы, присутствуют в provenance и проверяются по pinned SHA с
разрешёнными import rewrites. Всего — **49 деклараций `it`**.

| Suite                                | Декларации | Vitest leaves | Результат M3       | Следующий шаг |
| ------------------------------------ | ---------: | ------------: | ------------------ | ------------- |
| `cache.spec.ts`                      |          8 |             8 | `pass`, 8/8        | —             |
| `index.spec.ts`                      |         27 |            29 | `deferred-by-plan` | M4/P11        |
| `optional-extension-loaders.spec.ts` |          1 |             1 | `deferred-by-plan` | M4/P11        |
| `source.spec.ts`                     |          2 |             2 | `deferred-by-plan` | M4/P11        |
| `vfs-browser-boundary.spec.ts`       |          2 |             2 | `deferred-by-plan` | M4/P11        |
| `vfs-mount.spec.ts`                  |          9 |             9 | `deferred-by-plan` | M4/P11        |

Пять отложенных suite требуют исключённых registry/generated 44-codec catalog, optional loader либо
полного VFS mounting/P11. Они не отмечены как pass, skip или unavailable. M4 обязан скомпилировать и
выполнить их без stub и без изменения скопированных тестов.

## Проверки

Все нормативные команды выполнялись после implementation-коммитов и завершились `exit 0`.

| Проверка                                                         | Результат                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `check-mk2-copy --family sc2 --scope family`                     | **1460 files / 4840 imports**                                                                   |
| `check-mk2-copy` для `m1-libs` и `sc2-bank`                      | **50/97**, **87/217**                                                                           |
| Core codec-kit, M3 source и M3 test typechecks                   | 0 ошибок                                                                                        |
| Blizzard M3 library, production SC2 и isolated models typechecks | 0 ошибок                                                                                        |
| Archive `cache.spec.ts`                                          | **1 файл, 8/8**                                                                                 |
| Algorithms tests / gate                                          | **17/17**; debt 51, canonical 5, copied-unwired 2, new 0, failures `[]`                         |
| Pinned oracle / copy tests                                       | **3/3**, **45/45**                                                                              |
| Migration infrastructure                                         | **121/121**                                                                                     |
| Core strict                                                      | 8 packages, 0 problems                                                                          |
| Core quick Vitest                                                | **23 файла, 386/386**; extension-manager **62/62**                                              |
| Blizzard full `test:quick`                                       | build и pipeline `exit 0`; normal Vitest **31 файлов, 153 passed, 3 прежних conditional skips** |
| Portable Blizzard bundle внутри quick                            | **2/2**                                                                                         |
| Normal tier collection                                           | quick **31**, owner **34**, real **11**; staged M3 files во всех трёх — **0**                   |
| Dedicated M3 collection                                          | **12 projects / 76 files**; archive files — только cache; codec body files — **0**              |

Два exact historical algorithm body остаются copied-unwired и недостижимы из production TypeScript,
authored JavaScript, package exports/bin и contribution runtime entrypoints:

- map PNG `crc32#0`, SHA256
  `d7cd50e2c2035b7091d070071a3abbff30a3eecf25f049160c8f1bc5a9b90737`, выход
  `canonicalize-before-activation`;
- `XMLReader.parseXML#0`, SHA256
  `f27478587d8d07973c59c136ec14cae5916418a2c2baaf09df2995f2360909c0`, выход
  `classify-delegate-before-activation`.

Gate обходит nested export arrays, требует точный
`modkit.contributionManifests == ["./contributions/*.json"]`, запрещает stale `dist` fallback и
допускает ровно эти два destination/symbol ID. Три новые отрицательные проверки входят в 17/17.

## Диагностический 76-file support run

Полный запуск той же 76-file коллекции сохранён как диагностический, а не нормативный green gate M3:
**651 tests = 615 passed + 29 прежних conditional skips + 7 failed + 0 todo**. Шесть ошибок — намеренный
отказ принятого M1 compile-only registry shim активировать вторую routing plane. Их закрывает C1
соответствующих кодеков. Одна replay boundary проверяет старую физическую sibling-топологию через
`node:fs`; её закрывает replay C1. Изменять copied tests, добавлять shadow source, skip или runtime stub
в M3 запрещено. [Диагностическая сводка](port-sc2-family-m3/diagnostic/summary.json) сохраняет все семь
имён и назначения.

## Реестр и целостность

`migration:check` завершился `exit 0`; принятые M0/M1/M2 evidence и три E5 сохранены. Дословная строка:

```text
migration:check registry: known debt 38 (must be empty by wave 6), new problems 0, stale baseline entries 0, unavailable checks 1 (must be restored by wave 6)
```

Unavailable cross-check и 38 frozen debt остаются прежними обязательствами wave 6. M3 не поднимает
capability evidence и не выдаёт незавершённый SC2-family feature closure за green.

Core implementation diff и Blizzard authored/config/provenance diff проходят whitespace-check.
Полный Blizzard commit diff воспроизводимо сообщает 44 historical whitespace locations в 44
provenance-bound copied files; вне copied trees — 0. Эти байты намеренно не форматировались: их
содержательным gate является `mk2-copy:check`, который прошёл для всех 1460 записей.

## Ветки и коммиты

| Репозиторий                  | Ветка                  | Implementation commit                      | Статус реализации                                  |
| ---------------------------- | ---------------------- | ------------------------------------------ | -------------------------------------------------- |
| `modkit-core`                | `sol/port-libs`        | `5ea667fe4fc3305283d0e2b3963ffeb7ef842563` | clean до evidence                                  |
| `modkit-extensions-blizzard` | `sol/port-sc2`         | `1751abd0d8b54cc03869d996dd2de5550729279d` | clean                                              |
| `references/modkit-docs`     | `sol/port-plan-review` | `917dca67ee0720d735d8af11756608f4ccf30962` | пять прежних unrelated untracked файлов не тронуты |

Коммиты содержат 63 и 1339 путей соответственно, вне явных allowlist — 0. Evidence фиксируется
отдельным core-коммитом, содержащим этот файл. Merge, rebase и push не выполнялись.

## Evidence и остаток

[Receipt](port-sc2-family-m3/receipt.json), [manifest](port-sc2-family-m3/manifest.json) и
[`verify.mjs`](port-sc2-family-m3/verify.mjs) образуют компактный replayable archive. Verifier не
доверяет dirty MK2 checkout: он пакетно читает 1460 source blobs из pinned commit и 1460 destination
blobs из двух implementation commits, применяет и проверяет каждую declared rewrite/divergence,
проверяет dependency manifests, повторяет три copy gate, algorithms, typechecks, точные test lists,
archive 8/8 и `migration:check`. Запуск:

```text
node reports/port-sc2-family-m3/verify.mjs
```

Открытая работа:

- M4/P11 — namespace/container composition и пять archive suite;
- M5–M6 — C1–C8 остальных SC2-кодеков и authored `sc2-campaign` по CMP без фиктивного MK2-паритета;
- M7 — полные S1–S15, operation/feature ledgers и surfaces;
- M8 — P12 discovery, installed VS Code acceptance и SC2-family `full`;
- M9/M10 — project-global closure, долг и retirement.

Новых owner-drop и изменений поведения MK2 нет. M4 ожидает отдельной приёмки M3 владельцем.
