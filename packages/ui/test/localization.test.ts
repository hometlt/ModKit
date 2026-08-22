import { describe, expect, it } from 'vitest'

import { createUiLocalizer, resolveUiLocale, UI_MESSAGES } from '../src/localization/index.js'

describe('UI localization', () => {
  it('resolves BCP-47 preferences deterministically and falls back to English', () => {
    expect(resolveUiLocale(['uk-UA', 'ru-RU', 'en-US'])).toBe('ru')
    expect(resolveUiLocale('en-GB')).toBe('en')
    expect(resolveUiLocale(['de-DE'])).toBe('en')
  })

  it('ships complete English and Russian catalogs over one typed key set', () => {
    expect(Object.keys(UI_MESSAGES.ru).sort()).toEqual(Object.keys(UI_MESSAGES.en).sort())
    expect(createUiLocalizer('ru').text('action.openFile')).toBe('Открыть файл…')
  })

  it('substitutes named values without interpreting message text as markup', () => {
    expect(
      createUiLocalizer('ru').text('status.ready', { extensions: 42, notices: '<script>' }),
    ).toBe('Готово · расширений: 42 · сообщений запуска: <script>')
  })

  it('allows a host-owned catalog override without changing another host', () => {
    const custom = createUiLocalizer('en', { 'activity.files': 'Assets' })
    expect(custom.text('activity.files')).toBe('Assets')
    expect(createUiLocalizer('en').text('activity.files')).toBe('Files')
  })
})
