# SC2 MK3 Completion — первая реализация, 2026-09-22

Основание: [план завершения и blueprint игровых расширений](BLIZZARD_SC2_MK3_COMPLETION_AND_GAME_EXTENSION_BLUEPRINT_2026-09-21.md).

Это отчёт о выполненной части плана. Полный parity с MK2, все source workflows и удаление
остаточного legacy пока не завершены. Работа выполнялась в незакоммиченных деревьях двух
репозиториев параллельно с другими задачами; их изменения не откатывались.

## Реализовано

1. **Map получил постоянного владельца реализации.** 48 файлов binary/XML readers/writers,
   изображений и navigation перенесены в `starcraft2/modules/map/shared/{format,image,navigation}`.
   Старые пути содержат compatibility reexports, а не вторые реализации. Публичные consumers,
   сборка portable bundle и тесты используют нового владельца. Provenance и исключения записаны
   в `starcraft2/modules/map/MK3-MIGRATION.json`.
2. **Map использует единственную Wizard-модель.** Embedded `.BlizWiz` обрабатывается каноническим
   Wizard parser для `<wizardfile>`; неверная историческая грамматика `<DataWizard>` исключена
   из нового Map API. Она остаётся только в старом compatibility API до его удаления.
3. **SC2Arcade больше не принадлежит MK2 game implementation.** `Sc2ArcadeClient`, metadata,
   depot URL и dependency types принадлежат `modules/game/battlenet/content-sources/sc2arcade.ts`.
   Dependency resolver импортирует этот контракт. Старый адаптер сохраняет `openDependency()`
   для compatibility consumers. Это не live-приёмка Battle.net publish/delete.
4. **Введена проверка остаточного legacy.** AST scanner проверяет imports/reexports/type queries,
   dynamic imports и CommonJS в зарегистрированных production `modules/` и `shared/`. Новые
   legacy-импорты запрещены; точный разрешённый остаток закреплён в
   `architecture/mk3-legacy-imports.json`. Удалённые записи также надо удалять из baseline.
   Вычисляемые imports требуют точного review с хешем исходного файла.
5. **Исправлена module-map запись image operations.** Владелец — Textures. Contributions,
   module-map и проверки перенесённых библиотек согласованы с новой структурой Map.
6. **Добавлена общая команда Verify в VS Code для текстовых language routes.** Кнопка вызывает
   существующий language diagnostics contract, использует несохранённый буфер, публикует findings
   в Problems, поддерживает отмену и отбрасывает результаты устаревшей версии документа.
   При неполном контексте выдаётся предупреждение. Тексты доступны на русском и английском.
   Codec operations `subject.validate` / `asset.validate` сохранены; объединение Verify с toolbar
   бинарных/custom editors остаётся отдельной задачей.
7. **Host сохраняет честную полноту диагностики.** Частично загруженные зависимости не могут
   дать ложный полный результат, даже если provider не поставил `isIncomplete`. Полностью
   загруженные зависимости только для чтения сами по себе не делают анализ неполным.
8. **Генерация VS Code contributions имеет одного владельца.** Один generator синхронизирует
   generated contributions, package manifest и activation events; build использует его же.
9. **Добавлен изолированный SC2 snapshot для acceptance.** `scripts/stage-sc2-test-extension.mjs`
   создаёт ограниченную копию расширения с SHA256 receipt; test-only override выбирает её для
   native-host тестов. Проверка целостности production artifact не отключалась.
10. **Убран дорогой путь из обычного completion.** Host больше не открывает source/mod/dependency
    graph для уже валидного completion list без `subject-ref`. Полный subject lookup сохраняется
    для ссылочных значений. Фоновая semantic-диагностика VS Code начинается через 2,5 секунды,
    поэтому не конкурирует с первым вводом `<`; явный Verify по-прежнему запускается сразу.

## Проверки

Наборы ниже пересекаются по сценариям; числа не следует складывать в показатель покрытия продукта.

| Проверка                                                                    | Результат                                                   |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Map core / navigation / image                                               | 127 passed                                                  |
| MK3 Map module без native-host suite                                        | 53 passed                                                   |
| Map semantic-world / writer на копии установленной карты                    | 23 passed                                                   |
| PNG export                                                                  | 2 passed                                                    |
| SC2Arcade API, workspace/compatibility, dependency/virtual DocumentInfo     | 44 passed                                                   |
| Mod codec через host на изолированном SC2 snapshot                          | 18 passed                                                   |
| Map native-host edit/reopen/stale-plan/undo-redo на том же snapshot         | 2 passed                                                    |
| Core language session + VS Code contributions                               | 32 passed                                                   |
| Host language-subject-completion, включая semantic completeness и fast path | 31 passed                                                   |
| VS Code localization                                                        | 6 passed                                                    |
| AST boundary scanner tests                                                  | 7 passed                                                    |
| Contributions/module-map, boundary ratchet, ported-library-use              | passed                                                      |
| SC2 Map, SC2 Mod, Battle.net typecheck/build; portable Map bundle           | passed                                                      |
| `tsc -b packages/host apps/vscode`                                          | passed                                                      |
| Финальный VSIX: activation / root `<` / edited completion                   | 3 643 / 598 / 538 ms                                        |
| Verify в установленном VSIX                                                 | Galaxy, Data, Strings, Style, Layout passed                 |
| Полный installed language acceptance                                        | partial: старый Galaxy rename остановлен неполным workspace |

Промежуточные запуски native-host тестов ловили `artifact-digest-mismatch`: другие задачи меняли
файлы расширения между inventory и исполнением. Повторная проверка выполняется на отдельной копии.
Общая сборка `dist-app` также прерывалась из-за исчезнувшего файла в параллельно пересобираемом
выходном дереве. Финальный VSIX собран штатным packer в собственном staging-каталоге:
`artifacts/modkit-sc2-completion-20260922-v3.vsix`, SHA256
`0e8fdcd36403ef774100c71c0cdd8a4dac5fb40ca937cefec8988647bdd852d2`.

Полный receipt сохранён в `reports/vscode-smoke/sc2-completion-20260922-final.json`. Его итоговый
`passed: false` относится к одному прежнему сценарию: Galaxy rename требует полный workspace, а
изолированный `Probe.SC2Mod` получает неразрешённые installation-зависимости Core/Liberty. Даже
физический пустой `DocumentInfo` в fixture не устранил эти implicit dependencies. Защитную проверку
rename не ослабляли: сначала надо установить, неверна ли форма fixture или resolver ошибочно
добавляет defaults. Completion, syntax grammar, специальные trigger characters и Verify прошли до
этого шага и записаны в том же receipt.

## Точный остаток миграции

Последняя проверка scanner: **732 production-файла; 84 записи legacy imports, 91 occurrence,
65 затронутых файлов**. Прямых импортов `src/lib/mk2` в проверенном scope нет. Все оставшиеся
записи относятся к `@modkit/codec-kit/legacy/*`.

Это не проверка транзитивной зависимости через package exports, tsconfig aliases или произвольные
loaders. Историческое `src/` и package publication требуют отдельного аудита. Основной SC2 package
всё ещё публикует legacy sources. Среди всех зарегистрированных Blizzard codec/provider manifests
74 записи: 18 `supported`, 44 `partial`, 12 без явного статуса. Это другой scope, чем исходные
SC2-only 59 manifests; напрямую сравнивать эти числа нельзя.

## Следующие работы

1. Заменить `codec-kit/legacy` публичными постоянными contracts по владельцам, начиная с XML,
   language contracts и asset descriptors. Сокращать baseline в том же изменении.
2. Проверить транзитивную dependency closure, удалить ставшие ненужными entrypoints и исключить
   legacy tree из публикуемого package. Compatibility consumers предварительно перечислить явно.
3. Завершить installed VSIX матрицу: folder, archive, CASC, cache, nested-file auto-open,
   Resources/dependencies, все семь языков. Проверку текста отделять от реального native typing UI.
4. Довести единый Verify до всех поддерживающих validation codecs и custom editors, без второй
   игровой модели в VS Code или UI.
5. Продолжить Data/Strings/Styles/Layout/Galaxy/Wizard parity и единые cross-format references;
   entity cards, editable stats, model/audio previews и graph проверять на реальных subjects.
6. Закрывать `partial` только по доказанным capabilities и roundtrip/fidelity, затем уменьшать
   VS Code entrypoint и чистить публичную поверхность расширения.
7. Game profile generator и следующую игру начинать после стабилизации SC2 source/subject
   contracts; новый runtime abstraction layer без повторного использования не нужен.

## Идентичность входов при интеграции

- Core HEAD: `fe330f425c84f5a04bca86381e615d223dcc591a` + рабочие изменения.
- Blizzard HEAD: `7dbb3afd2aae4d220e1cb441278976565cc2c736` + рабочие изменения.
- SC2 snapshot: `modkit-extensions-blizzard/artifacts/sc2-acceptance/run-6X0aiz/starcraft2`.
- SC2 artifact digest: `sha256:138d4671b66cb3de6956efece67ecafb4009cf7ddde2c5c40a28f9ce8abce545`.
- Native acceptance и фактический `loadExtensionDirectory` подтвердили этот digest:
  `modkit-extensions-blizzard/artifacts/sc2-acceptance/run-6X0aiz/acceptance.json`.
- Snapshot: 5 169 файлов, 141 577 017 байт; полный список file digests — соседний `snapshot.json`.
- `node_modules` в тестовой копии — junction на зависимости исходного workspace. Snapshot фиксирует
  сам SC2 artifact, не независимую полную dependency closure. Это тестовый вход, не portable release.
