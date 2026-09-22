# Handoff: ускорение загрузки и рендеринга SC2 M3-моделей

Дата: 2026-09-22. Репозитории: `modkit-core` и
`modkit-extensions-blizzard`.

Этот документ является самодостаточной постановкой задачи для следующего
агента. Общая архитектура карты описана в
[`SC2_MAP_RENDERING_PIPELINE.md`](./SC2_MAP_RENDERING_PIPELINE.md).

## Задача

Сократить время подготовки карт StarCraft II, объём удерживаемой CPU/GPU памяти
и стоимость кадров с большим числом doodads, не создавая отдельный SC2-only
renderer и не ухудшая текущую визуальную точность.

Первый обязательный результат — разделить агрегированный таймер подготовки
моделей на этапы и доказать, где расходуются 185.8 секунды Amphion. После этого
нужно реализовать минимальную оптимизацию наиболее дорогого этапа. Наиболее
вероятные следующие шаги — переиспользование UVM projection и GPU instancing,
но порядок должен подтвердить профиль.

Ревизия 2026-09-21 добавила раздел «Проверенные факты» (F1–F8). Он меняет
порядок и атрибуцию целей: reuse UVM projection устраняет холодные повторы
(выигрыш времени ещё нужно измерить, F1), устранение picking- и per-triangle работы поднимается выше
instancing (F4, F5), а любая цель по анимированному кадру требует сначала
разделить static plan и dynamic state (F6). Читать F1–F8 до выбора этапа.

## Короткий ответ на вопрос «можно ли без конвертации»

WebGL не может непосредственно рисовать бинарный M3. Неизбежны как минимум:

- разбор контейнера и секций M3;
- декодирование vertex/index/material/animation data;
- нормализация данных под shader/GPU contracts;
- создание и загрузка GPU buffers/textures.

Однако полная цепочка `M3 -> serialized UVM -> reopen UVM -> scene facets`
не обязательно должна выполняться при каждом открытии карты. Есть три уровня
оптимизации:

1. кешировать результат M3 -> UVM и повторно открывать готовый UVM;
2. для безопасных случаев потреблять уже опубликованные M3 codec-ом общие
   `common.view/model-*` facets без сериализации и повторного открытия UVM;
3. уменьшить число GPU draws через instancing уже разделяемой геометрии;
   отдельно убрать CPU-копии треугольников для picking.

Уровень 2 нельзя включать вслепую: renderer сейчас использует `uvmBytes` для
части effect/projector behavior. Модель без UVM projection не должна молча
терять particles, ribbons, projectors, M3A bindings или material animation.

## Репозитории и уже принятые изменения

- `modkit-core`:
  - `60e091ec fix(scene): improve SC2 map effects and terrain shading`;
  - `dd961443 docs(scene): document SC2 map rendering pipeline`.
- `modkit-extensions-blizzard`:
  - `065774b8 fix(starcraft2): improve map rendering fidelity`.

Рабочие деревья могут содержать посторонние изменения других агентов. Не
использовать `reset --hard`, `checkout --`, `clean` или общий stash. Добавлять в
коммит только файлы этой задачи.

## Измеренная исходная точка Amphion

Конфигурация замера обязательна к указанию: без неё числа несравнимы. Замеры
ниже относятся к 1280 x 1280, Chrome/ANGLE, Intel Graphics, D3D11, animation
step 0, `maxConcurrentModelAcquisitions: 8`, `maxModelBytes: 1_610_612_736` и
такому `MODKIT_AMPHION_MAX_MODELS`, при котором admitted >= 527.

Важно: `maxModelBytes / admittedModels` задаёт `perModelBytes`, а он же задаёт
`maxTextureBytes` и `maxTextureTotalBytes`. Поэтому изменение `maxModels`
меняет не только объём работы, но и то, загрузятся ли текстуры моделей вообще.
Закоммиченный в репозитории receipt
(`../../../artifacts/sc2-amphion-product-route.json`) снят на другой
конфигурации: 512 моделей, 87.979 s model acquisition, payload 76,719,004 bytes
и `modelTextureBytes: 0` — текстуры моделей отсутствуют. В receipt есть 2080
`x3.host/raster-codec-unavailable`; причиной нельзя считать только бюджет.
Нельзя также утверждать, что все материалы рисовались hashed-цветом: часть
идёт через standard shader с fallback-ресурсами. Его нельзя использовать ни как visual, ни
как performance baseline. Перед любым A/B нужно снять свой cold baseline на
фиксированной конфигурации и зафиксировать её в receipt.

Замеры относятся к 1280 x 1280, Chrome/ANGLE, Intel Graphics, D3D11:

- полный холодный product-route acquisition: 192.665 s;
- агрегированный model acquisition: 185.793 s;
- terrain textures: 6.808 s;
- typed-array payload: 230,741,844 bytes;
  - models: 147,773,268 bytes;
  - terrain textures: 82,968,576 bytes;
- 10,742 object instances;
- около 1.79 млн model triangles;
- objects plan: 375,974,896 bytes;
- известные GPU allocations: 270,796,212 bytes;
- короткий benchmark objects + effects: медиана 987.4 ms/кадр;
- objects без новых lighting effects: 703.2 ms/кадр;
- terrain-only + effects: 12.0 ms/кадр;
- построение плана: `worldPlanBuildP50Milliseconds` 7430.1, при
  `worldPlanBuilds: 1` и `worldPlanReuses: 1`;
- `geometryEntries: 240`, `geometryUploads: 269`,
  `geometryCacheHits: 17452`, `geometryBytesRetained: 79,508,848`;
- `textureEntries: 497`, `textureBytesRetained: 154,832,964`;
- `cpuFrameP50: 1025.2 ms`, `cpuFrameP95: 13028.9 ms`.

Важно: `185.793 s` сейчас измеряет весь `source.model()` route. Это не
доказанное время одной `convertM3ProjectionToUvm`. В сумму входят resolution,
открытие M3, native decode, sidecars, UVM export/reopen, facets и model textures.
Не называть её «чистым временем конвертера» до добавления подтаймеров.

Артефакт с исходными измерениями:

```text
../artifacts/lighting/SC2_LIGHTING_RENDER_VALIDATION_2026-09-18.md
```

## Проверенные факты, добавленные при ревизии плана (2026-09-21)

Ниже — не гипотезы, а то, что читается из текущего кода и уже снятых receipts.
Каждый пункт меняет приоритет или формулировку соответствующего этапа плана.

### F1. 526 успешных результатов содержат 349 уникальных M3

Извлечение `sourceKey` из `../artifacts/lighting/payload-complete/world.json`:
Пересчёт 2026-09-22: 527 записей, 526 converted, один unresolved,
349 различных `sourceKey` и 349 `source.ref.id` среди успешных результатов.
Это **177 повторных успешных результатов (33.65% от 526)**, максимум x4 на
ключ. SHA-256 текущего `world.json`:
`bffc9726da4d4971fa91c2a2152c31d0cfb943a56fa059341ff5950b7fc73be1`.
Payload не является trace всех вызовов: candidate retries и отдельный
material-model acquisition могут добавить работу. Их считает инструментация.

Причина: `resources` строится на уровне catalog entity и model requirement, а
`item.modelCandidates` содержит повёрнутые варианты одного piece. Yaw
применяется **после** model port, в `yawRootNodes(nodePage.items, chosen.yaw)`
в `world-source.ts`, и в UVM bytes не попадает. Значит один кешированный UVM
корректен для всех yaw-вариантов.

Следствие: bounded reuse внутри одного resource session полезен уже для
холодного открытия. Доля повторных запросов не равна доле времени: маленькие
cliff pieces могут быть значительно дешевле уникальных сложных моделей.
Приоритет разумен, но обещание −25% времени без профиля необоснованно.

### F2. Что на самом деле содержит `sourceKey`

Фактический ключ (host `model-resources.ts`) — шесть полей через `|`:

```text
0 source.ref.id                файл ресурса
1 opened.descriptor.revision   provider-token!<path>:<byteSize>
2 operation.id                 model.export-uvm
3 operation.handlerId          model-export-uvm
4 schemaVersion=1              литеральная константа
5 metersPerSourceUnit=<units>
```

Проверено:

- поле 1 — это `options.source.revision` (в `subject-open.ts` descriptor
  получает `revision: options.source.revision`), поэтому **поля 0 и 1 доступны
  до native open**. Пре-open ключ технически возможен;
- поля 2 и 3 постоянны для данного codec и inventory, поэтому их место — в
  **namespace кеша на процесс**, а не в ключе каждой модели. Если оставить их в
  ключе, hit принципиально невозможен раньше открытия M3, и при доминирующем
  `nativeOpenMs` кеш не даст почти ничего;
- content identity — это `build token + path + byteSize`, **не digest**. Для
  неизменяемой установки приемлемо, для persistent cache требует явной записи
  этого ограничения;
- **companion/M3A/effect closure в ключ не входит вообще**. Ниже в разделе
  «Ключ кеша» это сформулировано как «нужно проверить» — проверено: не входит;
- **revision конвертера в ключ не входит**. Для in-process кеша безвредно, для
  persistent — ошибка корректности.

Предлагаемая форма требует проверки: namespace = inventory/contribution и
converter/cache revision + identity неизменяемой resolution session; ключ =
source identity/revision + units/schema + влияющие на результат options.
`snapshotId` строится из session revision и загруженных map documents; это не
доказанный digest M3A closure. В `createSubjectModelResources.Options` его вообще
нет. Перенос operation/handler в namespace сам по себе не доказывает, что codec
выбран корректно до open. Начать с ограниченного session-local кеша.

Ещё один обязательный gate для pre-open hit: native `opened.resources`
сохраняет overlay DDS/M3A, которого нет у synthetic UVM. При пропуске native
open нужен равноценный живой resource origin. Если он не доказан, первый кеш
должен быть post-open и честно измерять только пропущенный export.

### F3. Пятая копия UVM и мёртвый per-open cache

К четырём копиям, перечисленным ниже, добавляется пятая: `uvmArtifactSource()`
в `model-resources.ts` делает `bytes.slice()` и удерживает её всё время жизни
переоткрытой UVM session.

Кроме того `createUvmConversionCache(context.budget.maxScalarBytes)` в
`models/src/m3/codec.js` на map route **никогда не даёт hit**: `convertScene`
используется тремя handlers (`model-export-uvm`, `render-m3-scene`,
`edit-m3-scene`), но product route вызывает только первый и ровно один раз на
session, после чего session сразу dispose. То есть на этом маршруте кеш только
удерживает лишнюю полную копию UVM каждой модели. Это самостоятельная
memory-находка, её стоит закрыть вместе с этапом 1A.

### F4. GPU-геометрия уже разделяется между экземплярами

Из `../artifacts/lighting/render-final-objects/render-receipt.json`:
`geometryEntries: 240`, `geometryUploads: 269`, `geometryCacheHits: 17452`,
`geometryBytesRetained: 79,508,848` при 10,742 instances и 1,786,824 model
triangles.

Shared-material путь действительно хранит `{...primitive, transform}` и
разделяет geometry arrays. Но проверка 2026-09-22 выявила важную границу
счётчиков: 240 entries относятся к `world.resources.geometry`; собственные
buffers/VAO material renderer в них не входят. Поэтому это число не описывает
всю модельную GPU память. Повторное использование подтверждается кодом,
а не отношением 240 к 10,742. GPU instancing прежде всего сокращает submission;
фактическую память и стоимость GPU passes нужно измерять отдельно.

17,452 geometry cache hits за два кадра нельзя переименовывать в 8.7 тыс.
model draw calls/кадр: счётчик охватывает другую область владения и не все
passes. Нужны прямые draw counters. Нельзя также объявлять кадр CPU-bound
без разделения CPU-submit, GPU timer и ожидания `gl.finish`.

### F5. Per-triangle работа выполняется и там, где её никто не потребляет

В `createWorldWebGlPlan` внутренний цикл по треугольникам выполняется для
каждого экземпляра **всегда**, включая shared-material ветку:

- `transformedPrimitiveVertex` + `transformedComponentVertex` + `instanceVertex`
  считают три world-space вершины на треугольник;
- в shared-material ветке результат используется только для инкремента
  счётчика и для picking: `for (const vertex of vertices) pickTriangles.push(...)`;
- `pickTriangles` — это `number[]`, затем `Float32Array.from(item.triangles)`.
  При 1.79 млн треугольников это ~16.1 млн чисел: около 64 MB retained во
  Float32Array и около 129 MB транзитно в `number[]`, одновременно живущих в
  момент материализации плана;
- расчёт `bounds` затем ещё раз линейно проходит по всем picking-числам.

Это объясняет заметную часть `worldPlanBytesRetained: 375,974,896` при
`payload models: 147,773,268` и делает пункт «устранение per-instance
world-space geometry и picking triangle copies» самым дешёвым по диффу и
наиболее доказанным из runtime-пунктов. Он не требует ни кеша, ни изменения
contracts, ни instancing.

### F6. При ненулевом animation step план перестраивается каждый кадр

`sameWorldPlanInput` завершается условием
`(!animatedWorld(left) || left.timeSeconds === right.timeSeconds)`, а
`animatedWorld` истинно при анимированной воде или любом
`item.presentationAnimation`. Amphion удовлетворяет оба условия.

В том же receipt: `worldPlanBuilds: 1`, `worldPlanReuses: 1`,
`worldPlanBuildP50Milliseconds: 7430.1`, `cpuFrameP50: 1025.2`,
`cpuFrameP95: 13028.9`, `milliseconds: 14078.8`.

Значит опубликованная медиана 987.4 ms снята при `timeSeconds: 0` и описывает
**кадр с переиспользованным планом**, а не анимированный steady state. При
ненулевом animation step код повторяет полное построение. 7.4 s — один
статичный build sample, не измеренная медиана анимированных перестроений.

Следствие для плана: цель «steady-state object frame минимум в два раза
быстрее» обязана указывать, о каком steady state речь. Для анимированного
режима разделение static plan и dynamic animation/effect state — не поздний
пункт списка, а **предварительное условие**: instancing сам по себе не поможет,
пока план пересобирается целиком.

### F7. Warzone-тест не покрывает model pipeline и является cross-repo gate

`../../../../modkit-extensions-warzone/test/second-installed-map-corpus.test.ts`
действительно проходит маршрут Warzone -> WorldScene -> UVW -> SC2 и UVW ->
свежий `.wz`. Но:

- он создаёт `createCandidateWorldSceneLease(snapshot, [], 1024)` без model
  resource port. Именно поэтому **не покрывает конвертацию моделей,
  instancing и model facets**; сам лимит `maxModels: 1` допускал бы одну модель.
  Как архитектурное
  доказательство границ он годится, как регрессионный тест модельного
  конвейера — нет;
- он проверяет точные длины массивов плана
  (`renderPlan.transparentTriangles.positions.length / 9`,
  `renderPlan.stats.terrainTriangles`). Изменение этих полей формы плана ломает тест
  **в другом репозитории**, поэтому изменение формы плана и правка этого теста
  должны идти согласованно, а не «потом».

### F8. Чего не хватает в обязательном этапе 0

К списку подтаймеров ниже нужно добавить счётчики путей отрисовки, иначе нечем
выбрать между instancing и завершением material programs:

- число экземпляров и треугольников по ветвям: prepared shared material /
  textured fallback / untextured opaque fallback / diagnostic placeholder;
- число экземпляров, у которых `prepareSceneMaterialPrograms` не подготовила
  материал (это одновременно fidelity-сигнал: такие модели рисуются hashed
  цветом или fallback-текстурой);
- число уникальных `sourceKey` против числа acquisitions (проверка F1 в live
  прогоне);
- число draw calls и уникальных geometry/texture bindings на кадр.

Полностью изолированные подтаймеры M3A/effect sidecars внутри `convertScene`
через host boundary недоступны: `OperationResult` не имеет канала метрик, а
`Progress.message` не следует превращать в телеметрию. Отдельный узкий
профилирующий скрипт по top-20 моделям — допустимый и достаточный способ
получить этот split, не расширяя ABI.

## Оценка текущей системы

| Область                     | Оценка | Сильные стороны                                                              | Основные проблемы                                                             |
| --------------------------- | -----: | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Архитектура renderer-а      |   8/10 | Форматы, game providers, host scene и WebGL разделены                        | Часть SC2 cliff/ramp presentation просочилась в общий plan builder            |
| Визуальная точность SC2     |   6/10 | Terrain, cliffs, water, M3, lighting и LUT уже проходят единый product route | Нет полной actor/material/effect/shadow parity                                |
| Поддерживаемость            |   5/10 | Контракты типизированы, partial/loss states явные                            | `createWorldWebGlPlan` и `createCandidateWorldSceneLease` слишком крупные     |
| Холодная загрузка           |   3/10 | Есть budgets, abort, bounded concurrency и lazy resources                    | Model acquisition занимает около 96% подготовки Amphion                       |
| Память                      |   3/10 | Lease ownership и release существуют                                         | Несколько UVM copies, CPU RGBA, plan arrays и per-instance picking/geometry   |
| Full-map производительность |   3/10 | Terrain-only route быстрый, plan retained                                    | Object-heavy overview остаётся около 1 FPS в коротком benchmark               |
| Наблюдаемость               |   7/10 | Есть diagnostics, receipts, plan/GPU counters                                | Model acquisition и render passes пока измеряются слишком крупными блоками    |
| Multi-game preview          |   7/10 | Общие world/model/texture contracts уже используются разными extensions      | Не все games публикуют полноценный world provider                             |
| Межигровая конвертация      |   6/10 | UVW и target converters уже доказали Warzone -> SC2                          | Нет полного общего semantic mapping contract и широкого набора target writers |
| Поддержка 2D/2.5D игр       |   3/10 | Можно публиковать quads/textures через общий renderer                        | Нет законченного sprite/billboard/palette/facing contract для карт            |

Итог: базовая архитектура хорошая и расширяемая. Слабое место — не выбор
границ, а стоимость текущей материализации и неполнота универсальных
presentation/conversion contracts. Не следует заменять эти границы одним
«универсальным game object». Нужно дополнять их маленькими доказанными facets и
adapter contracts.

### Что улучшает архитектуру

- Сохранить направление зависимостей: game extension -> нейтральные SDK
  contracts -> host -> scene renderer.
- Вынести оставшиеся SC2-specific cliff/ramp решения из общего renderer-а в
  данные, опубликованные SC2 provider-ом: явные meshes, cut/fill masks,
  presentation flags или portable procedural description.
- Разделить static world data, dynamic presentation state и portable conversion
  artifact. Сейчас они частично соединены через `WorldSceneModelResult`.
- Разбивать крупные функции только вдоль уже существующих facets и после
  profiling, не добавляя параллельный scene graph.
- Версионировать contracts и сохранять `unknownFacets`, provenance, confidence и
  loss reports. Silent fallback недопустим для конвертации.
- Добавить capability negotiation: source provider сообщает точные facets,
  target converter — обязательные facets и допустимые policies.
- Считать visual fidelity и semantic fidelity раздельно: карта может выглядеть
  правильно, но потерять gameplay; или сохранить gameplay, но использовать
  placeholders.

### Что улучшает визуальную точность

- Калибровать каждый материал/lighting feature по fixed camera/time reference,
  а не общим цветовым коэффициентом всей карты.
- Завершить M3 material layers, fresnel/emissive/specular/AO, alpha edge rules,
  actor-driven animation и effect sidecars.
- Хранить authored shadow, sprite shadow, projector и decal semantics отдельно,
  не заменяя их одним screen-space затемнением.
- Для cliffs/ramps проверять top/wall ownership, terrain cut/fill, диагональные
  стыки и изменённую authored height scale.
- Ввести representative visual corpus: foliage, umbrellas, minerals, water
  effects, splats, straight/diagonal ramps, day/night lighting.

### Что улучшает загрузку, память и FPS

- Сначала детальные таймеры, затем cache самого дорогого этапа.
- Persistent derived UVM/decoded projection cache с корректной invalidation.
- Одна immutable owned copy UVM на execution boundary.
- GPU instancing повторяющейся static geometry и GPU object-id picking.
- Общие decoded/GPU textures по content identity и reference counting.
- Static plan отдельно от animation/effect updates.
- Progressive terrain-first loading и camera-driven model/texture admission.
- Frustum/LOD полезны для close camera, но overview видит почти всю карту и
  требует batching/instancing, а не только culling.

## Готовность к другим играм и конвертации карт

### Краткий вывод

Да, предложенная модель с адаптерами игровых extensions реализуема и уже
частично работает. Но adapter должен в первую очередь публиковать нейтральные
данные и capabilities, а не передавать произвольный game-specific WebGL код в
renderer.

Правильная граница:

```text
native game map/assets
  -> source game adapter/provider
  -> semantic snapshot + WorldSceneSource
  -> portable UVW artifact + explicit loss ledger
  -> mapping profile/policies
  -> target game adapter/writer
  -> reopened and validated target map
```

Renderer использует `WorldSceneSource` для просмотра. Конвертер использует UVW
и semantic mapping policies. Эти два назначения связаны, но не идентичны.

### Что уже универсально

`packages/sdk/src/maps/index.ts` уже определяет game-neutral facets:

- terrain и exact/sample height grid;
- terrain materials и weight rasters;
- water;
- cliffs;
- objects и resource joins;
- regions;
- navigation и gateways;
- lighting;
- coordinate spaces и доказанные transforms;
- provenance, partial/unavailable states и `unknownFacets`.

`CandidateWorldSceneSource` лениво выдаёт страницы мира, модели и текстуры.
Модельные codecs разных publishers публикуют
`common.view/model-scene-source`. Например Spring/Recoil S3O уже преобразуется
в общий model scene без зависимости renderer-а от S3O.

`packages/uv/src/world/materializer.ts` содержит `materializeWorldToUvw`, а
`packages/uv/src/world/source.ts` повторно открывает UVW как общий world source.
Это правильный центр переносимой геометрии и presentation data.

### Практическое доказательство Warzone 2100

`modkit-extensions-warzone` уже публикует Warzone terrain, materials, water,
objects, gateways, model resources и доказанный `map-native -> uvw-canonical`
transform через те же contracts.

Интеграционный тест:

```text
../modkit-extensions-warzone/test/second-installed-map-corpus.test.ts
```

проверяет маршрут:

```text
Warzone .wz/game.map
  -> ResolvedMapWorkspaceSnapshot
  -> CandidateWorldSceneSource
  -> materializeWorldToUvw
  -> generic WebGL plan
  -> convertUvwToStarcraft2Map
  -> reopened SC2 MPQ with t3HeightMap/t3Terrain.xml/Objects/t3Water
```

Тот же UVW преобразуется обратно через `convertUvwToWarzoneWz`, повторно
открывается Warzone provider-ом и загружается установленной игрой.

Границы этого доказательства см. F7: тест не подключает model resource port,
поэтому не покрывает модельный конвейер, и при этом проверяет точные длины массивов
плана, то есть является cross-repo регрессионным gate. Это
подтверждает жизнеспособность source adapter + UVW + target writer, хотя
конвертация использует явные material/object/unit/water mappings и фиксирует
потери.

### Текущая готовность предполагаемых игр

| Игра/семейство    | Текущее основание                                                              | Что отсутствует для полноценной карты                                                                                 |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| StarCraft II      | Наиболее полный map/provider/model/writer route                                | Полная visual/actor/runtime parity и производительность                                                               |
| Warzone 2100      | World provider, PIE/resources, UVW materialization, writer и engine-load proof | Lighting, navigation, часть runtime materials/footprints                                                              |
| C&C 3             | CkMp/EAR/RefPack container codec и W3X model codec существуют                  | Terrain/object/script chunks, sidecars, world provider и writer                                                       |
| Red Alert 3       | Можно переиспользовать общие SAGE/model contracts                              | Нужны отдельные доказанные RA3 map semantics, resources и writer; нельзя считать C&C3 codec автоматически совместимым |
| BAR/Spring/Recoil | S3O model, VFS/Rapid и unit-definition codecs существуют                       | SMF/SMT/map provider, terrain materials, features, decals, Lua/gameplay mapping и writer                              |
| StarCraft 1       | Blizzard archive foundation частично доступен                                  | CHK scenario/map provider, tileset/sprites/palettes, triggers/pathing и writer                                        |
| Red Alert 2       | VXL/HVA model groundwork существует                                            | Map/tiles/overlays/smudges, SHP/palette presentation, rules/art mappings и writer                                     |

Не объявлять game support только по наличию archive или model codec. Для карты
нужны как минимум source provider, coordinate transform, terrain/objects,
resource joins и target writer либо явный preview-only статус.

## WorldSceneSource не должен становиться lossless map IR

Текущий world contract предназначен для bounded preview и renderer-а. Он может
содержать sampled LOD, presentation-only cliff objects и уже разрешённые
ресурсы. Этого недостаточно для точной межигровой конвертации gameplay.

Примеры данных, которые render projection может не сохранить:

- triggers, scripts, teams, alliances и victory rules;
- player starts, playable bounds и camera bounds;
- footprints, buildability, несколько видов pathing/collision;
- tile orientation/flip/variation и source-specific texture parameters;
- object properties, upgrades, veterancy, resource amounts;
- decals, splats, overlays, smudges и editor-only layers;
- random tables, runtime spawn rules и catalog inheritance;
- raw/opaque source records, необходимые для same-game lossless round-trip.

Поэтому сохранить два слоя:

1. **WorldSceneSource/UVW presentation** — переносимая геометрия, внешний вид и
   общие spatial facets для preview.
2. **Map semantic/conversion IR** — gameplay и authored intent, provenance,
   source extensions и loss ledger для target writers.

UVW может быть контейнером общей переносимой части, но не должен ложно
объявляться полной картой, пока его profile не включает необходимые semantic
planes. `WorldSceneInfo` уже осторожно помечает maturity как
`publisher-candidate`, а не как GA `world-interchange`; это правильное
ограничение.

## Архитектура адаптеров игровых extensions

### Source map adapter

Каждое game extension отвечает за:

- открытие native package и dependency/resource closure;
- точный разбор terrain, objects и game-specific documents;
- публикацию semantic snapshot;
- доказанный native coordinate system и transform в UVW;
- resource joins к model/texture/sprite/audio codecs;
- список неизвестных/потерянных facets;
- raw-preserving same-game edit route, если он поддерживается.

### Presentation adapter

Provider преобразует game-specific presentation в общие contracts:

- native model -> `common.view/model-scene-source`/UVM;
- texture/palette -> raster resource;
- terrain/tile layers -> terrain/material facets;
- cliffs/ramps -> portable geometry или generic procedural description;
- objects -> resource IDs + transforms + presentation state;
- effects/decals/splats -> стандартные material/effect/projector primitives.

Game extension может вычислять, **что** рисовать и какие authored параметры
применить. Общий renderer определяет, **как** выполнить стандартный draw contract
в WebGL. Это сохраняет возможность headless, WebGPU или другого backend-а.

Если формату нужен новый визуальный primitive, сначала определить маленький
versioned common capability и реализовать generic backend. Не добавлять callback
вида `extension.draw(gl)` — он ломает sandbox, batching, cache, headless render и
межигровую переносимость.

### Mapping profile

Межигровая конвертация не может надёжно угадывать соответствия только по
именам. Mapping profile должен явно задавать:

- source/target units, axes, origin и quantization;
- terrain material/tile correspondences;
- water/cliff/ramp policy;
- object/unit/doodad/resource correspondences;
- footprint/pathing conversion;
- team/player/start-position policy;
- unsupported feature policy: refuse, approximate, bake или discard;
- visual fallback и confidence/provenance каждой mapping rule.

Профиль может поставляться game extension, пользователем или отдельным
conversion package. Автоматическое предложение допустимо, но target writer
должен получать уже явное решение и выдавать loss report.

### Target map adapter/writer

Target extension отвечает за:

- проверку обязательных facets и mapping policies;
- quantization и native limits;
- генерацию terrain, objects, resources и package metadata;
- проверку archive/sidecars;
- повторное открытие результата своим codec-ом;
- semantic comparison и structured loss report;
- по возможности запуск/acceptance в установленной игре.

## Поддержка 2D и 2.5D через соответствия с 3D

SC1 и RA2 можно показывать общим 3D renderer-ом, представляя 2D элементы как
специализированные presentation resources:

```text
tile/isometric cell -> oriented textured quad or tile mesh
sprite frame        -> camera-facing or axis-locked billboard
voxel unit          -> decoded 3D model or baked sprite fallback
shadow sprite       -> separate projected/ground-aligned layer
overlay/smudge      -> decal/splat layer with authored order
selection/footprint -> semantic shape, not visible geometry only
```

Для этого нужен нейтральный sprite/billboard contract со следующими данными:

- pivot/anchor и authored bounds;
- world footprint отдельно от visual bounds;
- facing count и mapping angle -> frame;
- animation clips/frame durations;
- palette, remap/team-colour channels и colour space;
- alpha/keying rules;
- axis lock, camera mode, depth bias и draw order;
- отдельная shadow/decal resource relation;
- scale policy между pixels, cells и world units.

На первом этапе не нужно строить новый 2D renderer. Минимальный путь — adapter
создаёт quad primitives и common materials. Новый billboard primitive добавлять
только когда fixed quads не могут корректно представить camera/facing behavior.

Для конвертации 2D -> 3D mapping profile может заменить sprite на target 3D
model, а при отсутствии соответствия — оставить billboard/placeholder или
отказать по policy. Обратное 3D -> 2D требует bake/render-to-sprite pipeline и
явных camera/facing/animation rules; это отдельная lossy operation, не простой
model conversion.

## Дополнительные contracts, которые стоит подготовить

Не реализовывать все сразу. Добавлять по первому реальному второму game
provider-у, который доказывает необходимость.

1. `MapConversionProfile` — explicit coordinate/material/object/pathing/player
   mappings и unsupported-feature policies.
2. `MapConversionLoss`/`MapConversionReceipt` — feature, source identity,
   policy, severity, approximation и target evidence.
3. `MapTargetWriterCapability` — required/optional facets, native limits,
   supported output profiles и verification support.
4. Sprite/billboard presentation source — только когда начинается SC1/RA2 map
   provider.
5. Generic decals/overlays/smudges plane — когда второй формат докажет общую
   семантику, а не как SC2-specific splat alias.
6. Gameplay planes: players/starts/teams, footprints/pathing categories,
   triggers/scripts references. Их следует отделить от renderer facets.

Не создавать глобальную таблицу всех игр и объектов в core. Соответствия должны
жить в versioned mapping profiles/extensions и ссылаться на stable semantic IDs
конкретных source/target providers.

## Текущий маршрут одной модели

```text
World resource item
  -> CandidateWorldSceneSource.model(resourceId)
  -> ModelResourcePort.acquire(requirement)
  -> ResourceSession.resolve(logical M3)
  -> open native M3 codec session
  -> M3 inspect/decode
       geometry
       skeleton
       animations + M3A sidecars
       materials
       attachments/effects
  -> invoke model.export-uvm
  -> convertM3ProjectionToUvm
  -> copy UVM bytes
  -> reopen synthetic .uvm through UVM codec
  -> acquire common model facets
  -> read meshes/primitives/materials/animations/sockets
  -> resolve/decode referenced DDS textures
  -> WorldSceneModelResult
  -> createWorldWebGlPlan
  -> material programs/GPU buffers/draw passes
```

## Основные точки входа

### `modkit-core`

- `packages/host/src/model-resources.ts`
  - `createSubjectModelResources`;
  - разрешает native resource;
  - открывает codec session;
  - требует операцию `model.export-uvm`;
  - вызывает её и повторно открывает synthetic UVM;
  - публикует common scene facets и дочерние raster/model resources.
- `packages/sdk/src/model-resources.ts`
  - `ModelResourceRequest`, `ModelResourceResult`, `ModelResourceAsset`,
    `ModelResourcePort`.
- `packages/host/src/maps/world-source.ts`
  - `createCandidateWorldSceneLease`;
  - метод `model()`;
  - читает pages/facets и текстуры;
  - содержит `materialModelCache` и `modelTextureCache` на время world lease.
- `packages/ui/src/world/index.ts`
  - `inspectCandidateWorld`;
  - дедуплицирует resource items по `item.id`;
  - сортирует модели по числу instances;
  - загружает их с bounded concurrency;
  - повторно использует модели только из `options.previous` того же snapshot и
    с тем же `modelRequestKey`.
- `packages/scene/src/uvm/conversion-cache.ts`
  - маленький memory-only cache одного UVM conversion;
  - копирует bytes на get/set;
  - не является persistent cache.
- `packages/scene/src/world/webgl.ts`
  - `createWorldWebGlPlan`;
  - sample анимаций, material scenes, fallback triangle batches, effects,
    picking и instance transforms;
  - главный runtime/memory hotspot после model acquisition.
- `packages/scene/src/render/material-webgl.ts`
  - material resource preparation и draw path.
- `scripts/render-world-payload.mjs`
  - production-equivalent headless GPU render и benchmark.

### `modkit-extensions-blizzard`

- `models/src/m3/codec.js`
  - `createM3FamilyCodec`;
  - native inspection/decode;
  - `convertScene`/`model.export-uvm`;
  - `convertM3ProjectionToUvm`;
  - common model data sources;
  - M3A/effect sidecar binding.
- `models/src/m3/runtime/geometry.js`
  - geometry и UVM source decoding.
- `models/src/m3/runtime/material.js`
  - native material decode.
- `models/src/lib/mk2/m3/src/builder/standard-material.ts`
  - material projection.
- `models/src/m3/uvm/converter.ts` или соответствующий source, собранный как
  `dist/m3/uvm/converter.js`
  - native projection -> UVM.
- `starcraft2/test/amphion-product-route.test.ts`
  - end-to-end fixture;
  - сейчас использует `maxConcurrentModelAcquisitions: 8`;
  - создаёт payload и receipt.

## Какие кеши уже есть

### 1. M3 per-open conversion cache

В `models/src/m3/codec.js` каждый native open создаёт
`createUvmConversionCache(context.budget.maxScalarBytes)`. Ключ сейчас:

```text
schemaVersion:metersPerSourceUnit
```

Он помогает только повторному `model.export-uvm` внутри того же M3 session.
После закрытия session кеш исчезает. Между картами и перезапусками приложения он
ничего не переиспользует.

Проверено (F3): на map product route этот кеш **не даёт ни одного hit**. Route
вызывает `model-export-uvm` один раз на session и сразу делает dispose, поэтому
кеш лишь удерживает дополнительную полную копию UVM каждой модели. Другие
потребители `convertScene` (`render-m3-scene`, `edit-m3-scene`) на этом маршруте
не участвуют.

### 2. Previous world snapshot reuse

`inspectCandidateWorld` переиспользует `previous.models`, только если совпадают:

- `snapshotId`;
- `modelRequestKey`;
- состояние модели `converted`.

Новый preview session или новый snapshot обычно снова проходит acquisition.

### 3. World-lease caches

`world-source.ts` кеширует material-model skins и decoded model textures в
пределах одного `createCandidateWorldSceneLease`. Это не persistent cache.

### 4. Retained WebGL renderer

WebGL plan и GPU resources переиспользуются между кадрами, если input identity
не изменился. Receipt уже показывал один build и восемь reuses. Поэтому нельзя
лечить холодную подготовку только ещё одним frame-local cache.

## Подтверждённые источники лишней работы и памяти

### Повторное M3 -> UVM -> UVM open

Host всегда ищет `model.export-uvm`, вызывает операцию и открывает полученные
bytes через UVM codec, хотя M3 codec уже публикует часть общих model facets.
Этот route сохраняет форматную нейтральность и effect data, но добавляет
serialization, parsing и allocations.

### Несколько копий UVM bytes

В текущем пути встречаются последовательные копии:

- conversion cache возвращает отдельный `Uint8Array`;
- `createSubjectModelResources` делает `converted.output.value.slice()`;
- `ModelResourceResult` получает ещё один `uvmBytes.slice()`;
- `world-source.ts` публикует ещё одну копию `result.bytes.slice()`;
- `uvmArtifactSource()` делает ещё одну `bytes.slice()` и удерживает её всё
  время жизни переоткрытой UVM session (F3).

Это как минимум пять мест копирования. На miss conversion cache делает копию
при `set`, а не при `get`; source reads и codec parsing могут добавить другие.
Это не замер пяти одновременно удерживаемых полных буферов. Per-open cache
полезен standalone consumers и не должен удаляться глобально из-за map route.

Нельзя просто удалить все копии: execution boundary, lease ownership и
Transferable semantics могут отсоединить buffer. Но их стоимость следует
измерить, после чего оставить ровно одну owned immutable copy на границу.

### Per-instance CPU geometry

Уточнено измерениями (F4, F5):

- на shared-material ветке план хранит `{...primitive, transform}` с общей
  geometry. Старые world geometry counters не включают material buffers (F4);
- но per-triangle world-space преобразование выполняется для каждого
  экземпляра на **всех** ветках, включая shared-material, где его результат
  нужен только для picking;
- picking удерживает `number[]` на объект, затем `Float32Array.from`: около
  64 MB retained и около 129 MB транзитно при 1.79 млн треугольников,
  при материализации плана; transient bytes оценены, а не измерены heap profiler;
- расчёт `bounds` проходит по тем же picking-числам ещё раз;
- полностью разворачиваются в batch-массивы только fallback-ветки
  (`textured`, `transparentTextured`, `opaque`), то есть экземпляры, для которых
  `prepareSceneMaterialPrograms` не подготовила материал. Их долю нужно
  посчитать (F8): это одновременно и perf-, и fidelity-метрика.

Для shared materials уже сохраняются primitives с instance transform, поэтому
оптимизацию надо строить поверх существующей ветки, а не вводить второй material
renderer.

### Текстуры

`modelTextureCache` дедуплицирует decoded texture только внутри world lease и по
ключу `logicalId + preview byte budget`. После нового preview DDS снова может
декодироваться. Terrain и model textures также существуют одновременно как
source/compressed bytes, CPU RGBA и GPU allocation.

## Обязательный этап 0: инструментация

До изменения cache architecture добавить bounded timings и byte counters.
Минимальный receipt для каждой уникальной модели:

```ts
{
  resourceId,
  logicalId,
  sourceBytes,
  resolveMs,
  nativeOpenMs,
  nativeDecodeMs,       // если codec может отделить от open
  sidecarMs,
  exportUvmMs,
  uvmBytes,
  reopenUvmMs,
  facetReadMs,
  textureResolveMs,
  textureDecodeMs,
  totalMs,
  cacheState: 'miss' | 'memory-hit' | 'persistent-hit'
}
```

Если native codec не может дешёво разделить `open` и decode, сначала достаточно
`resolve`, `nativeOpen`, `exportUvm`, `reopen/facets`, `textures`, `total`.

Требования:

- дополнительно собрать счётчики путей отрисовки и дублирования источников,
  перечисленные в F8: без них нельзя выбрать между instancing и завершением
  material programs;
- timings идут в structured receipt/stats, не в `console.log` library code;
- не включать полные logical paths или source bytes в telemetry;
- агрегировать median/p90/max и top-20 самых дорогих моделей;
- считать cache hits/misses и bytes copied;
- сохранять существующие budget/abort semantics;
- добавить узкий unit test, что таймеры монотонны/неотрицательны и aborted
  acquisition не записывается как успешный cache entry.

Контрольная гипотеза: если `nativeOpenMs` доминирует, кеш только результата
`convertM3ProjectionToUvm` даст слабый эффект. Если доминирует `exportUvmMs`, он
может дать почти полное warm ускорение.

## Рекомендуемый этап 1: UVM projection reuse

Уточнение после ревизии: это не только warm-оптимизация. По F1 треть
конвертаций одного холодного прогона Amphion — повторы того же `.m3`, поэтому
этап 1A может дать **холодный** выигрыш. Потенциальное сокращение успешных
повторных exports для этого payload — с 526 до 349; фактический выигрыш во
времени подтверждается только подтаймерами этапа 0.

### 1A. Сначала single-flight в пределах resource session

Минимальная реализация для доказательства:

- один cache/single-flight выше отдельного M3 session, с явным владельцем
  и ограничением памяти; сначала один неизменяемый resource session;
- одинаковый ключ возвращает один pending `Promise`;
- aborted/failed/unresolved результаты не кешируются;
- cache ограничен общим количеством bytes;
- eviction — простой LRU или существующий bounded cache pattern;
- при выдаче соблюдается ownership: mutable bytes не разделяются между
  независимыми потребителями.

Не писать сначала сложную CAS database. Расширять reuse на другие sessions
только после доказательства identity dependency closure. Отмена одного
подписчика не отменяет работу других; release не возвращает протухшие leases.

### Ключ кеша

Он обязан учитывать:

```text
source content identity or immutable revision
+ logical companion closure identity (M3A/effect sidecars)
+ model.export-uvm handler identity
+ explicit converter/cache schema revision
+ UVM schema version
+ metersPerSourceUnit
+ options that change included facets/resources
```

Состояние текущего `sourceKey` проверено, см. F2. Кратко:

- source ref и source revision присутствуют, причём доступны **до** native
  open, поэтому pre-open hit возможен;
- `operation.id`/`operation.handlerId` присутствуют, но они постоянны для
  codec+inventory: их следует перенести в namespace кеша, иначе hit никогда не
  произойдёт раньше открытия M3;
- companion/M3A/effect closure отсутствует — нужно добавить, иначе одинаковый
  `.m3` с другим M3A overlay получит неверный hit;
- revision конвертера отсутствует — обязательно добавить до persistent cache;
- `schemaVersion=1` — литеральная константа, а не отчёт converter-а о схеме;
- content identity — это `build token + path + byteSize`, не digest. Для
  неизменяемой установки это приемлемо, но ограничение нужно записать в
  manifest persistent cache.

Рекомендуемая форма: namespace = (inventory/contribution identity + converter и
cache revision + dependency-closure identity resolution session), ключ =
(`source.ref.id`, `source.revision`, `metersPerSourceUnit`, UVM schema
version).

Не использовать один `logicalId` как identity: разные dependency overlays могут
разрешить его в разные bytes.

### 1B. Затем persistent cache

Только после доказанного memory-cache выигрыша добавить Node-side persistent
storage:

- имя entry — hash полного cache key, не пользовательский путь;
- atomic temp write + rename;
- manifest с schema/cache revision, UVM length и digest;
- проверка bounds перед read/allocation;
- hash validation; corrupt entry удаляется/игнорируется;
- общий размер и число entries ограничены;
- LRU/oldest cleanup можно делать при startup или после записи;
- cache miss всегда корректно возвращается к native route;
- смена converter revision инвалидирует entries без миграции.

Не переиспользовать extension installation ArtifactStore: у него другая модель
доверия и lifecycle. Нужен маленький cache производных model projections рядом
с host model-resource infrastructure или существующим общим derived-artifact
cache, если такой появится к моменту реализации.

### Что должно кешироваться

Первый безопасный артефакт — byte-exact source-free UVM output. Не кешировать
live codec sessions, leases, AbortSignal, functions или GPU handles на диск.

Diagnostics, зависящие от текущего resolution session, не должны слепо
восстанавливаться из старого cache. Постоянно хранить только diagnostics,
являющиеся частью conversion result и имеющие доказанную стабильность.

## Возможный этап 2: direct common-facet fast path

M3 codec уже публикует `common.view/model-scene-source` и часть соседних facets.
Host теоретически может потреблять их непосредственно и не создавать
serialized UVM для обычной geometry/material модели.

Рекомендуемое условие fast path:

```text
native codec advertises all facets required by this request
AND no required effect/projector/sidecar behavior exists only in UVM
AND caller did not request portable UVM bytes/package export
```

Для этого, вероятно, понадобится разделить две потребности:

- render facets для текущего кадра;
- portable UVM projection для export/package/effect source.

Не возвращать пустой fake `bytes`. Лучше расширить request/result contract,
например запросом `projection: 'required' | 'if-needed'`, сохранив default,
который не ломает текущих callers. Конкретную форму выбрать после impact
analysis всех использований `ModelResourceResult.bytes` и
`WorldSceneModelResult.uvmBytes`.

Риски direct path:

- `uvmEffectSource(result.uvmBytes, ...)` сейчас питает model effects;
- M3A companion binding может быть полнее после source-free conversion;
- native facets и reopened UVM должны давать одинаковые IDs, transforms,
  material bindings и animation clips;
- package writer требует complete `uvmBytes`;
- browser и Node codec capabilities могут различаться.

Direct path считать успешным только после fixture, сравнивающей native facets и
UVM facets на representative models: static, skinned, animated, material skin,
particles/projectors и M3A sidecar.

Если профиль покажет, что native M3 decode занимает почти всё время, direct
path даст мало и его не нужно реализовывать раньше persistent decoded/projection
cache.

## Рекомендуемый этап 3: GPU instancing

Кеш ускоряет загрузку, но почти не исправляет 700–1000 ms full-object frame.
Для runtime нужен instancing повторяющихся моделей.

Уточнение после ревизии (F4): цель instancing здесь — **число draw calls и
стоимость CPU submit**. Старые geometry counters не охватывают все material
buffers и draws (F4). Автоматической экономии GPU-памяти от instancing ждать не
следует: геометрия уже общая. И по F6 instancing не улучшит анимированный кадр,
пока план пересобирается целиком, поэтому при ненулевом animation step
разделение static plan и dynamic state обязательно раньше instancing.

### Целевая структура

```text
ModelGeometryKey
  -> one local-space vertex/index GPU allocation
  -> material/program bindings
  -> instance buffer[]
       transform
       tint/team color
       object id for picking
       optional animation/pose group id
```

Начать только со статичных opaque/alpha-test primitives с одинаковыми geometry,
material program и texture bindings. Это наиболее простой и безопасный класс.

Перед instancing выгоднее закрыть F5: убрать per-triangle world-space
преобразование и picking-копии на shared-material ветке. Это меньший дифф,
может менять внутренний picking plan, но не требует изменения shader programs и уменьшает
plan bytes и время построения плана (7430 ms p50).

Следующие классы добавлять отдельно:

1. статичные transparent models — только с корректной instance sorting;
2. одинаковый skinned model с одинаковыми clip/time/pose — shared sampled pose;
3. разные animation times — отдельные pose groups или GPU skinning;
4. particles/projectors — отдельный effect path, не смешивать с mesh instancing.

Shadow pass должен использовать тот же instance buffer. Первый picking path:
shared local-space geometry + instance transform + bounds rejection и точное
пересечение по требованию. GPU picking добавлять только если CPU path останется
дорогим: он требует отдельного pass и синхронизации readback.

### Ключ инстанса

Минимально:

```text
sourceKey
+ primitive/mesh identity
+ material program identity
+ texture bindings
+ alpha/blend/shadow policy
+ sampled pose identity, если animated
```

Transform и object ID не входят в geometry key, а находятся в instance buffer.

### Инварианты

- не объединять разные material skins;
- не объединять разные alpha cutoff/blend modes;
- transparent order должен оставаться корректным;
- model effects не должны запускаться один раз вместо одного раза на instance;
- actor-selected animation/model state сохраняется;
- cliff models используют те же правила, но не должны ломать terrain cut/fill.

## Рекомендуемый этап 4: память и lifecycle

После cache/instancing измерить retained memory и устранить доказанные дубли:

- одна owned UVM byte copy на live projection;
- source M3 bytes освобождаются после decode только если codec/session больше не
  нужен для facets/children;
- CPU RGBA texture может освобождаться после GPU upload только если не нужна
  повторная upload, context restore, export или inspection;
- одинаковая decoded texture разделяется по content identity;
- GPU resources reference-counted и освобождаются вместе с renderer/world
  lease;
- static plan отделён от dynamic animation/effect state;
- animation frame не перестраивает terrain и static object geometry.

Не суммировать payload bytes, plan bytes, JS heap и GPU bytes как независимые:
они частично описывают одни и те же данные. Для memory report отдельно показать:

- source/compressed CPU bytes;
- decoded CPU geometry;
- UVM bytes;
- decoded RGBA;
- plan arrays;
- known GPU buffers/textures;
- peak и retained после GC/lease release.

## Что не следует делать

- Не создавать второй SC2-only WebGL renderer.
- Не передавать raw M3 structs напрямую в `@modkit/scene`.
- Не кешировать только по logical path.
- Не кешировать ошибки, abort и partial results как успешные.
- Не отключать animations/effects/textures ради красивого benchmark.
- Не менять `maxConcurrentModelAcquisitions` вслепую: восемь workers уже могут
  упираться в память, GC или один CPU core.
- Не добавлять texture atlas до доказательства совместимости sampler/wrap/mip/
  colour-space semantics.
- Не рефакторить весь `createWorldWebGlPlan` до первой измеримой оптимизации.
- Не считать уменьшение первого кадра доказательством роста steady-state FPS.

## План выполнения для агента

### PR/коммит 1: profiling receipt

1. Добавить model subphase timings и byte counters.
2. Покрыть narrow tests.
3. Получить Amphion cold baseline и top-20 моделей.
4. В документе результата выбрать следующий этап по данным.

### PR/коммит 2: минимальный cache

1. Добавить session-scoped bounded single-flight UVM projection cache с
   namespace и ключом по F2.
2. Доказать byte-exact equality cached/uncached UVM.
3. Считать resolve/native opens/exports отдельно, включая retries и material
   models; сравнить успешные exports с уникальными безопасными cache keys (F1).
   Проверить, что cliff yaw-варианты по-прежнему различаются в render.
4. Повторить Amphion cold и warm.
5. Если выигрыш мал, не строить persistent cache; перейти к bottleneck,
   показанному профилем.

### PR/коммит 2.5: picking и per-triangle работа

Новый этап, выполняется до instancing.

1. Убрать per-triangle world-space преобразование на shared-material ветке и
   `number[]` picking-копии (F5).
2. Сохранить корректность picking: object-id/GPU picking либо per-object bounds
   плюс тест треугольников по требованию.
3. Сравнить `worldPlanBytesRetained`, `worldPlanBuildP50Milliseconds` и
   результат picking на фиксированной камере до и после.
4. Согласованно обновить Warzone-тест, если изменилась форма плана (F7).

### PR/коммит 3: static/dynamic frame

1. Переиспользовать terrain/cliff preparation и неизменные данные между
   animation frames; отдельно обновлять poses, material clocks, water/effects.
2. Проверить, что меняются реальные позы/UV/эффекты, а static buffers сохраняют
   identity. Нельзя достигать reuse замораживанием времени.
3. Invalidation при geometry/material/source revision, edit/preview transform;
   selection должна обновлять highlight. Новые progressive batches не должны
   оставлять старые placeholders или менять framing при каждом draw.
4. Снять статичный и анимированный receipts, отдельные static builds/dynamic
   updates и их timings; отсутствие полного rebuild само по себе не FPS gate.

### Необязательный отдельный коммит: persistent cache

1. Реализовать bounded atomic Node storage.
2. Добавить invalidation/corruption/budget tests.
3. Проверить warm app restart.

### PR/коммит 4: static opaque instancing

1. Выбрать один общий material path и один repeated fixture.
2. Добавить instance buffer + shadow + picking.
3. Сравнить изображения и plan/GPU memory.
4. Расширять классы только после успешного измерения.

Direct native-facet fast path выполнять отдельным коммитом и только после
parity fixture. Он не является обязательным условием cache/instancing.

## Тесты и критерии приёмки

### Функциональные

- число converted/unresolved моделей Amphion не хуже baseline;
- не появляется новых diagnostic placeholders;
- actor-derived model swap и animation selection сохраняются;
- material models/skins сохраняются;
- `Elescaro Waves` и `Compound Sewers Water Effect` не исчезают и не становятся
  black opaque quads;
- foliage alpha edges, белые/голубые зонтики, splats, ramps/cliffs и shadow
  direction не регрессируют;
- terrain-only и full-object render сохраняют поворот overview на 90 градусов
  против часовой стрелки;
- package/export route по-прежнему получает complete UVM там, где требует его.

### Cache correctness

- одинаковый source/options -> byte-exact UVM;
- изменение source revision/digest -> miss;
- изменение M3A/effect companion -> miss;
- изменение units/schema/converter revision -> miss;
- concurrent identical requests выполняют одну conversion;
- abort/failure не загрязняют cache;
- corrupt/truncated/oversized persistent entry безопасно игнорируется;
- eviction соблюдает limits;
- leases и child resources освобождаются на hit и miss.

### Performance

После profiling зафиксировать конкретные gates. Предварительные цели, уточнённые
после ревизии:

- **cold**: устранить доказанные повторные exports при одинаковом безопасном
  ключе; процент ускорения установить после профиля. 177 повторов результатов
  не доказывают −25% wall time, особенно при восьми workers;
- warm model acquisition минимум в 5 раз быстрее cold либо <= 30 s на том же
  стенде;
- cold acquisition не медленнее baseline более чем на 10%;
- cache hit не вызывает `convertM3ProjectionToUvm`;
- objects plan bytes: picking-копии всех 1,786,824 треугольников занимали бы
  64,325,664 bytes, около 17.1% от 375,974,896. Удаление только shared-material
  копий даст меньше; −30% требует ещё одного доказанного источника экономии.
  Число 129 MB для `number[]` — оценка хранения double, не heap measurement;
- instancing: цель сокращения draws назначить по прямому счётчику каждого pass.
  `geometryCacheHits` не является счётчиком draws или доказательством CPU bound;
- **steady-state frame измеряется в двух режимах отдельно**: при неизменном
  `timeSeconds` (план переиспользуется) и при ненулевом animation step (план
  сейчас пересобирается каждый кадр, F6). Цель «в 2 раза быстрее» относится к
  первому режиму; для второго целью является исчезновение полного rebuild, то
  есть `worldPlanBuilds` не растёт линейно с числом кадров;
- `worldPlanBuildP50Milliseconds` не ухудшается и после закрытия F5
  уменьшается измеримо;
- plan build/reuse count не ухудшается;
- после release retained cache/GPU memory укладывается в заявленные limits.

Это цели, не заранее доказанные обещания. Если profiling покажет другой предел,
обновить gates до реализации и приложить receipt.

### Визуальные

Сделать fresh и warm рендеры:

1. terrain/cliffs/water;
2. все доступные objects/doodads;
3. overview 1280 x 1280;
4. high-resolution overview;
5. isometric camera.

Для persistent UVM cache cached и uncached source-free bytes должны совпадать
точно. Для GPU renders использовать fixed camera/time и image diff; cached и
uncached route не должны иметь содержательной разницы. Небольшой GPU tolerance
допускается только если источник nondeterminism документирован.

## Команды воспроизведения

Из `modkit-core`:

```powershell
node scripts/render-world-payload.mjs `
  --payload ../artifacts/lighting/payload-complete `
  --out ../artifacts/lighting/render-model-optimization `
  --cameras ../artifacts/appearance/cameras.json `
  --size 1280x1280 `
  --backend gpu `
  --benchmark 20
```

Добавить `--terrain-only` для контрольного terrain route. Для проверки
анимаций использовать ненулевой `--animation-step`; опубликованный baseline был
статичным.

Product route находится в соседнем репозитории:

```text
../modkit-extensions-blizzard/starcraft2/test/amphion-product-route.test.ts
```

Использовать существующие environment switches теста для fixture, payload output
и лимитов. Не добавлять абсолютный путь к локальной установке SC2 в исходный
код.

## Ожидаемый отчёт агента

Агент должен вернуть:

- изменённые файлы и commit hash;
- таблицу cold/warm subphase timings;
- cache hit/miss/single-flight counters;
- payload/plan/GPU/retained memory до и после без их суммирования;
- benchmark по passes, а не только общий FPS;
- ссылки на terrain-only и full-object images;
- список неустранённых visual parity проблем;
- объяснение, почему был выбран cache, direct path или instancing;
- подтверждение, что посторонние dirty changes не вошли в коммит.

## Рекомендуемое решение в одном абзаце

Не заменять текущую архитектуру прямым M3 renderer. Сначала измерить этапы
`resolve -> native open/decode -> UVM export -> UVM reopen/facets -> textures`.
Если дорог UVM export, добавить bounded session-scoped cache, затем безопасный
persistent cache source-free UVM. Если дорог native decode, кешировать projection
так, чтобы hit происходил до полного M3 decode, сохранив resource provenance и
companion identity. После загрузки основной runtime выигрыш получать через
static GPU instancing и устранение per-instance picking/triangle copies.
