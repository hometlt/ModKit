/** Identity-bound migration receipt. Package I/O and byte verification remain with UVP composition. */
import { jcsStringify, uvpJsonArtifactDigest } from './uv-canonical-form.mjs'
import { verifiedCompositionDocuments, verifiedCompositionMedia,
  verifiedCompositionModels } from './uv-composition.mjs'
import { prepareUvwGltfMigration } from './uvw-profile.mjs'
import { resolveUvpResourceUri } from './uvp-resource-paths.mjs'
import { uvwGltfRasterReferences } from './uvw-gltf.mjs'
import { assertUvwRasterInlinePreview } from './uvw-raster-preview.mjs'

const refuse = (rule, message) => { throw new TypeError(`${rule}: ${message}`) }
const key = (packageId, path) => JSON.stringify([packageId, path])

/** Seal only after both source and target have in-process verified composition receipts.
 * UVM originals retain manifest identity but their bytes are not decoded by this verifier.
 */
export async function verifyUvwGltfMigration(sourceReceipt, targetReceipt, {
  sourcePackageId, sourcePath, targetPackageId, targetPath, materialPolicies = [], resourceMappings = [],
  rasterPolicies = [],
} = {}) {
  if (![sourcePackageId, sourcePath, targetPackageId, targetPath].every(value => typeof value === 'string' && value))
    refuse('uvw-gltf-migration-address', 'Both package/document addresses are required')
  const source = await verifiedCompositionDocuments(sourceReceipt)
  const target = await verifiedCompositionDocuments(targetReceipt)
  const sourceMedia = await verifiedCompositionMedia(sourceReceipt)
  const targetMedia = await verifiedCompositionMedia(targetReceipt)
  const sourceModels = await verifiedCompositionModels(sourceReceipt)
  const targetModels = await verifiedCompositionModels(targetReceipt)
  if ([source, target, sourceMedia, targetMedia, sourceModels, targetModels].some(value => value?.refusal !== undefined))
    refuse('uvw-gltf-migration-receipt', 'Both compositions need valid in-process receipts')
  const sourceEntry = source.documents.find(row => row.packageId === sourcePackageId && row.path === sourcePath && row.family === 'uvw')
  const targetEntry = target.documents.find(row => row.packageId === targetPackageId && row.path === targetPath && row.family === 'uvw')
  if (!sourceEntry || !targetEntry)
    refuse('uvw-gltf-migration-address', 'Source or target UVW document is absent from its verified composition')
  const prepared = prepareUvwGltfMigration(sourceEntry.document, { sourcePath, targetPath,
    materialPolicies, resourceMappings, rasterPolicies })
  if (jcsStringify(prepared.document) !== jcsStringify(targetEntry.document))
    refuse('uvw-gltf-migration-target', 'Verified target differs from the deterministic prepared migration')
  const sourceContents = new Map(source.contents.map(row => [key(row.packageId, row.path), row]))
  const targetContents = new Map(target.contents.map(row => [key(row.packageId, row.path), row]))
  const sourceBytes = new Set(sourceMedia.media.map(row => key(row.packageId, row.path)))
  const targetBytes = new Set(targetMedia.media.map(row => key(row.packageId, row.path)))
  const resources = prepared.inventory.map(row => {
    const sourceOriginalPath = resolveUvpResourceUri(sourcePath, row.sourceUri)
    const original = sourceContents.get(key(sourcePackageId, sourceOriginalPath))
    const targetOriginal = targetContents.get(key(targetPackageId, row.original.path))
    if (!original || original.family !== row.original.family || !targetOriginal
      || targetOriginal.family !== row.original.family || original.hash !== targetOriginal.hash
      || (row.sourceDigest !== undefined && row.sourceDigest !== original.hash))
      refuse('uvw-gltf-migration-original', `Original artifact changed or is absent for ${row.source.resourceId}`)
    if (original.family === 'media' && (!sourceBytes.has(key(sourcePackageId, sourceOriginalPath))
      || !targetBytes.has(key(targetPackageId, row.original.path))))
      refuse('uvw-gltf-migration-original', `Original media bytes are not verified for ${row.source.resourceId}`)
    const outputs = row.outputs.map(output => {
      const entry = targetContents.get(key(targetPackageId, output.path))
      if (entry?.family !== 'media' || !targetBytes.has(key(targetPackageId, output.path)))
        refuse('uvw-gltf-migration-output', `Output ${output.usage} lacks verified media bytes`)
      return { ...output, hash: entry.hash }
    })
    return { source: row.source, sourceUri: row.sourceUri,
      ...(row.sourceDigest === undefined ? {} : { sourceDigest: row.sourceDigest }),
      original: { family: original.family, sourcePath: sourceOriginalPath,
        targetPath: row.original.path, hash: original.hash }, outputs }
  })
  const rasterRefs = uvwGltfRasterReferences(targetEntry.document)
  const rasterMedia = new Map(targetMedia.media.map(row => [key(row.packageId, row.path), row.bytes]))
  for (const row of prepared.rasters) {
    if (row.inlinePreview === undefined) continue
    const sourceSpace = sourceEntry.document.spaces.find(space => space.id === row.spaceId)
    const sourceLayer = sourceSpace?.layers.find(layer => layer.id === row.layerId)
    const targetSpace = targetEntry.document.extensions.UV_world_graph.spaces.find(space => space.id === row.spaceId)
    const targetLayer = targetSpace?.layers.find(layer => layer.id === row.layerId)
    const refs = rasterRefs.find(layer => layer.spaceId === row.spaceId && layer.layerId === row.layerId)
    if (!sourceLayer?.samples || !targetLayer || !refs)
      refuse('uvw-gltf-raster-preview', `Missing source/target grid ${row.spaceId}/${row.layerId}`)
    assertUvwRasterInlinePreview(targetLayer, sourceLayer.samples,
      refs.rasters.map(raster => ({ ...raster,
        bytes: rasterMedia.get(key(targetPackageId, raster.path)) })),
    row.inlinePreview.maxAbsError)
  }
  const modelsByPath = new Map(targetModels.models.map(model =>
    [key(model.packageId, model.path), model]))
  const sourceModelsByPath = new Map(sourceModels.models.map(model =>
    [key(model.packageId, model.path), model]))
  const resourcesBySourceAddress = new Map(resources.map(row =>
    [key(row.source.spaceId, row.source.resourceId), row]))
  const socketIdsByPath = new Map()
  const socketLinks = []
  for (const [spaceIndex, space] of targetEntry.document.extensions.UV_world_graph.spaces.entries()) {
    const resources = new Map(space.layers.filter(layer => layer.kind === 'resources')
      .flatMap(layer => layer.resources.map(resource => [resource.id, resource])))
    for (const [layerIndex, layer] of space.layers.entries()) {
      if (layer.kind !== 'objects') continue
      for (const [instanceIndex, instance] of layer.instances.entries()) {
        const components = new Map((instance.modelComponents ?? []).map(component =>
          [component.id, component]))
        for (const [componentIndex, component] of (instance.modelComponents ?? []).entries()) {
          if (component.parentId === undefined) continue
          const parent = components.get(component.parentId)
          const resource = resources.get(parent.resourceId)
          const modelPath = resource?.original.path
          const model = modelsByPath.get(key(targetPackageId, modelPath))
          const sourceResource = resourcesBySourceAddress.get(key(space.id, parent.resourceId))
          const sourceModel = sourceModelsByPath.get(key(sourcePackageId, sourceResource?.original.sourcePath))
          if (resource?.original.family !== 'uvm' || !model || !sourceModel
            || sourceModel.digest !== model.digest)
            refuse('uvw-gltf-model-unverified', `Parent model ${space.id}/${parent.id} needs verified source and target UVM GLB bytes`)
          let sockets = socketIdsByPath.get(modelPath)
          if (!sockets) {
            sockets = new Map()
            const nodes = model.document.nodes ?? []
            if (!Array.isArray(nodes) || nodes.length > 1_000_000)
              refuse('uvw-gltf-model-socket', `Invalid UVM nodes in ${modelPath}`)
            for (const [nodeIndex, node] of nodes.entries()) {
              const socket = node?.extensions?.UV_game_socket
              if (socket === undefined) continue
              if (!model.document.extensionsUsed?.includes('UV_game_socket')
                || typeof socket?.role !== 'string' || !socket.role.trim())
                refuse('uvw-gltf-model-socket', `Invalid UVM socket in ${modelPath}`)
              const legacyId = socket.extras?.modkit?.id
              const id = socket.id ?? legacyId
              if (id === undefined) continue
              if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)
                || (legacyId !== undefined && legacyId !== id) || sockets.has(id))
                refuse('uvw-gltf-model-socket', `Duplicate or invalid stable socket ID in ${modelPath}`)
              sockets.set(id, nodeIndex)
            }
            socketIdsByPath.set(modelPath, sockets)
          }
          const nodeIndex = sockets.get(component.parentSocketId)
          if (nodeIndex === undefined)
            refuse('uvw-gltf-model-socket', `Socket ${component.parentSocketId} is absent in ${modelPath}`)
          socketLinks.push({ spaceId: space.id, layerId: layer.id, instanceId: instance.id,
            componentId: component.id, parentSocketId: component.parentSocketId,
            sourcePointer: `/spaces/${spaceIndex}/layers/${layerIndex}/instances/${instanceIndex}/modelComponents/${componentIndex}`,
            modelPath, modelHash: model.digest, nodeIndex })
        }
      }
    }
  }
  const losses = [
    ...prepared.materials.flatMap(row => row.fidelity === 'preview'
      ? [{ sourcePointer: row.sourcePointer,
        reason: 'Water effect is represented but not yet executed by the common renderer' }] : []),
    ...prepared.rasters.map(row => ({ sourcePointer: row.sourcePointer,
      reason: 'Raster sampling is represented but renderer/native parity is not yet measured' })),
    ...prepared.rasters.flatMap(row => row.inlinePreview === undefined ? [] : [{
      sourcePointer: row.inlinePreview.sourcePointer,
      reason: 'Inline preview was byte-checked at grid points; exact authored samples remain in the source composition' }]),
    ...prepared.visualLayers.map(row => ({ sourcePointer: row.sourcePointer,
      reason: `${row.kind} is preserved but common renderer/native parity is not yet measured` })),
  ]
  return { profile: 'uv/uvw-gltf-migration@1', status: 'verified',
    scope: losses.length || prepared.scope === 'preview' ? 'preview' : resources.some(row => row.original.family === 'uvm')
      ? 'manifest-verified' : 'media-verified',
    source: { packageId: sourcePackageId, path: sourcePath,
      hash: await uvpJsonArtifactDigest('uvw', sourceEntry.document), compositionHash: sourceReceipt.compositionHash },
    target: { packageId: targetPackageId, path: targetPath,
      hash: await uvpJsonArtifactDigest('uvw', targetEntry.document), compositionHash: targetReceipt.compositionHash },
    resources, materials: prepared.materials, rasters: prepared.rasters,
    socketLinks, losses, refusals: [] }
}
