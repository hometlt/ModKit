# Реестр экранов старого VS Code плагина (Этап I)

Дата: 2026-09-17. Источник задачи: `reports/HANDOFF_SC2_CORE_RESTRUCTURE_CONTINUATION_2026-09-15.md`
§13, «Этап I. Экраны старого VS Code плагина — один UI для VS Code, web и Electron».

Машиночитаемый реестр: [`migration/vscode-screens.json`](../migration/vscode-screens.json).
Проверочный скрипт: [`scripts/migration/check-vscode-screens.mjs`](../scripts/migration/check-vscode-screens.mjs)
(отчёт, не гейт — не падает на `missing`, только на структурные ошибки реестра).

## 1. Метод

Источники:

- MK2: `references/modkitmk2/apps/modkit-vscode/package.json` (64 `commands`, 11 `customEditors`,
  6 `views`, 25 legacy `configuration.properties`, 8 языков) и 103 модуля `src/*.ts` +
  `src/webview/*.ts` + `src/source-providers/*`.
- MK3: `apps/vscode/package.json` (38 текущих команд, 4 custom editors, 2 views, 7 config keys),
  `apps/vscode/src/*.ts` (в первую очередь `extension.ts` и `stages.ts`), `apps/electron/src/*.ts`,
  `apps/web/src/*.ts`, `packages/ui/src/parts.ts` и директории `packages/ui/src/*`.
- Существующий ledger `migration/vscode-workflows.json` (14 workflows поверх тех же 64+CLI команд,
  уже расклассифицированных владельцем как already-equivalent / release-candidate / post-release с
  evidence-путями) — переиспользован как проверенная классификация для командной части, а не
  переоткрыт с нуля; часть строк (relation graph, strings table, model viewer, replay player,
  media codecs) перепроверена самостоятельно чтением исходников MK3, а не по одним только именам.

Одна строка реестра — один legacy-экран: command, custom editor, view/tree, status bar item или
setting group (webview-панели, открываемые командой, не заведены отдельной строкой — они описаны
внутри строки своей команды полем `legacy.webview` и в §3 ниже). Итого **91 строка**: 64 команды +
11 custom editors + 6 views + 3 status bar item + 7 setting groups (агрегирующих 25 legacy-ключей).

`mk3.status` решён чтением кода, а не совпадением имён: например `modkit.explainResolution`
зарегистрирован в MK3 под тем же id, но отвечает про host-топологию, а не про causes/rejections
резолюции конкретного файла — это `partial`, а не `present`.

## 2. Счётчики

### 2.1 По статусу

| status | count |
|---|---|
| present | 50 |
| partial | 15 |
| missing | 23 |
| superseded | 3 |
| not-applicable | 0 |

### 2.2 По группе × статус

| group | present | partial | missing | superseded |
|---|---|---|---|---|
| archives | 14 | 1 | 4 | 0 |
| media | 7 | 4 | 1 | 0 |
| models | 3 | 0 | 0 | 0 |
| maps-replays | 2 | 3 | 3 | 0 |
| layout | 0 | 0 | 7 | 0 |
| strings | 1 | 2 | 1 | 0 |
| cards-navigation | 7 | 4 | 1 | 0 |
| service | 16 | 1 | 1 | 3 |
| language | 0 | 0 | 4 | 0 |
| other | 0 | 0 | 1 | 0 |

### 2.3 По хосту (present/missing/n·a, из 91 строки)

| host | present | missing | n/a |
|---|---|---|---|
| vscode | 63 | 28 | 0 |
| electron | 63 | 28 | 0 |
| web | 63 | 13 | 15 |

Каждая строка со статусом `present` в реестре одинаково `present` во всех трёх хостах —
подтверждает архитектурное решение плана («экран реализуется один раз в `packages/ui`, VS Code/
web/Electron дают только chrome»): ни одного экрана, который был бы `present` в одном хосте и
`missing` в другом, не найдено. `n/a` у web относится к чисто-desktop сервисным действиям
(открыть папку в файловом менеджере, CASC-специфика), для которых веб-хост в принципе не
предполагает эквивалента.

### 2.4 По виду legacy-поверхности

| kind | count |
|---|---|
| command | 64 |
| custom-editor | 11 |
| view | 6 |
| status-bar | 3 |
| setting-group | 7 (агрегирует 25 legacy `modkit.*` ключей) |

## 3. MK2 webview-функции по группам (для переноса)

Ниже — визуальные/интерактивные webview-возможности MK2, которые не сводятся к одной команде, с
их исходниками. Реестр ссылается на них из соответствующих строк; здесь они собраны по группам,
как просит §13.3 плана.

**Архивы** (`archive-explorer.ts`, `archive-view.ts`, `archive-save.ts`, `archive-codecs.ts`,
`large-archive-readers.ts`, `fast-casc-extract.ts`, `seven-zip-native.ts`, `casc-materialize.ts`,
`casc-settings-panel.ts`, `casc-cache-info.ts`): файловое дерево над любым архивом/пакетом
(MPQ/ZIP/7z/RAR/Unity bundle/BIG/MIX/CAB/ISO/инсталлятор), клик-превью записи, Extract по
контекстному меню, drag-and-drop Insert, Delete, Save (repack); отдельная CASC-панель с живыми
размерами кэша. MK3: browse/extract/preview уже общие (`present`); Insert/Save-repack round-trip
и панель размеров кэша не переподтверждены в этом проходе (`partial`/`missing`).

**Медиа** (`assets-texture-viewer.ts` + `webview/assets-texture-main.ts`, `dds-commands.ts`,
`audio-preview.ts`/`audio-codecs.ts`, `assets-video-viewer.ts`/`video-codecs.ts`, `ogv-preview.ts`,
`swf-preview.ts`, `windows-metafile-renderer.ts`, `font-preview.ts`, `hex-viewer-adapter.ts`,
`code-viewer-adapter.ts`): mip/face/array-slice навигация и marquee-редактирование текстуры,
DDS-специфичные конвертации, video/audio плеер, Ogg Theora и Flash в одном video-viewType, WMF
через собственный рендерер, шрифтовые специмены, hex/code viewer. MK3: image/audio/video/hex/code
уже общие stage-viewer'ы (`present`); DDS-конвертации, батч-конвертация, шрифты и SWF — реальные
пробелы (`font-preview` и `swf-preview` не имеют вообще никакого кодека или рендера в MK3, это
подтверждено прямым поиском по репозиторию, а не только по ledger).

**Модели** (`model-viewer.ts` + `webview/model-viewer-main.ts`/`model-viewer-backends.ts`,
`model-viewer-assets.ts`, `model-viewer-protocol.ts`, `model-assets.ts`, `model-inspect.ts`,
`model-export-edits.ts`): один custom editor на все парсящиеся в RenderModel форматы, выбор
рендер-бэкенда (three|webgl), viewer-only geoset toggle. MK3: `present`, доказано installed-receipt
на `.m3` и `.pie`.

**Карты и реплеи** (`map-preview.ts`, `map-preview-3d.ts`, `map-launch.ts`, `replay-player.ts` +
`webview/replay-player-main.ts`/`replay-3d-view.ts`, `replay-3d-payload.ts`): 2D-превью карты
(minimap/heightmap + drill-down в архив), полноценная 3D-сцена карты (террейн-чанки, вода,
доодады, юниты добычи/старта), запуск карты с индикатором «сейчас идёт», replay-плеер как
видео-плеер (2D map view, play/pause/seek/speed) поверх Tier-A tracker timeline, отдельный
3D-payload builder для боевой сцены реплея. MK3: 2D map preview `present`; 3D map preview
`partial` — сам сценарий `focused-world-presentation` в `reports/vscode-focused-ga-smoke/receipt.json`
показывает ошибку рендера («world candidate identity changed between source and info»), а не
готовую сцену; replay player `partial` — generic `transport-source` контракт под ровно эту
задачу уже есть в `packages/ui/src/world/index.ts:1138`, decoders и tracker timeline перенесены в
`modkit-extensions-blizzard/starcraft2/modules/replay`, но ни один codec не публикует
`common.view/world-scene-source`/`transport-source` для `.SC2Replay`, то есть экран как таковой
ещё не открывается.

**Layout**: `layout-preview.ts`/`layout-preview-host.ts` (live-рендер SC2Layout дерева),
`layout-dtree.ts` (два LSP-driven view: compiled DescTree + resolved Element properties),
`layout-workspace.ts` (status bar предупреждение о незавершённой настройке воркспейса). MK3:
все три `missing` — ни превью, ни DescTree/Element views, ни отдельный status bar item не найдены;
в апстриме есть только текстовые LSP-фичи (hover/colors/rename) для `.SC2Layout`, но не визуальные
экраны.

**Строки**: `strings-editor.ts`/`strings-editor-edits.ts` (таблица Key/Value/Preview/Duplicate,
построчные edits), `strings-search.ts` (whole-word/regex поиск внутри webview),
`strings-language.ts` (completion/hover/markup для сырого текста). MK3: однофайловая таблица
Key/Value/Preview/Duplicate реально перенесена и подключена через общий Table stage
(`modkit-extensions-blizzard/starcraft2/modules/strings/codecs/strings/src/codec.ts:379`), это
`partial` — мультилокальные колонки, `asset.compare`, добавление ключа и автоперевод остаются на
Этапе J по плану владельца, а in-webview поиск не перенесён вовсе.

**Карточки и навигация**: `entity-card.ts`, `mod-card.ts`, `mod-wiki.ts`, `mod-tree.ts`,
`relation-graph.ts`/`relation-graph-data.ts` + `webview/relation-graph-main.ts` (three.js
псевдо-3D force layout, orbit controls, bloom postprocessing), `document-header-preview.ts`,
`version-preview.ts`. MK3: generic subject card (`present`), namespace-браузер под wiki
(`present`), навигация/refresh MOD-дерева через общий relation source (`present`), но
**относительно псевдо-3D графа — это ключевой найденный разрыв**: `packages/ui/src/graph/index.ts`
реализует 2D canvas force layout (`index.ts:390`, `canvas.getContext('2d')`), без three.js/orbit/
bloom; граф работает и признан ledger'ом «already-equivalent» по функции (клик → re-root/open
card), но визуальный стиль MK2 не воспроизведён — это явный предмет для Этапа I/J. Mod Card
(ресурсные категории + load order конкретного mod-root) отдельно не перенесён (`missing`).

**Сервисные**: `diagnostics-bundle.ts` (zip-бандл для баг-репорта), `game-install-discovery.ts`/
`game-install-registry.ts` (поиск/регистрация игровых установок), `game-codec-tree.ts`/
`game-codec-catalog.ts` (дерево эффективных codec contributions по игре), `file-icons.ts`,
`catalog-decoration.ts` (декорации/иконки файлов в Explorer). MK3: все преимущественно `present`
через общий Extensions/Host view и bounded diagnostics journal; иконки/декорации файлов не
перепроверялись отдельно в этом проходе (не заведены отдельной строкой — не command/editor/view/
status-bar/setting-group, а `iconThemes`/`FileDecorationProvider` контрибуция вне области Этапа I
по буквальному списку кинда).

## 4. Топ-15 missing/partial экранов по ценности для пользователя

1. **Строковая таблица локализаций** (`custom-editor:modkit.stringsEditor`, `partial`) — базовая
   таблица есть, но без мультилокальных колонок/поиска/`asset.compare`/автоперевода это неполный
   рабочий инструмент переводчика. MK2: `src/strings-editor.ts`, `src/strings-editor-edits.ts`,
   `src/strings-search.ts`.
2. **3D-превью карты** (`command:modkit.previewMap3d`, `partial`) — сцена не рендерится в
   installed-приёмке. MK2: `src/map-preview-3d.ts`, `src/replay-3d-payload.ts`.
3. **Replay Player** (`custom-editor:modkit.replayPlayer`, `partial`) — decoders и transport-
   контракт есть порознь, экран не собран. MK2: `src/replay-player.ts`, `src/webview/replay-player-main.ts`.
4. **Relation Graph — псевдо-3D** (`command:modkit.showRelationGraph`, `partial`) — функция
   есть, визуальный движок (three.js/orbit/bloom) не перенесён. MK2: `src/relation-graph.ts`,
   `src/webview/relation-graph-main.ts`.
5. **Mod Card** (`command:modkit.openModCard`, `missing`) — ресурсные категории + load order по
   конкретному mod-root отсутствуют. MK2: `src/mod-card.ts`.
6. **SC2Layout preview** (`command:modkit.previewLayout`, `missing`) — нет живого рендера дерева
   фреймов. MK2: `src/layout-preview.ts`, `src/layout-preview-host.ts`.
7. **SC2Layout DescTree + Element views** (`view:sc2layoutMainView`, `view:sc2layoutElementView`,
   оба `missing`) — раскрытие вычисленного (post-inheritance) дерева layout полностью потеряно.
   MK2: `src/layout-dtree.ts`.
8. **GameData/Strings LSP-валидация мода целиком** (`command:modkit.gamedata.validateMod`,
   `command:modkit.gamedata.validateModStrings`, оба `missing`) — постраничная диагностика есть,
   пакетной проверки всего мода нет. MK2: `src/sc2-gamedata-language.ts`.
9. **Verify Galaxy Script** (`command:modkit.verifyGalaxyScript`, `missing`) — нет батч-команды
   поверх live diagnostics. MK2: `src/galaxy-language.ts`.
10. **Font Preview** (`custom-editor:modkit.fontPreview`, `missing`) — нет вообще ни кодека, ни
    рендера шрифтов в MK3. MK2: `src/font-preview.ts`.
11. **SWF/Flash preview** (внутри `custom-editor:modkit.assetsVideoViewer`, `partial` для группы,
    но SWF конкретно `missing`) — подтверждено прямым поиском, кодека нет нигде в репозитории.
    MK2: `src/swf-preview.ts`.
12. **DDS-специфичные конвертации** (`command:modkit.dds.convertDxt5ToDxt1`,
    `command:modkit.dds.prepareSc2ButtonIcon`, `command:modkit.dds.convertPngIconToDds`, все
    `missing`; `command:modkit.dds.exportPng` и `command:modkit.assetsTexture.batchConvert`
    `partial`) — весь набор точечных текстурных операций для художника отсутствует. MK2:
    `src/dds-commands.ts`, `src/assets-texture-viewer.ts`.
13. **Map Launch — status bar индикатор** (`status-bar:map-launch-status`, `missing`) — сам
    запуск карты работает, но нет видимого «идёт запуск/уже запущено». MK2: `src/map-launch.ts:55`.
14. **Extract Changed Strings (git diff)** (`command:modkit.strings.extractChanged`, `missing`) —
    рабочий процесс сдачи переводчику. MK2: `src/strings-editor.ts`.
15. **Launch settings UI** (`command:modkit.openLaunchSettings`, `missing`) — нет
    пользовательского экрана для install dir/map path/game logs path/warn-if-running. MK2:
    `src/map-launch.ts`.

## 5. Известные ограничения этого прохода

- Часть строк со статусом `partial`, унаследованным из `migration/vscode-workflows.json`
  (например `modTree.showDeps`/`hideDeps`, `casc.openSettings`, drag-and-drop Insert/Save-repack
  в Archive Explorer), не была независимо построчно перепроверена чтением MK3-кода — реестр
  честно называет это в поле `notes` каждой такой строки, не выдавая ledger-классификацию за
  собственное прочтение.
- Иконки/декорации файлов Explorer (`file-icons.ts`, `catalog-decoration.ts`) и 8 language
  contributions MK2 не заведены отдельными строками реестра — по букве §13.1 задачи единица
  реестра это command/custom-editor/view/webview-panel/status-bar/setting-group, а не language
  contribution или icon theme; они упомянуты текстом в §3 выше.
- Полная installed-приёмка (VS Code + Electron + web smoke на реальных фикстурах) для каждой
  строки не запускалась в рамках этого прохода — этот реестр фиксирует текущее состояние по
  чтению кода и существующим receipts/tests, а не новый прогон.

## Обновление 2026-09-17: DDS/PNG-конвертации (группа media)

Закрыты 4 строки (`missing`/`partial` → `present`): `modkit.dds.exportPng`,
`modkit.dds.convertDxt5ToDxt1`, `modkit.dds.prepareSc2ButtonIcon`, `modkit.dds.convertPngIconToDds`.
Это не команды хостов, а операции кодеков: `export.convert` у DDS и PNG
(`extensions/images/src/ops/raster-transforms.js`, цели `png`/`dds`/`rgba8`, правила MK2 — бинарная
альфа для DXT1, квадрат ≤256 для иконки кнопки, квадрат <256 для PNG-иконки) и `edit.content` у DDS
с формами для общей панели правки. Результат — байты нового файла (`subject.convert`, панель
«Преобразования» `image.convert` в image viewer через хостовый export writer) или edit plan
(`subject.edit`); прямой записи нет. Тесты: `extensions/images/test/raster-export.test.ts`,
`packages/ui/test/image-convert.test.ts`. Живая проверка в VS Code/Electron ещё не делалась.
`modkit.assetsTexture.batchConvert` остаётся `partial` (нет пакетной команды по папке).
