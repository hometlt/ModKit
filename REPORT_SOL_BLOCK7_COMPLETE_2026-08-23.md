# Отчёт Sol — блок 7 завершён

Дата: 2026-08-23  
Ветка: `spec/mk3-extension-reference`  
Канон `../modkitx`: использован только для чтения  
Push: не выполнялся

## 1. Что легло

### Порядок в `extensions/`

- `extensions/reference/` переименован в `extensions/_reference/`; README эталонов прямо
  называют контракты и тестовых потребителей.
- Удалён пустой остаток `packages/extensions-linked/`. Статическая линковка остаётся
  hand-authored в `src/linked.js` продуктовых расширений.
- Полностью расселены 11 затронутых семейств из `extensions/mk2/`:
  - в `extensions/common/`: `common-models`, `common-images`, `common-archives`,
    `common-audio`, `common-vector`, `common-video`, `common-containers`;
  - в `extensions/blizzard/`: `blizzard-models`, `blizzard-casc`, `blizzard-mpq`,
    `blizzard-starcraft2`.
- Для всех переехавших common-семейств обновлены product routes, contribution manifests,
  статические linked entries, app extension sets, Electron/PWA каталоги, тестовые переписи и
  lockfile. `common/containers` получил собственный `src/linked.js`.
- Шесть install-only каталогов, в которых оставался только `node_modules` без пакета, вынесены
  из репозитория в восстанавливаемое временное хранилище:
  `C:\Users\Admin\AppData\Local\Temp\modkitx3-block7-orphans-20260823`.

### Паритет

- Добавлен `scripts/parity/check.mjs` и команда `pnpm parity`.
- Гейт открывает одинаковые fixtures в каноне и X3, сравнивает descriptor surface, фактически
  доступные data sources и сохраняет снимок в `reports/parity/latest.json`.
- Отсутствие внешнего файла обозначается `skipped`, а не зелёным результатом.

### Геометрия и 3D-отрисовка

- glTF/GLB теперь декодируют позиции, индексы, нормали и UV в настоящий
  `common.view/model-scene-source`.
- M3 декодирует геометрию регионов; реальный SC2 fixture дал две примитивные области и 242
  вершины.
- Добавлено продуктовое опциональное расширение `extensions/common/rendering-3d`:
  - детерминированный headless CPU backend;
  - browser WebGL backend;
  - PNG encoder для headless результата.
- Эталонный `_reference/software-renderer` и продуктовый backend проходят один contract suite.
- GLB и M3 проходят codec → typed geometry → renderer → PNG tests.
- Browser backend проверен в настоящем browser worker.

### StarCraft II

- `m3`, `dds`, `sc2-data`, `sc2-strings`, `sc2-layout`, CASC и MPQ находятся в целевых
  Blizzard/common расширениях, а не в staging `mk2`.
- DDS отдаёт декодированный RGBA8 raster; SC2 data/string/layout codecs отдают заявленные
  деревья/таблицы.
- Добавлен живой тест установленной игры: обнаружение SC2, разрешение зависимостей, CASC,
  вложенный MPQ, M3 и DDS.

## 2. Доказательство

### Финальные gates

| Проверка                                              | Результат                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm build`                                          | passed; 4 Electron catalogs checked; web catalog checked; 65 entries bundled, 278 modular files pruned |
| `pnpm lint`                                           | passed, 0 warnings                                                                                     |
| `pnpm format:check`                                   | passed                                                                                                 |
| `pnpm exec tsc -p tsconfig.tooling.json`              | passed                                                                                                 |
| targeted relocation/linked suites                     | 4 files, 108/108 tests                                                                                 |
| `pnpm test`                                           | 174/174 files, 1451/1451 tests, 403.63 s                                                               |
| `pnpm bench:universal:gate`                           | passed: CSV 159.21 ms / 10.62 MiB; virtual text 0.30 ms; bigint hex 1.15 ms                            |
| schemas/manifests/tokens/themes/icons/facilities/apps | all passed                                                                                             |
| legacy/imports/extensions/MK2 conversion              | all passed                                                                                             |
| `pnpm ports:check`                                    | 106 total, 106 ported, 0 pending                                                                       |
| Electron/PWA catalogs                                 | checked                                                                                                |
| `pnpm bundle:check`                                   | 65 entries byte-identical                                                                              |
| `pnpm parity`                                         | passed; glTF, GLB и M3 классифицированы `X3 богаче`                                                    |

Acceptance вывел: `converted 106`, `ported 106`, `port-pending 0`, 9 открытий на real corpus и
172 на synthetic corpus.

### Живая SC2-цепочка

Установленная игра проверена без копирования файлов владельца в репозиторий:

- M3:
  `campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3`
  → `2 primitive(s), 242 decoded vertices`;
- DDS:
  `campaigns/liberty.sc2campaign/base.sc2assets/assets/textures/alpha2.dds`
  → `32x32, decoded RGBA8`;
- CASC → MPQ → DDS:
  `mods/liberty.sc2mod/base.sc2data/battlenetcache/fc2161abf876306f1a0467cfacf5e513cba4281fdc13532b440e8c8abb8835ac.s2ma/Daybreak_Overview.dds`
  → `592x480`;
- реальный MPQ: 52 entries; textures `Daybreak_Overview.dds`, `GSL Loading.dds`.

В выбранном реальном `.s2ma` M3 не было, поэтому утверждение «M3 извлечён именно из этого MPQ»
не делается: реальный M3 доказан отдельным путём через CASC, а вложенная цепочка — на DDS.

### Живой Electron

Финальный запуск использовал отдельный профиль и маленькую папку fixtures:

```text
node_modules/.bin/electron.CMD electron/main.cjs
  --user-data-dir=C:\Users\Admin\AppData\Local\Temp\modkitx3-block7-electron-profile-final
  --open C:\Users\Admin\AppData\Local\Temp\modkitx3-block7-electron
  --extension-folder C:\Users\Admin\AppData\Local\Temp\modkitx3-block7-extension-folders\ok
  --extension-folder C:\Users\Admin\AppData\Local\Temp\modkitx3-block7-extension-folders\junk
  --selftest --enable-logging
```

Ключевые строки:

```text
triangle.glb -> org.modkitx/model-gltf/portable (97%)
triangle.glb stages model=ok tree=ok hex=ok
triangle.gltf -> org.modkitx/model-gltf/portable (97%)
triangle.m3 -> org.modkitx/m3/portable (99%)
triangle.m3 stages model=ok tree=ok hex=ok
selftest: done
```

Для glTF/GLB/M3 прошли model/tree/hex и панели operations/metadata/properties/diagnostics.
Selftest также добавил, выключил, включил и удалил валидное внешнее расширение и отказал
невалидному.

Первая попытка без scripted `--extension-folder` остановилась на ожидающем native dialog и была
прервана. Это исправлено изолированным повтором с явными аргументами; продуктового дефекта эта
попытка не показала.

Browser проверен реальными Playwright/browser-worker тестами. VS Code Extension Development Host
живьём не запускался согласно заданию; его extension roots, settings, subject RPC, view policy,
editing и сборка доказаны тестами, но ручная живая сцена в VS Code остаётся непроверенной.

### Падения, перепроверенные отдельно

1. Build сначала сообщил stale Electron catalog, затем stale PWA catalog. Оба пересозданы
   штатными генераторами; финальный build прошёл.
2. Первый targeted run: 190/191 — converter test всё ещё ссылался на старый common-audio staging
   path. После исправления этот suite прошёл 13/13.
3. Первый полный suite: 1423/1451 — 28 relocation-хвостов в audio/archive tests и product
   `src/linked.js`. Исправлены сами product entries; четыре связанные suite прошли 108/108.
4. Следующий полный suite: 1450/1451 — PWA attestation содержала старые хэши linked-модулей.
   `apps/web/test/subject-services.test.ts` отдельно прошёл 3/3 после штатной регенерации.
5. Финальный полный suite: 1451/1451.

## 3. Срез паритета

| Формат | Канон             | X3                 | Классификация |
| ------ | ----------------- | ------------------ | ------------- |
| glTF   | decoded, 1 source | decoded, 6 sources | X3 богаче     |
| GLB    | decoded, 1 source | decoded, 5 sources | X3 богаче     |
| M3     | decoded, 1 source | decoded, 3 sources | X3 богаче     |

Полный машинный снимок: `reports/parity/latest.json`.

## 4. Дефекты вне зоны блока

1. `packages/testkit/src/mk2-acceptance.ts:284`–`291`: `corpusByteSource()` создаёт
   `openFileSource()`, но возвращаемая обёртка не обеспечивает детерминированный вызов его
   `dispose()`. Реализация закрытия существует в `packages/host/src/node/file-source.ts:76`–`80`.
   Итог — массовые Node `DEP0137` / `Closing file descriptor ... on garbage collection` в полном
   suite. Сейчас это warning; будущий Node обещает превратить такое закрытие в error.
2. `apps/electron/electron/main.cjs:1052`: обработчик `console-message` использует устаревшие
   позиционные аргументы Electron. Живой selftest проходит, но Electron печатает deprecation
   warning; обработчик нужно перевести на новый event shape отдельно.

## 5. Что не сделано и почему

Полное исчезновение `extensions/mk2/` не требовалось в одном блоке. Все 11 семейств, затронутых
приоритетом common + SC2 + 3D, расселены. Остались 31 независимое семейство:

1. `adobe-flash`
2. `annihilation-gas-powered`
3. `audiokinetic-wwise`
4. `blizzard-common-formats`
5. `blizzard-diablo`
6. `blizzard-warcraft-3`
7. `cavedog-total-annihilation`
8. `ea-archives`
9. `ea-emperor`
10. `ea-models`
11. `ea-sage`
12. `ea-tiberian-sun`
13. `ea-westwood`
14. `epic-games-unreal-engine`
15. `firelight-fmod`
16. `microsoft-age-series`
17. `microsoft-halo-wars`
18. `new-world-computing-heroes-3`
19. `new-world-computing-heroes-4`
20. `opensource-spring`
21. `opensource-warzone-2100`
22. `petroglyph-glyphx`
23. `rad-game-tools-video`
24. `realitypump-earth-2150`
25. `realitypump-earth2160`
26. `relic-essence`
27. `relic-models`
28. `stainless-steel-studios-empire-earth`
29. `ubisoft-heroes-6`
30. `uncommon-documents`
31. `unity-engine`

Оценка полного расселения: 13–19 сфокусированных инженерных дней. Малые семейства занимают
около 0.25–0.5 дня, крупные (`uncommon-documents`, `microsoft-age-series`, `ea-westwood`,
`relic-essence`, Unreal/Unity) — 1–2 дня каждое из-за product sets, каталогов, linked entries,
переписей и отдельных живых/packed проверок. Кодеки уже ported 106/106; оценка относится к
физическому расселению и доказательству маршрутов, а не к переписыванию декодеров.

## 6. Git status и коммиты

Изменения блока разложены на 29 локальных коммитов, включая этот отчёт; каждый содержит требуемый trailer
`Co-Authored-By: Claude Sol <noreply@anthropic.com>`. Push не выполнялся.

Перед финальным отчётом восстановлены генерируемые Root пути:

- `apps/electron/dist-app` — `git restore --worktree`;
- `scripts/bundle-hashes.json` — восстановлен из сохранённой пользовательской версии; SHA-256
  до и после сборок совпал:
  `B2149B7471A51B6DE224D5DE11D872964F1F0E8D8B854FD8DB0B553FD3C065B7`.

После коммита этого отчёта ожидаемый `git status --short` содержит только существовавшие до
блока пользовательские изменения, которые не включались в коммиты:

```text
 M README.md
 M scripts/bundle-hashes.json
?? PLAN_SOL_BLOCK6_2026-08-23.md
?? REPORT_SOL_BLOCKS_1_5_SUMMARY_2026-08-22.md
```
