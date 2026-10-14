import { describe, expect, it } from 'vitest'

import { WEB_WORKER_MODULE_MAP } from '../src/subjects.js'

describe('PWA worker module surface', () => {
  it('publishes the exact portable subpaths required by Warzone and common model codecs', () => {
    expect(WEB_WORKER_MODULE_MAP).toMatchObject({
      '@modkit/codec-kit/json-snapshot': 'vendor/codec-kit/json-snapshot.js',
      '@modkit/host': 'vendor/host/index.js',
      '@modkit/scene/uvm': 'vendor/scene/uvm/index.js',
      '@modkit/scene/uvm/render': 'vendor/scene/uvm/render.js',
      '@modkit/sdk/model-encoding': 'vendor/sdk/model-encoding.js',
      '@modkit/sdk/templates': 'vendor/sdk/templates/index.js',
      '@modkit/uv/model/container': 'vendor/uv/model/container.js',
      '@modkit/uv/model/portable': 'vendor/uv/model/portable.js',
      '@modkit/uv/model/validation': 'vendor/uv/model/validation.js',
      'modkit-extension-archives/formats/zip/codec':
        'vendor/modkit-extension-archives/formats/zip/codec.js',
    })
  })
})
