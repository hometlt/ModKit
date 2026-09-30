import type { JsonObject } from '@modkit/sdk'
import { array, object, nonBlank, integer } from './values.js'
import { validateSocketMetadata, validateCollisionMetadata } from './spatial.js'
import { validateEffectsMetadata } from './effects.js'
import { validateAnimationPointers } from './animation.js'
import { validateUvmAnimationClips } from '../animation-clips.js'
import { validateGameMaterialMetadata, validateTeamColorMetadata } from './materials.js'
import { validateTextureColorKeys } from './textures.js'

export { readUvmTextureColorKeys, type UvmTextureColorKey } from './textures.js'

export interface UvmValidationOptions {
  /** Omit only for JSON-only probes. */
  readonly binaryByteLength?: number
  readonly signal?: AbortSignal
}

/** Validate UVM/core identity and supported extension metadata on an already bounded JSON document. */

export function validateUvmDocument(
  document: JsonObject,
  options: UvmValidationOptions = {},
): void {
  const { binaryByteLength, signal } = options
  signal?.throwIfAborted()
  if (binaryByteLength !== undefined && (!integer(binaryByteLength) || binaryByteLength < 0))
    throw new TypeError('invalid UVM binary byte length')
  const asset = object(document['asset'], 'UVM asset')
  if (asset['version'] !== '2.0') throw new TypeError('UVM asset.version must be 2.0')
  const uv = object(object(asset['extras'], 'UVM asset.extras')['uv'], 'UVM profile marker')
  if (uv['format'] !== 'UVM' || uv['version'] !== '1.0' || uv['profile'] !== 'core') {
    throw new TypeError('asset.extras.uv must identify the UVM/core 1.0 profile')
  }
  const used = array(document, 'extensionsUsed')
  for (const required of ['UV_asset', 'UV_provenance']) {
    if (!used.includes(required))
      throw new TypeError(`${required} is not declared in extensionsUsed`)
  }
  if (array(document, 'extensionsRequired').some(id => String(id).startsWith('UV_'))) {
    throw new TypeError('UVM/core must not require a UV extension for base rendering')
  }
  const extensions = object(document['extensions'], 'UVM extensions')
  const identity = object(extensions['UV_asset'], 'UV_asset')
  if (!nonBlank(identity['id']) || !nonBlank(identity['class'])) {
    throw new TypeError('UV_asset requires non-empty id and class')
  }
  const provenance = object(extensions['UV_provenance'], 'UV_provenance')
  const source = object(provenance['source'], 'UV_provenance.source')
  const importer = object(provenance['importer'], 'UV_provenance.importer')
  if (!nonBlank(source['format']) || !nonBlank(importer['id']) || !nonBlank(importer['version'])) {
    throw new TypeError('UV_provenance requires source format and importer coordinate')
  }
  if (extensions['UV_source_blob'] !== undefined || used.includes('UV_source_blob'))
    throw new TypeError('UVM source blobs are not supported; project data into common facets or a bounded format residual')
  validateCollisionMetadata(document, used, signal)
  validateSocketMetadata(document, used, signal)
  validateTeamColorMetadata(document, used, signal)
  validateGameMaterialMetadata(document, used, signal)
  validateTextureColorKeys(document, used, signal)
  validateEffectsMetadata(document, used, signal)
  validateAnimationPointers(document, used, signal)
  validateUvmAnimationClips(document, signal)
}
