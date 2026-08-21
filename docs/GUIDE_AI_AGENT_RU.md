# ModKit — инструкция для ИИ-агента

Ты строишь приложение или расширение на ModKit. Этот документ — предписание: что импортировать,
что запрещено, как проверить результат. Понятийная часть — в `docs/GUIDE_DEVELOPER_RU.md`;
здесь — правила и рецепты.

## 0. Главное правило

**Не подключай весь ModKit.** ModKit — набор независимых блоков; каждое приложение получает
только явно выбранные. Нарушение проверяемо: `scripts/test/minimal-build.test.ts` собирает
эталонные минимальные конфигурации и падает, если в бандл приехали неприглашённые поверхности.
Свой результат проверяй тем же способом (см. §7).

Запрещено без явного требования задачи:

- `import … from '@modkitx-x3/ui'` (корневой barrel) — только субпути;
- Monaco где-либо, кроме Electron-приложения с вкладкой Code (в VS Code — никогда: редактор
  уже есть у платформы);
- Extension Host / загрузчик расширений в приложении с фиксированным набором функций;
- вьюверы «на всякий случай» (Text/HEX/Code в просмотрщике изображений);
- дерево файлов/workbench/панели в одиночном веб-компоненте.

## 1. Карта модулей — что для чего

| Импорт                                                                                 | Назначение                                                                    |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `@modkitx-x3/host/node` → `createModkit`                                               | Node-хост одним вызовом: open/editing/расширения                              |
| `@modkitx-x3/host` → `defineLinkedExtension`, `linkedExtensionInputs`                  | статическая полоса расширений                                                 |
| `@modkitx-x3/host` → `exposeSubjectRpc`, `connectSubjectRpc`                           | субъекты через границу (renderer/webview)                                     |
| `@modkitx-x3/host/execution` → `framePortFromJsonPort`                                 | текстовый транспорт (VS Code webview, сокет)                                  |
| `@modkitx-x3/host/browser` (через `apps/web/src/subjects.ts` как образец)              | браузерный хост в worker                                                      |
| `<extension-package>/linked`                                                           | собственный статический entry расширения; импортируй только нужные расширения |
| `@modkitx-x3/ui/<surface>`                                                             | ровно один вьювер/компонент (см. список в GUIDE_DEVELOPER §5)                 |
| `@modkitx-x3/ui/explorer` → `createCodecPreview`, `createExplorer`, `createEditorArea` | сцены, дерево, вкладки                                                        |
| `@modkitx-x3/ui/styles/modkit-ui.css`                                                  | единственный файл стилей; работает и в Shadow DOM (`:root, :host`)            |
| `@modkitx-x3/codec-kit`                                                                | утилиты для КОДА расширений (defineWriter и т.п.) — приложениям запрещён      |

## 2. Алгоритм выбора (выполняй по порядку, записывай ответы)

1. Платформа? → web / electron / vscode / headless.
2. Форматы? → список кодеков: статически (`<extension-package>/linked` в `modules:`) либо
   динамически (`extensions:` каталоги).
3. Операции? просмотр → §3-вьюверы; правка → `writableRoots` (+ формы Edit при мутирующих
   операциях); конвертация → только host.
4. Вьюверы = только контракты, которые публикуют выбранные кодеки. Ничего сверх.
5. Редактор текста/hex нужен? нет → не импортируй `ui/editor`, `ui/hex-editor`.
6. ФС: Node — `roots`/`writableRoots`; браузер — File System Access (образец
   `apps/web/src/files.ts`); нет ФС → байты через `file`-проп/аргумент.
7. Дерево файлов? нет → не импортируй `ui/explorer`-explorer (сам `createCodecPreview` из
   `ui/explorer` допустим — это previewer, дерева не тянет: проверено гейтом).
8. Система extensions для ПОЛЬЗОВАТЕЛЯ? нет → никакого Extension Host; да → Node:
   `userExtensions:`/`loadExtensionRoots`; браузер: образец `apps/web/src/extension-roots.ts`
   (дайджесты считает страница; worker-only; по URL — запрещено, вопрос доверия открыт).
9. Динамическая загрузка вообще нужна? нет → только `modules:`.
10. Monaco? см. §0.
11. UI вообще? нет → host-слой и точка.
12. Итоговый список импортов зафиксируй в шапке entry-файла комментарием «этому приложению
    нужно ровно…» — и не выходи за него.

## 3. Рецепты (проверенные, копируй и адаптируй)

### 3.1 Headless-конвертер (Node)

```ts
import { createModkit } from '@modkitx-x3/host/node'
import { images } from 'modkit-extension-x3-images/linked'

const modkit = await createModkit({ modules: [images], roots: [inDir], writableRoots: [outDir] })
const opened = await modkit.open(file)
// …dataSource / operations().invoke(...) / editing.editorPorts…
await opened.close()
await modkit.close()
```

Проверка чистоты: в бандле нет `data-mk-part` и `monaco-editor`.

### 3.2 Веб-компонент «только изображения»

Готовое: собери `apps/web` и подключай `embed.js` (`<modkit-viewer src=…>`); контракт CSP/origin —
в шапке `apps/web/src/embed.ts`. Своё: `@modkitx-x3/ui/image` + `ui/metadata` + браузерный хост по
образцу `subjects.ts`; Shadow DOM; стили — один css-файл. Ничего из §0-запретов.

### 3.3 VS Code extension

Образец целиком — `apps/modkit-vscode`. Ключевое: extension host = Node-хост
(`createNodeSubjectServices` с `serviceDefinitions: 'bundled'` по умолчанию — не отключай, иначе
CSV/INI/… молча не откроются); webview = потребитель через `connectSubjectRpc({ framePort })` c
`framePortFromJsonPort`; редактирование — арм S14; **CommonJS-entry обязан передать
`bootstrapUrl`** (иначе воркеры не стартуют: `x3.host/worker-bootstrap-unresolved` подскажет);
Monaco не подключать.

### 3.4 Electron

Образец — `apps/electron`: main владеет хостом/грантами/editing-бекендом; renderer получает ids
через subject-RPC (`edit`-арм, prepared-id одноразовые); никакого файлового write-API в renderer.
Мутирующие операции — панель Edit (`edit-operations.ts` — формы по обработчику кодека).

### 3.5 Своё расширение (кодек + типы файлов)

Каталог `package.json(modkit)+contributions/*.json+src/` — полный шаблон в GUIDE_DEVELOPER §7.
Регистрация типов файлов = `spec.match` манифеста (extensions/signatures). Объявляй оба варианта
(`portable` worker + `trusted-node`) с одним entrypoint — расширение будет работать в обеих
полосах. Проверка: `loadExtensionRoots` → coordinates без failures.

### 3.6 Специализированное приложение с урезанными возможностями

`createModkit({ modules: sets.modelsOnly, roots, disabledContributions: […] })` + одна-две сцены.
`disabledContributions` выключает кодек на уровне инвентаря (запись остаётся видимой — иначе
переключатель не включить обратно).

## 4. Границы безопасности — не пересекай

- Динамическое расширение: только worker, только после проверки дайджестов. Не изобретай обход.
- Статическое: `allowTrustedInProcess` не выставляется руками нигде, кроме `defineLinkedExtension`
  (там это и есть смысл) и явного решения композиции про first-party bundled.
- Renderer/webview никогда не получает грант, путь записи или каталоговый доступ — только ids.
- Слово `capability` не может быть ключом объекта/схемы (легаси-гейт).
- Format id не должен попадать в платформенные пакеты даже примером в комментарии.

## 5. Обязательное vs опциональное

Обязательно всегда: host-композиция; ≥1 кодек; источник байтов. Всё остальное — виновно, пока не
доказана нужность: вьюверы, дерево, workbench, настройки, редакторы, Monaco, Extension Host,
динамическая загрузка.

## 6. Куда смотреть при отказах

Отказы ModKit — именованные и являются ответами: `unresolved` (нет кодека), `x3.host/…-refused/-unavailable/-mismatch/-disabled` и т.д. Не глуши их и не оборачивай в «generic error» — показывай причину дословно; коды переживают RPC на объекте ошибки.

## 7. Проверка результата (обязательный шаг)

1. Собери бандл(ы) своего приложения.
2. Прогони маркеры лишних поверхностей (список и способ — `scripts/test/minimal-build.test.ts`;
   маркеры — строки самих поверхностей, НЕ имена частей `data-mk-part`: словарь имён едет всюду).
3. Убедись, что каждый заявленный в §2-списке импорт реально используется, а незаявленных нет.
4. Для UI — живой прогон в реальном Chromium по образцам `apps/web/test/{boot,embed}.test.ts`.
