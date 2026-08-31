import { describe, expect, it } from 'vitest'

import { materializeUvmCore, materializeUvtCore } from '../src/index.js'
import * as modelMaterializer from '../src/model/materializer.js'
import { uvModule } from '../src/module.js'
import * as textureMaterializer from '../src/texture/materializer.js'

describe('@modkitx-x3/uv built-in module', () => {
  it('keeps the confirmed materializer and writer identities behind the built-in coordinate', () => {
    expect(uvModule.kind).toBe('builtin')
    expect(uvModule.coordinate).toBe('org.modkitx/uv')
    expect(uvModule.input.source).toBe('builtin:org.modkitx/uv')
    expect(uvModule.excluded).toEqual([])

    const identifiers = [...uvModule.input.documents.values()].map(document => document.id).sort()
    expect(identifiers).toEqual([
      'org.modkitx/uv-model-materializer-contract',
      'org.modkitx/uv-texture-materializer-contract',
      'org.modkitx/uvm-materializer',
      'org.modkitx/uvm-writer',
      'org.modkitx/uvt-materializer',
      'org.modkitx/uvt-writer',
    ])
    expect(uvModule.moduleEntries).toHaveLength(4)
  })

  it('keeps the public package entry and focused subpaths on the same implementations', () => {
    expect(materializeUvmCore).toBe(modelMaterializer.materializeUvmCore)
    expect(materializeUvtCore).toBe(textureMaterializer.materializeUvtCore)
  })
})
