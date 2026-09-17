# Аудит неиспользуемого кода — Этап M, первый проход (2026-09-17)

Ссылка на задачу: `reports/HANDOFF_SC2_CORE_RESTRUCTURE_CONTINUATION_2026-09-15.md` §13,
"Этап M. Очистка старого и неиспользуемого кода". Это АУДИТ: граф ссылок + список
кандидатов на удаление с доказательствами. Реальные удаления в этом проходе — только по
пункту 4 задания (safe: scratch-файлы, нулевые ссылки, не `src/lib/mk2`, тесты зелёные).

**Важно про среду выполнения:** во время работы диск C: дошёл до ~700 МБ свободных (из
474 ГБ). По прямому указанию координатора в этом проходе **не выполнялись `pnpm test`/
`pnpm install`/сборки** (риск ENOSPC при попытке верификации) и **не выполнено ни одного
реального удаления** — весь раздел ниже это кандидаты с доказательствами, отсортированные
по риску, включая один кластер (`packages/host/native-text/...`), который проверен
настолько тщательно, что достаточно только прогнать тесты, когда на диске появится место.

## Инструмент

`modkit-core/scripts/audit/unused-code.mjs` — детерминированный regex-сканер (без TS
compiler API), строит граф ссылок по всем шести репозиториям одним проходом:

- относительные импорты/require/dynamic import/`require.resolve`/`/// <reference path>`
  резолвятся внутри своего репозитория (с фолбэком `dist/**`→`src/**` и `dist/**`→`repo
  root` для двух разных конвенций outDir, увиденных в репозиториях, плюс `.d.ts` через
  строгую ступеньку RESOLVE_EXT);
- голые спецификаторы `@modkit/*` (и другие внутренние имена пакетов) резолвятся через
  `package.json#exports`/`main`/`module`/`bin` пакета-владельца, где бы он ни лежал —
  расширения читают `@modkit/*` из вендоренных тарболов (см. память
  `modkit-core-to-extensions-vendor-hop`), но исходные пути внутри тарбола зеркалят
  `src/` пакета в modkit-core, поэтому резолюция по имени+сабпути остаётся корректной;
  учитывается и обратное: любой файл, на который есть хотя бы один голый импорт
  где-либо в шести репозиториях, считается использованным;
  - JSON-манифесты (`codec.json`, `provider.json`, `contributions/*.json`, `package.json`)
    дают рёбра через ключи `entry`/`entrypoint`/`module`/`main`/`types`/`path`/`file`/
    `target`/`source`/`codec`/`provider`/`extends`/`bin`, плюс команды `node …` из
    `package.json#scripts`. Манифесты в подпапке `contributions/`/`schemas/` резолвятся
    относительно РОДИТЕЛЯ этой подпапки (проверено на `native-text/contributions/*.json`
    и `ea/big/contributions/codec-big.json`), с фолбэком на корень репозитория (для
    манифестов вида blizzard `sc2data/codec.json`, где `entrypoint` — путь от корня
    `dist/**`, а не от каталога кодека).
- ambient `*.d.ts` (глобальные `declare module`/`declare global`, не через `///
  <reference>`) исключены из отчёта об «неиспользуемых» — tsc подхватывает их через
  `tsconfig#include`, а не импорт; это отдельный класс ложных срабатываний, не мусор.
- пакетная точка входа считается «мёртвым пакетом», только если её имя не встречается
  ни разу как голый спецификатор во всех шести репозиториях, и только для `packages/*`
  (apps/examples/extensions/fixtures используются иначе — см. ниже).

Запуск: `node scripts/audit/unused-code.mjs [--json out.json]` из `modkit-core/`.

### Известные слепые зоны инструмента (задокументировано, не скрыто)

Во время калибровки на реальных файлах найдено и подтверждено вручную несколько классов
ложных срабатываний, которые инструмент **не может** закрыть регэкспом — они остаются в
списке ниже как "needs-owner"/"keep", не "safe":

1. **Динамический импорт по шаблонной строке.** SC2 `s2protocol`:
   `await import(\`./protocols/data/protocol${build}.js\`)`
   (`blizzard-common-formats/modules/s2protocol/index.js:39`) — 92 файла
   `protocols/data/protocolNNNNN.js` помечены «unreferenced», все живые.
2. **Воркеры/фикстуры, поднимаемые по собранному пути.** `new URL('demo-worker.mjs',
   FIXTURE_DIR)` в `packages/testkit/src/capability-rpc/node/worker-harness.ts` — все 13
   файлов `packages/testkit/fixtures/hostile-worker/*.mjs` живые.
3. **Расширения, грузящие себя по каталогу** (`extension-surface-sample`,
   `logical-resource-worker` и другие `packages/host/test/fixtures/*`) — обнаруживаются
   тестом по имени директории, не импортом; помечены как pkg-entries, но это не пакеты в
   обычном смысле — отфильтрованы из "мёртвых пакетов" отдельным правилом.
4. **Кодогенерация из TS в JS вне сборки tsc** (подозревается для
   `blizzard-common-formats/tools/s2protocol/source-data/protocol*.ts` — вероятный
   источник для `modules/s2protocol/protocols/data/*.js`, не проверено до конца, см.
   таблицу blizzard).

Итог: точное число «unreferenced» в каждом репозитории — **верхняя граница** кандидатов,
не финальный список на удаление. Каждая строка ниже — либо подтверждена вручную, либо
явно помечена «нужна ручная проверка».

## Сводка по репозиториям

| Репозиторий | Файлов исходного кода | Unreferenced (raw) | из них `src/lib/mk2` | non-mk2 | scratch-* | мёртвые пакеты (`packages/*`) |
|---|---:|---:|---:|---:|---:|---:|
| modkit-core | 1927 | 287 | 0 | 287 | 0 | 0 |
| modkit-extensions-blizzard | 1434 | 415 | 149 | 266 | 0 | 0 |
| modkit-extensions-ea | 63 | 14 | 14 | 0 | 0 | 0 |
| modkit-extensions-other | 248 | 45 | 42 | 3 | 0 | 0 |
| modkit-extensions-spring | 14 | 1 | 1 | 0 | 0 | 0 |
| modkit-extensions-warzone | 48 | 5 | 1 | 4 | 0 | 0 |

Полные списки регенерируются командой выше (не коммитятся как статичный дамп, чтобы не
протухали) — файл разового снепшота, использованного для этого отчёта, лежал во
временной scratch-директории сессии и удалён по требованию (диск был почти полон).

MK2-копии (`src/lib/mk2/**`) **не удалялись и не будут** в этом проходе — правило задания.
Их "unreferenced" в основном соответствует ожиданию: копии — самодостаточные деревья,
подключаемые через compat-барели (см. ниже), а не через прямые импорты каждого файла.

`scratch-*.mjs`: **не найдено ни одного** ни в одном репозитории (`find … -iname
'scratch-*'`, ноль хитов везде) — либо не создавались для этих репо, либо уже убраны
раньше. Кандидат закрыт.

`sc2data generated/`: **уже удалён** предыдущим агентом — память
`sc2-catalog-enum-authority-and-const-aliases` фиксирует "sc2data live schema =
`starcraft2/modules/data/shared/catalog-engine/sc2-schema/structure-types` (fixed
2026-09-15; dead `generated/` deleted)". Проверено: под
`modkit-extensions-blizzard/starcraft2/modules/data/**` каталога `generated/` для sc2data
больше нет (единственный `generated/` под `dist/` — build-артефакт, gitignored, не
трекается). Кандидат закрыт, повторно поднимать не нужно.

MK2-копии с disposition `superseded-with-receipt`: **ноль** во всех четырёх файлах
центрального реестра modkit-core (`migration/mk2-copy/{sc2,ea,other,blizzard-other}.json`
— эти файлы покрывают все extension-репозитории, не только modkit-core). Правило удаления
из задания №2 для этой категории пока не применимо ни к одному файлу.

## Дублирующиеся алгоритмы (crc32, mpqHash, ...) — НЕ трогать в этом проходе

`modkit-core/migration/algorithms-baseline.json` (существующий инструмент
`scripts/migration/check-algorithms.mjs`, уже управляет ratchet'ом) — авторитетный список,
переиспользован, не пересканирован заново:

**crc32 — 14 реализаций, все `existing-debt` кроме канонической:**
| Путь | Repo | Consumer |
|---|---|---|
| `packages/codec-kit/src/crypto/mpq.ts` | modkit-core | **canonical-copy** (единственный владелец) |
| `extensions/archives/src/{7z,gzip,rar,xz,zip}/codec.js` | modkit-core | каждый — свой собственный кодек-модуль (self-contained, единственный вызывающий — сам файл) |
| `extensions/documents/src/odf/package.js` | modkit-core | odf-кодек |
| `extensions/images/src/png/codec.js`, `extensions/images/src/writers/png-encoder.js` | modkit-core | PNG codec/writer |
| `packages/scene/src/output/png.ts` | modkit-core | scene PNG output |
| `packages/testkit/src/command-fixtures.ts` | modkit-core | тестовые фикстуры |
| `extensions/adobe-flash/src/fla/codec.js` | modkit-extensions-other | FLA codec |
| `extensions/uncommon-documents/src/docx/office-package.js` | modkit-extensions-other | DOCX package |
| `src/warzone-wz/range-codec.js` | modkit-extensions-warzone | WZ range codec |

Проверено вручную (`grep` по подстроке пути): ни один `extensions/archives/src/*/codec.js`
не импортируется другим файлом по прямому пути — каждый подключается через собственный
`codec.json`/package exports, т.е. это классический "каждый формат носит свою копию crc32"
паттерн, а не случайный дубль с живым альтернативным потребителем.

**mpqHash — фактически УЖЕ консолидирован**, память "MK2→MK3 codec port" и "container
reuse" устарели по этому пункту: единственная реализация —
`packages/codec-kit/src/crypto/mpq.ts` (canonical-copy). Все найденные потребители в
`modkit-extensions-blizzard` (`mpq/src/mpq/codec.js`, `mpq/src/mpq/fresh-writer.js`,
`.../mpq-impl.ts`) импортируют `mpqHash` из `@modkit/codec-kit/crypto` напрямую — не
реализуют свою версию.

## Устаревшие compatibility-классы (кандидат из п.2 задания)

`modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages/archives-processing/src/lib/crypto/index.ts`
— барель, который **явно** документирует себя как совместимость:
> "Compatibility barrel for the pinned archives-processing copy. MPQ primitives have one
> runtime owner in MK3. The copied archive package keeps its historical import surface
> while forwarding to that canonical owner."

Импортирует всё из `@modkit/codec-kit/crypto` и ре-экспортирует под старыми именами.
**Риск: keep.** Это не забытый мусор — файл существует специально, чтобы MK2-копия не
ломала свой исторический import surface. Удалять нельзя, пока MK2-копия
`archives-processing` не получит собственный disposition (ещё не назначен — см. открытые
вопросы).

Аналогичный паттерн, но НЕ MK2-копия — три файла в `modkit-core`,
**risk: safe (см. ниже, единственный реально удалённый в этом проходе кандидат)**:
`packages/host/native-text/json/json/codec.js` и `.../jsonc/codec.js` — однострочные
ре-экспорты из `../families/json/entrypoints/{json,jsonc}-codec.js`.

## `packages/host/native-text/*` — старый плоский layout, подтверждённый мёртвым (safe)

Обнаружено при проверке ложных срабатываний вокруг манифестов: под
`packages/host/native-text/json/` и `.../plain/` одновременно живут ДВА поколения одного и
того же кода — активное (`json/families/json/{codec.js,provider.js,detect.js,
entrypoints/*}`, `plain/txt/codec.js`, `*/editing/text-writer.js`) и старое плоское
(`json/formats.js`, `json/index.js`, `json/json/{codec,provider}.js`,
`json/jsonc/{codec,provider}.js`, `plain/index.js`).

Доказательства для каждого из 7 файлов старого layout:
- `packages/host/src/native-text.ts` (единственный статический потребитель native-text)
  импортирует ТОЛЬКО из `families/json/entrypoints/*` и `plain/txt/codec.js` —
  ни разу не ссылается на старые пути.
- Все 9 контрибьюшен-манифестов `packages/host/native-text/contributions/*.json`
  (`entrypoint` во всех `runtimeVariants`) указывают на `./json/families/json/
  entrypoints/{json,jsonc}-codec.js` — ни один не указывает на `json/json/codec.js` или
  `json/jsonc/codec.js`.
- Полнотекстовый поиск по всем шести репозиториям (кроме самих себя) на подстроки
  `native-text/json/formats`, `native-text/json/index.js`, `native-text/json/json`,
  `native-text/json/jsonc`, `native-text/plain/index` — 0 хитов в исходниках; 2 хита
  только в `packages/extension-manager/generated/offline-release/*.bundle.json`
  (сгенерированные бандл-манифесты старой сборки, перегенерируются, не источник истины).
  Ни один `*.test.*` файл их не упоминает.
- Ни один файл не менялся за последние 24 часа (`git log -1`: 30 Aug 2026 для обоих
  поколений — оба созданы одним коммитом-переносом), не dirty.

Список (7 файлов, **risk: safe**, готовы к удалению как только можно будет прогнать
`pnpm --filter @modkit/host test`):
```
packages/host/native-text/json/formats.js
packages/host/native-text/json/index.js
packages/host/native-text/json/json/codec.js
packages/host/native-text/json/json/provider.js
packages/host/native-text/json/jsonc/codec.js
packages/host/native-text/json/jsonc/provider.js
packages/host/native-text/plain/index.js
```
**Не удалено в этом проходе** — не было безопасно прогнать тесты при ~700 МБ на диске.
Первое, что стоит удалить в следующем проходе после `pnpm --filter @modkit/host test`.

## Прочие кандидаты modkit-core (`packages/*`, non-mk2, после фильтрации ложных срабатываний)

| Путь | Риск | Почему |
|---|---|---|
| `packages/codec-kit/src/embedded/embedded-vfs.ts` | needs-owner | Экспортирует `EmbeddedAssetEntry`/интерфейсы, коммент говорит "shape mirrors AssetResolver… `.glb`/`.gltf` is the only one today" — похоже на подготовленную, ещё не подключенную поверхность, не мусор |
| `packages/codec-kit/src/legacy/adapter.ts` | needs-owner | Барель `export * from './adapters.js'` с комментом "Plan-facing entry point" — намеренно отложенный API, не потребляется пока нигде |
| `packages/scene/src/uvm/position-edits.ts` | needs-owner | Реальная функция `readUvmPositionAccessor`, нет вызывающих — уточнить у владельца scene/uvm, не удалять вслепую |
| `packages/testkit/fixtures/hostile-worker/*.mjs` (13 файлов) | **keep** | Ложное срабатывание — грузятся `new URL(name, FIXTURE_DIR)` в `worker-harness.ts` |
| `packages/testkit/fixtures/extension-surface-sample/src/*.js` (3 файла) | **keep** | Используется `apps/mcp/test/extension-surface-smoke.test.ts` через путь каталога, не импорт |

## modkit-extensions-blizzard — крупные кластеры non-mk2 (266 файлов)

Не проверены поштучно (объём); ключевые кластеры с высокой уверенностью:

- **92 файла** `blizzard-common-formats/modules/s2protocol/protocols/data/protocolNNNNN.js`
  — **risk: keep**, ложное срабатывание, динамический `import(\`./protocols/data/
  protocol${build}.js\`)` в `s2protocol/index.js:39`.
- **~90 файлов** `blizzard-common-formats/tools/s2protocol/source-data/protocolNNNNN.ts` —
  **risk: needs-owner**. Похоже на источник кодогенерации для файлов выше (совпадающие
  номера версий), но цепочка "кто читает эти .ts и как" не прослежена до конца в этом
  проходе — нужна ручная проверка `tools/s2protocol/` перед любым решением.
- Остальные ~84 файла (`blizzard-common-formats/{codecs,modules,casc,compat}/**`,
  `blizzard-common-formats/compat/starcraft2-game/src/*.js` и т.д.) — не проверены
  индивидуально, требуют отдельного прохода с owner'ом blizzard-common-formats.

149 файлов под `src/lib/mk2/**` в этом репозитории — не в scope удаления (правило
задания), инструмент их находит по тем же причинам, что и остальные MK2-копии
(самодостаточные деревья с compat-барелями).

## modkit-extensions-ea / other / spring / warzone

- **ea**: после фикса резолюции манифестов (contributions-relative paths) все прежние
  false positives (mix/big/emperor/sage/westwood `codec.js`) закрылись — 0 non-mk2
  кандидатов, только 14 mk2-файлов (не трогаем).
- **other**: 3 non-mk2 кандидата не проверены индивидуально —
  `extensions/oc3-facefx/codecs/facefx-{actor,animset}/runtime.js`,
  `extensions/ps1/src/linked.js` — **needs-owner**, похожи на codec runtime-модули,
  возможно грузятся так же, как native-text (через `runtimeVariants[].entrypoint`),
  манифесты этого расширения не проверялись.
- **spring**: 1 файл, весь под `src/lib/mk2/` — не трогаем.
- **warzone**: 4 non-mk2 кандидата не проверены —
  `scripts/generate-modern-knowledge.mjs`, `src/data-subjects.js`,
  `src/warzone-pie/{semantic,writer}.js` — **needs-owner**.

## Мёртвые пакетные точки входа (`packages/*`)

**Ноль** во всех репозиториях после фильтрации apps/examples/extensions/test-fixtures
(эти категории по архитектуре не потребляются по имени пакета — apps запускаются
напрямую, examples/extensions грузятся по конвенции каталога, fixtures читаются тестами
по пути). Все настоящие библиотечные пакеты (`@modkit/host`, `@modkit/sdk`,
`@modkit/codec-kit`, `@modkit/scene`, `@modkit/ui`, `@modkit/vfs`, `@modkit/core`,
`@modkit/uv`, `@modkit/extension-manager`, `@modkit/testkit`, `@modkit/code`) имеют
подтверждённых потребителей.

## Что удалено в этом проходе

**Ничего.** Из-за критической нехватки места на диске C: (~700 МБ свободных в момент
проверки) не было возможности безопасно прогнать `pnpm test`/`vitest` для верификации
после удаления — по прямому указанию координатора выполнение отложено, отчёт закрывает
задачу как аудит. Единственный полностью готовый к удалению кластер (7 файлов
`packages/host/native-text/...`, см. выше) — следующий шаг сразу после `pnpm --filter
@modkit/host test` в зелёном состоянии.

## Открытые вопросы для владельца (по приоритету)

1. **`packages/host/native-text/{json,plain}` старый layout** (7 файлов) — удалить после
   зелёных тестов `@modkit/host`. Самый безопасный кандидат из всего прохода.
2. **`blizzard-common-formats/tools/s2protocol/source-data/*.ts`** (~90 файлов) — нужен
   ответ: это источник кодогенерации для `protocols/data/*.js` или дубль? Определяет,
   можно ли вообще их трогать.
3. **`packages/codec-kit/src/legacy/adapter.ts`, `.../embedded/embedded-vfs.ts`,
   `packages/scene/src/uvm/position-edits.ts`** — подготовленные/отложенные API-поверхности
   или забытые черновики? Нужен ответ владельца соответствующего пакета.
4. **`extensions/oc3-facefx/codecs/*/runtime.js`, `extensions/ps1/src/linked.js`**
   (modkit-extensions-other), **warzone `data-subjects.js`/`warzone-pie/{semantic,
   writer}.js`/`generate-modern-knowledge.mjs`** — не проверены, нужен второй проход по
   каждому расширению с проверкой его манифестов так же, как для native-text/ea.
5. **MK2 compat-барель `archives-processing/src/lib/crypto/index.ts`** — держать до
   назначения disposition MK2-копии `archives-processing` (пока нет ни одного MK2-файла
   с disposition `superseded-with-receipt` ни в одном репозитории).
