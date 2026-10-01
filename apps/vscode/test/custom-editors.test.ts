import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODKIT_VIEW_TYPES, STAGE_CUSTOM_EDITOR_TYPES } from '../src/constants.js'

/*
 * Every editor this extension registers is declared in the manifest, and the other way round: a
 * view type registered but not declared never shows in «Reopen With», one declared but not
 * registered fails to open.
 */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  contributes: { customEditors: { viewType: string }[] }
}

describe('custom editors', () => {
  it('declares exactly the view types the extension registers', () => {
    const declared = manifest.contributes.customEditors.map(item => item.viewType).sort()
    expect(declared).toEqual([...MODKIT_VIEW_TYPES].sort())
  })

  it('offers a map in its world and in its layers (plan 6.9)', () => {
    expect(STAGE_CUSTOM_EDITOR_TYPES['modkit.worldViewer']).toBe('world')
    expect(STAGE_CUSTOM_EDITOR_TYPES['modkit.mapLayersViewer']).toBe('map-layers')
  })

  it('offers a recording in its player and a model in its viewer (plan 6.8)', () => {
    expect(STAGE_CUSTOM_EDITOR_TYPES['modkit.playbackViewer']).toBe('playback')
    expect(STAGE_CUSTOM_EDITOR_TYPES['modkit.modelViewer']).toBe('model')
  })

  it('opens a mod on its wiki (plan 5.25)', () => {
    expect(STAGE_CUSTOM_EDITOR_TYPES['modkit.wikiViewer']).toBe('wiki')
  })
})
