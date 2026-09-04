import { describe, expect, it } from 'vitest'
import {
  ModelCodecRegistry,
  listRenderModelTextureRequests,
  type ModelCodec,
  type RenderModel,
} from '../../../src/legacy-model-support.js'

function makeCodec(id: string, extensions: string[], format = 'unknown'): ModelCodec {
  return {
    id,
    format: format as ModelCodec['format'],
    extensions,
    capabilities: { skeleton: false, animations: false, effects: false },
    canParse: () => false,
    parse: () => {
      throw new Error('not implemented')
    },
  }
}

function emptyModel(): RenderModel {
  return {
    format: 'unknown',
    meshes: [],
    skeleton: { bones: [] },
    materials: [],
    animations: [],
    bounds: null,
    effects: { particles: [], ribbons: [] },
  }
}

describe('ModelCodecRegistry', () => {
  it('rejects duplicate registrations', () => {
    const registry = new ModelCodecRegistry()
    registry.register({ id: 'm3', extensions: ['.m3'], load: () => makeCodec('m3', ['.m3'], 'm3') })
    expect(() =>
      registry.register({
        id: 'm3',
        extensions: ['.m3'],
        load: () => makeCodec('m3', ['.m3'], 'm3'),
      }),
    ).toThrow(/already registered/)
  })

  it('resolves by extension when unambiguous', () => {
    const registry = new ModelCodecRegistry()
    registry.register({
      id: 'obj',
      extensions: ['.obj'],
      load: () => makeCodec('obj', ['.obj'], 'obj'),
    })
    const registration = registry.resolveRegistration(new Uint8Array(), 'models/crate.obj')
    expect(registration?.id).toBe('obj')
  })

  it('falls back to magic sniff when the extension is unknown', () => {
    const registry = new ModelCodecRegistry()
    registry.register({
      id: 'm3',
      extensions: ['.m3'],
      sniff: header => new TextDecoder('ascii').decode(header.subarray(0, 4)) === '43DM',
      load: () => makeCodec('m3', ['.m3'], 'm3'),
    })
    const header = new TextEncoder().encode('43DM....')
    expect(registry.resolveRegistration(header, 'weird-name.bin')?.id).toBe('m3')
    expect(
      registry.resolveRegistration(new TextEncoder().encode('ZZZZ'), 'weird-name.bin'),
    ).toBeNull()
  })

  it('disambiguates shared extensions by sniff', () => {
    const registry = new ModelCodecRegistry()
    registry.register({
      id: 'a',
      extensions: ['.mdl'],
      sniff: header => header[0] === 0x41,
      load: () => makeCodec('a', ['.mdl']),
    })
    registry.register({
      id: 'b',
      extensions: ['.mdl'],
      sniff: header => header[0] === 0x42,
      load: () => makeCodec('b', ['.mdl']),
    })
    expect(registry.resolveRegistration(new Uint8Array([0x42]), 'x.mdl')?.id).toBe('b')
    expect(registry.resolveRegistration(new Uint8Array([0x41]), 'x.mdl')?.id).toBe('a')
  })

  it('lazily loads codecs exactly once', async () => {
    const registry = new ModelCodecRegistry()
    let loadCount = 0
    registry.register({
      id: 'm3',
      extensions: ['.m3'],
      load: () => {
        loadCount += 1
        return makeCodec('m3', ['.m3'], 'm3')
      },
    })
    const [first, second] = await Promise.all([registry.load('m3'), registry.load('m3')])
    expect(first).toBe(second)
    expect(loadCount).toBe(1)
  })

  it('collects the union of registered extensions', () => {
    const registry = new ModelCodecRegistry()
    registry.register({ id: 'm3', extensions: ['.m3'], load: () => makeCodec('m3', ['.m3'], 'm3') })
    registry.register({
      id: 'mdx',
      extensions: ['.mdx', '.mdl'],
      load: () => makeCodec('mdx', ['.mdx', '.mdl'], 'mdx'),
    })
    expect(registry.extensions().sort()).toEqual(['.m3', '.mdl', '.mdx'])
  })
})

describe('listRenderModelTextureRequests', () => {
  it('walks legacy layers and standard material slots without duplicates', () => {
    const model = emptyModel()
    model.materials.push({
      name: 'mat',
      layers: [{ label: 'diffuse', path: 'Assets\\Textures\\a.dds' }],
      standard: {
        layers: {
          diffuse: {
            slot: 'diffuse',
            texturePath: 'Assets\\Textures\\a.dds',
            uvSource: 0,
            channels: 1,
            op: 2,
            teamColorMode: 0,
            invert: false,
            clampResult: false,
            wrapX: true,
            wrapY: true,
          },
          normal: {
            slot: 'normal',
            texturePath: 'Assets\\Textures\\a_normal.dds',
            uvSource: 0,
            channels: 1,
            op: 2,
            teamColorMode: 0,
            invert: false,
            clampResult: false,
            wrapX: true,
            wrapY: true,
          },
        },
        blendMode: 0,
        priority: 0,
        specularity: 20,
        specMult: 1,
        emisMult: 1,
        specMode: 0,
        alphaTestThreshold: 0,
        twoSided: false,
        unshaded: false,
        doubleLambert: false,
        clampOutput: false,
        usesVertexColor: false,
        usesVertexAlpha: false,
      },
    })
    const requests = listRenderModelTextureRequests(model)
    expect(requests).toHaveLength(2)
    expect(requests.map(request => request.slot).sort()).toEqual(['diffuse', 'normal'])
  })
})
