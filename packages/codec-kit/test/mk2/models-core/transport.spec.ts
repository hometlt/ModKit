import { describe, expect, it } from 'vitest'
import { deserializeRenderModel, serializeRenderModel, type RenderModel } from '../../../src/legacy-model-support.js'

function sampleModel(): RenderModel {
  return {
    format: 'm3',
    meshes: [
      {
        name: 'M3_Region_0',
        materialIndex: 0,
        positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        tangents: Float32Array.from([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]),
        uvs: Float32Array.from([0, 0, 1, 0, 0, 1]),
        indices: Uint16Array.from([0, 1, 2]),
        boneIndices: Uint16Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        boneWeights: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      },
    ],
    skeleton: {
      bones: [
        {
          index: 0,
          name: 'Root',
          parentIndex: -1,
          inverseBindMatrix: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3, 0, 0, 1]),
        },
      ],
    },
    materials: [
      {
        name: 'Mat',
        layers: [{ label: 'diffuse', path: 'Assets\\a.dds' }],
      },
    ],
    animations: [
      {
        name: 'Stand',
        durationSeconds: 1,
        looping: true,
        nodeTracks: [
          {
            boneIndex: 0,
            translation: {
              lineType: 1,
              globalSeqId: null,
              keys: [{ frame: 0, vector: [3, 0, 0] }],
            },
          },
        ],
      } as RenderModel['animations'][number],
    ],
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 0 }, radius: 1 },
    effects: { particles: [], ribbons: [] },
    metadata: { mdVersion: 34 },
  }
}

function payloadByteLength(blob: Uint8Array): number {
  const jsonLength = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getUint32(4, true)
  const unalignedDataStart = 8 + jsonLength
  const dataStart = unalignedDataStart + ((8 - (unalignedDataStart % 8)) % 8)
  return blob.byteLength - dataStart
}

function firstMesh(model: RenderModel): RenderModel['meshes'][number] {
  const mesh = model.meshes[0]
  if (!mesh) throw new Error('test model has no mesh')
  return mesh
}

describe('RenderModel binary transport', () => {
  it('round-trips every buffer and plain field exactly', () => {
    const model = sampleModel()
    const blob = serializeRenderModel(model)
    const restored = deserializeRenderModel(blob)

    expect(restored.format).toBe('m3')
    expect(restored.materials[0]!.layers[0]!.path).toBe('Assets\\a.dds')
    expect(restored.metadata?.['mdVersion']).toBe(34)
    expect(restored.bounds).toEqual(model.bounds)

    const mesh = restored.meshes[0]!
    expect(mesh.positions).toBeInstanceOf(Float32Array)
    expect([...mesh.positions]).toEqual([...model.meshes[0]!.positions])
    expect(mesh.indices).toBeInstanceOf(Uint16Array)
    expect([...mesh.indices]).toEqual([0, 1, 2])
    expect([...mesh.tangents!]).toEqual([...model.meshes[0]!.tangents!])
    expect([...restored.skeleton.bones[0]!.inverseBindMatrix!]).toEqual([
      ...model.skeleton.bones[0]!.inverseBindMatrix!,
    ])
    // Track data (plain arrays) survives untouched.
    const seq = restored.animations[0] as unknown as {
      nodeTracks: { translation?: { keys: { vector: number[] }[] } }[]
    }
    expect(seq.nodeTracks[0]!.translation!.keys[0]!.vector).toEqual([3, 0, 0])
  })

  it('deserializes views on the blob without copying when aligned', () => {
    const blob = serializeRenderModel(sampleModel())
    const restored = deserializeRenderModel(blob)
    expect(restored.meshes[0]!.positions.buffer).toBe(blob.buffer)
  })

  it('packs repeated references to one typed-array view only once', () => {
    const shared = Float32Array.from([0, 0, 1, 0, 1, 0, 1, 0, 0])
    const sharedModel = sampleModel()
    firstMesh(sharedModel).positions = shared
    firstMesh(sharedModel).normals = shared

    const distinctModel = sampleModel()
    firstMesh(distinctModel).positions = shared
    firstMesh(distinctModel).normals = shared.slice()

    const sharedBlob = serializeRenderModel(sharedModel)
    const distinctBlob = serializeRenderModel(distinctModel)
    expect(payloadByteLength(distinctBlob) - payloadByteLength(sharedBlob)).toBe(shared.byteLength)
    expect(sharedBlob.byteLength).toBeLessThan(distinctBlob.byteLength)

    const restored = deserializeRenderModel(sharedBlob)
    const restoredMesh = firstMesh(restored)
    expect([...restoredMesh.positions]).toEqual([...shared])
    expect([...(restoredMesh.normals ?? [])]).toEqual([...shared])
    expect(restoredMesh.positions).toBe(restoredMesh.normals)

    const shifted = new Uint8Array(sharedBlob.byteLength + 1)
    shifted.set(sharedBlob, 1)
    const restoredFromMisalignedView = deserializeRenderModel(shifted.subarray(1))
    const restoredMisalignedMesh = firstMesh(restoredFromMisalignedView)
    expect(restoredMisalignedMesh.positions).toBe(restoredMisalignedMesh.normals)
  })

  it('packs equivalent views of the same buffer range and type only once', () => {
    const buffer = new ArrayBuffer(Float32Array.BYTES_PER_ELEMENT * 11)
    const first = new Float32Array(buffer, Float32Array.BYTES_PER_ELEMENT, 9)
    first.set([0, 0, 1, 0, 1, 0, 1, 0, 0])
    const equivalent = new Float32Array(buffer, Float32Array.BYTES_PER_ELEMENT, 9)
    expect(equivalent).not.toBe(first)

    const model = sampleModel()
    firstMesh(model).positions = first
    firstMesh(model).normals = equivalent
    const blob = serializeRenderModel(model)

    const distinctModel = sampleModel()
    firstMesh(distinctModel).positions = first
    firstMesh(distinctModel).normals = equivalent.slice()
    const distinctBlob = serializeRenderModel(distinctModel)
    expect(payloadByteLength(distinctBlob) - payloadByteLength(blob)).toBe(first.byteLength)

    const restored = deserializeRenderModel(blob)
    const restoredMesh = firstMesh(restored)
    restoredMesh.positions[0] = 42
    expect(restoredMesh.normals?.[0]).toBe(42)
  })

  it('copies when the received view is not element-aligned', () => {
    const blob = serializeRenderModel(sampleModel())
    // Simulate a mis-aligned slice arriving from a message channel: place the
    // blob at odd offset inside a larger buffer.
    const shifted = new Uint8Array(blob.byteLength + 1)
    shifted.set(blob, 1)
    const view = shifted.subarray(1)
    const restored = deserializeRenderModel(view)
    expect([...restored.meshes[0]!.positions]).toEqual([...sampleModel().meshes[0]!.positions])
  })

  it('rejects foreign blobs', () => {
    expect(() => deserializeRenderModel(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(
      /bad magic/,
    )
    expect(() => deserializeRenderModel(new Uint8Array(2))).toThrow(/too small/)
  })
})
