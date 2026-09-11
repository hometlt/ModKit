import type { JsonObject, JsonValue } from '@modkit/sdk'
import { readUvmContainer, writeUvmContainer } from '../../../uv/src/model/container.js'
import { environmentModel } from './uvm-environment.js'

export function signedNormalRecord(value: JsonValue | undefined): JsonObject {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('missing signed normal fixture object')
  return value as JsonObject
}

/** Extend a directly authored UVM with a generic scene policy; no native model data is involved. */
export function signedNormalModel(
  options: {
    readonly first?: number
    readonly second?: number
    readonly secondMask?: boolean
    readonly secondMaskTexture?: string
    readonly modify?: (standard: JsonObject) => JsonObject
  } = {},
) {
  const source = readUvmContainer(environmentModel())
  const materials = source.document['materials']
  if (!Array.isArray(materials) || materials.length !== 1)
    throw new Error('missing signed normal fixture material')
  const material = signedNormalRecord(materials[0]),
    extensions = signedNormalRecord(material['extensions']),
    game = signedNormalRecord(extensions['UV_game_material']),
    params = signedNormalRecord(game['params']),
    renderModel = signedNormalRecord(params['renderModel']),
    original = signedNormalRecord(renderModel['standard']),
    layers = signedNormalRecord(original['layers']),
    template = signedNormalRecord(layers['diffuse'])
  const layer = (slot: string, color: readonly number[]): JsonObject => ({
    ...template,
    slot,
    uvSource: 0,
    texturePath: null,
    constantColor: { value: [...color] },
    channels: 1,
  })
  const authored: JsonObject = {
    ...original,
    normalMapFormat: 'rgb8',
    normalBlendPolicy: { mode: 'signed-two-detail', secondMask: options.secondMask ?? false },
    normalBlendFactors: Array.from({ length: 8 }, (_, index) => ({
      value: index === 0 ? (options.first ?? -1) : index === 4 ? (options.second ?? 0) : 0,
    })),
    layers: {
      ...layers,
      normal: layer('normal', [0.5, 0.5, 1, 1]),
      normalBlend1: layer('normalBlend1', [1, 0.5, 0.5, 1]),
      normalBlend2: layer('normalBlend2', [0.5, 1, 0.5, 1]),
      normalBlend1Mask: layer('normalBlend1Mask', [1, 0, 0, 0]),
      normalBlend2Mask: {
        ...layer('normalBlend2Mask', [1, 0, 0, 0]),
        ...(options.secondMaskTexture === undefined
          ? {}
          : { texturePath: options.secondMaskTexture }),
      },
    },
  }
  const standard = options.modify?.(authored) ?? authored
  const parameters: JsonObject = { ...params, renderModel: { ...renderModel, standard } }
  return {
    parameters,
    geometryBytes: source.binary.slice(),
    bytes: writeUvmContainer({
      ...source,
      document: {
        ...source.document,
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
