# Итоговый отчёт Sol — блок 8 завершён

Дата закрытия: 2026-08-24

Ветка: `spec/mk3-extension-reference`

Канон сравнения: `C:\FILES\SC2Files\coding\modkitx` @
`1a14ba4eddd0ae88de273348ebd44cfb98a0581d`

## 1. Результат

Блок 8 закрывает порядок в расширениях и доказанную C&C 3 / EA 3D-вертикаль:

1. Testkit теперь явно освобождает принадлежащие ему файловые источники во всех путях успеха и
   отказа. Acceptance под `node --trace-warnings` не выдаёт FileHandle/DEP0137 warnings.
2. Electron использует актуальный объект `console-message` event details. Live selftest завершился
   без positional-API deprecation warning.
3. Правила дробности и лабораторной внутренней раскладки записаны в
   [docs/DIVERGENCE_RU.md](docs/DIVERGENCE_RU.md). `sage-asset-bundle` не подменён фиктивным
   codec-ом: канон не содержит parser/runtime/fixture, а необходимая follow-up задача описана
   отдельно.
4. Parity report поднят до schema v2: наблюдения разделены по source kind, формат получает худший
   результат своих sources, пропуски видимы, а отчёт хранит SHA канона и X3.
5. Семь EA staging-пакетов расселены по `ea/archives`, `ea/big`, `ea/emperor`, `ea/models`,
   `ea/sage`, `ea/tiberian-sun`, `ea/westwood`. Перенесено 18 contributions; число staging-семейств
   уменьшилось с 31 до 25 без потери портов.
6. Углублены BIG, C&C 3 XML/CSF/MAP, SkuDef и Emperor XBF. Установленная C&C 3: Kane's Wrath
   проходит цепочку `BIG → entry → product-owned openSubject → semantic/model/raster source`.
7. W3X, W3D и VXL отдают настоящий `common.view/model-scene-source`: позиции, индексы, normals/UV,
   material ids, bounds и UVM-согласованное преобразование базиса. VXL строит внешнюю поверхность
   вокселей с удалением внутренних граней.
8. Эти три формата доказаны через deterministic headless PNG, реальный browser module worker с
   WebGL и live Electron. Three.js не попал ни в default app set, ни в browser/headless bundle.

Подробности переезда и UVM-аудита находятся в
[M4 relocation report](REPORT_SOL_BLOCK8_M4_EA_RELOCATION_2026-08-24.md) и
[UVM alignment report](REPORT_SOL_BLOCK8_UVM_ALIGNMENT_2026-08-24.md).

## 2. Доказанные реальные вертикали

### C&C 3: Kane's Wrath

`MODKITX_CNC3_ROOT=C:\Apps\CnC3KW` прошёл без skip:

- `English.big` → `cnc3.csf`: 7 260 localization rows;
- `Libraries.big` → MAP: 23 chunks;
- `Libraries.big` → `map.xml`: semantic XML source;
- `Misc.big` → `bowl.w3d`: decoded geometry, 1 mesh / 1 primitive;
- `Libraries.big` → TGA: 128×128 decoded RGBA8.

### Геометрия реального корпуса

| Формат | Результат                                 |
| ------ | ----------------------------------------- |
| W3X    | 1 mesh, 993 vertices, 2 436 indices       |
| W3D    | 12 meshes, 5 578 vertices, 17 211 indices |
| VXL    | 11 meshes, 4 868 vertices, 7 302 indices  |

### Emperor XBF

Каталог `C:\Apps\Emperor` на машине пуст, поэтому проверка использовала явно заданный внешний
retail corpus `Emperor-XBF-Retail`. Файл `atreides/infantry/AT_inf_H0.xbf` выбран codec-ом
`emperor-xbf`, безопасно прочитан через bounded header и отдал три texture references. Геометрия
XBF намеренно остаётся metadata-only.

### Electron live selftest

Electron был собран и запущен на отдельном `--user-data-dir`, двух явных extension folders и
маленькой папке из трёх fixtures. Exit code — 0.

| Fixture | Выбранный codec                       | Confidence | Stages                    |
| ------- | ------------------------------------- | ---------: | ------------------------- |
| VXL     | `org.modkitx/red-alert2-vxl/portable` |       99 % | `model=ok tree=ok hex=ok` |
| W3D     | `org.modkitx/westwood-w3d/portable`   |       99 % | `model=ok tree=ok hex=ok` |
| W3X     | `org.modkitx/sage-w3x/portable`       |       98 % | `model=ok tree=ok hex=ok` |

Прогон напечатал `selftest: done`; FileHandle/DEP0137 и Electron `console-message` deprecation
warnings отсутствовали.

## 3. Финальный parity v2

Отчёт [reports/parity/latest.json](reports/parity/latest.json) снят против неизменённого SHA
канона `1a14ba4eddd0ae88de273348ebd44cfb98a0581d`. X3 SHA наблюдаемого code/manifest state —
`91a91150e5ae1c34a5db64a55d7187e20f8adfa3`; последующий commit только записывает сам отчёт.

| Формат              | State    | Классификация |
| ------------------- | -------- | ------------- |
| `big`               | compared | паритет       |
| `big-real-cnc3`     | compared | паритет       |
| `cnc3-data`         | compared | паритет       |
| `cnc3-localization` | compared | паритет       |
| `cnc3-map`          | compared | паритет       |
| `glb`               | compared | паритет       |
| `gltf`              | compared | паритет       |
| `m3`                | compared | X3 богаче     |
| `png`               | compared | паритет       |
| `red-alert2-vxl`    | compared | X3 богаче     |
| `sage-skudef`       | compared | паритет       |
| `sage-w3x`          | compared | X3 богаче     |
| `westwood-w3d`      | compared | X3 богаче     |
| `zip`               | compared | паритет       |

Итог: 14 compared, 0 skipped, 0 `X3 беднее`, 0 `нет в X3`, массив `poorer` пуст.

## 4. Финальный M9 gate

Все стадии запускались последовательно, без параллельных генераторов в дереве:

- `pnpm build` — 65 bundle entries;
- `pnpm lint` и `pnpm format:check` — зелёные;
- `pnpm exec tsc -p tsconfig.tooling.json` — зелёный;
- targeted lifecycle/Electron/parity/relocation/SAGE/real-corpus/models/rendering — 25 files,
  206/206 tests;
- `pnpm test` после исправления найденного ratchet — 178 files, 1 489/1 489 tests, 534.45 s;
- `pnpm bench:universal:gate` — passed: CSV million-row 173.19 ms / 10.62 MiB, virtual 100 MiB
  line 0.18 ms, bigint hex 1.36 ms;
- schemas 16, UI manifests 16, tokens 193, themes 3, icons 9 PNG + ICO, facilities 28 + 1 legacy;
- apps 24 realm/set cases, legacy 954 files, imports 282 files, inventory 60 extension directories;
- MK2 converter — 251 generated files, 88 hand-ported modules skipped;
- `pnpm ports:check` — `TOTAL 168 / ported 168 / pending 0`;
- `pnpm parity` — exit 0 с таблицей выше;
- `pnpm bundle:check` — 65 entries byte-identical.

После поздней правки только текстовых geometry claims отдельно повторены extension inventory,
24 app cases, W3X/W3D/VXL + headless/browser tests (4 files, 16/16 tests) и bundle-check. Runtime-код
после полного `pnpm test` не менялся.

## 5. Найденные падения и изолированная перепроверка

1. Первый `pnpm build` нашёл stale `apps/web/generated/extension-catalog.js` после CUR fix. Каталог
   перегенерирован; повторная полная сборка прошла.
2. Первый lint нашёл пустой `async release()` в VXL fixture. Release сделан явным; file lint и VXL
   suite прошли, затем полный lint стал зелёным.
3. Первый format-check нашёл W3D codec и parity JSON. Оба отформатированы; real W3D corpus
   повторно дал 12 / 5 578 / 17 211, полный format-check прошёл.
4. Первый `pnpm test` дал единственный fail: converter test сохранял старый staging-ratchet
   `>=100` после планового переноса 18 contributions. Новый staging-ratchet — 88, а отдельный
   глобальный gate подтвердил 168/168. Focused suite прошёл 15/15; полный suite повторён целиком и
   прошёл 1 489/1 489.
5. При разработке W3D реальный файл выявил bounded protected/opaque tail после валидного root.
   Codec теперь принимает только этот точный top-level случай, сообщает `opaqueTailBytes`, но
   сохраняет строгую проверку дочерних chunks; synthetic и real suites повторены.

## 6. Что сознательно осталось за границей блока

- UVM exporter не добавлен в codec-пакеты. Это отдельный форматный/export contribution, а не
  обязанность `common/rendering-3d`; решение зафиксировано в UVM alignment report.
- W3X пока не декодирует animation tracks, hierarchy pivots, collision/FX semantics и companion
  includes/model parts/textures.
- W3D пока не декодирует animation tracks, hierarchy pivots, particles/dazzles и оставшиеся mesh
  variants; внешние textures/family files не разрешаются, protected tail только диагностируется.
- VXL не разрешает `.hva`, `.pal` и VPL sidecars; точная palette/lighting интерпретация остаётся
  follow-up.
- Emperor XBF не декодирует nodes, geometry, skeletal animation и FX runtime events.
- `sage-asset-bundle` ждёт полного multi-file corpus и bounded grouping/extraction runtime согласно
  `D-SAGE-1`.
- В `extensions/mk2/` остаются 25 перечисленных staging-семейств; их расселение — следующие блоки.
- VS Code Extension Development Host живьём не запускался по прямому правилу плана. Вместо этого
  прошли `contributes:check`, extension build и 12 test files / 69 tests.

## 7. Внешний/инструментальный риск

VS Code `ext:build` успешно создаёт CJS bundle, но esbuild печатает warning для
`import.meta.url` в [packages/host/src/node/worker-backend.ts](packages/host/src/node/worker-backend.ts#L117).
Код уже требует явный `bootstrapUrl` при CJS, а VS Code host его передаёт; 69 тестов прошли.
Устранение самого предупреждения требует отдельной настройки bundle/conditional entrypoint и не
входит в geometry/relocation scope блока 8.

## 8. Репозиторий и сохранность владельца

- `apps/electron/dist-app` и `apps/modkit-vscode/dist-app` восстановлены; tracked drift отсутствует.
- `scripts/bundle-hashes.json` возвращён byte-for-byte к пользовательскому SHA-256
  `B2149B7471A51B6DE224D5DE11D872964F1F0E8D8B854FD8DB0B553FD3C065B7`.
- Пользовательские `README.md`, `scripts/bundle-hashes.json`, `PLAN_SOL_BLOCK6_2026-08-23.md` и
  `REPORT_SOL_BLOCKS_1_5_SUMMARY_2026-08-22.md` не добавлялись в индекс и не коммитились.
- История блока проверена: каждый commit имеет
  `Co-Authored-By: Claude Sol <noreply@anthropic.com>`; push не выполнялся.
- Финальный `git diff --check` — чистый.
