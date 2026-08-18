# Запрос Opus: OPUS-MK2-02 — конверсионные заметки, rework-дерево, сигнатуры, синтетический корпус, порт-кампания (волна 1)

Дата: 2026-08-19. Автор: Root/Fable. Baseline: `0a638d2` (OPUS-MK2-01 закоммичен) + коммит Root с
решениями §9 отчёта. Предыдущий запрос и его границы (`REQUEST_OPUS_MK2_CONVERTER_2026-08-18.md`
§«Рамка») остаются в силе; ниже — только дельта.

## Границы (дельта)

- Scope прежний (`scripts/convert-mk2.mjs`, `scripts/lib/mk2-manifests.mjs`, `scripts/test/**`
  своего конвертера, `extensions/mk2/**`, `packages/testkit/src/mk2-*`, `packages/testkit/test/mk2-*`,
  `REPORT_MK2_CONVERSION_*.md`) **плюс** `packages/testkit/scripts/gen-synthetic-corpus.mjs` и
  `packages/testkit/test/fixtures/mk2-synthetic/**`.
- По-прежнему **не трогать**: `packages/host/**`, `packages/sdk/**`, `subject-open`/`matchesGlob`,
  `extensions/common/**`, `extensions/_shared/**` (codec-kit — читать; находки в отчёт),
  гейты `scripts/check-*.mjs`, root `package.json` (кроме alias'ов, названных здесь).
- Коммит — по завершении всего слайса, один, с зелёным полным `pnpm check` (тот же режим, что
  в MK2-01: владелец разрешил тебе коммит по слову Root; сообщение коммита начинается с
  `feat(tooling,extensions):` и заканчивается `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`).
- Никаких новых контрактов, полей схем, изменений `matchesGlob`, изменений семантики codec-kit.

## Решения Root, которые ты исполняешь (REPORT §9, п.4–8)

### Задача D — `MK2-CONVERSION.json` (долг как данные)

Конвертер эмитит рядом с `package.json` каждого сконвертированного расширения инертный
`MK2-CONVERSION.json`:

```jsonc
{
  "schemaVersion": 1,
  "source": { "repository": "modkitx", "manifests": ["extensions/.../codec.manifest.json"] },
  "verdict": "mechanical" | "convertible-with-rework",
  "codecs": {
    "org.modkitx/<id>": {
      "lostPlanes": [{ "plane": "viewer", "entrypoint": "…" }],   // всё, что v1 объявлял, а v2-манифест не несёт
      "renames": [{ "from": "image.compressed.read", "to": "image.compressed-read" }],
      "converterDefaults": ["variants:pair", "permissions:union", …],   // то, что не выведено из v1
      "droppedOperations": ["…"],                                        // v1 op id без handler'а
      "needsSignatures": true,                                           // см. задачу E
      "portState": "port-pending" | "ported"
    }
  }
}
```

Слово `capability` как ключ запрещено (гейт) — используй `lostPlanes`/`planes`. Файл входит в
byte-stable вывод и в `--check`. Тест: заметки для фикстур со split-вердиктом содержат
`lostPlanes[].plane === 'viewer'`.

### Задача D2 — `--rework` становится режимом закоммиченного дерева

После D: `pnpm convert:mk2` **без флага** = mechanical + rework (флаг `--mechanical-only`
оставь для отчёта/сравнения). `check:mk2` сравнивает с теми же флагами. Регенерируй дерево
(ожидаемо +23 расширения-кодека, `sc2-runtime` по-прежнему пропущен с причиной), `earth-res`
переводится в пропуск `format-definition-pending` (REPORT §9 п.6). Инвентарный и legacy гейты на
дереве чистые.

### Задача E — сигнатуры вместо `pathGlobs: ["**/*"]`

- Конвертер: v1 `magic` (если объявлен) → `match.signatures` формата S3
  (`{ from: 'start'|'end', offset, bytesHex[, maskHex] }`, ограничения схемы: offset ≤ 4096,
  паттерн 1–64 байта, ≤ 8 правил). Единственный glob `**/*` **опускается**; если после этого у
  кодека нет ни одного правила — `needsSignatures: true` в заметках, кодек всё равно эмитится
  (он inventory-eligible; просто не кандидат по имени/пути до порта).
- Порт восьми контейнеров (`flv swf ogg opus mp4 mpeg ogv webm`): добавь сигнатуры из
  общеизвестных magic с указанием источника (RFC/спецификация) в README расширения; `swf` уже
  портирован — досигнатурь. Тест acceptance для `swf` открывает по **голому имени** файла
  (basename), доказывая маршрутизацию по сигнатуре (`x3.host/signature-match` в кандидате).

### Задача F — синтетический корпус

`packages/testkit/scripts/gen-synthetic-corpus.mjs` генерирует детерминированные минимальные
валидные файлы (комментарий у каждого — раздел спецификации): `wav` (RIFF/WAVE, PCM 8 бит,
4 сэмпла), `bmp` (BITMAPINFOHEADER 1×1 24 бит), `gif` (GIF89a 1×1, без LZW-хитростей — таблица
кодов минимальная), `tar` (ustar, один файл `hello.txt`), `gz` (deflate stored-block «hello»),
`png` (1×1, для перекрёстной проверки с bundled), `jpg` — из корпуса (34 файла реальные, не
генерировать). Вывод в `packages/testkit/test/fixtures/mk2-synthetic/` byte-stable; `--check`
режим генератора; harness помечает `corpus: 'real' | 'synthetic'` в отчёте и в тесте.

### Задача G — порт-кампания, волна 1 (по одному коммиту-шагу внутри слайса не нужно; отчётная таблица)

Порядок — по доказуемости: сначала то, что есть в реальном корпусе, потом синтетика:
`jpg` (real), затем `wav`, `bmp`, `gif`, `tar`, `gzip` (synthetic), затем восьмёрка контейнеров
из задачи E (у `swf` — реальный корпус). Для каждого: probe по magic/структуре, `open` с
descriptor'ом и ≥ 1 data source через codec-kit, оба варианта пересмотрены по REPORT §7.6/7.7
(node-only → без `portable`; permissions только у нуждающегося варианта), acceptance зелёный
(real или synthetic), `portState: 'ported'` в заметках. Что упирается в отсутствие контракта
(writer/edit/language) — не порти, зафиксируй в отчёте.

## Definition of Done

D+D2+E+F выполнены и покрыты тестами; дерево `extensions/mk2/**` регенерировано в новом
режиме; ≥ 12 кодеков `ported` (6 прежних + волна 1); `pnpm check` зелёный; отчёт
`REPORT_MK2_CONVERSION_2026-08-19.md` (или дополнение к текущему) со счётчиками
(converted / with-notes / needsSignatures / ported real / ported synthetic / port-pending),
находками и тем, что осталось владельцу.

## Что НЕ делать

Не менять `matchesGlob`; не эмитить viewer-contribution; не выдумывать `mediaTypes`; не
расширять корпус копированием чужих файлов; не трогать codec-kit (находки — в отчёт).
