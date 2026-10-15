# modkit-core — правила для агентов

Сначала прочитай общий свод правил рабочего пространства: `../AGENTS.md`
(в корне рабочего пространства). Этот файл только дополняет его для ядра.

## Что здесь

- `packages/` — `core`, `sdk`, `vfs`, `host`, `codec-kit`, `scene`, `uv`, `code`, `ui`,
  `extension-manager`, `testkit`. Назначение и направление зависимостей — `../AGENTS.md` §3.
- `apps/` — `vscode`, `electron`, `web` (PWA, `apps/web/dist-app` закоммичен), `cli`, `mcp`,
  `lsp` (общий адаптер language contributions), `server`, `automation-host`.
- `extensions/` — встроенные format-neutral расширения (archives, audio, data, documents, images,
  models, translation, vector, video). Игровых соглашений здесь нет.
- `migration/`, `scripts/migration/`, `reports/parity/` — feature ledger, operation map, receipts,
  решения владельца (`reports/parity/owner-decisions/`). Правила храповика — `../AGENTS.md` §6.
- `adr/` — архитектурные решения. Долгоживущая документация MK3 вынесена из репозитория (см.
  `docs/README.md`); код-локальные README лежат рядом с кодом.

## Проверки

Зависимости, названные содержимым карты, планирует прежний `common.map/resolved-workspace`.
Его optional `expandPlan` получает прочитанные документы и возвращает append-only план.
Один Host `readWindow` и один `readResourceBytes` выполняют все раунды через тот же
ResourceSession: прежние requirements/order/scope, analyzer и window неизменны, лимиты
документов/байтов/диагностик суммарные, каждое непустое расширение расходует maxRequirements.
Новый dependency участвует в прежнем snapshot fingerprint и освобождении leases. Signal,
path confinement и validation используют прежних владельцев. Даже in-process provider получает
отдельные data snapshots через native structuredClone; его правки не меняют прочитанные
bytes/identity. Surface объявляет метод optional для старых providers; отдельный decoder,
private filesystem resolver или параллельный цикл загрузки в игре не создавать. Worker и
product acceptance не следует объявлять по linked in-process source qualification.

Игровые числовые поля UVW `game-raster` и SDK facet `game-raster` используют существующие
UV reader/reconstruction/UVP и общий native grid admission Host. Native map.layers остаётся
единственным владельцем декодирования и записи значений. Publisher обязан объявить
versioned valueMeaning, numeric valueType, cell/vertex sampling и границы значений;
единицы/scale/offset/NoData/упорядоченная легенда сохраняются без пересчёта и вывода
навигации или материала. Общий SDK `isVersionedPublisherId` имеет прежний публичный alias
`isNavigationFlagEncoding`, это одна функция. `isGameRasterValue` — один Core numeric admission;
existing f64-le exact pages хранят все допустимые значения без нового wire codec.
Reconstruction использует один canonicalGridIndex для vertex/cell. Потери и cursors
разделяются по layerId; неизвестный target vocabulary требует mapping либо явных потерь.
Игровые mutations/query policies и native publishers не подтверждены общим transport.

Canonical JSON имеет одного Core owner `canonicalJsonStringify`: прежний L6 default
сохраняет UTF8 order/pretty/LF/undefined omission, явный profile:jcs реализует RFC8785
UTF16 order/compact/strict JSON. Второй encoder UVP не создавать. `parseJsonDocument`
использует native JSON.parse для синтаксиса и общий bounded token scan для duplicate keys,
escaped aliases и Unicode; UVW и UVP manifest читаются через него. Формат UVW canonicalizes
документ до identity. World package content.hash — domain-separated JCS `uvp/artifact/uvw@1`,
UVM/media остаются raw SHA256. Writer и open используют одного владельца worldArtifactDigest.
Whitespace/property order не меняют логическую идентичность; изменение значений и повторные
ключи отказывают. Старый ошибочный raw-only UVW hash не принимается через fallback:
нужен явный повторный экспорт/миграция. Container hash не подменяет logical artifact hash.


Heightfield `role: query` — явно объявленная поверхность запросов, никогда не ground.
Один UV reader и один scalar reconstruction хранят ground и query; SDK/source различают
terrain/surfaces facets, чтобы любой renderer не создавал землю. Query допускает singleton
оси, NoData и именованную surfaceLayerId для traversal даже в mesh-пространстве. Native
querySurfaces использует существующий native grid owner, один canonical point frame и
вертикальное преобразование того же frame. Не дополнять образцы и не угадывать высоты по mesh.
Runtime использует прежний Q32.32 Heightfield sampler без нового wire-кодека. Singleton
существует только на исходной оси; supports, 3D clearance и перекрывающиеся этажи не заявлены.
Catalog itemCount и visited coordinates проверяются отдельно от NoData fill: потери страниц
и дубли не становятся допустимыми пустотами. UVP logical identity bridge реализован
`1f4679e1`: writer/open используют один normative digest, direct Runtime receipt проходит
без rebinding. Native game rules, корпус и сборка ещё требуют квалификации.


Independent cliffs используют SDK `MapNativeSampleGrid` и существующий Host grid
admission, собственные positions/grid/revision; уровни не являются высотами или traversal.
Только SDK `isTerrainBoundCliffItem` разрешает двум render consumers старый fallback стен
по вершинам terrain. UV source публикует независимую классификацию canonical-координатами;
совпадения локальных индексов недостаточно для связи с рельефом. Поля без explicit grid
сохраняют существующую привязку через готовые terrain tuples, без нового point mapper.
Числовые/булевы grid readers обходят все позиции, включая holes прямого JS-входа.


Native traversal и navigation используют один `MapNativeSampleGrid` в SDK и один
`admittedNativeSampleGrid` в Host. Игра явно публикует статическую политику класса;
Host преобразует направления column/row в canonical x/z один раз через тот же frame,
что и позиции. Сетка хранит центры образцов, UVW traversal — угол клетки. Направления
не выводятся из родных navigation flags. Несколько классов имеют отдельные layerId,
cursor и contentRevision. UV reconstruction отмечает сохранённые layerId, чтобы точный
класс не скрывал потерю частичного; excluded traversal помечается идентификатором слоя.


Portable traversal UVW использует существующий нормативный directed four-neighbour
контракт: один classId на слой, один слой класса в пространстве heightfield. SDK maps
публикует клетки и class/surface metadata; UV — единственный Core reader/reconstruction.
Каталог хранит lower-corner origin, элементы — центры клеток. Ссылка surfaceLayerId
сохраняет local id слоя высот того же пространства. Этот слой не создаёт pathfinder,
не выводится из native flags и не доказывает динамическую или диагональную проходимость.


Навигация с родными флагами переносится через существующий world source/reconstruction.
Точный фасет требует полной сетки, явных origin/steps, квалифицированного frame и
versioned publisher-scoped flagEncoding (проверяет SDK isNavigationFlagEncoding).
Сетка независима от высот. Флаги остаются непрозрачными: перенос между словарями игр
требует явного игрового преобразования, они не означают общую traversal-семантику.

Идентичность изображения UVM определяет только `uvmImageResourceId` из
`packages/uv/src/model/container.ts`: авторское имя, затем декодированный URI,
затем индекс встроенного изображения. Scene реэкспортирует того же владельца;
упаковщик UVP использует его при повторной упаковке. Копии правила не создавать.

Пространства UVW `heightfield` и модельные `mesh` используют один spatial body,
reader, reconstruction и UVP lifecycle. Нативный источник явно объявляет `topology`
в SDK; отсутствие поля сохраняет прежний heightfield-контракт. Mesh не создаёт
фиктивную сетку высот, не означает voxel palette и требует доказанного frame.

- Быстро: `pnpm check:fast` (типы + независимые тесты пакетов, до 4 потоков).
- Полная цепочка перед выпуском: `pnpm check` (включает унаследованные MK2-гейты — см. `../AGENTS.md` §8).
- Ledger: `node scripts/migration/check-feature-ledger.mjs` (0 проблем обязательно).

## Не терять и не пересоздавать

Перед новой возможностью и перед удалением или заменой кода — порядок из `../AGENTS.md` §4.0:
искать по каталогу §4.3–4.5, манифестам, сверке `modkit-core/reports/parity/sc2-pending-audit-2026-09-24.json`
и `git grep`; удалять только с заменой и тестом; найденный неописанный функционал дописывать в каталог.

## Перед изменением пакета

1. Найди существующую реализацию (`../AGENTS.md` §4). Новый алгоритм — узкий подпуть
   `codec-kit` + карта модулей веб-воркера (четыре файла в `apps/web`).
2. Строгий TS, без новых потребителей `codec-kit/legacy/*`.
3. После изменения публичного API пакета — vendor hop в репозитории расширений, иначе они его
   не увидят (`../AGENTS.md` §6).
4. Важное архитектурное изменение — строка в журнал `../AGENTS.md` §10.
