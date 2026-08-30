import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseUiCatalogDocument } from '@modkitx-x3/ui/localization'

import { createElectronLocalizer, ELECTRON_UI_CATALOGS } from '../src/localization.js'

describe('Electron UI localization', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the English and Russian application catalogs in exact key parity', () => {
    const [english, russian] = ELECTRON_UI_CATALOGS
    expect(english?.locale).toBe('en')
    expect(russian?.locale).toBe('ru')
    expect(Object.keys(russian?.messages ?? {}).sort()).toEqual(
      Object.keys(english?.messages ?? {}).sort(),
    )
  })

  it('keeps interpolation placeholders in English and Russian messages aligned', () => {
    const [english, russian] = ELECTRON_UI_CATALOGS
    const placeholders = (message: string): readonly string[] =>
      [...message.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/gu)].map(match => match[1] as string).sort()
    for (const [key, message] of Object.entries(english?.messages ?? {})) {
      expect(placeholders(russian?.messages[key] ?? ''), key).toEqual(placeholders(message))
    }
  })

  it('falls back by BCP-47 language and retains the shared catalog underneath', () => {
    const russian = createElectronLocalizer('ru-RU')
    expect(russian.locale).toBe('ru')
    expect(russian.text('electron.menu.openFile')).toBe('Открыть файл…')
    expect(russian.text('extensions.group.available')).toBe('Доступные')
    expect(createElectronLocalizer('de-DE').text('app.title')).toBe('Modkit MK3')
  })

  it('resolves auto through Chromium language preferences', () => {
    vi.stubGlobal('navigator', { languages: ['ru-RU', 'en-US'] })
    expect(createElectronLocalizer('auto').locale).toBe('ru')
  })

  it('interpolates user data without treating it as a translation key', () => {
    expect(
      createElectronLocalizer('ru').text('electron.menu.recentFile', { path: 'C:/map.SC2Map' }),
    ).toBe('Файл — C:/map.SC2Map')
  })

  it('localizes native main-process dialogs, menus and file-association results', () => {
    const english = createElectronLocalizer('en')
    const russian = createElectronLocalizer('ru-RU')

    expect(english.text('electron.main.close.message', { name: 'map.wz' })).toBe(
      'Save changes to map.wz?',
    )
    expect(russian.text('electron.main.close.message', { name: 'map.wz' })).toBe(
      'Сохранить изменения в map.wz?',
    )
    expect(
      russian.text('electron.main.fileAssociation.registered', {
        count: 2,
        types: 'wz, sc2map',
      }),
    ).toContain('зарегистрировано типов: 2 (wz, sc2map)')
    expect(russian.text('electron.main.dialog.addExtension')).toBe('Добавить расширение')
  })

  it('routes native main-process product copy through the selected localizer', () => {
    const main = readFileSync(resolve(import.meta.dirname, '../electron/main.cjs'), 'utf8')
    for (const key of [
      'electron.main.fileAssociation.registered',
      'electron.main.subject.notWritable',
      'electron.main.dialog.openFolder',
      'electron.main.close.message',
      'electron.main.dialog.addExtensionFolder',
      'electron.main.menu.openRecent',
      'electron.menu.splitEditor',
    ]) {
      expect(main, key).toContain(`localizer.text('${key}'`)
    }
    for (const literal of [
      'Open a folder in Modkit',
      'Save changes to ${String(name)}?',
      'Add an extension folder',
      'Extensions & Codecs…',
      "buttons: ['Save', \"Don't save\", 'Cancel']",
    ]) {
      expect(main).not.toContain(literal)
    }
  })

  it('drives image-editing selftests through locale-independent control ids', () => {
    const renderer = readFileSync(resolve(import.meta.dirname, '../src/renderer.ts'), 'utf8')
    expect(renderer).toContain('[data-tool-id="fill"]')
    expect(renderer).toContain('[data-action-id="apply"]')
    expect(renderer).not.toContain('[title="Flood fill"]')
    expect(renderer).not.toContain('[title="Commit the edited pixels"]')
  })

  it('accepts a data-only third-language catalog without adding locale branches', () => {
    const english = ELECTRON_UI_CATALOGS[0]
    if (english === undefined) throw new Error('missing English Electron catalog')
    const french = parseUiCatalogDocument(
      {
        schema: 'org.modkitx/ui-message-catalog@1',
        locale: 'fr',
        namespace: 'org.example/electron-language-pack',
        messages: {
          'electron.extensions.back': 'Retour aux extensions',
        },
      },
      {
        authorizedMessagePrefixes: ['electron.'],
        fallbackCatalog: english.messages,
      },
    )
    const localizer = createElectronLocalizer('fr-FR', [french])
    expect(localizer.locale).toBe('fr')
    expect(localizer.text('electron.extensions.back')).toBe('Retour aux extensions')
    expect(localizer.text('electron.extensions.loadingCard')).toBe('Loading subject card…')
  })
})
