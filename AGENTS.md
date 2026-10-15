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
