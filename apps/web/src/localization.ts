import {
  createUiLocalizer,
  parseUiCatalogDocument,
  resolveUiLocale,
  UI_MESSAGES,
  type UiCatalogDocument,
  type UiLocalizer,
} from '@modkit/ui/localization'
import {
  loadLocalizationCatalogs,
  type Inventory,
  type LoadedLocalizationCatalogs,
} from '@modkit/host'
import { createBrowserExtensionVfs } from '@modkit/extension-manager/browser'
import type { RandomAccessSource, VfsMount, VfsNode, VfsOpenOptions } from '@modkit/vfs'

import {
  isUserExtensionUrl,
  NO_USER_EXTENSION_ROOTS,
  USER_EXTENSION_ARTIFACT_ORIGIN,
  type LoadedUserExtensionRoots,
} from './extension-roots.js'

const EN = parseUiCatalogDocument(
  {
    schema: 'modkit/ui-message-catalog@1',
    locale: 'en',
    namespace: 'modkit/web-app',
    messages: {
      'web.capability.folder':
        'This browser grants folder access: pick a folder to browse it in place.',
      'web.capability.file': 'This browser has no folder picker. It can open one file at a time.',
      'web.capability.input':
        'This browser has no file-system picker. Files open one at a time through the basic file input.',
      'web.editing.notice':
        'Files opened from a granted handle can be saved in place; fetched and dropped files remain read-only.',
      'web.status.noCodec': '{name} — no codec claimed it ({reason}); showing raw bytes.',
      'web.status.noNestedCodec': '{name} — no codec claimed it inside this container ({reason}).',
      'web.status.sharedCommandsUnavailable': '{name} — shared commands unavailable: {reason}',
      'web.status.unsavedClose': '{name} has unsaved changes. Close the tab and discard them?',
      'web.status.bootFailed': 'Boot failed: {reason}',
      'web.sample.png': 'favicon-32.png — PNG image',
      'web.sample.csv': 'sample.csv — delimited table',
      'web.sample.ini': 'sample.ini — INI tree',
      'web.sample.svg': 'sample.svg — vector scene',
      'web.sample.md': 'sample.md — Markdown document',
      'web.sample.mp3': 'sample.mp3 — one second of MP3 silence',
      'web.sample.zip': 'sample.zip — container namespace',
      'web.embed.view': 'View',
      'web.embed.waiting': 'Waiting for a file: set the src attribute or assign the file property.',
      'web.embed.loading': 'Loading {name}…',
      'web.embed.catalog.invalidUrl': 'extension-catalog «{url}» is not a valid URL.',
      'web.embed.catalog.protocol':
        'extension-catalog must use http or https; {protocol} is not admitted.',
      'web.embed.catalog.origin':
        'The extension catalog origin {origin} is not in this embed.js build-time allowlist. The embedding page cannot add an origin; the deployer must rebuild embed.js with it.',
      'web.embed.catalog.schema':
        'extension catalog must be a schemaVersion 1 object with array entries',
      'web.embed.catalog.exclusion':
        'extension catalog exclusions require string name and reason fields',
      'web.embed.catalog.malformed': 'extension catalog contains a malformed extension entry',
      'web.embed.asset.invalidUrl': 'asset-base «{base}» is not a URL this page can resolve.',
      'web.embed.asset.crossOrigin':
        'The modkit assets at {origin} are cross-origin to this page ({pageOrigin}). A module worker script is fetched in same-origin mode, so no CORS header can make that work: serve the modkit assets from this origin (copy or reverse-proxy them) and point asset-base there.',
      'web.embed.stylesFetch': 'modkit-ui.css could not be fetched from {base} ({status})',
      'web.embed.catalogFetch': 'extension catalog {url} could not be fetched: {reason}',
      'web.embed.catalogHttp':
        'extension catalog {url} could not be fetched ({status} {statusText})',
      'web.embed.catalogInvalid': 'extension catalog {url} is invalid: {reason}',
      'web.embed.stageFailed': '«{view}» could not be shown: {reason}',
      'web.embed.fileFetch':
        '{url} could not be fetched ({reason}). A cross-origin file needs CORS headers from its own server and an entry for its origin in this page’s content-security-policy connect-src.',
      'web.embed.fileHttp': '{url} could not be fetched ({status} {statusText})',
      'web.embed.catalogAttributeInvalid':
        'extension-catalog «{url}» is not a URL this page can resolve.',
      'web.embed.tooLarge': '{name} is {size} bytes; this element reads at most {limit}.',
      'web.embed.noStage': '{name} could not be shown: no stage matched what the codecs published.',
      'web.archive.openSubject': 'Open as subject',
      'web.archive.entries': 'Entries',
      'web.archive.pick': 'Pick an entry in the tree to inspect it.',
      'web.archive.openFailed': 'Opening {path} as a subject failed: {reason}',
      'web.archive.noReference': 'no source reference',
      'web.archive.noExtract': 'this subject has no available extract operation',
      'web.archive.sessionGone': 'The session that opened this container is no longer held.',
      'web.archive.unknownEntry': 'The namespace does not list an entry with id {entry}.',
      'web.archive.wrongOutput': 'The operation returned {kind}, not bytes.',
      'web.archive.rejected': 'Rejected: {reason}',
      'web.archive.shown': '{path} · {bytes} bytes · shown as {mode}',
      'web.archive.modeHex': 'hex',
      'web.archive.modeText': 'text',
      'web.archive.readFailed': 'Entry read failed: {reason}',
      'web.view.code': 'Code',
      'web.view.video': 'Video',
      'web.view.image': 'Image',
      'web.view.font': 'Font',
      'web.view.audio': 'Audio',
      'web.view.world': 'World',
      'web.view.playback': 'Player',
      'web.view.model': 'Model',
      'web.view.vector': 'Vector',
      'web.view.archive': 'Entries',
      'web.view.template': 'Template',
      'web.view.card': 'Card',
      'web.view.wiki': 'Wiki',
      'web.view.calculations': 'Calculations',
      'web.view.table': 'Table',
      'web.view.tree': 'Tree',
      'web.view.relations': 'Relations',
      'web.view.text': 'Text',
      'web.view.virtualText': 'Text (streaming)',
      'web.view.metadata': 'Metadata',
      'web.view.hex': 'Hex',
      'web.view.textEditor': 'Text (editor)',
      'web.view.hexEditor': 'Hex (editor)',
      'web.inspector.label': 'Inspector',
      'web.inspector.edit': 'Edit',
      'web.inspector.noFile': 'No file is open.',
      'web.inspector.summary':
        '{label} · {read} non-mutating operation(s) · {forms} edit form(s) over {write} mutating operation(s) · {diagnostics} diagnostic(s)',
      'web.inspector.needInput':
        '{operations}: not in the toolbar — they require input supplied by another stage or panel.',
      'web.inspector.noEdit': '{operations}: no Edit panel — {reason}',
      'web.inspector.noWritableHandle': 'this page holds no writable handle for the file.',
      'web.inspector.noForm': '{operation}: no editing form — {reason}.',
      'web.edit.unsupported': '{operation}: not available in this host yet — {reason}',
      'web.edit.carried': 'this file already carries: {keys}',
      'web.edit.invoking': '{operation}: invoking {handler}…',
      'web.edit.codecRefused': 'The codec refused the operation: {reason}',
      'web.edit.hostRefused': 'The host refused the plan: {reason}',
      'web.edit.appliedReopening': '{outcome}; reopening the file to show the new revision',
      'web.edit.appliedReopenFailed':
        '{outcome}; the tab could not be reopened, so this view is stale',
      'web.edit.noneDrivableCount':
        '{unsupported} of {declared} mutating operation(s) cannot be driven here.',
      'web.edit.formsAvailable': '{forms} form(s) over {declared} mutating operation(s)',
      'web.editability.noHandle':
        '{name} has no writable handle: it arrived through a file input, a drop or a fetch, so this page can show it but can never save it back. Pick it through “Open file…” or a folder to edit it.',
      'web.editability.queryFailed':
        '{name} has a writable handle, but this browser could not report its write permission ({reason}); the first save is where it is decided.',
      'web.editability.noQuery':
        '{name} has a writable handle, but this browser exposes no permission query, so whether the write is allowed is decided by the first save.',
      'web.editability.denied':
        'Write access was denied for {name}, so its text and hex editors are dropped. This build will not offer a save it already knows the browser refuses.',
      'web.editability.granted': '{name} can be saved in place: write access is granted.',
      'web.editability.prompt':
        '{name} can be saved in place once you allow write access; the browser asks on the first save, or use “Enable editing” to answer it now.',
      'web.editability.request.noFile': 'Open a folder or pick a file before enabling editing.',
      'web.editability.request.noHandle':
        '{name} has no writable handle: files opened through a drop, a plain file input or a fetch cannot be written back. Use “Open file…” or a granted folder instead.',
      'web.editability.request.noSurface':
        '{name} cannot be asked for write permission in this browser; a save will try directly and report what the browser answers.',
      'web.editability.request.granted':
        'Write access granted for {name}: the text and hex editors can save.',
      'web.editability.request.denied':
        'Write access denied for {name}; files opened from now on show no editor.',
      'web.editability.request.notGranted':
        'Write access was not granted for {name}; nothing was changed.',
      'web.editability.request.failed': 'Asking for write access to {name} failed: {reason}',
      'web.edit.rejection.staleRevision': 'the file changed on disk after this tab read it',
      'web.edit.rejection.permissionMissing':
        'the grant this subject was opened under does not carry write permission',
      'web.edit.rejection.scopeMismatch': 'the plan names a source outside this subject',
      'web.edit.rejection.guarantee': 'this backend cannot promise the guarantee the plan asks for',
      'web.edit.rejection.fidelity':
        'no evidence proves the writer keeps what the plan claims it keeps',
      'web.edit.rejection.confirmation':
        'a lossy write needs an explicit confirmation this host does not collect',
      'web.edit.rejection.payload': 'the edited bytes exceed what this host will hand over inline',
      'web.edit.rejection.readOnly': 'the backend behind this source is read-only',
      'web.edit.rejection.cancelled': 'the save was cancelled',
      'web.edit.rejection.unknown': 'the plan did not describe this subject at its open revision',
      'web.edit.changeUnsupported':
        'this editor produced a change this host cannot express as a literal replacement',
      'web.edit.writerRefused': 'the writer refused the change',
      'web.edit.planUnsupported': 'this host cannot plan the change set this editor produced',
      'web.edit.commit.writtenReopen':
        '{what} — written to the file this tab opened. Reopen it before editing again: this tab still holds the revision it read.',
      'web.edit.commit.refused': '{what} refused — {reason}{diagnostic}.',
      'web.edit.commit.rolledBack':
        '{what} failed and the file was rolled back to what it held before.',
      'web.edit.commit.partial': '{what} landed only partly; recovery is available in the receipt.',
      'web.edit.commit.conflict':
        'refused — the file changed on disk after this tab read it, so nothing was overwritten. Reopen it and redo the edit.',
      'web.edit.commit.rejected': 'refused before writing — {reason}.',
      'web.edit.action.saved': 'Saved',
      'web.edit.action.undo': 'Undo',
      'web.edit.action.redo': 'Redo',
      'web.edit.authorization.denied': 'not saved — this browser denied write access to the file.',
      'web.edit.authorization.notGranted': 'not saved — write access was not granted ({state}).',
      'web.edit.apply.noAccess': '{name} was not written: this browser did not grant write access',
      'web.edit.apply.conflict': 'refused before writing: {reason} ({conflicts} conflict(s))',
      'web.edit.apply.rejected': 'refused before writing: {reason} ({code})',
      'web.edit.apply.committed': 'applied and written to {name}',
      'web.edit.apply.notApplied': 'not applied: {reason} ({code})',
      'web.edit.apply.rolledBack': 'not applied: the write failed and {name} was rolled back',
      'web.edit.apply.partial': '{name} was only partly written; recovery is in the receipt',
      'web.edit.cannotEdit': '{name} cannot be edited here: {reason}',
      'web.edit.noWriter': '{name} cannot be edited here: no writer backs this subject.',
      'web.edit.bytesLabel': 'Edit bytes',
      'web.error.noPicker': 'This browser has no folder picker.',
      'web.map.choose': 'Choose a map for the World view by entering its ID:\n\n{candidates}',
      'web.map.permissionRequired':
        '{name} — map preview needs installation resources the browser cannot search; the ordinary archive view remains open.',
      'web.map.selectionRequired':
        '{name} — map preview needs a choice ({candidates}); the ordinary archive view remains open.',
      'web.map.diagnostic.selectionRequired':
        'Map preview needs an explicit selection; choose one of the returned map-preview candidates to continue.',
      'web.map.diagnostic.permissionRequired':
        'This map needs installation resources that the browser cannot search for automatically; grant or select them in a desktop host.',
      'web.extensions.subjectsDescription':
        'Cards come from validated extension and contribution JSON; hover a group to see its exact contract.',
      'web.extensions.downloadableDescription':
        'The catalog is checked only when you ask. Installing stores verified package bytes; nothing on this page imports or runs them.',
      'web.extensions.notInCatalog': 'Not in catalog',
      'web.extensions.updateAvailable': 'Update available',
      'web.extensions.trusted': 'Trusted',
      'web.extensions.notTrusted': 'Not trusted',
      'web.extensions.catalogEmpty': 'The catalog contains no extensions.',
      'web.extensions.noDownloaded':
        'No downloaded extensions are installed. Check the catalog to see what is available.',
      'web.extensions.packageDisabled':
        'The extension is enabled directly, but its distribution package is disabled.',
      'web.extensions.reloadPending': 'Reload the page to rebuild the running host.',
      'web.extensions.removedPending':
        'Removed. The extension is gone from the list; reload to rebuild the host.',
      'web.extensions.trustSentence':
        'A folder you add here is trusted because you picked it and for no other reason — nothing is signed and nobody has reviewed it; this page hashes every file as it reads them so that a file changed afterwards is refused instead of run, and user extensions always run in a worker, never on the page.',
      'web.extensions.provenanceNote':
        'Bundled extensions carry digests this app recorded when it was built. Folders you added carry digests this page computed itself just now — a measurement of the bytes it read, not a claim about who wrote them.',
      'web.extensions.remembered': 'Added folders are remembered in {location}.',
      'web.extensions.added': 'Added «{name}»{coordinate}.',
      'web.extensions.actionFailed': 'Extension action failed: {reason}',
      'web.extensions.addFailed': 'Could not add that folder: {reason}',
      'web.extensions.removeFailed': 'Could not remove it: {reason}',
      'web.extensions.accessFailed': 'Could not ask for access: {reason}',
      'web.extensions.accessGranted': 'Access to «{name}» granted again.',
      'web.extensions.accessDenied': 'Access to «{name}» was not granted ({state}).',
      'web.extensions.catalogChecked': 'Extension catalog checked at {location}.',
      'web.extensions.catalogLoaded': 'Catalog loaded from {location}.',
      'web.extensions.catalogNotContacted':
        'Catalog {location} has not been contacted in this session.',
      'web.extensions.installedStatus':
        'Installed {name}. Reload the page to load the changed extension set.',
      'web.extensions.updatedStatus':
        'Updated {name}. Reload the page to load the changed extension set.',
      'web.extensions.removedStatus':
        'Removed {name}. Reload the page to load the changed extension set.',
      'web.extensions.cardFailed': 'Could not open extension card: {reason}',
      'web.extensions.bundledProvenance':
        'Bundled with this build, served from {root}; its digests were recorded when the app was built.',
      'web.extensions.userProvenance':
        'Folder you granted («{label}»); its digests were computed by this page from the bytes it just read.',
    },
  },
  { authorizedMessagePrefixes: ['web.'] },
)

const RU = parseUiCatalogDocument(
  {
    schema: 'modkit/ui-message-catalog@1',
    locale: 'ru',
    namespace: 'modkit/web-app',
    messages: {
      'web.capability.folder':
        'Браузер разрешает доступ к папкам: выберите папку для просмотра на месте.',
      'web.capability.file': 'В браузере нет выбора папки; можно открывать по одному файлу.',
      'web.capability.input':
        'В браузере нет системного выбора файлов; файлы открываются по одному через обычное поле выбора.',
      'web.editing.notice':
        'Файлы из разрешённого источника можно сохранять на месте; загруженные с сервера и перетащенные файлы доступны только для чтения.',
      'web.status.noCodec': '{name} — кодек не найден ({reason}); показаны исходные байты.',
      'web.status.noNestedCodec': '{name} — внутри контейнера кодек не найден ({reason}).',
      'web.status.sharedCommandsUnavailable': '{name} — общие команды недоступны: {reason}',
      'web.status.unsavedClose':
        'В {name} есть несохранённые изменения. Закрыть вкладку и удалить их?',
      'web.status.bootFailed': 'Ошибка запуска: {reason}',
      'web.sample.png': 'favicon-32.png — изображение PNG',
      'web.sample.csv': 'sample.csv — таблица с разделителями',
      'web.sample.ini': 'sample.ini — дерево INI',
      'web.sample.svg': 'sample.svg — векторная сцена',
      'web.sample.md': 'sample.md — документ Markdown',
      'web.sample.mp3': 'sample.mp3 — секунда тишины MP3',
      'web.sample.zip': 'sample.zip — содержимое контейнера',
      'web.embed.view': 'Режим просмотра',
      'web.embed.waiting': 'Ожидание файла: задайте атрибут src или свойство file.',
      'web.embed.loading': 'Загрузка {name}…',
      'web.embed.catalog.invalidUrl': 'extension-catalog «{url}» не является допустимым URL.',
      'web.embed.catalog.protocol':
        'extension-catalog должен использовать http или https; протокол {protocol} не разрешён.',
      'web.embed.catalog.origin':
        'Источник каталога расширений {origin} отсутствует в списке, заданном при сборке embed.js. Встраивающая страница не может добавить источник; необходимо пересобрать embed.js.',
      'web.embed.catalog.schema':
        'каталог расширений должен быть объектом schemaVersion 1 с массивами записей',
      'web.embed.catalog.exclusion':
        'исключения каталога расширений должны содержать строковые поля name и reason',
      'web.embed.catalog.malformed': 'каталог расширений содержит неверную запись расширения',
      'web.embed.asset.invalidUrl':
        'asset-base «{base}» не является URL, который может разрешить эта страница.',
      'web.embed.asset.crossOrigin':
        'Ресурсы Modkit на {origin} находятся вне источника этой страницы ({pageOrigin}). Модульный рабочий процесс загружается только из того же источника, и заголовки CORS это не изменят: опубликуйте ресурсы Modkit из источника страницы и укажите его в asset-base.',
      'web.embed.stylesFetch': 'Не удалось загрузить modkit-ui.css из {base} ({status})',
      'web.embed.catalogFetch': 'Не удалось загрузить каталог расширений {url}: {reason}',
      'web.embed.catalogHttp':
        'Не удалось загрузить каталог расширений {url} ({status} {statusText})',
      'web.embed.catalogInvalid': 'Каталог расширений {url} неверен: {reason}',
      'web.embed.stageFailed': 'Не удалось показать «{view}»: {reason}',
      'web.embed.fileFetch':
        'Не удалось загрузить {url} ({reason}). Для файла из другого источника нужны заголовки CORS на его сервере и разрешение источника в директиве connect-src политики безопасности страницы.',
      'web.embed.fileHttp': 'Не удалось загрузить {url} ({status} {statusText})',
      'web.embed.catalogAttributeInvalid':
        'extension-catalog «{url}» не является URL, который может разрешить эта страница.',
      'web.embed.tooLarge': 'Размер {name} — {size} байт; элемент читает не более {limit} байт.',
      'web.embed.noStage':
        'Не удалось показать {name}: ни один опубликованный кодеками режим не подошёл.',
      'web.archive.openSubject': 'Открыть как субъект',
      'web.archive.entries': 'Содержимое',
      'web.archive.pick': 'Выберите элемент в дереве для просмотра.',
      'web.archive.openFailed': 'Не удалось открыть {path} как субъект: {reason}',
      'web.archive.noReference': 'ссылка на источник отсутствует',
      'web.archive.noExtract': 'у субъекта нет доступной операции извлечения',
      'web.archive.sessionGone': 'Сеанс, открывший этот контейнер, больше недоступен.',
      'web.archive.unknownEntry': 'В пространстве имён нет элемента с id {entry}.',
      'web.archive.wrongOutput': 'Операция вернула {kind} вместо байтов.',
      'web.archive.rejected': 'Отклонено: {reason}',
      'web.archive.shown': '{path} · {bytes} байт · режим: {mode}',
      'web.archive.modeHex': 'hex',
      'web.archive.modeText': 'текст',
      'web.archive.readFailed': 'Не удалось прочитать элемент: {reason}',
      'web.view.code': 'Код',
      'web.view.video': 'Видео',
      'web.view.image': 'Изображение',
      'web.view.font': 'Шрифт',
      'web.view.audio': 'Аудио',
      'web.view.world': 'Мир',
      'web.view.playback': 'Плеер',
      'web.view.model': 'Модель',
      'web.view.vector': 'Вектор',
      'web.view.archive': 'Содержимое',
      'web.view.template': 'Шаблон',
      'web.view.card': 'Карточка',
      'web.view.wiki': 'Вики',
      'web.view.calculations': 'Расчёты',
      'web.view.table': 'Таблица',
      'web.view.tree': 'Дерево',
      'web.view.relations': 'Связи',
      'web.view.text': 'Текст',
      'web.view.virtualText': 'Текст (поток)',
      'web.view.metadata': 'Метаданные',
      'web.view.hex': 'Hex',
      'web.view.textEditor': 'Текст (изменение)',
      'web.view.hexEditor': 'Hex (изменение)',
      'web.inspector.label': 'Инспектор',
      'web.inspector.edit': 'Изменение',
      'web.inspector.noFile': 'Нет открытого файла.',
      'web.inspector.summary':
        '{label} · операций чтения: {read} · форм изменения: {forms} из {write} операций · диагностик: {diagnostics}',
      'web.inspector.needInput':
        '{operations}: нет на панели инструментов — требуется ввод из другого режима или панели.',
      'web.inspector.noEdit': '{operations}: нет панели изменения — {reason}',
      'web.inspector.noWritableHandle': 'у страницы нет разрешения на запись в файл.',
      'web.inspector.noForm': '{operation}: нет формы изменения — {reason}.',
      'web.edit.unsupported': '{operation}: пока недоступно в этом приложении — {reason}',
      'web.edit.carried': 'в файле уже есть: {keys}',
      'web.edit.invoking': '{operation}: запуск {handler}…',
      'web.edit.codecRefused': 'Кодек отклонил операцию: {reason}',
      'web.edit.hostRefused': 'Приложение отклонило план изменения: {reason}',
      'web.edit.appliedReopening': '{outcome}; файл открывается заново в новой версии',
      'web.edit.appliedReopenFailed':
        '{outcome}; вкладку не удалось открыть заново, поэтому содержимое устарело',
      'web.edit.noneDrivableCount':
        'Неподдерживаемых операций изменения: {unsupported} из {declared}.',
      'web.edit.formsAvailable': 'Форм: {forms}; операций изменения: {declared}',
      'web.editability.noHandle':
        'У {name} нет дескриптора для записи: файл открыт через поле выбора, перетаскивание или загрузку, поэтому страница может показать его, но не сохранить обратно. Для изменения откройте файл через «Открыть файл…» или папку.',
      'web.editability.queryFailed':
        'У {name} есть дескриптор для записи, но браузер не смог сообщить разрешение ({reason}); решение будет принято при первом сохранении.',
      'web.editability.noQuery':
        'У {name} есть дескриптор для записи, но браузер не умеет проверять разрешение; возможность записи выяснится при первом сохранении.',
      'web.editability.denied':
        'Запись {name} запрещена, поэтому редакторы текста и hex скрыты. Приложение не предлагает сохранение, которое браузер уже отклонил.',
      'web.editability.granted': 'Файл {name} можно сохранить на месте: запись разрешена.',
      'web.editability.prompt':
        'Файл {name} можно сохранить после разрешения записи; браузер спросит при первом сохранении, либо нажмите «Включить изменение» сейчас.',
      'web.editability.request.noFile':
        'Перед включением изменения откройте папку или выберите файл.',
      'web.editability.request.noHandle':
        'У {name} нет дескриптора для записи: файл из перетаскивания, обычного поля выбора или загрузки нельзя сохранить обратно. Используйте «Открыть файл…» или разрешённую папку.',
      'web.editability.request.noSurface':
        'В этом браузере нельзя заранее запросить разрешение на запись {name}; сохранение попробует записать напрямую и покажет ответ браузера.',
      'web.editability.request.granted':
        'Запись {name} разрешена: редакторы текста и hex могут сохранять изменения.',
      'web.editability.request.denied':
        'Запись {name} запрещена; новые файлы будут открываться без редактора.',
      'web.editability.request.notGranted': 'Запись {name} не разрешена; ничего не изменено.',
      'web.editability.request.failed':
        'Не удалось запросить разрешение на запись {name}: {reason}',
      'web.edit.rejection.staleRevision': 'файл на диске изменился после чтения в этой вкладке',
      'web.edit.rejection.permissionMissing':
        'разрешение, с которым открыт субъект, не допускает запись файла',
      'web.edit.rejection.scopeMismatch': 'план указывает источник за пределами этого субъекта',
      'web.edit.rejection.guarantee':
        'средство записи не может обеспечить требуемую планом гарантию',
      'web.edit.rejection.fidelity': 'нет доказательств сохранения заявленных планом данных',
      'web.edit.rejection.confirmation':
        'запись с потерями требует явного подтверждения, которое приложение не запрашивает',
      'web.edit.rejection.payload': 'изменённые данные превышают предел передачи этого приложения',
      'web.edit.rejection.readOnly': 'источник доступен только для чтения',
      'web.edit.rejection.cancelled': 'сохранение отменено',
      'web.edit.rejection.unknown': 'план не описывает этот субъект в открытой версии',
      'web.edit.changeUnsupported':
        'редактор создал изменение, которое приложение не может выразить как буквальную замену',
      'web.edit.writerRefused': 'средство записи отклонило изменение',
      'web.edit.planUnsupported':
        'приложение не может составить план для изменения этого редактора',
      'web.edit.commit.writtenReopen':
        '{what} — записано в открытый вкладкой файл. Перед следующим изменением откройте его заново: вкладка всё ещё хранит прочитанную версию.',
      'web.edit.commit.refused': '{what}: отклонено — {reason}{diagnostic}.',
      'web.edit.commit.rolledBack': '{what}: ошибка; файл восстановлен до прежнего состояния.',
      'web.edit.commit.partial':
        '{what}: записано только частично; сведения о восстановлении находятся в квитанции.',
      'web.edit.commit.conflict':
        'Отклонено: файл на диске изменился после чтения в этой вкладке, поэтому ничего не перезаписано. Откройте файл заново и повторите изменение.',
      'web.edit.commit.rejected': 'Отклонено до записи: {reason}.',
      'web.edit.action.saved': 'Сохранение',
      'web.edit.action.undo': 'Отмена изменения',
      'web.edit.action.redo': 'Повтор изменения',
      'web.edit.authorization.denied': 'Не сохранено: браузер запретил запись файла.',
      'web.edit.authorization.notGranted': 'Не сохранено: запись не разрешена ({state}).',
      'web.edit.apply.noAccess': '{name} не записан: браузер не разрешил запись',
      'web.edit.apply.conflict': 'Отклонено до записи: {reason} (конфликтов: {conflicts})',
      'web.edit.apply.rejected': 'Отклонено до записи: {reason} ({code})',
      'web.edit.apply.committed': 'Изменение применено и записано в {name}',
      'web.edit.apply.notApplied': 'Не применено: {reason} ({code})',
      'web.edit.apply.rolledBack': 'Не применено: ошибка записи; файл {name} восстановлен',
      'web.edit.apply.partial':
        'Файл {name} записан только частично; сведения о восстановлении находятся в квитанции',
      'web.edit.cannotEdit': 'Здесь нельзя изменить {name}: {reason}',
      'web.edit.noWriter': 'Здесь нельзя изменить {name}: для субъекта нет средства записи.',
      'web.edit.bytesLabel': 'Изменить байты',
      'web.error.noPicker': 'Браузер не поддерживает выбор папки.',
      'web.map.choose': 'Введите ID карты для открытия в режиме мира:\n\n{candidates}',
      'web.map.permissionRequired':
        '{name} — для просмотра карты нужны ресурсы установленной игры, которые браузер не может найти сам; обычный просмотр архива остаётся открытым.',
      'web.map.selectionRequired':
        '{name} — для просмотра карты нужно выбрать вариант ({candidates}); обычный просмотр архива остаётся открытым.',
      'web.map.diagnostic.selectionRequired':
        'Для просмотра карты нужно явно выбрать вариант; выберите одну из возвращённых карт и продолжите.',
      'web.map.diagnostic.permissionRequired':
        'Для этой карты нужны ресурсы установленной игры, которые браузер не может найти автоматически; предоставьте доступ или выберите их в настольном приложении.',
      'web.extensions.subjectsDescription':
        'Карточки построены из проверенных JSON расширений и возможностей; точный контракт указан во всплывающей подсказке.',
      'web.extensions.downloadableDescription':
        'Каталог проверяется только по вашей команде; установка сохраняет проверенные файлы пакета, но не запускает их.',
      'web.extensions.notInCatalog': 'Нет в каталоге',
      'web.extensions.updateAvailable': 'Доступно обновление',
      'web.extensions.trusted': 'Доверено',
      'web.extensions.notTrusted': 'Не доверено',
      'web.extensions.catalogEmpty': 'В каталоге нет расширений.',
      'web.extensions.noDownloaded': 'Загруженные расширения не установлены; проверьте каталог.',
      'web.extensions.packageDisabled': 'Расширение включено напрямую, но его пакет выключен.',
      'web.extensions.reloadPending': 'Перезагрузите страницу, чтобы перестроить запущенный хост.',
      'web.extensions.removedPending':
        'Удалено из списка; перезагрузите страницу, чтобы перестроить хост.',
      'web.extensions.trustSentence':
        'Папка, добавленная здесь, считается доверенной только потому, что вы выбрали её сами: она не подписана и не проверена. Страница вычисляет хеш каждого файла и отклонит его, если он изменится после чтения; пользовательские расширения всегда работают в рабочем процессе.',
      'web.extensions.provenanceNote':
        'Хеши встроенных расширений записаны при сборке приложения. Для добавленных папок страница вычисляет хеши сама — это проверка прочитанных байтов, а не подтверждение их автора.',
      'web.extensions.remembered': 'Добавленные папки сохраняются в {location}.',
      'web.extensions.added': 'Добавлена папка «{name}»{coordinate}.',
      'web.extensions.actionFailed': 'Действие с расширением не выполнено: {reason}',
      'web.extensions.addFailed': 'Не удалось добавить папку: {reason}',
      'web.extensions.removeFailed': 'Не удалось удалить расширение: {reason}',
      'web.extensions.accessFailed': 'Не удалось запросить доступ: {reason}',
      'web.extensions.accessGranted': 'Доступ к «{name}» снова разрешён.',
      'web.extensions.accessDenied': 'Доступ к «{name}» не разрешён ({state}).',
      'web.extensions.catalogChecked': 'Каталог расширений проверен: {location}.',
      'web.extensions.catalogLoaded': 'Каталог загружен из {location}.',
      'web.extensions.catalogNotContacted': 'Каталог {location} ещё не запрашивался в этом сеансе.',
      'web.extensions.installedStatus':
        '{name} установлено. Перезагрузите страницу, чтобы применить изменения.',
      'web.extensions.updatedStatus':
        '{name} обновлено. Перезагрузите страницу, чтобы применить изменения.',
      'web.extensions.removedStatus':
        '{name} удалено. Перезагрузите страницу, чтобы применить изменения.',
      'web.extensions.cardFailed': 'Не удалось открыть карточку расширения: {reason}',
      'web.extensions.bundledProvenance':
        'Встроено в эту сборку и опубликовано из {root}; хеши записаны при сборке приложения.',
      'web.extensions.userProvenance':
        'Разрешённая вами папка («{label}»); страница вычислила хеши только что прочитанных байтов.',
    },
  },
  {
    authorizedMessagePrefixes: ['web.'],
    fallbackCatalog: EN.messages,
  },
)

export const WEB_UI_CATALOGS = Object.freeze([EN, RU])

const WEB_ENGLISH_FALLBACK = Object.freeze({
  ...UI_MESSAGES.en,
  ...EN.messages,
})

/**
 * Product-owned message roots that a data-only language pack may translate. A catalog can also
 * publish the exact prefix derived from its own namespace, which lets an extension translate its
 * own UI without gaining authority over another extension's messages.
 */
export const WEB_LOCALIZATION_TRANSLATABLE_PREFIXES: readonly string[] = Object.freeze(
  [...new Set(Object.keys(WEB_ENGLISH_FALLBACK).map(key => `${key.split('.')[0]}.`))].sort(),
)

interface WebCatalogFetchHeaders {
  get(name: string): string | null
}

interface WebCatalogFetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: WebCatalogFetchHeaders
  readonly url?: string
  readonly redirected?: boolean
  arrayBuffer(): Promise<ArrayBuffer>
}

type WebCatalogFetch = (
  url: string,
  init?: {
    readonly method?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly redirect?: 'manual'
    readonly signal?: AbortSignal
  },
) => Promise<WebCatalogFetchResponse>

export interface LoadWebLocalizationCatalogsOptions {
  /** Exact inventory produced by the same composed inputs the PWA gives its host. */
  readonly inventory: Inventory
  /** Page base URL; ordinary bundled catalog resources are confined to this origin by default. */
  readonly baseUrl: string | URL
  /** Combined managed + user roots whose synthetic URLs are served from granted/stored bytes. */
  readonly loadedExtensionRoots?: LoadedUserExtensionRoots
  /** Injectable page fetch for tests and embedded hosts. */
  readonly fetch?: WebCatalogFetch
  /** Additional product-configured artifact origins; none are inferred from extension manifests. */
  readonly allowedOrigins?: readonly string[]
  readonly signal?: AbortSignal
}

const emptyHeaders: WebCatalogFetchHeaders = Object.freeze({ get: () => null })

function byteHeaders(length: number): WebCatalogFetchHeaders {
  return Object.freeze({
    get(name: string): string | null {
      switch (name.toLowerCase()) {
        case 'accept-ranges':
          return 'bytes'
        case 'content-length':
          return String(length)
        default:
          return null
      }
    },
  })
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/**
 * The synthetic folder source is deliberately a tiny fetch surface and does not implement HTTP
 * HEAD/ranges. Adapt it here, under the localization byte ceiling, so the shared HTTP VFS still
 * gets its normal bounded random-access contract. Bytes are cached only for this one catalog-load
 * pass and are still checked against the inventory's per-file SHA-256 by the host loader.
 */
function syntheticCatalogFetch(roots: LoadedUserExtensionRoots): WebCatalogFetch {
  const cache = new Map<string, Promise<Uint8Array | undefined>>()
  const bytesFor = (url: string, signal?: AbortSignal): Promise<Uint8Array | undefined> => {
    let pending = cache.get(url)
    if (pending === undefined) {
      pending = roots
        .serve(url, signal === undefined ? undefined : { signal })
        .then(async value => (value.ok ? new Uint8Array(await value.arrayBuffer()) : undefined))
      cache.set(url, pending)
    }
    return pending
  }
  return async (url, init) => {
    init?.signal?.throwIfAborted()
    const bytes = await bytesFor(url, init?.signal)
    if (bytes === undefined) {
      return Object.freeze({
        ok: false,
        status: 404,
        headers: emptyHeaders,
        url,
        arrayBuffer: async () => new ArrayBuffer(0),
      })
    }
    const headers = byteHeaders(bytes.byteLength)
    if (init?.method === 'HEAD') {
      return Object.freeze({
        ok: true,
        status: 200,
        headers,
        url,
        arrayBuffer: async () => new ArrayBuffer(0),
      })
    }
    const range = init?.headers?.['Range'] ?? init?.headers?.['range']
    const match = range?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match !== undefined && match !== null) {
      const start = Number(match[1])
      const end = Number(match[2])
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end >= bytes.byteLength
      ) {
        return Object.freeze({
          ok: false,
          status: 416,
          headers,
          url,
          arrayBuffer: async () => new ArrayBuffer(0),
        })
      }
      const selected = bytes.slice(start, end + 1)
      return Object.freeze({
        ok: true,
        status: 206,
        headers: byteHeaders(selected.byteLength),
        url,
        arrayBuffer: async () => arrayBuffer(selected),
      })
    }
    return Object.freeze({
      ok: true,
      status: 200,
      headers,
      url,
      arrayBuffer: async () => arrayBuffer(bytes),
    })
  }
}

function containedCatalogUrl(rootUri: string, path: string): string {
  const root = new URL(rootUri)
  if (!root.href.endsWith('/') || root.search !== '' || root.hash !== '') {
    throw new TypeError('localization artifact root must be a query-free directory URL')
  }
  const target = new URL(path, root)
  if (
    target.origin !== root.origin ||
    !target.pathname.startsWith(root.pathname) ||
    target.username !== root.username ||
    target.password !== root.password
  ) {
    throw new TypeError(`localization resource escapes artifact root: ${path}`)
  }
  return target.href
}

/**
 * HTTP VFS mounts represent one URL, while inventory artifact roots represent directories. This
 * narrow adapter resolves a requested child under that directory and then opens the exact URL
 * through the Extension Manager's browser VFS. It adds no filesystem or direct-fetch bypass.
 */
function directoryCatalogVfs(vfs: {
  openMount(uri: string, options?: VfsOpenOptions): Promise<VfsMount>
}): { openMount(uri: string, options?: VfsOpenOptions): Promise<VfsMount> } {
  return {
    async openMount(rootUri, options) {
      const children = new Map<string, VfsMount>()
      let disposed = false
      const child = async (path: string): Promise<VfsMount> => {
        if (disposed) throw new Error(`localization artifact mount is disposed: ${rootUri}`)
        let mount = children.get(path)
        if (mount === undefined) {
          mount = await vfs.openMount(containedCatalogUrl(rootUri, path), options)
          children.set(path, mount)
        }
        return mount
      }
      const mount: VfsMount = {
        id: rootUri,
        rootUri,
        revision: `provider-token:web-localization-${encodeURIComponent(rootUri)}`,
        async stat(path, signal): Promise<VfsNode | undefined> {
          const exact = await child(path)
          const node = await exact.stat('', signal)
          return node === undefined
            ? undefined
            : Object.freeze({ ...node, path, name: path.split('/').at(-1) ?? path })
        },
        async *list(): AsyncIterable<VfsNode> {
          throw new Error('localization artifact mounts do not allow directory enumeration')
        },
        async open(path, signal): Promise<RandomAccessSource> {
          return (await child(path)).open('', signal)
        },
        async dispose(): Promise<void> {
          if (disposed) return
          disposed = true
          await Promise.all([...children.values()].map(async value => value.dispose()))
          children.clear()
        },
      }
      return mount
    },
  }
}

function namespaceMessagePrefix(namespace: string): string {
  const tail = namespace.split(/[./]/u).at(-1) ?? namespace
  const owner = tail.replace(/-(?:app|ui|localization|messages)$/u, '') || tail
  return `${owner}.`
}

/**
 * Load every enabled localization contribution in the PWA's composed inventory. English and
 * Russian stay embedded in the UI and therefore remain available if VFS, policy, integrity or
 * JSON validation refuses every external catalog.
 */
export async function loadWebLocalizationCatalogs(
  options: LoadWebLocalizationCatalogsOptions,
): Promise<LoadedLocalizationCatalogs<UiCatalogDocument>> {
  const roots = options.loadedExtensionRoots ?? NO_USER_EXTENSION_ROOTS
  const pageFetch = options.fetch ?? (globalThis.fetch.bind(globalThis) as WebCatalogFetch)
  const syntheticFetch = syntheticCatalogFetch(roots)
  const routedFetch: WebCatalogFetch = (url, init) =>
    isUserExtensionUrl(url) ? syntheticFetch(url, init) : pageFetch(url, init)
  const baseOrigin = new URL(options.baseUrl).origin
  const allowedOrigins = Object.freeze(
    [
      ...new Set([
        baseOrigin,
        new URL(USER_EXTENSION_ARTIFACT_ORIGIN).origin,
        ...(options.allowedOrigins ?? []),
      ]),
    ].sort(),
  )
  const created = createBrowserExtensionVfs({
    fetch: routedFetch,
    allowedOrigins,
  })
  try {
    return await loadLocalizationCatalogs(options.inventory, {
      vfs: directoryCatalogVfs(created.vfs),
      parseCatalog: parseUiCatalogDocument,
      fallbackCatalog: WEB_ENGLISH_FALLBACK,
      authorizeMessagePrefixes: request => {
        const owned = namespaceMessagePrefix(request.catalogNamespace)
        return request.requestedMessagePrefixes.filter(
          prefix => prefix === owned || WEB_LOCALIZATION_TRANSLATABLE_PREFIXES.includes(prefix),
        )
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } finally {
    await created.vfs.dispose()
  }
}

export function createWebLocalizer(
  requested: string | readonly string[] | undefined,
  catalogs: readonly UiCatalogDocument[] = [],
): UiLocalizer {
  const locale = resolveUiLocale(requested, {
    availableLocales: ['en', 'ru', ...catalogs.map(catalog => catalog.locale)],
    systemLocales: globalThis.navigator?.languages,
  })
  return createUiLocalizer(locale, { catalogs: [...WEB_UI_CATALOGS, ...catalogs] })
}

/**
 * Narrow app boundary for Extension Manager/VFS catalog loading.
 *
 * The manager remains responsible for trust, VFS confinement, size limits and validation; the
 * Web app consumes only catalogs. This structural result accepts `loadLocalizationCatalogs(...)`
 * without coupling presentation code to a host implementation.
 */
export type WebLocalizationCatalogLoader = () => Promise<{
  readonly catalogs: readonly UiCatalogDocument[]
}>

export async function createWebLocalizerFromCatalogLoader(
  requested: string | readonly string[] | undefined,
  loadCatalogs: WebLocalizationCatalogLoader,
  catalogs: readonly UiCatalogDocument[] = [],
): Promise<UiLocalizer> {
  const loaded = await loadCatalogs()
  return createWebLocalizer(requested, [...catalogs, ...loaded.catalogs])
}
