# MK2 → MK3: бэклог переноса и исправлений

> Уточнение после проверки пользовательских сценариев 2026-09-20:
> [план восстановления SC2 authoring parity](SC2_AUTHORING_PARITY_RECOVERY_PLAN_2026-09-20.md).
> Наличие engine/API и language-only smoke-test не означает завершённую приёмку VS Code.
> Документ уточняет причины разрывов, порядок работ и обязательные проверки; реализация
> перечисленных исправлений в рамках подготовки этого плана не выполнялась.

> Дата: 2026-09-20. Составлен по сводному аудиту-замечаниям; ключевые цифры
> проверены по кодовой базе в этот день (см. «Проверенные факты»).
>
> Формат задач рассчитан на ИИ-агента: каждая задача самодостаточна, имеет
> приоритет, файлы-точки входа, критерии готовности (Done when) и способ
> проверки. Задачи внутри эпика можно брать по одной; зависимости указаны явно.

## Легенда

| Поле | Значение |
|---|---|
| **P0** | Регрессия: пользователь видит поломку каждый день. Брать первым. |
| **P1** | Разрыв «заявлено GA — нет в продукте». Ядро todo. |
| **P2** | Гигиена и инфраструктура, разблокирующие скорость разработки. |
| **P3** | Полезно, но не блокирует. |
| **REG** | Регресс относительно MK2 (раньше работало). |
| **NEW** | Требование из todo, которого в MK2 не было. |
| **FIX** | Открытый баг MK3. |
| **ARCH** | Архитектурный долг. |

Правила работы с бэклогом:

1. Не брать задачу с открытой зависимостью (`←`).
2. После выполнения — ставить `[x]` и одну строку результата под задачей.
3. Проверка = конкретная команда или сценарий из «Done when». Без прогона — задача не закрыта.
4. Один эпик = одна ветка/сессия, если не сказано иное.

## Проверенные факты (2026-09-20)

- `apps/vscode/src/extension.ts` = **8284** строки; всего VS Code-слой **22 150** строк в 43 плоских файлах.
- `migration/codec-port/feature-ledger.json`: 902 записи — **pending 710 (78.7%)**, adapted 178, superseded 14.
- `apps/vscode/contributes.generated.json`: `languages: 0`, `grammars: MISSING`, `snippets: MISSING`, `jsonValidation: MISSING`, `iconThemes: MISSING`, `colors: MISSING`; commands: 38, customEditors: 4, views: 1, configuration: 2.
- `packages/host/src/language/workspace.ts`: из фич «второго эшелона» присутствует только `selectionRange`; **нет** codeLens / documentLink / inlayHint / foldingRange.
- `apps/vscode/src/stages.ts`: `id: 'transform'` (L87) всё ещё зарегистрирован; `id: 'world'` (L115) заявлен.
- `packages/ui/src/world/index.ts` — единственный файл каталога world (55 КБ, существует; утверждение аудита «пусто» — устарело, но экран в view-policy скрыт).
- `createHexEditor` зарегистрирован в `stages.ts` (L266) — требование hex-редактора формально закрыто, нужна функциональная проверка (undo/redo/save).
- `packages/host/native-text/` существует внутри host-пакета (contributions, json, plain, runtime).

---

# ЭПИК A — P0: Регрессии VS Code-слоя (видимые поломки)

## A1. [ ] Зарегистрировать языки, грамматики и language-configuration (REG, P0)

MK2 регистрировал 8 языков с 5 TextMate-грамматиками; в MK3 `languages: 0`.
Подсветки нет ни для одного игрового языка — плагин выглядит сломанным.

- Перенести грамматики/language-configuration из MK2: `galaxy`, `sc2layout`,
  `sc2strings`, `sc2style`, `texturereductionvalues`; xml-расширения
  (`.SC2Lighting` и т.п.), `lua` для modinfo.lua/mapinfo.lua, `ini` для `.SC2Hotkeys`.
- Генерировать секции `languages`, `grammars`, `configurationDefaults` (tokenColorCustomizations для sc2strings) в `contributes.generated.json`.
- Проверить коллизии: активация по содержимому (`docKindOf`) не должна конфликтовать с встроенным XML.

**Done when:** `node -e "...contributes..."` показывает languages ≥ 8, grammars ≥ 5;
открытие `.galaxy`, `.SC2Layout`, `GameStrings.txt` даёт подсветку, bracket/indent-правила.

## A2. [ ] Диагностика с корректным range (REG, P0)

Сейчас «The range is the head of the file rather than a guess» — squiggles
ложатся на первую строку, Problems-панель бесполезна.

- Протащить позицию атрибута/значения из парсеров к `vscode.Diagnostic.range`.
- Затронуть: subject diagnostics (каталоги), gamedata-валидация, strings-валидация.

**Done when:** на намеренно битом `UnitData.xml` (неверный enum, неизвестное поле)
squiggle стоит на конкретном атрибуте; в Problems виден переход к месту.

## A3. [ ] Вернуть настоящий `Explain mod resolution` (REG, P0)

Подменён: отвечает про host-топологию, а не про causes/rejections резолюции
конкретного файла (в рестре помечен `partial`).

- Реализовать трассировку: по каждой зависимости — каждый источник по порядку, hit/miss, тайминг.
- Вывод: webview или quick-pick-цепочка; команда принимает активный файл/мод.

**Done when:** на моде с зависимостями команда показывает полную цепочку проб с
hit/miss и временем; результат совпадает с логом резолвера.

## A4. [ ] Debug-конфиг запуска игры `modkit-sc2` (REG, P0)

MK2: тип отладки с 9 атрибутами (triggerDebug, testMod, meleeMod, difficulty,
speed, testConfig, preload, noUserCheats, reloadCheck, showErrors). MK3: одна
команда `modkit.game.launchActiveMap` + game-launch-workflow.ts (85 строк).

- Расширить game-launch-workflow атрибутами; добавить вкладку launch.json-схемы.
- `warnIfRunning` — спросить перед убийством запущенной SC2.
- Стрим вывода SC2Switcher в output-канал при `showErrors`.
- Чтение игровых логов (GameLogs path).

**Done when:** F5 с конфигом запускает карту с testMod+triggerDebug; атрибуты
документированы в package.json-схеме; повторный запуск при запущенной игре спрашивает подтверждение.

## A5. [ ] Мелкие регрессии contributes (REG, P0)

- `jsonValidation` — схема для sc2project.json-аналога.
- `iconThemes` — собственный file-icon theme.
- `colors` — `modkit.customCatalogForeground` + catalog decoration в explorer
  (оранжевый для кастомных `<Catalog>`, оверлей для подключённых).

**Done when:** contributes содержит все три секции; кастомный каталог в explorer
окрашен; sc2project-файл валидируется схемой.

---

# ЭПИК B — P0/P1: Language-контракт и LSP-механики

## B1. [ ] Расширить контракт `LanguageWorkspace` (REG, P0) ← A1

В `packages/host/src/language/workspace.ts` нет: **codeLens, documentLink,
inlayHint, foldingRange** (selectionRange есть). Без них требования «parent
chain над сущностью» и «resolved value inline» невыполнимы.

- Добавить 4 capability в контракт + роутинг в generic LSP-адаптере (`apps/lsp`).
- Зарегистрировать провайдеры в VS Code-слое (сейчас ровно 12).
- FoldingRanges критичен для UnitData.xml на тысячи сущностей.

**Done when:** для gamedata-XML работают: CodeLens с цепочкой родителей,
DocumentLink по parent=, inlay-hint resolved-значения, сворачивание по сущностям.
Тесты контракта на все 16 фич.

## B2. [ ] Раздельный дебаунс update vs diagnostics (REG, P1)

MK2: `documentUpdateDelay` 100 мс и `documentDiagnosticsDelay` 500 мс
(false = выкл.). MK3: один путь в `language-session.ts`.

**Done when:** две настройки; при наборе текста squiggles не мигают на каждом символе.

## B3. [ ] FileSystemWatcher-карта «не-документный файл → владеющий мод» (REG, P1)

FontStyles, ComponentList, Assets.txt, вложенные `<Includes>`, strings всех
локалей — не документы; их изменение должно перезагружать владеющий мод и
ревалидировать открытые документы (в MK2 — через onDidChangeWatchedFiles).

**Done when:** правка ComponentList вне открытого документа приводит к
переиндексации каталога и обновлению hover/completion в открытом XML без перезагрузки окна.

## B4. [ ] Lazy activation в не-игровых воркспейсах (REG, P1)

MK3 стартует в любом воркспейсе; MK2 активировался только по игровому файлу.
Есть `view-policy.ts`, нужен явный activation-gate.

**Done when:** в пустом JS-воркспейсе extension host не загружает modkit-модули
(проверка по startup banner / trace).

## B5. [ ] Wire-контракт без дублей литералов (ARCH, P1)

Клиент должен импортировать имена нотификаций и типы payload с серверной
стороны (`MOD_CHANGED_NOTIFICATION`, протоколы descTree/gamedata/layout/modResource).
Проверить `language-session.ts` / `bridge.ts` на продублированные строки-литералы.

**Done when:** grep по apps/vscode не находит literal-имён нотификаций; переименование на сервере ломает сборку клиента.

## B6. [ ] One-time provisioning с жёстким таймаутом + прогресс-нотификации (REG, P1)

Перед конектом LSP: если глобальный кэш SC2 game data пуст — автозапуск
`modkit install --scope global` с прогрессом и таймаутом 5 мин; при фейле
сервер стартует и «чисто отказывается». Нотификации сервера («Indexing SC2
archives…») → `withProgress` хоста.

**Done when:** холодный старт на машине без кэша показывает прогресс, не зависает;
при обрыве — понятная ошибка и рабочий «пустой» сервер.

## B7. [ ] Lazy resolve completion item (REG, P2)

Тяжёлые детали подсказок (DDS-миниатюры, описания ассетов) дозаполняются
лениво в `resolveCompletionItem`, а не в основном списке.

**Done when:** completion в поле с сотнями кандидатов отвечает < 100 мс; превью
появляется после задержки на подсвеченном элементе.

---

# ЭПИК C — P1: VFS, источники, CASC

## C1. [ ] Merge скоупов источников: User ∪ Workspace-Folder + priority + disabled tombstones (REG, P1)

Сейчас: `modkit.extensions` + `SettingsDocument.gameInstallations` как плоский
список. Нужно: единая first-hit-wins-цепочка с приоритетом (меньше = раньше) и
tombstones отключения.

**Done when:** один и тот же путь в user- и workspace-скоупе резолвится по
priority; disabled-запись в workspace перебивает user; видно в Explain resolution (← A3).

## C2. [ ] Path-токены (REG, P1)

`${workspaceFolder}`, `${workspaceFolder:Name}`, `${env:VAR}`, `${userHome}`,
workspace-relative. Сейчас только env-переменные.

**Done when:** все настройки путей принимают токены; тест на каждый токен.

## C3. [ ] `casc.cacheMode`: parsed | on-demand | full | none + общий cacheDir с LSP (REG, P1)

Самый дешёвый выигрыш по скорости: host-independent кэш-рут per game build,
разделяемый с LSP-процессом (кто первый прогрел — тот нагрел).

**Done when:** после прогрева VS Code-слоем LSP не парсит MNDX заново
(замер по логам); режим переключается и документирован.

## C4. [ ] `casc.extractionBackend` auto/native/typescript + `extractedPath` + CDN-fallback (REG, P2)

Нативный помощник vs portable-ридер; офлайн-воркфлоу с распакованным CASC;
добор файлов с Blizzard CDN при неполной установке.

**Done when:** три бэкенда выбираются настройкой и проходят smoke-тест на одном корпусе; extractedPath работает без CASC.

## C5. [ ] Секции VFS Sources и Resources в панели Modkit (NEW, P1) ← C1, C2

Из todo: раздел «VFS Sources» — все источники Modkit + добавление новых;
автодетект CASC-установок и SC2-директорий (saves, wizards, cache, корень игры)
через расширения игр. Источники добавляют расширения.

**Done when:** панель показывает список источников с типом/скоупом/статусом;
кнопки Add Source / Add CASC / Detect SC2 Install работают; удалённый источник исчезает из резолва.

## C6. [ ] Resources tree как game-provider контракт (NEW, P1)

MK2-набор: gamedata→(Abil/Actor/Unit…), layouts→(все s2 layouts),
strings→(locales→GameHotkeys/GameStrings/ObjectStrings/TriggerStrings),
galaxy→(functions/variables/structs/includes), asset aliases, editorcategories,
fontstyles→(styles/constants/font groups), preload, files→(grouped by type),
dependencies. Таб называется **«Resources»**; ресурсы грузятся по выбору
пользователя (файл вне мода/workspace → юзер выбирает ресурс+мод, либо стандартный мод из CASC).
Наборы ресурсов задаются в расширениях игр — универсально, без SC2-веток в ядре.
Клик по элементу → карточка сущности или переход к определению в коде.

**Done when:** дерево строится из contributions subject-kind-*.json + modResource-протокола;
ни одной format-specific ветки в ядре; клик по Unit открывает Entity Card (← E1).

## C7. [ ] Мульти-мод: N загруженных модов, свои наборы ресурсов, разные игры (NEW, P1) ← C6

Одновременно открыты мод SC2 и Warzone 2100; у каждого свой набор ресурсов;
ресурсы привязаны к папкам/файлам. Провайдер мода строит свои деревья ресурсов.

**Done when:** два мода из разных игр загружены; completion/hover в файлах каждого
используют данные своего мода; unload одного не ломает второй.

---

# ЭПИК D — P1: Наблюдаемость и диагностика

## D1. [ ] `Export Diagnostics` → zip (REG, P1)

Сейчас пишет bounded journal (200 строк). Нужно: zip с логами, версиями,
эффективным конфигом, обнаруженными установками, загруженными модами, последним
трейсом резолвера; опция redact home path.

**Done when:** артефакт открывается, содержит все секции, пути redact'ятся по флагу.

## D2. [ ] Паттерн `surface.ts`: единый контракт ошибок (REG, P2)

Формат `<scope> failed: <msg>` + стабильные error codes + кнопка [Open Logs].
В MK3 есть viewer-status.ts/facilities.ts, нет унифицированного контракта.

**Done when:** все user-facing ошибки идут через контракт; коды задокументированы; lint-правило против сырых throw в UI-слое.

## D3. [ ] LogTape per-category + постоянный debug-файловый лог с ротацией (REG, P2)

`log.level` + `log.categories` (вроде `vfs.resolve: trace`) с мгновенным
применением без перезагрузки; всегда-он файловый лог.

**Done when:** смена категории на trace в рантайме сразу даёт строки в файле лога.

## D4. [ ] Startup banner с per-stage таймингами (REG, P3)

Одна строка: версия, корни, слитые источники со скоупами, CASC, кэш-рут+режим,
тайминги стадий (stages.ts/timing.ts уже есть).

**Done when:** в output-канале одна сводная строка при активации.

## D5. [ ] Source maps в упаковке (REG, P3)

Стеки ошибок указывают на TS-исходники.

**Done when:** ошибка в production-бандле показывает .ts-фрейм.

## D6. [ ] Статус-бар: `Modkit: N entities, M deps` (REG, P2)

**Done when:** отражает активный мод, обновляется при загрузке/выгрузке.

## D7. [ ] Webview log forward (REG, P3)

Логи webview'ов (вьюверы моделей/карт) — в общий output-канал.

**Done when:** console.error в webview появляется в канале Modkit.

---

# ЭПИК E — P1: SC2-расширения (глубина фич)

## E1. [ ] Entity Card + Relation Graph + Mod Wiki (REG, P1) ← C6

Карточка: иконка, description, ресурсы, command card, produced by, weapon
stats — всё, что было в MK2. Граф: packages/scene уже умеет; нужен запуск с
`maxGraphHops`. Wiki: модалка/панель; CDN-fallback картинок (`wiki.cdnRoot`).

**Done when:** Show Entity Card для Marine показывает иконку+статы+produced by;
Show Relation Graph строит граф с ограничением hops.

## E2. [ ] GameData: EditorCategories completion + валидация (REG, P1)

Значения из CASC (mods/core.sc2mod), не тащить 781 КБ в репо. Подсказки
`Category:`, допустимые значения, диагностика неверных.

**Done when:** completion по Category работает на чистой установке; битая категория даёт diagnostic с позицией (← A2).

## E3. [ ] GameData: completion по `parent=` + цепочка наследования (REG, P1) ← B1

Подсказки id той же namespace с `default="1"`; CodeLens «N полей унаследовано»
+ цепочка родителей; hover — таблица resolved-полей с указанием предка
(buildChain); команда «Show resolved entity»; DocumentLink на parent.

**Done when:** на цепочке Unit A→B→C hover по полю показывает источник из B или C;
parent= подсказывает только совместимые id.

## E4. [ ] XSD-документация и docsUrl из расширения (REG, P2)

`<xs:documentation>` → проза в hover/completion; путь к XSD даёт blizzard-расширение,
не настройка пользователя. `docsUrl` — кастомизируемая ссылка на sc2mapster в hover.

**Done when:** hover по ActorType даёт текст из XSD без ручной настройки пути.

## E5. [ ] Strings: baseline-сравнение + Review (REG, P1)

Baseline: git-коммит / source-string-cache (`.modkit/strings-cache/<mod>/<locale>/...`) / выбранный файл.
Бейдж «review» на устаревших переводах + фильтр Review + Save source strings cache +
Extract Changed Strings (since git ref).

**Done when:** после отката локали на коммит назад таблица помечает изменённые
строки; Extract выгружает только diff.

## E6. [ ] Strings: tree-режим + валидация markup с severity (REG, P2)

Custom editor: Columns + Tree (переключение как в MK2); валидация markup/ссылок
не вкл/выкл, а по severity. Автоперевод — один интерфейс + 1–2 провайдера
вместо 5 enum'ов (← extensions/translation).

**Done when:** переключение Columns⇄Tree⇄Text кнопками в editor/title; битый
markup даёт warning/error по severity.

## E7. [ ] SC2Layout: DescTree + Element view + property-bind + HTML preview (REG, P1)

Целиком missing (7/7 в рестре). packages/ui/src/tree есть — собрать layout-дерево
свойств выбранного элемента; разбор `Property=` привязок; команды Preview /
Show in Text Editor / Reveal in DescTree / Show Properties. tabStop /
stategroupDefaultState — дефолты расширения, не настройки пользователя.

**Done when:** открытие `.SC2Layout` даёт DescTree в activity bar, клик по
элементу показывает свойства, Preview рендерит раскладку.

## E8. [ ] Galaxy: verify + snippets + дерево символов (REG, P2)

Кнопка «Modkit: Verify Galaxy Script» в editor/title; снаппеты
galaxy-general.json; symbol tree + навигация по определениям.

**Done when:** на тестовом скрипте verify даёт список ошибок; Ctrl-Space
подставляет снаппет; Outline показывает функции/переменные.

## E9. [ ] Codec-ассеты: Assets.txt, version-файлы (REG, P2)

`Mods/…/GameData/Assets.txt` — codec-файл со всеми LSP-фичами (как gamestrings).
SC2 version-файлы — просмотр и редактирование полей данных.

**Done when:** Assets.txt даёт completion/hover/definition; version-файл
редактируется через форму полей.

## E10. [ ] Map preview 2D + 3D + map-image (REG, P1)

Preview SC2Map (2D) и in 3D; height/cliff/texture → PNG. `packages/scene` и
`map-preview.ts` существуют; экран `world` в stages.ts (L115) скрыт view-policy — включить.

**Done when:** обе кнопки превью работают на корпусе карт; world-экран доступен.

## E11. [ ] Preload/DocInfo определения (REG, P3)

Go-to-def по `<Preload>`-записям, отдельный парсер.

**Done when:** Ctrl-click по preload-ссылке открывает файл.

## E12. [ ] DDS-конвертеры и batch как операции кодека (REG, P2)

Export PNG, Convert DXT5→DXT1 (binary alpha), Prepare SC2 Button Icon,
Convert PNG Icon→DDS; Batch Convert Images in Folder — как **операция кодека**,
не команда плагина (тогда доступна всем хостам).

**Done when:** конверсии видны в command palette для DDS-файла и в контекстном
меню папки; реализованы через codec operation (← F13 — конверсии вообще не работают).

## E13. [ ] Pathfinding-слой карт (NEW, P2)

Рампы, узкие проходы, точки перед/над рампами, cliff-walker пути,
блокирующие/полублокирующие камни, минеральные стены, маршруты через центры
проходов/областей, отдельные цвета cliffwalker-only и требующих очистки.
В MK2 нет — собственная фича; инфраструктура (terrain harness, spatial map) — отсюда.

**Done when:** на тестовой карте оверлей показывает рампы и проходы двух категорий; данные отдаются через host-контракт.

---

# ЭПИК F — P1: UI/UX-дефекты (из todo all)

## F1. [ ] Undo/Redo в редакторах изображений (FIX, P0)

Висит в обеих копиях todo. Не работает вообще.

**Done when:** цепочка правок → Undo×N → Redo×N возвращает побайтово то же состояние; тест.

## F2. [ ] Сохранение изображения только по нативному Save (FIX, P0)

Внимание: **противоречие требований** — `todo all` («saved only on native
Save») vs `modkit-core/todo` (обратная формулировка). Сначала закрыть
противоречие (решение за пользователем), затем реализовать.

**Done when:** автосейва нет; маркер dirty появляется при правке; Ctrl+S пишет файл.

## F3. [ ] Селект-инструменты: синий цвет, полупрозрачность в области выделения (FIX, P1)

**Done when:** рамка/заливка выделения — синий ~50% alpha поверх рендера.

## F4. [ ] Инкрементальный re-render: только thumbnail в gallery, без re-render file webview (FIX, P1)

Сейчас любая модификация перерисовывает gallery и file view целиком.

**Done when:** при правке изображения обновляется только его thumbnail;
открытый file webview не пересоздаётся (проверка по счётчику create/destroy в логе webview).

## F5. [ ] Убрать Transform-панель из правого сайдбара; операции — в command palette (FIX, P1)

`id: 'transform'` в `stages.ts` L87. Операции оставить как команды (>) +
добавить операции SC2-расширений для изображений в ту же палитру.

**Done when:** панели нет; `> Modkit:` показывает transform-операции и операции кодеков SC2.

## F6. [ ] Metadata-панель как type-driven форма (FIX, P1)

Каждое значение metadata: тип + допустимые значения → свой редактор
(select / text / number / color). Для PNG — установка полей PNG прямо оттуда.
Color-поля — с colorpicker (опции констант SC2, где применимо).
Поле `for` у relations — список опций; файловые поля — для каждого языкового кодека.

**Done when:** форма строится из схемы формата; правка поля → dirty → Save (← F2); colorpicker открывается.

## F7. [ ] Конверсии не работают: «ничего не происходит после выбора» (FIX, P0)

Открытый баг; блокирует E12.

**Done when:** выбор конверсии показывает прогресс и результат (файл/уведомление) либо внятную ошибку по контракту D2.

## F8. [ ] Mip levels: отдельная секция, lazy load при раскрытии, показ всех mips как в галерее (FIX, P1)

Переименовать «subresources comparison and export» короче.

**Done when:** секция не грузит mips до раскрытия; все mips показываются сеткой; экспорт выбранного.

## F9. [ ] Gallery: скрыть из всех webview'ов, оставить только в панели Modkit (FIX, P2)

**Done when:** ни один viewer-webview не содержит gallery-панель.

## F10. [ ] «Toggle right panel» в actions-container; панель скрыта по умолчанию; состояние панели и секций персистится (FIX, P1)

**Done when:** после перезапуска окна восстановлены: видимость панели и
expanded/collapsed каждой секции.

## F11. [ ] Popup-меню архивов — нативные (NEW, P1)

В VS Code — `vscode.menu` API (не webview): тот же фон, разделители, отступы,
хоткеи; навигация стрелками и Tab. В Electron-хосте — кастом, но с той же темой.

**Done when:** контекстное меню архива — нативное; работает клавиатура.

## F12. [ ] Скрыть Host panel; Problems — только при наличии проблем (FIX, P2)

**Done when:** `modkit.host` скрыт по умолчанию (команда показа остаётся);
problems-секция не видна при нуле проблем.

## F13. [ ] Hex editor: edit + undo/redo + save для каждого бинарного формата (FIX, P1)

`createHexEditor` зарегистрирован (stages.ts L266), но todo висит → проверить
функциональность. Требование: правка значений, undo/redo, save для **каждого**
бинарного формата (через generic-контур, не per-format).

**Done when:** правка байта в .dds и .m3 → dirty → save → файл изменился; undo откатывает.

## F14. [ ] Vector/documents: тот же шаблон webview, что у изображений + режимы preview/code/both (FIX, P1)

Принести всю функциональность из MK2; кнопка в actions-container:
preview+code / только code / только preview (как в md-viewерах).

**Done when:** SVG/SWF/RTF/EMF открываются в общем шаблоне (render area + right panel), переключение режимов работает.

## F15. [ ] Прочие просмотрщики MK2: статус и перенос (REG, P2)

SWF (Ruffle), OGV/video (ffmpeg-wasm), RTF (rtf.js), EMF/WMF (нативный
рендерер Windows), Font preview (.ttf/.otf/.fnt с глифами), Replay Player +
Replay 3D (APM/build-order, модели из CASC, `replay3d.mapsDirs`).
Для каждого: либо перенести, либо явно отметить superseded с причиной в ledger.

**Done when:** список закрыт решениями в feature-ledger; перенесённые работают.

---

# ЭПИК G — P2: Архитектура VS Code-слоя

## G1. [ ] Разбить extension.ts (8284 строк) на модули (ARCH, P0-блокатор)

Цель: ≤ 500 строк на файл, группы: `viewers/`, `language/`, `extensions-ui/`,
`launch/`, `gallery/`, `diagnostics/`. Acceptance-пробы (disabledProbe,
L3975–4019) и runtime-debug-зонды — из production-пути активации в тесты/отдельный debug-модуль.
Делить порциями по одной группе за сессию; поведение не меняется.

**Done when:** extension.ts — только активация+делегирование; все тесты зелёные;
группы фич включаются/выключаются на VS Code-слое (профили).

## G2. [ ] `packages/host/native-text` → отдельный пакет или vendor (ARCH, P2)

Host декларируется browser-safe, но содержит нативную ветку.

**Done when:** packages/host не содержит нативных зависимостей; boundary-тест (← H1) проходит.

## G3. [ ] Один tsconfig-матрица вместо 25 в `starcraft2/` (ARCH, P2)

Project references или один tsconfig с include-матрицей. Сейчас — главный источник дрейфа.

**Done when:** `tsconfig.*.json` ≤ 3; сборка и ts-strict:check зелёные.

## G4. [ ] Одна карта `starcraft2`: `{lib,ts-lane,types}` + `modules/` (ARCH, P2)

Две параллельные структуры (порт-слой и модули) → одна карта module → src-lane или явный план слияния.

**Done when:** карта в docs/; расхождений нет либо план датирован.

## G5. [ ] Единый provenance-реестр (ARCH, P2)

Сейчас 4 места: codec-kit/MK2-*.json, starcraft2/MK2-*-PROVENANCE.json,
R7-SOURCE-DISPOSITION.json, migration/mk2-copy/*.json. Один реестр + проверка в `pnpm check`.

**Done when:** три файла-источника удалены/импортированы из реестра; check валидирует.

## G6. [ ] Манифесты apps/vscode: 4 → 2 (ARCH, P3)

bundled-contributes.v1.json + contributes.generated.json + format-smoke-policy.v1.json
+ publication-artifact.v1.json → один генерируемый + один publication-артефакт.

## G7. [ ] presentation-catalog.generated.ts — убрать из src/ (ARCH, P3)

Генерируемый файл рядом с исходниками; перенести в generated/ или dist/;
check должен отличать перегенерацию от ручной правки.

## G8. [ ] `extensions/translation` — статус (ARCH, P3)

Перевод — не форматный кодек. Либо built-in product module (как code/scene/uv)
с явной пометкой, либо в modkit-extensions-other.

## G9. [ ] Синхронизация workspace ↔ lock ↔ версии ↔ профили (FIX, P1)

- `modkit.workspace.json`: один профиль `focused-ga` при пяти заявленных в README.
- В sources[] пять (blizzard, warzone, ea, spring, other), в lock — только blizzard + warzone.
- Версии: casc/mpq/starcraft2/models/galaxy = 1.0.0; diablo/warcraft-3/common-formats/warzone = 0.1.0 — все в focused-ga с `extensions: ["*"]`.
- Легаси-env `MODKITX_SC2_ROOT`/`MODKITX_WARZONE_ROOT` — назначить срок удаления.

**Done when:** profiles:check и check:extensions падают при любом рассинхроне; README = реальность.

---

# ЭПИК H — P2: Tooling / CI

## H1. [ ] `verify-dependency-boundaries` в гейт (REG, P2)

Проверка: browser-safe пакеты не тянут `node:*`. В MK3 аналога в `pnpm check` нет.

## H2. [ ] `codecs:generate/validate/traits/docs` (REG, P2)

Кодоген из манифестов кодеков + trait-index («чем какой формат умеет»).
Ложится на codec-kit + contributions.

## H3. [ ] `test:roundtrip:batches` + `archive:corpus` (REG, P2)

Массовые roundtrip-прогонки конверсий на корпусе карт (критично для todo
triggers); сборка корпуса из установленной игры.

## H4. [ ] WebGL parity harness'ы (REG, P3)

`@vscode/test-electron` + Playwright browser-harness для WebGL-вьюверов;
WC3 visual parity — пиксельное сравнение рендера с эталоном.

## H5. [ ] Headless debug-драйвер language-фич (REG, P3)

`pnpm debug --file ... --casc ... [--offset --id]` — прогон completion/hover/
usages без VS Code. Частично закрыт automation-host/CLI, но не как language-фичи.

## H6. [ ] Разделить `pnpm check` (ARCH, P2)

30+ последовательных гейтов, из них 11 — проверки процесса портирования
(mk2-copy, ports:check, check:mk2, migration:*, parity:*, evidence:*,
priority:check). Вынести в `pnpm migration:gate`; product-гейт должен
пролезать по времени/диску.

**Done when:** `pnpm check` ≤ ~5 мин на рабочей машине; migration:gate — отдельно.

---

# ЭПИК I — P2/P3: Гигиена репозитория

## I1. [ ] feature-ledger ↔ статус «GA» (FIX, P1)

710/902 pending (78.7%) при заявленном «Focused Product GA». Прогнать
`pnpm check` полностью и зафиксировать честный статус; затем либо доводить
ledger, либо переименовать в beta. Каждую pending-запись — в этот бэклог или в superseded с причиной.

## I2. [ ] todo → трекер со статусами (PROCESS, P2)

6 todo-файлов в корне + modkit-core/todo (дубли, расходятся; `todo data`
содержит мусор `/compact`; противоречие F2). Перенести в issue-трекер/backlog,
файлы удалить после переноса.

## I3. [ ] `.cache/` — ~90 скриптов-однодневок (PROCESS, P2)

edit1.py, splice2/3/6.py, soften*.py и т.п. — архивировать в references/ или
удалить; они маскируют реальные инструменты scripts/.

## I4. [ ] Бинарники из git (PROCESS, P3)

artifacts/ (PNG, .wz, .m3) → отдельное хранилище, в git JSON-отчёты.
Вендорские деревы с датами (`.tmp/warzone-generated-vendor-20260912`,
`.tmp/astcenc-5.6.0`, `vendor-refresh-native-encoder/`) → один `vendor/` с манифестом версий.

---

# Порядок взятия (критический путь)

```
A1 ──► B1 ──► E3            (языки → контракт → parent chain)
A2 ─────────► E2, E5        (позиции → валидации)
A3 ──► C1 ──► C5 ──► C6 ──► C7   (резолв → скоупы → sources → resources → мульти-мод)
C3                            (независим, быстрый выигрыш)
F7 ──► E12                    (конверсии работают → как codec-операции)
F1, F2                        (независимы, маленькие)
G1                            (в любой момент, порциями; блокатор скорости)
I1                            (после H6 — честный прогон check)
```

Рекомендация на первые 3 сессии: **A1 → A2 → C3** (видимые регрессии + самый
дешёвый выигрыш по скорости), параллельно **F1/F2** как мелкие изолированные фиксы.
