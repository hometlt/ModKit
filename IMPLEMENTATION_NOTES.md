# Implementation notes — modkitX3

Newest entries first. Owner documents live in `modkitx/docs`; this file records lab-side
analysis, decisions inside the delegated lab scope, and owner-decision gaps. It never
overrides a canonical or detailed owner.

---

## Assets Capabilities media layer and codec boundaries (2026-08-16)

- The standard data-source registry now owns five presentation-neutral media contracts:
  raster-image, vector-scene, audio-media, video-media and model-scene. They are bounded/lazy and
  browser-neutral; viewers no longer infer a format from raw bytes.
- Native codecs remain authoritative for parsing. UVG/UVA/UVV/UVM are interchange/cache targets,
  not mandatory eager copies on every open. This preserves native source bytes, provenance and
  round-trip evidence while still allowing a converter provider to materialize a UV asset.
- The extension split follows dependency closures, not filename count: archives, images, audio,
  video, vector, models and common documents are separate packages. Text syntax is split further
  into JSON/JSONC, CSV/TSV, INI, XML, YAML and TOML install units so one parser dependency never
  arrives with an unrelated format. Zero-dependency siblings may share one family package, but each
  codec has its own entrypoint. A dependency-heavy decoder/renderer must be a separate provider
  extension/package rather than entering a family index or `@modkitx-x3/ui`.
- PNG/JPEG publish raster sources; PNG additionally exposes a bounded lazy RGBA8 region decoder for
  supported 8-bit non-interlaced images. MP3/Ogg publish audio sources; MP4/WebM publish video
  sources. SVG publishes only the rejected-on-active-content `uvg.secure-static.v1` profile. OBJ
  publishes decoded triangle geometry; glTF publishes a metadata-only scene until its artifact-
  bound external buffers are resolved.
- UI image, audio, video, vector and model stages are independent public entrypoints. The root UI
  export may aggregate declarations, but activation imports only the selected contribution
  entrypoint. The lightweight viewers use browser decoders/2D rendering; WebGL/Three.js, FFmpeg,
  Basis/KTX2 and native codecs remain optional providers.
- `StandardTraitParameterMap` gives media traits typed parameter profiles while preserving
  `JsonValue` fallback for standard traits that do not yet have a specialized profile.

Open owner/spec work remains explicit: UVT/UVA/UVV/UVG wire drafts are not frozen; glTF external
buffer/image companion resolution belongs to the host artifact planner; full JPEG/MP3/Ogg/video
decode and GPU model rendering require separately selected providers. None of those gaps merge the
reference codec packages or weaken the source contracts.

---

## A‑2…A‑8 implementation handoff (2026-08-15)

- A‑2 closes inventory → contract-owned projection → resolution → artifact-bound activation,
  including deterministic lock replay, service facets and owner-atomic definition inventory.
- A‑3 provides descriptor assembly, read-only asset/operation sessions, all rejection states,
  stale-revision handling, idempotent disposal and the catalog-only v2→v1 adapter.
- A‑4 provides authoring builders/profiles, target smoke evidence, explain output and the
  four-concept codec scaffold; A‑5 carries the eight-family schema stress gate.
- A‑6 implements bounded byte/text/table data sources and deterministic presentation resolution,
  validation, singleton/fallback behavior and session-preserving stage changes.
- A‑7 is the external `common/plain-text` vertical slice: bounded structural detection, stable
  subject identity, read-only sessions, text/byte sources and platform-viewer routing without
  format strings. Its public index does not import executable implementation before activation.
- A‑8 installs packed platform and extension artifacts in clean directories. The host-free
  `./direct` surface runs without `@modkitx-x3/host`; the `./runtime` boundary fails closed when
  host is absent and loads when the packed host closure is installed.
- Successful A‑8 is a handoff, not promotion. Package names remain `@modkitx-x3/*`, MK2 remains
  unchanged, and 13B/13C/13D remain separately owned implementation tracks.

---

## A‑1 implementation handoff (2026-08-15)

- Opus verdict: **ACCEPT A‑1 with one P1**. The P1 is closed: the published core
  `sourceSpanSchema` now has a real `json-schema-to-ts` exact-union drift assertion. The separate
  data-source schema name is intentionally a compatibility alias of the published contract-
  definition data-source arm, not a thirteenth SDK artifact.
- Production core/SDK schema and ABI surfaces from BRIEF‑13A A‑1 are implemented, emitted and
  exercised by compile, runtime, adversarial, bundle and packed-consumer gates.
- `TraitId`/`TraitInstance` are the v2 names; no `Capability*` compatibility re-export is added.
- Producer trait declarations use exact definition versions and explicit representation/presence;
  consumers use ranges. Fidelity stays in observed/conformance evidence, not authored claims.
- Descriptor v2 carries portable single/bundle/namespace/derived origin, exact revisions and
  resolved/missing/ambiguous companion requirement state.
- Multiple service offers retain `offerId` and an optional non-secret contract selection key at
  activation; raw facets do not cross into activation tickets or portable policy locks.
- This is an implementation handoff, not self-acceptance. A‑2 inventory→fact→offer projection,
  facet matcher behavior, A‑3 sessions, A‑5 format stress and A‑6 presentation runtime remain open.

## Owner disposition and A-0 continuation (2026-08-14)

- Owner disposition after S4: **REVISE / CONTINUE**, not adopt or archive.
- S0–S4 implementation and packed-artifact evidence remain the proof baseline.
- A-0…A-8 from `modkitx/docs/tasks-active/platform-architecture/BRIEF_13A_mk3_extension_reference_spec.md`
  are next; A-0 is governance/status only and A-1 is the next implementation slice.
- Lab packages remain `@modkitx-x3/*`; promotion into `@modkitx/*` requires successful A-8 and a
  separate owner decision. MK2 remains unchanged.
- The BRIEF-13A/13B/13D compile fixtures prove type-level expressiveness. They do not prove a
  production SDK, host, data-source, viewer or editing runtime.

---

## Benchmark policy simplified (2026-08-14)

The calibration experiment below is retained as history, not as the current acceptance path.
The owner removed local probes, normalization and mutable baselines after they became more complex
than the performance question they were meant to answer.

- `pnpm check` is the mandatory functional, packaging and boundary gate.
- `pnpm bench` reports `core-import`, `closure-import` and `cli-validate-net` and always exits 0.
- `pnpm bench:gate` applies the same three absolute budgets only on a fixed CI runner or dedicated
  reference machine; a noisy scenario is `INCONCLUSIVE` (exit 2), not a pass.
- Until such a runner exists, performance numbers are observations and do not block adoption.
- The single-file production bundles remain: they are a packaging optimization independently
  justified by smaller public entry graphs, deterministic output and the external tarball proof.

Current verification: `pnpm check` passes 106/106 tests. A local informational run measured
core 7.78 ms, closure 36.34 ms and CLI validate net 316.62 ms; only the CLI observation exceeded
its 250 ms target, and it did not gate the run.

---

## Bundling pass + window (2026-08-14, 00:55–01:08) — no verdict, blocked by my own rule

Bounded bundling pass выполнен по авторизации владельца: каждый published entry
`core`/`sdk`/`vfs`/`host` — один детерминированный ESM-файл (esbuild над выходом `tsc`),
CLI — self-contained application bundle, `testkit` не бандлится; TS-исходники остались
модульными, межпакетные и внешние импорты остались external (иначе продублировалось бы
состояние модулей соседа — в `host` это security-WeakSet'ы), `exports` и `.d.ts` не тронуты.
110 тестов, внешний tarball-proof и browser-safety зелёные; две сборки побайтово идентичны
(гейт — тест, а не самоперезаписываемый файл хешей). Production-замыкание примера 1.44 → 1.36 MB.

**Окно вердикта не дало.** Все три прогона (включая попытку записать baseline) —
`INCONCLUSIVE`: `probe9` показал ×0.65–0.67 от старого baseline.

|                        | probe1 | probe9        | core (гейт 15) | closure (50) | CLI net (250) |
| ---------------------- | ------ | ------------- | -------------- | ------------ | ------------- |
| baseline до бандлинга  | 1.56   | 21.84         | 18.80          | 68.82        | 315.55        |
| 01:05 попытка baseline | 1.72   | 14.17 (×0.65) | 9.14           | 41.53        | 311.69        |
| 01:06 прогон 1         | 1.81   | 14.53 (×0.67) | 8.95           | 42.68        | 337.47        |
| 01:07 прогон 2         | 1.70   | 14.54 (×0.67) | 9.02           | 43.45        | 339.93        |

**Блокировал дефект моей логики (L19).** `--update` проверяет дрейф probe против **старого**
baseline, хотя смысл `--update` — заменить точку отсчёта. Сравнивать с тем, что собираешься
переписать, логически неверно, и это создаёт тупик: после любого изменения, которое меняет
характеристики (здесь — бандлинг), новый baseline записать невозможно. Предложение владельцу:
дрейф probe против старого baseline **не блокирует `--update`** (только предупреждение),
проверка шума остаётся; для зачётных прогонов правило не меняется. **Не применяю сам** —
это правка измерителя после нерезультативной сессии.

**Наблюдения, не вердикт** (сессии невалидны по собственному правилу):

- сырые: `core` 18.80 → 9.0, `closure` 68.82 → 42.7;
- `probe9` упал 21.84 → 14.5 при неизменных фикстурах. Вероятная причина — не машина, а сами
  фикстуры: baseline снимался вскоре после их создания (первое чтение, скан антивируса), а
  теперь они прогреты. Если так, **нормализация в этой сессии вводит в заблуждение**
  (normalized `closure` 64–65 противоречит структурному эффекту бандлинга). Ограничение
  метода: калибровочная фикстура тоже имеет состояние кэша, и его надо учитывать при первом
  baseline после свежего checkout;
- **`cli-validate-net` бандлингом не улучшился** и превышает гейт во всех трёх прогонах
  (312–340 при 250), независимо от калибровки. Правдоподобная причина — `modkit validate`
  подтягивает ajv (CJS-граф в сотни файлов) при первой валидации; это первый кандидат на
  разбор, но пас bounded — без решения владельца не начинаю.

---

## Window on the corrected meter (2026-08-14, 00:12–00:25) — cause finally attributed

Протокол владельца исполнен на перестроенном харнессе: 10 минут простоя → baseline новой
версии → два зачётных прогона; агент во время окна не выполнял операций.

|                                                  | probe1                    | probe9 (9 модулей, профиль `core/dist`) | core (9 модулей)    | closure (~35 модулей) | CLI net          |
| ------------------------------------------------ | ------------------------- | --------------------------------------- | ------------------- | --------------------- | ---------------- |
| baseline 00:22                                   | 1.56                      | 21.84                                   | 18.80               | 68.82                 | 315.55           |
| **run 1 00:23** (probes ×0.99 / ×1.02 — валиден) | 1.54                      | 22.31                                   | **18.18** (гейт 15) | **66.88** (50)        | **327.57** (250) |
| run 2 00:24                                      | 0.98 (spread 78 %, ×0.63) | 22.56                                   | 18.34               | 68.23                 | 309.05           |

**Итог: один валидный прогон, и он провален → REVISE** по правилу владельца. Run 2 —
`INCONCLUSIVE` (probe1 зашумел), в зачёт двух прогонов не идёт. Лимиты не менялись.

### Атрибуция причины (то, ради чего чинили измеритель)

Контрольное сравнение, впервые корректное — probe и measurand измерены одним кодом в одной
сессии:

- `core` (9 модулей) — **18.2 ms**;
- `probe9`, синтетический граф из 9 модулей того же размерного профиля, без единой строки
  логики Modkit — **22.3 ms**.

`core` **дешевле** эталонной пустышки такой же формы. Значит код `core` не является причиной:
стоимость создаёт сам модульный граф. Численно: probe1 1.5 ms, probe9 22 ms → ≈2.3 ms на
модуль; `closure` 67 ms при ~35 модулях ≈ 1.9 ms на модуль — сходится.

Следствие, которое теперь доказано, а не предположено: **гейт 15 ms ниже стоимости любого
девятимодульного пакета на этой машине**, включая пустой. Это несовместимость бюджета с
физической раскладкой файлов, а не дефект структуры `core`.

Условие владельца («если после исправления измерителя сопоставимая сессия действительно
провалится — предпочтительное исправление single-file production dist при модульном
TypeScript source») **выполнено**: сопоставимая сессия провалилась. Авторизация на бандлинг
не выдавалась заранее, поэтому лаборатория останавливается и запрашивает её отдельно.

### Известное ограничение нового измерителя (не правлю после результата)

`probe1` измеряет ~1.5 ms, и на этом масштабе относительный разброс нестабилен: в run 2 он
дал 78 % и ×0.63, из-за чего вся сессия ушла в `INCONCLUSIVE`, хотя `probe9` был ×1.03.
Предложение **до следующего окна** (решает владелец): либо применить к probes то же
scale-aware правило, что и к сценариям, либо оставить `probe1` информационным, а гейтить
калибровку по `probe9` — он один в один повторяет форму measurand. Сейчас не трогаю: менять
калибровку после красного результата — подгонка.

---

## Idle-window result (2026-08-13, 19:27–19:43) — REVISE confirmed by a valid run

Окно исполнено по протоколу владельца: 10 минут простоя, ровно два последовательных
`pnpm bench:gate`, агент во время окна не выполнял никаких операций.

| Прогон    | machine floor                | core (гейт 15)      | closure (50) | CLI net (250) | Итог   |
| --------- | ---------------------------- | ------------------- | ------------ | ------------- | ------ |
| 1 (19:41) | 3.24 ms (×1.44 baseline)     | 20.07 (spread 13 %) | 79.07 (13 %) | 384.79 (7 %)  | FAILED |
| 2 (19:43) | **2.19 ms (×0.97 baseline)** | 20.12 (15 %)        | 74.36 (6 %)  | 353.51 (2 %)  | FAILED |

Прогон 2 прошёл все проверки **той версии харнесса** и провалил гейты. Это **формальный gate
failure; причина не атрибутирована** (правка по указанию владельца 2026-08-13; моя прежняя
формулировка «это уже не среда, а факт о коде» была переоценкой). Основание правки: floor ×0.97
ничего не доказывал, потому что сам зонд был невалиден — он импортировал файл, который сам
только что создал, тогда как `core-import` читает существующий `dist` в отдельных новых
процессах. Разные нагрузки, поэтому равенство floor не означает равенства состояния файлового
пути. Сравнение «1 модуль против 9» поддерживает гипотезу о цене модульного графа, но **не**
доказывает дефект структуры `core`.

Статус REVISE сохраняется, но его причина — **незакрытая достоверность бенчмарка**, а не
доказанная медлительность ядра. Лимиты не трогались, прогоны не повторялись.

### Разбор (следующий шаг по правилу владельца)

Измерено сразу после окна, на той же машине:

| Что импортируется                                    | Стоимость                                   |
| ---------------------------------------------------- | ------------------------------------------- |
| floor-зонд: файл, который зонд сам только что создал | 2.19 ms                                     |
| один **существующий** модуль `core/dist/ids.js`      | 6.89 ms                                     |
| весь barrel `core` (9 модулей)                       | 18.5–20.2 ms (5 прогонов подряд, стабильно) |

Отсюда два вывода.

1. **Калибровочный зонд был недостаточен (L18).** Он создавал файл и тут же его импортировал —
   страница в кэше, антивирус отработал на записи. Реальные сценарии читают dist, записанный
   часами раньше, в отдельных новых процессах. Поэтому floor мог показывать ×0.97 «машина та
   же», пока путь чтения существующих файлов подорожал.
2. **Гипотеза о цене модульного графа** (один модуль ~6.9 ms против девяти ~19.5 ms)
   поддержана, но **не доказана**: пока измеритель невалиден, любая атрибуция преждевременна.

**Исправлено по указанию владельца (2026-08-13, `modkitX3`@5396bef):** зонд заменён на две
заранее закоммиченные фикстуры — `probe1` (один существующий модуль) и `probe9` (существующий
граф из девяти модулей, суммарно 16.9 KB против 14.8 KB у `core/dist`), обе измеряются **тем
же кодом**, что и measurand: новый процесс на sample, тот же warm-up и N. Сессия объявляется
`INCONCLUSIVE`, если любой probe шумит или отклонился от baseline более чем в 1.5 раза в любую
сторону, и калибровка имеет приоритет над вердиктом pass/fail. `cli-validate-net` переведён на
чередование bare/CLI с распределением парных разностей (раньше сначала измерялись все bare,
потом все CLI — смещение при изменении нагрузки). Бюджеты 15/50/250/100/1 не тронуты.

**Сверх поручения, только как информация и без гейта:** `normalizedP50` — сырое значение,
пересчитанное на дрейф `probe9`. Это отделяет «машина сегодня медленнее» от «код стал
медленнее» с одного взгляда, но авторитетом остаётся сырой p50, пока владелец не решит иначе.

---

## G13 execution result (2026-08-13) — REVISE stands, budgets not closed

Прогон по принятому владельцем протоколу (два последовательных тихих прогона на
reference-машине) **не дал двух зелёных сессий**. Фактические результаты, все на одном и том
же коде и одной машине, различаются вдвое в зависимости от того, работает ли на ней что-то
ещё:

| Состояние машины                | floor        | core-import (гейт 15) | closure (50) | CLI net (250) | Вердикт           |
| ------------------------------- | ------------ | --------------------- | ------------ | ------------- | ----------------- |
| Простой после отстоя            | 1.82–1.86 ms | 7.55–7.84             | 31.5–39.0    | 175–203       | всё в бюджете     |
| Идёт работа (сборки/линт/тесты) | не мерился   | 15.6–44.3             | 60.5–161.7   | 299–668       | стабильный провал |

По правилу владельца «один стабильный провал → REVISE, лимиты повторно не подгонять»:
**статус остаётся REVISE**, X3-S0 — `in-progress`. Числа не переписывались.

Существенное: это **не** факт о коде, а факт об измерительной среде. Ноутбук, на котором
идёт разработка, не может служить тихой reference-машиной, пока на нём идёт разработка;
принятые гейты (15 / 250 ms) лежат ровно на границе его рабочего состояния. Решение, где
мерить (выделенный тихий прогон/CI-раннер), остаётся за владельцем — лаборатория его не
принимает за него.

Инфраструктура к этому готова: baseline записан **вместе с machine floor** (2.25 ms), и
сессия, где floor уехал более чем в 1.5 раза, помечается `INCONCLUSIVE` независимо от
разброса — равномерно загруженная машина даёт медленные замеры с узким разбросом, чего
эвристика разброса в принципе не видит.

**Честная правка предыдущего заявления.** В коммите `b1b68a8` я написал, что шумная сессия
теперь `INCONCLUSIVE`, а не `passed`. Это было неверно: одна из трёх текстовых замен молча не
совпала, массив `inconclusive` заполнялся, но вердиктом не читался — и сессия с NOISY-сценарием
всё ещё печатала `passed` (поймано на живом прогоне: closure-import, разброс 47 %, exit 0).
Причина — мой guard проверял только «файл изменился», что удовлетворяли две другие удачные
замены. Исправлено в `a6edadf` с проверкой каждой замены отдельно; **L17**: правка,
сгенерированная скриптом, должна верифицироваться по каждому паттерну, а не по факту
изменения файла.

---

## Owner decisions 2026-08-13 (G13 + package topology)

**G13 — бюджеты §6 стали platform-specific.** Владелец принял reference environment (Intel
Core Ultra 7 155U, Windows x64, Node 24.16.0) и p50-гейты: `core-import` < 15 ms,
`closure-import` < 50 ms, `cli-validate-net` < 250 ms, `inventory-100` < 100 ms,
`resolve+explain` < 1 ms. p95 записывается, но не блокирует; сессия с разбросом > 35 % не
является доказательством; закрытие требует двух последовательных тихих прогонов; на других
машинах — только регрессия относительно их baseline; прежние 5 ms / 150 ms остаются
оптимизационными целями вне DoD; бандлинг ради прохождения проверки не вводится. Решение
записано в BRIEF-12 §6 (владелец разрешил правку этого файла явно — вне обычного §8-скоупа
лаборатории). Харнесс печатает aspiration отдельной пометкой, чтобы прежние цели не потерялись.

**Package topology подтверждена.** `core`, `sdk`, `vfs`, `host` и dev-only `testkit`
остаются отдельными publication units: вместе они образуют ядро MK3 как систему, но
физически сливать их в один `packages/core` не следует (owner, 2026-08-13). Это совпадает с
каноном §6.1 и снимает вопрос на будущее — переоткрывать его без нового основания не нужно.

**L16** (из этого же прохода): «не-доказательство» и «успех» — разные исходы. Гейт, который
печатал `passed` на сессии, где все материальные сценарии помечены NOISY, позволял шумной
машине «закрыть» бюджет, который никто не измерил. Теперь такая сессия — `INCONCLUSIVE`
(exit 2) и не засчитывается в два последовательных прогона.

---

## Post-audit rework R1–R8 (2026-08-13) — security boundary rebuilt

The owner accepted Sol's audit and ordered **revise**. Every finding was reproduced by the
lab before being fixed (repro script run against the built packages, not taken on faith),
and re-run afterwards. Statuses on the board were rolled back first, before any code.

### What was actually broken (all reproduced)

| #   | Defect                                                                                                                                                                                                      | Reproduction                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| D1  | `activateContribution()` accepted a raw manifest and imported whatever `entrypoint` said — an absolute URL simply wins over the base                                                                        | `data:text/javascript,…` executed, `globalThis.__PWNED === true` |
| D2  | Malformed `expiresAt` passed the check (`Date.parse` → NaN → comparison false)                                                                                                                              | grant with `"not-a-date"` accepted                               |
| D3  | No runtime-target check at activation                                                                                                                                                                       | `browser-main`/`linux`/`arm64` variant activated on Windows-x64  |
| D4  | Owner matrix promised `PermissionGrant` scopes + `parent ∩ callee ∩ policy ∩ operation`; only a class list existed                                                                                          | code inspection                                                  |
| D5  | Policy lock kept input order when two entries shared a key                                                                                                                                                  | `serialize([a,b]) !== serialize([b,a])`                          |
| D6  | `range`/`license` accepted arbitrary text despite `core` owning a range parser                                                                                                                              | `range: "not a semver range"` → 0 diagnostics                    |
| D7  | Bench harness measured process spawning; baselines were noise                                                                                                                                               | 8.8→12.4 ms and 257→420 ms across sessions, no code change       |
| D8  | Raw control bytes in two `host` sources (git saw them as binary); dev-only `testkit` in the example's production closure; blanket `target-incompatible`; lint tolerated warnings; contradictory PORTED tail | byte scan + manifest read                                        |

### What the rework put in place

- **ActivationTicket** (branded, issued only from a `resolved` ResolutionResult) is now the
  only admission to activation. The gate re-verifies extension/contribution/contract/
  variant against the inventory manifest, so a manifest swapped after resolution, a
  foreign extension or a foreign target are refusals — not trust.
- **Entry-point containment** (`host/security/entrypoint.ts`): URL schemes, absolute
  POSIX/Windows/UNC paths, backslashes, `..` traversal and control characters are rejected
  syntactically _and_ by a resolved-URL containment proof, with the same rules mirrored in
  the schema. Two independent gates; the host never assumes the schema ran.
- **PermissionGrant** per 24 §3.1/§4 with filesystem/network/credential scopes and
  `narrowGrant()` implementing `parent ∩ callee request ∩ host policy ∩ operation`;
  `assertNotWider` makes the «child never widens» invariant testable. Validity is
  fail-closed: unparseable or past expiry denies.
- **Honest diagnostic**: `trusted-in-process` activations now carry
  `x3.host/full-process-authority` stating in words that this is an audit/policy boundary,
  not a sandbox (24 §5.1) — the earlier silence implied more than the code delivered.
- **Lock**: conflicting entries under one key are refused; ordering falls back to the full
  canonical entry, so byte-stability no longer depends on input order.
- **Schema**: SemVer-range pattern + a semantic re-check through the resolver's own parser.
- **Security negative suite** (22 cases) proves each refusal happens _before_ the import
  via a spy counter, including the exact `data:` bypass the audit demonstrated.
- **Bench harness** rebuilt (see the S4 section below for what this changed in the numbers).

### Second audit (2026-08-13) — R9: ticket provenance

The audit disproved a claim I made in this very file: «ActivationTicket … not
hand-constructible». The brand only stopped an object literal from type-checking; the
public `issueActivationTicket()` accepted anything _shaped_ like a `ResolutionResult`, so a
fabricated `{ state: 'resolved', … }` came back as a genuine ticket — and the issued ticket
stayed mutable. Reproduced before fixing: a ticket was issued for `org.evil/x` and its
`variantId` overwritten by plain assignment.

Closed three ways, because relying on one mechanism was exactly the problem:

1. `resolveProvider` registers every result it returns in a private `WeakSet`; the issuer
   refuses anything absent from it (`x3.host/foreign-resolution-result`).
2. The free issuer left the package surface. The public entry point is host-owned
   `resolveForActivation(request, offers, operation?)`, which resolves and issues in one
   step, so there is no API that takes an arbitrary result.
3. Issued tickets are frozen, and the gate checks **membership**, not shape — a spread copy
   `{ ...ticket, variantId: 'other' }` is a different object and is refused.

**L15**: identity-based capability objects (WeakSet membership) beat structural brands
whenever the object is a security token; a brand is a TypeScript convenience, not a
runtime check. Recorded because I got this wrong once already.

### Lab decisions added

- **L12**: only `trusted-in-process` is honoured; any other profile is
  `x3.host/unsupported-execution-profile`. Ladder steps SB-1+ arrive with their gates.
- **L13**: activation admission is a _ticket_, not a manifest. Public API shape:
  `issueActivationTicket(result, target)` → `activateContribution({ ticket, manifest, … })`.
- **L14**: a bench session whose interquartile spread exceeds 35% can neither gate nor
  become a baseline; the rule is scale-aware (a scenario 10× under budget is exempt).
- **G13** (owner question, non-blocking): §6's `import core < 5 ms` is unreachable on the
  reference machine without bundling — a single trivial ESM file costs ~1.9 ms cold here
  and `core` ships 9 modules. Options: accept an environment caveat, pick another
  reference machine, or allow a bundling step (which BRIEF §7 currently forbids).

---

## Slices S0.2–S4 executed (2026-08-13) — core proven, stop for adopt/revise/archive

All slices closed same day, each behind the full gate (`pnpm check`: build+typecheck with
drift gates, eslint, prettier, 70 vitest tests, emitted-schema check, legacy gate).
Commits: S0.2 `f9c5cf4`, S0.3 `b9daaea`+`d8cbe78`, S0.5 `da6d934`, S1 `c3bc38b`,
S2 `152a2c1`, S3 `d777da9`, S4 `d9a07b2`. S4b (`.uve` packer) NOT started — gated behind
the owner decision by BRIEF-12 §5.

New lab decisions / gaps found while building:

- **G11 (non-blocking, proposal-worthy):** MK3/23 §8's closed `UnresolvedReason` enum has
  no value for the explicitly required unsupported-kind rejection (23 §8 text + §15 use
  the term). Lab: `RejectedCandidate.reason` additionally allows `'unsupported-kind'`;
  suggested owner fix: add it to the enum in 23 §8.
- **G12 (observation):** 23 §9's stage order (permissions at stage 4, pin at stage 5)
  means a pinned-but-ungranted provider yields aggregate reason `pin-unsatisfied` while
  the `rejected` list carries its `permission-required` diagnostic — tests document this;
  no change proposed (structured diagnostics are complete).
- **L9:** envelope-derived offers project the contract version as `${major}.0.0`
  (contribution has no release version by design, 27 §0.5.1; ranges stay inside the
  major). Real minor/patch contract versions arrive with codec-v2 specs.
- **L10:** grant classes feed `RuntimeTarget.grantedPermissions` for resolution (23 §9
  stage 4) and the activation gate re-checks the same grant before the dynamic import —
  one grant, two enforcement points (SB-0 dispatch level).
- **L11:** the host supports only `trusted-in-process` in S0–S4; any other profile is a
  structured `x3.host/unsupported-execution-profile` refusal, never a downgrade
  (24 §6.1 rule 1).

Bench (recorded baselines, reference machine of C3; full closure = core+sdk+vfs+host):

| Scenario                  | p50     | §6 target | Verdict                                                                                                                             |
| ------------------------- | ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| closure-import (4 pkg)    | 30.2 ms | < 50 ms   | **in budget**                                                                                                                       |
| inventory-100-synthetic   | 0.75 ms | < 100 ms  | **in budget**                                                                                                                       |
| resolve+explain /contract | 0.01 ms | < 1 ms    | **in budget**                                                                                                                       |
| core-import               | 8.8 ms  | < 5 ms    | over — machine floor: a single module file costs ~13 ms fresh (AV/FS per-file overhead), lazy-ajv already applied                   |
| cli-validate-net          | 257 ms  | < 150 ms  | over — same floor + spawn noise (p95 416 ms); gate = regression-only on this machine pending owner review of targets vs environment |

External example closure: node_modules **1.4 MB**, 5 tarballs, zero deps beyond the lab
packages + ajv. Full route proven from the example's own cwd, deny path included.

---

## Owner decisions Q75–Q77 accepted (2026-08-13) — X3-S0.3 unblocked

The owner (relaying Sol's recommendation) approved, verbatim scope:

- **Q75 / G9 — root extension dependencies**: normalized `ExtensionManifest` gets optional
  `dependsOn?: readonly ExtensionRequirement[]` with `{ extension: ExtensionId
(publisher-qualified); range?: string (SemVer, default '*'); mode: 'required' | 'default'
| 'suggested' | 'integrates'; scope: { kind: contribution|offer|operation|intent|variant|
profile|projection|slot; id: string } }` — **`scope` is mandatory** (tightened vs the lab
  proposal) and it is a separate `ExtensionRequirement` type, not 23 §8's contract-based
  one. In S0–S4 the field is only shape-validated and preserved; no install solver;
  `integrates` creates no install edge; `conflicts`/`replaces`/`provides` deferred to a
  future install schema.
- **Q76 — standalone `version`/`license`**: normalized manifest always carries both; the
  npm adapter takes them **only** from top-level `package.json`; standalone
  `modkit.extension.json` must carry its own; duplicates inside `#modkit` = packaging
  error.
- **Q77 — one wire enum** `ExecutionProfile = 'browser-sandbox' | 'worker-brokered' |
'process-brokered' | 'wasm-brokered' | 'trusted-in-process' | 'remote-provider'`; 24 §5
  names remain prose mapping. Remote/process/WASM execution not required in S0–S4.

Also ordered: prettier format-only fix + `prettier --check` in the `pnpm check` gate (done
with this entry); real legacy gate must scan a non-zero number of sources once S0.2 lands
(asserted in the gate regression suite from S0.2 on). Route: S0.2 → S0.3 → S0.4 → S0.5 →
S1 → S2 → S3 → S4, stop after S4 for adopt/revise/archive; new architectural gaps go to
the owner, but no extra permission is awaited between green sub-stages.

---

## X3-S0.0 corrective pass (2026-08-13, after the Sol audit)

The owner-relayed audit accepted the DoR as a draft, returned X3-S0.0 to in-progress and
ordered a corrective pass. Items below amend the DoR section that follows; where they
contradict it, this section wins.

### C1. Owner-input baseline made reproducible

The DoR was read against the `modkitx` **working tree**, not a commit: `BRIEF_12` is
untracked, and `MODKIT_ARCHITECTURE.md` + `MK3/README.md` carry uncommitted edits on top of
`643abefc`, so «modkitx@643abefc» alone was not reproducible (audit item 1). SHA-256 of the
exact files read (working tree, 2026-08-13; taken at the corrective pass — text unchanged
within this session):

| File                                                                                | sha256                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| tasks-active/platform-architecture/BRIEF_12_mk3_clean_core_bootstrap.md (untracked) | `bbc00dcf36e47739bae9db348979994c8865bb97590e7b9ae7dbf71f8e942a6c` |
| architecture/MODKIT_ARCHITECTURE.md (modified vs 643abefc)                          | `902a6ece8e964677f81ca61a9e0de606b56d5f51d852c6f6ad4f9c93de8cb5e2` |
| architecture/ASSET_CAPABILITIES.md                                                  | `be3f11b17062dfbb3190546a0d5377581465164d40a0abb52d1625f5125c9164` |
| architecture/TARGET_ARCHITECTURE_OVERVIEW.md                                        | `6507de8c13c4d7fce179ee52d35b3cd0881cc50478de9efb2ec73357767fd92e` |
| MK3/README.md (modified vs 643abefc)                                                | `67133f365d9ddc9b2b85e2b122e2ac64e44646467ebfd289ce97b77bbf525643` |
| MK3/02-capabilities-and-contracts.md                                                | `b97fa113f0c70e2444b0e5c4d734593b6887ee5a00999a2b887f7cfb422f2c3f` |
| MK3/15-package-boundaries-and-extension-layout.md                                   | `295a9f9f9f4a1881c0ae75911b73707a561f2fe582b4713f98c6ebf30cb0988a` |
| MK3/23-contract-identity-schema-resolution-and-lock.md                              | `d8b18f9480286e318a414004ecce83cf9a126e9356ac312bede722ea725f88b3` |
| MK3/24-extension-security-execution-and-lifecycle.md                                | `a92034ece263dcbe8ceefb49ed6d43555b3f5c27b7a6e1bdc64dd3f9c815184b` |
| MK3/25-subject-identity-editing-transactions-and-cache.md                           | `58b6874311cfd008a57be53eb37b78b9412ae6854a5ec13a2d67edd5064a7a88` |
| MK3/27-final-target-tree-extension-manifest-and-format-catalog.md                   | `aed060645c36c79efff0db40c079564495226b19af94f14ab7b6e1193620a143` |
| tasks-active/platform-architecture/REPORT_6_…simplification.md                      | `61bd321da5f7b0bde56b73231be3c957bb29768e4fe22c50ffa4c495c30fdc77` |
| tasks-active/platform-architecture/REPORT_9_…optional_platform_core.md              | `5654e2ad0fdba2d346e401c00cc8bae5436acc0abbadf2029f268eb6166c4749` |

Recommendation to owner (lab cannot do it under §8): commit BRIEF-12 and the pending canon /
MK3-README edits in `modkitx` so future baselines are plain commit hashes.

### C2. Gap register additions (audit item 2) — G9/G10 + G5 escalation

| #      | Gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Blocking?                                                                                                                                                         | Resolution / status                                                                                                                                                                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G9     | **Root extension dependencies**: canon §5.13 prose requires the extension manifest to carry «dependencies on other extensions» (and its dependency-semantics table covers codec/extension manifests), but the adopted minimal authored form (27 §0.2, decision 64) and the v2 appendix example (27 §5) define no such field; REPORT-6 §6's minimal example has none either. A strict S0 schema must either include the field's exact shape or knowingly reject manifests that carry it | **Yes — blocks X3-S0.3** (ExtensionManifest schema). S0.1/S0.2 unaffected                                                                                         | Proposal filed as **Q75** in `MK3/11-open-questions.md` (recommended: optional `dependsOn` of extension-coordinate Requirements reusing the one-Requirement mode/scope model; shape-only validation in S0–S4, no solving). Owner decides; the DoR's earlier «deferred past S4» wording in §2.1 below is superseded |
| G10    | **Two `executionProfile` vocabularies inside MK3/24**: §3's typed enum (`browser-sandbox`, `worker-brokered`, `process-brokered`, `wasm-brokered`, `trusted-in-process`) vs §5's profile catalog (`trusted-in-process`, `wasm-sandbox`, `worker-isolated`, `sandboxed-process`, `remote-provider`) — names differ, `remote-provider` missing from the enum                                                                                                                             | No for S0–S4 (lab S3 minimum uses `trusted-in-process`; REPORT-6 §6 fixtures also use `browser-sandbox`, both inside §3's enum, which is the shape 27 §6 imports) | Proposal filed as **Q77**: unify on §3's enum + `remote-provider`, §5 headings become prose descriptions mapped 1:1. X3 schemas use §3's enum verbatim until the owner answers                                                                                                                                     |
| G5→Q76 | Standalone container `version`/`license` ambiguity — escalated from a session-report note to a formal proposal per audit item 2                                                                                                                                                                                                                                                                                                                                                        | No                                                                                                                                                                | Proposal filed as **Q76** with the same recommended reading as G5 (standalone carries own required fields; `#modkit` block must not duplicate npm fields); fixtures test both directions                                                                                                                           |

### C3. Benchmark protocol fixed in S0.0 (audit item 3; supersedes L8)

BRIEF-12 §6 requires S0.0 to fix the protocol; deferring it to S0.5 was wrong — S0.5 now
only _implements_ the script against this protocol:

- **Reference environment (recorded 2026-08-13):** Intel Core Ultra 7 155U (12 phys /
  14 logical cores, laptop-class — AC power assumed for gate runs), 31.5 GB RAM, NVMe SSD
  (Phison 512 GB), Windows 11 Pro build 26200, Node v24.16.0, pnpm 11.8.0. Numbers are an
  **absolute target + this-machine baseline**, never cross-machine constants.
- **Warm-up:** ≥3 discarded runs per scenario (warm FS, JIT); FS-cold numbers are out of
  scope for the §6 gates.
- **Run counts:** N=100 measured runs for in-process micro scenarios (inventory, resolve,
  explain); N=20 for process-level scenarios (CLI validate); N=10 fresh processes for the
  import-cost scenario. Report **p50 and p95**; p50 gates, p95 is recorded.
- **Process-startup exclusion:** in-process scenarios time `performance.now()` around the
  operation only. CLI wall-clock scenarios also measure a bare `node -e ""` baseline (same
  N/warm-up) and report raw + net (raw − baseline p50); §6 budgets apply to **net**.
  Import budget: fresh process, `performance.now()` around dynamic `import()` of the built
  entry — startup excluded by construction.
- **Timed window:** synthetic corpus/fixture generation is excluded from every window.
- **Gate policy (per §6):** the gate fails on (a) proven target excess — p50 over the §6
  target across a full N-run session, confirmed by one repeat session; or (b) baseline
  regression — p50 worse than the recorded baseline by >20 % across two consecutive full
  sessions. A single noisy run never gates. Baselines live in the repo next to the bench
  script and change only with an explanatory commit.

### C4. Legacy gate hardened + committed regression suite (audit item 4)

Fixes to `scripts/check-legacy.mjs`: (1) `package.json` content is no longer skipped after
the name check — `exports` keys/values are checked (`exports-path` rule) and the whole
manifest text runs through the generic rules; (2) `capability`/`capabilities` object keys
are caught **quoted or unquoted** (`capability-key` rule — schemas will live as TS consts);
(3) the `@modkit-legacy-input-fixture` marker is honored only under a `fixtures/` path —
outside it the marker itself is a violation (`marker-outside-fixtures`) and the file is
still scanned; (4) `--root` argument + `fileURLToPath` for testability/robustness.
Committed regression suite: `scripts/test/check-legacy.test.ts` over committed fixture
trees `scripts/test/fixtures/legacy-gate/{violations,clean}` — 9 rule classes asserted
positive, marker-abuse asserted still-scanned, clean tree asserted scanned-and-green,
`fixtures/legacy/` + marked-fixture exclusions asserted, real repo asserted green. The
suite runs in `pnpm test` (vitest) and `pnpm check`.

### C5. Toolchain installed and pinned (audit item 6)

`pnpm install` executed; `pnpm-lock.yaml` committed; justifications in `PORTED.md`
(typescript 5.9.3, vitest 2.1.9, eslint 9.39.5 + typescript-eslint 8.67.0, prettier 3.9.6,
@types/node 22.20.1 — dev-only). esbuild's postinstall stays denied
(`pnpm-workspace.yaml#allowBuilds`), its platform binary package suffices. Non-empty
verification chain green: `pnpm typecheck` (tooling tsconfig over gate tests + vitest
config), `pnpm lint`, `pnpm test` (5 real tests), `pnpm check:legacy`. The root `tsc -b`
returns to the `typecheck` script when X3-S0.2 adds the first composite package (empty
solution is TS18002).

### C6. Accounting corrections (audit items 3/5)

- Board: X3-S0.0 `assignee` removed (allowed only on an active `plan[]` step); corrective
  pass added as a plan step; X3-S0.1 renamed to its true remainder («toolchain install/pin
  - non-empty verification»), executed in this pass.
- The previous `modkitx` commit `68183cb7` swept the planning session's uncommitted edits
  of the same two files, including register rows (R3/R5, `0/45`) unrelated to X3 —
  acknowledged as procedural overreach; the content is factually correct (re-measured), so
  it is retained rather than reverted, and this note plus the session report record it.

---

## X3-S0.0 — Contract baseline / Definition of Ready (2026-08-13)

Verified against live files of `modkitx@643abefc` (branch `r1-convergence`, working tree of
2026-08-13; note: `engine-board.js`/`MASTER_TASK_REGISTER.md` X3 entries existed uncommitted).
Re-measured snapshot: 45 × legacy `extensions/*/*/extension.json`, 0 × `package.json#modkit`,
0 × `modkit.extension.json`, 32 workspace packages — matches BRIEF-12 §0 direction.

Abbreviations: **canon** = `docs/architecture/MODKIT_ARCHITECTURE.md`; **AC** =
`docs/architecture/ASSET_CAPABILITIES.md`; **23/24/25/27/02/15/30** = `docs/MK3/<n>-*.md`;
**R6/R9** = `docs/tasks-active/platform-architecture/REPORT_{6,9}_*.md`.

### 1. Owner matrix — public types of slices S0–S4

Ownership classes: **canon** (adopted canonical), **AC v1** (normative v1 wire contract),
**MK3 owner** (detailed/normative-candidate owner document), **lab detail** (shape delegated
to the lab within an owner's boundary; promotion needs the owner's gate), **deferred** (not
in S0–S4).

> **Amendment 2026-08-13 (post-audit).** Row 23 promised the full `PermissionGrant` with
> scopes and the `parent ∩ callee ∩ policy ∩ operation` intersection for S3, while the
> first implementation shipped only a permission-class list — the audit was right to call
> that a contract gap. It is now closed (scopes, `narrowGrant`, `assertNotWider`, plus the
> `trusted-in-process` full-authority diagnostic), so the row reads true again. Recorded
> here instead of being silently edited, because the promise/delivery mismatch is itself
> the finding.

> **Amendment 2026-08-14 (owner REVISE / CONTINUE).** Rows 18 and 29 remain accurate history for
> S0–S4, but their forward disposition changed. BRIEF-13A is the accepted basis for the read-only
> descriptor/session/data-source and codec-v2 work in A-1…A-8. No row below claims that the
> documentation compile fixtures are runtime implementation.

| #   | Public type (X3 slice)                                                                                                                                                                  | Owner class                                      | Exact source                                                                                                                                                                                                           | Notes                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ExtensionManifest` (normalized envelope) — S0                                                                                                                                          | canon (boundary) + MK3 owner (shape)             | canon §5.13 («tooling normalizes either container into one `ExtensionManifest` contract»); 27 §0.2–0.3; MK3/README decision 64                                                                                         | Executable schema is the S0 proof (R9 §19 item 3)                                                                                 |
| 2   | Authored containers `package.json#modkit` / `modkit.extension.json`, one-container rule                                                                                                 | canon                                            | canon §5.8 (discovery/identity paragraph) + §5.13; adopted 2026-08-12                                                                                                                                                  | Both at once = packaging error                                                                                                    |
| 3   | `contributionManifests` discovery pattern + glob rules                                                                                                                                  | canon (pattern) + MK3 owner (glob rules)         | canon §5.13; 27 §0.3, §5.1                                                                                                                                                                                             | Hosts never glob category dirs                                                                                                    |
| 4   | `ContributionManifestV1` envelope — S0                                                                                                                                                  | MK3 owner (candidate v2)                         | 27 §6, corrected by 27 §0.5 (no per-contribution version; `status` optional display hint; security authored only in child manifests)                                                                                   | Promotion map: candidate until S3c/D1; X3 is its proof vehicle                                                                    |
| 5   | `RuntimeVariantDeclaration` (variantId, entrypoint, target, executionProfile, requestedPermissionClasses)                                                                               | MK3 owner                                        | 24 §3 (27 §6 explicitly imports it; no second runtime-variant form)                                                                                                                                                    |                                                                                                                                   |
| 6   | `ScopedContractRequirement` + `required/default/suggested/integrates` semantics                                                                                                         | MK3 owner                                        | 23 §8 (27 §6 explicitly defers)                                                                                                                                                                                        |                                                                                                                                   |
| 7   | Logical ID grammar (contract/provider/extension/error qualified form; version as separate field)                                                                                        | MK3 owner                                        | 23 §3 (ABNF + role table), §3.1 (contribution id is qualified, never inherited from extension)                                                                                                                         |                                                                                                                                   |
| 8   | `core` primitives: stable IDs, `ModkitError`-style structured errors, diagnostics, deterministic ordering, cancellation, lifecycle/disposal — S0                                        | canon (ownership) + lab detail (exact API)       | canon §6.1 (`core` row), §14.7–9; rationale MK3/12 (consolidation map: «12 → core errors канона»); parity oracle `packages/core/src/errors.ts` (`ModkitError`)                                                         | Every blocking async/provider/I/O API takes `AbortSignal`, returns structured diagnostics (BRIEF-12 §3.4)                         |
| 9   | `ErrorDefinition` (namespaced error codes)                                                                                                                                              | MK3 owner                                        | 24 §11; error-code grammar 23 §3                                                                                                                                                                                       |                                                                                                                                   |
| 10  | `DiagnosticSeverity`, `RedactionPolicy`, `SchemaRef`                                                                                                                                    | MK3 owner                                        | 24 §3.1                                                                                                                                                                                                                |                                                                                                                                   |
| 11  | Contract-selected `spec` mechanism (unknown contract = inspectable, not activatable) — S0/S1                                                                                            | canon (behaviour) + MK3 owner (envelope rule)    | canon Done-criterion (BRIEF-12 §1.2); 27 §0.3, §6 rules; R6 §8 pipeline                                                                                                                                                | Concrete lab test-contract spec schemas = lab detail                                                                              |
| 12  | Host inventory (explicit list, in-memory, deterministic order) — S1                                                                                                                     | canon (ownership) + lab detail (entry shape)     | canon §6.1 (`host` row: inventory/resolution modules); R6 §8; oracle `generated/codec-catalog/codec-catalog.json`                                                                                                      | No root `generated/` authority (27 §0.6)                                                                                          |
| 13  | `SubjectRef` / `SubjectIdentity` / `SourceRef` / `RevisionRef`, canonical URI serialization — S2                                                                                        | MK3 owner (normative-candidate)                  | 25 §3                                                                                                                                                                                                                  | Equality rules 25 §3; revision never in identity                                                                                  |
| 14  | Unknown source-root subject + `InterpretationRef` — S2                                                                                                                                  | MK3 owner (candidate, PR-16)                     | 25 §20; 30 §5                                                                                                                                                                                                          | Format never enters root identity                                                                                                 |
| 15  | Portable `vfs` source/stream/random-access contracts — S2                                                                                                                               | canon (promoted §5.9) + lab detail               | canon §5.9; divergence register row «Владение VFS implementations» (resolved 2026-08-12); oracle `packages/vfs`                                                                                                        | Node file adapter lives in `host/node`, not browser-safe `vfs` (BRIEF-12 §5 S2)                                                   |
| 16  | Trait vocabulary / `TraitId` values                                                                                                                                                     | AC v1                                            | AC §4 (+§13 manifest surface); TypeScript names today are `CapabilityInstance`/`CAPABILITY_IDS` (`packages/assets/src/capabilities.ts`, verified live)                                                                 | X3 S0–S4 treats `TraitId` as an opaque validated dotted string (23 §3 role table); no copy of the ID list, no rename (see gap G1) |
| 17  | Operation vocabulary (three namespaces, `ASSET_OPERATION_IDS`)                                                                                                                          | AC v1                                            | AC §5.1–5.3; live `packages/assets/src/operations.ts`                                                                                                                                                                  | Used by X3 only as opaque operation strings inside resolver requests                                                              |
| 18  | `AssetDescriptor` (full descriptor contract)                                                                                                                                            | AC v1; deferred in S0–S4, scheduled by BRIEF-13A | AC §2; BRIEF-12 §3.5 excludes it from S0–S4; BRIEF-13A A-1…A-3 owns the read-only v2 projection and sessions                                                                                                           | Accepted basis only; implementation has not landed                                                                                |
| 19  | `ProviderOffer` / `ProviderRequest` / `ContractRequirement` / `ContractOffer` / `OfferHeader` / `ResolvedProvider` / `RejectedCandidate` / `ResolutionResult` / `UnresolvedReason` — S3 | MK3 owner (normative-candidate)                  | 23 §8 («единственное определение … Остальные документы обязаны ссылаться сюда»)                                                                                                                                        | Resolver v1 executes only `primary` + compatible `replacement`; other kinds → explicit unsupported-kind diagnostic                |
| 20  | Resolution algorithm v1 (staged, deterministic, UTF-8 byte ordering, `ambiguous` instead of discovery order) — S3                                                                       | MK3 owner                                        | 23 §9; acceptance §17                                                                                                                                                                                                  |                                                                                                                                   |
| 21  | `RuntimeTarget` / `RuntimeTargetConstraint`                                                                                                                                             | AC-era v1 wire fact + MK3 owner (aliasing rule)  | 23 §8: normative alias of live `CodecRuntimeTarget` / constraint fields of `CodecRuntimeVariant` (`packages/assets/src/codec-manifest.ts`, verified live: environments/OS/arch/hostCapabilities/webApis/externalTools) | Port with PORTED.md provenance at S3; JSON names kept v1                                                                          |
| 22  | Permission classes taxonomy — S3                                                                                                                                                        | MK3 owner (normative-candidate)                  | 24 §3: canonical taxonomy `read-source, write-source, filesystem-read, filesystem-write, network, process-launch, native-code, credentials, clipboard, persistent-storage`                                             | One authored dictionary; live legacy vocabularies get mapping, not a second authority (gap G4)                                    |
| 23  | `PermissionGrant` + `GrantedPathScope` / `GrantedNetworkScope` / `CredentialGrantRef`; nested-grant intersection; deny-by-default — S3                                                  | MK3 owner                                        | 24 §4, §3.1, §15 invariants                                                                                                                                                                                            | Grant precedes entry-point import (X3-S3.3 spy proof)                                                                             |
| 24  | Execution profiles + SB ladder scope for the lab                                                                                                                                        | MK3 owner (adopted ladder)                       | 24 §3 (profile union), §5, §6.1 (SB-0 обязательна до массовой миграции)                                                                                                                                                | X3 S3 implements the SB-0 dispatch/grant slice only                                                                               |
| 25  | Provider-policy lock: `ProviderLockKey` / `ProviderPolicySelection` / `ProviderPolicyLockEntry`, `resolverVersion` staleness — S3                                                       | MK3 owner                                        | 23 §11                                                                                                                                                                                                                 | This is BRIEF-12's «resolution lock»; install/session/World locks are different records (deferred, 28/23 §12–13)                  |
| 26  | `testkit` minimal host / conformance harness — S4                                                                                                                                       | canon (ownership, dev-only closure) + lab detail | canon §6.1 closure classes; MK3/10 (gates rationale); R6 §11 S4 (PR-23 shape)                                                                                                                                          |                                                                                                                                   |
| 27  | External example-extension layout — S4                                                                                                                                                  | canon + MK3 owner                                | canon §5.13 tree; 27 §0.2–0.3                                                                                                                                                                                          | Lives outside the workspace; installs packed tarballs                                                                             |
| 28  | Lab package naming `@modkitx-x3/*`, no publish                                                                                                                                          | BRIEF owner rule                                 | BRIEF-12 §7/§7.1                                                                                                                                                                                                       | `@modkitx/*` names belong to `modkitx` R5                                                                                         |
| 29  | Codec v2 `spec`, read-only session/data-source/viewer ABI and contribution offers                                                                                                       | BRIEF-13A accepted basis — A-1…A-8               | BRIEF-13A §§5–16; BRIEF-13C                                                                                                                                                                                            | Compile fixtures exist; production runtime has not landed                                                                         |
| 30  | `FormatDefinition`, install/composition locks beyond the read-only slice, World types, UVE packer, key material, signatures/quarantine                                                  | **deferred**                                     | 30 §2; 28 §7; 23 §12–13; 26; R9 §19; 24 §12.1; 24 §6.1 SB-2+                                                                                                                                                           | Not authorized by REVISE / CONTINUE; S4b remains a separate candidate                                                             |

### 2. Minimal fields (fixed for S0 schemas)

**2.1 Normalized `ExtensionManifest` (one contract for both authored containers):**

```
schemaVersion         1 (literal)
publisher             qualified namespace, ABNF `dotted` (23 §3), e.g. `org.example`
id                    `name` grammar (23 §3); unique within publisher only
version               SemVer 2.0.0 string — npm container: inherited from package.json#version;
                      standalone container: own field (see gap G5)
license               SPDX string — same inheritance rule (27 §7: license of the whole unit)
contributionManifests readonly string[] — relative patterns; ≤1 shallow `*` segment; no `**`,
                      no absolute paths, no `..`, no symlink escape (27 §5.1)
```

Normalization also reports (as diagnostics/metadata, not envelope fields): source container
kind, and the packaging error when both containers are present. ~~Extension-level
dependencies deferred past S4~~ — **superseded by corrective pass G9/Q75**: canon §5.13
requires the manifest to carry them, the exact field shape awaits the owner's Q75 answer,
and X3-S0.3 is blocked until then. Declared-inventory diffing (canon §5.13) remains
deferred past S4.

**2.2 `ContributionManifestV1` envelope (open, transport for every contribution kind):**

```
schemaVersion    1 (literal)
contract         { id: ContractId (qualified, 23 §3), major: number }
id               qualified contribution coordinate (23 §3.1); independent from the owning
                 extension coordinate, never inherited
displayName      string
status?          optional display hint 'supported'|'partial'|'unsupported'|'experimental'
                 (27 §0.5.2 wins over the §6 interface listing it required — gap G2)
runtimeVariants? readonly RuntimeVariantDeclaration[] (24 §3; static definitions may omit)
dependsOn?       readonly ScopedContractRequirement[] (23 §8)
limitations?     readonly string[]
spec             contract-selected payload (2.3)
```

No per-contribution `version` (27 §0.5.1): locks reference
`(extension coordinate, contribution id, contract major)`.

**2.3 Contract-selected `spec`:** the registry maps `(contract.id, contract.major)` → one
strict JSON Schema for `spec`. Known contract → strict validation (fail = structured
diagnostics, no activation). Unknown contract → envelope itself still validates, `spec` is
preserved as inspectable data, a structured `unknown-contract` diagnostic is emitted, and the
contribution is **never activatable** (27 §6 rules; R6 §8). S0 ships lab test-contract spec
schemas only; real codec-v2 spec stays deferred (owner matrix #29).

**2.4 Permission request / grant (S3 minimum, SB-0 scope):**

- Request: authored **only** in `runtimeVariants[].requestedPermissionClasses`
  (24 §3; single authored security owner per 27 §0.5.3), values from the canonical taxonomy
  (owner matrix #22). Missing permission = deny; no `requiresHostApproval` field.
- Grant (24 §4): `{ id, subjectScope?, sourceScope?, filesystem?: GrantedPathScope[],
network?: GrantedNetworkScope[], credentials?: CredentialGrantRef[], expiresAt?,
parentGrant? }`; nested call authority = parent grant ∩ callee request ∩ host policy ∩
  operation scope; child never wider than parent. Gate order: resolution → grant → only then
  entry-point import/execution (24 §8; X3-S3.3 spy proof).

**2.5 Resolution lock (portable provider-policy lock, 23 §11):**

```
ProviderLockKey        { contract, major, normalizedRange ('*' default after canonical
                         normalization), operation?, requiredOutputs: TraitId[] (unique,
                         UTF-8-byte-sorted), preferredOutputs: same, workload? }
ProviderPolicySelection{ extension (publisher-qualified coordinate), releaseRange? ('*'),
                         contributionId, contractMajor }
ProviderPolicyLockEntry{ key, primary, allowedFallbacks?, resolverVersion }
```

Excluded by design: OS/architecture, runtime variant, exact artifact/digest, external tool
paths, facilities, grants, credentials/secrets, catalog URLs (those belong to install lock /
machine activation snapshot / session records — deferred). Serialization is canonical and
byte-stable: sorted keys, UTF-8 byte ordering for ID lists, LF, independent of discovery /
registration / shuffle order (23 §9.9, §16.5, §17).

### 3. Schema/type source-of-truth workflow (decision §5.3)

**Chosen: authored strict JSON Schema objects are the single wire authority; everything else
is mechanically derived or compile-time-pinned to them.**

1. Each published schema (`ExtensionManifest`, both authored-container adapters,
   `ContributionManifestV1`, lock, …) is authored **once** as a TypeScript `as const` object
   in `@modkitx-x3/sdk` source (`packages/sdk/src/schemas/…`), dialect JSON Schema 2020-12
   (lab decision, see L2), strict (`additionalProperties: false`, required lists explicit).
2. The published `.json` schema artifacts are **emitted** from those consts by one tiny
   deterministic script (stable key order, LF, trailing newline) with a `--check` CI mode —
   a serialization step, not a codegen framework.
3. Public TypeScript types are hand-authored for API ergonomics but **pinned** to their
   schema by a compile-time structural-equality drift gate:
   `type _Check = Expect<Equal<ExtensionManifest, FromSchema<typeof extensionManifestSchema>>>`
   (dev-only `json-schema-to-ts`; the assertion lives in a type-test file). Any divergence
   fails `tsc`/vitest — the drift-test S0 acceptance names.
4. Runtime validation (CLI `modkit validate`, host loading) compiles **the same consts** with
   Ajv (2020-12 dialect) — planned single external dependency of `sdk`, to be justified in
   PORTED.md when S0 code lands; hand-writing a JSON Schema validator would itself be a
   second drifting authority. If the validate-budget (<150 ms, BRIEF-12 §6) fails, switch to
   ajv standalone-compiled validators generated from the same consts — authority unchanged.

**Why this creates no second authority:** the schema const is the only place a wire shape is
stated. The `.json` artifact is a checked projection; the TS type is compile-time-proven
equal (not sampled by fixtures); the runtime validator executes the same object. The one
allowed authority mechanic (BRIEF-12 §7: «generator ИЛИ drift-check») is the drift-check of
step 3; step 2 is packaging, not generation of a second form.

**Rejected:** TS-first + schema generator (`ts-json-schema-generator`) — published wire form
becomes hostage to generator version churn; zod/valibot as source — runtime dependency in
public API and unstable emitted schemas; hand-written schema + hand-written types with only
fixture-based drift tests — sampling, not proof.

### 4. Contract gap register (§5.4)

No **blocking** gaps found; every entry below has an owner-sanctioned resolution the lab can
proceed under, and none required a lab-side architectural override.

| #   | Gap                                                                                                                                                                                                                                           | Blocking?        | Resolution / status                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Capability→Trait rename not promoted: AC v1 normatively keeps `CapabilityInstance`/`CAPABILITY_IDS` (verified live in `packages/assets`); MK3/02 §1 bans `capability` from the new wire vocabulary; divergence register holds the rename open | **No** for S0–S4 | X3 needs no trait vocabulary: descriptor contract is out of scope (§3.5), resolver uses `TraitId` as an opaque validated dotted string (23 §3). X3 introduces **neither** `Capability*` names **nor** `Trait*` wire types, and copies no ID list — no second wire dictionary. If a slice turns out to need the descriptor/trait contract → stop + owner gap here, per BRIEF-12 §3.5                                                                                  |
| G2  | 27 §6 `ContributionManifestV1` interface lists `status` as required; adopted 27 §0.5.2 demotes whole-unit `status` to an optional display hint                                                                                                | No               | Resolved by the owner document's own precedence rule (27 §0 header: «при конфликте выигрывает этот раздел») → optional. Textual fix of §6 suggested to owner in the session report; not a lab decision                                                                                                                                                                                                                                                               |
| G3  | 27 §6 comments contribution `id` as «contract-specific grammar», 23 §3/§3.1 requires the qualified form for contribution/provider ids                                                                                                         | No               | 23 owns identity grammar (MK3/README ownership map) → qualified `publisher/name` form; 23 §3.1 explicitly: «Новый contribution manifest хранит собственный qualified id»                                                                                                                                                                                                                                                                                             |
| G4  | Three diverging live permission vocabularies (`CODEC_PERMISSION_CLASSES` — 9 classes, no `credentials`; `ASSET_PERMISSIONS`; VFS `SourceProviderPermission`), verified live                                                                   | No               | 24 §3 already prescribes the single canonical 10-class taxonomy for v1 and demands explicit mapping for legacy vocabularies; X3 authors exactly that taxonomy. Legacy mapping tables are needed only when legacy fixtures are converted (provenance via PORTED.md)                                                                                                                                                                                                   |
| G5  | Standalone `modkit.extension.json` and `version`/`license`: 27 §0.2 says they are «inherited from npm fields», which a non-npm layout does not have                                                                                           | No               | Interpretation fixed (supported by 27 §7 which shows `ExtensionManifest#license` fed by either container): the standalone container carries `version`/`license` as its own required fields; the npm container must NOT duplicate them (single source per artifact). Negative fixtures: standalone without them = error; `#modkit` block duplicating them = error. Flagged for owner confirmation in the session report; adapter-level reading, not a contract change |
| G6  | Canonical control-schema dialect not fixed (23 §18.1 open)                                                                                                                                                                                    | No               | Lab decision L2: JSON Schema 2020-12 for lab schemas; recorded here, promotion of the dialect belongs to owner 23. No published `$id`s until owner adopt (nothing is published at all, §7.1)                                                                                                                                                                                                                                                                         |
| G7  | BRIEF-12 §1 Done-criteria name packages `@modkitx/core`… while §7/§7.1 forbid occupying `@modkitx/*`                                                                                                                                          | No               | §7/§7.1 is the explicit later-dated rule: lab packages are `@modkitx-x3/*`; only local `pnpm pack` tarballs, no publish. Risk standing order: if the owner starts R5 creation of `@modkitx/sdk`/`host` while X3 flies, the parallelism risk goes into the session/final report                                                                                                                                                                                       |
| G8  | v1 `codec.manifest.json#runtimeVariants` (entrypoints map, capabilities verbs) differs from 24 §3 `RuntimeVariantDeclaration` (single `entrypoint`, `requestedPermissionClasses`)                                                             | No               | Not a conflict: v2 envelope deliberately uses 24 §3's shape; v1 manifests remain **legacy input fixtures** only (marked, excluded from the legacy gate), normalized during fixture conversion with PORTED.md provenance                                                                                                                                                                                                                                              |

### 5. Lab-local decisions recorded (inside delegated boundaries)

- **L1**: Lab package names `@modkitx-x3/{core,sdk,vfs,host,testkit}` + leaf
  `apps/modkit-cli` (binary `modkit`, private). Nothing is ever published (§7.1).
- **L2**: JSON Schema dialect 2020-12 (see G6).
- **L3**: `TraitId`/operation IDs are opaque grammar-validated strings in X3; no ID
  catalogs are copied from `modkitx` (see G1).
- **L4**: Permission classes = canonical 10-class list from 24 §3 (see G4).
- **L5**: Planned runtime validator: Ajv (2020-12) as the single external `sdk` dependency —
  justification lands in PORTED.md together with the first S0 code; `core` stays at
  «LogTape only» (canon §6.1) and even that is added only when diagnostics need it.
- **L6**: Canonical JSON serialization for emitted schemas/locks: UTF-8, LF, sorted object
  keys where order is not semantic, arrays of IDs unique + UTF-8-byte-sorted (23 §9.9).
- **L7** (hardened by corrective pass C4): Legacy gate = `scripts/check-legacy.mjs`
  (zero-dependency): scans `packages/**/src`, `apps/**/src`, `packages/**/schemas`, package
  names, `exports` maps and full manifest text; excludes `**/fixtures/legacy/**` paths, and
  honors the `@modkit-legacy-input-fixture` marker only under a `fixtures/` directory
  (elsewhere the marker is itself a violation). Committed regression suite:
  `scripts/test/check-legacy.test.ts`. Category-as-path is NOT grep-detectable and is
  enforced by S1 loader tests + review instead — recorded here so the gate's blind spot is
  explicit.
- **L8** (superseded by corrective pass C3): the protocol is fixed in S0.0 — see C3 above;
  X3-S0.5 only implements the bench script against it.

### 6. What X3-S0.0 did NOT do (explicit; amended by the corrective pass)

- No package sources, no `core` types, no schemas yet — first type lands in X3-S0.2+.
- ~~No `pnpm install` / lockfile~~ — done in corrective pass C5 (2026-08-13).
- No writes to `modkitx` beyond BRIEF-12 §8 scope (board/register; corrective pass added
  the Q75–Q77 proposals to `MK3/11-open-questions.md`, also §8-allowed).
- ~~No entry in `MK3/11-open-questions.md`~~ — superseded: the audit surfaced G9 as a real
  blocking gap; Q75–Q77 filed in the corrective pass.
