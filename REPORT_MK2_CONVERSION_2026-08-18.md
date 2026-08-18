# OPUS-MK2-01 — MK2 → MK3 converter, acceptance harness, pilot ports

Дата: 2026-08-18. Исполнитель: Opus. Запрос: `REQUEST_OPUS_MK2_CONVERTER_2026-08-18.md`.
Baseline: `6c235fa` (S5). Коммитов не делал — ниже список файлов, счётчики и находки.

`pnpm check` (полный) зелёный на каждом шаге: после A, после A+B+C, и на финальном прогоне.

**Дополнение 2026-08-19.** По решению Root выполнены пункты 1-4 из §9: правка `probe`-clamp в
codec-kit (§7.1), `extensions/mk2/*` в workspace (§7.8), `check:mk2` в цепочке `pnpm check`, и
коммит. Соответствующие места ниже отмечены «✔ сделано».

## 1. Что сделано

| задача                     | статус                                           | где                                                                                                                                        |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A — механический конвертер | готово                                           | `scripts/convert-mk2.mjs`, `scripts/lib/mk2-manifests.mjs`                                                                                 |
| A — тесты                  | готово (9 кейсов)                                | `scripts/test/convert-mk2.test.ts`, `scripts/test/fixtures/mk2/**`                                                                         |
| A2 — `--rework`            | готово, вывод **не закоммичен** (см. §6)         | тот же скрипт, флаг `--rework`                                                                                                             |
| B — acceptance-harness     | готово (3 кейса)                                 | `packages/testkit/src/mk2-acceptance.ts`, `packages/testkit/test/mk2-acceptance.test.ts`, `packages/testkit/test/fixtures/mk2-corpus.json` |
| C — 6 пилотных портов      | готово, все шесть открываются на реальных файлах | `extensions/mk2/*/src/*/codec.js`                                                                                                          |

### Файлы

Новые:

- `scripts/convert-mk2.mjs` — конвертер (A, A2).
- `scripts/lib/mk2-manifests.mjs` — общий парсер/анализатор MK2-манифестов.
- `scripts/test/convert-mk2.test.ts` + `scripts/test/fixtures/mk2/**` (5 inert фикстур + v1-контейнер).
- `packages/testkit/src/mk2-acceptance.ts`, `packages/testkit/test/mk2-acceptance.test.ts`,
  `packages/testkit/test/fixtures/mk2-corpus.json`.
- `extensions/mk2/**` — 272 файла: 34 расширения, 102 contribution-манифеста, 102 модуля,
  34 `package.json`, 34 `README.md`.
- этот отчёт.

Изменённые:

- `scripts/report-mk2-allocation.mjs` — переведён на общий парсер (единственное разрешённое
  изменение существующего скрипта). Вывод **побайтно тот же**: проверено
  `node scripts/report-mk2-allocation.mjs --out … && diff` против
  `REPORT_MK2_ALLOCATION_2026-08-17.md` — identical.
- `package.json` — алиас `convert:mk2` (согласовано в запросе) и, добавочным проходом,
  `check:mk2` в цепочке `pnpm check`.
- `pnpm-workspace.yaml`, `pnpm-lock.yaml` — `extensions/mk2/*` как workspace-члены (добавочный
  проход).
- `extensions/_shared/codec-kit/src/index.js` — `probe`-clamp (добавочный проход, §7.1).
- `packages/testkit/src/index.ts` — реэкспорт harness'а.

`modkitx` остался read-only: конвертер и harness только читают файлы; ни одного импорта из
`modkitx` в исходниках нет.

## 2. Счётчики конверсии (задача A)

`pnpm convert:mk2` (без `--rework`), источник `C:/FILES/SC2Files/coding/modkitx`:

- **102 кодека сконвертировано** из 103 `mechanical` (DoD «≥100» выполнен) → **34 расширения**,
  272 файла.
- 104 пропущено: 79 `needs new contract`, 24 `convertible with rework`, 1 `mechanical`
  (см. §5).
- **31 из 102** несут `spec.match.signatures` (реальный byte-compare в `probe`); у остальных
  71 в MK2 не было magic — их `probe` возвращает `confidence: 0` с TODO, а не выдуманную единицу.

По семействам (v1 `kind`):

| kind      | сконвертировано |        из mechanical |
| --------- | --------------: | -------------------: |
| image     |              31 |                   31 |
| archive   |              25 | 26 (`casc` пропущен) |
| model     |              20 |                   20 |
| video     |              12 |                   12 |
| audio     |              11 |                   11 |
| vector    |               3 |                    3 |
| **итого** |         **102** |              **103** |

Детерминизм: повторный прогон даёт `0 added, 0 rewritten, 0 removed (byte-stable)`;
`node scripts/convert-mk2.mjs --check` — clean. Форматирование делает prettier с конфигом
лаборатории, поэтому `pnpm format:check` и генератор не спорят по построению.

## 3. Acceptance-harness (задача B)

`packages/testkit/test/mk2-acceptance.test.ts` печатает таблицу; последний прогон:

```text
MK2 → MK3 conversion state
  converted 102
  probing   31  (spec declares byte signatures)
  opening   6  (hand-ported open())
  pending   96  (x3.mk2/port-pending)

  contribution      state    confidence  sample
  org.modkitx/webp  opened        0.990  -references/website/crossover/uploads/kane.webp
  org.modkitx/mp3   opened        0.950  -references/website/crossover/uploads/welcome-back-commander.mp3
  org.modkitx/glb   opened        0.990  -references/website/old-wiki/src/app/js-3d-model-viewer-master/original/duck.glb
  org.modkitx/mix   opened        0.800  -references/Mixer/ccmix/test_files/ts/tem.mix
  org.modkitx/svg   opened        0.950  -references/m3/packages/three-m3-loader/docs/favicon.svg
  org.modkitx/swf   opened        0.970  -references/old-modkit-ts/sc2/core.sc2mod/base.sc2data/ui/flash/gameui/ipistol.swf
```

Путь ровно продуктовый: `loadExtensionDirectory → buildInventory → openSubject` с
`TRUSTED_IN_PROCESS_EXECUTION_BACKEND` и байтовым источником через
`openFileSource → artifactByteSourceFromRandomAccess` (то есть настоящий host-мост, а не
tolerant-заглушка из теста). Ассерты на кейс: выбран нужный `contributionId`, confidence ≥ порога,
descriptor валиден (это делает `openSubject`), tree-dataSource отвечает на первый запрос,
`session.dispose()` отпускает лизы. Образцы читаются с диска `modkitx` **read-only** и никогда не
копируются; без соседнего checkout'а (или с `MODKITX_MK2_ROOT`, указывающим в никуда) все кейсы
дают `skipped`, тест остаётся зелёным — CI-safe.

Harness также проверяет негативные пути: отсутствующий образец → `skipped`, «выиграл не тот
кодек» → `failed` с текстом.

## 4. Пилотные порты (задача C) — и почему не тот список, что в запросе

**Список из запроса не сходится с отчётом об аллокации.** Из шести названных кандидатов
(`image/bmp`, `image/gif`/`ico`, `archive/tar`/`gzip`, `audio/wav`, `model/obj`, `document/…`)
**пять — `needs new contract`**: `bmp`, `gif`, `ico`, `tar`, `gzip`, `obj` заблокированы
capability `write` (13A read-only, нужен 13D writer). А у семейства `document` в mechanical-списке
**ноль** записей (0 mechanical / 13 rework / 4 needs-new). Единственный mechanical из списка —
`wav`, но в корпусе `modkitx` нет ни одного `.wav`-файла, так что acceptance над ним недоказуем.

Взял шесть mechanical-кодеков с реальными файлами в корпусе, по одному на семейство — покрытие
шире запрошенного (запрос давал 5 семейств, здесь 6):

| #   | contribution       | семейство | вместо       | что реализовано                                                                           |
| --- | ------------------ | --------- | ------------ | ----------------------------------------------------------------------------------------- |
| 1   | `org.modkitx/webp` | image     | `bmp`        | RIFF/WEBP chunk walk, canvas из VP8/VP8L/VP8X, кадры ANMF; raster-source без `readRegion` |
| 2   | `org.modkitx/mp3`  | audio     | `wav`        | пропуск ID3v2, валидация MPEG-кадра, подсчёт кадров и длительности; audio-media-source    |
| 3   | `org.modkitx/glb`  | model     | `obj`        | GLB 2.0 header + chunks, инвентаризация JSON-сцены; model-scene-source `metadata-only`    |
| 4   | `org.modkitx/mix`  | archive   | `tar`/`gzip` | оба классических layout'а MIX (TD и TS/RA2), namespace-entry-source по hash-именам        |
| 5   | `org.modkitx/svg`  | vector    | `document/…` | детект по корневому элементу, консервативная static-профилизация, vector-scene-source     |
| 6   | `org.modkitx/swf`  | video     | —            | signature/version/compression/declared length (ровно фидельность v1), video-media-source  |

Ничего SC2-специфичного не портировал. Единственный образец из SC2-контента — `.swf` для пилота
№6: формат Adobe, а не SC2, но других `.swf` в корпусе нет (см. §7.9).

Все шесть используют **сгенерированный манифест без правок** — это и есть доказательство
конвейера: механический envelope достаточно хорош, чтобы открыть реальный файл. Хендпорты трогают
только `src/<id>/codec.js`; конвертер их не перезаписывает и не считает дрейфом (маркер
`@generated by scripts/convert-mk2.mjs` пропал — значит, у файла появился человек-владелец).

## 5. Unmappables — по причинам

### 5.1 `needs new contract` — 79 (пропущены, заглушек нет)

Причины (одна карточка может иметь несколько):

| штук | блокер                                                                           |
| ---: | -------------------------------------------------------------------------------- |
|   34 | `testedGames` — evidence без поля в codec-spec (game-плоскость отсутствует в X3) |
|   33 | capability `write` — X3 v1 read-only, нужен 13D writer/service contract          |
|   22 | вариант без entrypoints (`unavailable`) → data-only FormatDefinition или drop    |
|   12 | capability `edit` — 13D редактирование только для текстовых источников           |
|    6 | `references` (relation-плоскость) — нет поля в v2 spec                           |
|    5 | `languages` → language contribution kind отсутствует                             |
|    4 | capability `language`                                                            |
|    4 | вариант с `language` entrypoint                                                  |
|    2 | capability `provision`/`play` — runtime-плоскость отсутствует                    |
|    1 | capability `sign`                                                                |
|    1 | capability `launch`                                                              |

### 5.2 `convertible with rework` — 24 (пропущены без `--rework`)

`sc2-runtime`, `wow-m2`, `cab`, `rar`, `astc`, `basis`, `pkm`, `pvr`, `ai`, `cdr`, `docx`,
`drawio`, `figma`, `max`, `odp`, `ods`, `odt`, `pdf`, `pptx`, `rtf`, `visio`, `xlsx`,
`unity-assets`, `unityfs`.

### 5.3 `mechanical`, но конвертер отказался — 1

- `org.modkitx/casc` — в v1 `match` **пусто**: ни `extensions`, ни `pathGlobs`, ни `magic`.
  В v2 пустой набор правил не является wildcard (`subject-open.ts`: «An empty rule set is not a
  wildcard»), значит candidate-правило выразить нечем. Это не дефект конвертера, а дыра в v1:
  CASC маршрутизировался формой каталога, а не именем. Нужна отдельная namespace-стратегия.
  Те же трое без единого правила: `casc`, `sc2-bank`, `sc2-triggers` (два последних —
  needs-new-contract и так).

### 5.4 Что конвертер сознательно НЕ переносит (записано в `--json`, не в манифест)

| штук | решение конвертера                                                                                                                  |
| ---: | ----------------------------------------------------------------------------------------------------------------------------------- |
|  193 | v1 operation id без механического handler'а — эмитятся только три операции codec-kit (`view.inspect`/`asset.validate`/`export.raw`) |
|    5 | `dependencies` (codec→codec) — `dependsOn` требует contract id + mode/scope (23 §8), вывести нельзя                                 |
|    4 | v1 per-variant `permissions` расширены на оба эмитируемых варианта                                                                  |
|    3 | `companions` — форма отличается от `spec.companions` CompanionRule                                                                  |
|    2 | `match.xmlRoots` — нет поля в v2, разбор корня должен делать `probe()` вручную (`dae`, `sage-w3x`)                                  |
|    1 | `status: unsupported` + mechanical (`earth-res`) — 27 §0.5.2 говорит «это FormatDefinition, не кодек»                               |

## 6. `--rework` (задача A2) — сделано, вывод не закоммичен

`node scripts/convert-mk2.mjs --rework` даёт **125 кодеков** (102 mechanical + **23 из 24**
rework) в 35 расширениях; `check-extension-inventory` и `check-legacy` на этом дереве чистые.
Пропущен один: `org.modkitx/sc2-runtime` — v1 `kind: runtime`, для которого в лаборатории нет
bundled representation-контракта (конвертер контрактов не выдумывает), и это SC2-специфика.

Дерево `extensions/mk2/**` закоммичено **в mechanical-варианте**, по двум причинам:

1. `--check` сравнивает с генерацией **теми же флагами**; смешанное дерево делает гейт
   неоднозначным (`pnpm convert:mk2 --check` показывал бы 23 «лишних» расширения как drift).
2. Вердикт `rework` в отчёте — это в основном **split** (viewer-entrypoint → отдельная
   viewer-contribution, 13C) и rename. Конвертер viewer-contribution не эмитит: он молча теряет
   viewer-плоскость. Отдавать это в закоммиченное дерево — значит потерять решение владельца,
   а не принять его. Флаг есть, счётчики есть, зелёное дерево воспроизводится одной командой.

Rename-таблица AC §5 применяется под `--rework`: `image.compressed.read → image.compressed-read`
попадает в заметки конверсии (операция всё равно не эмитится — нет handler'а), это проверено
тестом.

## 7. Находки (то, что в отчёте/коде оказалось неточным)

### 7.1 codec-kit: `probe` не ограничивает чтение размером источника (**блокирующая**)

`createInspectionCodec.probe` читает ровно `probeLength(request.plan)` байт и не смотрит на
`request.source.size`. На настоящем host-мосте (`artifactByteSourceFromRandomAccess`) чтение за
EOF — ошибка, а не короткое чтение, поэтому **любой файл меньше объявленного probe-окна
отбрасывается** с `x3.host/source-range-unrepresentable` ещё до вызова `detect()`.

Свежий пример из harness'а (до обхода):

```text
org.modkitx/svg/trusted-node: rejected — x3.host/source-range-unrepresentable:
read [0, 4096) exceeds source «…/favicon.svg» of size 425
```

Bundled-кодеки это прячут: у png probe-окно 32 байта, у zip — 4. Конвертер объявляет 4096
(cap из запроса), и дефект стал систематическим: 2 из 6 пилотов (425-байтовый svg, 689-байтовый
swf) не открывались вообще.

**✔ сделано (2026-08-19).** `probeLength(plan, size)` в codec-kit теперь берёт минимум из
объявленного окна и размера источника; объявленное окно — это потолок, а не требование. Шим
`withClampedProbe` из всех шести портов удалён. Регрессия покрыта самим acceptance-harness'ом:
два его образца (svg 425 Б, swf 689 Б) меньше 4096-байтового probe-окна, так что откат правки
немедленно красит тест.

### 7.2 Названный в запросе список пилотов не пересекается с mechanical-списком

См. §4: 5 из 6 названных кодеков — `needs new contract` (capability `write`), у `document` ноль
mechanical. Похоже, список пилотов собирали по «простоте формата», не сверяясь с таблицей
вердиктов того же отчёта.

### 7.3 `match.mediaTypes` вывести неоткуда

Field-mapping в отчёте пишет «`match.extensions / pathGlobs` → `spec.match.extensions` /
`pathGlobs`» и упоминает mediaTypes. В реальности **ни один из 206 v1-манифестов не имеет
`match.mediaTypes`** (ключи по всему корпусу: `extensions` 187, `magic` 64, `pathGlobs` 18,
`xmlRoots` 7, `parentArtifacts` 3). Поэтому сгенерированные манифесты не несут ни
`spec.match.mediaTypes`, ни `formatRefs[].mediaType` — их пишет только человек при порте.

### 7.4 v1 `encoding: "ascii"` — это latin1-строка байтов, а не printable ASCII

`org.modkitx/earth-par` объявляет magic `"PAR\u0000"`, `earth-res` — `"RES\u0000"`,
`unityfs` — `"UnityFS\u0000"`. Первая версия конвертера отбрасывала их как «не ASCII». Исправлено:
принимаются кодовые точки 0x00–0xFF. Эффект: +2 сигнатуры в mechanical-дереве (29 → 31) и +1
конвертируемый кодек под `--rework` (`unityfs` перестал быть «без правил маршрутизации»).

### 7.5 `pathGlobs: ["**/*"]` не ловит имя файла без каталога

`matchesGlob` в `subject-open.ts` переводит `**/*` в `^.*/[^/]*$` — нужен слэш. Восемь
mechanical-кодеков объявляют ровно этот glob и никаких extensions: `flv`, `swf`, `ogg`, `opus`,
`mp4`, `mpeg`, `ogv`, `webm`. Продукт, открывающий по голому имени (`ipistol.swf`), их кандидатами
никогда не увидит. Harness поэтому передаёт путь относительно корня корпуса, а не basename.
Решение (детект-first маршрутизация без имени) — за владельцем; здесь только зафиксировано.

### 7.6 Правило «trusted-node + portable как у bundled» теряет v1-таргетинг

Запрос предписывает эмитить оба варианта всегда. Это стирает per-variant окружения v1:
`org.modkitx/mix` был объявлен node-only (его v1 runtime импортирует `node:crypto`),
`astc`/`basis`/`dds` имели `browser-wasm`-варианты. Для пилота `mix` порт действительно portable
(crypto не нужен, зашифрованный заголовок объявлен как unsupported), но для остальных 96
непортированных `portable` — это заявка, которую v1-код не подтверждал. Предлагаю при ручном порте
каждого кодека пересматривать оба варианта, а не наследовать пару вслепую.

### 7.7 Union-правило по permissions расширяет их на worker-brokered вариант

Четыре кодека (`ps1-xa`, `ps1-cue-bin`, `emperor-rfh-rfd`, `unreal-iostore`) объявляли
`filesystem-read` на node-варианте. Семантический валидатор требует, чтобы каждый вариант
запрашивал объединение required-permissions, поэтому `filesystem-read` уехал и в `portable`.
Это соответствует таблице G4, но по существу — заявка сильнее, чем была.

### 7.8 Мелочи инфраструктуры

- **✔ сделано (2026-08-19).** `extensions/mk2/*` добавлен в `pnpm-workspace.yaml`, каждый
  сгенерированный `package.json` объявляет `dependencies: {"@modkitx-x3/codec-kit": "workspace:*"}`,
  и модули импортируют кит по имени пакета — тем же специфаером, что использовало бы
  опубликованное расширение. Побочный эффект, который стоило проверить: **вариант `portable`
  (worker-brokered) теперь тоже активируется**. Worker-бэкенд сверяет дайджесты файлов артефакта
  перед evaluation, и относительный импорт, выходивший за корень артефакта, это ломал; с пакетным
  специфаером `org.modkitx/glb` открывается в Node-воркере и tree-dataSource отвечает через RPC.
  Закреплено отдельным кейсом в `mk2-acceptance.test.ts` (`workerBrokered: true`).
- `ModkitError` не реэкспортируется из codec-kit, а у сгенерированных расширений нет зависимости
  на `@modkitx-x3/core`. Скелет бросает обычный `Error` с `code: 'x3.mk2/port-pending'` — код
  ошибки из запроса сохранён, класс — нет.
- `scripts/check-extension-inventory.mjs` применяет `strict: true` ко **всему** `extensions/*/*`,
  хотя комментарий говорит про «bundled `common` family». Для этой задачи так даже лучше
  (все 102 манифеста обязаны быть `inventoryEligible` с первого дня, и они такие), но комментарий
  устарел.
- prettier форматирует файл с именем `package.json` парсером `json-stringify`, а не `json`.
  Генератор обязан использовать тот же, иначе `format:check` спорит с ним на каждом прогоне.
- `scripts/lib/mk2-manifests.mjs` добавил `$comment` в список известных v1-полей — только ради
  маркера `@modkit-legacy-input-fixture` в фикстурах. Ни один манифест реального `modkitx` его не
  несёт, счётчики отчёта не изменились (проверено побайтным diff'ом).

### 7.9 Корпус

В `modkitx` нет образцов для большинства mechanical-форматов. Пригодных нашлось на 6 семейств:
`.webp` (4), `.mp3` (7), `.glb` (429), `.mix` (17), `.svg` (291), `.swf` (93, все — SC2 UI).
Нет ни одного `.wav`, `.tar`, `.gz`, `.bmp`, `.gif`. Это ограничивает acceptance: 96 кодеков
нечем проверить даже после порта. Если корпус планируется расширять — это блокер для §12
acceptance, а не для конвертера.

## 8. Как воспроизвести

```bash
pnpm convert:mk2
```

```bash
node scripts/convert-mk2.mjs --check
```

```bash
node scripts/convert-mk2.mjs --rework --out /tmp/mk2-rework --json /tmp/mk2-rework.json
```

```bash
pnpm test -- packages/testkit/test/mk2-acceptance.test.ts scripts/test/convert-mk2.test.ts
```

`--json <file>` пишет полный разбор: сводка, список сконвертированных с заметками, список
пропущенных с причинами, список хендпортов и drift. `--mk2-root` переопределяет checkout,
`MODKITX_MK2_ROOT` — то же для harness'а.

## 9. Решения Root

Закрыто 2026-08-19:

1. ✔ `probe`-clamp в codec-kit починен, шим из портов убран (§7.1).
2. ✔ `extensions/mk2/*` в workspace, импорт по имени пакета, worker-вариант проверен (§7.8).
3. ✔ `check:mk2` (`convert-mk2 --check`) добавлен в цепочку `pnpm check`; без соседнего
   MK2-checkout'а он печатает `skipped` и выходит с 0, поэтому CI без MK2 остаётся зелёным.

Открыто:

4. Коммитить ли `--rework`-дерево (§6) и что делать с viewer-плоскостью, которую конвертер
   теряет на split-вердиктах.
5. Что делать с `pathGlobs: ["**/*"]`-кодеками (§7.5): менять matcher, менять манифесты или
   считать, что продукт всегда открывает путь с каталогом.
6. `earth-res` (`status: unsupported`, но mechanical) — кодек или data-only FormatDefinition.
7. Расширение корпуса (§7.9) — без него acceptance масштабируется только на 6 форматов.
