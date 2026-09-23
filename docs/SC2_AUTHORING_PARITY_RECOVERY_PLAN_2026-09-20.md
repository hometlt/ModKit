# Восстановление функциональности MK2 в MK3: план исправлений и приёмки

Дата: 2026-09-20. Обновлено: 2026-09-21. Статус: **первый Data/VS Code vertical
slice, компактный resolved Data authoring index и точное on-type поведение `=` проверены;
R1/R2/R3 остаются частично выполненными**.

Основание — пользовательские сценарии и 11 снимков MK2, сравнение исходников MK2/MK3,
проверка текущего Data provider на синтетических документах и аудит существующей приёмки.
Проверялись рабочие деревья с незакоммиченными изменениями, а не только HEAD:
`modkit-core` — `60e091ecc5cf78994545a65b81d05051dcc93990`,
`modkit-extensions-blizzard` — `065774b89d372dd3123a975c3fbd6e039a74b803`,
`references/modkitmk2` — `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`.

Это уточнение порядка выполнения и критериев готовности, **не новый независимый бэклог**.
Основные документы:

- [MK2 → MK3 backlog](MK2_TO_MK3_BACKLOG_2026-09-20.md).
- [Полный SC2 authoring backlog](../../references/modkit-docs/MK3/plans/BACKLOG_SC2_AUTHORING_LANGUAGES_KNOWLEDGE_AI_2026-09-20.md).
- [Оценка повторного использования](../../references/modkit-docs/MK3/plans/ASSESSMENT_SC2_MK2_MK3_REUSE_AND_GAPS_2026-09-20.md).
- [Предыдущая передача SOL](../../references/modkit-docs/MK3/reports/HANDOFF_SC2_AUTHORING_ARCHITECTURE_SOL_2026-09-20.md).
- [Фактические ограничения knowledge/AI](SOL_05_KNOWLEDGE_AI_2026-09-20.md).

## 0. Текущий фактический статус

Выполнено и проверено после составления плана:

- VS Code package статически объявляет bundled SC2 language ids, включая path-based routing
  `GameData/*.xml` и `LocalizedData/*.txt`; неоднозначный общий `xml` больше не блокирует Data route.
- Пустые `UnitData.xml` и `ActorData.xml` получают namespace из имени каталога; custom `*Data.xml`
  остаётся нетипизированным и предлагает классы всех каталогов без root structures.
- Root/field/attribute completion переносит точные replacement ranges, snippets/tab stops,
  type detail, документацию и reference link. Indexed scalar и indexed struct вставляются разными
  формами по схеме. Большие списки фильтруются по набранному префиксу до host result limit.
- Enum/bool/link candidates после `=` вставляют кавычки при принятии; flags продолжаются после
  `,` и `;` с заменой текущего сегмента. Data provider теперь объявляет on-type trigger `=`:
  VS Code вставляет `""`, оставляет курсор между кавычками и сразу вызывает value completion.
  Действие проходит через общий SDK/Host/VS Code/LSP контракт, без Data-специфичной логики в UI.
- Введён безопасный `LanguageWorkspaceSemanticInput.payload`: строгий bounded JSON,
  глубокое копирование/freeze, конфликтная проверка и участие payload в revision identity.
- Host публикует общий `content-path-index` для workspace и dependency mounts через публичные
  VFS/content-source API. Data file-link completion использует реальные scoped asset paths и
  фильтрует их по типу поля; приватного чтения CASC/диска в Data provider нет.
- Language provider декларативно запрашивает resolved Data context. Владелец
  `common.data/resolved-workspace@1` теперь может построить `resolved-data-authoring-index@1` до
  materialization полных definitions/relations: identity, parent-relative effective deltas,
  tombstones, structure defaults, winning sources и `valuesComplete`. Host предпочитает эту
  проекцию с лимитом 48 MiB и сохраняет совместимый fallback на `resolved-data-snapshot`.
  Отдельный Data resolver не добавлен.
- Завершённые semantic contexts находятся в byte-weighted LRU с общим лимитом 64 MiB; pending
  promises отделены и ограничены числом 16. Вес учитывает UTF-8 ключ и JSON результата,
  oversized запись не кэшируется, shutdown очищает оба набора.
- Исправлен конфликт namespace владельца service definitions: bundled расширение `modkit/data`
  больше не стирает platform contracts `common.data/catalog-analysis` и
  `common.data/resolved-workspace`. Недоступный semantic context теперь оставляет bounded status
  с причиной вместо молчаливого fallback. Language budget нормализуется к пределам Data service.
- Resolved Data service сохраняет валидную часть workspace, если один live authoring XML временно
  malformed; snapshot становится incomplete и содержит source diagnostic. Это необходимо для
  completion сразу после ввода `<`, когда документ ещё нельзя разобрать строгим XML parser.
- SC2 Data completion, hover, diagnostics, definition и workspace symbols используют этот effective
  snapshot. Идентичность сущности — `namespace + id`; совпадающие ID разных каталогов не
  смешиваются. Definition и symbols отображают winning `{rootId,path,documentIndex}` на точный
  документ через host-owned origins. Rename отказывается работать при неполном semantic context.
  Старый локальный `fallbackWorkspaceView` сохранён только для standalone/старого host и локальной
  сущности, временно выпавшей из partial snapshot; positional references сканируют те же bounded
  документы, потому что resolved relation не хранит диапазон текста.
- Definition сохраняет точный canonical winning source. Если временно некорректный live XML выпал
  из partial/non-authoritative snapshot, допускается только точный fallback на декларацию в самом
  открытом документе с `isIncomplete: true`; authoritative snapshot по-прежнему запрещает догадки.
- Реальный scale probe выявил обязательную смену проекции. Полный melee chain (538 документов,
  18,33 MiB XML) строит 47 292 definitions и 96 232 relations за 13,80 с, достигает 2,46 GiB RSS и
  сериализуется в 255,34 MiB. Это в четыре раза больше лимита semantic payload. Даже только полные
  effective fields занимают 74,11 MiB; parent-delta — 26,65 MiB. Поэтому реализован compact
  authoring index; full-snapshot bridge оставлен только как совместимый путь для старого SDK и
  малых корпусов.
- Installed VSIX acceptance теперь работает через обычную полную активацию, проверяет language
  routing, пустые typed/untyped каталоги, native `SnippetString`, ranges/docs, применение snippet,
  asset path, canonical resolved Data context, фактическое on-type `=` (`value=""`, caret и
  `Multiplayer` completion), partial-snapshot navigation, save/reopen и undo. Receipt:
  `reports/vscode-smoke/installed-language-receipt.json`.

Остаётся на критическом пути:

- штатно обновить pinned vendor SDK пакета Blizzard, чтобы packaged standalone-поставка включила
  `resolveDataAuthoringIndex`; до этого установленный VSIX корректно использует full-snapshot
  fallback, а compact/full parity проверяется в link-mode;
- завершить точный field origin на authoring index и ограничить локальный fallback случаями
  partial/non-authoritative live document;
- передать editor categories, inherited entity tokens и default-template metadata из того же
  semantic snapshot;
- расширить проверенное нейтральное on-type поведение на остальные применимые символы и codecs;
- восстановить Sources/Resources, карточки/editors/previews/graph и общий Verify;
- пройти полную матрицу остальных языков, LSP и MCP, а не только текущий VS Code slice.

## 1. Почему проблемы сохраняются

### 1.1. При переносе сохранили вычисление кандидатов, но потеряли поведение редактора

Это была подтверждённая причина исходного отказа. Текущий `completionItems` уже переносит ranges,
snippets/tab stops, type detail, документацию и reference links; assets приходят из общего
`content-path-index`. Нажатие `=` теперь выполняет общий on-type action. Реальный E2E выявил ещё
одну потерю на границе: VS Code adapter передавал экземпляр `vscode.Position`, а worker RPC
принимает только plain data objects. После копирования позиции в `{line, character}` установленный
VSIX вставляет `=""`, ставит caret между кавычками и открывает enum completion. Ещё не переданы
editor categories, inherited tokens и полная metadata default templates.

При этом перенесённый прежний адаптер уже лежит в
`modules/data/shared/format/language/providers/completions.ts`: там есть snippets,
`fieldTypeLabel`, `fieldDoc`, ranges, реальные assets, categories и tokens.
Нейтральный SDK уже поддерживает `documentation`, `insertText`, `insertTextFormat`,
`replacementRange`; VS Code умеет их отображать. Большую часть потерь можно исправить
полным переносом существующего отображения результата в SDK, без новой модели данных.
Прежний LSP-зависимый адаптер нельзя просто импортировать в универсальное ядро.

### 1.2. Тип каталога определялся ненадёжно

Причина исправлена для текущего SC2 Data route: назначение typed каталога определяется Data-owned
правилом имени `*Data.xml`, пустой документ поддерживается, неизвестный/custom каталог остаётся
untyped. Это поведение проверено прямыми тестами и установленной VSIX; archive/CASC/untitled и
конфликтующие document identities остаются в полной матрице R3.

Текущая проверка provider и установленного VSIX:

| Документ и позиция `<`            | Получено                                                          | Что это доказывает                                        |
| --------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| UnitData, включая пустой          | CUnit/CUnitHero/const и допустимые Unit root structures           | Namespace берётся из Data-owned filename rule             |
| ActorData, включая пустой         | CActor subclasses/const и допустимые Actor root structures        | Поведение не зашито под Unit                              |
| Неизвестный `*Data.xml`           | Классы всех каталогов, без root structures                        | Untyped catalog не получает ложную структуру пространства |
| Внутри CUnit/structure            | Допустимые поля текущей глубины                                   | Работает schema-path completion                           |
| Indexed scalar/structured field   | Разные schema-derived snippets, ranges, docs и tab stops          | Вставка не угадывает одну форму для всех массивов         |
| Enum после фактического ввода `=` | `value=""`, caret внутри, затем кандидаты, например `Multiplayer` | Проверена редакторская граница, а не только provider API  |

Provider-level тесты дают точную семантику, а installed VSIX подтверждает редакторскую границу.
Конкретное число кандидатов зависит от схемы и не является постоянным критерием готовности.

### 1.3. Языковой слой имел свою упрощённую модель effective data

Host теперь предпочитает owner-generated `resolved-data-authoring-index@1`; старый
`resolved-data-snapshot` остаётся fallback для pinned SDK. Completion, hover, diagnostics и
navigation не выполняют повторный merge и разделяют сущности по `namespace + id`. Остаточный
локальный view нужен для standalone/старого host и для точного live-document fallback при partial
snapshot. Он не имеет права переопределять полный canonical context. До закрытия R1 остаются
field-origin edge cases и штатное обновление vendor SDK.

### 1.4. Наличие компонентов приняли за готовый пользовательский интерфейс

В core есть content-source операции, VFS, общие subject cards, field components,
relation graph и viewer-контракты. В Data есть `buildEntityCard` и projections.
Но Sources/Resources sidebar с показанным пользовательским процессом не подключён.
Команда выбора источника не заменяет постоянное дерево источников и ресурсов мода.
Отдельно требуют проверки routing XML/TXT, language packaging и virtual URI selectors.

### 1.5. Предыдущая приёмка была слишком узкой

Старая версия `apps/vscode/test-e2e/run-installed-language-acceptance.mjs` использовала
`MODKIT_VSCODE_LANGUAGE_ONLY=1` и проверяла в основном явные provider-команды. Текущая приёмка
запрещает этот режим, запускает обычную полную активацию и отдельно изменяет документ через VS Code
edit event. Она проверяет результат on-type правки, cursor, следующий completion, snippets,
navigation, assets, save/reopen и undo. Полный UI Sources/Resources/cards этим тестом ещё не покрыт.

Предыдущее объяснение отсутствующего служебного поля кэшем не было подтверждено:
разные activation paths уже объясняют различие API. Замена пустого тестового
каталога заполненным обошла обнаруженную проблему, вместо её исправления.
Это ошибка критериев приёмки. Исторические результаты узких тестов сохраняются,
но SOL-03/04 не означают завершённый пользовательский parity, SOL-05 также неполон.

## 2. Что переносить, что адаптировать, что добавлять

| Часть                                                                              | Решение                                                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Data schema, catalog merge/resolution, XML context, field docs, вычисления         | Максимально сохранить проверенную семантику и тесты; исправить подтверждённые старые дефекты              |
| Galaxy спецификация, parser/binder, описания native API; владельцы других форматов | Использовать существующих владельцев; никаких копий спецификаций в host/UI/MCP                            |
| Completion snippets/ranges/ranking, hover, validators                              | Перенести целиком по поведению; заменить зависимости от VS Code/LSP на существующие нейтральные DTO       |
| Источники, assets, dependencies                                                    | Подключить к существующему MK3 VFS и контексту выбранного мода; старый глобальный workspace не копировать |
| Entity wiki, command cards, расчёты, class-specific sections                       | Переиспользовать Data projections; адаптировать вывод к общим subject/card/field компонентам              |
| Relations                                                                          | Переиспользовать semantic edges и общий graph renderer; исключить второй индекс связей                    |
| Sidebar, menus, title actions                                                      | Восстановить пользовательские входы через native VS Code integration и общие модели дерева/команд         |
| SC2 cache, saves, Wizard documents                                                 | Проверить имеющиеся provider capabilities; добавить недостающие adapters в соответствующие расширения     |
| Универсальный Verify, недостающие client capabilities                              | Расширить существующие контракты только при доказанном пробеле, без второго language service              |
| Полное knowledge/AI покрытие                                                       | Дополнить знания и навыки поверх схем владельцев; не генерировать выдуманные объяснения неизвестных полей |

«Перенести целиком» означает сохранить алгоритм/поведение и пригодные тесты.
Это не означает копировать монолитный MK2 extension вместе с его lifecycle и отдельными кэшами.

## 3. Обязательная архитектура

Единая цепочка: **provider источника → VFS → контекст мода и зависимостей → snapshot
с unsaved overlays → владелец формата → нейтральные результаты → LSP/MCP/VS Code/UI**.

- Data владеет схемой, namespace/class/field paths, default/parent/merge semantics и validation.
- Galaxy владеет спецификацией скриптов; Layout, Strings, Style, Wizard — своими правилами.
- Ссылки на другие типы обращаются к владельцу по типизированной идентичности в одном контексте.
- Идентичность учитывает namespace/type, id, selected mod/dependency scope и revision;
  bare id и глобальный workspace недостаточны.
- XML scanner допустим для позиции курсора и source mapping, но не как второй effective resolver.
- Core/UI не содержат SC2 class switches и дублирующих списков полей/расширений/языков.
- Общие field editors, help, validation, cards, trees, tables, graph и media viewers
  получают нейтральные данные. Native completion/hover использует те же данные,
  но сохраняет естественный интерфейс редактора, без обязательного webview.
- Один результат знания/кандидатов/валидации используется человеком и ИИ.
  Кэши производны, revision-aware и не становятся вторыми источниками истины.

## 4. Последовательность работ

### R0 — Зафиксировать полную матрицу поведения до исправлений

Связь: UI-01, LANG-01, SCOPE; исходный backlog A/B/C/E.

1. Инвентаризировать оба пути MK2: native extension и language adapter; команды,
   меню, views, настройки, hotkeys, snippets, previews, exports и связанные редакторы.
2. Каждому сценарию присвоить статус: отсутствует / engine есть / подключён / проверен
   в полном установленном приложении. Отдельно отметить старый дефект и новое требование MK3.
3. Сохранить независимые fixtures: пустые typed catalogs, mixed untyped catalog,
   nested structures, arrays, enum/flags, assets, inherited defaults и cross-format links.
4. Сопоставить все 11 снимков с конкретными действиями и ожидаемыми результатами.

Готово: ни одна функция MK2 не исчезает под формулировкой «адаптировано»;
каждая имеет MK3 entry point, владельца, проверку и явный статус. Отсутствующий сценарий
нельзя отметить N/A только потому, что сейчас нет реализации.

### R1 — Подключить язык к единственной модели данных и контекста

Связь: DATA-01/02/04/05, LINK, LANG-03/05, MCP.

1. Провести completion/hover/diagnostics/definition/references через текущий catalog owner.
   Устранить семантическое дублирование `workspaceView`/`hoverCatalog` после проверки замены.
2. Передавать document identity, назначение каталога, selected mod, порядок зависимостей,
   locale, revision и unsaved overlays через существующий language context.
3. Обеспечить class defaults, namespace structure defaults, parent, constants, tokens,
   nested fields, indexed collections, removal/reset и происхождение каждого значения.
4. Link candidates, categories и assets брать из этого же scoped snapshot.
   Standalone-документ без загруженного мода сохраняет schema completion;
   недоступные внешние значения обозначаются incomplete, а не как заведомо отсутствующие.
5. Полный resolved workspace не пересылать языку. Data owner строит стандартную bounded
   `resolved-data-authoring-index@1` прямо из canonical patches/schema/parent graph до разворачивания
   всех effective definitions и relations. В индексе нужны identity, parent, winning definition
   source, parent-delta `set`, `unset` tombstones, dictionary-encoded source table и bounded
   diagnostics summary. `set` содержит уже schema-merged значение затронутого поля, поэтому
   потребитель не реализует второй resolver. При превышении 48 MiB сохраняется полный identity/source
   index с `valuesComplete: false`; completion/navigation остаются доступны, hover сообщает partial.
   Кэш ограничивается суммарным числом байт, а не только количеством revisions.

Готово: один и тот же field path даёт согласованные raw/effective/origin в hover,
карточке и MCP. Проверены цепочка модов A→B→C, одинаковые id в Unit/Actor и разных модах,
несохранённая правка поверх dependency, смена мода, locale и инвалидирование кэша.
Scale gate: полный melee chain не материализует полный effective snapshot для каждого language
request; cold/warm latency, peak RSS и размер authoring index имеют зафиксированные бюджеты.

### R2 — Восстановить полное Data authoring

Связь: DATA-07, KNOW, LANG-02/03; исходный backlog A/B/E.

1. **Корень.** Определять typed namespace по Data-owned правилам каталога/пакета/пути,
   а не первой сущности. В typed catalog — допустимые классы, const и допустимые
   declarations defaults структур этого data space. В untyped — любые catalog classes
   и const, без root structures. Учесть пустой, переименованный, частично написанный
   документ и конфликт идентификации; host не угадывает SC2 namespace самостоятельно.
2. **Вложенные элементы.** `<` и ручной вызов показывают допустимые поля на каждой
   глубине, включая inherited fields, structs, arrays/records и редактирование defaults.
3. **Атрибуты.** Пробел внутри тега предлагает только допустимые здесь XML attributes,
   включая schema attributes, index/key/value/class и template tokens, где применимо.
   Уже заданные singleton attributes не дублируются; partial names заменяются точно.
4. **Вставка.** Вернуть полноценные snippets, ranges и tab stops. Для indexed scalar
   применять форму наподобие `<Field index="" value=""/>`; для indexed struct — форму
   по реальной схеме. В текущей схеме AddedOnArray имеет структурированные поля:
   исторический scalar snippet нельзя механически навязать всем массивам.
5. **Значения.** `=` в подходящем контексте вставляет кавычки и открывает кандидаты;
   кавычки/`,`/`;` и другие символы работают по грамматике конкретного типа.
   После разделителя заменяется текущий сегмент, остальные значения сохраняются.
   Учесть существующие кавычки, escapes, одиночные/двойные quotes, курсор в середине,
   списки групп/flags и допустимость повторов. Простого объявления triggerCharacters
   недостаточно для автоматического изменения текста после `=`.
6. **Кандидаты.** Enum/flags, bool/numbers/ranges, parents, catalog links, string/style
   keys, categories, tokens, constants, asset paths и другие schema target kinds.
   Assets — реальные ресурсы текущего мода с зависимостями, фильтрацией и lazy details.
7. **Информация.** Тип, смысл, ограничения, примеры, defaults, effective value,
   происхождение и wiki/reference link для класса/поля/значения, где источник существует.
   Неизвестное описание честно отмечается; структурная сводка не выдаётся за исследованную семантику.
8. **Проверка.** Diagnostics, related locations, code actions, navigation, references,
   rename, formatting и прочие применимые MK2 действия включить в feature matrix.

Готово: все catalog families перечислены из авторитетной схемы, а не захардкожены
Unit/Actor. Для каждой семьи пройдены root/nested/attributes/values и ограничения.
Для всех форм полей проверены итоговый текст, позиция курсора и повторное чтение,
не только список названий. Старые баги оформлены отдельными intentional differences.

### R3 — Довести доставку языка в реальные приложения

Связь: LANG-02–07, UI-04/05; выполняется вместе с R2 для первого сквозного сценария.

1. Проверить SDK → worker/RPC → Host → VS Code/LSP/Monaco/MCP: сохранность metadata,
   ranges, snippets, docs, cancellation, limits/incomplete и ошибок.
2. Исправить owner/content routing неоднозначных `.xml`/`.txt`; проверить file,
   virtual/archive/CASC и untitled documents. Selector должен покрывать реально
   открываемый URI и language id, а не только локальный файл с нужным расширением.
3. Оформить поставку language ids, grammar, language configuration и snippets через
   contributions расширений. Выбрать совместимую с VS Code схему generated packaging
   или companion language extension; динамическую регистрацию language id не предполагать.
4. Проверить on-type поведение, lazy completion details и применимые code lenses,
   links, hints/folding через существующие контракты; расширять их только при необходимости.
5. Проверить editor settings, конфликт старого MK2/XML extensions, activation logs и
   точный hash загруженного пакета. Конфликт учитывать как возможную причину, не объявлять
   им причину наблюдаемого отказа без воспроизведения.

Готово: обычная полная активация установленного приложения, фактический ввод клавиш
и принятие подсказки работают; отдельно пройдены installed standalone LSP и MCP.

### R4 — Восстановить Sources и Resources

Связь: UI-02, SCOPE/LINK; исходный backlog C5/C6/C7.

1. **Sources:** native sidebar поверх имеющихся content-source/VFS contracts.
   CASC, game folder, SC2 cache, save games, Wizard documents и сторонние providers;
   add/connect/remove/refresh, discovery, состояния доступности и ошибки.
   Пути обнаруживает соответствующий provider; core не знает расположение SC2.
2. **Resources:** дерево выбранного загруженного мода: GameData/catalogs/classes,
   Strings/locales, Galaxy, aliases, EditorCategories, FontStyles, Preload, files,
   dependencies и остальные contributed resource kinds. Counts/search/lazy loading.
3. Переходы resource → code/table/card/graph/preview, reveal исходника, scope и
   provenance; видимый selected mod и порядок зависимостей, сохранение состояния.
4. Два одновременно открытых мода не смешивают ресурсы. Read-only dependency
   доступна для чтения/preview, правка создаёт явный override в выбранном writable target.

Готово: сценарий первого снимка доступен без знания внутренних команд; сторонний
provider появляется через contribution, без новой ветки SC2 в VS Code extension.

### R5 — Карточки, редактирование, previews и relation graph

Связь: DATA-03–06/08/09, UI-02/03/05/06, LINK.

1. Свести MK2 card projections и уже имеющиеся MK3 subject facts в общий card viewer.
   Обязательны изображения, localized/rich descriptions, costs, command card,
   produced-by, weapons, stats, declarations и все class-specific sections MK2;
   generic fallback для остальных классов. Пройти полный реестр R0, не только Marine.
2. Подключить общие field editors: типизированные controls, dropdown candidates,
   docs, validation, raw/effective/local, reset/override и diff.
   Изменение пишет минимальную правку в выбранный мод, синхронизируется с открытым
   buffer и общей историей Save/undo/redo; XML и карточка не имеют разных writers.
3. Model/audio/image previews получают ресурсы через VFS и существующие viewers.
   Ошибка картинки отображается как ошибка с возможностью повтора, не пустая секция.
   Unit→Actor→Model/Sound связи вычисляет владелец данных, не UI.
4. Graph: types/search/filter, depth/direction/limits, labels, related view/reset,
   uses/used-by, переходы и точный source field path. Общий reference index;
   capped/incomplete результат видим. Никакого второго graph resolver в webview.
5. Calculations показывают inputs/units/provenance и допущения. Нельзя выдавать
   статическую оценку DPS за точное runtime-значение, если она зависит от состояния игры.
6. Включить legacy query/clone/rewire/export/wiki действия из основного backlog;
   заменить устаревший UI допустимо только при сохранённом результате сценария.

Готово: снимки 2–7 воспроизводятся функционально общими компонентами; изменения
видны в code/UI/MCP, проходят reopen и undo, не изменяют dependency незаметно.

### R6 — Тот же уровень authoring для остальных языков и общий Verify

Связь: GALAXY, LAYOUT, STRINGS, STYLE, REL, LANG; исходный backlog E.

| Владелец                     | Обязательная проверка                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Galaxy                       | Keywords/native API, includes/scopes, locals/functions, signatures/arguments, docs, snippets, diagnostics, navigation/refactor и typed gamelinks  |
| Layout/templates             | Frame types, вложенные fields/attributes, inheritance/templates, constants/aliases, events, ссылки на Strings/Style/Data/assets, preview          |
| Strings                      | Locales/fallback, keys, markup/tags/parameters, вложенные data references, style/image links, delimiters, preview и безопасное сохранение         |
| Style                        | Style names, inheritance, constants/flags, fonts/colors, property values, links, validation/preview; те же правила при использовании в Strings    |
| Wizards                      | Схема входов, условия/templates/macros, typed cross-format references, completion/help, expansion preview, validation и транзакционное применение |
| Triggers и прочие SC2 codecs | Полный applicability inventory, embedded Galaxy/source mapping, metadata/dependencies и соответствующие capabilities каждого формата              |

1. Сравнить каждый язык с MK2 по тому же набору действий: ручной/автоматический
   completion, вставка, hover/docs/wiki, diagnostics, references, editing и preview.
   XML-символы не навязывать Galaxy/Strings: triggers определяет их владелец.
2. **Verify:** одна общая команда и editor title button для codec, объявляющего
   validation capability. Вызов проверяет текущий несохранённый snapshot и нужные
   зависимости, показывает progress/cancel и Problems с точными ranges/related locations.
3. Unsupported, partial (нет dependency/ресурса) и verified — разные результаты.
   Verify не сохраняет и не изменяет файл автоматически; исправления — отдельные actions.
   Отдельные Verify implementations для каждого editor не создавать.

Готово: снимки 8–11 и эквивалентные сценарии всех применимых codecs проходят через
общий Host. Список поддерживаемых действий совпадает с фактически объявленными capabilities.

### R7 — Полные знания и навыки ИИ поверх тех же владельцев

Связь: KNOW-01–08, AI-01–08, MCP; продолжение SOL-05, не закрытая работа.

1. Получить census всех types/classes/nested fields/attributes/enum values/targets
   из схем владельцев; рекурсивные структуры описывать без бесконечного разворачивания.
2. Для каждого узла — смысл, тип, обязательность, defaults/merge, ограничения,
   ссылки, examples, provenance, version, документация и статус уверенности/полноты.
3. Одни knowledge targets использовать в completion/hover/wiki/card/form/MCP.
   Действующие ссылки и описания MK2 сохранить, недостающее исследовать отдельно.
4. Довести навыки inspect/edit/validate/clone/rewire/localize/package для всех
   выбранных типов через публичные MK3 capabilities, с ограниченным объёмом запросов,
   preview, revision guards и проверкой результата. Не зашивать копии схем в skill.
5. Измерять отдельно structural coverage и researched semantic coverage.
   Текущий Data отчёт: 5 066 targets, 352 researched, 4 714 schema-only; nested census
   и полные knowledge packs других языков ещё не закрыты. Это не «100% описаний».

Готово: все пропуски видны по полному знаменателю; unknown не маскируется автотекстом.
AI evaluation подтверждает правильный scope, семантику, отсутствие скрытых записей
и экономию обращений без потери полноты ответа.

### R8 — Приёмка всей поставки и обновление статусов

Связь: все E2E основного backlog, особенно 17–24; UI/LANG/MCP.

1. **Домен:** differential tests MK2→MK3 для сохранённых правил плюс самостоятельные
   expected results для исправлений старых дефектов и новых требований.
2. **Контракт:** полный completion/hover/diagnostic payload через transport;
   compare включает snippets/ranges/docs/values, не только label.
3. **Приложение:** установленный VSIX с полной активацией; настоящий ввод `<`, space,
   `=`, quotes, `,`, `;`, выбор item, Tab, окончательный текст, отмена и повторное открытие.
   Проверка provider API полезна дополнительно, но не заменяет этот уровень.
4. **Контексты:** loose/empty/untitled, VFS/archive/CASC, read-only dependency,
   несколько модов, unsaved edits, одинаковые id, missing/cyclic dependencies,
   смена locale, Unicode/UTF-16/CRLF, stale results и cancellation.
5. **Связи:** Data→Strings→Style, Data→Galaxy, Layout→Strings/Style, Wizard→Data/assets,
   rename/move ресурса, изменение схемы и синхронное обновление code/UI/MCP.
6. **UI:** весь реестр R0 и снимки; loading/error/empty/incomplete, keyboard,
   dark/light/high-contrast, большие деревья/graphs и производительность на измеренном corpus.
7. Receipt содержит package/build hashes, activation mode, источник/мод, версии,
   фактические сценарии и результаты. Повторный ручной тест выполняется в явно
   идентифицированном окне MK3, чтобы исключить подмену результатов старым расширением.

Правила закрытия: не удалять failing fixtures и не заменять пустые каталоги
заполненными ради зелёного теста; generated schema coverage дополняется независимыми
fixtures. «100%» означает все согласованные строки feature/workflow matrix с
доказательством по применимым клиентам, а не число methods/exports или один smoke-test.
Если тест среды недоступен — статус unverified, а не pass.

## 5. Порядок исполнения и сложность

Критический путь: **R0 → R1 → R2+R3 → R4 → R5/R6 → R7+R8**.
Знания и проверки добавляются с каждой задачей, а не откладываются целиком в конец.

Первый обязательный сквозной результат: пустые UnitData и ActorData, смешанный
untyped каталог и вложенная indexed structure; правильные candidates/snippets/docs,
значения из выбранного мода, фактический ввод в полной установленной VS Code-сборке.
После него — все namespaces и формы полей, затем остальной интерфейс и языки.
Этот первый результат не закрывает этап целиком и не сокращает утверждённый scope.

Задача сложная по интеграции: затронуты семантический контекст, редакторские контракты,
поставка языков, продуктовый UI и приёмка. Она не требует переписывать все engines.
Быстрый ремонт одного trigger не устраняет перечисленные причины. Самые рискованные
части — effective semantics с overlays/dependencies, точная вставка в неполный XML,
согласованные edits/history и проверка настоящего установленного приложения.

До завершения R0/R1 нельзя честно оценить остаток в процентах или дать надёжный срок всего parity.
Размер уже перенесённого кода не является процентом готового продукта. Разработка
идёт по вертикальным сценариям; текущий статус фиксируется выше и подтверждается тестами/receipt.
