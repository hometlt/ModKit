# Блок 8 — сверка модельной фазы с UVM

Этот документ закрывает обязательный шаг 0 фазы M7 из
`REVIEW_ROOT_BLOCK8_2026-08-24.md`. Канон прочитан только для чтения на SHA
`1a14ba4eddd0ae88de273348ebd44cfb98a0581d`: `docs/multiverse/model/SPEC_UVM.md` и
`SPEC_UVM_CONVERSION.md`. Экспорт UVM в блок 8 не входит и здесь не заявляется.

## Матрица переносимых семейств

`Да` означает, что формат содержит явные данные, которые будущий importer может перенести без
догадки. `Условно` требует companion или явно маркированной структуры. `Нет` запрещает выводить
семантику только из имени файла или внешних игровых соглашений.

| Семейство UVM | SAGE W3X                                                                                                                                                                               | Westwood W3D                                                                                                                                                                         | Red Alert 2 VXL                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `material`    | **Да:** `FXShader`, texture constants, UV sets и параметры sampler дают PBR-приближение плюс `UV_game_material`; house-colour должен остаться явным параметром, а не угаданным цветом. | **Да:** `VERTEX_MATERIAL`, `SHADER`, `TEXTURE` и material passes прямо соответствуют PBR-приближению, `UV_game_material` и team-colour slot.                                         | **Условно:** palette index каждого voxel даёт простые base-colour materials; точные цвета требуют `.pal`/VPL companion. Текстур и shader-семантики формат не содержит. |
| `socket`      | **Условно:** pivots из `W3DHierarchy` и container bindings могут стать nodes; роли допустимы только по явному имени с provenance `inferred`, а без hierarchy отсутствуют.              | **Да:** hierarchy pivots и aggregates дают nodes; `MUZZLE*`/`FIREPOINT*` → `muzzle`, HLOD aggregates → `attach`, с обязательной пометкой name-based inference.                       | **Нет:** section/HVA transforms описывают limbs, но не attachment-семантику. Имя section само по себе недостаточно для `UV_game_socket`.                               |
| `lod`         | **Нет для доказанного подмножества:** standalone W3X не даёт проверенной ordered LOD chain или thresholds; container membership не переименовывается в LOD.                            | **Да:** `HLOD` задаёт ordered topology для `MSFT_lod`; thresholds, batching и impostor relations остаются в отдельных provisional `MODKITX_*` полях.                                 | **Нет:** VXL/HVA не содержит ordered LOD chain. Отдельные игровые файлы нельзя связывать по догадке.                                                                   |
| `collision`   | **Да:** `W3DCollisionBox` и его bone/container binding дают `UV_game_collision` box; роль должна сохранять исходный тип либо явно оставаться unknown.                                  | **Условно:** `BOX` и collision meshes могут стать shapes, но роль `physics`/`hit`/`selection` разрешена только при исходной маркировке; обычный render mesh не объявляется collider. | **Нет:** извлечённая voxel surface является render geometry. Формат не отличает collision surface, поэтому автоматически публиковать `UV_game_collision` нельзя.       |
| `variants`    | **Нет:** в доказанном W3X-подмножестве нет явной variant/state machine; суффиксы имён не являются контрактом.                                                                          | **Условно:** явно связанные damage-state meshes (`_D1`, `_D2`) могут стать `UV_game_variants`, но только при подтверждённой HLOD/asset связи.                                        | **Нет:** damage/turret variants обычно живут в отдельных assets и игровых данных; один VXL их не связывает.                                                            |
| `animation`   | **Да с companion:** `W3DAnimation` channels + `W3DHierarchy` pivots дают node TRS/visibility tracks; внешние animation siblings разрешаются только host-resolved companion pipeline.   | **Да:** `ANIMATION` и `COMPRESSED_ANIMATION` дают node tracks после bounded decompression; hierarchy обязателен для привязки.                                                        | **Условно:** `.hva` содержит покадровые section matrices и даёт rigid node animation; standalone `.vxl` анимации не содержит.                                          |

## Решения для `model-scene-source` в M7

1. W3X и W3D переводятся из C&C basis `RH, +Z up, +X forward` в UVM/glTF basis преобразованием
   `(x, y, z) → (x, z, -y)`. Это чистое вращение с положительным determinant, поэтому winding и
   порядок индексов не переворачиваются. Нормали проходят то же преобразование и нормализуются.
2. Для VXL используется явное соответствие voxel axes в render contract с `+Y up`; tailer bounds,
   section scale и transforms применяются до вычисления surface. Физический коэффициент в метры
   не угадывается: до UVM-export он должен стать `UV_units` и `UV_provenance.sourceUnits`.
3. Bounds вычисляются по уже преобразованным позициям. Матрицы остаются column-major. Имена mesh,
   section, hierarchy и material сохраняются дословно в стабильных id/metadata, чтобы будущий
   `UV_provenance` мог восстановить исходные ссылки.
4. Каждый primitive хранит собственный `materialId`; разбиение по материалу не склеивается.
   Отсутствующий material получает явно названный fallback, но shader, team colour, collision,
   socket или variant semantics не изобретаются.
5. W3X/W3D texture coordinates приводятся один раз к соглашению нейтрального render contract;
   повторный flip на UVM-export запрещён. Любое source-specific значение, ещё не выраженное
   контрактом, остаётся в tree/metadata и будущем `UV_source_blob`, а не исчезает.
6. M7 публикует только декодированный нейтральный `common.view/model-scene-source`. Ни codec, ни
   renderer не получают зависимость от UVM/glTF writer. Будущий importer сможет механически
   упаковать те же typed arrays в glTF accessors и дополнить их перечисленными `UV_*` семействами.

Эти решения оставляют один путь данных: source decoder → нейтральный typed model contract →
будущий UVM/glTF profile. Второй форматный renderer или параллельное представление геометрии не
создаются.
