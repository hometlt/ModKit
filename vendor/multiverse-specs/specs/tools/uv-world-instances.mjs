/** UVP immutable world selection and UVW local-space qualification. No second geometry model. */
import { assertUvwProfile } from './uvw-profile.mjs'
import { uvwDocumentGraph } from './uvw-gltf.mjs'
import { isUvpArtifactPath } from './uvp-resource-paths.mjs'

const reject = (rule, message) => ({ refusal: { rule, message } })
const keys = (value, names) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...names].sort().join('\0')
const localId = /^[a-z][a-z0-9-]*$/u
const packageId = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\/[a-z0-9][a-z0-9-]*$/u

/** Called only with the reachable dependency closure, before any artifact reads. */
export function verifyWorldInstanceSelections(rootId, manifests) {
  let hasSelection = false
  for (const manifest of manifests) {
    if (!Object.hasOwn(manifest, 'worldInstances')) continue
    hasSelection = true
    const selection = manifest.worldInstances
    if (!keys(selection, ['schemaVersion', 'instances']) || selection.schemaVersion !== 1
      || !Array.isArray(selection.instances) || selection.instances.length < 1 || selection.instances.length > 64)
      return reject('world-instances-invalid', `${manifest.id} needs a version 1 selection of 1..64 instances.`)
    let previous = ''
    for (const entry of selection.instances) {
      if (!keys(entry, ['id', 'packageId', 'path']) || typeof entry.id !== 'string'
        || !localId.test(entry.id) || entry.id.length > 48
        || typeof entry.packageId !== 'string' || !packageId.test(entry.packageId) || !isUvpArtifactPath(entry.path))
        return reject('world-instances-invalid', `${manifest.id} has an invalid world instance address.`)
      if (entry.id <= previous)
        return reject('world-instances-order', `${manifest.id} instance IDs must be unique and sorted.`)
      previous = entry.id
      const target = manifests.find(candidate => candidate.id === entry.packageId)
      const matches = target?.contents?.filter(content => content.family === 'uvw' && content.path === entry.path) ?? []
      if (matches.length !== 1)
        return reject('world-instance-target', `${manifest.id}/${entry.id} must name exactly one reachable UVW content entry.`)
    }
  }
  const selection = manifests.find(manifest => manifest.id === rootId)?.worldInstances
  if (hasSelection && selection === undefined)
    return reject('world-instances-root-required', 'The root must explicitly select its worlds when a dependency supplies a preset.')
  return { selection }
}

/** Geometry is retained by reference to the captured, frozen UVW document. */
export function projectWorldSpaces(selection, documents) {
  const worlds = documents.filter(entry => entry.family === 'uvw')
  if (selection === undefined && worlds.length > 1)
    return reject('world-instances-required', 'Multiple UVW documents require an explicit root world selection.')
  const instances = selection?.instances ?? worlds.map(entry => ({ packageId: entry.packageId, path: entry.path }))
  const spaces = []
  const checked = new Set()
  for (const instance of instances) {
    const matches = worlds.filter(entry => entry.packageId === instance.packageId && entry.path === instance.path)
    if (matches.length !== 1)
      return reject('world-instance-target', 'A selected UVW must have exactly one captured document.')
    const { document } = matches[0]
    let graph
    try { graph = uvwDocumentGraph(document) }
    catch (error) { return reject('world-instance-profile', `Invalid selected UVW: ${error.message}`) }
    if (Array.isArray(graph?.spaces) && spaces.length + graph.spaces.length > 65_536)
      return reject('world-instance-budget', 'The fixed-instance profile admits at most 65536 qualified spaces.')
    if (!checked.has(document)) {
      try { assertUvwProfile(document) }
      catch (error) { return reject('world-instance-profile', `Invalid selected UVW: ${error.message}`) }
      if (!Array.isArray(graph.spaces) || graph.spaces.some(space =>
        typeof space.id !== 'string' || !localId.test(space.id)))
        return reject('world-instance-profile', 'World instancing requires typed local UVW profile space IDs.')
      checked.add(document)
    }
    for (const space of graph.spaces) spaces.push(Object.freeze({
      ...(instance.id === undefined ? {} : { instanceId: instance.id }),
      packageId: instance.packageId, path: instance.path, spaceId: space.id,
      address: instance.id === undefined ? space.id : `${instance.id}/${space.id}`, space,
    }))
  }
  spaces.sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0)
  return { spaces: Object.freeze(spaces) }
}
