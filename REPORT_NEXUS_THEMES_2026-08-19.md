# OPUS-UI-01 — `nexus-forge` and `nexus-dominion` as installable themes

Дата: 2026-08-19. Исполнитель: Opus. Запрос: `REQUEST_OPUS_UI_01_2026-08-19.md`.
Основание: `REPORT_NEXUS_UI_ADAPTATION_2026-08-19.md` (§3 маппинг, §4 решения, §5 план), R-1
закоммичен в `78ad63c`.

## 0. Коротко

| пункт                                    | статус                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `assets/themes/nexus-forge/theme.css`    | готово, 79 токенов при 73 обязательных                                    |
| `assets/themes/nexus-dominion/theme.css` | готово, 79 токенов при 73 обязательных                                    |
| Electron picker + selftest               | готово (`apps/electron/src/renderer.ts`, только список и строки selftest) |
| Живое доказательство                     | обе темы в реальном Electron-воркбенче и в PWA, скриншоты ниже            |
| `pnpm themes:check`                      | **3 полные темы** под контрактом v1                                       |
| байт из `NexusForgeUI/`                  | ноль — ни разметки, ни `support.js`, ни inline-стилей, ни внешних URL     |

Одна находка требует решения владельца до того, как темы станут «полными» в Electron: **шелл
Electron не рендерит часть `workbench`** (§4.1). Тема это обходит, но обход стоит убрать.

## 1. Что именно сделано

### 1.1 Токены (tier 1/2 + один tier 3)

Каждая тема объявляет все 73 обязательные appearance-роли контракта v1 плюс `--mk-font-sans`,
`--mk-font-mono`, три радиуса и `--mk-tree-row-height: 24px`. Значения — из §3 отчёта об
адаптации; производные роли (`-fg`, `-bg`, `-border` у статусов, `fg-disabled`, `hover`,
`active`, `match-highlight`, диффы, оси, графы, categorical-рамп) выведены от них и названы в
комментариях там, где вывод не очевиден.

Три решения, которые стоит знать при чтении файлов:

1. **`surface` несёт альфу (`e6`).** В дизайне панели полупрозрачны и сквозь них видно
   фон-декор; без альфы вся идея «панели плавают над подсвеченной землёй» пропадает. `overlay`
   (меню, поповеры) при этом полностью непрозрачен — меню, сквозь которое видно сетку, читать
   нельзя.
2. **Радиусы обнулены.** Язык дизайна квадратный: форма приходит от срезанных углов
   (`clip-path`) и от 2-пиксельных кромок, которые появляются только у активного элемента.
3. **`accent-muted` + `accent-muted-fg` — это и есть основная кнопка.** В дизайне primary —
   не заливка с инверсным текстом, а _подложка_ со светлым текстом и полупрозрачной кромкой.
   Роль `accent-muted-fg`, добавленная в R-1, здесь используется по прямому назначению.

### 1.2 Декор

Слои и скорости (каждый — только градиенты, анимируется только `background-position`/`transform`):

| слой                         | Forge               | Dominion                              |
| ---------------------------- | ------------------- | ------------------------------------- |
| земля (радиальная подсветка) | элемент `workbench` | элемент `workbench` + два блума, 21 с |
| сетка 64 px                  | `::before`, 9 с     | `::before` вместе с гекс-сеткой, 18 с |
| гекс-меш                     | —                   | `::before`, 3 повторяющихся градиента |
| скан-полоса + сканлайны 3 px | `::after`, 11 с     | `::after`, 11 с                       |

`::before` получает `z-index: -1`, `::after` — `0`, а сам `workbench` — `isolation: isolate`.
Это и есть весь фокус: земля и сетка обязаны быть **под** панелями (они просвечивают сквозь 90 %
непрозрачности), а скан и сканлайны — **над** ними. Изоляция не даёт отрицательному слою уехать
в чужой контекст наложения.

Блумы Dominion в дизайне сделаны двумя `div`'ами с `filter: blur(60px)`. Здесь это радиальные
градиенты с мягкой границей: картинка та же, а полноэкранный `filter` перерисовывал бы всё под
собой на каждом кадре — ровно то, чего фоновый декор делать не должен.

### 1.3 Декорация частей

Только публичный `data-mk-part`, ни одного внутреннего класса компонента:

- `titlebar` / `workbench.titlebar` — градиент заголовка, акцентная кромка снизу, mini-caps;
  `titlebar.menu-item` — трекинг, 2 px кромка у открытого меню; `titlebar.menu-panel`,
  `titlebar.menu-entry`; `titlebar.button` — фаска 7 px, деструктивный ховер у `close`.
- `workbench.activitybar` — градиент и правило справа.
- `workbench.sidebar` / `explorer.sidebar` — полупрозрачная подложка.
- `filetree.row` — отступные направляющие поверх `--mk-tree-indent-level`, ховер,
  2 px ведущая полоса выделения; `filetree.badge` — акцент.
- `explorer.tabstrip` / `explorer.filetab` — срез 12 px по задней кромке, 2 px верхняя кромка у
  активной вкладки, ромбовидная точка вида, mini-caps; `explorer.tab`.
- `operations.button`, `explorer.action`, `settings.add/remove`, `transport.button` — фаска 9 px,
  подложка-акцент, sweep по ховеру, инверсия по ховеру/нажатию.
- `search`, `search.input`, `settings.input/select`, `explorer.viewpicker`, `viewpicker.select` —
  утопленные поля, акцентная кромка в фокусе.
- `settings.group` (+`selected`), `settings.pane`, `settings.groups`.
- `workbench.statusbar`, `explorer.status`, `shell.footer`, `shell.status-item`.
- `metadata.heading` / `metadata.label` / `metadata.value`, `accordion.title`, `card.title/subtitle`.

### 1.4 Шрифты

`@font-face` для Saira (latin, latin-ext) и JetBrains Mono (latin, latin-ext, cyrillic,
cyrillic-ext) по сниппету из `assets/fonts/README.md`, `font-display: swap`, пути только
`./fonts/…`. Стек `font.sans` держит системное семейство после Saira — у Saira нет кириллицы.
Проверено в обоих хостах: `getComputedStyle(document.body).fontFamily` начинается с `Saira`,
консоль без ошибок загрузки.

## 2. Живое доказательство

Способ: `playwright-core` (уже в devDependencies) поднимает настоящее приложение — Electron
через `_electron.launch('electron/main.cjs')` и PWA через собранный `dist-app` на
`http://localhost:8732/?open=./favicon-32.png`. Тема ставится атрибутом, как это делает
`applyTheme`, затем снимается кадр 1440×900.

Скриншоты закоммичены рядом с темами:

| тема             | Electron                                            | PWA                                            |
| ---------------- | --------------------------------------------------- | ---------------------------------------------- |
| `nexus-forge`    | `assets/themes/nexus-forge/preview-electron.jpg`    | `assets/themes/nexus-forge/preview-web.jpg`    |
| `nexus-dominion` | `assets/themes/nexus-dominion/preview-electron.jpg` | `assets/themes/nexus-dominion/preview-web.jpg` |

Измерено в живом Electron (оба прогона, значения совпали с ожидаемыми):

```text
nexus-forge     accent #b6f04a  font Saira  decor mk-forge-grid / mk-forge-scan
                tabClip polygon(0px 0px, 100% 0px, …)  tabDot polygon(50% 0px, 100% 50%, …)
                buttonClip polygon(9px 0px, …)  rowHeight 24px  status rgb(14,20,23)
nexus-dominion  accent #f0a02a  font Saira  decor mk-dominion-mesh / mk-dominion-scan
                buttonClip polygon(9px 0px, …)  rowHeight 24px  status rgb(16,27,36)
```

Selftest Electron (`--open <dir> --selftest`), новые строки:

```text
selftest: theme nexus-forge accent #b6f04a (expected #b6f04a, ok) decor mk-forge-grid
selftest: theme nexus-dominion accent #f0a02a (expected #f0a02a, ok) decor mk-dominion-mesh
selftest: sheets=[modkit-ui.css, renderer.css, theme-nexus-dominion.css, theme-nexus-forge.css, theme-sc2.css, inline]
```

PWA: те же две темы линкуются сборкой автоматически (ни строчки в build-скриптах не тронуто),
`--mk-color-accent` переключается, декор висит на `workbench::before/::after`, ошибок в консоли
нет.

### 2.1 Движение и отсутствие двойного слоя — измерено, а не заявлено

`themes:check` проверяет только _наличие_ блока `prefers-reduced-motion`. Что он работает,
проверено отдельным прогоном с эмуляцией предпочтения:

```text
no-preference  forge     ::before mk-forge-grid 9s infinite   ::after mk-forge-scan 11s infinite
no-preference  dominion  ::before mk-dominion-mesh 18s        ::after mk-dominion-scan 11s
                         элемент  mk-dominion-blooms 21s
reduce         обе темы  каждая длительность 0.001s, iteration-count 1
```

Там же проверено, что запасной якорь не удваивает декор: пока в документе есть
`[data-mk-part='workbench']`, `body::before` и `body::after` не анимируются вовсе
(`animation-name: none`) — селектор `:has()` их гасит. В Electron, где части `workbench` нет,
всё наоборот: анимация оказывается на `body::before` (`mk-forge-grid` / `mk-dominion-mesh`).

## 3. Что парты не достали — и что для этого нужно

Три вещи из дизайна не выражаются сегодняшним словарём. Ни одну я не стал делать через
внутренности компонентов; ниже — что именно просить.

### 3.1 У Electron нет части `workbench` (**блокирует чистое решение**)

`apps/electron/src/renderer.ts` строит свой шелл: `div.modkit-shell` → `createTitleBar` +
`div.modkit-body` + `footer.modkit-footer`. `createWorkbench` из `packages/ui/src/workbench`
использует только PWA. Значит `[data-mk-part='workbench']`, на который запрос просит повесить
декор, в Electron просто нет, и `.modkit-shell` — это класс компонента, а не парт.

Обход в теме: тот же декор продублирован на `body:not(:has([data-mk-part='workbench']))`. `:has()`
гарантирует, что два якоря никогда не рисуют одновременно, так что как только Electron получит
часть `workbench`, правило само перестанет срабатывать — удалять ничего не придётся.

Цена обхода: на `body` декор лежит **над** содержимым (z-index 0, `pointer-events: none`), а не
под ним, как в PWA. Для сетки в 3 % белого и сканлайнов это незаметно, но это не то же самое.

**Просьба:** дать шеллу Electron часть `workbench` (либо перевести его на `createWorkbench`, либо
проставить `setPart(shell, 'workbench')` и парты на `body`/`footer`). Это `apps/electron` +
`packages/ui` — вне моей области.

### 3.2 У вкладки нет вида файла

В дизайне точка у вкладки окрашена по виду файла (`acc`/`info`/`alt`/`warn`). `explorer.filetab`
не несёт ни `data-mk-kind`, ни чего-либо эквивалентного (`editors.ts` ставит только `role="tab"`
и `title`), так что тема не может знать вид. Точка сделана и меняет цвет по `selected`.

**Просьба:** `data-mk-kind` (или `data-mk-format`) на `explorer.filetab` — одна строка в
`packages/ui/src/explorer/editors.ts`, и точка станет тем, чем задумана.

### 3.3 Monaco берёт цвета один раз

`extensions/common/ui-monaco/src/index.js` вызывает `defineTheme(root)` в момент создания
редактора: значения читаются из CSS-переменных тогда же. Переключение темы на лету не
перекрашивает уже открытые редакторы — в первом прогоне скриншота код-панель осталась в цветах
`sc2` (`#0b1e39`), хотя весь остальной шелл был в Forge. Открытие следующего файла переопределяет
именованную тему `modkit` и чинит всё сразу.

Это не дефект темы и не регрессия: так было и с `sc2`. Но пользователь, меняющий тему при
открытых вкладках, увидит рассинхрон.

**Просьба:** переопределять тему Monaco в `onAppearance` (или подписаться на смену
`data-mk-theme`). Это `extensions/common/ui-monaco` — вне моей области.

### 3.4 Мелочи, зафиксированные без просьбы

- **`background` шорткат в `chrome.css` съедает геометрию направляющих.** Базовое правило
  выделенной строки — `background: var(--mk-color-selection)`, шорткат, который сбрасывает
  `background-size/repeat/position`. Тема добавляет `background-image` слоем выше, и без
  повторного объявления трёх лонгхендов направляющие расползались полосами по всей выделенной
  строке (поймано на скриншоте, исправлено; в обоих файлах над этим местом стоит комментарий).
  Базовый CSS чинить не нужно — но следующий автор темы наступит на это же.
- **Заголовок 52 px, `▶ RUN`, часы, док-инспектор** — структура воркбенча, не тема (§4.1
  отчёта об адаптации). Не трогал.
- **`paper*`/`deskBg`** — ждут документного вьюера (O-2).

## 4. Гейты

- `pnpm themes:check` — `nexus-dominion: 79/73 ok`, `nexus-forge: 79/73 ok`, `sc2: 76/73 ok`,
  **3 installable theme(s) complete**.
- `pnpm tokens:check`, `pnpm format:check`, `pnpm lint` — чисто по моим файлам.
- `pnpm check` целиком — см. §6.

## 5. Файлы

Новые:

- `assets/themes/nexus-forge/theme.css`, `assets/themes/nexus-dominion/theme.css`
- `assets/themes/nexus-*/preview-electron.jpg`, `assets/themes/nexus-*/preview-web.jpg`
  (доказательство из §2; ~490 КБ на четыре кадра — если это лишний вес в дереве, скажите, уберу)
- этот отчёт

Изменённые:

- `apps/electron/src/renderer.ts` — две строки в списке `themes` и блок selftest
- `IMPLEMENTATION_NOTES.md` — запись
- `apps/{electron,web}/dist-app/index.html` + `theme-nexus-*.css` — вывод сборки, линкующий
  новые темы (build-скрипты не тронуты, они сами подхватывают каталог)

Байтов из `NexusForgeUI/` в дереве нет: значения палитр и рецепт декора переписаны в CSS, а
разметка, `support.js`, `image-slot.js` и Google Fonts не использованы.

## 6. Состояние `pnpm check`

Полный `pnpm check` **красный на одном файле, и это не мой файл**: `pnpm format:check` падает на
`docs/MK3/adr/ADR-HOST-002-binary-editing-on-the-13d-seam.md` — untracked-ADR соседнего слайса S8
(«binary editing on the 13D seam»), появившийся в дереве во время этой работы. `docs/**` вне моей
области, поэтому я его не форматировал и в коммит не включал; лечится одним
`prettier --write` вместе с тем слайсом.

Всё остальное в цепочке прогнано и зелёное:

- `pnpm build` (`catalogs:check` → `typecheck` → `bundle`) и `pnpm bench:universal:gate`.
- `pnpm lint` — чисто по всему репозиторию.
- `pnpm format:check` — чисто везде, кроме упомянутого чужого ADR.
- `pnpm test` — прогнан трижды; результаты нестабильны **из-за соседнего слайса**, не из-за тем:
  соседний процесс переписывает `node_modules` и `packages/*/dist` во время прогона, и часть
  файлов падает на `Failed to load url ajv/dist/runtime/ucs2length.js` (импорт есть в HEAD,
  файл на месте, `require.resolve` из `packages/sdk` отрабатывает — ломается только симлинк во
  время `pnpm install`). Что проверено точечно и чисто:
  `packages/ui + apps/electron + apps/web` — 97/98, единственный сбой (`browser-e2e`, editing,
  таймаут 5 с под нагрузкой) в одиночном прогоне даёт 12/12; `mk2-acceptance` — 7/7.
  Темы — это CSS плюс список в пикере и строки selftest; на резолв модулей они повлиять не могут.
- `schemas:check`, `manifests:check`, `tokens:check`, `themes:check`, `icons:check`,
  `facilities:check`, `apps:check`, `check:legacy`, `check:imports`, `check:extensions`,
  `check:mk2` — все OK.

**Владельцу:** отформатируйте ADR слайса S8, и цепочка снова зелёная целиком; мой коммит трогает
`assets/themes/nexus-*/**`, `apps/electron/src/renderer.ts`, вывод сборки обоих приложений,
`IMPLEMENTATION_NOTES.md` и этот отчёт.
