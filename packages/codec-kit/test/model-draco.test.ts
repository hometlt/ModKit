import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { decodeDracoGeometry, DRACO_MALFORMED } from '../src/model/draco.js'

/* eslint-disable @typescript-eslint/no-explicit-any -- the Emscripten encoder is untyped */
const require = createRequire(import.meta.url)

/** Encode with Google's own encoder, so the decoder is checked against the reference writer. */
async function encodeCube(): Promise<{
  bytes: Uint8Array
  positions: Float32Array
  faces: Uint32Array
  joints: Uint8Array
}> {
  const draco = require('draco3d') as { createEncoderModule(options: object): Promise<any> }
  const module = await draco.createEncoderModule({})
  const positions = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ])
  const faces = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4,
    7, 0, 7, 3,
  ])
  const joints = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 1, 1, 1, 1, 2, 2, 2, 2])
  const mesh = new module.Mesh()
  const builder = new module.MeshBuilder()
  builder.AddFacesToMesh(mesh, faces.length / 3, faces)
  builder.AddFloatAttributeToMesh(mesh, module.POSITION, 8, 3, positions)
  builder.AddUInt8Attribute(mesh, module.GENERIC, 8, 2, joints)
  const encoder = new module.Encoder()
  encoder.SetEncodingMethod(module.MESH_SEQUENTIAL_ENCODING)
  const output = new module.DracoInt8Array()
  const length = encoder.EncodeMeshToDracoBuffer(mesh, output)
  const bytes = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) bytes[index] = output.GetValue(index) & 0xff
  for (const handle of [output, encoder, builder, mesh]) module.destroy(handle)
  return { bytes, positions, faces, joints }
}

describe('Draco', () => {
  it('decodes triangles and attributes in their own data types', async () => {
    const { bytes, positions, faces, joints } = await encodeCube()
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('DRACO')
    const geometry = await decodeDracoGeometry(bytes)
    expect(geometry.kind).toBe('mesh')
    expect(geometry.pointCount).toBe(8)
    expect(Array.from(geometry.indices ?? [])).toEqual(Array.from(faces))
    const position = geometry.attributes.find(attribute => attribute.type === 'position')
    expect(position).toMatchObject({ componentCount: 3, dataType: 'float32' })
    expect(Array.from(position?.data ?? [])).toEqual(Array.from(positions))
    const generic = geometry.attributes.find(attribute => attribute.type === 'generic')
    expect(generic).toMatchObject({ componentCount: 2, dataType: 'uint8' })
    expect(Array.from(generic?.data ?? [])).toEqual(Array.from(joints))
  })

  it('refuses corrupt streams and oversized geometry', async () => {
    const { bytes } = await encodeCube()
    const code = async (run: () => Promise<unknown>) => {
      try {
        await run()
      } catch (error) {
        return (error as { code?: string }).code
      }
      return undefined
    }
    const corrupt = bytes.slice(0, 20)
    expect(await code(() => decodeDracoGeometry(corrupt))).toBe(DRACO_MALFORMED)
    expect(await code(() => decodeDracoGeometry(bytes, { maxPoints: 7, maxFaces: 100 }))).toBe(
      DRACO_MALFORMED,
    )
  })
})
