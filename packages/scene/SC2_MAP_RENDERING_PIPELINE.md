# Конвейер рендеринга карт StarCraft II

Актуально на 2026-09-21. Документ описывает рабочий product route карты: от
`.SC2Map` и зависимостей до WebGL-кадра. Он также фиксирует известные ограничения,
измерения Amphion и приоритеты оптимизации.

Связанные изменения: `modkit-core` `60e091ec`,
`modkit-extensions-blizzard` `065774b8`.

## Краткая схема

```text
.SC2Map + установленная SC2
  -> preview provider и dependency closure
  -> разбор map documents + resolved catalog
  -> SC2 semantic world facets
  -> host-owned WorldSceneSource
  -> M3/DDS resources
  -> WorldWebGlPlan
  -> shadow map
  -> opaque terrain/cliffs/models
  -> splats/projectors/transparency/water/effects
  -> SSAO/tone mapping/Colorization LUT
  -> canvas или headless PNG
```

Принцип владения важен: SC2 extension знает форматы и игровые данные, host
собирает каноническую сцену, а `@modkit/scene` остаётся форматно-нейтральным
рендерером. Не следует добавлять в scene прямое чтение MPQ/CASC, имена SC2
актеров или особые пути к game assets.

## 1. Открытие карты и зависимостей

Координатор host находится в
`packages/host/src/maps/index.ts` (`coordinateMapPreviewAssetSession`). SC2 preview
provider находится в соседнем репозитории:

```text
../modkit-extensions-blizzard/starcraft2/modules/map/providers/preview/runtime.js
```

`prepareStarcraft2MapPreview`:

1. открывает карту как пакет;
2. читает `DocumentInfo` и карту зависимостей;
3. строит closure `.SC2Mod`/`.SC2Campaign` через установку SC2 и Modkit resource
   session;
4. находит обязательные и необязательные документы карты;
5. передаёт их semantic provider, не обходя публичный resource route.

Node-side разрешение ресурсов установки находится в
`packages/host/src/node/map-preview-resource-resolver.ts`.

## 2. Документы карты и semantic analysis

План входов строит `planStarcraft2Map` в
`../modkit-extensions-blizzard/starcraft2/modules/map/providers/semantic/runtime.js`.
В текущем маршруте используются:

- `Objects`, `Regions`;
- `t3HeightMap`, `t3Terrain.xml`;
- `t3SyncPathingInfo`, `t3SyncTextureInfo`, `t3TextureMasks`;
- `t3Water`, `WaterData.xml`;
- `t3SyncCliffLevel`, `t3FluffDoodad`;
- `t3VertCol`.

Host читает запланированные документы в `analyzeResolvedMapWorkspace` из
`packages/host/src/maps/index.ts`, после чего вызывает
`openStarcraft2Map`/`analyzeStarcraft2MapWorkspace` semantic provider-а.

Результат — не готовые draw calls, а независимые facets: terrain,
terrain-materials, water, cliffs, objects, regions, resources, navigation,
gateways и lighting. Частичные данные допускаются только с явными diagnostics.

## 3. Resolved Data, актеры и выбор модели

Путь объекта обычно выглядит так:

```text
placed Unit/Doodad
  -> resolved Unit/Doodad catalog entry
  -> Actor
  -> inherited Actor Events и macros
  -> Model data entry
  -> логический M3 resource
```

Разрешение presentation actor вынесено в:

```text
../modkit-extensions-blizzard/starcraft2/modules/map/providers/semantic/actor-presentation.js
```

Поддерживаемые события включают `ActorCreation`, `ModelSwap`,
`AnimGroupApply/Remove`, `AnimPlay` и `AnimSetTimeScale`. Через этот же слой
должно определяться состояние истощённых минералов; нельзя подменять модель по
строковому имени в renderer. Анимации растений и doodads также должны приходить
из actor presentation и sampled model time.

Это всё ещё неполная эмуляция actor runtime SC2. Сложные условия, lifecycle,
site operations, некоторые material/effect события и динамические состояния
могут не воспроизводиться.

## 4. Terrain, ramps, cliffs и vertex color

Парсер `t3VertCol` находится в:

```text
../modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages/maps-processing/src/sc2-map-core/formats/vertex-color.ts
```

Поддержаны записи VTCL версий 103 и 104. Регулярная запись texture 0, layer 1,
blend 0 интерпретируется как скалярная vertex AO lattice и передаётся в альфу
цвета terrain batch. Эта альфа не является прозрачностью terrain.

Texture masks разбираются semantic provider-ом. Геометрия cliff tiles строится
в:

```text
../modkit-extensions-blizzard/starcraft2/modules/map/shared/cliffs.ts
../modkit-extensions-blizzard/starcraft2/src/lib/mk2/packages/maps-processing/src/sc2-map-core/cliff-tiles.ts
```

Cliff pieces публикуются как специальные object instances с provenance
`derivedFrom: cliffs`. В `packages/scene/src/world/webgl.ts` выполняется
renderer-side подготовка стыков: локальная коррекция высоты, вырезание terrain
под стеной, заполнение crest/top и соединение ramp edges. Эта часть чувствительна
к black seams: изменение triangulation, AO или depth bias необходимо проверять
одновременно на прямых и диагональных ramps.

## 5. Каноническая сцена host

`packages/host/src/maps/world-source.ts` и
`createCandidateWorldSceneLease` превращают semantic snapshot в
`CandidateWorldSceneSource`/`WorldSceneSource`.

Здесь:

- нормализуются facets и coordinate transforms;
- SC2 `x, y, z-up` переводится в renderer UVW `x, z, -y`, `y-up`;
- выдаются страницы объектов и ресурсов;
- открываются модели и текстуры через resource ports;
- работают `materialModelCache` и `modelTextureCache`;
- lease гарантирует освобождение связанных ресурсов.

Функция сейчас слишком крупная: около 1563 строк, cyclomatic complexity 53 и
cognitive complexity 96 по codebase graph. Разделять её следует по facets при
следующих содержательных изменениях, сохраняя единый lease и cache ownership.

## 6. M3 и DDS

M3 codec и его material conversion находятся в соседнем репозитории:

```text
../modkit-extensions-blizzard/models/src/m3/codec.js
../modkit-extensions-blizzard/models/src/m3/runtime/material.js
../modkit-extensions-blizzard/models/src/lib/mk2/m3/src/builder/standard-material.ts
../modkit-extensions-blizzard/models/codecs/m3/codec.json
```

M3 route публикует geometry, nodes, skeleton, animations, materials, sockets,
effects и texture references в нейтральную модель. Особые модели воды и волн
(`Elescaro Waves`, `Compound Sewers Water Effect`) должны исправляться в M3
material/effect conversion или общем effect renderer, а не рисоваться отдельным
SC2-only quad в map provider.

DDS регистрируется через:

```text
extensions/images/src/dds/codec.js
extensions/images/src/dds/compressed.js
extensions/images/contributions/codec-dds.json
```

Terrain textures открываются из `world-source.ts` тем же resource contract.

## 7. WebGL plan и кадр

UI запрашивает world/model data в `packages/ui/src/world/index.ts`. Основной
план строит `createWorldWebGlPlan` в `packages/scene/src/world/webgl.ts`.

План содержит batches для terrain, cliffs, exact splats, water, opaque и
transparent models, particles/projectors, debug primitives и picking. Он
retained: при неизменной сцене повторные кадры используют тот же plan и GPU
resources.

Порядок кадра в общих чертах:

1. подготовка/переиспользование plan и material resources;
2. shadow map;
3. opaque terrain, cliffs и M3 batches;
4. splats, decals и projectors;
5. transparent M3, water и effects;
6. depth-aware water/effect composition;
7. SSAO, HDR tone mapping, Colorization LUT и gamma policy;
8. picking/statistics при необходимости.

Ключевые файлы:

- `packages/scene/src/world/webgl.ts` — plan, retained renderer, shadow/main
  passes;
- `packages/scene/src/materials/standard-program.ts` — основной shader program;
- `packages/scene/src/render/material-webgl.ts` — material draw preparation;
- `packages/scene/src/uvm/projector-material.ts`, `projectors.ts`,
  `projector-receivers.ts` — projectors/splats;
- `packages/scene/src/uvm/effects.ts`, `effect-particles.ts` и
  `packages/scene/src/render/simple-effect.ts` — эффекты;
- `packages/scene/src/world/tone-mapping.ts` и `colorization.ts` — postprocess.

`createWorldWebGlPlan` является главным maintainability hotspot: около 1734
строк, cyclomatic complexity 167, cognitive complexity 451, 67 циклов, до пяти
уровней вложенности и 15 linear scans внутри циклов. Это не доказательство
конкретного bottleneck, но сильный сигнал для профилирования и аккуратного
выделения чистых facet builders.

## 8. Headless/диагностический payload

`world.json + world.bin` — диагностический и regression route, а не обязательный
production format. Amphion payload создаёт
`../modkit-extensions-blizzard/starcraft2/test/amphion-product-route.test.ts`.
Его рендерит `scripts/render-world-payload.mjs`, используя тот же production
renderer в headless browser.

Пример:

```powershell
node scripts/render-world-payload.mjs `
  --payload ../artifacts/lighting/payload-complete `
  --out ../artifacts/lighting/render-final-objects `
  --cameras ../artifacts/appearance/cameras.json `
  --size 1280x1280 --backend gpu --benchmark 5
```

`--terrain-only` исключает обычные objects/doodads, но оставляет terrain,
cliffs и water. `--lighting-effects 0` — A/B режим новых lighting effects, а не
точная копия старого SC2 shader pipeline. Overview camera сохраняет требуемый
поворот карты на 90 градусов против часовой стрелки.

## 9. Оценка текущего состояния

| Область                  | Оценка | Почему                                                                   |
| ------------------------ | -----: | ------------------------------------------------------------------------ |
| Архитектурное разделение |   8/10 | Форматы, host scene и renderer разделены; ресурсы идут через Modkit      |
| Наблюдаемость            |   7/10 | Есть diagnostics, receipts, CPU/GPU counters и product-route fixture     |
| Визуальная точность SC2  |   6/10 | Terrain/cliffs значительно улучшены, но нет полной material/actor parity |
| Поддерживаемость         |   5/10 | Хорошие контракты, но plan/world-source стали очень крупными             |
| Загрузка и память        |   3/10 | Холодная конвертация моделей и несколько представлений данных дороги     |
| Full-map runtime         |   3/10 | Статичный overview с объектами пока не интерактивен                      |

Итог: процесс не плохой — фундамент и ownership правильные. Но реализация
полного object-heavy кадра по производительности пока prototype-grade. Улучшать
следует узкие места внутри существующих границ, а не создавать второй renderer
или второй SC2 loader.

## 10. Измерения Amphion

Замеры 1280 x 1280 на Chrome/ANGLE, Intel Graphics, D3D11:

- холодный product-route acquisition: 192.665 s;
- model conversion: 185.793 s, то есть около 96% acquisition;
- terrain textures: 6.808 s;
- typed-array payload: 230,741,844 bytes;
  - models: 147,773,268 bytes;
  - terrain textures: 82,968,576 bytes;
- 10,742 object instances и примерно 1.79 млн model triangles;
- objects plan: 375,974,896 bytes;
- известные GPU allocations: 270,796,212 bytes.

Последняя короткая выборка из пяти статичных кадров с `gl.finish`:

| Режим                         | Первый draw | Медиана кадра | Условный FPS |
| ----------------------------- | ----------: | ------------: | -----------: |
| Objects + effects             |    14.079 s |      987.4 ms |        1.013 |
| Objects, lighting effects off |    13.411 s |      703.2 ms |        1.422 |
| Terrain-only + effects        |     3.550 s |       12.0 ms |       83.333 |

Это не гарантированный игровой FPS. Выборка мала, первый кадр включает plan
build/прогрев, значения заметно колеблются. Payload, plan, JS heap и GPU bytes
могут владеть общими данными, поэтому их нельзя просто складывать. JS heap
особенно зависит от момента GC.

Вывод из измерений надёжен только на уровне приоритета: bottleneck — модели,
их подготовка, материализация экземпляров и object draw path; базовый terrain
renderer сам по себе достаточно быстрый.

## 11. Приоритетный план оптимизации

### P0: сначала сохранить корректность

- Зафиксировать reference renders и pixel/region checks для ramps, cliff tops,
  splats, белых зонтиков, foliage alpha edges, water/effect M3 и направления
  теней.
- Fresh product-route payload должен давать тот же результат, что повторный
  прогон из кеша.
- Любая оптимизация обязана сохранять actor-derived model/animation state,
  transparency order и resource diagnostics.

### P1: наибольшая ожидаемая отдача

1. **Persistent converted-model cache.** Ключ: content digest + codec/version +
   conversion options. Кеш должен переживать повторное открытие карты. Это
   напрямую атакует 185.8 s model conversion.
2. **GPU instancing повторяющихся статичных моделей.** Хранить одну local-space
   geometry и массив transforms/team colors для одинаковых doodads, cliff
   pieces и props; не разворачивать geometry для каждого экземпляра.
3. **Разделить static plan и dynamic state.** Terrain, static geometry и
   материалы остаются неизменными; на animation frame обновляются только
   transforms, skinning/effects и действительно изменившиеся buffers.
4. **Убрать дубли ресурсов.** Reference-counted decoded texture/model cache;
   освобождать исходные binary/CPU copies после успешной GPU upload, если они
   не нужны для edit/inspection lease.
5. **Профилировать material draws.** Кешировать VAO/static bindings, сокращать
   state/uniform switches, отдельно измерить shadow, opaque, transparency,
   effects и postprocess.
6. **Bounded parallel conversion.** Сохранять ограниченный параллелизм, но
   исключить одновременную конвертацию одного logical model ID и измерять каждый
   read/resolve/decode/convert этап.

### P2: масштабирование и latency

- Frustum/distance culling и LOD для close/isometric камер. Overview видит почти
  всю карту, поэтому один culling не исправит общий benchmark.
- Progressive loading: сначала terrain/cliffs и низкие mip levels, затем
  видимые модели и эффекты. Это улучшит time-to-first-image даже без сокращения
  общей работы.
- Texture arrays/atlas там, где одинаковые sampler rules позволяют это без
  нарушения SC2 material semantics.
- Пространственная сортировка прозрачных объектов по группам вместо полной
  пересортировки всех primitives.
- Уменьшенный SSAO target/kernel допускается только после отдельного A/B
  качества; общий переключатель lighting effects не изолирует его стоимость.

### P3: поддерживаемость

- При реальном изменении `createWorldWebGlPlan` выделять чистые builders по
  facets: terrain/cliffs, splats, models, effects, picking. Не вводить
  speculative abstraction без тестируемой границы.
- Аналогично разделить `createCandidateWorldSceneLease`, сохранив единый cache и
  release policy.
- Добавить performance receipt thresholds в Amphion product route: cold/warm
  conversion time, plan bytes, GPU bytes, plan rebuild count и медианы passes.

## 12. Что ещё не соответствует SC2

- Colorization LUT и SSAO являются приближением; точная формула нативного LUT
  generator и порядок AO не восстановлены.
- Terrain specular mask подтверждён shader asset, но BRDF приближённый.
- Bloom, white shift, time-of-day и полная colour-space policy не реализованы.
- M3 fill/back lighting, per-material AO и часть layer/blend/effect semantics
  неполны; этим могут объясняться белые зонтики и чёрные края foliage.
- Shadow direction/footprint, размеры некоторых splat doodads и их actor-side
  параметры требуют отдельной проверки.
- `Elescaro Waves` и `Compound Sewers Water Effect` всё ещё являются M3/effect
  parity задачами, а не задачами terrain water shader.
- Один известный Amphion model resource (`Actor/DefendersCity_Biker_Bar`) не
  конвертируется; diagnostic placeholders не следует маскировать.

## 13. Инварианты для будущих изменений

- Не читать SC2 archives/game installation напрямую из `@modkit/scene`.
- Не выбирать model/animation по строковым эвристикам renderer-а.
- Не использовать terrain specular alpha как coverage.
- Не применять cliff wall texture к terrain top и наоборот.
- Не исправлять seams глобальным затемнением AO или непрозрачным overlay.
- Сохранять специальный mesh-raster diagnostic renderer отдельно от production
  WebGL route.
- После изменений сравнивать terrain-only и full-object render, overview и
  isometric, fresh и warm payload.

## 14. Минимальная проверка изменений

Для документации достаточно formatting/diff checks. Для кода renderer-а нужны:

1. узкие unit tests изменённого parser/material/pass;
2. TypeScript build затронутых packages;
3. Amphion product-route payload без unresolved dependency diagnostics;
4. две картинки: terrain/cliffs/water и все доступные objects/doodads;
5. high-resolution overview, повёрнутый на 90 градусов против часовой стрелки;
6. benchmark receipt после прогрева с plan build/reuse и pass timings;
7. визуальная проверка ramps, cliff tops, splats, foliage, shadows, minerals и
   water effects.
