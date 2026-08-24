# Блок 9 — исполняемый план: companion-facility, честный паритет и углубление 3D

- **Дата:** 2026-08-24
- **Ветка:** `spec/mk3-extension-reference`
- **Базовый коммит:** `e3ba176`
- **Главный документ:** `PLAN_SOL_BLOCK9_2026-08-24.md`
- **Статус этого документа:** детализация исполнения; не заменяет и не переупорядочивает главный план Opus.

## 1. Цель этапа

Блок 9 должен превратить уже доказанное чтение W3X, W3D и VXL из набора отдельных декодеров в воспроизводимую host-цепочку работы с реальными составными ассетами. Главный результат — не ещё несколько распарсенных полей, а единая инфраструктура, через которую codec декларативно запрашивает companion-файлы, а host безопасно разрешает их как на диске, так и внутри архивного namespace.

После этого долг паритета блока 8 закрывается на реальных файлах и на всём сравнимом `common/`. Только когда сравнение перестанет опираться почти исключительно на минимальные синтетические фикстуры, разрешено углублять модельные codec contributions.

Итоговая последовательность неизменна:

1. host-owned companion resolution, включая namespace BIG;
2. расширение паритета на реальные корпуса и сравнимое `common/`;
3. углубление VXL, W3D и W3X по UVM-матрице;
4. отрицательные случаи и полные корпуса;
5. матрица различий X3 ↔ канон с явным действием по каждой строке;
6. устранение хвостов CJS/Electron и подготовка ручного VS Code smoke;
7. полный последовательный gate и итоговый отчёт.

Экспорт UVM не входит в безусловную очередь: он остаётся остановлен до решения владельца о границе ответственности между X3 и каноном.

## 2. Зафиксированные архитектурные выводы

### 2.1. Новый публичный companion ABI не требуется

SDK уже содержит нужную декларативную модель в `packages/sdk/src/runtime-abi.ts`:

- `AssetInputRequirement` задаёт `id`, `role`, `ownership`, `patterns`, `expected`, `scopes`, cardinality и requiredness;
- `PhysicalAssetInputPlan` различает `single`, `bundle` и `namespace`;
- `AssetInput.bindingsFor(requirementId)` и `openBinding(bindingId)` предоставляют codec только уже разрешённые host bindings;
- комментарий контракта прямо запрещает codec самостоятельно разрешать или конструировать URI companion-файлов.

В `packages/host/src/subject-open.ts` уже существует `SubjectInputResolver`, однако default-реализация принимает только одиночный источник или namespace без requirements и для составного плана завершает открытие ошибкой `x3.host/input-resolver-required`.

Следовательно, задача блока 9 — реализовать и подключить concrete host resolver. Менять публичный SDK-контракт можно только если тестом доказано, что существующих полей недостаточно. Такое изменение считается отдельной архитектурной развилкой и требует остановки перед реализацией.

### 2.2. Codec объявляет потребность, host владеет поиском

Codec вправе:

- объявить роль companion;
- задать ограниченные patterns;
- задать ожидаемые traits;
- выбрать разрешённые scopes;
- указать cardinality и requiredness;
- использовать полученные bindings.

Codec не вправе:

- читать файловую систему;
- обходить BIG или иной контейнер;
- угадывать абсолютный путь;
- подменять отсутствие companion синтетическими данными;
- расширять область поиска за пределы scopes;
- удерживать источник после окончания выданного lease.

Host вправе и обязан:

- связать исходный subject с доверенным origin;
- ограниченно перечислить кандидатов;
- нормализовать и валидировать имена;
- проверить cardinality, expected traits, бюджеты и отмену;
- создать стабильные bindings;
- закрыть все временные leases при ошибке, отмене и завершении сессии.

### 2.3. Отсутствие обязательного и необязательного companion — разные исходы

- Нет requirement с `required: true`: входной bundle не сформирован, открытие соответствующего представления завершается стабильной диагностикой с requirement id, role и проверенными scopes.
- Нет requirement с `required: false`: основной subject может открыться; binding отсутствует, а зависимая возможность помечается как недоступная или degraded с именованной причиной.
- Ни в одном случае codec не имеет права объявить палитру, анимацию, material, collision или texture найденными по имени либо сгенерировать правдоподобную замену.

### 2.4. Архивный namespace — обязательная часть первого результата

Дисковый sibling resolver сам по себе не закрывает этап. Реальные C&C-ассеты находятся внутри BIG, поэтому `current-mount` и/или `enclosing-container` должны работать в том же архивном namespace, где находится основной entry.

Текущий EA BIG codec уже отдаёт `common.view/namespace-entry-source` и умеет `openEntry(entryId)`, включая stored и RefPack entries. Но этот источник появляется как data source после открытия BIG и сам по себе ещё не является доказанным origin-контекстом для `SubjectInputResolver`. Поэтому реализация начинается с небольшого design spike: нужно проследить путь от открытия BIG entry как subject до `planInput` вложенного codec и сохранить parent namespace без передачи codec права формировать URI.

## 3. Неподвижные ограничения

- Канон `C:\FILES\SC2Files\coding\modkitx` используется только для чтения и сравнения.
- Работа ведётся только в X3-репозитории.
- Не трогать пользовательские изменения в `README.md`, `scripts/bundle-hashes.json`, `PLAN_SOL_BLOCK6_2026-08-23.md` и `REPORT_SOL_BLOCKS_1_5_SUMMARY_2026-08-22.md`.
- Не использовать `git add -A`; в каждый коммит добавляются только явно перечисленные файлы.
- Каждый новый коммит заканчивается trailer `Co-Authored-By: Claude Sol <noreply@anthropic.com>`.
- Не переписывать историю и не делать push. Если переписывание истории когда-либо станет необходимым, сначала остановиться, объяснить причину и получить отдельное решение владельца.
- Генераторы bundle/ratchet запускаются последовательно. Если проверка меняет пользовательский `scripts/bundle-hashes.json` или `dist-app`, пользовательское состояние восстанавливается без потери данных до коммита.
- Числа из внешних корпусов публикуются только вместе с именем переменной окружения и относительным путём использованного файла.
- Никакой вывод о semantic plane не делается только из имени файла.

## 4. Результаты блока

К завершению должны существовать следующие проверяемые результаты:

1. Host resolver для составного `AssetInputPlan`.
2. Доказанный folder case: основной файл и companion в sibling directory.
3. Доказанный archive case: модель и companion находятся внутри одного BIG namespace.
4. Product wiring как минимум для Node/test path и используемого Electron пути открытия subject.
5. Реальный parity corpus с отдельными строками W3X, W3D, VXL, BIG→W3D и доступным Emperor XBF.
6. Паритет по всем сравнимым contributions, перенесённым в `common/`, с явной причиной каждой неприменимой строки.
7. Углублённые модели VXL, W3D и W3X без фиктивной семантики.
8. Negative corpus для missing/corrupt/ambiguous/traversal/budget/cancel/protected-tail случаев.
9. Матрица различий X3 ↔ канон с колонкой «что делать».
10. CJS smoke без безусловного `import.meta`, автоматизированный Electron smoke и ручной VS Code checklist.
11. Промежуточный отчёт после паритета и финальный отчёт с воспроизводимыми командами и входами.

## 5. Пошаговое исполнение

## Шаг 0. Baseline и исправление долга отчётности блока 8

### 0.1. Зафиксировать исходное состояние

До изменения кода записать:

- branch и HEAD;
- `git status --short`;
- SHA пользовательского `scripts/bundle-hashes.json`;
- SHA канона;
- версии Node и pnpm;
- наличие каждой переменной живого корпуса;
- baseline-команды и их exit code.

Минимальный baseline:

```text
pnpm test
pnpm ports:check
pnpm check:extensions
pnpm check:mk2
pnpm bundle:check
pnpm parity
```

Дополнительно запускаются узкие suites для `subject-open`, Node subject services, EA BIG, W3D, W3X, VXL и parity. Точные имена команд берутся из текущих package scripts, а не придумываются в отчёте задним числом.

### 0.2. Зафиксировать честный baseline паритета

В baseline-артефакте явно написать:

- всего текущих parity rows;
- сколько из них синтетические;
- сколько используют реальные файлы;
- какие contributions из `common/` вообще представлены;
- что выражение блока 8 «0 poorer» относилось только к этому узкому корпусу.

Нельзя переносить прежний итог как доказательство общего превосходства X3.

### 0.3. Закрыть воспроизводимость живых чисел

Для каждого опубликованного счётчика указать:

- имя переменной окружения;
- относительный путь от её корня либо относительный суффикс выбранного файла;
- contribution id;
- команда теста;
- итоговые counts и skip reason, если переменная отсутствует.

Обязательные переменные: `MODKITX_W3X_PATH`, `MODKITX_W3D_PATH`, `MODKITX_VXL_PATH`, `MODKITX_EMPEROR_ROOT`, `MODKITX_CNC3_ROOT`. Абсолютные локальные пути в tracked-отчёт не записываются.

### 0.4. Отдельно задокументировать переписывание истории

В отчёте явно указать, что в блоке 8 менялись идентичности коммитов ради trailers, при этом содержимое проверялось byte-for-byte. Это не повторяется в блоке 9.

### 0.5. Temp-клон

Полный временный clone с `.git`, оставшийся вне репозитория, отмечается как ручной cleanup владельца. Агент не делает потенциально разрушительное удаление без точного пути и отдельного разрешения. Наличие клона не блокирует код блока 9, но пункт остаётся видимым в финальном отчёте до подтверждения удаления.

**Контрольная точка S0:** baseline воспроизводим, пользовательские файлы не изменены, ширина прежнего паритета описана без завышенного вердикта.

## Шаг 1. Host-owned companion resolution

### 1.1. Карта существующего контракта

Перед кодом составить короткую карту потока:

```text
codec.planInput
  → PhysicalAssetInputPlan.requirements
  → SubjectInputResolver(context)
  → AssetInput.bindingsFor/openBinding
  → codec.open
```

Проверить и покрыть тестами следующие уже существующие инварианты:

- candidate binding один и тот же для probe, `planInput` и `open`;
- requirement id стабилен и уникален в пределах плана;
- `one`/`one-or-more` всегда required;
- `zero-or-one`/`many` всегда optional;
- `single` не содержит requirements;
- codec не получает origin path и не формирует URI.

### 1.2. Design spike origin-контекста

Нужно доказать два маршрута:

1. `filesystem`: путь основного файла → доверенный sibling directory;
2. `namespace`: entry основного файла → тот же current mount/enclosing container.

Предпочтительная форма — host-private origin descriptor, создаваемый product opener и замыкаемый в resolver:

```text
filesystem origin:
  primary name + confined root + bounded enumerate/open

namespace origin:
  primary entry id + retained namespace lease + revision/fingerprint + bounded enumerate/open
```

Descriptor не входит в codec context. Если его удаётся передать через factory/closure `SubjectInputResolver`, публичный SDK не меняется. Возможные точки подключения:

- `packages/host/src/subject-open.ts`;
- новый изолированный модуль host, например `packages/host/src/input-resolution.ts`;
- `packages/host/src/subject-services.ts`;
- `packages/host/src/node/subject-services.ts`;
- `packages/host/src/node/subject-opener.ts`;
- используемая Electron-композиция;
- путь открытия вложенного BIG entry.

Имена новых файлов и exports окончательно выбираются после trace call chain. Запрещено добавлять параллельный ABI, дублирующий `AssetInputRequirement`.

### 1.3. Семантика scopes

Resolver должен обрабатывать только явно запрошенные scopes:

| Scope                        | Поведение блока 9                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `sibling-directory`          | искать рядом с основным filesystem subject в пределах confined root                                       |
| `current-mount`              | искать в том же namespace/mount, где расположен основной entry                                            |
| `enclosing-container`        | искать в удерживаемом parent container namespace                                                          |
| `workspace-dependency-layer` | разрешать только через явный product-owned provider; без provider вернуть именованный unavailable outcome |
| `explicit-user-selection`    | не открывать picker из codec/host core; принимать только заранее переданные product bindings              |

Resolver не расширяет поиск с одного scope на другой «для удобства». Проверенные scopes включаются в диагностический контекст.

### 1.4. Нормализация и confinement

Для каждого кандидата:

- привести разделители к `/` для логического namespace;
- отклонить NUL, абсолютные пути, drive prefix, UNC и выход через `..`;
- не переходить по filesystem symlink за confined root;
- не интерпретировать archive entry как локальный путь;
- применять документированную case policy конкретного backend;
- выдавать стабильный порядок кандидатов независимо от порядка directory enumeration;
- не позволять pattern вызвать неограниченный рекурсивный обход.

Patterns компилируются/проверяются один раз на requirement. Слишком широкие или невалидные patterns завершаются стабильной диагностикой, а не скрытым полным сканированием.

### 1.5. Cardinality и детерминизм

Алгоритм requirement:

1. проверить signal/deadline;
2. перечислить только разрешённые scopes;
3. применить patterns;
4. стабильно отсортировать уникальные logical ids;
5. при наличии `expected` выполнить bounded trait validation через host-owned detection;
6. проверить cardinality;
7. создать неизменяемые binding ids;
8. вернуть `AssetInput`, который открывает только выбранные bindings.

Ожидаемые исходы:

- `one`: ровно один кандидат, иначе missing/ambiguous error;
- `one-or-more`: минимум один, все результаты в стабильном порядке;
- `zero-or-one`: ноль допустим, больше одного — ambiguous error, а не случайный выбор;
- `many`: ноль и более, стабильный порядок.

Для ошибок закрепить стабильные diagnostic codes в существующей taxonomy. Требуются отдельные коды как минимум для missing required, ambiguous cardinality, invalid path/pattern, unsupported scope, budget exceeded и cancellation. Финальные идентификаторы проверяются по действующей host taxonomy до добавления.

### 1.6. Бюджеты, отмена и lifetime

Resolver наследует deadline/signal операции и вводит явные пределы:

- число перечисленных entries;
- число trait probes;
- суммарные probe bytes;
- число созданных bindings;
- глубина container traversal — в блоке 9 без рекурсивного вскрытия произвольных вложенных контейнеров.

Все временные sources и leases закрываются:

- после отклонения кандидата;
- при cardinality error;
- при abort/deadline;
- если `codec.open` падает;
- при dispose subject/session.

Тесты должны считать открытия/закрытия и доказывать отсутствие double-close и утечки parent namespace lease.

### 1.7. Folder implementation

Сначала реализовать минимальный filesystem provider:

- origin известен из `createPathSubjectOpener`;
- sibling root ограничен каталогом основного subject и разрешёнными product roots;
- resolver передаётся через `createSubjectServices`, Node composition и вызов `openSubject`;
- direct in-memory source без origin продолжает требовать явный resolver, если план составной.

Первый интеграционный fixture:

```text
fixture/
  sample.vxl
  sample.hva
```

Fake или реальный VXL contribution объявляет HVA как companion. Тест доказывает, что codec получает candidate и HVA только через `bindingsFor/openBinding`, а удаление HVA даёт точно ожидаемый required/optional outcome.

### 1.8. BIG namespace implementation

После folder case, но в том же шаге, реализовать archive path:

1. Проследить, как UI/host открывает `common.view/namespace-entry-source` и затем передаёт entry в `openSubject`.
2. Сохранить parent namespace lease и logical entry id в host-private origin.
3. Создать resolver closure для вложенного subject.
4. Для `current-mount`/`enclosing-container` перечислять и открывать соседние entries через namespace API, а не через filesystem.
5. Передавать revision/fingerprint parent container в provenance bindings.
6. Освобождать parent lease только после закрытия всех дочерних bindings/subject.

Интеграционный BIG fixture должен содержать:

- основной W3D entry;
- companion texture/material entry, имя которого соответствует реальному declarative pattern;
- хотя бы один RefPack-compressed entry, чтобы доказать byte-exact путь через BIG decompression;
- лишний похожий entry для проверки фильтра и/или ambiguity.

Проверка открывает сначала BIG, затем W3D entry через product-owned маршрут, после чего W3D `planInput` получает companion из того же archive namespace. Временная распаковка на диск не считается выполнением требования.

### 1.9. Набор тестов шага 1

Unit:

- plan без requirements сохраняет старое поведение;
- required found/missing;
- optional found/missing;
- `zero-or-one` ambiguity;
- `one-or-more` stable ordering;
- несколько requirements с независимыми roles;
- expected trait accept/reject;
- unsupported scope;
- traversal/absolute/NUL path;
- case policy;
- budget/deadline/abort;
- lease cleanup при каждом failure point.

Integration:

- Node path opener + sibling companion;
- subject services propagation;
- BIG entry + companion внутри того же BIG;
- stored и RefPack bytes;
- отсутствие незаявленного filesystem fallback для archive origin;
- Electron composition использует тот же host resolver, а не собственный алгоритм поиска.

**Контрольная точка S1:** folder VXL+HVA и archive W3D+texture проходят end-to-end; codec не знает путей; обязательные/необязательные companion различаются; lifetime и confinement доказаны тестами.

## Шаг 2. Закрытие долга паритета до углубления codec

### 2.1. Разделить synthetic и real rows

Текущие минимальные fixtures сохраняются как быстрые contract tests, но не считаются живым паритетом. Каждая реальная строка получает отдельный стабильный id и provenance:

- corpus kind: `synthetic` или `real`;
- переменная окружения;
- относительный путь;
- file size/hash при допустимости публикации;
- X3 contribution;
- canonical probe/adapter;
- сравниваемые capabilities;
- verdict и причина.

### 2.2. Обязательный живой корпус

При наличии переменных включить:

- W3X через `MODKITX_W3X_PATH`;
- W3D через `MODKITX_W3D_PATH`;
- VXL через `MODKITX_VXL_PATH`;
- Emperor XBF через `MODKITX_EMPEROR_ROOT`;
- цепочку BIG → W3D через `MODKITX_CNC3_ROOT`.

Если переменная отсутствует, строка остаётся видимой и даёт объяснимый skip. Если переменная задана, но файл не существует или не соответствует ожидаемому формату, тест падает: такой случай нельзя маскировать skip.

### 2.3. Всё сравнимое `common/`

Составить inventory всех contributions, перенесённых в `common/`, и для каждой строки выбрать один статус:

- `compared-real`;
- `compared-synthetic`;
- `not-comparable-no-canonical-probe`;
- `not-comparable-contract-difference`;
- `blocked-missing-legal-corpus`.

`png` и `zip` не могут представлять все 48 перенесённых codecs. Для каждого contribution либо появляется parity row, либо именованная причина отсутствия. Причина не превращается в pass.

### 2.4. Формула verdict

Сравниваются не только «файл открылся», но и одинаково определённые planes:

- subject recognition;
- structural metadata;
- geometry counts;
- hierarchy;
- materials/textures;
- animation;
- collision;
- palette/voxel transforms;
- protected/unknown tail preservation;
- diagnostics на malformed input.

Допустимые verdicts:

- `richer` — X3 доказывает строго больше на той же реальной входной сущности;
- `equal` — сравниваемые planes эквивалентны;
- `poorer` — канон доказывает plane, которого X3 не даёт;
- `incomparable` — нет общей измеримой плоскости; причина обязательна.

Список `poorer` публикуется полностью, даже если он ненулевой. Gate падает только на необъяснённом регрессе относительно утверждённого baseline; сам факт честного poorer не переписывается как success.

### 2.5. Промежуточный обязательный отчёт

Создать `REPORT_SOL_BLOCK9_PARITY_BASELINE_2026-08-24.md` со следующими таблицами:

1. before/after: число total, synthetic, real, common-covered, skipped, richer/equal/poorer/incomparable;
2. реальный корпус с env + relative path;
3. полный inventory `common/`;
4. полный poorer list;
5. ограничения канонического probe;
6. команды воспроизведения.

До публикации этого отчёта и отдельного зелёного parity-коммита нельзя переходить к шагу 3.

**Контрольная точка S2:** паритет больше не опирается на треугольник как доказательство качества реальных моделей; каждый сравнимый common contribution учтён; poorer list честный и воспроизводимый.

## Шаг 3. Углубление модельных contributions по UVM-матрице

Порядок внутри шага: VXL → W3D → W3X. VXL идёт первым, потому что сразу проверяет HVA/PAL companion-facility. Каждый новый semantic plane добавляется отдельным небольшим коммитом с synthetic test, real-corpus assertion и обновлением parity row.

### 3.1. VXL

Цели:

- сохранить уже доказанную voxel geometry;
- разобрать HVA section transforms и связать их с VXL sections только по явным identifiers;
- подключить PAL/VPL только при наличии реального binding и доказанного контракта;
- различать отсутствующую optional palette и corrupted palette;
- публиковать provenance для значений, полученных из companion;
- не объявлять render mesh collision mesh;
- не синтезировать HVA identity как «прочитанную анимацию».

Тесты:

- VXL без HVA;
- VXL + корректный HVA;
- HVA с отсутствующей/лишней section;
- truncated matrix track;
- PAL/VPL correct/missing/corrupt;
- filesystem и namespace variants;
- stable frames/sections counts на реальном corpus.

### 3.2. W3D

Цели:

- расширить hierarchy/pivots и mesh-to-hierarchy binding;
- разобрать animation tracks только для реально поддержанных chunk types;
- извлечь material/texture references без угадывания расположения;
- разрешать texture/material companion через host bindings, включая BIG namespace;
- сохранить unknown/protected chunks byte-stably там, где контракт требует preservation;
- отдельно маркировать render, collision и proxy planes, не выводя одно из другого.

Тесты:

- hierarchy with multiple pivots;
- mesh referencing hierarchy;
- supported animation track;
- unsupported/unknown animation chunk остаётся диагностированным и сохранённым;
- missing optional texture;
- ambiguous texture;
- W3D + texture inside BIG;
- malformed chunk sizes и bounded decompression;
- реальная модель с воспроизводимыми counts.

### 3.3. W3X

Цели:

- расширить hierarchy/model-part relations;
- разобрать только явно доказанные animation/material references;
- обрабатывать includes/references через declarative requirements, если это физические companion inputs;
- не следовать произвольным внешним путям из документа;
- сохранять источник каждого значения: direct, companion, canonical/inferred;
- запретить semantic inference только из filename/token name.

Тесты:

- nested hierarchy;
- multiple model parts;
- supported animation block;
- missing/ambiguous include;
- traversal-like include path;
- unknown tags/chunks;
- реальный W3X с фиксированными structural/geometry counts.

### 3.4. Правило UVM-матрицы

Для каждого plane в каждом codec записать один из статусов:

- `Да` — поле прочитано напрямую или через доказанный companion binding;
- `Условно` — поле получено ограниченным inference, помечено provenance и не выдаётся за source fact;
- `Нет` — plane отсутствует либо формат/корпус не даёт достаточного доказательства.

Нельзя повышать `Условно`/`Нет` до `Да` ради parity score. Любое изменение статуса подкрепляется fixture и реальным файлом, если legal corpus доступен.

**Контрольная точка S3:** VXL, W3D и W3X стали глубже на доказанных planes, а каждый новый результат проходит через общий companion resolver и отражён в parity/UVM matrix.

## Шаг 4. Полные корпуса и отрицательные случаи

После положительного углубления собрать общий negative matrix. Для каждого формата проверить:

- полный корректный companion set;
- отсутствующий required companion;
- отсутствующий optional companion;
- неверный magic/version companion;
- truncated header/body;
- duplicate/ambiguous candidates;
- path traversal и абсолютное имя;
- case collision;
- слишком широкий pattern;
- превышение node/byte/deadline budget;
- cancellation на enumeration, probe и open;
- защищённый/неизвестный хвост;
- teardown после исключения.

Каждый тест проверяет не только факт ошибки, но и:

- стабильный code;
- requirement/role/source context без утечки абсолютного локального пути;
- отсутствие выдуманного partial result;
- число открытых и закрытых leases;
- сохранность parent namespace.

Full-corpus tests остаются visible-skip при отсутствии легального корпуса. Skip должен называть ровно отсутствующую переменную или неподдержанный корпус.

**Контрольная точка S4:** malformed и incomplete bundles не приводят к случайному fallback, утечке ресурсов или ложной семантике.

## Шаг 5. Матрица различий X3 ↔ канон

Вместо общего promotion-аудита создать `REPORT_SOL_BLOCK9_PROMOTION_MATRIX_2026-08-24.md`.

Обязательные колонки:

| Область | X3 сейчас | Канон сейчас | Различие | Риск | Что делать | Владелец/этап | Доказательство |
| ------- | --------- | ------------ | -------- | ---- | ---------- | ------------- | -------------- |

Обязательные области:

- SDK/runtime ABI;
- host composition;
- subject lifecycle;
- companion resolution;
- VFS/archive namespace;
- diagnostics/budgets;
- UI workbench;
- Electron/VS Code apps;
- common codecs;
- EA codecs;
- tests/bench/ratchets;
- документация и migration surface.

Колонка «Что делать» использует только конкретные действия:

- `promote X3 → canon`;
- `backport canon → X3`;
- `оставить различие` с причиной;
- `сначала ADR/решение владельца`;
- `удалить после замены`;
- `нет действия` с доказанным паритетом.

Матрица фиксирует SHA обеих веток. Никаких изменений канона в рамках блока 9 не выполняется.

**Контрольная точка S5:** у каждого значимого расхождения есть решение или явно названный decision gate, а не просто описание текущего состояния.

## Шаг 6. Хвосты CJS, Electron и VS Code

### 6.1. CJS

- найти entrypoint с безусловным `import.meta`;
- выбрать условный/раздельный ESM-CJS путь без string-rewrite трюков;
- добавить smoke реального CJS consumer;
- проверить types и export map;
- не считать unit import достаточным доказательством package consumption.

### 6.2. Electron

Автоматизировать доступный smoke:

- composition создаётся;
- inventory загружается;
- subject open получает resolver;
- BIG entry может открыть вложенный model subject;
- dispose закрывает worker/leases;
- smoke не требует интерактивного окна там, где headless путь достаточен.

### 6.3. VS Code

Живой запуск не блокирует очередь агента. Подготовить ручной checklist:

1. установить/запустить extension development host;
2. открыть одиночный модельный файл;
3. открыть VXL с companion;
4. открыть BIG и вложенный W3D;
5. проверить diagnostics для missing companion;
6. закрыть editor/workspace и проверить отсутствие зависшего worker;
7. записать версию VS Code, OS и результат.

До ручного подтверждения итог формулируется как «автоматизированные проверки зелёные; живой VS Code smoke ожидает владельца», а не как полный product acceptance.

**Контрольная точка S6:** CJS и Electron имеют автоматические smokes, VS Code имеет короткий воспроизводимый ручной сценарий и не блокирует остальные gates.

## 6. Отдельный decision gate: экспорт UVM

До решения владельца не добавлять exporter dependency в W3X/W3D/VXL codecs и не создавать скрытый форматный fork.

Владелец выбирает один вариант:

### Вариант A. X3 сам экспортирует UVM

- exporter оформляется отдельным contribution;
- codecs публикуют нейтральные X3 contracts, exporter их потребляет;
- ни один codec не импортирует exporter;
- добавляется round-trip/validation через канонический UVM reader;
- versioning и ownership UVM schema документируются отдельно.

### Вариант B. X3 отдаёт UVM-совместимую геометрию, конвертирует канон

- в X3 не добавляется UVM exporter;
- фиксируется compatibility contract для geometry/hierarchy/material planes;
- promotion matrix указывает канонический conversion boundary;
- тест доказывает достаточность данных X3 для канонического конвертера без filename inference.

Решение не требуется для выполнения шагов 0–6, но требуется для включения UVM export в какой-либо последующий блок.

## 7. План коммитов

Каждый коммит должен иметь одну проверяемую причину. Предварительная разбивка:

1. `docs: зафиксировать baseline и воспроизводимость блока 8`;
2. `test(host): задать контракт companion input resolution`;
3. `feat(host): разрешать companion в confined sibling directory`;
4. `feat(host): передавать resolver через subject services и Node opener`;
5. `test(ea-big): задать вложенный namespace companion case`;
6. `feat(host): разрешать companion внутри parent BIG namespace`;
7. `test(parity): добавить реальные модельные корпуса`;
8. `test(parity): покрыть сравнимые common contributions`;
9. `docs: опубликовать промежуточный parity baseline`;
10. отдельные commits VXL: HVA, PAL/VPL, negatives;
11. отдельные commits W3D: hierarchy, animations, materials/textures, negatives;
12. отдельные commits W3X: hierarchy, animations/includes, negatives;
13. `docs: добавить матрицу различий X3 и канона`;
14. `fix(packaging): закрыть CJS smoke`;
15. `test(electron): автоматизировать subject-open smoke`;
16. `docs: добавить VS Code manual smoke checklist`;
17. `docs: завершить отчёт блока 9`.

Фактическое число коммитов может вырасти, если semantic planes логически независимы. Оно не должно уменьшаться за счёт смешивания инфраструктуры, codec depth, generated artifacts и отчёта в один большой коммит.

Перед каждым коммитом:

1. `git status --short`;
2. узкие тесты изменённой области;
3. explicit `git add`;
4. `git diff --cached --check`;
5. просмотр `git diff --cached --stat` и staged file list;
6. commit с обязательным trailer;
7. проверка, что пользовательские файлы не попали в index.

## 8. Последовательный финальный gate

Финальный gate запускается без параллельных генераторов в документированном порядке:

1. clean snapshot status и пользовательского hash;
2. install/lockfile consistency без обновления зависимостей;
3. build;
4. lint и format check;
5. tooling/type checks;
6. узкие host companion suites;
7. BIG namespace suites;
8. W3X/W3D/VXL suites;
9. parity synthetic + real;
10. полный `pnpm test`;
11. benchmarks с принятыми бюджетами;
12. `check:extensions` и `check:mk2`;
13. `ports:check` с ожидаемым `168/168`, pending `0`, если ratchet намеренно не изменился;
14. bundle/ratchet checks;
15. CJS consumer smoke;
16. Electron smoke;
17. trailer audit всех новых коммитов;
18. final status и повторный hash пользовательских файлов.

Если какой-либо script генерирует tracked output, сначала определить, является ли изменение ожидаемым результатом блока. Неожиданное изменение не коммитится и исследуется до продолжения.

Финальный отчёт обязан привести точные команды, exit codes, test/pass/skip counts, env + relative paths, parity before/after и полный список известных ограничений.

## 9. Критерии завершения блока 9

Блок считается завершённым только если одновременно истинно следующее:

- составной `AssetInputPlan` разрешается общей host facility;
- filesystem sibling и BIG namespace доказаны end-to-end;
- codec не читает filesystem/container и не конструирует URI;
- required и optional companion имеют разные, протестированные исходы;
- traversal, ambiguity, budgets, cancellation и lease cleanup покрыты;
- реальный parity corpus отделён от synthetic;
- все сравнимые common contributions учтены строкой или именованным blocker;
- промежуточный parity report опубликован до codec deepening;
- VXL/HVA/PAL, W3D hierarchy/animations/materials и W3X hierarchy/animations углублены только в доказанных пределах;
- render geometry не объявляется collision geometry без источника;
- UVM-матрица обновлена с provenance;
- матрица различий содержит действие по каждой строке;
- CJS и Electron smokes зелёные;
- VS Code checklist подготовлен и его ручной статус назван честно;
- full gate exit 0 либо каждый visible skip соответствует заранее объявленной отсутствующей переменной;
- пользовательские файлы byte-identical исходному состоянию;
- все новые commits имеют trailer;
- история не переписана, push не выполнялся;
- итоговый отчёт содержит не только сделанное, но и полный список того, что осталось.

## 10. Условия немедленной остановки

Нужно остановить реализацию и запросить решение владельца, если:

- существующий SDK ABI действительно не позволяет передать host-owned origin без раскрытия codec URI;
- для BIG требуется изменить публичную модель namespace или lifetime;
- нужен новый легальный corpus или разрешение на публикацию его path/hash;
- parity требует модификации канона;
- promotion matrix выявляет несовместимые contract versions без однозначного направления;
- требуется переписать историю, force-push или удалить внешний clone;
- начинается реализация UVM export без выбора варианта A/B;
- пользовательские изменения пересекаются с файлами блока и их нельзя безопасно обойти.

## 11. Следующий блок после завершения

Если все критерии блока 9 закрыты, блок 10 начинается с Relic и переносит девять contributions (семь основных плюс две связанные), после чего число staging families в `extensions/mk2/` должно уменьшиться с 25 до 23. Этот переход не начинается раньше финального отчёта блока 9 и не используется как способ отложить его companion/parity долг.
