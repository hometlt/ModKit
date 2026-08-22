# ModKit — руководство разработчика

Этот документ объясняет, как устроен ModKit и как собирать на нём приложения — от веб-компонента
на один вьювер до расширяемой IDE. Все примеры — рабочие: пути импортов, поля манифестов и имена
функций взяты из настоящего кода, и большинство примеров дословно повторяют то, что делают
собственные приложения репозитория.

**Главный принцип.** ModKit — это набор независимых строительных блоков, а не монолитный
фреймворк, который целиком встраивается в каждое приложение. Каждый конечный продукт содержит
только то, что ему нужно. Это правило не пожелание: его охраняет тест
`scripts/test/minimal-build.test.ts`, который собирает минимальные конфигурации и падает, если в
бандл приехало лишнее.

---

## 1. Архитектура в одной картинке

```
ModKit
│
├── core            @modkitx-x3/core       — идентификаторы, диагностика, канонический JSON
├── sdk             @modkitx-x3/sdk        — контракты: дескрипторы, источники данных,
│                                            манифесты, редактирование (13D), ABI вьюверов
├── vfs             @modkitx-x3/vfs        — виртуальная файловая система
├── host            @modkitx-x3/host       — хост: инвентарь, открытие субъектов, безопасность,
│   │                                        исполнение, RPC, редактирование
│   ├── /node                              — Node-адаптер (+ фасад createModkit)
│   ├── /browser                           — браузерный адаптер (worker-исполнение)
│   └── /execution                         — RPC-протокол и транспорты
├── ui              @modkitx-x3/ui         — вьюверы и компоненты интерфейса (все — субпутями)
│
├── extensions/…    расширения             — динамический каталог + собственный /linked export
│
└── Приложения (примеры-эталоны)
    ├── apps/web            PWA + <modkit-viewer> (веб-компонент)
    ├── apps/electron       десктоп
    ├── apps/modkit-vscode  расширение VS Code
    ├── apps/modkit-cli     CLI
    ├── apps/server         сервер (RPC поверх сокета)
    └── apps/automation-host headless-автоматизация
```

Зависимости направлены сверху вниз: `core → sdk → host → приложения`; `ui` зависит только от
`sdk`. Платформенные пакеты (`core`, `sdk`, `vfs`, `host`) **не знают ни одного формата** — это
охраняется тестом (`scripts/test/reference-codecs-packed.test.ts`): даже пример
`org.modkitx/image-png` в doc-комментарии host-пакета валит гейт.

### Цепочка «файл → codec → viewer → extension»

```
файл (байты + имя)
  │  открытие: subjects.open / modkit.open(path)
  ▼
детекция ─ инвентарь сопоставляет match-правила манифестов (расширение, сигнатура байтов)
  │        и запускает probe кандидатов
  ▼
codec ──── контрибушен расширения; исполняется в worker (или in-process — см. §4);
  │        parse → возвращает дескриптор
  ▼
descriptor ─ identity (formatId…), traits, operations, dataSources:
  │          { 'common.view/raster-image-source': …, 'common.view/tree-data-source': … }
  ▼
viewer ──── приложение объявляет сцены (stage policy): «контракт источника → модуль вьювера»;
             previewer (createCodecPreview) выбирает применимые сцены по dataSources/traits
             дескриптора и монтирует активную.
```

Расширение (extension) — это единица поставки: каталог (или статический модуль) с
`package.json` + манифестами контрибушенов + кодом. Один extension может нести несколько кодеков,
писателей, вьюверов, тем.

---

## 2. Два способа подключения: «модуль» и «динамическое расширение»

Это центральное различие ModKit, и оно закреплено в API.

### 2.1 Статическое подключение — `import` (модуль)

Компонент известен на этапе сборки. Подходит небольшим и специализированным приложениям.

```ts
import { images } from 'modkit-extension-x3-images/linked' // кодеки PNG/JPEG как модуль
import { imageViewer } from '@modkitx-x3/ui/image' // один вьювер, ничего лишнего
```

Свойства статической полосы:

- код расширения попадает в бандл приложения и исполняется **in-process**;
- **импорт и есть решение о доверии**: вы слинковали этот код в свой процесс так же, как свой
  собственный. Хост всё равно объявляет `x3.host/full-process-authority` при каждой активации —
  это граница аудита, а не песочница;
- линкуются только контрибушены, которые сами декларируют вариант `trusted-in-process`;
  worker-only (например, писатель-энкодер PNG) честно исключаются с причиной —
  `images.excluded` перечисляет их;
- никакого Extension Host, менеджера расширений, загрузчика — ничего из этого в бандл не попадает.

### 2.2 Динамическое подключение — `extensions` (расширение)

Расширение — это **артефакт**: файлы на диске или по HTTP. Нужно приложениям, которым требуется
настоящая расширяемость (пользователь добавляет свои папки).

```
Application
    ↓
Host (инвентарь + гейт безопасности)
    ↓
Extension (каталог: package.json + contributions/*.json + src/)
    ├── codecs
    ├── viewers (contribution kind: stage / panel / toolbar)
    ├── writers (common.edit/writer@1)
    └── themes и другие данные
```

Свойства динамической полосы:

- каждый файл артефакта **проверяется по дайджесту** до исполнения (verify-then-snapshot);
- код исполняется **только в worker** (`worker-brokered`); в браузере in-process исполнения
  пользовательских расширений нет вовсе;
- сломанная папка становится **записью об ошибке**, а не исключением: остальные расширения
  продолжают работать (`loadExtensionRoots` → `{ inputs, failures, coordinates }`).

**Не заставляйте каждое приложение использовать Extension Host.** Если набор функций фиксирован —
подключайте модулями. Обе полосы совместимы: `createModkit({ modules: […], extensions: […] })`
строит один инвентарь из обеих.

---

## 3. Уровни использования: минимальные конфигурации

### 3.1 Веб-компонент «просмотр изображений» (и ничего лишнего)

Строительные блоки: `core` (транзитивно) + кодеки изображений + два вьювера.

```ts
// пример «своего элемента» поверх блоков ModKit; готовый <modkit-viewer>
// из apps/web/src/embed.ts — более полный образец с shared-host и Shadow DOM
import { imageViewer } from '@modkitx-x3/ui/image'
import { metadataPanel } from '@modkitx-x3/ui/metadata'
```

В бандл при этом **не попадают** Text/Code/HEX-вьюверы, дерево файлов, панели, редакторы,
Monaco, Extension Manager — это проверяется гейтом минимальной сборки.

Готовый вариант: подключите `embed.js` из сборки `apps/web` и используйте элемент:

```html
<script type="module" src="…/embed.js"></script>
<modkit-viewer src="./assets/diagram.svg"></modkit-viewer>
<modkit-viewer src="./data/table.csv" view="table"></modkit-viewer>
```

Контракт встраивания (CSP, origin, Shadow DOM) описан в шапке `apps/web/src/embed.ts` — он
**измерен** тестами, а не предположен.

`src` и свойство `file` намеренно доступны только для просмотра: URL/Blob не дают компоненту
права что-либо перезаписывать. Минимальное редактирование включается только явной передачей
страницей writable File System Access handle:

```js
const [handle] = await window.showOpenFilePicker()
const viewer = document.querySelector('modkit-viewer')
viewer.fileHandle = handle
viewer.view = 'text-editor'
```

После этого `text-editor` и `hex-editor` сохраняют в тот же файл через проверку revision и запрос
`readwrite`-разрешения из жеста Save. Компонент отражает несохранённое состояние атрибутом
`data-mk-dirty` и сообщает результат событием `modkit-viewer-edit-status`. Без переданного handle
редакторы не предлагаются.

Если embed должен принимать каталог расширений по URL, origin разрешает **сборка**, а не страница:

```sh
MODKIT_EMBED_EXTENSION_ORIGINS=https://extensions.example \
  pnpm --filter @modkitx-x3/web-app app:build
```

После этого страница может выбрать каталог только с этого точного origin (схема, host и port):

```html
<modkit-viewer
  src="./assets/diagram.svg"
  extension-catalog="https://extensions.example/modkit/catalog.json"
></modkit-viewer>
```

Список origin'ов запекается в `embed.js`; атрибут или глобальная переменная страницы расширить его
не могут. Каталог структурно проверяется, каждый файл расширения затем проверяется по объявленному
SHA-256, а код удалённого каталога получает только worker-realm. Пустой список означает fail
closed: произвольные URL не загружаются.

Локализация chrome не хранится в DOM и не является process-global. Подпуть
`@modkitx-x3/ui/localization` экспортирует типизированный набор ключей, полные каталоги `en`/`ru`,
BCP-47 negotiation и immutable localizer на один host:

```ts
import { createUiLocalizer, resolveUiLocale } from '@modkitx-x3/ui/localization'

const locale = resolveUiLocale(navigator.languages)
const t = createUiLocalizer(locale).text
button.textContent = t('action.openFile')
```

PWA выбирает язык параметром `?lang=ru` (или `navigator.languages` без параметра), отражает его в
`html.lang` и даёт переключатель в панели Host. Сейчас русский каталог покрывает app-owned chrome;
строки универсальных viewer/editor-модулей остаются английскими до их перевода на тот же механизм.
Для русского chrome подключены self-hosted Cyrillic subsets как `Modkit Cyrillic UI`: Saira не
содержит кириллицу, поэтому случайного системного fallback нет.

### 3.2 Headless-конвертер / Node-библиотека

Блоки: `core + sdk + host` + нужные кодеки. Ни вьюверов, ни UI (гейт проверяет: в бандле нет
`data-mk-part`).

```ts
import { join } from 'node:path'
import { createModkit } from '@modkitx-x3/host/node'
import { images } from 'modkit-extension-x3-images/linked' // статически…

const modkit = await createModkit({
  modules: [images], // …или динамически: extensions: ['./codecs']
  roots: [projectDir], // откуда можно открывать (пустой список не открывает ничего)
  writableRoots: [assetsDir], // где можно сохранять; не указали — хост честно read-only
})

const opened = await modkit.open(join(assetsDir, 'logo.png'))
if (opened.snapshot.state === 'opened') {
  const lease = await opened.session.dataSource('common.view/raster-image-source', 1)
  // … lease.value: info()/readRegion()…
  await lease.release?.()
}
await opened.close()
await modkit.close() // подметёт забытые сессии
```

Политика фасада фиксирована: чтение ограничено `roots`, запись — `writableRoots` самим бекендом
(грант не может обещать больше файловой политики), расширения из `extensions`/`userExtensions`
исполняются только в worker.

#### 3.2.1 Установка библиотеки без npm-публикации

Пакеты ModKit пока не опубликованы в npm. Устанавливайте один и тот же зафиксированный снимок
репозитория одним из двух способов. В обоих случаях нужны Node.js 22+, четыре платформенных пакета
(`core`, `sdk`, `vfs`, `host`) и только выбранные расширения. Для расширения изображений также нужен
его маленький runtime-пакет `codec-kit`.

**Из Git.** pnpm умеет брать пакет из подкаталога Git-монорепозитория через параметр `path:`.
Зафиксируйте один commit SHA для всех записей; не смешивайте ветки и коммиты. Так как внутренние
пакеты ещё не лежат в registry, перечислите всю платформенную четвёрку прямо в `dependencies`:

```json
{
  "dependencies": {
    "@modkitx-x3/core": "github:<owner>/<repo>#<sha>&path:/packages/core",
    "@modkitx-x3/sdk": "github:<owner>/<repo>#<sha>&path:/packages/sdk",
    "@modkitx-x3/vfs": "github:<owner>/<repo>#<sha>&path:/packages/vfs",
    "@modkitx-x3/host": "github:<owner>/<repo>#<sha>&path:/packages/host",
    "@modkitx-x3/codec-kit": "github:<owner>/<repo>#<sha>&path:/extensions/codec-kit/codec-kit",
    "modkit-extension-x3-images": "github:<owner>/<repo>#<sha>&path:/extensions/common/images"
  }
}
```

`<owner>/<repo>` здесь намеренно заполнитель: у checkout нет канонического remote, его выбирает
владелец развёртывания. После подстановки выполните `pnpm install` и закоммитьте lockfile: именно SHA
в нём делает сборку повторяемой.

**Через tarball — рекомендуемый и проверяемый путь.** В checkout сначала соберите пакеты, затем
упакуйте платформу, поддержку кодека и нужное расширение в один каталог артефактов:

```bash
pnpm install --frozen-lockfile
pnpm build
mkdir artifacts
pnpm -C packages/core pack --pack-destination ../../artifacts
pnpm -C packages/sdk pack --pack-destination ../../artifacts
pnpm -C packages/vfs pack --pack-destination ../../artifacts
pnpm -C packages/host pack --pack-destination ../../artifacts
pnpm -C extensions/codec-kit/codec-kit pack --pack-destination ../../../artifacts
pnpm -C extensions/common/images pack --pack-destination ../../../artifacts
```

Передайте полученные `.tgz` потребителю (`pnpm add /path/to/artifacts/*.tgz`; в PowerShell пути
перечисляются явно). Затем найдите установленный каталог расширения и передайте его фасаду:

```js
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createModkit } from '@modkitx-x3/host/node'

const projectDir = dirname(fileURLToPath(import.meta.url))
const imagesDir = dirname(
  fileURLToPath(import.meta.resolve('modkit-extension-x3-images/package.json')),
)
const modkit = await createModkit({ extensions: [imagesDir], roots: [projectDir] })
const opened = await modkit.open(join(projectDir, 'logo.png'))
if (opened.snapshot.state === 'opened' && opened.session !== undefined) {
  const descriptor = await opened.session.descriptor()
  console.log(descriptor.dataSources.map(item => item.contract))
}
await opened.close()
await modkit.close()
```

`scripts/test/library-install-packed.test.ts` повторяет этот рецепт вне workspace: делает tarball,
ставит их в чистый временный проект, запускает `createModkit`, открывает настоящий PNG и проверяет
дескриптор. Публикации в registry и ссылок на исходники в этом доказательстве нет.

### 3.3 Расширение VS Code

Блоки: `core + sdk + host` (Node-адаптер) + кодеки + логика расширения. **Без Monaco** — редактор
уже даёт VS Code (наш бандл расширения его не содержит — проверено аудитом). Webview — потребитель
через RPC, хоста не держит. Эталон: `apps/modkit-vscode` (транспорт — `framePortFromJsonPort`,
опция `framePort` у `exposeSubjectRpc`/`connectSubjectRpc`).

Эталон регистрирует полноценный `CustomEditorProvider`: изменение webview переводит документ в
native dirty-state, Ctrl+S вызывает сохранение смонтированного редактора, Revert перечитывает
диск, Backup сначала фиксирует изолированный webview-буфер и сохраняет его точные байты. Поэтому
кнопка Save внутри редактора должна посылать запрос VS Code, а не самостоятельно обходить
документную модель.

### 3.4 Полноценное Electron-приложение

Блоки: host (Node) в main + ui-workbench в renderer + сцены по потребности + Monaco (это
единственное приложение, где он уместен) + Extension Host — **только если нужна динамическая
установка**. Эталон: `apps/electron` (subject-RPC между main и renderer; у renderer нет ни
грантов, ни путей — только ids).

---

## 4. Как открыть файл: обязательное и опциональное

Обязательный минимум, чтобы «файл открылся»:

| Что             | Зачем                                                     |
| --------------- | --------------------------------------------------------- |
| host-композиция | инвентарь + гейт + исполнение (`createModkit` делает всё) |
| ≥1 кодек        | иначе любой файл — `unresolved` (это ответ, не ошибка)    |
| источник        | байты файла или namespace-корень через VFS                |

Всё остальное опционально:

| Опция              | Включается                                       |
| ------------------ | ------------------------------------------------ |
| просмотр           | вьювер-субпуть + `createCodecPreview` со сценами |
| редактирование     | `writableRoots` (фасад) / editing-бекенд + арм   |
| писатель формата   | сам резолвится по фасету; иначе честный raw      |
| дерево файлов      | `@modkitx-x3/ui/explorer`                        |
| workbench-оболочка | `@modkitx-x3/ui/workbench`                       |
| настройки          | `@modkitx-x3/ui/settings`                        |
| Extension Host     | только для динамической установки расширений     |

### 4.1 Каталог как субъект: VFS → Host

Корень `@modkitx-x3/vfs` содержит только нейтральные контракты, registry и монтирование. Провайдер
подключается отдельным импортом и регистрируется явно: импорт ядра сам по себе не тянет Node API,
HTTP, Git или любой другой транспорт.

```ts
import { artifactNamespaceSourceFromVfsMount, openSubject } from '@modkitx-x3/host'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'

const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
const mount = await vfs.openMount(new URL('file:///C:/project/').href, {
  limits: {
    maxEntries: 10_000,
    maxFileBytes: 8n * 1024n * 1024n * 1024n * 1024n,
    maxReadBytes: 512n * 1024n * 1024n,
    maxReadRangeBytes: 16 * 1024 * 1024,
    maxStreamBytes: 512n * 1024n * 1024n,
    maxPathBytes: 4096,
  },
})
vfs.mount('', mount)

const source = artifactNamespaceSourceFromVfsMount(mount)
const opened = await openSubject({
  inventory,
  source,
  intent: 'full',
  target,
  grant,
  budget,
})

// После закрытия сессии владелец VFS освобождает mount и открытые byte-source.
await vfs.dispose()
```

Namespace-кодек объявляет в `probe.markers` точные относительные пути маркеров. Во время probe Host
запрещает `list()`, `..`, незаявленные пути и неограниченные потоки; лимиты `maxEntries`,
`maxBytes`, `maxDepth`, `maxPathBytes` дают именованные отказы. Полный обход namespace возможен
только после выбора кодека и всё равно остаётся внутри границ провайдера.

Remote single-file source подключается через `@modkitx-x3/vfs/providers/http`: выберите `http` или
`https`, передайте допустимые origins и `fetch`/network broker. Provider требует честные HEAD
`content-length` + `accept-ranges: bytes`, принимает только точные `206` и применяет те же
mount-wide read budgets. Выбранный пользователем браузерный файл подключается через
`@modkitx-x3/vfs/providers/browser-file`: сначала `provider.register('browser-file:…', handle)`,
затем обычный `openMount`. Этот provider не открывает picker и не получает ambient-доступ к
файловой системе — authority целиком содержится в переданном handle.

### 4.2 Собственный VFS-протокол

Внешнее приложение может реализовать публичный `VfsProvider` для API сайта или собственного
хранилища. Провайдер владеет протоколом и обязан вернуть ограниченный `VfsMount`; ядро не ищет и не
подхватывает реализации автоматически.

```ts
import {
  VirtualFileSystem,
  type VfsMount,
  type VfsProvider,
  type VfsProviderContext,
} from '@modkitx-x3/vfs'

class SiteApiProvider implements VfsProvider {
  readonly id = 'com.example.vfs.site-api'
  readonly scheme = 'site-api'

  async open(uri: string, context: VfsProviderContext): Promise<VfsMount> {
    // Здесь приложение проверяет authority/tenant и передаёт context.limits/context.signal
    // своему API-клиенту. stat/list/open обязаны соблюдать эти же границы и confinement.
    return createSiteApiMount(uri, context)
  }
}

const vfs = new VirtualFileSystem()
vfs.registerProvider(new SiteApiProvider())
const mount = await vfs.openMount('site-api://tenant/project')
```

`VfsMount.open()` возвращает portable `RandomAccessSource`; `stat()`/`list()` возвращают только
`file | directory`. Ошибки границ должны иметь стабильный `ModkitError.code`, чтобы Host и UI могли
отличить отсутствующий объект от превышения бюджета или попытки выйти из корня.

---

## 5. Как подключать вьюверы

Каждый вьювер — отдельный субпуть `@modkitx-x3/ui/<имя>`: `image`, `vector`, `model`, `audio`,
`video`, `table`, `tree`, `text-virtual`, `hex`, `hex-editor`, `editor` (текстовый редактор),
`metadata`, `namespace` (архивы), `transport`, `panels`, `graph`, `card`; оболочки — `explorer`,
`workbench`, `settings`, `shell`; базовые части — `viewer`, `parts` через корень.

Сцены объявляет **приложение** (это его политика, как и в `apps/web/src/views.ts`):

```ts
import { createCodecPreview } from '@modkitx-x3/ui/explorer'
import { imageViewer } from '@modkitx-x3/ui/image'
import { hexViewer } from '@modkitx-x3/ui/hex'

const preview = createCodecPreview({
  stages: [
    {
      id: 'image',
      label: 'Image',
      contract: 'common.view/raster-image-source',
      module: imageViewer,
    },
    { id: 'hex', label: 'Hex', contract: 'common.view/byte-range-source', module: hexViewer },
  ],
  openSession: async (entry, bytes) => {
    /* открыть субъект через ваш хост и вернуть { descriptor, dataSource, operations?, dispose } */
  },
})
```

Применимость сцены previewer решает сам — по `dataSources`/`traits` дескриптора. Редакторские
сцены (`editable: true`) требуют `editorPorts`; верните из него `undefined` для конкретного
файла — и редакторы честно исчезнут только у него.

Стили: один файл `@modkitx-x3/ui/styles/modkit-ui.css`. Он пригоден и для Shadow DOM как есть
(каждый блок токенов селектится `:root, :host`).

---

## 6. Как подключать кодеки

**Статически** — собственным `linked` export каждого нужного расширения:

```ts
import { images } from 'modkit-extension-x3-images/linked'
import { vector } from 'modkit-extension-x3-vector/linked'
createModkit({ modules: [images, vector] })
```

**Динамически** — каталогами:

```ts
createModkit({ extensions: ['./node_modules/@my/codecs'], userExtensions: [userDir] })
```

**Отключение кодека** — на уровне инвентаря, а не фильтром в UI:

```ts
createModkit({ disabledContributions: ['org.example/some-codec'] })
```

Запись остаётся в инвентаре (иначе выключатель не показать и не включить обратно), активация
запрещена хостом, диагностика `x3.host/contribution-disabled`.

---

## 7. Как создать своё расширение

Минимальный каталог:

```
my-extension/
├── package.json
├── contributions/
│   └── codec-acme.json
└── src/
    └── acme-codec.js
```

`package.json` — блок `modkit` и есть идентичность:

```json
{
  "name": "my-extension",
  "type": "module",
  "modkit": {
    "schemaVersion": 1,
    "publisher": "org.example",
    "id": "acme",
    "contributionManifests": ["./contributions/*.json"]
  }
}
```

### 7.1 Манифест кодека и регистрация типов файлов

Типы файлов регистрируются **декларативно** — блоком `match` манифеста (расширения имён,
media-types и/или байтовые сигнатуры; детекция по байтам работает даже при лживом имени файла):

```json
{
  "schemaVersion": 1,
  "contract": { "id": "org.modkitx/codec-contribution", "major": 1 },
  "id": "org.example/codec-acme",
  "displayName": "ACME files",
  "runtimeVariants": [
    {
      "variantId": "portable",
      "entrypoint": "./src/acme-codec.js",
      "target": { "environments": ["browser-worker", "node-worker"] },
      "executionProfile": "worker-brokered",
      "requestedPermissionClasses": ["read-source"]
    },
    {
      "variantId": "trusted-node",
      "entrypoint": "./src/acme-codec.js",
      "target": { "environments": ["node"] },
      "executionProfile": "trusted-in-process",
      "requestedPermissionClasses": ["read-source"]
    }
  ],
  "spec": {
    "formatRefs": [{ "formatId": "acme", "label": "ACME" }],
    "roles": ["media"],
    "sourceTopology": "single",
    "artifactStages": ["authored"],
    "openIntents": ["probe", "inspect", "full"],
    "match": {
      "extensions": ["acme"],
      "signatures": [{ "from": "start", "offset": 0, "bytesHex": "41434d45" }]
    },
    "probe": { "strategy": "signature" },
    "representations": [{ "representationId": "portable", "default": true }],
    "publishesDataSources": [{ "contract": "common.view/tree-data-source", "major": 1 }],
    "operations": [],
    "implementationTier": "reference",
    "budgets": { "probeBytes": 64, "openBytes": 1048576 }
  }
}
```

Полная схема — `packages/sdk/schemas/`; десятки живых примеров — `extensions/common/*/contributions/`.
Совет: объявляйте **оба** варианта исполнения (`portable` + `trusted-node`) с одним entrypoint —
тогда расширение работает и в динамической полосе (worker), и в статической (import).

### 7.2 Модуль кодека

```js
// src/acme-codec.js — исполняется в worker; чистый ESM без DOM
export const abiVersion = 1
export function createCodec() {
  return {
    async probe({ source }) {
      const head = await source.read(0, 4)
      const ok = head[0] === 0x41 && head[1] === 0x43 && head[2] === 0x4d && head[3] === 0x45
      return { codecId: 'org.example/codec-acme', confidence: ok ? 0.9 : 0 }
    },
    async open({ source }) {
      const bytes = await source.read(0, Number(await source.size()))
      return {
        summary: { format: 'acme' },
        metadata: [{ id: 'acme', label: 'ACME', entries: [{ key: 'bytes', value: bytes.length }] }],
        traits: [{ id: 'content.binary', parameters: {} }],
        dataSources: {
          'common.view/tree-data-source': makeTreeSource(bytes), // контракт из sdk
        },
        operations: {}, // + handlers для edit.* (см. ADR-HOST-002)
      }
    },
  }
}
```

Контракты источников данных (что обязан уметь `tree-data-source`, `raster-image-source` и т.д.) —
`packages/sdk/src/asset-capabilities/`. Утилиты — `@modkitx-x3/codec-kit` (включая `defineWriter`
для писателей `common.edit/writer@1`).

### 7.3 Свой вьювер как контрибушен

Вьювер расширения — контрибушен `kind: "stage"` (или `panel`/`toolbar`) + модуль,
экспортирующий `ViewerModule` (см. `defineViewerModule` в `@modkitx-x3/ui/viewer` и примеры
`packages/ui/contributions/`). Приложение включает его в свою stage-политику так же, как
первопартийные.

### 7.4 Проверка

```bash
node -e "import('@modkitx-x3/host/node').then(async ({loadExtensionRoots}) => {
  const r = await loadExtensionRoots([{root:'./my-extension'}], {origin:'installed'})
  console.log(r.coordinates, r.failures)
})"
```

Папка без манифестов — это `x3.host/extension-not-an-extension`, а не тихий успех.

---

## 8. Редактирование (13D) — в двух абзацах

Сохранение всегда идёт через координатор: `propose → plan → prepare → commit`, с ревизией
источника, снятой **до** чтения байтов (файл, изменившийся под вкладкой, — это `conflict`, а не
перезапись). Есть два пути: **Path B** — писатель формата (`common.edit/writer@1`), резолвится по
фасету (`resolveFormatWriter`; фасад делает это сам и честно откатывается на raw-писатель с
диагностикой по имени); **Path A** — мутирующая операция кодека (`edit.field`, `edit.structure`,
`edit.content`) возвращает `{ kind: 'edit-plan', plan }`, и **хост** коммитит план под
`write-source`. Кодек не пишет никогда.

Через границу (Electron renderer, VS Code webview) ходят только **данные и id**: арм
`x3.app/subject-editing@1`, prepared-id одноразовый, грант не покидает серверную сторону, каждый
план валидируется против своего субъекта (`x3.host/edit-plan-subject-mismatch`).

---

## 9. Алгоритм сборки своего приложения

Перед созданием ответьте по порядку:

1. Какая платформа? (web / Electron / VS Code / Node-headless)
2. Какие типы файлов поддерживаются? → какие **кодеки** нужны.
3. Какие операции с ними нужны? (просмотр / правка / конвертация)
4. Какие **вьюверы** нужны? (только соответствующие контрактам ваших кодеков)
5. Нужен ли редактор? (текст/hex → editing-бекенд + арм)
6. Нужна ли работа с файловой системой? (roots/writableRoots; в браузере — FSA)
7. Нужно ли дерево файлов? (`ui/explorer`)
8. Нужна ли система extensions? (только если пользователь добавляет свои)
9. Нужна ли динамическая загрузка модулей? (нет → только `modules:`)
10. Нужен ли Monaco? (почти всегда — нет; в VS Code — никогда)
11. Нужен ли UI вообще? (нет → host/node и всё)
12. Соберите список импортов из ответов — и **ничего сверх него**.

Затем сверьтесь с гейтом: соберите бандл и проверьте маркерами из
`scripts/test/minimal-build.test.ts`, что лишнее не приехало.

---

## 10. Куда смотреть дальше

- `docs/TARGET_STATE_RU.md` — целевое состояние: структура, итоговый функционал и чего не будет.
- `PLAN_FABLE_NEXT_2026-08-20.md` — текущее состояние и честные ограничения.
- `IMPLEMENTATION_NOTES.md` — решения и найденные дефекты, новейшие сверху.
- `docs/GUIDE_AI_AGENT_RU.md` — предписывающая версия этого документа для ИИ-агента.
- `docs/MK3/adr/` — архитектурные решения (редактирование — ADR-HOST-002).
