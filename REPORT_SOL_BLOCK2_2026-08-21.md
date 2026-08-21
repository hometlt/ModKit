# Отчёт Sol — блок 2: первая волна переноса кодеков

Дата: 2026-08-21  
Ветка: `spec/mk3-extension-reference`  
Задание: `PLAN_SOL_BLOCK2_2026-08-20.md`

## Результат

Первая волна дала четыре новых рабочих read-only кодека: `mpq`, `dds`, `m3` и `big`. Все четыре
проходят синтетический корпус, а каждый формат отдельно открыт через product path на настоящем
файле из установок владельца в `C:\Apps\StarCraft II` или `C:\Apps\CnC3KW`.

Полная минимальная поддержка SC2 из §3.4 **ещё не достигнута**. `casc` остаётся честным
`x3.mk2/port-pending`, а M3 пока публикует metadata-only сцену без геометрии. Также ещё не
портированы `sc2-data`/`sc2-strings`. Это не скрывается счётчиком и не объявляется готовой
поддержкой игры.

## 1. Почему конвертер пропускал кодеки

Фактическое дерево соседнего read-only репозитория на момент работы содержит 206 кодеков, а не
207 из плана. До исправления результат совпадал по сути с зафиксированным состоянием плана:

| Состояние конвертера | Конвертировано | Пропущено | Семейств |
| -------------------- | -------------: | --------: | -------: |
| До исправления       |            123 |        83 |       35 |
| После исправления    |            181 |        25 |       40 |

Причина была в слишком крупном раннем фильтре. Вердикт `needs new contract` означал, что у v1
кодека есть дополнительная плоскость, которой нет прямого MK3-контракта (writer, language,
runtime и подобное). Конвертер трактовал этот долг как невозможность завести даже честную
read-only заготовку и целиком пропускал 79 исходных кодеков.

Исправление разделило эти два факта:

- читаемая сторона получает существующее bundled-представление и честный `port-pending` модуль;
- отсутствующие плоскости записываются как инертный `contractGaps`/conversion debt;
- mixed topology сужается до `single` с явной записью долга;
- неподдерживаемый исходный format definition по-прежнему не превращается в ложную заготовку.

Из старых пропусков удалось завести 58 кодеков. Оставшиеся 25 имеют
`format-definition-pending`; они намеренно не конвертируются. В частности, `sage-asset-bundle`
из шести SAGE-кодеков остаётся среди этих 25, поэтому в `ea-sage` заведено пять контрибушенов.

Нужные владельцу семейства теперь существуют:

| Семейство / формат     | Было контрибушенов | Стало |    Рабочих после волны |
| ---------------------- | -----------------: | ----: | ---------------------: |
| `blizzard-starcraft-2` |                  0 |    12 |               1 (`m3`) |
| `blizzard-archives`    |                  1 |     2 |              1 (`mpq`) |
| `ea-sage`              |                  0 |     5 |              1 (`big`) |
| `common-images`        |                 10 |    22 | 3, включая новый `dds` |

`tga` и остальные перечисленные форматы присутствуют как честные заготовки, но не считаются
портированными.

## 2. Ratchet и корпус

Добавлен `pnpm ports:check`. Гейт проверяет по каждому семейству:

- минимальное число ручных портов не может уменьшиться;
- с портированного модуля нельзя вернуть generated-маркер;
- нельзя убрать generated-маркер, оставив `x3.mk2/port-pending`;
- рост числа портов требует обновить ratchet в том же изменении.

Итог первой волны: 181 контрибушен, 19 ручных портов, 162 ожидают. До этой задачи было 15 ручных
портов, поэтому прирост равен четырём.

Синтетический корпус генерируется детерминированно из спецификаций. Новые файлы:

- `minimal.dds`: legacy DDS + один BC1/DXT1-блок;
- `minimal.m3`: MD34 + одна запись section index;
- `minimal.mpq`: MPQ v0 с настоящими Storm hash/encryption tables, `(listfile)` и stored entry;
- `minimal.big`: BIG4 с mixed-endian таблицей и stored entry.

Acceptance harness теперь умеет проверять raster, model и namespace data sources, а также вызывать
объявленную операцию и проверять реальные извлечённые байты. Отсутствующий внешний корпус остаётся
видимым `skipped`, а не зелёным тестом.

## 3. Новые рабочие кодеки

| Кодек | Что реально работает                                                                                                               | Настоящий файл-доказательство                                                                                                                                         | Ограничения                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `dds` | legacy/DX10 header; BC1, BC2, BC3 и 24/32-bit mask RGB; raster info и RGBA `readRegion`                                            | `C:\Apps\StarCraft II\Maps\all-races-coop-maps\32-CoreOfCybros.SC2Map\btn-living-conduit.dds` (8 096 байт)                                                            | Только первый mip/face; нет cubemap/array editing/writer           |
| `m3`  | MD33/MD34 header, bounded section index, model-scene nodes                                                                         | `C:\Apps\StarCraft II\Maps\RustBucketYZc.SC2Map\Assets\Doodads\SpacePlatform_LandingLights_NoLensFlare\avex_SpacePlatform_LandingLights_NoLensFlare.m3` (27 968 байт) | Metadata-only: нет meshes/materials/skeleton/animations/M3A/writer |
| `mpq` | user-data header, MPQ v0-v3 classic hash/block tables, listfile, namespace, stored/zlib single-unit и sectors, `container.extract` | `C:\Apps\StarCraft II\Maps\cnc-test.SC2Map` (34 903 байта), извлечён `(listfile)`                                                                                     | Нет encrypted/implode/bzip2/patch/high-offset/writer               |
| `big` | BIG4/BIGF index, безопасные paths, namespace, stored/RefPack extraction, `container.extract`                                       | `C:\Apps\CnC3KW\Core\1.0\Libraries.big` (48 063 байта), извлечена первая настоящая запись                                                                             | Read-only; нет repack/mutation                                     |

Манифесты портов дополнены только теми операциями, для которых действительно зарегистрирован
handler. Неактуальные обещания writer/repack не выдаются за поддержку.

## 4. Реальные установки

Все действия над установками были read-only; файлы не копировались в репозиторий.

`C:\Apps\StarCraft II`:

- 28 файлов `SC2Data/data/data.*`, суммарно 29 238 181 277 байт;
- 16 local `.idx` и 154 CDN `.index`;
- 15 packed `.SC2Map` в корне `Maps`, плюс unpacked карты с DDS/M3.

`C:\Apps\CnC3KW`:

- 25 архивов `.big`, суммарно 5 675 713 891 байт;
- для быстрого воспроизводимого теста выбран настоящий `Libraries.big` (48 063 байта), а не
  многогигабайтный `Movies.big`.

## 5. Почему CASC не помечен портированным

CASC — namespace/install-root codec. Его вход не является одним файлом. Текущий ABI уже описывает
`ArtifactNamespaceSource` и `NamespaceAssetInput`, но продуктовый вход пока обрывается раньше:

- `OpenSubjectOptions.source` принимает только `ArtifactByteSource`;
- `createInspectionCodec.probe()` отвергает всё, кроме byte probe;
- `createInspectionCodec.planInput()` всегда строит `originKind: single`.

Поэтому extension-only реализация могла бы разобрать часть index-файлов, но не прошла бы честный
product path для установленного `SC2Data` и не дала бы приложению namespace всей игры. Для
настоящего порта нужен отдельный платформенный пакет: directory artifact source, bounded namespace
probe, namespace input resolver и соответствующий codec-kit helper. До этого `casc` остаётся
заготовкой и ratchet его не считает.

## 6. Доступность приложениям

Добавлен opt-in набор `mk2-extended` в `scripts/app-extension-sets.mjs`. Он включает четыре
семейства первой волны:

- `mk2/blizzard-archives`;
- `mk2/blizzard-starcraft-2`;
- `mk2/common-images`;
- `mk2/ea-sage`.

Выбран отдельный набор, а не перенос файлов в `extensions/common`: большая часть этих семейств ещё
содержит честные заготовки, и смешивать экспериментальный migration surface со стабильным common
каталогом преждевременно. Debug launchers разрешают выбрать набор через `--set mk2-extended`.
Матрица `apps:check` проверяет точный inventory и совместимость в headless, PWA worker, VS Code
extension host и Electron main process.

Живой VS Code в этой среде не запускался, как и предупреждает план. Packaged Electron с этим
opt-in набором также не запускался: проверена композиция приложения, но не UI-жест открытия файла.
Это остаётся отдельным live-proof, а не подразумевается зелёным inventory-тестом.

## 7. Что осталось

| Очередь                   | Статус / причина                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| CASC                      | Нужен namespace ingress в host/codec-kit; описано выше                                           |
| Полный M3                 | Нужен разбор vertex/index buffers, materials, skeleton и animations; текущая сцена metadata-only |
| `sc2-data`, `sc2-strings` | Заготовки заведены, read-side ещё не портирован                                                  |
| TGA                       | Заготовка заведена; пиксельный decoder ещё не портирован                                         |
| SAGE W3X и `cnc3-map`     | Следующая волна; реальные payloads находятся внутри BIG и теперь могут извлекаться               |
| `sage-asset-bundle`       | Нет поддержанного MK3 format definition, поэтому даже заготовка не генерируется                  |
| Остальные 162             | Ожидают последующих пакетов по 3–5 кодеков и собственного корпуса                                |

## 8. Проверка

Финальный гейт запускался строго фазами из плана, без параллельных команд:

| Фаза                                             | Результат                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `pnpm build`                                     | Пройдено; собрано 46 bundle entries                                 |
| `pnpm lint && pnpm format:check`                 | Пройдено после форматирования новых файлов                          |
| `pnpm exec tsc -p tsconfig.tooling.json`         | Пройдено                                                            |
| Focused Vitest                                   | 5 файлов, 25 тестов — пройдено                                      |
| `pnpm test`                                      | 132 файла, 1 105 тестов — пройдено                                  |
| `pnpm bench:universal:gate`                      | Пройдено                                                            |
| schemas/manifests/tokens/themes/icons/facilities | Все проверки пройдены                                               |
| `pnpm apps:check`                                | 23 matrix cases; `mk2-extended` = 41/41 compatible в целевых realms |
| VS Code `contributes:check`                      | Пройдено package-scoped командой                                    |
| legacy/import/extension inventory                | 881 / 260 файлов и 58 extension directories — чисто                 |
| `pnpm check:mk2`                                 | 482 generated files clean; 19 hand ports сохранены                  |
| `pnpm ports:check`                               | 181 total / 19 ported / 162 pending                                 |

После последней правки app-matrix повторно пройдены lint и format-check. Generated
`apps/*/dist-app/**` и `scripts/bundle-hashes.json` не изменены и в коммиты не входят.
