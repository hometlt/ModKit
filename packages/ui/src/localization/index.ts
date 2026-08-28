/** Locales shipped by the reference UI. Hosts may still provide a complete replacement catalog. */
export type UiLocale = 'en' | 'ru'

const EN_MESSAGES = Object.freeze({
  'app.title': 'Modkit MK3',
  'app.starting': 'Starting Modkit MK3…',
  'action.openFile': 'Open file…',
  'action.openFileTitle': 'Open a single file in a new tab',
  'action.splitEditor': 'Split editor',
  'action.splitEditorTitle': 'Open the next file beside this one',
  'action.enableEditing': 'Enable editing',
  'action.enableEditingTitle':
    'Ask this browser for permission to write the file or folder you picked',
  'action.restartSession': 'Restart session',
  'action.restartSessionTitle': 'Reload Modkit after the codec worker stopped',
  'settings.bundled': 'Bundled extensions',
  'settings.bundledExcluded': 'Bundled but not served here',
  'settings.bundledDescription':
    '{count} extensions were attested at build time and are served from this origin under extensions/. They are listed read-only because {reason}.',
  'sidebar.host': 'Host',
  'sidebar.facilities': 'Facilities',
  'sidebar.samples': 'Served samples',
  'sidebar.language': 'Language',
  'sidebar.hostSummary':
    '{extensions} extensions · {types} detectable types · codecs run {profiles} in {realm} · shared memory {sharedMemory}',
  'locale.en': 'English',
  'locale.ru': 'Русский',
  'common.yes': 'yes',
  'common.no': 'no',
  'activity.files': 'Files',
  'activity.explorer': 'Explorer',
  'activity.host': 'Host',
  'activity.hostTitle': 'Show or hide the host panel',
  'activity.info': 'Info',
  'activity.infoTitle': 'Show or hide diagnostics and operations',
  'activity.settings': 'Settings',
  'status.noFileEditable': 'No file is open yet, so nothing is editable.',
  'status.workerUnavailable': 'Codec worker stopped · restart the session to continue',
  'status.ready': 'Ready · {extensions} extensions · {notices} boot notice(s)',
  'confirm.discardAndRestart':
    'Some tabs have unsaved changes. Restart the session and discard them?',
  'error.openFile': 'Could not open the file: {reason}',
  'error.drop': 'Drop failed: {reason}',
  'error.fetch': '{path} could not be fetched from this origin.',
})

export type UiMessageKey = keyof typeof EN_MESSAGES
export type UiMessageValues = Readonly<Record<string, string | number>>
export type UiMessageCatalog = Readonly<Record<UiMessageKey, string>>

const RU_MESSAGES: UiMessageCatalog = Object.freeze({
  'app.title': 'Modkit MK3',
  'app.starting': 'Запуск Modkit MK3…',
  'action.openFile': 'Открыть файл…',
  'action.openFileTitle': 'Открыть один файл в новой вкладке',
  'action.splitEditor': 'Разделить редактор',
  'action.splitEditorTitle': 'Открыть следующий файл рядом с текущим',
  'action.enableEditing': 'Разрешить редактирование',
  'action.enableEditingTitle': 'Запросить у браузера право записи в выбранный файл или папку',
  'action.restartSession': 'Перезапустить сеанс',
  'action.restartSessionTitle': 'Перезагрузить Modkit после остановки рабочего процесса кодеков',
  'settings.bundled': 'Встроенные расширения',
  'settings.bundledExcluded': 'Встроены, но здесь не опубликованы',
  'settings.bundledDescription':
    'Расширений аттестовано при сборке: {count}. Они публикуются с этого origin в extensions/ и доступны только для чтения: {reason}.',
  'sidebar.host': 'Хост',
  'sidebar.facilities': 'Возможности',
  'sidebar.samples': 'Примеры с сервера',
  'sidebar.language': 'Язык',
  'sidebar.hostSummary':
    'Расширений: {extensions} · распознаваемых типов: {types} · кодеки работают как {profiles} в {realm} · общая память: {sharedMemory}',
  'locale.en': 'English',
  'locale.ru': 'Русский',
  'common.yes': 'да',
  'common.no': 'нет',
  'activity.files': 'Файлы',
  'activity.explorer': 'Проводник',
  'activity.host': 'Хост',
  'activity.hostTitle': 'Показать или скрыть панель хоста',
  'activity.info': 'Инфо',
  'activity.infoTitle': 'Показать или скрыть диагностику и операции',
  'activity.settings': 'Настройки',
  'status.noFileEditable': 'Файл ещё не открыт — редактировать пока нечего.',
  'status.workerUnavailable':
    'Рабочий процесс кодеков остановлен · перезапустите сеанс, чтобы продолжить',
  'status.ready': 'Готово · расширений: {extensions} · сообщений запуска: {notices}',
  'confirm.discardAndRestart':
    'В открытых вкладках есть несохранённые изменения. Перезапустить сеанс и удалить их?',
  'error.openFile': 'Не удалось открыть файл: {reason}',
  'error.drop': 'Не удалось принять файл: {reason}',
  'error.fetch': 'Не удалось загрузить {path} с этого origin.',
})

export const UI_MESSAGES: Readonly<Record<UiLocale, UiMessageCatalog>> = Object.freeze({
  en: EN_MESSAGES,
  ru: RU_MESSAGES,
})

/** Resolve a BCP-47 preference list to the small locale set this build actually ships. */
export function resolveUiLocale(requested: string | readonly string[] | undefined): UiLocale {
  const candidates =
    requested === undefined ? [] : typeof requested === 'string' ? [requested] : requested
  for (const candidate of candidates) {
    const language = candidate.trim().toLowerCase().split('-')[0]
    if (language === 'ru') return 'ru'
    if (language === 'en') return 'en'
  }
  return 'en'
}

export interface UiLocalizer {
  readonly locale: UiLocale
  text(key: UiMessageKey, values?: UiMessageValues): string
}

/** Immutable per-host translator. There is no process-global locale for two embedded hosts to race. */
export function createUiLocalizer(
  locale: UiLocale,
  overrides: Partial<UiMessageCatalog> = {},
): UiLocalizer {
  const catalog = Object.freeze({ ...UI_MESSAGES[locale], ...overrides })
  const localizer: UiLocalizer = {
    locale,
    text(key: UiMessageKey, values: UiMessageValues = {}) {
      return catalog[key].replace(
        /\{([a-zA-Z][a-zA-Z0-9]*)\}/gu,
        (_match: string, name: string) => {
          const value = values[name]
          return value === undefined ? `{${name}}` : String(value)
        },
      )
    },
  }
  return Object.freeze(localizer)
}
