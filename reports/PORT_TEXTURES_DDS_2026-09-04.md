# M0 / шаг 0.1 — DDS, 2026-09-04

Представлено владельцу на приёмку. Пять существующих Node-харнессов и migration:check завершились с exit 0 на чистом коммите ca54cdb83534e6b7d40afca8b32460590a67cb55, ветка sol/legacy-parity-textures. Это выход M0 из ROADMAP_MK3_CODEC_PORT_2026-09-04.md и шага 0.1 исполнительного плана; Z1–Z7 будущего TS-порта этим отчётом не объявляются выполненными.

## 1. Зафиксированный перенос и происхождение

Коммит: port(images): BC6H/BC7, compressed view, encoder, raster ops from MK2. 16 файлов, 1192 добавленные строки, 18 удалённых, WASM 146788 байт. Оркестратор сохранил существующий diff, не переписывал кодеки. Read-only аудит: Sol High (gpt-5.6-sol, high); блокеров сохранению M0 не выявил.

MK2 oracle: 1a14ba4eddd0ae88de273348ebd44cfb98a0581d. Используемый DDS src/ и gpu-texture-wasm.ts не имеют diff против пина. Остальные 1072 dirty-пути оракула не менялись. Корневого PROMPT.txt нет; найден и прочитан references/modkitmk2/PROMPT.txt, его старый docs/DOCUMENTATION_INDEX.md отсутствует.

Полные пути и SHA256 шести файлов MK2, 16 файлов коммита и шести harness/loader модулей: [source-digests.json](legacy-parity-textures-m0/source-digests.json). Это измеренные digest-ы M0; JSON provenance будущего побайтного TS-copy gate здесь не подменяется.

Vendor texture2ddecoder-wasm@1.2.2 совпал с MK2 node_modules и vendor README:

- texture2ddecoder.js: 0a2b33ff735566fd3184e0421ff38fb7578d1348b3cc44fc4646cce29d001110
- texture2ddecoder.wasm: 8b819b0622cce57f809b369081bdd6eca09d1c1793da7f82192db39229356c1d
- LICENSE: 49e3169a509b9a5311fe50957a334e9e1975164f27da6004358c22e91e10747c

## 2. Функции и поверхности

| MK2 | Место M0 в MK3 | Доступ |
|---|---|---|
| decodeDds / decodeDdsAsync, BC6H/BC7 | extensions/images/src/dds/codec.js, bptc.js, layout.js | common.view/raster-image-source@1, readRegion |
| readCompressedDds | extensions/images/src/dds/compressed.js | прямой package export; общий compressed-texture view-контракт ещё не опубликован |
| encodeDds, chooseDdsFormatForImage, createDdsImage/createRgbaImage | extensions/images/src/dds/encode.js, writers/dds-encoder.js | package export, writer common.edit/writer@1 |
| операции ops.ts | extensions/images/src/ops/raster-ops.js | прямой package export |

Существующие ограничения signed BC6H и encoder/mip, временные замены импортов loader-а сохранены и явно описаны в коде. Универсальный loader — шаг 0.3, общие контракты и TS — следующие вехи. Потери функций по решению оркестратора не утверждались и не регистрировались.

## 3. Повторённые команды и результаты

Cwd всех команд: C:/FILES/SC2Files/coding. Corpus передан явно: C:/FILES/SC2Files/Mods. --cap не переопределён; это штатная выборка по форматным корзинам (DDS 250, compressed 40, encode 20, ops 15), а не обещание сравнить каждый файл корпуса. Логи сохраняются полностью с SHA256 и exit code. Оригиналы CRLF находятся в artifacts; копии в git нормализованы в LF. В архивном receipt rawLogSha256 указывает оригинал, logSha256 — копию LF; текст stdout не изменён.

```powershell
node --experimental-strip-types artifacts/legacy-parity-textures/compare-legacy-dds.mjs --corpus C:/FILES/SC2Files/Mods
node --experimental-strip-types artifacts/legacy-parity-textures/compare-legacy-dds-bptc.mjs --corpus C:/FILES/SC2Files/Mods
node --experimental-strip-types artifacts/legacy-parity-textures/compare-legacy-dds-compressed.mjs --corpus C:/FILES/SC2Files/Mods
node --experimental-strip-types artifacts/legacy-parity-textures/compare-legacy-dds-encode.mjs --corpus C:/FILES/SC2Files/Mods
node --experimental-strip-types artifacts/legacy-parity-textures/compare-legacy-image-ops.mjs --corpus C:/FILES/SC2Files/Mods
pnpm --dir modkit-core migration:check
```

| Harness | Сравнено | Совпало по summary | Differing | Только legacy-refused | Явно подтверждены оба отказа | Exit |
|---|---:|---:|---:|---:|---:|---:|
| compare-legacy-dds | 1284 file | 1284 | 0 | 0 | 0 | 0 |
| compare-legacy-dds-bptc | 6400 surface | 6400 | 0 | 1280 | 0 | 0 |
| compare-legacy-dds-compressed | 417 file | 417 | 0 | 0 | 130 | 0 |
| compare-legacy-dds-encode | 770 case | 770 | 0 | 0 | 5 | 0 |
| compare-legacy-image-ops | 1895 case | 1895 | 0 | 0 | 9 | 0 |

Summary identical включает равные отказы и равные возвращённые значения, когда проверяется выбор формата. Отдельные legacy-refused не запускают MK3. Encoder ещё имеет три malformed-входа с равным исходом, но stdout не печатает accepted/refused для них; они не включены в столбец подтверждённых отказов.

BPTC: шесть синтетических DXGI-профилей, 1280 попыток каждый; 6400 сравнений и 1280 отказов только MK2 для BC7_TYPELESS. В этом corpus-прогоне BPTC-файлы не найдены. Compressed добавляет BC4/BC6H, signed/DX10-профили и геометрию mip/array/cube/volume. Encode добавляет размеры, заполнения, authoring и invalid-входы. Ops добавляет нечётные размеры, полоски и крайние alpha. Синтетика покрывает случаи вне текущей реальной выборки; сравнение идёт против кода MK2, не ожидаемых констант.

## 4. Тесты MK2 и единая поверхность

Собственные suites MK2 в M0 не исполнялись. Найдено 37 статических it: dds.spec.ts 15, dds-formats.spec.ts 21, png.spec.ts 1. Исполнено как MK2 unit tests: 0; зелёные/красные unit tests не заявляются. Oracle cases выше не являются количеством unit tests.

surfaces:check пока отсутствует в package scripts; вывод команды не заявляется. Его минимальная реализация запланирована M1. Старый installed-acceptance-texdds.receipt.json имеет verdict fail (missing MODKIT_VSCODE_ACCEPTANCE_DISABLED_URI); он не использован как зелёное evidence. Новая установленная приёмка не запускалась, поскольку она не входит в гейт M0.

## 5. Реестр

```text
migration:check registry: 1 check(s) UNAVAILABLE — not performed, and that is not the same as passed
migration:check registry: 38 known debt problem(s) — frozen in registry-debt-baseline.json, must be empty by wave 6; paying one down means deleting its line there in the same commit
migration:check registry: known debt 38 (must be empty by wave 6), new problems 0, stale baseline entries 0, unavailable checks 1 (must be restored by wave 6)
migration:check registry: 331 capabilities (deferred-games-priority 42, mk3-priority 135, multiverse-priority 10, post-ga 144); obligations experimental-optional 2, focused-required-addition 33, legacy-required 289, post-ga-required-proof 7; evidence E0 82, E1 133, E2 59, E3 23, E4 31, E5 3; 512 mapped + 608 unmapped = 1120 source units; 8 projection planes
migration:check registry: installed-host evidence on 3 row(s)
```

Изменённых capabilityId нет. Три E5 и замороженный baseline не менялись; unavailable 1 сохранён.

## 6. Git и передача

До и после шести гейтов git -C modkit-core status --porcelain вернул пустую строку. Blizzard также чист, ветка sol/ga-recovery-w2; M1 не начиналась. Кодовый коммит указан выше; этот отчёт и копии evidence фиксируются отдельным docs-коммитом на той же ветке. Финальный hash docs-коммита и status сообщает оркестратор после коммита.

Receipt: [receipt.json](legacy-parity-textures-m0/receipt.json); [preflight](legacy-parity-textures-m0/preflight.json); полный stdout — соседние *.log. Каноническая копия вне repo: artifacts/legacy-parity-textures/receipt.json. Повторять команды выше, сверяя commit и digest-ы. Git diff --check перед кодовым коммитом: exit 0.

Осталось в M0: пусто. M1 ожидает приёмки M0 владельцем согласно правилу последовательности в PROMPT_SC2_PORT_ORCHESTRATOR_2026-09-04.md. Решение владельца 2026-09-04 (явный ответ в этой задаче): scripts/*.mjs остаются JavaScript; T3, конверсия приложений, идёт параллельно переносу кодеков. Повторно спрашивать это решение не требуется.
