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
Он сохраняет принятый блок 9, исправляет ошибки прежнего плана и доводит очередь до трёх
проверяемых результатов в строгом порядке:

1. **Modkit MK3 Focused Product GA** — самостоятельная модульная платформа и шесть приложений.
   До этого рубежа без пробелов закрываются `common` и выбранные игровые вертикали: StarCraft II;
   C&C 3 Tiberium Wars, Kane's Wrath и Red Alert 3; Warzone 2100; Spring/Recoil с именованной
   композицией Beyond All Reason.
2. **Modkit MK3 + Multiverse 1.0 Focused GA** — полный UV-контур для того же приоритетного профиля,
   детерминированный TypeScript runtime, независимая граница Rust и работающий play-in-editor.
3. **Legacy Migration Complete** — после выпуска MK3 и Multiverse закрывается оставшийся long tail,
   весь функционал старого `modkitx` получает проверенную замену без регрессий, `extensions/mk2`
   пустеет и legacy переводится из oracle в архив.

Такой разрез фиксирует решение владельца от 2026-08-24: неприоритетные кодеки не блокируют
реализацию платформы и Multiverse, но не исчезают из реестра и не выдаются за готовые.

`PLAN_SOL_BLOCK9_FINAL_2026-08-24.md` и
`PLAN_SOL_BLOCK9_EXECUTION_2026-08-24.md` остаются обязательными подробными планами
текущего блока. При противоречии с прежними общими планами действует этот документ.

---

## 0. Что значит «готово»

### 0.1. Конечный пользовательский результат

После Focused GA владелец может делать следующее в приоритетном контуре; после
`Legacy Migration Complete` тот же контракт распространяется на весь legacy surface:

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

### 0.2. Два честных уровня готовности

**Focused GA** требует полного результата только внутри машинно вычисляемого priority closure.
Там запрещены `missing`, `blocked`, необъяснённый `partial` и скрытые environment skips. Для
неприоритетной строки допустим `deferred-post-ga`, но только если текущая X3-функция не
регрессировала, сохранено исходное evidence и назначен post-GA slice.

**Legacy Migration Complete** — глобальный рубеж. На нём `deferred-post-ga` больше недопустим и
действует требование полного переноса ниже.

### 0.3. «Полный перенос» — не копирование каталогов

Полный перенос означает, что **каждая наблюдаемая возможность** старого modkit получает ровно один
из следующих финальных исходов:

| Финальный исход        | Смысл                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `implemented`          | Возможность реализована в MK3 тем же или лучшим способом.                                     |
| `equivalent-better`    | Старый механизм заменён другим, но пользовательский сценарий и данные сохранены или улучшены. |
| `relocated-multiverse` | Исполнение принадлежит Multiverse, а MK3 предоставляет интеграцию через публичный adapter.    |
| `superseded`           | Старый внутренний механизм больше не нужен; указан и проверен заменяющий сценарий.            |

В глобальном финальном состоянии запрещены строки `missing`, `partial`, `blocked`, `unknown`,
`deferred-post-ga` и `waived-without-replacement`.
Фраза «не переносим» без проверяемой замены не закрывает строку.

### 0.4. «Без регрессий» — проверяемое утверждение

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

### 0.5. Зафиксированный приоритет до MK3 + Multiverse 1.0

Priority closure строится генератором, а не ручным списком путей. В него входят:

1. **Все contributions в `extensions/common/**`** и их обязательные зависимости.
2. **Common documents:** существующие Markdown и CSV; перенос TXT, ODT, ODS, ODP из
   `mk2/uncommon-documents`; новый ODG как `origin: owner-addition`.
3. **StarCraft II:** CASC, MPQ, M3 и полный SC2 map/mod/campaign/data/language/replay/save/bank
   workflow, обнаруженный реальным corpus inventory.
4. **C&C:** три независимых named-game profiles — `cnc3-tiberium-wars`,
   `cnc3-kanes-wrath`, `red-alert-3` — и общий доказанный BIG/SAGE dependency closure.
5. **Warzone 2100:** named game `warzone-2100`, его VFS, карты, models, data, scripts и media.
6. **Spring/Recoil + BAR:** engine/content formats Spring/Recoil и отдельный named game
   `beyond-all-reason`; Spring/Recoil не объявляются одной игрой.
7. Platform, app, authoring, runtime и UV capabilities, необходимые этим профилям.

Все остальные форматы и игры получают `releaseTrack: post-ga`. Они остаются зарегистрированными,
проходят текущий structural/baseline ratchet и не могут ухудшиться, но их дополнительная
семантическая глубина не блокирует два Focused GA. Relic, RA2/TS VXL/HVA/PAL, Generals/Zero Hour
и прочий long tail начинают углубляться только после Multiverse 1.0.

Фраза «формат поддержан» не используется без списка операций. Для каждого codec публикуются
generated badges Detect/Read/Preview/Edit/Round-trip/Browser/Headless/Fuzzed. Для каждой игры
отдельно публикуются пять уровней: native inspect/authoring; native→UV; neutral definitions/world;
deterministic playable subset; native round-trip. Более высокий уровень не подразумевается из
нижнего и не переносится с другой версии игры.

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

### 1.8. Авторитетность документов и найденный drift

До переноса нормативных текстов действуют следующие приоритеты:

1. Контракты и целевая архитектура — `../modkitx/docs/architecture/MODKIT_ARCHITECTURE.md`.
2. Порядок, release scope и критерии этапов — этот документ.
3. Детали текущего блока — `PLAN_SOL_BLOCK9_FINAL_2026-08-24.md` и execution plan, если они не
   противоречат пунктам 1–2.
4. `docs/MK3/**`, coverage ledgers и старые планы — design/evidence inputs, не release authority.

Проверка обнаружила три drift, которые нельзя переносить в реализацию:

- текущие шесть каталогов `packages/` — состояние X3, а не финальный package catalog;
- поле `covered` в старом coverage ledger означает назначенного владельца/viewer, а не рабочую
  реализацию и не evidence;
- примеры extension API и README должны проверяться компиляцией против реального ABI, а не
  считаться корректными по тексту.

До public extension GA вводится `docs:conformance`: ссылки не битые, scaffold собирается, code
samples компилируются, manifest examples проходят schema validation, а generated capability
tables не расходятся с manifests.

---

## 2. Конечная архитектура

### 2.0. Простая модель продукта

Modkit — не «папка парсеров», а операционная среда для игровых данных. Приложение просит host
открыть источник; VFS безопасно даёт байты и архивный namespace; resolver выбирает contribution
по доказательствам; codec публикует Subject — факты, traits, data sources и доступные operations;
приложение выбирает совместимый viewer/editor. Ни приложение, ни viewer не угадывают формат.

Extension — независимо устанавливаемая единица возможностей. Она может содержать несколько узких
contributions: format codec, named-game profile, VFS provider, viewer/editor, writer, language или
runtime adapter. **Codec не равен extension:** codec понимает одну форму данных; game contribution
собирает доказанные codecs/providers в конкретную игру; extension является упаковкой и границей
версии, прав, лицензии и зависимостей.

Multiverse — отдельный детерминированный движок. Он получает neutral UV artifacts через съёмный
adapter и не импортирует внутренности Modkit. Поэтому новый формат расширяет authoring без
изменения engine, новая игра собирается как extension без изменения шести apps, а другой runtime
может заменить Multiverse, реализовав тот же публичный session contract.

### 2.1. Физическая граница

```text
coding/
├─ modkitX3/                  # authoring platform, codecs, apps, Multiverse adapter
│  ├─ packages/              # canonical 7+2 publication units
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

1. Канонический каталог — девять publication units: `core`, `sdk`, `vfs`, `host`, `ui`,
   `runtime`, `testkit`, `lsp`, `xml`. Это **7+2**, а не девять обязательных зависимостей:
   runtime closure минимального host — только `core + sdk + vfs + host`; `testkit` dev-only;
   `ui/runtime/lsp/xml` optional по product profile.
2. Конкретная логика игры, формата, языка, viewer, renderer и runtime живёт в extension.
3. Codec объявляет requirements; host разрешает filesystem/archive/remote bindings.
4. App — leaf composition root и не является уникальным владельцем доменной функции.
5. Все registrations ленивые и выбираются по manifest/runtime/capability, а не по app-name.
6. Никаких скрытых fallback по имени файла без provenance.
7. Никаких дублирующих universal IR: RenderModel, UV artifacts и runtime world имеют разные
   назначенные границы.
8. Proprietary corpora не коммитятся; в репозитории лежат только descriptors, hashes, recipes и
   допустимые synthetic fixtures.
9. После одноразовой сходимости 7+2 новые игры и форматы не создают platform package и не требуют
   правок в шести apps.

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
8. SC2, SAGE (три выбранных C&C), Warzone и Spring/BAR — четыре обязательных независимых
   vocabulary proofs. Одной экосистемы недостаточно для объявления нейтральности.

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
- `releaseTrack`: `mk3-priority`, `multiverse-priority` или `post-ga`;
- `origin`: `legacy` или `owner-addition`;
- legacy evidence links;
- source inventory IDs;
- целевого owner;
- требуемые host facilities;
- MK3 operation/contribution IDs;
- независимые `migrationState`, `supportState` и `runtimeAvailability`;
- уровень доказательства;
- реальные fixtures/corpus descriptors;
- известную потерю и loss receipt;
- заменяющий workflow для `superseded`;
- commit, тест и отчёт, закрывшие строку.

`migrationState` отвечает, перенесён ли workflow; `supportState` — какую часть формата продукт
честно понимает; `runtimeAvailability` — где операция исполнима. Поэтому read-only ODF codec может
быть полностью мигрирован и одновременно не иметь Edit badge. Это не gap, если writer не был
заявлен и обязательный пользовательский workflow закрыт. Нельзя переименовывать честный
operation-specific `partial` в `supported` ради release score.

### 3.4. Уровни доказательства

| Уровень | Что доказано                                              |
| ------- | --------------------------------------------------------- |
| E0      | Строка обнаружена, owner ещё не назначен.                 |
| E1      | Contract/manifest существует и валидируется.              |
| E2      | Synthetic positive/negative tests проходят.               |
| E3      | Реальный corpus декодируется/изменяется с provenance.     |
| E4      | Differential result против legacy oracle не беднее.       |
| E5      | Живой app workflow и round-trip проходят на целевом host. |

Focused GA требует E4 для всех сравнимых priority-функций и E5 для product-critical workflows.
Глобальный финал распространяет это правило на весь legacy surface. E2 и allocation `covered` не
могут выдаваться за полный паритет.

### 3.5. Команды реестра

В блоке 10 добавляются и затем входят в `pnpm check`:

```text
pnpm migration:emit       # сгенерировать raw inventory и capability report
pnpm migration:check      # freshness, coverage, owners, legal statuses
pnpm migration:report     # человекочитаемый сводный отчёт и gap list
pnpm priority:emit        # exact IDs + transitive dependencies выбранного release scope
pnpm priority:check       # полнота priority closure и запрет priority units в mk2
pnpm parity:legacy        # differential checks на pinned oracle/corpus
pnpm profiles:check       # capability/profile/minimal-closure matrix
```

Это будущие команды; до блока 10 они не заявляются как существующие.

`ports:check` остаётся глобальным структурным храповиком 168/168. Он не заменяет
`priority:check`: первый отвечает «contribution не потерян», второй — «каждая заявленная операция
приоритетного продукта доказана». Неприоритетный `deferred-post-ga` не попадает в официальные
presets до своего migration slice.

### 3.6. Что означает «codec работает чётко»

Каждый priority codec принимается не общим словом `supported`, а одинаковым контрактом:

1. **Identity:** stable qualified ID, versions/dialects и owning extension.
2. **Detect:** bounded bytes/structure evidence; renamed и wrong-extension cases; при равных
   доказательствах — structured ambiguity, не угадывание.
3. **Input:** один `AssetSource`; companions объявляет codec, но namespace/URI разрешает host.
4. **Open:** descriptor содержит только доказанные traits, operations, representations,
   provenance, revision и diagnostics; trait никогда не подразумевает operation.
5. **Use:** каждая объявленная operation имеет positive test и реальный corpus evidence; viewer
   выбирается по contracts/traits, не по format ID.
6. **Fail safely:** corrupt, truncated, missing/ambiguous companion, bomb, budget, cancellation и
   permission denial не падают процессом и не оставляют открытые resources.
7. **Round-trip:** заявленный writer проходит validate→write→reopen→semantic compare,
   deterministic output и unknown-data/loss policy. Нет writer — нет Edit/Round-trip badge.
8. **Hosts:** portable contract проверяется в browser worker и Node worker там, где runtime
   совместим; native facility имеет structured `host-unavailable` вне способных hosts.
9. **Composition:** loose file и вложенный archive/VFS path дают одинаковую семантику; collision
   suite доказывает, что generic codec не перехватывает game semantics.
10. **Closure:** single path не получает лишний I/O, minimal bundles не тянут optional dependency,
    performance/bundle before-after опубликованы.

Для новой возможности без legacy-аналога (ODG, Kane's Wrath contribution) E4 означает сравнение с
официальной спецификацией/реальным corpus и альтернативным независимым parser/tool, где доступно;
отсутствующий legacy row не превращает её автоматически в E4.

---

## 4. Профили продукта

### 4.1. Один продукт, разные host facilities

| Профиль           | Обязательный результат                                                      | Допустимое ограничение                                                       |
| ----------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Minimal SDK/embed | открыть переданный source и выполнить явно подключённую operation           | нет UI, discovery, native launch и тяжёлых runtime                           |
| CLI               | batch inspect/convert/validate/edit с machine-readable output               | нет визуального editor без отдельного renderer                               |
| VS Code           | authoring, languages, custom editors, previews, diagnostics, play-in-editor | native функции зависят от workspace trust и permissions                      |
| Electron          | полный desktop workbench, discovery, external tools, preview/edit           | sandboxed renderer; native facilities только через typed preload/permissions |
| PWA               | browser-safe inspect/edit/convert через выбранные handles                   | нет автоматического native discovery/process launch                          |
| Server            | headless operations, remote sessions, budgets, observability                | нет локальных dialogs и desktop UI                                           |
| Automation host   | стабильный tool/agent API, structured results, cancellation                 | только явно выданные capabilities                                            |

### 4.2. Формула feature parity

Для каждой semantic capability:

```text
registered + compatible runtime + granted facilities
    => одна и та же domain operation и semantic result

нет facility
    => structured host-unavailable + причина + безопасная альтернатива
```

Нельзя дублировать domain handler в приложении, чтобы «догнать» другое приложение.

Официальные release presets до Focused GA: `Common/Documents`, `SC2 Mod Studio`,
`C&C SAGE Studio`, `Warzone 2100 Studio`, `BAR/Spring Studio`, `Universal Asset Explorer`,
`Headless Mod CI`. Preset — данные composition lock, не fork приложения.

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

| Волна                              | Блоки | Проверяемый рубеж                                                                                            |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| A. Измеримый фундамент             | 9–12  | companion, parity, oracle, generated priority closure, common/documents, UVM writer, package/doc convergence |
| B. Приоритетные вертикали          | 13–20 | общие app contracts, SC2, три C&C, Warzone, Spring/Recoil/BAR, 3D/runtime и шесть apps                       |
| C. MK3 Focused Product GA          | 21    | zero priority gaps, zero priority units в mk2, недельный dogfood выбранных profiles                          |
| D. Multiverse                      | 22–28 | отдельный repo, UV core, четыре vocabulary proofs, deterministic runtime, editor/network/agents, Rust gate   |
| E. MK3 + Multiverse 1.0 Focused GA | 29    | независимые releases и полный priority path native → UV → runtime                                            |
| F. Post-GA breadth                 | 30    | Relic и весь оставшийся long tail по generated slices без ослабления global baseline                         |
| G. Legacy Migration Complete       | 31    | глобальный zero-gap, пустой `mk2`, весь старый функционал заменён и legacy oracle архивирован                |

Блок — не календарная неделя и не обещание объёма в строках. Он заканчивается только своим exit
gate. Если реестр показывает больше работы, число внутренних slices растёт, а критерий не
ослабляется.

---

## 6. Подробная очередь

### Блок 9. Companion facility, честный parity и глубина 3D

**Источник исполнения:** `PLAN_SOL_BLOCK9_FINAL_2026-08-24.md` поверх
`PLAN_SOL_BLOCK9_EXECUTION_2026-08-24.md`.

**Результат для пользователя:** приоритетные W3X и M3 получают companions одинаково из filesystem,
BIG и CASC/MPQ; уже сделанные W3D/VXL cases сохраняют regression evidence, но их дальнейшая
глубина не блокирует Focused GA.

**Обязательная работа:**

1. Снять baseline parity, benchmark и minimal profiles до resolver.
2. Реализовать host-owned companion resolution через существующий input-resolver ABI.
3. Доказать filesystem sibling, BIG namespace и SC2 CASC/MPQ namespace одним resolver без
   format branches внутри него.
4. Не добавлять I/O на путь `single`.
5. Расширить parity с synthetic на реальные corpora и всё сравнимое `common/`.
6. Завершить принятые и уже начатые W3D/VXL regression slices без расширения их объёма; новую
   глубину направить в M3+CASC/MPQ и W3X+BIG, относящиеся к выбранным играм.
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
5. Добавить `releaseTrack`, `origin`, независимые migration/support/runtime states и сгенерировать
   exact priority closure со всеми transitive dependencies.
6. Добавить `migration:emit/check/report`, `priority:emit/check` и freshness gate.
7. Зафиксировать product profiles и bundle baselines.
8. Сверить живые corpus descriptors, не сохраняя proprietary paths в git.
9. Зафиксировать весь неприоритетный хвост как `deferred-post-ga`; Relic здесь не переносить.

**Артефакты:**

- `migration/oracle/legacy-oracle.lock.json`;
- `migration/generated/source-inventory.json`;
- `migration/capabilities.yaml`;
- `migration/priority-scope.json`;
- `migration/generated/status.md`;
- `migration/product-profiles.json`.

**Exit gate:**

- ни одна source unit не потеряна при генерации;
- у каждой capability есть owner и planned block;
- generator deterministically clean на втором запуске;
- oracle запускается воспроизводимо или показывает видимый `environment-required`;
- `ports:check` остаётся зелёным; `priority:check` падает на пропущенной зависимости, priority unit
  в `mk2`, недоказанной операции или скрытом skip;
- allocation coverage и implementation/evidence state представлены разными полями.

### Блок 11. Common documents и единый UVM writer

**Зависит от:** oracle/registry блока 10.

**Результат для пользователя:** обычные текстовые и OpenDocument-файлы открываются через общие
контракты, а MK3 сохраняет модель в стандартный UVM и снова открывает её без скрытой потери.

**Slice 11A — plain text, Markdown и CSV:**

1. Перенести TXT из `mk2/uncommon-documents` в `common/plain-text`: read-only codec даёт bounded
   UTF-8/UTF-16 с BOM provenance, binary rejection, text source, inspect/raw export. Legacy
   edit/write восстанавливает отдельная common text editor/writer contribution с write→reopen;
   codec не пишет источник напрямую.
2. Markdown **не переносить повторно**: он уже в `extensions/common/documents`. Закрыть aliases
   `.md/.markdown/.mdown/.mkd`, safe preview без исполнения HTML/script, edit transaction и убрать
   routing ambiguity со старым contribution ID.
3. CSV **не переносить повторно**: он уже в `extensions/common/text-delimited`. Проверить CSV/TSV,
   quotes, embedded CR/LF, BOM, empty/trailing cells, streaming/budgets и serialize→parse; formula
   execution/injection в preview запрещены.

**Slice 11B — ODF как проверка document contracts:**

4. Перенести ODT, ODS, ODP в `common/documents`; добавить новый ODG с
   `origin: owner-addition`. Один private ODF package reader переиспользуется четырьмя отдельными
   codec contributions и не создаёт platform package. До ODP/ODG preview стабилизировать generic
   SDK contracts для flow/table/slides/vector без ODF-specific полей; отсутствие подходящего
   contract — ADR/stop condition, а не повод протащить private shape в app.
5. Детекция обязана проверить ZIP, точный uncompressed `mimetype`, `META-INF/manifest.xml` и
   required parts; extension alone недостаточно. Проверить traversal, duplicate names, XML/ZIP
   bombs, external resources, macros, malformed/truncated input, budgets и cancellation.
6. Публиковать только реально разобранные representations: ODT — flow/outline/text; ODS —
   sheets/cells/formulas без вычисления; ODP — slides/text; ODG — pages/shapes/text/vector scene.
7. Обязательны inspect/validate/safe preview/raw export и явная unknown-entry/loss policy. Layout
   fidelity и writer недоступны, пока preserving repack и round-trip не доказаны.
8. `Common Documents` остаётся opt-in preset, чтобы minimal/plain-text не тянул ZIP/XML/UI.

**Slice 11C — единый UV authority и UVM writer:**

9. Инициализировать `multiverse/specs` как единственного владельца UV Foundation и UVM
   schema/conformance; перенести schemas, canonical fixtures и version negotiation из oracle.
10. В X3 оставить UVM reader и добавить отдельную UVM writer/export contribution; native model
    codecs не импортируют exporter.
11. Определить RenderModel → UVM document → bytes; реализовать provenance, loss receipt,
    deterministic ordering и validate→export→reopen→semantic compare.
12. Проверить synthetic/common models и реальные приоритетные M3, W3X. W3D/VXL участвуют только
    как сохранённые regression cases, не как новая обязательная глубина.
13. Проверить writer chunk и minimal reader chunk раздельно.

**Exit gate:**

- TXT/Markdown/CSV имеют operation-level E4 и один активный route на формат;
- Common closure после добавлений содержит 74 codec contributions, подтверждённых generator, а не
  ручным числом;
- ODT/ODS/ODP/ODG проходят portable + Node worker conformance и публикуют только доказанные traits;
- один normative UVM schema source;
- X3 exporter проходит conformance старого validator и нового spec package;
- повторный export byte-stable для canonical case;
- unsupported planes отражены loss receipt, а не выдуманы;
- minimal inspection не тянет writer/render/runtime.

### Блок 12. Common conformance, convergence владельцев и dependency closure

**Зависит от:** блока 10; может идти параллельными slices после стабильного registry.

**Результат для пользователя:** каждый common-формат честно выполняет все объявленные операции,
а дальнейший перенос не создаёт второй архитектуры и не раздувает приложения.

**Работа:**

1. Зафиксировать generator-ом 69 исходных common contributions и 74 после блока 11: archives 15,
   audio 6, container 1, documents 7, images 22, models 6, text-data 8, vector 3, video 6.
2. Для каждого common contribution проверить positive/renamed/wrong-extension/ambiguous detect,
   corrupt/truncated/bomb/budget/cancel, portable+Node worker и loose+nested-archive sources.
3. Preview обязателен для заявленного image/audio/video/model/vector/document trait; writer —
   write→reopen→compare только если операция заявлена. Необъявленная операция возвращает
   structured unavailable, а не заглушку. `partial` или пустой status сам по себе не evidence.
4. Добавить collision suite: plain TXT↔game text; XML↔SC2/C&C; `.map` C&C↔Warzone;
   `.w3x` SAGE↔Warcraft map; `.wz`↔ZIP; JSON↔Warzone; Lua↔Spring; ODF↔ZIP.
5. Для всех legacy packages составить source → final owner matrix и свести текущие шесть package
   directories к каноническим 7+2 publication units без game-specific code.
6. Разделить contracts, host facilities, concrete contributions и Multiverse engine code.
7. Переносить только проверенную cohesive unit вместе с consumers; удалять временный X3 facade в
   том же slice.
8. Расширить import guards: packages → apps/extensions, Multiverse → Modkit, browser → node/native.
9. Зафиксировать public subpaths `sdk/runtime`, language, games/discovery contracts и
   host adapters без дублирования.
10. Заморозить runtime session v2: step/status/events, snapshot/restore, deterministic state hash,
    content/schema identity, capability negotiation, budgets/cancellation и diagnostics.
11. Ввести capability-scoped optional closures для LSP, renderer, runtime, agent и external tools.
12. Исправить developer guide/scaffold и включить `docs:conformance` в CI.
13. Показать before/after bundle graphs всех reference profiles.

**Exit gate:**

- каждая строка owner matrix имеет один конечный owner;
- все 74 common contributions имеют generated operation-specific evidence; ноль необъяснённых
  `partial/implicit` внутри priority scope;
- ни один старый package name не превращён автоматически в новый X3 package;
- target package catalog равен 7+2, bootstrap runtime closure остаётся четырёхпакетным;
- architecture/import/minimal gates зелёные;
- extension scaffold компилируется против реального `open(input, intent, budget)` ABI;
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
7. Доказать Common Documents, SC2 CASC/MPQ, C&C BIG, Warzone `.wz` и BAR Spring VFS flows в
   реальном окне или через заранее утверждённый owner checklist.

**Exit gate:**

- ни один domain handler не существует только внутри VS Code adapter;
- одинаковые command fixtures проходят в CLI, Electron fake host и VS Code integration;
- live checklist имеет screenshots/logs и commit/toolchain IDs;
- activation time и bundle closure не регрессировали.

### Блок 14. VS Code — priority functional parity

**Зависит от:** блока 13 и generated inventory.

**Результат для пользователя:** все shared и priority authoring workflows доступны в новом
extension; codec-specific long tail остаётся видимым `deferred-post-ga`, а не маскируется.

**Работа:**

1. Закрывать commands/editors/languages/views группами по пользовательскому workflow, а не по
   случайному порядку файлов.
2. Перенести custom editors как thin shells над shared operations/UI.
3. Перенести language services в game/language contributions; оставить LSP transport нейтральным.
4. Перенести navigation, relations, refactors, validation, preview и launch operations.
5. Сопоставить settings/keybindings/menu contributions без мёртвых command IDs.
6. Для каждой `mk3-priority` строки registry провести legacy-vs-X3 workflow test; для post-GA
   строк сохранить существующий baseline и назначенный replacement slice.
7. Добавить live smoke для обновления extension, reload и recovery после ошибки.

**Exit gate:**

- generated VS Code inventory не содержит `missing/blocked/unexplained partial` в priority scope;
- исходные контрольные количества объяснены, даже если несколько старых команд сведены в одну;
- replacement workflow доказан для каждого `superseded`;
- VS Code app не владеет parser/simulation/game knowledge.

### Блок 15. StarCraft II authoring vertical

**Зависит от:** блоков 9, 11, 13.

**Результат для пользователя:** реальная установка SC2 проходит полный путь discovery → CASC/MPQ
→ resolved content → inspect/edit/export без старого modkit.

**Работа:**

1. Game discovery и source opening через host facilities.
2. CASC → MPQ → resolver → semantic operations; `.SC2Map`, `.SC2Mod` и `.SC2Campaign` получают
   явные working paths, а не постоянный stub.
3. Dependency-merged map/mod/campaign data, schemas, relations и localized strings.
4. M3/M3A + textures/attachments, maps, layouts, Galaxy/Trigger, replay/save/bank workflows.
5. Writers и patch/transaction semantics для редактируемых форматов; signing/launch/playback
   либо реализованы, либо имеют доказанный replacement workflow.
6. UV projections UVM/UVD/UVW/UVS с provenance.
7. CLI, VS Code, Electron и PWA-selected-folder evidence.
8. Differential tests на pinned retail Core/Liberty corpora и workspace corpus; одна случайно
   распакованная папка не считается доказательством.

**Exit gate:**

- все SC2 semantic capabilities E4, product-critical E5;
- ни один тест не читает случайно распакованный installation folder вместо VFS/resolver;
- writers reopen и сохраняют неизвестные данные по объявленной политике;
- runtime plane до блока 19 либо предоставляет versioned session v2, либо остаётся явной открытой
  priority строкой и не позволяет объявить GA;
- environment skips видимы и воспроизводимы.

### Блок 16. C&C Tiberium Wars, Kane's Wrath и Red Alert 3

**Зависит от:** companion facility, UVM writer и product shell.

**Результат для пользователя:** три названные игры независимо обнаруживаются и монтируются;
реальный retail chain BIG → SAGE asset bundle → model/map/data/media открывается, проверяется и
экспортируется теми же общими операциями.

**Работа:**

1. Создать три отдельных named-game contributions: `cnc3-tiberium-wars`, новый
   `cnc3-kanes-wrath` (`origin: owner-addition`) и `red-alert-3`. У каждого свои install signatures,
   versions/patch/language precedence, mount, game card, corpus descriptor и launch policy.
2. Закрыть общий dependency closure: BIG4/BIGF, RefPack, SkuDef, nested
   `sage-asset-bundle`, W3X, DDS/TGA, Wwise WEM/BNK/PCK, Bink BIK/BK2, maps, data и localization.
   Shared implementation разрешена только при доказанном одинаковом dialect.
3. Реализовать retail compiled representations `.manifest/.bin/.imp/.relo/.version/.cdata` с
   relations/definition projection. Source XML-only результат не считается полным `game.catalog`.
4. Для каждой игры доказать отдельно: discovery → mount → browse/extract → model/map preview →
   validate/export → launch при доступной facility. KW corpus не доказывает TW или RA3.
5. Maps публикуют metadata, terrain, objects и честные 2D/3D representations; model pipeline —
   static/skinned/animation/material/texture/collision planes только с provenance.
6. Writers реализуются там, где legacy действительно писал или новый preserving writer имеет
   round-trip; в остальных случаях операция отсутствует и выдаётся loss/availability receipt.
7. Добавить C&C vocabulary/UV adapter seed без SAGE branches в neutral core.
8. VXL/HVA/PAL (RA2/TS), Generals/Zero Hour и дополнительная W3D depth остаются post-GA; уже
   существующие regression tests сохраняются.

**Exit gate:**

- все capabilities трёх named games и их dependency closure имеют E4/E5 согласно критичности;
- compiled retail data и nested asset bundles дают schema/relations, а не metadata-only shell;
- archive resolver не содержит format-specific branches;
- три реальные installation/corpus descriptors входят в parity report без скрытых skips;
- C&C даёт независимое от SC2 доказательство extension architecture.

### Блок 17. Warzone 2100 и Spring/Recoil/Beyond All Reason

**Зависит от:** полного priority registry, common conformance и product shell.

**Результат для пользователя:** две open-source экосистемы работают как полноценные независимые
вертикали, а не как набор поверхностных manifests.

**Slice 17A — Warzone 2100:**

1. Перенести из `mk2` `warzone-wz/wrf/lev/img/pie/warzone2100-map` в конечного owner и добавить
   named-game `warzone-2100` с real 4.7+ discovery/mount/version evidence.
2. Реализовать `.wz` как ZIP + last-wins VFS overlay; common ZIP остаётся контейнером, game
   contribution добавляет Warzone semantics.
3. Закрыть map bundle `.gam + game.map + ttypes.ttp + JSON/BJO`, WRF/LEV/IMG references,
   PIE+textures, current JSON/data schemas, localization/media и deterministic 2D/3D map.
4. Добавить location+structure routing для Warzone JSON и bounded JS include/reference analysis
   без исполнения; generic JSON остаётся alternate raw view.
5. Проверить modern save directory (`gamestate.wz` + sidecars) и legacy save paths. Writer
   объявлять только с write→reopen→semantic compare.
6. Сохранить GPL extension как lazy optional license boundary: никакого static linking Warzone code
   в MIT packages/apps; SBOM и notices обязательны.

**Slice 17B — Spring/Recoil engine formats и BAR:**

7. Перенести `spring-rapid` и `spring-vfs`; реализовать `.sdp`+pool+repos/versions,
   `.sdd/.sdz/.sd7`, four-section VFS, dependency DFS/replace и first-wins provenance.
8. Реализовать встреченные в corpus модели S3O/3DO, карты SMF/SMT/SMD, TDF/FBI, Lua, BOS/COB и
   их texture/script companions; common media/archive codecs переиспользуются через contracts.
9. Static Lua inspector никогда не исполняет файл. Effective-definition/runtime evaluation идёт
   только в отдельном sandboxed provider с permissions, budgets и provenance.
10. Создать named-game `beyond-all-reason` с real discovery/mount. Spring/Recoil остаётся
    engine/content extension; generic `spring` или `recoil` game codec без install signatures
    запрещён.
11. BAR art с CC-BY-NC-ND доступен только read/display: никакого art writer/repack. Разрешённые
    Lua/data authoring operations и GPL boundaries декларируются отдельно.

**Общий exit gate:**

- ни одна priority contribution не остаётся в `extensions/mk2`;
- каждый реально встреченный формат выбранных corpora имеет usable declared operation либо
  доказанное `not-applicable-to-version`; требуемый workflow нельзя закрыть `unsupported`;
- Warzone last-wins и Spring first-wins VFS semantics проверены на real corpora;
- S3O/maps/PIE companions разрешаются общим host resolver без format branch;
- `ports:check`, `priority:check`, license/import guards и real-corpus parity зелёные;
- весь неприоритетный long tail остаётся видимым `deferred-post-ga` для блока 30.

### Блок 18. Модульная 3D-вертикаль

**Зависит от:** UVM writer и зрелых model contributions.

**Результат для пользователя:** common models и модели SC2, трёх C&C, Warzone и BAR отображаются
одинаково в Electron, VS Code и PWA, а headless conversion не тянет renderer.

**Работа:**

1. Renderer-neutral scene/model contracts в SDK.
2. Optional WebGL/Three/headless renderer contributions.
3. Materials, textures, skeletons, animations, attachments, LOD и collision planes по provenance.
4. Game-specific scene adaptation остаётся в extensions.
5. Lazy resource loading, budgets, cancellation и missing-resource states.
6. Golden image/scene metrics на real fixtures с допустимой platform tolerance.
7. Проверить UVM/glTF/OBJ и реальные M3, W3X, PIE, S3O; W3D/VXL остаются retained regression
   fixtures до post-GA depth.
8. Viewer embed, workbench preview и headless export используют один model pipeline.

**Exit gate:**

- renderer может быть удалён без поломки inspect/convert;
- no renderer modules в minimal/headless bundles;
- M3, W3X, PIE и S3O real scenes визуально и семантически проверены;
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

**Результат для пользователя:** каждый priority workflow доступен через подходящий product
profile; старый modkit больше не нужен для ежедневной работы в выбранном контуре.

**Работа:**

1. Закрыть CLI, Electron, PWA, server и automation-host строки registry.
2. Проверить command/runtime/session contracts между всеми apps.
3. Закрыть converters, generators, diagnostics, marketplace/update и external-tool adapters.
4. Проверить install/update/uninstall extension lifecycle и corrupt extension quarantine.
5. Проверить permission denial, cancellation, restart и crash recovery.
6. Собрать signed/reproducible RC artifacts и SBOM/license notices.
7. Опубликовать migration report с zero unexplained priority gaps и отдельным неизменённым
   post-GA backlog.

**Exit gate:**

- `pnpm check` плюс новые migration/profile/parity gates зелёные;
- все reference bundles в budget;
- live matrix на поддерживаемых OS/hosts зелёная;
- нет semantic code, уникального только для одного app;
- deferred extensions не входят в official presets и не активируются неявно;
- RC можно установить на чистую машину по документированной инструкции.

### Блок 21. Modkit MK3 Focused Product GA

**Зависит от:** зелёного RC.

**Результат:** готовый самостоятельный Modkit MK3 для authoring, анализа, конвертации и IDE
simulation в зафиксированном priority closure.

**Работа и gate:**

1. Владелец работает не менее семи последовательных дней в MK3, не открывая старый modkit для
   priority-продуктовой операции.
2. Любое обращение к legacy фиксируется новой capability gap и сбрасывает dogfood clock после
   исправления.
3. Release artifacts устанавливаются, обновляются и откатываются.
4. Documentation, extension authoring guide и troubleshooting проверяются с чистого окружения.
5. Product GA tag создаётся только при zero missing/blocked/unexplained partial в priority scope,
   нуле priority units в `mk2` и зелёном baseline всех `deferred-post-ga`.

Legacy repo после этого остаётся опечатанным и доступным как read-only oracle: он содержит
неперенесённый long tail и не архивируется до блока 31.

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

### Блок 23. Neutral definition layer и четыре независимые экосистемы

**Зависит от:** блоков 15–17 и 22.

**Результат для пользователя:** SC2, SAGE (TW/KW/RA3), Warzone 2100 и Spring/BAR преобразуются в
один нейтральный definition/world contract без потери provenance.

**Работа:**

1. Стабилизировать UVD/rules/mechanics schemas до engine API.
2. Генерировать TypeScript types и Rust structs из одних schemas.
3. Реализовать SC2 catalog → UVD adapter.
4. Реализовать C&C data → UVD adapter без SC2-specific branches в neutral core.
5. Реализовать Warzone data/map → UVD/UVW и Spring/BAR definitions/map → UVD/UVW adapters без
   веток выбранных игр в neutral core.
6. Определить identity, references, inheritance/composition, units, weapons, abilities, effects,
   resources и upgrades.
7. Поддержать AOT artifact и live MK3 adapter; результаты должны быть эквивалентны.
8. Добавить provenance/loss receipts и unknown extension preservation.

**Exit gate:**

- четыре ecosystem corpora и все три SAGE dialects проходят одну validation suite;
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
7. Добавить deterministic proof scenarios для SC2, SAGE, Warzone и BAR-derived content; точный
   supported mechanics subset публикуется по игре и не называется полной эмуляцией native engine.

**Exit gate:**

- Node и browser дают одинаковые state/event/replay hashes;
- restore сохраняет scripts, timers, AI state и RNG;
- proof game запускается из AOT package и live MK3 session;
- по одному сценарию каждой priority ecosystem даёт одинаковый AOT/live state hash;
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

### Блок 29. Modkit MK3 + Multiverse 1.0 Focused GA

**Зависит от:** всех предыдущих exit gates.

**Результат:** готовый Modkit MK3 и независимый Multiverse 1.0 полностью закрывают выбранный
priority closure; неприоритетный хвост остаётся совместимым и явно запланированным.

**Финальная приёмка:**

1. Priority registry не содержит недопустимых состояний; post-GA строки имеют owner, baseline и
   planned slice.
2. Все legacy source units сопоставлены semantic capabilities и evidence.
3. Все product profiles проходят capability matrix.
4. Priority real-corpus differential suites не содержат необъяснённого poorer; global baseline
   всех deferred contributions зелёный.
5. UV core profile проходит read/write/validate/round-trip.
6. SC2, три C&C, Warzone и BAR проходят native→UV AOT/live paths; по одному опубликованному
   deterministic scenario каждой ecosystem проходит runtime path.
7. TypeScript runtime детерминирован между Node/browser; Rust boundary проходит conformance.
8. Play-in-editor, headless server, replay/restore и agent budget proofs зелёные.
9. MK3 и Multiverse устанавливаются, обновляются и собираются отдельно.
10. Владелец проходит недельный priority-сценарий без обращения к legacy продукту.

Legacy repo после этого **не архивируется**: он остаётся read-only oracle для блока 30.

### Блок 30. Post-GA migration waves

**Зависит от:** стабильных MK3 и Multiverse 1.0 releases.

**Результат:** весь неприоритетный codec/game/tooling long tail переносится на уже готовую
архитектуру без риска затормозить её создание.

**Метод:**

1. Генератор сортирует `releaseTrack: post-ga` по dependency fan-in, пользовательской ценности и
   доступности real corpus; Relic — первый подтверждённый slice.
2. Slice содержит 3–5 связанных capabilities одного owner и заканчивается implementation,
   operation-specific evidence, real differential, app/profile proof и удалением временного пути.
3. RA2/TS VXL/HVA/PAL, Generals/Zero Hour, Relic и остальные families получают собственные game/
   format boundaries; нельзя расширять priority game profile чужим dialect.
4. `ports:check` и global baseline работают непрерывно; `mk2` ratchet уменьшается только после
   evidence. `deferred-post-ga` нельзя переименовать в done или удалить из generator.
5. Legacy oracle не меняется; новый реально обнаруженный workflow добавляется в inventory и
   получает slice.

**Exit gate:**

- ноль `deferred-post-ga`, missing, blocked, unknown и unexplained partial в полном registry;
- все 237 legacy manifest units и owner additions сопоставлены реализованным/replaced workflows;
- `extensions/mk2` пуст;
- global real-corpus parity не содержит необъяснённого `X3 poorer`.

### Блок 31. Legacy Migration Complete

**Зависит от:** блока 30 и глобального release candidate.

**Конечный результат программы:** Modkit MK3 полностью заменяет legacy authoring/tooling без
функциональных регрессий, Multiverse остаётся независимым runtime, а старый продукт больше не
является единственным рабочим путём ни для одной возможности.

**Финальная приёмка:**

1. Полный registry не содержит недопустимых состояний и проходит E4/E5 по критичности.
2. Все writers проходят validate→write→reopen→compare и опубликованную loss policy.
3. Все apps/profiles, minimal closures, security, licensing, install/update/recovery и corpus gates
   зелёные.
4. Владелец проходит финальный недельный сценарий по репрезентативному global workflow без
   открытия legacy продукта.
5. Oracle descriptor и migration reports архивируются с release; repository не удаляется и
   история не переписывается.

Только после этого legacy repo переводится из `oracle` в `archive`.

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
pnpm priority:check        # после блока 10; strict для выбранного closure
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

До блока 31 `check:mk2` охраняет baseline и запрещает priority units в staging; только блок 31
требует физическое `mk2 == 0`.

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

### 9.1. Modkit MK3 Focused Product GA

- [ ] Legacy oracle опечатан и воспроизводим.
- [ ] Source inventory охватывает весь legacy surface, включая 206 codec и 31 game manifests.
- [ ] Generated priority closure охватывает Common 74, SC2, TW/KW/RA3, Warzone и Spring/BAR со
      всеми transitive dependencies.
- [ ] Priority registry не содержит missing/blocked/unknown/unexplained partial; deferred строки
      имеют owner, baseline и post-GA slice.
- [ ] Ни одна priority contribution не остаётся в `extensions/mk2`.
- [ ] Нет необъяснённых priority poorer rows; global deferred baseline не регрессировал.
- [ ] Priority writers проходят round-trip и loss policy; read-only design объявлен честно.
- [ ] Все шесть apps используют общие domain operations.
- [ ] Host differences представлены capability gating, а не расхождением семантики.
- [ ] Minimal profiles не выросли от optional функций.
- [ ] VS Code, Electron, PWA, CLI, server и automation live/contract matrix зелёная.
- [ ] Common Documents, SC2, три C&C, Warzone и BAR workflows E5 на реальных corpora/hosts.
- [ ] 3D viewer модульный и не входит в headless closure.
- [ ] SC2 simulation работает в IDE/headless с deterministic restore.
- [ ] Package catalog равен 7+2, minimal runtime closure — `core+sdk+vfs+host`.
- [ ] Developer scaffold и документационные примеры компилируются в CI.
- [ ] Установочный/обновительный/recovery путь проверен.
- [ ] Семидневный priority dogfood MK3 завершён.

### 9.2. Multiverse

- [ ] Репозиторий собирается без Modkit.
- [ ] UV Foundation и core schemas имеют единственного владельца.
- [ ] UVM/UVT/UVD/UVW/UVS/UVR/UVP/UVE имеют operation-specific conformance.
- [ ] Core profile имеет readers, writers, validators и round-trip.
- [ ] SC2, SAGE, Warzone и Spring/BAR adapters проходят одну neutral suite.
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

### 9.3. Legacy Migration Complete

- [ ] Полный semantic registry не содержит missing/partial/blocked/unknown/deferred-post-ga.
- [ ] Каждая superseded capability имеет проверенный replacement workflow.
- [ ] `extensions/mk2` пуст.
- [ ] Нет необъяснённых poorer rows на полном synthetic и real corpus.
- [ ] Все legacy writers/workflows перенесены или имеют доказанную лучшую замену.

### 9.4. Retirement старого modkit

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
4. завершить уже принятые W3D/VXL regression slices, а priority depth направить в M3 и W3X;
5. перейти к oracle lock, generated migration registry и exact priority closure блока 10;
6. первым implementation slice после registry выполнить Common Documents блока 11, не Relic.

Это минимальный путь, который одновременно даёт полезный результат сейчас и не теряет управляемость
полного перехода.
