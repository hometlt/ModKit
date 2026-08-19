# План Fable (Root) после S7 / R‑1 — следующие шаги (2026‑08‑19)

Baseline: HEAD `61ebf6e` на `spec/mk3-extension-reference`. Полный `pnpm check` зелёный
(83 файла / 694 теста + 2 сетевых tarball‑теста, все гейты, `themes:check` включён). Дерево
чистое (кроме чужого `NexusForgeUI/`, он вне lint/format намеренно). Документ подчинён
`docs/MK3/09-development-roadmap.md` §14 (там — канонический список этапов) и ничего в нём не
переписывает: здесь — порядок, границы, критерии «готово» и кто что делает.

## 0. Что приземлилось с прошлого плана (18 → 19 августа)

| слайс  | коммиты                         | что                                                                                                                                                                                                             |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1–S4  | до `dbeeab8`                    | worker backend в корнях, протокол 1.1, сигнатуры + probe‑grant, Electron IPC → capability‑RPC (подробно в IMPLEMENTATION_NOTES)                                                                                 |
| S5/S5b | `dbeeab8`                       | browser worker backend: verify‑then‑snapshot, DOM‑обвязка, `worker-entry`                                                                                                                                       |
| S6     | `91de3da`, `3e87181`            | продуктовый путь PWA: аттестованный каталог, vendor‑бандлы worker'а, `createWebSubjectServices`, `?open=`; PNG открыт вживую в Chromium worker‑brokered                                                         |
| S7     | `a54d408`, `2239c4e`, `f6c01fa` | один билдер `createSubjectServices`/`createNodeSubjectServices`, `openFileArtifactSource`, `modkit open`, `subjects.open` у server/automation; private record inventory едет на объекте (кросс‑entry честность) |
| UI     | `7dfa3bd`, `78ad63c`            | отчёт по NexusForgeUI (инвентарь 18 экранов, карта на токены/части), R‑1: `color.accent-muted-fg`, гейт `themes:check`, шрифты в `assets/fonts`, хосты раздают темы + шрифты                                    |
| Opus   | `042dc55` (принят в `61ebf6e`)  | OPUS‑MK2‑02: долг как данные, rework‑дерево (123/35/351), сигнатуры контейнеров, синтетический корпус, 15 портов; решения Root — §12 отчёта                                                                     |

Очередь Opus готова к выдаче: `REQUEST_OPUS_UI_01_2026-08-19.md` (темы Nexus — первым),
`REQUEST_OPUS_MK2_03_2026-08-19.md` (волна 2 портов — параллельно с S8).

## 1. Инварианты (не меняются)

- Никаких импортов из `modkitx` (соседний репозиторий только читаем); пакеты `@modkitx-x3/*` не
  публикуются; `NexusForgeUI/` не трогаем; слово `capability` не бывает ключом (legacy‑gate);
  управляющих байтов в исходниках нет; wire‑домен `x3.host/rpc`.
- Граница исполнения честная: gate отказывает, не понижает; `worker-brokered` — изоляция сбоев,
  не sandbox (SB‑1 всегда в диагностиках); `trusted-in-process` только по явному
  `allowTrustedInProcess` артефакта.
- Темы — только стили на токенах и публичных `data-mk-part`; `VIEWER_CSP` неизменен
  (`style-src-attr 'none'`, `font-src 'self'`); новая тема = каталог в `assets/themes`, сборки
  её подхватывают сами.
- Дерево `extensions/mk2/**` — импорт‑инвентарь, не продуктовый; продукт = `extensions/common` +
  явные установки; промоушен — отдельный шаг на кодек.
- Коммиты: Root коммитит свои слайсы только своими путями; Opus — в своих границах и только на
  зелёных гейтах, Root смотрит diff и фиксирует решения в отчёте Opus (§12‑стиль).

## 2. Последовательность Root (S‑шаги) и критерии «готово»

### S8 — 13D для бинарных представлений: семейство контрактов `write`/`edit` (следующий; ≈ 2–3 дня)

Зачем: 33 кодека MK2 упираются в `write`, 12 — в `edit` (в том числе `bmp/gif/tar/gzip` волны 1).
Контракт кодека v1 read‑only намеренно (BRIEF‑13A acc. 19), но кирпичи уже есть: класс разрешений
`write-source`, facility `filesystem.atomic-replace`, `operations[].mutatesSource`, 13D edit‑сессии
для текста (`createEditSession`, `createCommitCoordinator`), revision‑pinned файловый адаптер S7.

1. **ADR‑HOST‑002 «writer/edit для бинарных представлений»** (`docs/MK3/adr/`): кодек объявляет
   операции с `mutatesSource: true` и поставляет writer‑arm сессии (`encode(representation,
options) → bytes | patch`); хост владеет коммитом — grant класса `write-source`, источник
   pinned по ревизии (S7 уже отказывает при её смене), `filesystem.atomic-replace`,
   plan/prepare/commit через существующий coordinator; отказы — `x3.host/write-refused` с причиной;
   запись только через atomic‑replace; worker‑brokered writer получает байты и возвращает байты
   (никакого FS в worker'е).
2. **SDK**: ABI‑surface `x3.abi/asset-writer@1` по правилам ADR‑HOST‑001 (method surface,
   `has[]` для optional), поле spec `write` (`replace` | `patch`, ограничения, `maxOutputBytes`),
   схема + `schemas:check`.
3. **Host**: коммит‑путь в `editing.ts` (write — операция сессии под грантом, intent не меняется),
   surface registry, conformance‑кейсы kit'а для writer‑arm через границу (как acc‑12 для чтения).
4. **codec‑kit**: хелпер `defineWriter` (один файл, как порты).
5. **Конвертер MK2**: `write → mutatesSource + write-source`; `edit` — только там, где контракт
   покрывает, иначе по‑прежнему `needs new contract` с точной причиной.
6. **Доказательство**: `gzip` и `tar` из синтетического корпуса волны 1 — re‑encode под
   `write-source`, коммит atomic‑replace, повторное открытие даёт те же структуры; отказ без
   гранта; отказ при смене ревизии; worker‑brokered путь.

Готово: ADR + схема + kit‑кейсы + оба доказательства зелёные; `check:mk2` пересчитан; в
`REPORT_MK2_*` счётчик `needs new contract` уменьшился ровно на покрытое.

### S9 — RPC‑поверхность сервера поверх `subjects.open` (≈ 1 день)

`x3.app/subject-services@1` как у Electron (`open` → снапшот, `attach` → сессия как handle
`x3.abi/asset-session@1`) над любым `framePort` (MessagePort / WebSocket‑адаптер через
существующий `message-port.ts`), без HTTP‑фреймворка; `createServerApp` получает
`exposeSubjectRpc(port)`. Готово: kit зелёный на серверной паре портов, один e2e в Node.

### S10 — Семейства контрактов для остальных «needs new contract» (по ADR на семейство)

Порядок по стоимости и пользе: **language** (кодеки с `languages`; после 13D) →
**runtime/launch** (`sign/provision/launch` — только как side‑effect операции под своим классом
разрешений) → **relations** (`references`) → **game** (31 игра; contribution kind + UVM runtime —
отдельный этап, не раньше VFS). Каждый ADR: словарь, ABI surface, схема, kit‑кейсы, маппинг
конвертера, одно доказательство на реальном или синтетическом файле. Следующее семейство не
начинается, пока предыдущее не разошлось по всем четырём хостам.

### S11 — VFS/container + bundle resolver (NXT‑200/201)

Namespace‑источники (каталог, архив, CASC) как `ArtifactNamespaceSource` в open‑пути;
маршрутизация по форме каталога (закрывает `casc`); companion/bundle rules из спецификаций.
Готово: архив открывается как namespace в трёх хостах; `casc` без `needsSignatures`.

### S12 — Мелкое, между слайсами (каждое ≤ ½ дня)

- `modkit open --bundled` (first‑party набор вне репозитория по генерируемому списку); только
  явные корни, без discovery.
- PWA: settings/theme picker как в Electron; precache тем и шрифтов в service worker.
- Conformance kit в реальном браузере — решить про Playwright как dev‑зависимость (§4.5), иначе
  остаётся Node‑прогон с фейками как доказательство.
- DEP0137 (FileHandle на GC) — найти незакрытый handle в тестах (проявляется только в полном
  прогоне; S7‑адаптер закрывает handle в `finally`).
- `process-brokered` (SB‑2/3) — только по своему gate, когда появится первый native codec
  внешнего publisher'а.

## 3. Очередь Opus (параллельно, свои границы)

| #   | запрос                | суть                                                                                                                                                                                                                                        | зависимость         |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | `REQUEST_OPUS_UI_01`  | темы `nexus-forge`/`nexus-dominion`: два stylesheet'а на токенах и частях, шрифты из `assets/fonts`, picker Electron, живые доказательства в Electron и PWA                                                                                 | нет (R‑1 приземлён) |
| 2   | `REQUEST_OPUS_MK2_03` | волна 2 портов без новых контрактов; правило «`src/<id>/` целиком человеку»; флаг `promotion` в `MK2-CONVERSION.json`                                                                                                                       | нет; параллельно S8 |
| 3   | UI‑02 (после UI‑01)   | новые поверхности D6 — `MapEditor`, `AnimEditor`, `FontsPreview`, `SlidesPreview`, `UiEditor` — на стандартных трейтах (`game.map`, `structure.timeline`, `font.*`, `presentation.*`); по вьюеру за запрос, когда есть кодек с этим трейтом | кодеки волн 2–3     |
| 4   | MK2‑04 (после S8)     | порты `write`‑кодеков (`bmp gif tar gzip …`) на контракте S8; документные кодеки с `document.*` data sources                                                                                                                                | S8                  |
| 5   | UX‑01 (висит)         | словарь состояний (`x3.host/worker-shared-process` и др.) в UI                                                                                                                                                                              | нет                 |

## 4. Решения, которые нужны от владельца (старт S8 не блокируют)

1. **Реальный корпус**: настоящие `.mp4/.webm/.ogg/.wav` (позже `.bmp/.gif/.tar/.gz`) в
   корпусную директорию harness'а — без них acceptance доказывает структуру, не fidelity.
2. **Кириллический компаньон для Saira** в стеке `font.sans` тем Nexus (у Saira нет кириллицы:
   кириллица падает в Segoe UI / system‑ui). Варианты: оставить / добавить OFL‑семейство с
   кириллицей (например `Play` или `Exo 2`) вторым в стеке.
3. **Раскладка Nexus**: высокий header 52 px с RUN/часами и докнутый инспектор — отдельный
   UI‑слайс со своими токенами (`shell.titlebar-height`, `shell.statusbar-height`,
   `workbench.inspector`) или остаёмся на текущем компактном шелле (моя рекомендация — остаться).
4. **Гранулярность внешних репозиториев расширений** (поток C у Opus) и **публикация
   `@modkitx-x3/codec-kit`** (npm / тарбол / иное) — блокирует только поток C.
5. **Playwright как dev‑зависимость** для браузерного прогона kit'а — да/нет.

## 5. Порядок слияния

1. Root: S8 по шагам (ADR → sdk → host → kit → конвертер → доказательство), `pnpm check` зелёный
   на каждом коммите.
2. Opus: UI‑01 → MK2‑03 (независимы от S8); Root ревьюит, принимает, решения — в отчёте Opus.
3. Root: S9 (server RPC) — можно вклинить между шагами S8, если Opus'у нужен сервер для проверки.
4. Root: S10 (language → runtime/launch → relations); Opus: MK2‑04 по мере появления контрактов.
5. Root: S11 VFS; затем game/UVM отдельным этапом.

## 6. Риски и как они закрываются

- **Семантика write в worker'е**: writer получает и возвращает только байты; FS и atomic‑replace —
  у хоста; без `write-source` операции нет на surface (feature detection через `has[]`).
- **Дрейф ревизии во время записи**: источник pinned (S7), коммит проверяет ревизию ещё раз перед
  replace; конфликт — отказ, не перезапись.
- **Копии host‑пакета в разных entry** (урок S7): любое новое module‑level состояние в
  `packages/host` — только через well‑known symbol на объекте или внутри одного пайплайна; тест на
  кросс‑entry в каждом таком случае.
- **Параллельная работа в одном дереве**: каждый слайс коммитится только своими путями; красный
  `pnpm check` сначала атрибутируется (чей слайс), потом чинится владельцем зоны.
- **Сеть в тестах**: два tarball‑теста ходят в registry — при `ENOTFOUND` перезапуск, не правка.
- **Дрейф рабочего каталога shell'а** (и у Opus, и у меня): перед `pnpm` — явный `cd` в корень.
