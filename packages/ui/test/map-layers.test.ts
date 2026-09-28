import { describe, expect, it } from 'vitest'
import { encodeGreyPng, decodePngSamples } from '@modkit/codec-kit/raster'
import type { AnyDescriptor, AssetEditPlan, OperationSession } from '@modkit/sdk'
import type { MapLayerDescriptor } from '@modkit/sdk/maps'
import { exportMapLayerPng, importMapLayerPng, mapLayerPicture, mapLayerValue } from '../src/map-layers/index.js'

/*
 * The map-layer panel owns the image and nothing about a game: a codec's numbers go out as a grey
 * PNG through the host's writer, and a PNG comes back as numbers the codec turns into a plan.
 */
const layer: MapLayerDescriptor = {
  id: 'height',
  label: 'Height',
  meaning: 'height',
  width: 2,
  height: 2,
  minimum: 0,
  maximum: 65535,
  editable: true,
}
const descriptor = {
  operations: [
    { id: 'map.layer-read', handlerId: 'read', state: 'available' },
    { id: 'map.layer-write', handlerId: 'write', state: 'available' },
  ],
} as unknown as AnyDescriptor

function session(values: number[]) {
  const calls: { handler: string; input: unknown }[] = []
  const operations = {
    async invoke(handler: string, input: unknown) {
      calls.push({ handler, input })
      return handler === 'read'
        ? { state: 'ok', output: { kind: 'json', value: { layer: 'height', width: 2, height: 2, values } } }
        : { state: 'ok', output: { kind: 'edit-plan', plan: { planId: 'layer-plan' } } }
    },
  } as unknown as OperationSession
  return { operations, calls }
}

describe('map layers as images', () => {
  it('exports a layer as a 16-bit grey PNG through the host writer', async () => {
    const { operations } = session([1, 2, 300, 65535])
    const written: { name: string; bytes: Uint8Array }[] = []
    const name = await exportMapLayerPng({
      descriptor,
      operations,
      layer,
      baseName: 'Arena',
      exportBytes: async files => {
        written.push(...files)
        return { state: 'written', names: files.map(file => file.name) }
      },
    })
    expect(name).toBe('Arena.height.png')
    const image = await decodePngSamples(written[0]!.bytes)
    expect(image).toMatchObject({ width: 2, height: 2, bitDepth: 16, channels: 1 })
    expect([...image.samples]).toEqual([1, 2, 300, 65535])
  })

  it('imports a PNG as the codec write and commits the plan it answers', async () => {
    const { operations, calls } = session([])
    const committed: AssetEditPlan[] = []
    const message = await importMapLayerPng({
      descriptor,
      operations,
      layer,
      png: await encodeGreyPng(2, 2, [5, 6, 7, 8], 16),
      applyPlan: async plan => {
        committed.push(plan)
        return { failed: false, message: 'saved' }
      },
    })
    expect(message).toBe('saved')
    expect(calls).toEqual([{ handler: 'write', input: { layer: 'height', width: 2, height: 2, values: [5, 6, 7, 8] } }])
    expect(committed).toEqual([{ planId: 'layer-plan' }])
  })

  it('refuses an image of another size before the codec is asked', async () => {
    const { operations, calls } = session([])
    await expect(
      importMapLayerPng({
        descriptor,
        operations,
        layer,
        png: await encodeGreyPng(3, 1, [0, 0, 0], 16),
        applyPlan: async () => ({ failed: false, message: '' }),
      }),
    ).rejects.toThrow(/3x1/)
    expect(calls).toEqual([])
  })
  it('draws amounts as a grey ramp and classes in a colour each', () => {
    const ramp = mapLayerPicture({ ...layer, width: 3, height: 1, maximum: 100 }, { layer: 'height', width: 3, height: 1, values: [0, 100, 250] })
    // a sample past the declared maximum is drawn at the maximum
    expect([...ramp.rgba]).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255])
    expect(ramp.classes).toEqual([])
    const pathing: MapLayerDescriptor = { ...layer, id: 'pathing', meaning: 'pathing', width: 3, height: 1, maximum: 2 }
    const classes = mapLayerPicture(pathing, { layer: 'pathing', width: 3, height: 1, values: [2, 0, 2] })
    expect(classes.classes).toEqual([
      { value: 0, colour: 'rgb(32 32 32)' },
      { value: 2, colour: 'rgb(60 180 75)' },
    ])
    expect([...classes.rgba.slice(0, 8)]).toEqual([60, 180, 75, 255, 32, 32, 32, 255])
    // more values than colours: amounts after all
    const many = mapLayerPicture({ ...pathing, maximum: 255 }, { layer: 'pathing', width: 3, height: 1, values: [0, 255, 0] })
    expect(many.classes).toEqual([])
  })

  it('names a sample by the world value the layer declares', () => {
    expect(mapLayerValue(layer, 5)).toBe('5')
    expect(mapLayerValue({ ...layer, valueScale: 0.25, valueOffset: -16, unit: 'm' }, 72)).toBe('2 m')
  })
})
