# Отчёт Sol — блок 4: CASC, linked-структура, дробление и аудит MK2

Дата: 2026-08-21

Ветка: `spec/mk3-extension-reference`

Задание: `PLAN_SOL_BLOCK4_2026-08-21.md`

## Результат

Platform-блокировка снята, после чего выполнены все четыре этапа блока.

- VFS различает логический размер random-access-файла и фактически прочитанные байты. Реальный
  CASC data-файл размером 1 ГиБ открывается без материализации и читается малыми диапазонами.
- `org.modkitx.blizzard/casc` больше не `x3.mk2/port-pending`: локальная установка SC2 открывается
  через VFS → Host → codec-kit, MNDX публикует страничный `namespace-entry-source`, извлечение идёт
  стандартной операцией `container.extract`.
- Удалены агрегатный `packages/extensions-linked` и его генератор. Каждое common-расширение имеет
  собственный ручной `./linked` entry и проверяется маленьким гейтом полноты.
- Blizzard-контрибушены разделены на CASC, MPQ, модели и SC2-специфичный домен; приложение может
  подключить каждое расширение отдельно.
- Проверены все 34 runtime/library-пакета соседнего MK2 и отдельный build preset. Результат
  зафиксирован в `docs/AUDIT_MK2_PARITY_RU.md`.

## Platform-граница больших random-access-файлов

Старый единый `maxBytes = 512 MiB` отклонял `SC2Data/data/data.000` по полному размеру до первого
чтения. Новый контракт VFS разделяет пять независимых границ:

| граница                | значение по умолчанию | назначение                                                      |
| ---------------------- | --------------------: | --------------------------------------------------------------- |
| `maxFileBytes`         |                 8 TiB | максимальный логический размер открываемого random-access-файла |
| `maxReadBytes`         |               512 MiB | совокупный бюджет реально прочитанных байтов mount              |
| `maxReadRangeBytes`    |                16 MiB | максимальный единичный `readAt`                                 |
| `maxStreamBytes`       |               512 MiB | максимальная длина одного stream                                |
| `maxMaterializedBytes` |               512 MiB | отдельно ограниченная полная материализация memory-источников   |

Суммарный бюджет общий для повторных и параллельных source. Чтение сначала резервируется, после
ответа провайдера учитывается фактическое число байтов, а неиспользованная резервация освобождается.
Превышения имеют стабильные коды:

- `x3.vfs/file-size-limit-exceeded`;
- `x3.vfs/read-byte-budget-exceeded`;
- `x3.vfs/read-range-limit-exceeded`;
- `x3.vfs/stream-byte-limit-exceeded`.

Живое read-only доказательство прошло на
`C:\Apps\StarCraft II\SC2Data\data\data.000`: VFS → Host открыл файл размером 1 073 741 824 байта
и прочитал малые диапазоны в начале и за прежней границей 512 MiB. Размер и `mtime` не изменились.
Дополнительно исправлено разрешение пути для mount в корне VFS.

## Этап 1 — CASC на установленном StarCraft II

### Обнаружение и чтение

Namespace-probe требует точный набор маркеров:

- `.build.info`;
- `SC2Data/config`;
- `SC2Data/data`;
- `SC2Data/indices`.

Похожие имена не принимаются. Reader читает active build config, локальные `.idx`, encoding table
и MNDX root. Поддерживается только локальное MNDX-хранилище; CDN fallback, кэш, запись и иные root
formats намеренно отсутствуют и отказываются именованными `x3.casc/*` ошибками.

### Численные бюджеты CASC

| граница                        |   максимум | поведение при превышении                     |
| ------------------------------ | ---------: | -------------------------------------------- |
| локальные index-файлы          |   64 файла | именованный отказ `x3.casc/*`                |
| общий объём index-файлов       |     64 MiB | именованный отказ до дальнейшего разбора     |
| полное чтение служебного файла |     64 MiB | файл не материализуется                      |
| CASC container range           |     64 MiB | диапазон не читается                         |
| один Host `readAt`             |     16 MiB | длинное чтение разбивается на bounded chunks |
| декодированный BLTE payload    |    128 MiB | декодирование прерывается                    |
| одна извлекаемая запись        |    128 MiB | `container.extract` отказывает               |
| суммарные source reads session |    256 MiB | дальнейшее чтение отказывает                 |
| записей MNDX                   |    750 000 | root не принимается                          |
| элементов страницы             |        256 | запрос ограничивается/отвергается контрактом |
| длина пути                     | 4 096 байт | путь не принимается                          |

Перечисление использует отсортированный индекс и binary lower bound, а не повторный проход по
хранилищу. Размер страницы ограничен 256 элементами; `AbortSignal` проверяется при открытии,
перечислении и чтении. BLTE поддерживает реальные raw/zlib chunks с ограничением результата.

### Живое доказательство

Тест с env-override и `skipIf` только при отсутствии `.build.info` открыл
`C:\Apps\StarCraft II` через публичную цепочку VFS → Host → codec-kit:

- MNDX: **666 588** именованных записей;
- M3 `artifact1.m3`: **60 128 байт**, сигнатура `MD34`;
- DDS `alpha2.dds`: **824 байта**, сигнатура `DDS`;
- MPQ/S2MA `fc2161…s2ma`: **2 691 734 байта**, сигнатура `MPQ\x1A`.

Все три извлечённые записи повторно открылись обычным `openSubject`: M3 через
`blizzard-models`, DDS через common-images, MPQ через `blizzard-mpq`; MPQ namespace также
перечислился. Размер и `mtime` `.build.info` до и после совпали. Игра не изменялась.

## Этап 2 — собственные `linked` entries

Прямой ответ на проверку оценки: **да, оценка сошлась**. Ручной pilot
`extensions/common/images/src/linked.js` занимает 19 физических строк, из них 17 непустых, против
оценки 15 строк. Это не «сильно больше», поэтому тот же шаблон применён к остальным common-
расширениям.

Каждый entry импортирует JSON-манифесты, `import * as` для модулей и вызывает
`defineLinkedExtension`. Hand-authored linked-манифест не выдаёт самосравниваемый digest за
криптографическое доказательство; Host сохраняет только доверенные in-process variants и явно
называет исключённые worker-only variants.

Удалены:

- `packages/extensions-linked`;
- `scripts/emit-linked-extensions.mjs`;
- `linked:check`, `linked:emit` и зависимость агрегатного пакета.

`pnpm-workspace.yaml`, package exports, минимальная сборка и руководства обновлены. Новый гейт
требует, чтобы каждый contribution-файл расширения был явно упомянут в его `linked` entry.

## Этап 3 — дробление Blizzard

Получены четыре независимые координаты:

| расширение                        | содержимое                   |
| --------------------------------- | ---------------------------- |
| `org.modkitx.blizzard/casc`       | CASC                         |
| `org.modkitx.blizzard/mpq`        | MPQ                          |
| `org.modkitx.blizzard/models`     | один M3/M3A codec            |
| `org.modkitx.blizzard/starcraft2` | 11 SC2-специфичных envelopes |

`convert:mk2` воспроизводит это разбиение и сохраняет hand-ported CASC-файлы и тесты. Наборы
приложений содержат отдельные `mk2-casc`, `mk2-mpq`, `mk2-models`, `mk2-starcraft2`; расширенный
набор лишь композиционно включает все четыре.

Эффект измерен, а не предположен: headless inventory для `mk2-models` даёт ровно одну активную
модельную контрибуцию, а metafile минимальной esbuild-сборки содержит M3 codec и не содержит
replay/trigger codec. Конвертация из snapshot: 181 codec → 42 extensions, 25 skipped,
20 hand-ported.

## Этап 4 — аудит паритета MK2

Аудит основан на `package.json`, exports и реализации `src/` соседнего
`C:\FILES\SC2Files\coding\modkitx`; соседний репозиторий не изменялся.

- проверено: **34 runtime/library-пакета + 1 build preset**;
- **есть:** 7;
- **частично:** 14;
- **нет — нужно:** 13;
- **нет — не нужно:** 1.

План называл 34 пакета, а текущий checkout содержит ещё отдельный build-only `tsconfig`; он тоже
включён, чтобы счёт не скрывал поверхность. Крупные разрывы:

1. нет связного semantic SC2-стека data/maps/mods/layout/localization/scripts/language/LSP;
2. нет runtime/world/agent plane;
3. M3-паритет остаётся метадатным без полноценного decode/render/effects plane;
4. CASC открывает явно переданный корень, но отсутствует discovery установленных игр.

Полная таблица и именованные следующие задачи: `docs/AUDIT_MK2_PARITY_RU.md`.

## Проверка

Обязательные гейты пройдены строго последовательно:

1. `pnpm build` — пройден, 48 публикуемых entries. Первый запуск правильно обнаружил устаревший
   web catalog после дробления; каталог пересобран штатным генератором, повторный build прошёл;
2. `pnpm lint`, затем `pnpm format:check` — пройдены;
3. `pnpm exec tsc -p tsconfig.tooling.json` — пройден;
4. фокусные platform/CASC/linked/split/converter/real-SC2 тесты — **12 файлов, 67 тестов**;
5. `pnpm test` — **138 файлов, 1 140 тестов**;
6. остальные гейты — пройдены: universal-data benchmark; schemas; 16 UI manifests; 193 tokens и
   3 palettes; 3 themes; icons; 28 standard + 1 legacy facilities; 24 app/realm cases; legacy и
   import scans; 60 extension directories; byte-stable `check:mk2`; port ratchet **20/181**.

Фокусный Host sparse-file тест получил локальный timeout 15 секунд: при первом параллельном
прогоне реальное дисковое создание sparse-файла заняло 7,48 секунды и превысило общий 5-секундный
Vitest timeout без функциональной ошибки. Полный повторный фокусный гейт и полный suite прошли;
обычное время этого теста в них составило около 0,5 секунды.

## Ограничения прогона

- `C:\Apps\StarCraft II` использовался только для чтения; размер и время изменения проверены.
- `C:\FILES\SC2Files\coding\modkitx` использовался только как источник аудита и портирования.
- Предсуществующие `scripts/bundle-hashes.json`, `NexusForgeUI/` и `apps/*/dist-app/**` не входят в
  результат и не будут добавлены в коммит.
