# Отчёт Sol — блок 3: VFS и namespace-вход

Дата: 2026-08-21

Ветка: `spec/mk3-extension-reference`

Задание: `PLAN_SOL_BLOCK3_2026-08-21.md`

## Результат

Завершены этапы 4.2, 1 и 2 в предписанном порядке:

- `extensions/_shared` переименован в `extensions/codec-kit`; имя пакета
  `@modkitx-x3/codec-kit` не изменилось;
- `@modkitx-x3/vfs` получил минимальное provider-neutral ядро и отдельные провайдеры
  `providers/file` и `providers/memory`;
- каталог теперь проходит настоящий product path
  `file VFS → ArtifactNamespaceSource → Host → codec-kit → AssetSession`;
- namespace-probe ограничен точными маркерами и именованными бюджетами; перечисление каталога,
  незаявленные пути, `..` и неограниченные потоки во время probe запрещены;
- публичный SPI кастомного VFS-протокола описан и проверен тестом.

Согласно §4 плана работа остановлена после этапа 2. Платформенная часть оказалась крупнее
ожидаемого: она затронула VFS, SDK ABI и schema authority, Host ingress/descriptor/fallback,
execution ABI, codec-kit и продуктовую приёмку. CASC, удаление linked-генератора, дробление
расширений и аудит MK2 в этот коммит не включены.

## 1. Переименование codec-kit

Каталог перенесён:

```text
extensions/_shared/codec-kit
→ extensions/codec-kit/codec-kit
```

Обновлены workspace, lockfile, web build/test imports, packed-тесты, legacy gate и живые документы.
`scripts/check-app-imports.mjs` уже запрещал приложениям импортировать bare
`@modkitx-x3/codec-kit`, поэтому его правило менять не потребовалось. Исторические планы и отчёты
не переписывались.

## 2. Что вошло в VFS-ядро

Ядро содержит ровно общую механику, необходимую всем протоколам:

- нормализованный относительный путь с отказом на NUL и `..`;
- узел `file | directory`;
- публичный `VfsProvider` и явный `VfsProviderRegistry` без auto-discovery;
- `VfsMount` с `stat`, `list`, `open`, `dispose`;
- `VirtualFileSystem` с явным mount/unmount и longest-prefix resolution;
- общие границы `maxEntries`, `maxBytes`, `maxPathBytes` и cancellation;
- существующий portable `RandomAccessSource` как byte leaf.

В ядро намеренно не вошли file/HTTP/Git/CASC/archive semantics, рекурсивный crawler, кэш,
watcher или автоматический поиск провайдеров. Следующий протокол добавляется отдельным субпутём,
когда у него появляется продуктовая потребность.

`package.json` объявляет `sideEffects: false` и три независимых export entry:

- `@modkitx-x3/vfs`;
- `@modkitx-x3/vfs/providers/file`;
- `@modkitx-x3/vfs/providers/memory`.

## 3. Провайдеры

### File (Node)

`providers/file` открывает только `file:` URI. Корень канонизируется через `realpath`; каждый
дочерний путь повторно проверяется после symlink resolution. Выход из корня, превышение числа
записей/байт/длины пути, изменение snapshot, short read и обращение после dispose имеют стабильные
`ModkitError.code`.

### Memory (portable)

`providers/memory` получает копии записей при создании, строит неявные каталоги и применяет те же
границы. Он не регистрируется автоматически и не попадает в file-provider bundle.

### Кастомный протокол

Тест регистрирует внешний `site-api:` provider через публичный `VfsProvider`, открывает его и
монтирует рядом с memory provider. Пример и обязанности автора провайдера добавлены в
`docs/GUIDE_DEVELOPER_RU.md`.

## 4. Minimal-build gate

`scripts/test/minimal-build.test.ts` собирает реальные мини-потребители esbuild и ищет уникальные
runtime-строки, а не имена типов.

| Потребитель                                  | Размер JS | Запрещённые маркеры                                     |
| -------------------------------------------- | --------: | ------------------------------------------------------- |
| `@modkitx-x3/vfs/providers/file`             |  18 277 B | memory=false, git=false, http=false, browser-file=false |
| portable root `@modkitx-x3/vfs`              |  11 640 B | file=false, memory=false                                |
| production dist entry `vfs/providers/file`   |  13 889 B | отдельный entry; порог теста 80 000 B                   |
| production dist entry `vfs/providers/memory` |  12 346 B | отдельный entry                                         |
| production dist entry `vfs`                  |   9 328 B | provider-neutral                                        |

Git, HTTP и browser-file ещё не реализованы; гейт всё равно резервирует их уникальные маркеры,
чтобы будущий провайдер не мог незаметно приехать в file bundle.

## 5. Namespace-вход

### SDK и schema authority

`OpenSubjectOptions.source` теперь принимает `ArtifactSource`. `NamespaceAssetInput` получил
явный `root: AssetSourceRef`: namespace-корень не маскируется фиктивным byte binding. Поле добавлено
в execution ABI surface.

`NamespaceProbePlan` теперь обязан объявить:

- `markers` — непустой список точных путей;
- `maxEntries`;
- `maxBytes`;
- `maxDepth`;
- `maxPathBytes`.

JSON Schema, authoring projection, precompiled CSP-safe validator и generated schema artifact
перегенерированы вместе. Конвертер MK2 выдаёт безопасный marker-only default, а CASC-манифест —
только `.build.info`, `Data/config`, `Data/data`. Это обновление формы манифеста, не порт CASC.

### Host

Host теперь:

- отбирает namespace contribution по совпадению topology/probe, не по файловому расширению;
- не читает byte-signature windows у namespace source;
- выдаёт probe-кодеку namespace, в котором разрешены только объявленные markers;
- запрещает `list()`, вложенный обход directory marker, незаявленный путь и unbounded stream;
- считает открытые entries и прочитанные bytes;
- резолвит прямой namespace input без внешнего companion resolver;
- возвращает валидный unresolved namespace descriptor и fallback `{ preferred: 'none' }`;
- проверяет identity/revision выбранной namespace-сессии тем же путём, что и byte-сессию.

Portable bridge `artifactNamespaceSourceFromVfsMount()` адаптирует `VfsMount` к SDK:
directories становятся вложенными `ArtifactNamespaceSource`, files — проверенными
`ArtifactByteSource` через существующий random-access bridge. Владение mount остаётся у VFS, а
file lease освобождает только открытый byte source.

### codec-kit

`createInspectionCodec()` получил отдельное namespace-definition:

- probe открывает только `plan.markers` и передаёт inert marker facts в `detect()`;
- `planInput()` возвращает `originKind: namespace`;
- `open()` получает `AssetNamespace`, собирает namespace origin и создаёт обычную AssetSession;
- `export.raw` не объявляется: у каталога нет единой честной последовательности raw bytes;
- старый byte single/bundle путь сохранён и прошёл весь прежний корпус.

## 6. Продуктовая приёмка и отказы

Тест создаёт настоящий временный каталог с `project.marker` и незаявленным файлом, открывает его
file-provider'ом, мостом Host и тремя codec contributions:

| Кандидат                          | Действие во время probe           | Результат                                      |
| --------------------------------- | --------------------------------- | ---------------------------------------------- |
| `org.example/namespace-project`   | открывает только `project.marker` | выбран, descriptor origin = `namespace`        |
| `org.example/namespace-traversal` | вызывает `list('')`               | `x3.host/namespace-probe-traversal-refused`    |
| `org.example/namespace-overread`  | читает 65 B при `maxBytes: 64`    | `x3.host/namespace-probe-byte-budget-exceeded` |

Попытка открыть `../outside` отдельно отклоняется VFS как `x3.vfs/path-escape-refused`.
Нижележащий provider не получает `list()` и не касается незаявленного файла.

## 7. Почему остановка перед CASC

Этапы 1–2 потребовали новой provider platform, публичного namespace root в ABI, изменения schema
authority и генерации валидаторов, Host security wrapper, VFS→SDK bridge и двухрежимного codec-kit.
Это уже самостоятельная проверяемая граница и соответствует прямому условию остановки в §4 плана.

Не выполнено в этом блоке:

| Следующий этап                        | Статус                                                       |
| ------------------------------------- | ------------------------------------------------------------ |
| CASC на `C:\Apps\StarCraft II`        | Не начат; `casc` остаётся `x3.mk2/port-pending`              |
| `container.extract` из CASC           | Не начат                                                     |
| Удаление `packages/extensions-linked` | Не начато; оценка «15 строк на extension» ещё не проверялась |
| Дробление по `<vendor>-<domain>`      | Не начато                                                    |
| `docs/AUDIT_MK2_PARITY_RU.md`         | Не начат; таблица аудита не создавалась                      |

Реальные игровые установки не изменялись. Существующие SC2/CnC corpus-тесты прошли в общем наборе,
но не являются доказательством CASC и таким доказательством здесь не объявляются.

## 8. Проверка

Гейт запускался последовательно, без параллельных команд:

| Фаза                                             | Результат                                           |
| ------------------------------------------------ | --------------------------------------------------- |
| `pnpm build`                                     | Пройдено; собрано 48 bundle entries                 |
| `pnpm lint && pnpm format:check`                 | Пройдено после форматирования изменённых файлов     |
| `pnpm exec tsc -p tsconfig.tooling.json`         | Пройдено                                            |
| Focused Vitest                                   | 9 файлов, 92 теста — пройдено                       |
| `pnpm test`                                      | 133 файла, 1 115 тестов — пройдено                  |
| `pnpm bench:universal:gate`                      | Пройдено                                            |
| schemas/manifests/tokens/themes/icons/facilities | Все проверки пройдены                               |
| `pnpm apps:check`                                | 23 extension-set/realm cases — пройдено             |
| legacy/import/extension inventory                | 885 / 264 файлов / 58 extension directories — чисто |
| `pnpm check:mk2`                                 | 482 generated files clean; 19 hand ports сохранены  |
| `pnpm ports:check`                               | 181 total / 19 ported / 162 pending                 |
| `pnpm bundle:check`                              | 48 entries byte-identical                           |

`apps/*/dist-app/**` и `scripts/bundle-hashes.json` не входят в изменение. Существующий
неотслеживаемый `NexusForgeUI/` не затрагивался.
