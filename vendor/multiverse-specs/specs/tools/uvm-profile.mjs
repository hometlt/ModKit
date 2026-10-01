/** Browser-safe UVM/core marker admission shared by UVM and UVP composition. */
import { assertGltfMaterialReferences } from './gltf-materials.mjs'

export function assertUvmCore(document) {
  const asset = document.asset
  if (asset?.version !== '2.0') throw new TypeError('UVM asset.version must be 2.0')
  const uv = asset.extras?.uv
  if (uv?.format !== 'UVM' || uv.version !== '1.0' || uv.profile !== 'core') {
    throw new TypeError('asset.extras.uv must identify the UVM/core 1.0 profile')
  }
  const used = document.extensionsUsed ?? []
  for (const required of ['UV_asset', 'UV_provenance']) {
    if (!used.includes(required)) throw new TypeError(`${required} is not declared in extensionsUsed`)
    if (document.extensions?.[required] === undefined) {
      throw new TypeError(`${required} is declared but absent`)
    }
  }
  if ((document.extensionsRequired ?? []).some(id => String(id).startsWith('UV_'))) {
    throw new TypeError('UVM/core must not require a UV_ extension')
  }
  const identity = document.extensions.UV_asset
  if (typeof identity.id !== 'string' || identity.id.trim() === '') {
    throw new TypeError('UV_asset requires a non-empty id')
  }
  const provenance = document.extensions.UV_provenance
  if (
    typeof provenance.source?.format !== 'string' ||
    typeof provenance.importer?.id !== 'string' ||
    typeof provenance.importer?.version !== 'string'
  ) {
    throw new TypeError('UV_provenance requires source format and importer coordinate')
  }
  assertGltfMaterialReferences(document)
  return document
}
