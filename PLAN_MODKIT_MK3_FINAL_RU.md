# Финальная программа: готовый Modkit MK3 и интеграция Multiverse

> **Статус:** авторитетный исполняемый план
>
> **Дата фиксации:** 2026-08-24
>
> **Продукт:** `modkitX3`, далее — **Modkit MK3**
>
> **Начальная ветка:** `spec/mk3-extension-reference`
>
> **Зафиксированный старт X3:** `30196d7`
>
> **Наблюдаемый HEAD старого modkit:** `1a14ba4`; рабочее дерево не чистое и будет
> отдельно опечатано как часть эталона в блоке 10.

Этот документ заменяет `PLAN_MIGRATION_COMPLETE_RU.md` как программа верхнего уровня.
Он сохраняет принятый блок 9, исправляет ошибки прежнего плана и доводит очередь до двух
проверяемых результатов:

1. **Modkit MK3 Product GA** — самостоятельный модульный набор приложений и SDK, который заменяет
   старый `modkitx` во всех пользовательских сценариях без функциональных регрессий.
2. **Modkit MK3 + Multiverse GA** — полный UV-контур чтения, записи, проверки и запуска,
   детерминированный TypeScript runtime, независимая граница для Rust-реализации и работающий
   play-in-editor.

`PLAN_SOL_BLOCK9_FINAL_2026-08-24.md` и
`PLAN_SOL_BLOCK9_EXECUTION_2026-08-24.md` остаются обязательными подробными планами
текущего блока. При противоречии с прежними общими планами действует этот документ.

---

## 0. Что значит «готово»

### 0.1. Конечный пользовательский результат

После завершения программы владелец может:

- открыть поддерживаемую игру, архив, карту, мод, модель, изображение, звук, видео, таблицу данных
  или скрипт в подходящем приложении MK3;
- просматривать, анализировать, извлекать, изменять, валидировать и сохранять данные во всех случаях,
  где это умел старый modkit;
- получать эквивалентный или более богатый результат на одном и том же реальном корпусе;
- работать в VS Code, Electron, PWA, CLI, server и automation-host через одни доменные операции;
- видеть честную причину недоступности операции, если конкретный host не имеет нужной системной
  возможности;
- преобразовывать игровые данные в семейство UV и обратно в пределах заявленной обратимости;
- запускать детерминированную симуляцию и play-in-editor без запуска оригинальной игры;
- расширять MK3 новым codec/game/runtime/viewer contribution без изменения платформенных пакетов;
- подключать Multiverse независимо от Modkit и заменять TypeScript kernels на совместимые Rust
  kernels через один версионированный протокол.

### 0.2. «Полный перенос» — не копирование каталогов

Полный перенос означает, что **каждая наблюдаемая возможность** старого modkit получает ровно один
из следующих финальных исходов:

| Финальный исход        | Смысл                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `implemented`          | Возможность реализована в MK3 тем же или лучшим способом.                                     |
| `equivalent-better`    | Старый механизм заменён другим, но пользовательский сценарий и данные сохранены или улучшены. |
| `relocated-multiverse` | Исполнение принадлежит Multiverse, а MK3 предоставляет интеграцию через публичный adapter.    |
| `superseded`           | Старый внутренний механизм больше не нужен; указан и проверен заменяющий сценарий.            |

В финальном состоянии запрещены строки `missing`, `partial`,
`blocked`, `unknown` и `waived-without-replacement`.
Фраза «не переносим» без проверяемой замены не закрывает строку.

### 0.3. «Без регрессий» — проверяемое утверждение

Нулевая регрессия означает одновременно:

1. **Функции:** ни одна возможность из реестра не потеряна.
2. **Данные:** одинаковый реальный вход не даёт необъяснимо более бедный semantic result.
3. **Запись:** заявленные writers проходят validate → write → reopen → compare.
4. **Приложения:** доменная операция имеет одинаковый контракт во всех host, которые способны её
   выполнить.
5. **Надёжность:** ошибки, отмена, бюджеты, отсутствие companion и повреждённые данные дают
   структурный результат, а не падение процесса.
6. **Производительность:** изменения укладываются в заранее снятый шумовой диапазон; превышение
   требует измерения, ADR и явного принятия владельцем, а не скрывается запасом общего gate.
7. **Размер:** минимальные профили не получают необязательные UI, renderer, language, runtime,
   archive или native зависимости.

Допуск benchmark — это только граница измерительного шума, а не разрешение ухудшать продукт.

---

## 1. Исправления прежней программы

Ниже — решения, которыми этот план намеренно заменяет ошибочные части
`PLAN_MIGRATION_COMPLETE_RU.md`.

### 1.1. Движок симуляции не строится с нуля

В старом modkit уже существуют:

- `SimEngine` и `createSimEngine` в SC2 runtime;
- `GalaxyEngine`;
- `Sc2RuntimeSession.stepSimulation`;
- детерминированный world scheduler, snapshots, replay/network/editor/agent/knowledge proofs;
- принятые отчёты Multiverse G0 и этапов 1–17.

Они являются **миграционным эталоном и исходным кодом переноса**, а не нулём. План переносит
доказанную реализацию в правильных владельцев, затем вводит нейтральный definition/UV boundary.
Переписывать рабочую симуляцию до появления differential tests запрещено.

### 1.2. Старые пакеты не копируются в X3 оптом

`world`, `runtime`, `games`, `agent-tools`,
`knowledge` и `lsp` — названия источников, а не список новых пакетов X3.
Их содержимое раскладывается по конечным владельцам:

| Исходная ответственность                            | Конечный владелец                            |
| --------------------------------------------------- | -------------------------------------------- |
| Нейтральные contracts runtime/language/game         | `packages/sdk`                               |
| Host discovery, bindings, process/native facilities | `packages/host`                              |
| VFS и контейнерные providers                        | `packages/vfs`                               |
| Общий UI без игровой семантики                      | `packages/ui`                                |
| Конкретные game/format/language/runtime реализации  | соответствующий `extensions/**` contribution |
| SC2 Galaxy и catalog-backed simulation              | SC2 `sc2-runtime` contribution               |
| World/scheduler/network/agent/knowledge engine      | отдельный репозиторий Multiverse             |
| VS Code protocol/client glue                        | тонкий adapter в `apps/modkit-vscode`        |

Создание в X3 долговечных пакетов `world`, `games` или
`agent-tools` только ради совпадения со старым деревом запрещено.

### 1.3. UVM exporter имеет назначенный этап

Действует вариант A: **MK3 экспортирует UVM сам**. Exporter принадлежит UVM contribution в X3;
нормативные schema/conformance fixtures принадлежат независимому Multiverse spec module. Это
уточняет прежнее решение: продукт владеет экспортной операцией, но не создаёт вторую копию
стандарта.

### 1.4. Реестр охватывает не только codec manifests

Наблюдаемый старт старого дерева содержит:

- 206 `codec.manifest.json`;
- 31 `game.manifest.json`;
- итого 237 manifest units;
- команды, editors, languages и views VS Code;
- CLI commands, app routes/operations, package exports, generators и tools;
- SC2 runtime, RTS, world и Multiverse proofs;
- UV specifications, schemas, fixtures и writers/readers.

Числа 206 или 237 сами по себе не равны пользовательским возможностям. Поэтому используются два
связанных реестра: сырой инвентарь и semantic capability registry.

### 1.5. Паритет приложений зависит от возможностей host

PWA не обязана имитировать автоматический поиск нативной установки или запуск процесса. Требуется:

- один operation ID, вход, результат и ошибка;
- один доменный handler;
- одинаковое поведение во всех host, предоставивших facility;
- структурное `host-unavailable` с понятной альтернативой в остальных.

Требование «все приложения имеют буквально одинаковый набор функций» отменяется как ложное.

### 1.6. Старый modkit сначала опечатывается

Старое дерево уже содержит незакоммиченные изменения. Поэтому одного commit hash недостаточно.
Блок 10 создаёт неизменяемый oracle descriptor: commit, tracked diff hash, список и hashes
неотслеживаемых миграционных источников, версии toolchain и список локальных real corpora. После
подтверждения descriptor старый репозиторий не изменяется до завершения программы.

### 1.7. Измеримый старт программы

| Метрика на 2026-08-24        |              Старт |
| ---------------------------- | -----------------: |
| X3 packages                  |                  6 |
| X3 apps                      |                  6 |
| `ports:check`                | 168/168, pending 0 |
| Семейства в `extensions/mk2` |                 25 |
| Legacy codec manifests       |                206 |
| Legacy game manifests        |                 31 |

`168/168` доказывает регистрацию/портирование contribution units, но не полный перенос
semantic depth, writers, UI workflows или runtime. Поэтому это исходный ratchet, а не критерий
готовности продукта.

---

## 2. Конечная архитектура

### 2.1. Физическая граница

```text
coding/
├─ modkitX3/                  # authoring platform, codecs, apps, Multiverse adapter
│  ├─ packages/              # только core, sdk, vfs, host, ui, testkit
│  ├─ extensions/            # games, formats, semantics, runtimes, viewers/renderers
│  └─ apps/                  # шесть leaf composition roots
├─ multiverse/               # отдельный engine/spec repository
│  ├─ specs/                 # UV schemas, fixtures, conformance and versioning
│  ├─ packages/              # world/runtime/presentation/net/tooling/testkit
│  ├─ extensions/            # foundations, rules, mechanics, adapters
│  └─ apps/                  # proof game, headless server, test tools
├─ references/               # справочные внешние реализации, только чтение
└─ modkitx/                  # опечатанный legacy oracle до финального retirement
```

### 2.2. Разрешённое направление зависимостей

```text
apps -> host/ui/sdk/vfs -> core
apps -> installed extension contributions
extensions -> published package APIs

modkitX3 Multiverse adapter -> public MK3 API + public Multiverse API
Multiverse -X-> modkitX3
packages -X-> apps
packages -X-> extensions
codec -X-> arbitrary URI construction / host I/O
simulation -X-> renderer or per-tick format/provider resolution
```

`-X->` означает запрещённую зависимость.

### 2.3. Неподвижные правила MK3

1. Шесть текущих product packages — `core`, `sdk`, `vfs`,
   `host`, `ui`, `testkit` — не разрастаются из-за новых игр.
2. Конкретная логика игры, формата, языка, viewer, renderer и runtime живёт в extension.
3. Codec объявляет requirements; host разрешает filesystem/archive/remote bindings.
4. App — leaf composition root и не является уникальным владельцем доменной функции.
5. Все registrations ленивые и выбираются по manifest/runtime/capability, а не по app-name.
6. Никаких скрытых fallback по имени файла без provenance.
7. Никаких дублирующих universal IR: RenderModel, UV artifacts и runtime world имеют разные
   назначенные границы.
8. Proprietary corpora не коммитятся; в репозитории лежат только descriptors, hashes, recipes и
   допустимые synthetic fixtures.

### 2.4. Неподвижные правила Multiverse

1. Multiverse запускается и тестируется без установленного Modkit.
2. MK3 открывает и инспектирует UV artifacts без запуска engine.
3. Граница языков задаётся schemas, canonical encoding, ABI и conformance vectors, не TypeScript
   types.
4. Контрольный, simulation-hot и presentation planes раздельны.
5. Simulation не ждёт загрузку render/audio ресурсов и не разрешает codecs на каждом tick.
6. Determinism определяется canonical ordering, rational timeline, RNG ownership, snapshots и
   state hashes.
7. TypeScript — обязательная reference implementation. Rust — совместимая реализация measured
   kernels; полный перенос в Rust допускается только после performance gate.
8. SC2 и C&C — два обязательных независимых vocabulary proofs. Одного SC2 недостаточно для
   объявления нейтральности.

### 2.5. Владелец UV-форматов

| Область                                                       | Владелец                                |
| ------------------------------------------------------------- | --------------------------------------- |
| UV Foundation, schemas, canonicalization, version negotiation | `multiverse/specs`                      |
| UVM/UVW/UVD/UVS conformance suites                            | `multiverse/specs`                      |
| Чтение/запись игровых native formats                          | MK3 format contributions                |
| Экспорт native → UV и импорт UV → authoring projection        | MK3 UV contributions                    |
| Исполнение UVD/UVS/UVW                                        | Multiverse runtime                      |
| Интеграционный session/preview/play API                       | версионированный MK3↔Multiverse adapter |

До публикации первого Multiverse spec package X3 может содержать snapshot fixtures, но они
генерируются из одной pinned версии и не объявляются вторым нормативным источником.

---

## 3. Управление полнотой переноса

### 3.1. Oracle lock

Артефакт `migration/oracle/legacy-oracle.lock.json` должен содержать:

- абсолютный источник только в локальном, некоммитящемся environment descriptor;
- legacy commit;
- hash `git diff --binary`;
- hashes всех включённых untracked source files;
- Node/pnpm/OS и версии внешних инструментов;
- команды получения inventory;
- descriptors реальных corpora и необходимые environment variable names;
- timestamp и подпись/подтверждение владельца.

В git попадает переносимое описание и hashes, но не секреты, пользовательские пути и proprietary
assets. Любое изменение oracle создаёт новую версию descriptor и объяснение; тихое движение
эталона запрещено.

### 3.2. Слой 1 — generated source inventory

Generator собирает минимум:

| Источник             | Единица учёта                                                         |
| -------------------- | --------------------------------------------------------------------- |
| Codec manifests      | manifest ID, operations, representations, runtimes, traits            |
| Game manifests       | game ID, discovery, formats, features, tested evidence                |
| Package exports      | public subpath и exported symbol group                                |
| VS Code package.json | command, editor, language, view, menu, configuration                  |
| CLI                  | command/subcommand/option/output contract                             |
| Apps                 | route, operation binding, host facility, product profile              |
| Scripts/tools        | generator, validator, converter, benchmark, release operation         |
| Runtime/RTS          | session, simulation, replay, save, network and server capability      |
| Multiverse           | specification, schema, fixture, reader, writer, proof and application |

Первый baseline обязан объяснить все 237 manifests. Наблюдаемые на старте показатели VS Code
(64 commands, 11 custom editors, 8 languages) используются как контрольная сумма, но generator,
а не эта строка, остаётся источником истины.

### 3.3. Слой 2 — semantic capability registry

Несколько технических строк могут реализовывать одну пользовательскую возможность. Registry хранит:

- стабильный `capabilityId`;
- пользовательский сценарий;
- legacy evidence links;
- source inventory IDs;
- целевого owner;
- требуемые host facilities;
- MK3 operation/contribution IDs;
- состояние переноса;
- уровень доказательства;
- реальные fixtures/corpus descriptors;
- известную потерю и loss receipt;
- заменяющий workflow для `superseded`;
- commit, тест и отчёт, закрывшие строку.

### 3.4. Уровни доказательства

| Уровень | Что доказано                                              |
| ------- | --------------------------------------------------------- |
| E0      | Строка обнаружена, owner ещё не назначен.                 |
| E1      | Contract/manifest существует и валидируется.              |
| E2      | Synthetic positive/negative tests проходят.               |
| E3      | Реальный corpus декодируется/изменяется с provenance.     |
| E4      | Differential result против legacy oracle не беднее.       |
| E5      | Живой app workflow и round-trip проходят на целевом host. |

Финал требует E4 для всех сравнимых функций и E5 для product-critical workflows. E2 не может
выдаваться за полный паритет.

### 3.5. Команды реестра

В блоке 10 добавляются и затем входят в `pnpm check`:

```text
pnpm migration:emit       # сгенерировать raw inventory и capability report
pnpm migration:check      # freshness, coverage, owners, legal statuses
pnpm migration:report     # человекочитаемый сводный отчёт и gap list
pnpm parity:legacy        # differential checks на pinned oracle/corpus
pnpm profiles:check       # capability/profile/minimal-closure matrix
```

Это будущие команды; до блока 10 они не заявляются как существующие.

---

## 4. Профили продукта

### 4.1. Один продукт, разные host facilities

| Профиль           | Обязательный результат                                                      | Допустимое ограничение                                  |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| Minimal SDK/embed | открыть переданный source и выполнить явно подключённую operation           | нет UI, discovery, native launch и тяжёлых runtime      |
| CLI               | batch inspect/convert/validate/edit с machine-readable output               | нет визуального editor без отдельного renderer          |
| VS Code           | authoring, languages, custom editors, previews, diagnostics, play-in-editor | native функции зависят от workspace trust и permissions |
| Electron          | полный desktop workbench, discovery, external tools, preview/edit           | нет browser sandbox ограничений                         |
| PWA               | browser-safe inspect/edit/convert через выбранные handles                   | нет автоматического native discovery/process launch     |
| Server            | headless operations, remote sessions, budgets, observability                | нет локальных dialogs и desktop UI                      |
| Automation host   | стабильный tool/agent API, structured results, cancellation                 | только явно выданные capabilities                       |

### 4.2. Формула feature parity

Для каждой semantic capability:

```text
registered + compatible runtime + granted facilities
    => одна и та же domain operation и semantic result

нет facility
    => structured host-unavailable + причина + безопасная альтернатива
```

Нельзя дублировать domain handler в приложении, чтобы «догнать» другое приложение.

### 4.3. Защита минимальных сборок

Reference profiles фиксируются до каждого platform change:

- image/viewer-only;
- headless host;
- linked extension;
- изолированные VFS providers;
- `sdk/language`;
- `sdk/runtime`;
- `sdk/renderer`;
- `sdk/games`;
- `sdk/data`;
- `sdk/maps`.

Каждый блок публикует таблицу before/after для bytes, modules и forbidden imports. Неизменившийся
общий hash без таблицы не является доказательством отсутствия роста.

---

## 5. Карта программы

| Волна                    | Блоки | Проверяемый рубеж                                                                                             |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------- |
| A. Измеримый фундамент   | 9–12  | companion resolution, честный parity, oracle lock, полный registry, UVM writer, конечные owners               |
| B. Продуктовые вертикали | 13–20 | VS Code, SC2, C&C, format depth, rendering, runtime и все шесть apps                                          |
| C. MK3 Product GA        | 21    | zero gaps по authoring/tooling, пустой mk2, недельный dogfood                                                 |
| D. Multiverse            | 22–28 | отдельный repo, UV core writers, neutral definitions, deterministic runtime, editor/network/agents, Rust gate |
| E. Общий GA              | 29    | MK3 + Multiverse 1.0, полный retirement legacy workflow                                                       |

Блок — не календарная неделя и не обещание объёма в строках. Он заканчивается только своим exit
gate. Если реестр показывает больше работы, число внутренних slices растёт, а критерий не
ослабляется.

---

## 6. Подробная очередь

### Блок 9. Companion facility, честный parity и глубина 3D

**Источник исполнения:** `PLAN_SOL_BLOCK9_FINAL_2026-08-24.md` поверх
`PLAN_SOL_BLOCK9_EXECUTION_2026-08-24.md`.

**Результат для пользователя:** W3X/W3D/VXL и M3 получают companions одинаково из filesystem,
BIG и CASC/MPQ; реальные модели дают воспроизводимую семантику.

**Обязательная работа:**

1. Снять baseline parity, benchmark и minimal profiles до resolver.
2. Реализовать host-owned companion resolution через существующий input-resolver ABI.
3. Доказать filesystem sibling, BIG namespace и SC2 CASC/MPQ namespace одним resolver без
   format branches внутри него.
4. Не добавлять I/O на путь `single`.
5. Расширить parity с synthetic на реальные corpora и всё сравнимое `common/`.
6. Углубить VXL → W3D → W3X только по доказанным UVM planes.
7. Обновить матрицу различий, negative cases, CJS/Electron/VS Code checklist.

**Exit gate:**

- все критерии финального плана блока 9 зелёные;
- исходный parity snapshot не регрессировал после resolver;
- каждый live result воспроизводим из descriptor/environment names;
- minimal profile не получил resolver/archive closure;
- спорная часть при необходимости вынесена ADR, но остальные результаты блока отгружены.

### Блок 10. Неизменяемый oracle и полный реестр перехода

**Зависит от:** блока 9.

**Результат для пользователя:** впервые существует конечный проверяемый список всего, что ещё
нужно перенести; фраза «всё готово» становится машинно проверяемой.

**Работа:**

1. Создать oracle lock для committed и dirty legacy state, не изменяя legacy repo.
2. Сгенерировать source inventory для manifests, packages, VS Code, CLI, apps, scripts, runtime,
   RTS и UV/Multiverse.
3. Объяснить все 206 codec + 31 game manifests.
4. Построить semantic capability registry с owners и evidence.
5. Добавить `migration:emit/check/report` и freshness gate.
6. Зафиксировать product profiles и bundle baselines.
7. Сверить живые corpus descriptors, не сохраняя proprietary paths в git.
8. Выполнить принятый Relic slice: 9 contributions; `extensions/mk2` 25 → 23 семейства.

**Артефакты:**

- `migration/oracle/legacy-oracle.lock.json`;
- `migration/generated/source-inventory.json`;
- `migration/capabilities.yaml`;
- `migration/generated/status.md`;
- `migration/product-profiles.json`.

**Exit gate:**

- ни одна source unit не потеряна при генерации;
- у каждой capability есть owner и planned block;
- generator deterministically clean на втором запуске;
- oracle запускается воспроизводимо или показывает видимый `environment-required`;
- `ports:check` остаётся зелёным, mk2 ratchet уменьшен ровно по факту.

### Блок 11. Единый UV authority и настоящий UVM writer

**Зависит от:** oracle/registry блока 10.

**Результат для пользователя:** MK3 сохраняет модель в стандартный UVM и снова открывает её без
скрытой потери.

**Работа:**

1. Инициализировать в отдельной границе `multiverse/specs` UV Foundation и UVM
   schema/conformance package.
2. Перенести нормативные schemas, canonical fixtures и version negotiation из legacy oracle.
3. Оставить UVM reader/inspect и raw export совместимыми.
4. Добавить отдельную UVM writer/export contribution; codec inputs не импортируют writer.
5. Определить точную границу RenderModel → UVM document → bytes.
6. Реализовать provenance, loss receipt, deterministic ordering и stable canonical output.
7. Проверить synthetic и реальные M3, W3X, W3D, VXL cases.
8. Добавить validate → export → reopen → semantic compare.
9. Проверить writer chunk и minimal reader chunk раздельно.

**Exit gate:**

- один normative UVM schema source;
- X3 exporter проходит conformance старого validator и нового spec package;
- повторный export byte-stable для canonical case;
- unsupported planes отражены loss receipt, а не выдуманы;
- minimal inspection не тянет writer/render/runtime.

### Блок 12. Convergence владельцев и dependency closure

**Зависит от:** блока 10; может идти параллельными slices после стабильного registry.

**Результат для пользователя:** дальнейший перенос не создаёт второй архитектуры и не раздувает
каждое приложение.

**Работа:**

1. Для всех legacy packages составить source → final owner matrix.
2. Разделить contracts, host facilities, concrete contributions и Multiverse engine code.
3. Переносить только проверенную cohesive unit вместе с consumers; удалять временный X3 facade в
   том же slice.
4. Расширить import guards: packages → apps/extensions, Multiverse → Modkit, browser → node/native.
5. Зафиксировать public subpaths `sdk/runtime`, language, games/discovery contracts и
   host adapters без дублирования.
6. Ввести capability-scoped optional closures для LSP, renderer, runtime, agent и external tools.
7. Показать before/after bundle graphs всех reference profiles.

**Exit gate:**

- каждая строка owner matrix имеет один конечный owner;
- ни один старый package name не превращён автоматически в новый X3 package;
- architecture/import/minimal gates зелёные;
- planned Multiverse units не импортированы в MK3 platform packages.

### Блок 13. VS Code — рабочая вертикаль и общая command surface

**Зависит от:** blocks 9–12.

**Результат для пользователя:** VS Code открывает реальный workspace, показывает assets,
диагностику и preview, вызывает те же operations, что CLI/Electron.

**Работа:**

1. Запустить ручной VS Code smoke checklist владельцем и сохранить evidence.
2. Перенести lifecycle, workspace/source selection, trust/permissions и error presentation.
3. Подключить generated extension/game catalog и host facilities.
4. Свести command dispatch с CLI/Electron к одному command runtime.
5. Закрыть первые product-critical commands: open, inspect, validate, extract, convert, preview.
6. Подключить progress, cancellation, structured result и diagnostics.
7. Доказать SC2 CASC/MPQ и C&C BIG flows в реальном окне.

**Exit gate:**

- ни один domain handler не существует только внутри VS Code adapter;
- одинаковые command fixtures проходят в CLI, Electron fake host и VS Code integration;
- live checklist имеет screenshots/logs и commit/toolchain IDs;
- activation time и bundle closure не регрессировали.

### Блок 14. VS Code — полный функциональный паритет

**Зависит от:** блока 13 и generated inventory.

**Результат для пользователя:** все legacy authoring workflows доступны в новом extension.

**Работа:**

1. Закрывать commands/editors/languages/views группами по пользовательскому workflow, а не по
   случайному порядку файлов.
2. Перенести custom editors как thin shells над shared operations/UI.
3. Перенести language services в game/language contributions; оставить LSP transport нейтральным.
4. Перенести navigation, relations, refactors, validation, preview и launch operations.
5. Сопоставить settings/keybindings/menu contributions без мёртвых command IDs.
6. Для каждой строки registry провести legacy-vs-X3 workflow test.
7. Добавить live smoke для обновления extension, reload и recovery после ошибки.

**Exit gate:**

- generated VS Code inventory не содержит `missing/partial`;
- исходные контрольные количества объяснены, даже если несколько старых команд сведены в одну;
- replacement workflow доказан для каждого `superseded`;
- VS Code app не владеет parser/simulation/game knowledge.

### Блок 15. StarCraft II authoring vertical

**Зависит от:** блоков 9, 11, 13.

**Результат для пользователя:** реальная установка SC2 проходит полный путь discovery → CASC/MPQ
→ resolved content → inspect/edit/export без старого modkit.

**Работа:**

1. Game discovery и source opening через host facilities.
2. Dependency-merged map/mod/campaign data, schemas, relations и localized strings.
3. M3, textures, maps, layouts, Galaxy/Trigger, replay/save/bank workflows.
4. Writers и patch/transaction semantics для редактируемых форматов.
5. UV projections UVM/UVD/UVW/UVS с provenance.
6. CLI, VS Code, Electron и PWA-selected-folder evidence.
7. Differential tests на одном pinned corpus.

**Exit gate:**

- все SC2 semantic capabilities E4, product-critical E5;
- ни один тест не читает случайно распакованный installation folder вместо VFS/resolver;
- writers reopen и сохраняют неизвестные данные по объявленной политике;
- environment skips видимы и воспроизводимы.

### Блок 16. C&C authoring vertical

**Зависит от:** companion facility, UVM writer и product shell.

**Результат для пользователя:** реальный C&C asset chain из BIG открывается, редактируется и
экспортируется теми же общими операциями.

**Работа:**

1. BIG namespace, nested assets и companion chains.
2. W3D/W3X/VXL/HVA/PAL, textures, maps и game data по существующему registry.
3. Generals/Zero Hour/C&C3 и другие подтверждённые variants только по реальному evidence.
4. Common RenderModel/UV projections без объявления render mesh коллайдером.
5. Writers там, где legacy действительно писал; loss receipts в остальных случаях.
6. C&C vocabulary adapter seed для будущего neutral definition layer.

**Exit gate:**

- все C&C capabilities имеют E4/E5 согласно критичности;
- archive resolver не содержит format-specific branches;
- реальные fixtures входят в parity corpus descriptors;
- C&C даёт независимое от SC2 доказательство extension architecture.

### Блок 17. Остальная глубина форматов и games

**Зависит от:** полного registry и двух вертикалей.

**Результат для пользователя:** весь длинный хвост legacy formats/games закрыт, а
`extensions/mk2` пуст.

**Метод slices:**

1. Сортировать gaps по dependency fan-in и user value.
2. Брать 3–5 связанных capabilities с одним owner.
3. Переносить processor внутрь owning extension или существующего cohesive package.
4. Добавлять positive, corrupt, truncated, budget и cancellation cases.
5. Добавлять real corpus differential и writer round-trip, если writer заявлен.
6. Уменьшать mk2 ratchet только после evidence.
7. Повторять до zero gaps; число slices определяется registry.

**Exit gate:**

- все 237 manifest units объяснены и все их заявленные операции реализованы либо заменены;
- `extensions/mk2` пуст;
- `ports:check`, `parity:legacy` и registry check зелёные;
- нет необъяснённых `X3 poorer`.

### Блок 18. Модульная 3D-вертикаль

**Зависит от:** UVM writer и зрелых model contributions.

**Результат для пользователя:** модели из SC2 и C&C отображаются одинаково в Electron, VS Code и
PWA, а headless conversion не тянет renderer.

**Работа:**

1. Renderer-neutral scene/model contracts в SDK.
2. Optional WebGL/Three/headless renderer contributions.
3. Materials, textures, skeletons, animations, attachments, LOD и collision planes по provenance.
4. Game-specific scene adaptation остаётся в extensions.
5. Lazy resource loading, budgets, cancellation и missing-resource states.
6. Golden image/scene metrics на real fixtures с допустимой platform tolerance.
7. Viewer embed, workbench preview и headless export используют один model pipeline.

**Exit gate:**

- renderer может быть удалён без поломки inspect/convert;
- no renderer modules в minimal/headless bundles;
- M3 и C&C real scenes визуально и семантически проверены;
- render loading не блокирует simulation.

### Блок 19. SC2 runtime и симуляция в IDE

**Зависит от:** SC2 authoring vertical, runtime contracts и Multiverse schemas seed.

**Результат для пользователя:** карта/мод SC2 запускается в headless simulation и VS Code
play/debug без оригинального клиента для поддержанного набора механик.

**Работа:**

1. Перенести существующие `GalaxyEngine`, `SimEngine` и session semantics в
   SC2 `sc2-runtime` contribution, не переписывая их до differential baseline.
2. Подключить dependency-merged catalogs и script lowering.
3. Сохранить budgets, cancellation, deterministic RNG/timeline и structured compatibility errors.
4. Добавить snapshots, restore, step, breakpoints, events и inspection API.
5. Подключить VS Code debug/play surface через host runtime session.
6. Сравнить state/event hashes legacy и X3 на pinned scenarios.
7. Оставить replay tracker runtime-free; simulation assistance подключать optional integration.

**Exit gate:**

- одинаковая seed/input sequence даёт одинаковый hash в повторных Node runs;
- snapshot/restore продолжает тот же event stream;
- VS Code adapter не импортирует SC2 engine напрямую;
- отсутствие runtime не ломает replay inspection и прочие codecs.

### Блок 20. Все приложения и release candidate MK3

**Зависит от:** блоков 13–19.

**Результат для пользователя:** каждый поддерживаемый workflow доступен через подходящий product
profile; старый modkit больше не нужен для ежедневной работы.

**Работа:**

1. Закрыть CLI, Electron, PWA, server и automation-host строки registry.
2. Проверить command/runtime/session contracts между всеми apps.
3. Закрыть converters, generators, diagnostics, marketplace/update и external-tool adapters.
4. Проверить install/update/uninstall extension lifecycle и corrupt extension quarantine.
5. Проверить permission denial, cancellation, restart и crash recovery.
6. Собрать signed/reproducible RC artifacts и SBOM/license notices.
7. Опубликовать полный migration report с zero unexplained gaps.

**Exit gate:**

- `pnpm check` плюс новые migration/profile/parity gates зелёные;
- все reference bundles в budget;
- live matrix на поддерживаемых OS/hosts зелёная;
- нет semantic code, уникального только для одного app;
- RC можно установить на чистую машину по документированной инструкции.

### Блок 21. Modkit MK3 Product GA

**Зависит от:** зелёного RC.

**Результат:** готовый самостоятельный Modkit MK3 для authoring, анализа, конвертации и IDE
simulation.

**Работа и gate:**

1. Владелец работает не менее семи последовательных дней в MK3, не открывая старый modkit для
   продуктовой операции.
2. Любое обращение к legacy фиксируется новой capability gap и сбрасывает dogfood clock после
   исправления.
3. Release artifacts устанавливаются, обновляются и откатываются.
4. Documentation, extension authoring guide и troubleshooting проверяются с чистого окружения.
5. Product GA tag создаётся только при zero pending/blocked/partial capabilities.

Legacy repo после этого остаётся опечатанным: его runtime/Multiverse функции ещё нужны как oracle
до общего GA.

### Блок 22. Отдельный Multiverse repository и перенос существующих proofs

**Зависит от:** spec seed блока 11; может начаться раньше Product GA отдельной командой.

**Результат для разработчика:** Multiverse собирается и тестируется отдельно, без импорта MK3.

**Работа:**

1. Создать конечную repository topology: specs, core/world/runtime/presentation/net/tooling/testkit,
   extensions и apps.
2. Перенести UV Foundation, schemas, fixtures и conformance history.
3. Перенести существующий world scheduler и G0 proofs P0–P6.
4. Перенести принятые stage 1–17 proofs с source/evidence links, не выдавая отчёты за код.
5. Разделить control, simulation-hot и presentation planes import guards.
6. Добавить Node/browser test matrix и deterministic shuffled-order runs.
7. Создать MK3 adapter как отдельную extension/integration unit, зависящую от обоих public APIs.

**Exit gate:**

- Multiverse clone проходит build/test без `modkitX3`;
- MK3 проходит build/test без Multiverse engine;
- adapter можно удалить независимо;
- каждый legacy proof либо исполняется, либо остаётся открытой registry строкой.

### Блок 23. Neutral definition layer и две игровые системы

**Зависит от:** блоков 15, 16 и 22.

**Результат для пользователя:** SC2 и C&C преобразуются в один нейтральный definition contract без
потери provenance.

**Работа:**

1. Стабилизировать UVD/rules/mechanics schemas до engine API.
2. Генерировать TypeScript types и Rust structs из одних schemas.
3. Реализовать SC2 catalog → UVD adapter.
4. Реализовать C&C data → UVD adapter без SC2-specific branches в neutral core.
5. Определить identity, references, inheritance/composition, units, weapons, abilities, effects,
   resources и upgrades.
6. Поддержать AOT artifact и live MK3 adapter; результаты должны быть эквивалентны.
7. Добавить provenance/loss receipts и unknown extension preservation.

**Exit gate:**

- два vocabulary corpora проходят одну validation suite;
- neutral schema не содержит vendor IDs в обязательных полях;
- AOT и live paths дают одинаковый canonical hash;
- schema version negotiation проверена на previous/current versions.

### Блок 24. Полный authoring-контур UV

**Зависит от:** UVM writer и neutral definitions.

**Результат для пользователя:** MK3 создаёт, открывает, проверяет и редактирует основной набор UV
artifacts.

**Обязательный core profile:**

- UVM — models;
- UVT — textures;
- UVD — definitions;
- UVW — worlds/maps;
- UVS — scenarios/logic source;
- UVR — ruleset manifest;
- UVP — package;
- UVE — extension bundle envelope.

UVA/UVV/UVF/UVG и кандидатные UVI/UVY входят только согласно semantic registry: maturity label не
подменяет support.

**Работа:**

1. Для core profile реализовать schema validate, reader, writer и canonicalizer.
2. Реализовать cross-artifact identity/reference resolution.
3. Ввести partial write transactions для editor.
4. Добавить integrity, budgets, extension negotiation и malicious corpus.
5. Проверить native → UV → reopen и UV → authoring projection.
6. Публиковать operation-specific conformance, а не один общий badge «supported».

**Exit gate:**

- core profile имеет read/write/validate/round-trip evidence;
- package graph воспроизводим и integrity проверяется;
- неизвестное расширение сохраняется или даёт явный loss receipt;
- MK3 инспектирует artifacts без engine.

### Блок 25. Deterministic TypeScript reference runtime и UVS

**Зависит от:** blocks 22–24.

**Результат для пользователя:** UV world/scenario запускается одинаково в browser, Node и IDE.

**Работа:**

1. Подключить neutral definitions к перенесённому world scheduler.
2. Реализовать/перенести UVS parser, validator, lowering и deterministic VM.
3. Определить commands, events, systems, rational timeline, RNG и state serialization.
4. Перенести SC2 runtime через adapter, а не встраивать SC2 semantics в core.
5. Добавить save/snapshot/restore/replay и canonical state hashes.
6. Провести shuffled-order, cross-host и long-run determinism tests.
7. Добавить proof game с SC2 и C&C-derived content.

**Exit gate:**

- Node и browser дают одинаковые state/event/replay hashes;
- restore сохраняет scripts, timers, AI state и RNG;
- proof game запускается из AOT package и live MK3 session;
- unsupported native mechanics дают compatibility report, не молчаливую подмену.

### Блок 26. Presentation и play-in-editor

**Зависит от:** deterministic runtime и modular 3D vertical.

**Результат для пользователя:** мир редактируется в MK3 и немедленно запускается в Multiverse с
визуализацией, паузой, шагом и инспекцией.

**Работа:**

1. Presentation snapshots отделить от simulation state.
2. Подключить UVM/UVT/resources через async resource plane.
3. Реализовать input mapping, cameras, overlays, audio hooks и UI state как optional layers.
4. Реализовать editor transaction → validate → hot reload/restart policy.
5. Подключить VS Code, Electron и PWA через один play-session contract.
6. Добавить partial write, undo/redo и recovery после несовместимого изменения.
7. Измерить frame/resource budgets отдельно от simulation.

**Exit gate:**

- headless runtime не импортирует presentation;
- missing render/audio asset не меняет deterministic simulation hash;
- один scenario редактируется и запускается во всех трёх UI host;
- failed hot reload не повреждает source и возвращает structured diagnostics.

### Блок 27. Network, server, agents и knowledge

**Зависит от:** стабильного runtime.

**Результат для пользователя:** Multiverse поддерживает headless server, replay/reconnect и
ограниченное управление AI tools без зависимости от UI.

**Работа:**

1. Перенести network protocol, authoritative sessions, snapshots и reconnect proofs.
2. Проверить latency/loss/reorder/duplicate/disconnect fault matrix.
3. Перенести campaign/save и internet operations в нейтральные owners.
4. Перенести agent operation catalog, permissions, budgets и evaluation.
5. Перенести knowledge/localization packs как versioned data contracts.
6. Проверить malicious extension/tool input и least-privilege grants.
7. Свести server/automation APIs с теми же commands/events, что local runtime.

**Exit gate:**

- headless server closure не содержит UI/render/editor;
- replay/reconnect воспроизводят подтверждённое состояние;
- agent не получает filesystem/process/network без grant;
- второй foundation/mechanics extension проходит conformance.

### Блок 28. Rust portability и performance gate

**Зависит от:** стабильных schemas и TypeScript reference runtime.

**Результат для разработчика:** Rust реализация подключается по тому же протоколу; решение о её
объёме принимается по данным.

**Обязательная работа:**

1. Сгенерировать Rust structs/codecs из тех же UV/runtime schemas.
2. Реализовать conformance runner и один изолированный deterministic kernel в Rust.
3. Сравнить exact outputs, overflow rules, ordering, serialization и failure semantics.
4. Измерить boundary/serialization cost отдельно от kernel.
5. Портировать следующий kernel только если первый даёт стабильное улучшение не менее 3× на
   реальном workload при равных результатах.
6. Полный Rust runtime разрешить только после двух успешных независимых kernels и ADR.
7. Всегда сохранять TypeScript fallback/reference path.

**Exit gate:**

- TS/Rust conformance vectors совпадают byte-for-byte;
- browser/Node/native selection не меняет semantic result;
- benchmark report включает warmup, variance, memory и boundary cost;
- если 3× gate не достигнут, это честный результат: portable boundary доказана, массовый rewrite
  отклонён, а готовность продукта не блокируется.

### Блок 29. Modkit MK3 + Multiverse 1.0 GA

**Зависит от:** всех предыдущих exit gates.

**Конечный результат программы:** готовый Modkit MK3, полностью заменяющий legacy authoring/tooling,
и совместимый независимый Multiverse 1.0 runtime.

**Финальная приёмка:**

1. Полный migration registry не содержит недопустимых состояний.
2. Все legacy source units сопоставлены semantic capabilities и evidence.
3. Все product profiles проходят capability matrix.
4. Все real-corpus differential suites не содержат необъяснённого poorer.
5. UV core profile проходит read/write/validate/round-trip.
6. SC2 и C&C проходят AOT и live adapter paths.
7. TypeScript runtime детерминирован между Node/browser; Rust boundary проходит conformance.
8. Play-in-editor, headless server, replay/restore и agent budget proofs зелёные.
9. MK3 и Multiverse устанавливаются, обновляются и собираются отдельно.
10. Владелец проходит финальный недельный сценарий без обращения к legacy продукту.

Только после этого legacy repo переводится из «oracle» в «archive». Он не удаляется автоматически.

---

## 7. Gate каждого блока

### 7.1. До работы

1. Зафиксировать branch/HEAD и `git status --short`.
2. Записать пользовательские tracked/untracked изменения и их hashes.
3. Назвать registry строки и owners текущего slice.
4. Снять target tests, parity, benchmark и bundle/profile baseline.
5. Проверить доступность real corpus через environment descriptor.

### 7.2. Во время работы

1. Один commit — одна проверяемая причина.
2. Generated outputs не смешиваются с implementation без необходимости.
3. Никакого `git add -A`; только явно перечисленные файлы.
4. Никакого rewrite history или push без отдельного решения владельца.
5. Каждый commit завершён trailer
   `Co-Authored-By: Claude Sol <noreply@anthropic.com>`.
6. Пользовательские изменения не восстанавливаются через destructive checkout/reset.
7. Generator/ratchet commands, меняющие общие tracked artifacts, запускаются последовательно.

### 7.3. Последовательный gate

Точный набор зависит от slice, но финальная последовательность включает:

```text
targeted unit/integration tests
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm check
pnpm check:extensions
pnpm check:mk2
pnpm ports:check
pnpm parity
pnpm parity:legacy          # после блока 10
pnpm migration:check       # после блока 10
pnpm profiles:check        # после блока 10
pnpm bench:universal:gate
pnpm bundle:check
live corpus / live host matrix where applicable
commit trailer audit
final git status and protected-file hash comparison
```

`pnpm check` уже включает часть этих команд, но явный повтор критических ratchets в
отчёте нужен для читаемого evidence.

### 7.4. Performance policy

Для каждого затронутого hot path сохраняются raw samples до/после. Автоматическая тревога:

- median хуже более чем на 5%;
- p95 хуже более чем на 10%;
- peak memory хуже более чем на 10%;
- новый I/O на path, где его не было;
- рост reference bundle выше установленного профилем budget.

Тревога требует исследования. Она может быть принята только отдельным ADR с пользовательской
ценностью, измерением и решением владельца; общий зелёный gate не скрывает её.

### 7.5. Отчёт блока

Отчёт содержит:

- что пользователь теперь может сделать;
- какие capability IDs закрыты и на каком evidence level;
- commits и изменённые owners;
- before/after parity, performance и bundles;
- реальные environment names/corpus descriptors;
- visible skips и почему они видимы;
- что не сделано;
- точный следующий slice.

---

## 8. Правила остановки и пересборки объёма

Остановить **спорный slice**, создать ADR и продолжить независимую часть блока, если:

- требуется изменить публичный SDK/manifest/UV schema несовместимо;
- resolver не может сохранить namespace confinement или lifetime;
- появляется второй normative schema/IR;
- concrete game/format branch требуется внутри общего host resolver или neutral engine core;
- minimal profile получает обязательную тяжёлую dependency;
- differential test выявляет необъяснимую потерю данных;
- writer не может сохранить неизвестные данные согласно заявленной политике;
- TypeScript/Rust результаты расходятся;
- требуется изменить legacy oracle;
- real asset provenance/licensing не позволяет хранить fixture;
- работа потребует rewrite history, push или изменения пользовательских файлов.

Срабатывание условия не делает весь блок «заблокированным». В отчёте фиксируются:

1. закрытые независимые slices;
2. точная спорная capability;
3. минимальный ADR;
4. новый planned block/slice;
5. сохранённый regression gate.

Нельзя ослаблять критерий, переименовывать `partial` в `done` или исключать
строку из generator, чтобы завершить блок.

---

## 9. Финальный Definition of Done

### 9.1. Modkit MK3

- [ ] Legacy oracle опечатан и воспроизводим.
- [ ] Source inventory охватывает весь legacy surface, включая 206 codec и 31 game manifests.
- [ ] Semantic registry не содержит missing/partial/blocked/unknown.
- [ ] Каждая superseded capability имеет проверенный replacement workflow.
- [ ] `extensions/mk2` пуст.
- [ ] Нет необъяснённых poorer rows на synthetic и real corpora.
- [ ] Writers проходят round-trip и loss policy.
- [ ] Все шесть apps используют общие domain operations.
- [ ] Host differences представлены capability gating, а не расхождением семантики.
- [ ] Minimal profiles не выросли от optional функций.
- [ ] VS Code, Electron, PWA, CLI, server и automation live/contract matrix зелёная.
- [ ] SC2 и C&C вертикали E5 на реальных установках владельца.
- [ ] 3D viewer модульный и не входит в headless closure.
- [ ] SC2 simulation работает в IDE/headless с deterministic restore.
- [ ] Установочный/обновительный/recovery путь проверен.
- [ ] Семидневный dogfood MK3 завершён.

### 9.2. Multiverse

- [ ] Репозиторий собирается без Modkit.
- [ ] UV Foundation и core schemas имеют единственного владельца.
- [ ] UVM/UVT/UVD/UVW/UVS/UVR/UVP/UVE имеют operation-specific conformance.
- [ ] Core profile имеет readers, writers, validators и round-trip.
- [ ] SC2 и C&C definition adapters проходят одну neutral suite.
- [ ] AOT и live MK3 adapter дают одинаковые canonical artifacts.
- [ ] TypeScript runtime детерминирован между Node/browser.
- [ ] Snapshot/restore/replay сохраняют scripts, timers, AI и RNG.
- [ ] Presentation не влияет на simulation hash.
- [ ] Play-in-editor работает в VS Code, Electron и PWA.
- [ ] Headless server/reconnect/network fault matrix зелёная.
- [ ] Agent/knowledge operations ограничены capabilities и budgets.
- [ ] Rust schema bindings и kernel conformance доказаны.
- [ ] Performance gate определил, какие kernels действительно переносятся в Rust.
- [ ] Proof game и второй foundation/mechanics extension проходят release suite.

### 9.3. Retirement старого modkit

- [ ] В registry нет возможности, для которой legacy остаётся единственным рабочим путём.
- [ ] Последний dogfood не потребовал открыть legacy продукт.
- [ ] Oracle и migration reports архивированы с release.
- [ ] Справочные материалы сохранены read-only.
- [ ] Архивирование объявлено явно; автоматического удаления или переписывания истории нет.

---

## 10. Ближайшее исполняемое действие

Пока блок 9 не завершён, очередь не перескакивает к массовому переносу. Следующее действие:

1. выполнить шаг 0 блока 9 и опубликовать честные baseline artifacts;
2. реализовать один host-owned companion resolver для filesystem, BIG и CASC/MPQ;
3. до углубления codecs закрыть долг real-corpus parity;
4. завершить VXL/W3D/W3X slices и финальный gate блока 9;
5. перейти к oracle lock и generated migration registry блока 10.

Это минимальный путь, который одновременно даёт полезный результат сейчас и не теряет управляемость
полного перехода.
