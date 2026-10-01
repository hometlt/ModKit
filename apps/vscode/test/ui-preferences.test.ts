import { describe, expect, it } from 'vitest'
import { withUiPreference } from '../src/ui-preferences.js'

describe('the viewer preferences the extension keeps', () => {
  it('sets one key and keeps the others', () => {
    expect(
      withUiPreference({ 'video.loop': true }, 'mediaShell.layout', { leftWidth: 300 }),
    ).toEqual({ 'video.loop': true, 'mediaShell.layout': { leftWidth: 300 } })
    expect(withUiPreference(undefined, 'video.loop', false)).toEqual({ 'video.loop': false })
  })

  it('refuses a malformed key and a value that is not small JSON', () => {
    expect(withUiPreference({}, '../settings', true)).toBeUndefined()
    expect(withUiPreference({}, '', true)).toBeUndefined()
    expect(withUiPreference({}, 7, true)).toBeUndefined()
    expect(withUiPreference({}, 'big', 'x'.repeat(20_000))).toBeUndefined()
    expect(withUiPreference({}, 'nothing', undefined)).toBeUndefined()
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(withUiPreference({}, 'cyclic', cyclic)).toBeUndefined()
  })

  it('drops the oldest keys past the limit, a key written again counting as new', () => {
    let stored: unknown = {}
    for (let index = 0; index < 70; index += 1)
      stored = withUiPreference(stored, `key${index}`, index)
    expect(Object.keys(stored as object)[0]).toBe('key6')
    // written again, key10 is now the newest, so the next key drops key6 and then key7, not it
    stored = withUiPreference(stored, 'key10', 'again')
    stored = withUiPreference(stored, 'key70', 70)
    const keys = Object.keys(stored as object)
    expect(keys).toHaveLength(64)
    expect(keys[0]).toBe('key7')
    expect(keys.slice(-2)).toEqual(['key10', 'key70'])
  })
})
