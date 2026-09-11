import type { JsonObject, JsonValue } from '@modkit/sdk'
import { appendUvmAccessors } from '../../../uv/src/model/accessor-write.js'
import { readUvmContainer, writeUvmContainer } from '../../../uv/src/model/container.js'
import { environmentModel } from './uvm-environment.js'

function record(value: JsonValue | undefined): JsonObject {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('missing tangent generation fixture object')
  return value as JsonObject
}

export interface TangentGenerationFixtureOptions {
  readonly uv1?: readonly number[]
  readonly authoredTangent?: readonly [number, number, number, number]
  /** JsonValue intentionally permits malformed policies for public-operation refusal tests. */
  readonly tangentGeneration?: JsonValue
}

/** Pure UVM: append ordinary glTF accessors, then describe a generic scene material policy. */
export function tangentGenerationModel(options: TangentGenerationFixtureOptions = {}) {
  let source = readUvmContainer(environmentModel())
  const meshes = source.document['meshes'],
    materials = source.document['materials']
  if (
    !Array.isArray(meshes) ||
    meshes.length !== 1 ||
    !Array.isArray(materials) ||
    materials.length !== 1
  )
    throw new Error('missing tangent generation fixture scene')
  const mesh = record(meshes[0]),
    primitives = mesh['primitives']
  if (!Array.isArray(primitives) || primitives.length !== 1)
    throw new Error('missing tangent generation fixture primitive')
  const primitive = record(primitives[0])
  const attributes = { ...record(primitive['attributes']) }
  if (options.uv1 !== undefined) {
    if (options.uv1.length !== 6) throw new Error('fixture UV1 requires three coordinates')
    const appended = appendUvmAccessors(source, [
      { type: 'VEC2', values: Float32Array.from(options.uv1) },
    ])
    const index = appended.accessors[0]
    if (index === undefined) throw new Error('missing UV1 accessor')
    attributes['TEXCOORD_1'] = index
    source = appended.container
  }
  if (options.authoredTangent !== undefined) {
    const appended = appendUvmAccessors(source, [
      {
        type: 'VEC4',
        values: Float32Array.from([
          ...options.authoredTangent,
          ...options.authoredTangent,
          ...options.authoredTangent,
        ]),
      },
    ])
    const index = appended.accessors[0]
    if (index === undefined) throw new Error('missing authored tangent accessor')
    attributes['TANGENT'] = index
    source = appended.container
  }
  const material = record(materials[0]),
    extensions = record(material['extensions']),
    game = record(extensions['UV_game_material']),
    params = record(game['params']),
    renderModel = record(params['renderModel']),
    original = record(renderModel['standard']),
    layers = record(original['layers']),
    template = record(layers['diffuse'])
  const parameters: JsonObject = {
    ...params,
    renderModel: {
      ...renderModel,
      standard: {
        ...original,
        normalMapFormat: 'rgb8',
        ...(options.tangentGeneration === undefined
          ? {}
          : { tangentGeneration: options.tangentGeneration }),
        layers: {
          ...layers,
          normal: {
            ...template,
            slot: 'normal',
            uvSource: 0,
            texturePath: null,
            channels: 1,
            // Tangent-space +X makes the chosen world tangent directly observable as a cube face.
            constantColor: { value: [1, 0.5, 0.5, 1] },
          },
        },
      },
    },
  }
  return {
    parameters,
    bytes: writeUvmContainer({
      ...source,
      document: {
        ...source.document,
        meshes: [{ ...mesh, primitives: [{ ...primitive, attributes }] }],
        materials: [
          {
            ...material,
            extensions: { ...extensions, UV_game_material: { ...game, params: parameters } },
          },
        ],
      },
    }),
  }
}
