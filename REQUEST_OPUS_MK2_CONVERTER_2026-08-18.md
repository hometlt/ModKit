# Запрос Opus: OPUS-MK2-01 — конвертер MK2→MK3, acceptance-harness и пилотные порты кодеков

Дата: 2026-08-18. Автор: Root/Fable. Baseline: `54a4ea0` (S4 закоммичен, `pnpm check` зелёный:
76 файлов / 647 тестов).

## Рамка и границы (обязательные)

- **Твой scope (пиши только здесь):** `scripts/convert-mk2.mjs`, `scripts/test/convert-mk2.test.ts`,
  `extensions/mk2/**` (новая область для конвертированного вывода), `packages/testkit/src/mk2-*`,
  `packages/testkit/test/mk2-*`, и один новый файл заметок `REPORT_MK2_CONVERSION_<дата>.md`.
- **Не трогай:** `packages/host/**`, `packages/sdk/**`, `packages/core/**`, `apps/**`,
  `extensions/common/**`, `extensions/_shared/**` (codec-kit читаешь, не меняешь), root
  `package.json` (кроме добавления одного script-алиаса `convert:mk2`, согласованного здесь),
  все гейты в `scripts/check-*.mjs`.
- `modkitx` (`C:/FILES/SC2Files/coding/modkitx`) — **строго read-only**, как в
  `scripts/report-mk2-allocation.mjs`.
- Никаких импортов из `modkitx` в исходники; данные — только чтение файлов скриптом.
- Коммитов не делаешь; по завершении — отчёт Root'у (файлы, счётчики, находки), Root коммитит.
- Словарь: `capability` запрещён как ключ/тип (`pnpm check:legacy`); используй
  `traits/operations/offers/permissions/facilities`.
- Каждый шаг заканчивается зелёным `pnpm check` (полным, не частичным).

## Контекст, который нужно прочитать до кода

1. `REPORT_MK2_ALLOCATION_2026-08-17.md` — карта: 206 кодеков (103 mechanical / 24 rework /
   79 needs-new-contract), маппинг полей v1→v2, таблица permissions, список unmappables.
2. `scripts/report-mk2-allocation.mjs` — уже парсит все MK2-манифесты; конвертер строится на его
   функциях чтения (вынеси общий парсер в `scripts/lib/mk2-manifests.mjs`, отчёт переключи на него —
   это единственное разрешённое изменение существующего скрипта).
3. `docs/MK3/27` §0.2/§6 (envelope и layout расширения), §12 acceptance; `docs/MK3/32` §3
   (method surfaces — конвертер их НЕ выдумывает: только для контрактов, у которых surface уже
   есть в стандартной таблице sdk).
4. Образец результата: `extensions/common/images/**` (package.json#modkit + contributions/*.json +
   src через `@modkitx-x3/codec-kit`).
5. `packages/host/test/subject-open.test.ts` — как выглядит продуктовое открытие и bounded probe.

## Задача A — `scripts/convert-mk2.mjs` (механический конвертер манифестов)

Детеминированный генератор: MK2-манифесты → каталоги `extensions/mk2/<family>-<name>/` c
`package.json#modkit` + `contributions/codec-*.json`. Правила:

- Обрабатывает **только** вердикты `mechanical` (задача A) и `convertible with rework`
  (задача A2, отдельный флаг `--rework`, применяет переименования из отчёта). `needs new contract`
  — пропуск с причиной в выводе, никаких заглушек.
- Маппинг полей — ровно тот, что в REPORT §«Field mapping» (kind→role, match.extensions/mediaTypes,
  probe ranges с cap 4096, permissions по таблице; `signatures` — только если в MK2 есть явные
  magic-байты, переводи в `match.signatures` формата S3: `{from, offset, bytesHex}`, bounded).
- `runtimeVariants`: `trusted-node` (`node`, trusted-in-process) + `portable`
  (`browser-worker`,`node-worker`, worker-brokered) — как у bundled; `requestedPermissionClasses`
  из таблицы отчёта (обычно `['read-source']`).
- Entrypoint: `./src/codec.js`, который生成ся как **скелет** через codec-kit: `probe` реализован
  честно по magic/структуре из MK2-манифеста (если данных мало — `confidence: 0` и TODO-комментарий,
  НЕ ложная единица), `open` бросает `ModkitError('x3.mk2/port-pending')` до ручного порта.
- Выход детерминирован (byte-stable при повторном прогоне; сортировки как в canonicalJsonStringify).
- `--check`-режим (для CI позже): регенерирует во временную папку и сравнивает.
- Тесты `scripts/test/convert-mk2.test.ts`: 3–4 фикстурных MK2-манифеста (скопируй как inert
  фикстуры в `scripts/test/fixtures/mk2/`, пометь `@modkit-legacy-input-fixture` в первых 400
  байтах — см. правило гейта) → снапшот результата; unmappable → пропуск с причиной; повторный
  прогон byte-stable; **все** сгенерированные манифесты проходят production-registry валидацию
  (`buildInventory` + `inventoryEligible === true`).

## Задача B — acceptance-harness (не строгий parity)

`packages/testkit/src/mk2-acceptance.ts` + тест: для каждого конвертированного расширения с
реализованным `open`:

1. `loadExtensionDirectory` → `buildInventory` → `openSubject` над файлом-образцом из корпуса
   `modkitx` (пути к образцам — данными в `packages/testkit/test/fixtures/mk2-corpus.json`:
   относительный путь в modkitx + ожидаемый codecId + минимальная уверенность; файлы НЕ копируются,
   читаются с диска read-only; тест skip'ается, если modkitx отсутствует — CI-safe).
2. Ассерты: probe ≥ порога и выбран нужный кодек; descriptor валиден (это уже делает openSubject);
   один tree/table/byte-range dataSource отвечает на первый запрос; dispose освобождает.
3. Отчёт-таблица в конце: converted / probing / opening / pending — печатается тестом и
   фиксируется в `REPORT_MK2_CONVERSION_<дата>.md`.

## Задача C — пилотные порты (докажи конвейер, не вычерпывай)

Портируй **6 кодеков** реального `open` через codec-kit, по одному на семейство:
`image/bmp`, `image/gif` (или `ico`), `archive/tar` (или `gzip`), `audio/wav`, `model/obj`,
`document/…` из mechanical-списка. Критерий выбора: формат с простым контейнером и без native-зависимостей.
Каждый: probe по magic + open с descriptor'ом и хотя бы одним data source; harness задачи B зелёный
на реальном файле из корпуса. **Не** переноси SC2-специфичные форматы (это vendor-репозиторий по
27 §0) и ничего из `needs new contract`.

## Порядок и Definition of Done

A → тесты A → B → C (по кодеку за шаг, каждый с зелёным `pnpm check`) → A2 (`--rework`).
Done: конвертер + тесты; ≥100 mechanical-манифестов конвертируются валидно (счётчик в отчёте);
6 пилотов открываются через `openSubject` с acceptance-harness'ом; отчёт Root'у со счётчиками,
списком unmappables по причинам и находками (что в маппинге отчёта оказалось неточным — не чини
молча, запиши).

## Что НЕ делать

Не изобретать новые контракты/поля схем; не менять гейты; не добавлять зависимостей; не «улучшать»
codec-kit (находки — в отчёт); не публиковать конвертированное в `extensions/common`.
