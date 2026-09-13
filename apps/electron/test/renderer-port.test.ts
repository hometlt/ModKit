import { describe, expect, it } from 'vitest'

import { createElectronRendererPort } from '../src/renderer-port.js'

describe('Electron model renderer port', () => {
  it('leases the browser WebGL provider carried by the renderer bundle', async () => {
    const acquired = await createElectronRendererPort().acquire({ outputKind: 'rgba8' })
    expect(acquired.state).toBe('resolved')
    if (acquired.state !== 'resolved') throw new Error('renderer did not resolve')
    expect(acquired.lease.renderer).toMatchObject({
      contract: 'common.render/scene-3d',
      rendererId: 'modkit.browser-webgl',
      outputKinds: ['rgba8'],
    })
    await acquired.lease.release()
  })

  it('states when a requested renderer is not bundled', async () => {
    const acquired = await createElectronRendererPort().acquire({
      outputKind: 'rgba8',
      rendererId: 'vendor/other-renderer',
    })
    expect(acquired).toMatchObject({
      state: 'unresolved',
      diagnostics: [{ code: 'x3.electron/renderer-not-bundled' }],
    })
  })
})
