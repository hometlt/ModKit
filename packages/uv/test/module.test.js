import { describe, expect, it } from 'vitest'

import { materializeUvmCore, materializeUvtCore } from '../src/index.js'
import * as modelMaterializer from '../src/model/materializer.js'
import { uvModule } from '../src/module.js'
import * as textureMaterializer from '../src/texture/materializer.js'

describe('@modkit/uv built-in module', () => {
  it('keeps the confirmed materializer and writer identities behind the built-in coordinate', () => {
    expect(uvModule.kind).toBe('builtin')
    expect(uvModule.coordinate).toBe('modkit/uv')
    expect(uvModule.input.source).toBe('builtin:modkit/uv')
    expect(uvModule.excluded).toEqual([])

    const identifiers = [...uvModule.input.documents.values()].map(document => document.id).sort()
    expect(identifiers).toEqual([
      'modkit/uv-model-materializer-contract',
      'modkit/uv-texture-materializer-contract',
      'modkit/uvm-materializer',
      'modkit/uvm-writer',
      'modkit/uvt-materializer',
      'modkit/uvt-writer',
    ])
    expect(uvModule.moduleEntries).toHaveLength(4)
  })

  it('keeps the public package entry and focused subpaths on the same implementations', () => {
    expect(materializeUvmCore).toBe(modelMaterializer.materializeUvmCore)
    expect(materializeUvtCore).toBe(textureMaterializer.materializeUvtCore)
  })
})
