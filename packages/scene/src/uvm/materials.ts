import type { JsonObject, RasterResourcePort } from '@modkit/sdk'
import type {
  SceneRendererDiagnostic,
  SceneRendererMaterial,
  SceneRendererTexture,
} from '@modkit/sdk/renderer'
import { createStandardMaterialPrograms, RENDER_MATERIAL_SHADER } from '../materials/index.js'
import { field, object, string } from './values.js'
import { uvmImageTexels } from './images.js'

export function uvmMaterialShader(material: JsonObject): SceneRendererMaterial['shader'] {
  const extension = field(material['extensions'], 'UV_game_material')
  if (extension === undefined) return undefined
  const data = object(extension, 'game material')
  return {
    id: string(data['shader'], 'game material shader'),
    parameters: object(data['params'] ?? {}, 'game material parameters'),
  }
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
