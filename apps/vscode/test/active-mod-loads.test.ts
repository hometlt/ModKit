import { describe, expect, it } from 'vitest'
import { ActiveModLoads } from '../src/active-mod-loads.js'

describe('ActiveModLoads', () => {
  it('loads a document inside a package once and a loose document never', async () => {
    const loads = new ActiveModLoads()
    let loaded = 0
    const load = async () => (loaded += 1) === 1
    expect(await loads.ensure('Mod.SC2Mod/a.xml', async () => true, load)).toEqual({ state: 'loaded', changed: true })
    expect(await loads.ensure('Mod.SC2Mod/a.xml', async () => true, load)).toEqual({ state: 'loaded', changed: false })
    expect(await loads.ensure('notes.txt', async () => false, load)).toEqual({ state: 'none', changed: false })
    expect(loaded).toBe(1)
  })

  it('remembers a failure instead of retrying it until forget', async () => {
    const loads = new ActiveModLoads()
    let attempts = 0
    const failing = async (): Promise<boolean> => {
      attempts += 1
      throw new Error('Core.SC2Mod is unavailable')
    }
    expect(await loads.ensure('Mod.SC2Mod/a.xml', async () => true, failing)).toEqual({
      state: 'failed', changed: true, failure: 'Core.SC2Mod is unavailable',
    })
    expect(await loads.ensure('Mod.SC2Mod/a.xml', async () => true, failing)).toMatchObject({ state: 'failed', changed: false })
    expect(attempts).toBe(1)
    loads.forget()
    expect(await loads.ensure('Mod.SC2Mod/a.xml', async () => true, async () => true)).toEqual({ state: 'loaded', changed: true })
  })

  it('loads again after forget, as when the content source is replaced', async () => {
    const loads = new ActiveModLoads()
    await loads.ensure('Mod.SC2Mod/a.xml', async () => true, async () => true)
    loads.forget()
    let reloaded = false
    await loads.ensure('Mod.SC2Mod/a.xml', async () => true, async () => (reloaded = true))
    expect(reloaded).toBe(true)
  })
})
