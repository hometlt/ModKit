import type { JsonObject, RasterResourcePort } from '@modkit/sdk'
import type {
  SceneRendererDiagnostic,
  SceneRendererMaterial,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import { createStandardMaterialPrograms, RENDER_MATERIAL_SHADER } from '../materials/index.js'
import { field, object, string } from './values.js'
import { uvmImageTexels } from './images.js'

/**
 * A material whose only texture statement is its neutral layer list.
 *
 * A publisher that does not carry StarCraft II's standard-material payload still says which
 * logical resource each layer wants, in the bounded native envelope every model facet writes.
 * Warcraft III and Diablo III materials are exactly that, and without this they drew flat: the
 * renderer had no route from a layer to a texture except the StarCraft II shader.
 *
 * This shader identity is the renderer's own view of the document, assembled here. Nothing is
 * written back, and no material model is claimed beyond "these layers name these resources".
 */
export const MATERIAL_LAYERS_SHADER = 'modkit.material-layers.v1'

function layerList(material: JsonObject): { label: string; path: string }[] {
  const extras = field(material['extras'], 'modkit')
  const native = extras === undefined ? undefined : field(extras, 'material')
  const fields = native === undefined ? undefined : field(native, 'fields')
  const layers = fields === undefined ? undefined : field(fields, 'layers')
  if (!Array.isArray(layers)) return []
  const out: { label: string; path: string }[] = []
  for (const entry of layers) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as JsonObject
    const path = record['resourceId']
    const slot = record['slot']
    if (typeof path !== 'string' || path === '') continue
    out.push({ label: typeof slot === 'string' && slot !== '' ? slot : 'diffuse', path })
  }
  return out
}

export function uvmMaterialShader(material: JsonObject): SceneRendererMaterial['shader'] {
  const extension = field(material['extensions'], 'UV_game_material')
  if (extension === undefined) {
    const layers = layerList(material)
    return layers.length === 0
      ? undefined
      : { id: MATERIAL_LAYERS_SHADER, parameters: { renderModel: { layers } } }
  }
  const data = object(extension, 'game material')
  const parameters = object(data['params'] ?? {}, 'game material parameters')
  return {
    id: string(data['shader'], 'game material shader'),
    parameters: withLayerList(parameters, material),
  }
}

/**
 * A game material keeps its own parameters, and gains the layer list it left out.
 *
 * The renderer's only route from a layer to a texture is `renderModel.layers`. A publisher that
 * declares a game shader but states its layers only in the neutral envelope beside it - Warzone's
 * PIE does exactly that - used to draw flat white: declaring the shader took its parameters
 * verbatim and dropped the list the same material had already written down.
 *
 * The list comes from that material, so filling an absent field with it invents nothing. A
 * publisher that states `renderModel.layers` itself keeps what it wrote, untouched.
 */
function withLayerList(parameters: JsonObject, material: JsonObject): JsonObject {
  const renderModel = field(parameters, 'renderModel')
  if (renderModel !== undefined && field(renderModel, 'layers') !== undefined) return parameters
  const layers = layerList(material)
  if (layers.length === 0) return parameters
  return {
    ...parameters,
    renderModel: {
      ...(renderModel === undefined ? {} : object(renderModel, 'render model parameters')),
      layers,
    },
  }
}

/** The resource ids a neutral layer list names, in declaration order. */
export function materialLayerResources(
  shader: NonNullable<SceneRendererMaterial['shader']>,
): readonly string[] {
  const params = shader.parameters as
    | { readonly renderModel?: { readonly layers?: readonly { readonly path?: string }[] } }
    | undefined
  const seen = new Set<string>()
  for (const layer of params?.renderModel?.layers ?? [])
    if (typeof layer.path === 'string' && layer.path !== '') seen.add(layer.path)
  return [...seen]
}

/** Resource enumeration is synchronous so all material inputs are captured before host awaits. */
export function uvmMaterialResources(
  materials: readonly SceneRendererMaterial[],
  maxBytes: number,
  signal?: AbortSignal,
): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, readonly string[]>()
  for (const material of materials)
    if (material.simpleEffect !== undefined)
      result.set(
        material.id,
        material.simpleEffect.textureResource === undefined
          ? []
          : [material.simpleEffect.textureResource],
      )
    else if (material.shader?.id === RENDER_MATERIAL_SHADER)
      result.set(
        material.id,
        createStandardMaterialPrograms(material.shader.parameters, {
          budget: { maxDepth: 128, maxNodes: 1_000_000, maxBytes },
          ...(signal === undefined ? {} : { signal }),
        }).resources,
      )
    else if (material.shader?.id === MATERIAL_LAYERS_SHADER)
      result.set(material.id, materialLayerResources(material.shader))
  return result
}

/** Resolve each shared resource once through the host's image capabilities, including all cube
 * faces. Native filenames never give the renderer filesystem or container authority. */
export async function acquireUvmMaterialTextures(
  resources: ReadonlyMap<string, readonly string[]>,
  port: RasterResourcePort | undefined,
  maxBytes: number,
  diagnostics: SceneRendererDiagnostic[],
  signal?: AbortSignal,
) {
  const textures: SceneRendererTexture[] = [],
    textureIds = new Map<string, string>()
  let remaining = maxBytes
  let resourceIndex = 0
  for (const path of new Set([...resources.values()].flat())) {
    signal?.throwIfAborted()
    if (port === undefined) continue
    const id = `uvm-material-resource-${resourceIndex++}`
    const result = await port.read(
      {
        kind: 'logical',
        requirement: {
          id,
          logicalId: path,
          role: 'texture',
          scopes: [
            'sibling-directory',
            'workspace-dependency-layer',
            'current-mount',
            'enclosing-container',
          ],
        },
        maxBytes: remaining,
        selection: { face: 'all' },
      },
      signal,
    )
    signal?.throwIfAborted()
    for (const item of result.diagnostics)
      diagnostics.push({
        severity: item.severity === 'hint' ? 'information' : item.severity,
        code: item.code,
        message: item.message,
      })
    if (result.state === 'unresolved') continue
    if ([result.info.layers, result.info.depth, result.info.frames].some(count => (count ?? 1) > 1))
      diagnostics.push({
        severity: 'warning',
        code: 'common.uvm/material-image-first-surface',
        message: `${path}: the material currently samples frame 0, layer 0 and slice 0; array, volume and animated image selection is not implemented.`,
      })
    try {
      const cube = result.info.faces === 6
      if (result.info.faces !== 1 && !cube)
        throw new TypeError('material image must contain one plane or six complete cube faces')
      if (cube && result.info.width !== result.info.height)
        throw new TypeError('cube faces must be square')
      const surfaces =
        result.state === 'decoded-surfaces'
          ? result.surfaces
          : [
              {
                subresource: { frame: 0, mipLevel: 0, layer: 0, face: 0, slice: 0 },
                region: result.region,
              },
            ]
      if (surfaces.length !== result.info.faces)
        throw new TypeError('raster port did not return every requested face')
      if (result.info.width * result.info.height * 4 * surfaces.length > remaining)
        throw new RangeError('decoded material textures exceed budget')
      const faceBytes = result.info.width * result.info.height * 4
      const rgba = new Uint8Array(faceBytes * surfaces.length)
      for (const [face, surface] of surfaces.entries()) {
        const selected = surface.subresource
        if (
          selected.face !== face ||
          selected.mipLevel !== 0 ||
          selected.frame !== 0 ||
          selected.layer !== 0 ||
          selected.slice !== 0
        )
          throw new TypeError('raster port returned a different subresource selection')
        rgba.set(
          uvmImageTexels(
            { ...result, state: 'decoded', region: surface.region },
            { channels: 'data' },
          ),
          face * faceBytes,
        )
      }
      remaining -= rgba.length
      textureIds.set(path, id)
      textures.push({
        id,
        width: result.info.width,
        height: result.info.height,
        rgba,
        ...(cube ? { dimension: 'cube' as const } : {}),
        ...(result.info.channelLayout === undefined
          ? {}
          : { channelLayout: result.info.channelLayout }),
        ...(result.info.compression === undefined ? {} : { compression: result.info.compression }),
      })
    } catch (error) {
      diagnostics.push({
        severity: 'warning',
        code: 'common.uvm/material-image-unrendered',
        message: `${path}: ${error instanceof Error ? error.message : 'Invalid decoded image'}`,
      })
    }
  }
  return {
    textures,
    bindings: (materialId: string) =>
      (resources.get(materialId) ?? []).flatMap(resourceId => {
        const textureId = textureIds.get(resourceId)
        return textureId === undefined ? [] : [{ resourceId, textureId }]
      }),
  }
}
