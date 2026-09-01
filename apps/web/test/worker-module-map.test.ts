import { describe, expect, it } from 'vitest'

import { WEB_WORKER_MODULE_MAP } from '../src/subjects.js'

describe('PWA worker module surface', () => {
  it('publishes the portable host and SDK subpaths required by the installed Warzone codec', () => {
    expect(WEB_WORKER_MODULE_MAP).toMatchObject({
      '@modkit/host': 'vendor/host/index.js',
      '@modkit/sdk/templates': 'vendor/sdk/templates/index.js',
      'modkit-extension-archives/formats/zip/codec':
        'vendor/modkit-extension-archives/formats/zip/codec.js',
    })
  })
})
