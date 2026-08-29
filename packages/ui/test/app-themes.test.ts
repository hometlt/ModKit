import { describe, expect, it } from 'vitest'

import { APP_THEME_DOM_ID, readAppThemeChoices } from '../src/settings/index.js'

const documentWith = (value: string | undefined) => ({
  getElementById(id: string) {
    return id === APP_THEME_DOM_ID && value !== undefined ? { textContent: value } : null
  },
})

describe('static app theme build data', () => {
  it('reads the exact generic and external choices emitted by a build', () => {
    expect(
      readAppThemeChoices(
        documentWith(
          JSON.stringify([
            { id: 'modkit-dark', label: 'Modkit Dark', stylesheet: './modkit-ui.css' },
            { id: 'fixture', label: 'Fixture Theme', stylesheet: './theme-fixture.css' },
          ]),
        ),
      ),
    ).toEqual([
      { id: 'modkit-dark', label: 'Modkit Dark', stylesheet: './modkit-ui.css' },
      { id: 'fixture', label: 'Fixture Theme', stylesheet: './theme-fixture.css' },
    ])
  })

  it('fails closed for missing, malformed, duplicate or unsafe build data', () => {
    expect(() => readAppThemeChoices(documentWith(undefined))).toThrow(/missing/u)
    expect(() => readAppThemeChoices(documentWith('{'))).toThrow(/invalid/u)
    expect(() =>
      readAppThemeChoices(
        documentWith(
          JSON.stringify([
            { id: 'same', label: 'One', stylesheet: './theme-same.css' },
            { id: 'same', label: 'Two', stylesheet: './theme-same.css' },
          ]),
        ),
      ),
    ).toThrow(/duplicate/u)
    expect(() =>
      readAppThemeChoices(
        documentWith(
          JSON.stringify([{ id: 'unsafe', label: 'Unsafe', stylesheet: '../outside.css' }]),
        ),
      ),
    ).toThrow(/stylesheet/u)
  })
})
