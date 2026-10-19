import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { SubjectOpener } from '@modkit/host'
import type { JsonObject, SceneRendererPort, SceneRenderRequest } from '@modkit/sdk'
import { readUvmContainer, writeUvmContainer } from '../../../packages/uv/src/model/container.js'
import { renderHeadless } from '../../../packages/scene/src/render/headless.js'
import { imageGalleryExtensions, renderGalleryThumbnail } from '../src/image-gallery.js'
import { MODEL_GALLERY_BUDGET } from '../src/model-gallery.js'

/** Existing skinned corpus triangle, translated under a centimetre root, with distant hidden mesh. */
function modelBytes(): Uint8Array {
  const bytes = Uint8Array.from(
    Buffer.from(
      readFileSync(
        new URL(
          '../../../packages/testkit/test/fixtures/uvm/m3-triangle.uvm.glb.b64',
          import.meta.url,
        ),
        'utf8',
      ),
      'base64',
    ),
  )
  const container = readUvmContainer(bytes)
  const doc = container.document
  const nodes = doc['nodes'] as JsonObject[]
  const meshes = doc['meshes'] as JsonObject[]
  const hiddenMesh = structuredClone(meshes[0]!)
  const hiddenPrimitive = (hiddenMesh['primitives'] as JsonObject[])[0]!
  const hiddenAttributes = hiddenPrimitive['attributes'] as JsonObject
  delete hiddenAttributes['JOINTS_0']
  delete hiddenAttributes['WEIGHTS_0']
  return writeUvmContainer({
    ...container,
    document: {
      ...doc,
      materials: [
        {
          doubleSided: true,
          pbrMetallicRoughness: { baseColorFactor: [1, 0.3, 0.1, 1], metallicFactor: 0 },
        },
      ],
      extensionsUsed: [
        ...(doc['extensionsUsed'] as string[]).filter(id => id !== 'UV_game_material'),
        'UV_game_variants',
      ],
      extensions: {
        ...(doc['extensions'] as JsonObject),
        UV_game_variants: { visibility: [{ mesh: 1, primitive: 0, value: 0 }] },
      },
      meshes: [meshes[0]!, hiddenMesh],
      nodes: [
        ...nodes,
        { name: 'native-frame', translation: [30, 70, -20], children: [0, 1] },
        { name: 'uv:units', scale: [0.01, 0.01, 0.01], children: [2, 4] },
        { name: 'hidden-far-away', mesh: 1, translation: [1000000, 0, 0] },
      ],
      scenes: [{ nodes: [3] }],
    },
  })
}

/** Minimal session boundary; interpretation and RGBA drawing below use the actual owners. */
function openedModel(bytes = modelBytes(), operation: Record<string, unknown> = {}) {
  const released: string[] = []
  const invoke = vi.fn(async () => ({ state: 'ok', output: { kind: 'bytes', value: bytes } }))
  const open: SubjectOpener = async () => ({
    snapshot: {} as never,
    session: {
      descriptor: async () => ({
        traits: [],
        dataSources: [{ contract: 'common.view/model-scene-source' }],
        operations: [
          {
            id: 'model.export-uvm',
            handlerId: 'export-native',
            state: 'available',
            mutatesSource: false,
            ...operation,
          },
        ],
      }),
      dataSource: async () => {
        throw new Error('no image source')
      },
      operations: () => ({ invoke }),
      dispose: async () => {
        released.push('session')
      },
    } as never,
  })
  return { open, invoke, released }
}

/** Renderer port seam with the product's real headless draw and observable lease ownership. */
function rendererPort(render = renderHeadless) {
  const release = vi.fn(async () => undefined)
  const requests: SceneRenderRequest[] = []
  const renderers = {
    acquire: vi.fn(async () => ({
      state: 'resolved',
      diagnostics: [],
      lease: {
        release,
        renderer: {
          rendererId: 'modkit.headless',
          render: async (request: SceneRenderRequest) => {
            requests.push(request)
            return render(request)
          },
        },
      },
    })),
  } as unknown as SceneRendererPort
  return { renderers, release, requests }
}

describe('model gallery', () => {
  it('opts models into gallery discovery without changing picture Convert suffixes', () => {
    const manifest = {
      contract: { id: 'modkit/codec-contribution' },
      spec: {
        publishesDataSources: [{ contract: 'common.view/model-scene-source' }],
        match: { extensions: ['.PREFAB'] },
      },
    }
    const inventory = {
      extensions: [
        {
          contributions: [
            { activationEligible: true, manifest },
            {
              activationEligible: false,
              manifest: {
                ...manifest,
                spec: { ...manifest.spec, match: { extensions: ['disabled'] } },
              },
            },
          ],
        },
      ],
    } as never
    expect([...imageGalleryExtensions(inventory)]).toEqual([])
    expect([...imageGalleryExtensions(inventory, true)]).toEqual(['prefab'])
  })

  it('frames a translated skinned centimetre scene without including hidden geometry', async () => {
    const { open, invoke, released } = openedModel()
    const port = rendererPort()
    const thumb = await renderGalleryThumbnail(open, 'native.prefab', 48, undefined, {
      ...port,
      budget: MODEL_GALLERY_BUDGET,
    })
    expect(thumb).toMatchObject({ width: 48, height: 48 })
    if (thumb === undefined || !('rgba' in thumb)) throw new Error('RGBA thumbnail missing')
    expect(
      thumb.rgba.filter((_, index) => index % 4 === 3 && thumb.rgba[index]! > 0).length,
    ).toBeGreaterThan(100)
    expect(port.requests[0]!.scene.primitives).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('export-native', { schemaVersion: 1 }, undefined)
    expect(port.release).toHaveBeenCalledTimes(1)
    expect(released).toEqual(['session'])
  })

  it.each([{ state: 'disabled' }, { mutatesSource: true }, { mutatesSource: undefined }])(
    'does not invoke unavailable or mutating export: %j',
    async operation => {
      const { open, invoke, released } = openedModel(undefined, operation)
      const port = rendererPort()
      expect(
        await renderGalleryThumbnail(open, 'native.prefab', 48, undefined, {
          ...port,
          budget: MODEL_GALLERY_BUDGET,
        }),
      ).toBeUndefined()
      expect(invoke).not.toHaveBeenCalled()
      expect(released).toEqual(['session'])
    },
  )

  it('releases renderer and session after a draw error, then permits the next thumbnail', async () => {
    const { open, released } = openedModel()
    const bad = rendererPort(async () => {
      throw new Error('draw failed')
    })
    await expect(
      renderGalleryThumbnail(open, 'bad.prefab', 48, undefined, {
        ...bad,
        budget: MODEL_GALLERY_BUDGET,
      }),
    ).rejects.toThrow('draw failed')
    expect(bad.release).toHaveBeenCalledTimes(1)
    const good = rendererPort()
    expect(
      await renderGalleryThumbnail(open, 'next.prefab', 48, undefined, {
        ...good,
        budget: MODEL_GALLERY_BUDGET,
      }),
    ).toMatchObject({ width: 48 })
    expect(released).toEqual(['session', 'session'])
  })

  it('propagates cancellation during provider acquisition and releases the acquired lease', async () => {
    const { open, released } = openedModel()
    const controller = new AbortController()
    const release = vi.fn(async () => undefined)
    const render = vi.fn()
    const renderers = {
      acquire: async () => {
        controller.abort()
        return { state: 'resolved', lease: { release, renderer: { render } } }
      },
    } as unknown as SceneRendererPort
    await expect(
      renderGalleryThumbnail(open, 'native.prefab', 48, controller.signal, {
        renderers,
        budget: MODEL_GALLERY_BUDGET,
      }),
    ).rejects.toThrow()
    expect(render).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
    expect(released).toEqual(['session'])
  })

  it('keeps image pixels ahead of model export on a subject with both facets', async () => {
    const model = openedModel()
    const original = await model.open('mixed.asset')
    const open: SubjectOpener = async () => ({
      ...original,
      session: {
        ...original.session,
        dataSource: async (contract: string) => {
          if (contract !== 'common.view/raster-image-source') throw new Error('no source')
          return {
            release: async () => undefined,
            value: {
              info: async () => ({ decodedAccess: true, width: 1, height: 1, mipLevels: 1 }),
              readRegion: async () => ({
                width: 1,
                height: 1,
                rowStride: 4,
                pixelFormat: 'rgba8',
                pixels: new Uint8Array([1, 2, 3, 255]),
              }),
            },
          }
        },
      } as never,
    })
    const port = rendererPort()
    expect(
      await renderGalleryThumbnail(open, 'mixed.asset', 48, undefined, {
        ...port,
        budget: MODEL_GALLERY_BUDGET,
      }),
    ).toEqual({ width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 255]) })
    expect(model.invoke).not.toHaveBeenCalled()
    expect(port.renderers.acquire).not.toHaveBeenCalled()
    expect(model.released).toEqual(['session'])
  })

  it('releases the session when export fails or a renderer cannot resolve', async () => {
    const failed = openedModel()
    failed.invoke.mockRejectedValueOnce(new Error('export failed'))
    const port = rendererPort()
    await expect(
      renderGalleryThumbnail(failed.open, 'failed.prefab', 48, undefined, {
        ...port,
        budget: MODEL_GALLERY_BUDGET,
      }),
    ).rejects.toThrow('export failed')
    expect(failed.released).toEqual(['session'])
    expect(port.renderers.acquire).not.toHaveBeenCalled()
    const unavailable = openedModel()
    const renderers = {
      acquire: async () => ({ state: 'unresolved', diagnostics: [] }),
    } as unknown as SceneRendererPort
    expect(
      await renderGalleryThumbnail(unavailable.open, 'unavailable.prefab', 48, undefined, {
        renderers,
        budget: MODEL_GALLERY_BUDGET,
      }),
    ).toBeUndefined()
    expect(unavailable.released).toEqual(['session'])
  })

  it('refuses a malformed renderer frame and still releases its lease and session', async () => {
    const model = openedModel()
    const port = rendererPort(async request => ({
      ...(await renderHeadless(request)),
      rgba: new Uint8Array(1),
    }))
    await expect(
      renderGalleryThumbnail(model.open, 'bad-frame.prefab', 48, undefined, {
        ...port,
        budget: MODEL_GALLERY_BUDGET,
      }),
    ).rejects.toThrow('invalid RGBA frame')
    expect(port.release).toHaveBeenCalledTimes(1)
    expect(model.released).toEqual(['session'])
  })
})
