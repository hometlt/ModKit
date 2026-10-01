import { describe, expect, it } from 'vitest'
import { mediaShellStateOf } from '../src/media-shell/index.js'
import {
  rememberUiPreference,
  setUiPreferenceStore,
  uiPreference,
} from '../src/viewer/preferences.js'

describe('the media shell layout a person left', () => {
  it('keeps what is valid, holds widths to the pane limits and bounds the section lists', () => {
    expect(
      mediaShellStateOf({
        leftWidth: 9000,
        rightWidth: 300.4,
        leftCollapsed: true,
        rightCollapsed: 'no',
        galleryMode: 'big',
        collapsedSections: ['audio', 7, 'metadata:wwise'],
        expandedSections: Array.from({ length: 70 }, (_, index) => `section-${index}`),
        filterRegex: true,
      }),
    ).toEqual({
      leftWidth: 640,
      rightWidth: 300,
      leftCollapsed: true,
      galleryMode: 'big',
      collapsedSections: ['audio', 'metadata:wwise'],
      expandedSections: Array.from({ length: 64 }, (_, index) => `section-${index + 6}`),
      filterRegex: true,
    })
    // storage another version wrote, or nothing at all, gives the defaults
    expect(mediaShellStateOf({ galleryMode: 'huge', leftWidth: Number.NaN })).toEqual({})
    expect(mediaShellStateOf('layout')).toEqual({})
    expect(mediaShellStateOf(undefined)).toEqual({})
  })

  it('reads and writes preferences through the store a host installs', () => {
    const kept = new Map<string, unknown>()
    setUiPreferenceStore({ get: key => kept.get(key), set: (key, value) => kept.set(key, value) })
    rememberUiPreference('image.recentColors', ['#ff0000'])
    expect(kept.get('image.recentColors')).toEqual(['#ff0000'])
    expect(uiPreference('image.recentColors')).toEqual(['#ff0000'])
    expect(uiPreference('video.loop')).toBeUndefined()
  })
})
