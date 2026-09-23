# Blizzard / StarCraft II: завершение перехода на MK3 и шаблон игровых расширений

Дата: 2026-09-21  
Статус: в реализации; первая интеграция 2026-09-22  
Выполненная часть и результаты проверок: [отчёт реализации 2026-09-22](SC2_MK3_COMPLETION_IMPLEMENTATION_2026-09-22.md).  
Репозитории:

- `modkit-core` — универсальные контракты, host, LSP/MCP, приложения и общий UI;
- `modkit-extensions-blizzard` — Blizzard-форматы и игровые расширения;
- `starcraft2` — реализация StarCraft II поверх контрактов MK3.

## 1. Текущая оценка

Blizzard/SC2 находится на уровне поздней alpha / ранней beta MK3. Архитектурный фундамент уже
пригоден для развития продукта, но полный переход с MK2 и пользовательский parity ещё не завершены.

Сильные стороны текущего состояния:

- единая SC2 Data schema и единый resolved workspace вместо отдельных моделей для LSP, UI и MCP;
- schema-aware completion, hover, diagnostics, navigation и inheritance;
- универсальные codec/provider/service contributions;
- CASC, VFS, папочные и архивные источники;
- стандартная загрузка модов, dependency graph и виртуальный `DocumentInfo` для встроенных CASC-модов;
- общие subject, resource, relation, language и knowledge contracts;
- Galaxy, Layout, Strings, Styles, Wizards, Triggers и Data уже представлены отдельными владельцами;
- Battle.net VFS, аккаунты, публикация и удаление имеют проектные контракты и fixture-тесты;
- quick/owner/real/pack тестовые уровни и проверки fidelity.

Признаки незавершённого перехода на дату исходного аудита (снимок 2026-09-21,
не текущий счётчик оставшихся работ):

- 599 файлов всё ещё находятся в деревьях `src/lib/mk2`;
- в 25 production-файлах новых SC2-модулей встречались текстовые ссылки на MK2 (включая комментарии), преимущественно на map
  readers/writers, navigation, preview и SC2 Arcade types;
- используются compatibility API `@modkit/codec-kit/legacy/*`;
- основной SC2 package публикует каталог `src`, включая legacy;
- существует отдельный `compat/starcraft2-game` без объявленного срока удаления;
- 40 из 59 проверенных codec/provider manifests помечены `partial`;
- VS Code `apps/vscode/src/extension.ts` содержит около 10 000 строк;
- module-map gate не проходит для `blizzard/starcraft2-image-operations`;
- полный UI parity с MK2 и live Battle.net acceptance не достигнуты.

## 2. Целевое состояние

Переход на MK3 считается завершённым, когда:

1. Production-код `modules/` не импортирует `src/lib/mk2` и `legacy/*`.
2. У каждого формата ровно один владелец модели и семантики:
   - Data schema и catalog resolution принадлежат Data;
   - Galaxy grammar, native API и script semantics принадлежат Galaxy;
   - Layout schema и rendering semantics принадлежат Layout;
   - Strings, Styles, Wizards и остальные форматы имеют собственных владельцев без копий моделей.
3. LSP, MCP, CLI, VS Code, Electron и Web используют одни и те же providers и resolved data.
4. Файлы из filesystem, archive, CASC, cache и Battle.net проходят один subject/workspace pipeline.
5. Все пользовательские возможности MK2 либо восстановлены, либо заменены документированным
   функционально эквивалентным MK3-механизмом.
6. `partial` остаётся только у действительно неполных форматов и содержит точный список
   `unsupportedFeatures`.
7. Установленный VSIX проходит end-to-end матрицу на реальных SC2 данных.
8. Public package не содержит внутренних legacy-деревьев и случайных generated/build artifacts.

## 3. Задачи завершения Blizzard / SC2

### P0. Приёмка реального продукта

- [ ] Пройти installed VSIX acceptance для folder, MPQ, CASC и Battle.net subjects.
- [ ] Проверить автоматическое определение открытого `.SC2Mod`, `.SC2Map` и `.SC2Campaign` из
      любого source provider.
- [ ] Проверить dependency chain и effective data для Liberty, Swarm, Void и campaigns.
- [ ] Проверить Sources и Resources при открытии вложенного файла, а не только корня subject.
- [ ] Измерить и ограничить задержку completion после `<`, пробела, `=`, `,` и `;`.
- [ ] Проверить Data, Galaxy, Layout, Strings, Styles, Wizards и Triggers через обычную активацию
      VS Code без специальных test-only activation paths.
- [ ] Добавить один воспроизводимый acceptance receipt с версиями Core, Blizzard extension, VSIX и
      SC2 build.

### P0. Удаление production-зависимостей от MK2

- [x] Составить точный реестр прямых импортов `modules/** -> src/lib/mk2/**` и `codec-kit/legacy`
      с владельцем и заменой: Blizzard `architecture/mk3-legacy-imports.json`.
- [x] Перенести low-level map readers/writers в постоянный MK3 map-format module без изменения
      проверенной бинарной семантики.
- [x] Перенести navigation, map image и overview operations в Map-owned modules.
- [x] Вынести `Sc2ArcadeClient` и связанные data-only types из MK2 game implementation в
      Battle.net/SC2 contracts.
- [ ] Заменить production-использование `@modkit/codec-kit/legacy/*` постоянными публичными API.
- [x] Добавить CI gate, запрещающий новые прямые импорты из `src/lib/mk2` и `codec-kit/legacy/*`
      сверх проверенного остаточного baseline. Проверка aliases/transitive closure ещё не выполнена.
- [ ] После миграции удалить неиспользуемые MK2 entrypoints, их exports и дублирующие тесты.
- [ ] Исключить `src/lib/mk2` из публикуемого SC2 package.

### P0. Полный SC2 authoring parity

- [ ] Завершить все Data completion contexts: root, nested fields, structs, arrays, attributes,
      indexed values, enums, flags, links, file paths, inheritance и structure defaults.
- [ ] Передавать editor categories, inherited tokens, default-template metadata и точный field
      origin из единственного resolved Data context.
- [ ] Довести diagnostics, definitions, references, rename и resolved value до одинакового
      результата в LSP, UI и MCP.
- [ ] Сделать общий `Verify` contract и одну кнопку для всех codecs, которые поддерживают проверку.
      Уточнение реализации: существующие `subject.validate` / `asset.validate` уже покрывают codec
      operations. Добавлена кнопка Verify для активного текстового документа через общий language
      diagnostics contract, с несохранённым текстом, отменой, version guards и отметкой incomplete.
      Приёмка всех языков и объединение с toolbar бинарных/custom editors остаются открытыми.
- [ ] Довести Galaxy completion, signatures, symbols, verify и native API documentation.
- [ ] Довести Layout DescTree, element/property editing, bindings и preview.
- [ ] Довести Strings locale comparison, markup validation, tree и review workflow.
- [ ] Проверить Styles и Strings совместно: style references, rename, diagnostics и preview.
- [ ] Довести Wizards и ссылки из Data/Wizard на Strings и остальные data types.

### P1. Sources, Resources и subject UI

- [ ] Показывать все активные sources: filesystem, CASC, SC2 cache, save games, wizard documents,
      public Battle.net content, user publications и providers сторонних расширений.
- [ ] Представлять cache entries пользователю как `.SC2Map`/`.SC2Mod`, сохраняя исходный `.s2ma`
      только как provenance.
- [ ] Добавить `Open in Explorer` для реальных файлов, архивов, cache/settings/mod folders.
- [ ] Поддержать несколько одновременно открытых subjects разных игр без глобального selected mod.
- [ ] Завершить entity cards: resolved values, provenance, editable stats, wiki links/images,
      model/audio preview и game-specific sections.
- [ ] Завершить relation graph и списки Uses / Used By на общей graph projection.
- [ ] Использовать одинаковые components и actions в Resources, editor cards и standalone viewers.

### P1. Battle.net

- [ ] Подключить production native authentication backend к существующим account/session contracts.
- [ ] Проверить US/EU/KR profile selection и изоляцию нескольких аккаунтов.
- [ ] Довести public search, own publications, download, cache и dependency loading.
- [ ] Довести create/update/delete публикаций и recovery по durable operation journal.
- [ ] Выполнить отдельные live acceptance сценарии publish/update/delete; fixture-тестов недостаточно.
- [ ] Явно показывать unsupported region/backend operation в UI без ложного успешного состояния.

### P1. VS Code и общие приложения

- [ ] Разделить `apps/vscode/src/extension.ts` на activation, languages, sources, resources,
      subjects, commands, diagnostics, webviews и application wiring.
- [ ] Оставить в VS Code только адаптацию native API; вся игровая семантика должна приходить из
      contributions/providers.
- [ ] Убрать дубли строковых command/contract identifiers через SDK-owned constants.
- [ ] Добавить общую модель ошибок и progress/cancellation для длительных source operations.
- [ ] Проверить одинаковое поведение providers в VS Code, Electron, Web, CLI, LSP и MCP.

### P1. Manifests и честный статус возможностей

- [x] Исправить module-map для `blizzard/starcraft2-image-operations` (владелец — Textures).
- [ ] Для каждого из 40 `partial` manifests определить конкретные missing capabilities.
- [ ] Сначала закрыть Data, Galaxy, Layout, Strings, Styles, Mod и Map.
- [ ] Менять `partial` на `supported` только после codec tests, parity tests и app-level acceptance.
- [ ] Генерировать package exports и contribution lists из одного реестра вместо ручного
      дублирования в `package.json`.
- [ ] Добавить CI-отчёт: supported/partial, unsupported features, legacy imports и missing tests.
      Прямые legacy imports и manifest statuses теперь доступны через `completion:report`;
      evidence по отсутствующим тестам ещё не построен.

### P2. Чистота репозитория

- [ ] Разделить текущие большие незакоммиченные изменения на тематические проверяемые commits.
- [ ] Переместить generated schema/native API/tables в единообразные `generated/` каталоги и
      добавить команды `generate`/`check`.
- [ ] Удалить build outputs, временные probes и одноразовые scripts из tracked source tree.
- [ ] Сократить число SC2 `tsconfig` до небольшой матрицы base/node/browser/test.
- [ ] Определить lifecycle для `compat/starcraft2-game`: потребители, deprecation release и дата
      удаления.
- [ ] Сделать root README короткой точкой входа; подробности вынести в `docs/`.
- [ ] Добавить `docs/architecture.md`, `docs/adding-a-game.md` и генерируемую feature matrix.
- [ ] Зафиксировать dependency boundaries и ownership правила в ADR и автоматической проверке.

## 4. Стоит ли упрощать схему игрового расширения

Да. Упрощать нужно композицию и регистрацию расширения, сохраняя существующие универсальные
контракты MK3. Installation discovery, launch plan, VFS, content sources, subjects, codecs,
languages и services уже являются правильными границами. Создание параллельной «упрощённой»
архитектуры только добавит второй способ делать одно и то же.

Текущая сложность SC2 возникла из сочетания нескольких факторов:

- `package.json` вручную перечисляет много exports и contribution manifests;
- feature registration распределена между package metadata, generated contributions и app wiring;
- source, format, language, knowledge и game-online функции лежат рядом, но не собраны в один
  читаемый профиль игры;
- исторические MK2/compat пути смешаны с постоянными MK3 entrypoints;
- SC2 одновременно является игрой, семейством форматов, online provider и самым сложным примером.

### Предлагаемое упрощение

Добавить data-only профиль `game.extension.json` и небольшой build-time генератор. Профиль не
заменяет provider contracts; он только собирает существующие contributions в понятное целое.

Пример логической структуры:

```text
<game-package>/
  game.extension.json
  README.md
  modules/
    game/
      installation/
      workspace/
      launch/
      dependencies/
    sources/
    formats/
    languages/
    knowledge/
    previews/
  assets/
  test/
    contract/
    corpus/
    real/
```

Минимальный профиль должен описывать:

- стабильные vendor/game/extension IDs и presentation metadata;
- package/subject kinds (`map`, `mod`, `campaign`, другие игровые единицы);
- installation, workspace, dependency и launch provider contributions;
- поддерживаемые content-source schemes;
- codecs и path/content matchers;
- language providers и document routing;
- optional knowledge, preview, editing и online capabilities;
- тестовые уровни и текущий support status.

Генератор должен выпускать contribution manifests, package exports, документационную feature matrix
и module-map. Runtime host продолжает загружать обычные MK3 contributions и не знает о генераторе.

### `@modkit/game-kit`

Имеет смысл добавить небольшой helper package только для повторяющегося glue-кода:

- `defineGameExtension(profile)` — compile-time validation data-only профиля;
- helpers для bounded installation discovery;
- стандартные folder/archive/cache content sources;
- адаптер package subject → workspace/dependency graph;
- общие test contracts для установки, открытия subject, VFS и запуска;
- генерация manifests/exports/docs.

В `game-kit` нельзя переносить SC2 Data schema, Battle.net, SAGE, Spring или Westwood semantics.
Новые helpers следует добавлять после появления одинаковой реализации хотя бы во второй игре.

## 5. Возможность расширений для других игр

Да, текущая MK3 подходит для этих игр, если использовать SC2 как проверку возможностей платформы,
а не как кодовый шаблон для копирования. Повторно используются contracts, VFS, subjects, codecs,
language services, UI и MCP; игровые форматы и dependency semantics остаются в своих расширениях.

### Рекомендуемые семейства

| Игра | Рекомендуемая организация | Основная новая работа | Сложность |
| --- | --- | --- | --- |
| Warzone 2100 | самостоятельное game extension | WZ/WZM, JSON/INI, maps, scripts, package/dependency rules | низкая–средняя |
| C&C 3 | общее расширение семейства SAGE + тонкий game profile | BIG archives, XML schemas, assets, mod dependencies | высокая |
| Red Alert 3 | тот же SAGE family package | RA3 schema/profile, assets и отличия toolchain | высокая после C&C 3 — средняя |
| BAR | Spring-family extension | `.sd7/.sdz`, Lua/LSP, maps, units, dependency metadata | средняя–высокая |
| StarCraft 1 | Blizzard family extension | MPQ/CASC routing, DAT/TBL/CHK, GRP, scripts и campaign deps | высокая |
| Red Alert 2 | Westwood family extension | MIX, INI, CSF, SHP/VXL/HVA, map rules | высокая |

Warzone 2100 лучше использовать как первый независимый pilot: открытые данные и исходный код игры
позволят проверить, что MK3 не зависит от Blizzard assumptions. После pilot стоит выделить только
реально повторившийся glue-код в `game-kit`.

C&C 3 и Red Alert 3 должны разделять SAGE-level codecs и services, но иметь отдельные game profiles,
schemas и acceptance corpora. Аналогично Red Alert 2 лучше строить поверх общего Westwood package,
а StarCraft 1 — поверх общих Blizzard MPQ/CASC/image/audio primitives без импорта SC2 modules.

## 6. Минимальная матрица готовности нового игрового расширения

Каждое новое игровое расширение проходит одинаковые стадии:

1. **Identity:** vendor/game IDs, README, licenses, icons, feature status.
2. **Installation:** bounded discovery с evidence и версией игры.
3. **Sources:** folder/archive/cache/online VFS без прямого доступа UI к файловой системе игры.
4. **Subjects:** map/mod/package recognition и стабильная resource namespace.
5. **Dependencies:** единый ordered dependency graph с provenance.
6. **Formats:** lossless parse/write либо честный read-only/partial статус.
7. **Languages:** syntax, completion, hover, diagnostics, navigation, rename и verify по возможностям.
8. **UI:** Sources, Resources, cards, previews, editors и relations из общих components.
9. **Automation:** те же возможности через CLI, LSP и MCP; skills не читают приватные файлы напрямую.
10. **Evidence:** deterministic corpus, malformed/budget tests, roundtrip, installed-game acceptance.

## 7. Рекомендуемый порядок исполнения

1. Завершить SC2 acceptance и исправить видимые P0-регрессии.
2. Удалить production imports из MK2 и поставить dependency boundary gate.
3. Довести семь основных SC2 authoring-модулей и общий Verify.
4. Завершить Resources/cards/previews/relations и source workflows.
5. Разделить VS Code monolith и очистить package/public exports.
6. Ввести `game.extension.json` и генератор на существующем SC2 без изменения runtime contracts.
7. Реализовать минимальный Warzone 2100 pilot.
8. По результатам pilot выделить доказанно общие helpers в `@modkit/game-kit`.
9. Создавать engine-family extensions: SAGE, Spring, Blizzard classic и Westwood.

## 8. Definition of Done для Blizzard / SC2 MK3

- [ ] ноль production imports из MK2/legacy;
- [ ] основной package не публикует legacy source tree;
- [ ] contribution/module-map checks проходят;
- [ ] основные manifests имеют честный `supported` либо документированный `partial`;
- [ ] installed VSIX acceptance покрывает folder, archive, CASC, cache и Battle.net;
- [ ] Data/Galaxy/Layout/Strings/Styles/Wizards/Triggers используют общие LSP/MCP/UI contracts;
- [ ] Resources и entity UI обеспечивают не меньший функционал, чем MK2;
- [ ] Battle.net операции имеют live acceptance receipts;
- [ ] VS Code entrypoint выполняет только композицию и адаптацию;
- [ ] документация позволяет создать минимальное новое игровое расширение без чтения SC2 internals.
