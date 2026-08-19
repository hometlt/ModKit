# OPUS-MK2-02 — заметки конверсии, rework-дерево, сигнатуры, синтетический корпус, порт-кампания

Дата: 2026-08-19. Исполнитель: Opus. Запрос: `REQUEST_OPUS_MK2_02_2026-08-19.md`.
Baseline: `dbeeab8` (HEAD на момент старта; `0a638d2` + `4b0d942` + S5b).
Предыдущий отчёт — `REPORT_MK2_CONVERSION_2026-08-18.md`, он остаётся в силе; здесь только дельта.

## 0. Коротко

| задача                       | статус                                                                |
| ---------------------------- | --------------------------------------------------------------------- |
| D — `MK2-CONVERSION.json`    | готово                                                                |
| D2 — rework как режим дерева | готово, дерево регенерировано                                         |
| E — сигнатуры вместо `**/*`  | готово (8 контейнеров + правило пропуска glob'а)                      |
| F — синтетический корпус     | готово, 13 фикстур (6 из §9.7 + 7 контейнеров, см. §5.3)              |
| G — порт-кампания, волна 1   | 9 новых портов; 4 формата из списка заблокированы контрактом (см. §6) |
| **ported всего**             | **15** (6 прежних + 9) при DoD «≥ 12»                                 |

**`pnpm check` целиком не зелёный — не по моей вине;** в рабочем дереве параллельно идёт чужая
незакоммиченная работа (`packages/host/**`, `apps/**`, S7 subject-services). Подробности и что
именно проверено — §8.

## 1. Счётчики

`pnpm convert:mk2` (новый режим по умолчанию = mechanical + rework), источник
`C:/FILES/SC2Files/coding/modkitx`:

| счётчик            | значение | комментарий                                                     |
| ------------------ | -------: | --------------------------------------------------------------- |
| converted          |  **123** | 102 mechanical + 21 rework, в 35 расширениях, 351 файл          |
| with notes         |  **123** | у каждого есть хотя бы одна запись долга — см. §7.5             |
| lost planes        |   **13** | v1-entrypoint'ы, для которых у codec-contribution нет места     |
| needsSignatures    |    **1** | `org.modkitx/casc` — единственный без единого правила           |
| с сигнатурами      |   **47** | 39 из v1 `magic` + 8 добавленных при порте (задача E)           |
| ported (real)      |    **7** | `webp jpg mp3 glb mix svg swf`                                  |
| ported (synthetic) |    **8** | `wav flv ogg opus ogv mp4 mpeg webm`                            |
| port-pending       |  **108** | бросают `x3.mk2/port-pending`                                   |
| skipped            |   **83** | 79 needs-new-contract, 3 format-definition-pending, 1 `runtime` |

По семействам (v1 `kind`): image 35, archive 29, model 20, document 13, video 12, audio 11,
vector 3.

`--mechanical-only` воспроизводит прежнее дерево OPUS-MK2-01: 102 кодека, 35 расширений
(35, а не 34: `casc` теперь конвертируется, см. §7.3).

Детерминизм: повторный прогон — `0 added, 0 rewritten, 0 removed (byte-stable)`;
`pnpm check:mk2` — clean на 351 сгенерированном файле и 15 пропущенных хендпортах.

## 2. Задача D — `MK2-CONVERSION.json`

Конвертер кладёт рядом с `package.json` каждого расширения инертный файл заметок. Он не
контрибуция, не схема и не попадает под loader-glob (`./contributions/*.json`), то есть хост его
не видит; это долг механической конверсии, записанный данными.

```jsonc
{
  "$comment": "…что означает каждое поле…",
  "schemaVersion": 1,
  "source": { "repository": "modkitx", "manifests": ["extensions/.../codec.manifest.json", …] },
  "verdict": "mechanical" | "convertible-with-rework",   // агрегат по группе
  "codecs": {
    "org.modkitx/<id>": {
      "verdict": "…",                                     // вердикт самого кодека
      "lostPlanes": [{ "plane": "viewer", "entrypoint": "./viewer.js" }],
      "renames": [{ "from": "image.compressed.read", "to": "image.compressed-read" }],
      "converterDefaults": ["variants:pair", "permissions:union", "probe:bytes-4096", …],
      "droppedOperations": ["image.inspect", "image.read"],
      "needsSignatures": false,
      "portState": "port-pending" | "ported"
    }
  }
}
```

Отличия от эскиза в запросе — два, оба добавляют, а не убирают: `verdict` продублирован на уровне
кодека (в одной группе бывают оба вердикта, поэтому верхний уровень — агрегат, а не факт), и есть
`$comment` (в JSON нет комментариев, а поля обязаны объяснять себя сами).

Слово `capability` как ключ не используется; `pnpm check:legacy` чистый на 687 файлах.

`portState` вычисляется из дерева: `ported` = модуль потерял маркер `@generated`, то есть у него
появился человек-владелец. Из-за этого чтение существующего дерева переехало **до** рендера файлов
— заметки несут это состояние. Побочный эффект, закреплённый тестом: ручной порт переписывает
ровно два файла (`MK2-CONVERSION.json` и колонку `port` в README) и не трогает сам модуль.

Тест `scripts/test/convert-mk2.test.ts` (13 кейсов): фикстура `exotic` (split-вердикт, v1
`viewer`-entrypoint) даёт `lostPlanes[].plane === 'viewer'` с путём `./viewer.js`; фикстура
`retired` (`status: unsupported`) — пропуск `format-definition-pending`; фикстура `wildcard`
(только `**/*`) — `needsSignatures: true` и пустой `spec.match`.

## 3. Задача D2 — rework стал режимом закоммиченного дерева

- `pnpm convert:mk2` без флагов = mechanical + rework. Флаг `--rework` больше не нужен;
  `--mechanical-only` оставлен для отчётов и сравнения с деревом OPUS-MK2-01.
- `pnpm check:mk2` — та же команда с `--check`, то есть гейт и дерево говорят об одной конверсии.
- Дерево регенерировано: 123 кодека (было 102), 35 расширений, 351 файл.
- `earth-res` переведён в пропуск `format-definition-pending` — вместе с ещё двумя, см. §7.2.
- `pnpm check:extensions` и `pnpm check:legacy` на новом дереве чистые; отдельный тест проверяет,
  что **все** 123 контрибуции `inventoryEligible` против продуктового реестра.

## 4. Задача E — сигнатуры вместо `pathGlobs: ["**/*"]`

Правила:

1. Единственный glob, матчащий всё, отбрасывается: `matchesGlob` требует компонент каталога, то
   есть по голому имени файла он не срабатывает никогда (§7.5 прошлого отчёта), а MK3 выражает
   detect-by-content через `match.signatures` (NXT-101B). Нести правило, которое врёт, хуже, чем
   не нести никакого.
2. Если после этого у кодека не осталось ни одного правила — `needsSignatures: true` в заметках,
   но кодек **эмитится**: он inventory-eligible, просто не кандидат, пока сигнатуру не объявят
   руками. В дереве такой ровно один (`casc`).
3. Восьми контейнерам сигнатуры добавлены при порте, из спецификаций, с указанием источника
   в README расширения (таблица `PORT_SIGNATURES` в конвертере — единственное место, где они
   живут, поэтому руками правленный манифест не появляется и `--check` остаётся однозначным):

| кодек  | паттерн                           | источник                                            |
| ------ | --------------------------------- | --------------------------------------------------- |
| `flv`  | `464c5601` @0                     | Adobe Video File Format Specification v10.1 §E.2    |
| `swf`  | `465753` / `435753` / `5a5753` @0 | SWF File Format Specification v19, «The SWF header» |
| `ogg`  | `01766f72626973` @28              | RFC 3533 §6 + RFC 5334 §4 / Vorbis I §4.2.1         |
| `opus` | `4f70757348656164` @28            | RFC 3533 §6 + RFC 7845 §5.1                         |
| `ogv`  | `807468656f7261` @28              | RFC 3533 §6 + Theora I §6.1                         |
| `mp4`  | `66747970` @4                     | ISO/IEC 14496-12 §4.3 (FileTypeBox)                 |
| `mpeg` | `000001ba` / `000001b3` @0        | ISO/IEC 11172-1 §2.4.3.2 и 11172-2 §2.4.2.3         |
| `webm` | `1a45dfa3` @0                     | RFC 8794 §4.1 (EBML header id)                      |

Смещение 28 у трёх Ogg-кодеков — не трюк: страница Ogg это 27-байтовый заголовок плюс таблица
сегментов, у первой (одно-сегментной) страницы payload начинается ровно с 28-го байта, и именно
там лежит identification header. Это и разводит Vorbis / Opus / Theora, которые в v1 разводил
детектор.

**Доказательство маршрутизации.** Acceptance открывает `swf` по **голому имени файла**
(`ipistol.swf`), то есть путь не может помочь ни одному правилу; кандидат приходит с диагностикой
`x3.host/signature-match`, и харнесс это проверяет (`expectSignatureMatch`). Так же открываются
все семь остальных контейнеров — 8 кейсов «маршрут по байтам» в таблице ниже.

## 5. Задача F — синтетический корпус

`packages/testkit/scripts/gen-synthetic-corpus.mjs` → `packages/testkit/test/fixtures/mk2-synthetic/`.

- Ничего не копируется: каждая фикстура написана по спецификации, раздел которой назван в
  комментарии над билдером. Контрольные суммы настоящие и считаются: CRC-32 (PNG §5.5 / RFC 1952
  §8), CRC-32 Ogg (RFC 3533 §6, не-отражённый, init 0), adler-32 (RFC 1950 §9), октальная сумма
  заголовка tar.
- Byte-stable: ни времени, ни случайности (`mtime` в gzip и tar — нули по этой причине).
- `--check` регенерирует в память и сравнивает; вызывается из теста, поэтому попадает в `pnpm check`
  через `pnpm test`, без нового алиаса в корневом `package.json`. Для человека есть
  `pnpm --filter @modkitx-x3/testkit corpus:synthetic[:check]`.

### 5.1 Что сгенерировано

| файл           | байт | спецификация                                                     |
| -------------- | ---: | ---------------------------------------------------------------- |
| `minimal.wav`  |   48 | RIFF/WAVE, `fmt ` PCM 8 бит моно, `data` из 4 сэмплов            |
| `minimal.bmp`  |   58 | BITMAPFILEHEADER + BITMAPINFOHEADER, 1×1×24, строка с padding'ом |
| `minimal.gif`  |   35 | GIF89a §17–§22, 1×1, GCT на 2 цвета, LZW Clear/пиксель/EOI       |
| `minimal.tar`  | 2048 | POSIX ustar: заголовок, блок данных, два нулевых блока           |
| `minimal.gz`   |   28 | RFC 1952 §2.3 + один stored-блок RFC 1951 §3.2.4                 |
| `minimal.png`  |   72 | ISO/IEC 15948 §5/§11.2, 1×1 truecolour, IDAT как stored-поток    |
| `minimal.flv`  |   32 | FLV Annex E.2/E.3: заголовок + один видео-тег                    |
| `minimal.ogg`  |   58 | RFC 3533 §6 + Vorbis I §4.2.2 identification                     |
| `minimal.opus` |   47 | RFC 3533 §6 + RFC 7845 §5.1 `OpusHead`                           |
| `minimal.ogv`  |   70 | RFC 3533 §6 + Theora I §6.1                                      |
| `minimal.mp4`  |  140 | ISO/IEC 14496-12 §4.3 `ftyp` + §8.2.2 `moov`/`mvhd`              |
| `minimal.mpg`  |   16 | ISO/IEC 11172-2 §2.4.2.3 sequence_header + sequence_end_code     |
| `minimal.webm` |   94 | RFC 8794 §4 EBML header (DocType webm) + Segment/Info            |

### 5.2 Проверка независимым декодером

Фикстура, которую понимает только её собственный читатель, ничего не доказывает. Два формата несут
стандартные сжатые потоки, и тест судит их **не** кодеком под проверкой, а `node:zlib`:
`minimal.gz` обязан распаковаться в `hello`, а IDAT из `minimal.png` — инфлейтиться в
`[0x00, 0x80, 0x40, 0x20]` (байт фильтра + один RGB-пиксель). Плюс `minimal.png` открывается
**bundled**-кодеком `org.modkitx/image-png` — перекрёстная проверка из §9.7: если бы фикстура была
кривой, упал бы не мой порт, а чужой рабочий кодек.

### 5.3 Почему фикстур 13, а не 7

Список §9.7 (`wav bmp gif tar gz png` + `jpg` из корпуса) не покрывает задачу G: восьмёрка
контейнеров требует зелёного acceptance, а в `modkitx` нет ни одного `.flv/.ogg/.opus/.ogv/
.mp4/.mpeg/.webm` (только `swf`). Генератор расширен ровно на эти семь; список §9.7 сгенерирован
целиком, включая `bmp/gif/tar/gz`, у которых сегодня нет кодека-потребителя (§6.1) — они лежат
готовыми к 13D.

## 6. Задача G — порт-кампания, волна 1

Каждый порт: честный `probe` по magic/структуре, `open` с дескриптором и минимум двумя data
source'ами (`tree` + `byte-range` от кита, плюс семейный), acceptance через продуктовый путь
`loadExtensionDirectory → buildInventory → openSubject`.

```text
  contribution           state    corpus     conf  route  sample
  org.modkitx/webp       opened   real       0.990  name   …/kane.webp
  org.modkitx/jpg        opened   real       0.990  name   …/earth.jpg
  org.modkitx/mp3        opened   real       0.950  name   …/welcome-back-commander.mp3
  org.modkitx/glb        opened   real       0.990  name   …/duck.glb
  org.modkitx/mix        opened   real       0.800  name   …/tem.mix
  org.modkitx/svg        opened   real       0.950  name   …/favicon.svg
  org.modkitx/swf        opened   real       0.970  bytes  …/ipistol.swf        (по basename)
  org.modkitx/wav        opened   synthetic  0.980  name   minimal.wav
  org.modkitx/flv        opened   synthetic  0.970  bytes  minimal.flv
  org.modkitx/ogg        opened   synthetic  0.980  bytes  minimal.ogg
  org.modkitx/opus       opened   synthetic  0.980  bytes  minimal.opus
  org.modkitx/ogv        opened   synthetic  0.970  bytes  minimal.ogv
  org.modkitx/mp4        opened   synthetic  0.980  bytes  minimal.mp4
  org.modkitx/mpeg       opened   synthetic  0.950  bytes  minimal.mpg
  org.modkitx/webm       opened   synthetic  0.980  bytes  minimal.webm
  org.modkitx/image-png  opened   synthetic  0.999  name   minimal.png          (bundled, кросс-проверка)
```

Что реализовано в каждом (фидельность — ровно v1 `limitations`, ни строчкой больше):

| кодек  | probe                                          | open                                                                |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------- |
| `jpg`  | SOI + разбираемая цепочка сегментов            | сегменты до SOS, размеры из SOF, JFIF/Exif; raster без `readRegion` |
| `wav`  | RIFF/WAVE + корректный `fmt `                  | обход чанков с word-align, длительность из byteRate; audio-source   |
| `flv`  | заголовок FLV (версия, резервные биты, offset) | ограниченный обход тегов, коды кодеков аудио/видео; video-source    |
| `ogg`  | страница Ogg + Vorbis identification           | обход страниц, каналы/частота/битрейты; audio-source                |
| `opus` | страница Ogg + `OpusHead`                      | версия/каналы/pre-skip/gain, декодирование всегда 48 кГц            |
| `ogv`  | страница Ogg + маркер Theora (правило v1)      | Theora id-header: размеры, макроблоки, маркеры vorbis/skeleton      |
| `mp4`  | `ftyp` + читаемая цепочка боксов               | обход боксов (64-битные размеры тоже), `mvhd`, `hdlr`/`stsd`        |
| `mpeg` | start-code в **начале** файла либо сетка TS    | инвентарь start-code'ов, sequence_header, program/transport/ES      |
| `webm` | EBML id + DocType                              | обход EBML, Info/Tracks, кодеки и размеры дорожек                   |

Никакой SC2-специфики не портировано.

### 6.1 Четыре формата из списка волны 1 портировать нечего

`bmp`, `gif`, `tar`, `gzip` в запросе названы, но в дереве их **нет**: все четыре — вердикт
`needs new contract`, заблокированы v1 capability `write` (13A read-only, нужен 13D
writer/service). Это ровно та же нестыковка, что зафиксирована в §7.2 прошлого отчёта для списка
пилотов OPUS-MK2-01 (`bmp gif ico tar gzip obj`), и она повторилась. Запрос сам даёт правило для
этого случая — «что упирается в отсутствие контракта — не порти, зафиксируй в отчёте», — так и
сделано. Синтетические фикстуры для всех четырёх сгенерированы и ждут 13D.

Освободившийся объём ушёл в контейнеры: вместо 6 названных портов сделано 9, итог 15 ported
против DoD «≥ 12».

### 6.2 Пересмотр вариантов и permissions (§7.6/§7.7)

Пересмотрены все 15 портов. **Сужать не потребовалось ни одного:** каждый из них — чистый
байтовый ридер без `node:`-зависимостей, которому нужен только `read-source`, так что пара
`trusted-node` + `portable` и объединённые permissions здесь не преувеличение, а факт. Это не
декларация: тест поднимает `portable`-вариант в Node-воркере (бэкенд сверяет дайджесты файлов
артефакта перед evaluation) для реального и для синтетического кейса — оба открываются как
`variantId: 'portable'`.

Что остаётся сузить при будущих портах: `ps1-xa`, `ps1-cue-bin`, `emperor-rfh-rfd`,
`unreal-iostore` — им union-правило раздало `filesystem-read` на оба варианта (§7.7), и это
по-прежнему заявка сильнее, чем была. `mix` (§7.6, v1 объявлял node-only) портирован и
подтверждённо portable — здесь долг закрыт.

## 7. Находки

### 7.1 `status: unsupported` — это три кодека, а не один

Решение §9.6 названо на примере `earth-res`, но правило («v1 `status: unsupported` по 27 §0.5.2 —
FormatDefinition, а контракта format-definition в лаборатории нет») применимо буквально. В
`modkitx` таких манифестов 25; 22 из них и так `needs new contract`, а конвертируемых —
**три**: `earth-res` (mechanical), `wow-m2` и `max` (оба rework). Все три пропущены с причиной
`format-definition-pending`. Применять правило к одному `earth-res` значило бы завести исключение
из решения владельца — не стал.

### 7.2 123 кодека, а не ожидаемые ~125

Арифметика: 102 mechanical + 23 rework = 125 (число из §6 прошлого отчёта) − 3
(`earth-res`, `wow-m2`, `max` по §7.1) + 1 (`casc`, §7.3) = **123**. `sc2-runtime` по-прежнему
пропущен с причиной «v1 kind `runtime` не имеет bundled-контракта представления».

### 7.3 `casc` перестал быть исключением

§5.3 прошлого отчёта: `casc` — единственный mechanical, от которого конвертер отказался, потому
что его v1 `match` пуст. Правило задачи E («кодек без правил всё равно эмитится») снимает это
исключение: `casc` теперь в дереве, inventory-eligible, с `needsSignatures: true`. Кандидатом он
не станет, пока кто-то не объявит сигнатуру, — и это ровно то состояние, которое было в v1
(CASC маршрутизировался формой каталога, а не именем).

### 7.4 «Потерянные плоскости» — это 13 viewer'ов, все в одном расширении

Все `lostPlanes` в дереве — `viewer`-entrypoint'ы документных кодеков `uncommon-documents`
(`ai cdr docx drawio figma odp ods odt pdf pptx rtf visio xlsx`). Ни одной `language`-плоскости в
конвертируемом наборе нет: они все и так `needs new contract`. То есть весь долг «13C viewer
contribution» сосредоточен в одном расширении — это удобно для владельца: одно решение закрывает
всю категорию.

Rename'ов AC §5 в дереве четыре, все один и тот же: `image.compressed.read →
image.compressed-read` у `astc basis pkm pvr`.

### 7.5 Счётчик «with notes» вырожден: он равен converted

123 из 123. Причина не в том, что заметки шумные, а в том, что **механическая конверсия не
переносит ни одной v1-операции**: эмитятся только три операции codec-kit, поэтому
`droppedOperations` непуст всегда (265 операций суммарно). Информативные счётчики — `lostPlanes`
(13) и `needsSignatures` (1); «with notes» стоит читать как «конверсия ничего не потеряла молча»,
а не как метрику качества.

### 7.6 `org.modkitx/jpg` теперь дублирует bundled `org.modkitx/image-jpeg`

В `extensions/common/images` уже есть JPEG-кодек с той же фидельностью (заголовки, без декодинга
пикселей). Порт `org.modkitx/jpg` был назван в запросе первым по доказуемости, и он сделан, но в
одном инвентаре два JPEG-кодека будут конкурировать за один и тот же файл. Решение — за владельцем:
либо конвертированный `jpg` живёт как исторический инвентарь MK2 и не попадает в продуктовый
инвентарь, либо один из двух снимается. То же самое ждёт `png`, `gif`, `bmp`, если 13D разблокирует
их конверсию.

### 7.7 Порт обязан быть одним файлом

Конвертер считает дрейфом любой файл под `extensions/mk2/**`, которого нет в его карте, и удаляет
его; пропускаются только хендпорченные `src/<id>/codec.js`. Значит, порт не может завести
вспомогательный модуль рядом с собой. Практический эффект: 27-строчный ридер страниц Ogg
продублирован в трёх портах (`ogg`, `opus`, `ogv`). Для `ogv` это в любом случае другой артефакт,
для `ogg`/`opus` — цена правила. Если волна 2 упрётся в это всерьёз, правило стоит расширить:
«каталог `src/<id>/` порченного кодека принадлежит человеку целиком».

### 7.8 `scripts/convert-mk2.mjs` содержал байт NUL

С OPUS-MK2-01 в комментарии стоял литеральный `\0` (иллюстрация magic `PAR\0`), из-за чего git
считал весь скрипт бинарным и не показывал diff. Заменено на прозаическое «`PAR` + NUL-байт».
Заодно такой же управляющий байт попал в строку источника сигнатуры Vorbis и оттуда — в
генерируемый README; тоже убран. Ни то, ни другое на поведение не влияло, но diff'ы теперь читаются.

### 7.9 §7.5 прошлого отчёта закрыт для восьми кодеков, но не в целом

`matchesGlob` не менялся и меняться не должен. Открытие по голому имени теперь работает для
восьми контейнеров — потому что у них появились сигнатуры, а не потому что glob начал матчить.
Для остальных кодеков, у которых в v1 были только `extensions`, поведение прежнее: имя нужно.

## 8. Состояние `pnpm check`

Полный `pnpm check` **красный на HEAD, и не из-за этого слайса.** Пока шла работа, в то же дерево
приземлился чужой слайс S7 «subject services» (`a54d408` + `2239c4e`), и `pnpm lint` падает на его
файле:

```text
packages/host/test/subject-services.test.ts
  132:27  error  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion
```

`packages/host/**` — запрещённая мне зона, поэтому я это не чинил и в коммит не включал. Правка
на одну строку: `extension!` в `extensions: [{ ...extension!, contributions: [copy] }]`.

Всё, что стоит в цепочке **до** упавшего `lint`, прогнано на моём дереве и зелёное:
`pnpm build` (`catalogs:check` → `typecheck` → `bundle`) и `pnpm bench:universal:gate`.

Прогнано отдельно и зелёное:

- `pnpm test` — **83 файла / 694 теста, весь репозиторий**, включая тесты чужого слайса S7.
- `prettier --check .` — чисто по всему репозиторию.
- `eslint scripts extensions/mk2 packages/testkit --max-warnings 0` — чисто.
- `pnpm check:legacy` — clean, 687 файлов.
- `pnpm check:extensions` — clean, 53 расширения.
- `pnpm check:imports` — clean, 204 файла.
- `pnpm check:mk2` — clean (351 сгенерированный файл, 15 хендпортов пропущено).
- `gen-synthetic-corpus --check` — clean, 13 фикстур.
- `scripts/test/convert-mk2.test.ts` — 13/13; `packages/testkit/test/mk2-acceptance.test.ts` —
  7/7, все 16 кейсов корпуса `opened`.

Отдельно про ложную тревогу: один промежуточный прогон `pnpm test` показал 17 упавших файлов, и
это была гонка, а не дефект — соседний процесс пересобирал `dist` во время прогона, и
`scripts/test/bundle.test.ts` видел то bundled-, то modular-состояние. Чистый прогон после того,
как соседний слайс закоммитился, — 694/694.

**Владельцу:** уберите `!` в `packages/host/test/subject-services.test.ts:132`, и `pnpm check`
должен стать целиком зелёным; мой коммит трогает только `scripts/**`, `extensions/mk2/**`,
`packages/testkit/**`, `pnpm-lock.yaml` (одна строка, см. §9) и этот отчёт.

## 9. Файлы

Новые:

- `packages/testkit/scripts/gen-synthetic-corpus.mjs`
- `packages/testkit/test/fixtures/mk2-synthetic/**` — 13 фикстур
- `extensions/mk2/*/MK2-CONVERSION.json` — 35 файлов заметок
- `scripts/test/fixtures/mk2/extensions/acme/pack/codecs/{wildcard,retired}/codec.manifest.json`
- этот отчёт

Изменённые:

- `scripts/convert-mk2.mjs` — задачи D/D2/E
- `scripts/test/convert-mk2.test.ts` — 13 кейсов
- `extensions/mk2/**` — регенерировано (123 кодека, 35 расширений) + 9 новых хендпортов + правка
  комментария в `swf`
- `packages/testkit/src/mk2-acceptance.ts` — два корпуса, `route: basename`,
  `expectSignatureMatch`, счётчики
- `packages/testkit/src/index.ts` — два реэкспорта
- `packages/testkit/test/mk2-acceptance.test.ts`, `packages/testkit/test/fixtures/mk2-corpus.json`
- `packages/testkit/package.json` — два скрипта генератора
- `pnpm-lock.yaml` — одна запись: `extensions/mk2/blizzard-archives` стал новым workspace-членом
  (расширение появилось вместе с `casc`, §7.3); без неё `--frozen-lockfile` упадёт

`modkitx` остался read-only: конвертер, генератор и харнесс только читают файлы; импортов из
`modkitx` в исходниках нет; ни один файл корпуса не скопирован.

## 10. Как воспроизвести

```bash
pnpm convert:mk2
```

```bash
pnpm check:mk2
```

```bash
node scripts/convert-mk2.mjs --mechanical-only --out /tmp/mk2-mechanical --json /tmp/mk2.json
```

```bash
pnpm --filter @modkitx-x3/testkit corpus:synthetic:check
```

```bash
pnpm test -- packages/testkit/test/mk2-acceptance.test.ts scripts/test/convert-mk2.test.ts
```

## 11. Что осталось владельцу

1. **13C viewer contribution** — 13 документных кодеков `uncommon-documents` потеряли
   `viewer`-плоскость; долг перечислен в `extensions/mk2/uncommon-documents/MK2-CONVERSION.json`.
   Одно решение закрывает всю категорию (§7.4).
2. **13D writer/edit** — 79 кодеков `needs new contract`, из них 33 упираются в `write` и 12 в
   `edit`. Волна 1 не смогла портировать `bmp/gif/tar/gzip` именно поэтому (§6.1); синтетические
   фикстуры для них уже лежат.
3. **format-definition (документ 30)** — три кодека ждут контракта (§7.1).
4. **Дубли с bundled** — `org.modkitx/jpg` против `org.modkitx/image-jpeg` (§7.6): решить, входит
   ли конвертированное дерево в продуктовый инвентарь вообще.
5. **`casc` и namespace-маршрутизация** — единственный `needsSignatures` в дереве; ему нужна не
   сигнатура, а стратегия маршрутизации по форме каталога (§7.3).
6. **Реальный корпус** — синтетика доказывает структурное открытие, не fidelity. Восемь
   контейнеров сегодня зелёные только на своих минимальных файлах; для §12 acceptance нужен
   настоящий `.mp4`/`.webm`/`.ogg`.
7. **Одна строка в чужом слайсе** — `packages/host/test/subject-services.test.ts:132`, лишний
   `!`; из-за него `pnpm check` красный на HEAD (§8). Трогать `packages/host/**` мне запрещено.
