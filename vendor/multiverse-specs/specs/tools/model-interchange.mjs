/**
 * Reference implementation of the `model-interchange-v1` semantic scope.
 *
 * Descriptor: ../semantic-scopes/model-interchange-v1.json — that file is authoritative. Every
 * constant this module depends on is read back from it and asserted, so the code cannot drift
 * away from the registered descriptor without failing loudly.
 *
 * Input shape: a drained snapshot of what `common.view/model-scene-source@1` publishes, plus an
 * optional resource closure. Draining is the caller's job precisely because paging must not reach
 * the hash.
 *
 * Dependency-free by design: Node built-ins only.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { canonicalBytes, compareCanonicalKeys, isAlgorithmQualifiedDigest, sha256Hex, uvDigest } from './uv-canonical.mjs'

const descriptorUrl = new URL('../semantic-scopes/model-interchange-v1.json', import.meta.url)
export const DESCRIPTOR = JSON.parse(readFileSync(fileURLToPath(descriptorUrl), 'utf8'))

const REQUIRED_FACETS = ['uv.model/structure@1', 'uv.model/hierarchy@1', 'uv.model/mesh-index@1']
const OPTIONAL_FACETS = ['uv.model/bounds@1', 'uv.model/geometry@1', 'uv.model/resource-closure@1']
const TOPOLOGIES = new Set([
  'points',
  'lines',
  'line-strip',
  'triangles',
  'triangle-strip',
  'triangle-fan',
])
const GEOMETRY_ATTRIBUTE_DOMAIN = 'uv.model/geometry-attributes@1'

// --- the descriptor is the authority; this module only implements it ------------------------------

function assertDescriptorAgreement() {
  const declared = DESCRIPTOR.facets.map(facet => `${facet.facetId}@${facet.version}`)
  const declaredRequired = DESCRIPTOR.facets
    .filter(facet => facet.requirement === 'required')
    .map(facet => `${facet.facetId}@${facet.version}`)
  const declaredOptional = DESCRIPTOR.facets
    .filter(facet => facet.requirement === 'optional')
    .map(facet => `${facet.facetId}@${facet.version}`)
  const same = (left, right) => left.length === right.length && left.every((v, i) => v === right[i])
  if (!same(declaredRequired, REQUIRED_FACETS) || !same(declaredOptional, OPTIONAL_FACETS)) {
    throw new Error(
      `model-interchange-v1: the descriptor declares facets [${declared.join(', ')}], this implementation carries [${[...REQUIRED_FACETS, ...OPTIONAL_FACETS].join(', ')}]`,
    )
  }
  if (DESCRIPTOR.hash.algorithm !== 'sha256' || DESCRIPTOR.hash.canonicalForm !== 'uv.canonical/typed-form@1') {
    throw new Error('model-interchange-v1: the descriptor names a hash this implementation does not carry')
  }
}
assertDescriptorAgreement()

// --- helpers ---------------------------------------------------------------------------------------

const byUtf8 = (left, right) => compareCanonicalKeys(left, right)

function requireFiniteNumbers(values, label) {
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${label} must contain finite numbers only (found ${String(value)})`)
    }
  }
  return values.map(value => (value === 0 ? 0 : value))
}

function optionalString(value, label) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string or absent`)
  return value
}

function numbers(source, label) {
  if (source === undefined || source === null) return null
  const values = Array.from(source, value => Number(value))
  return requireFiniteNumbers(values, label)
}

function boundsValue(bounds, label) {
  if (bounds === undefined || bounds === null) return null
  return {
    min: requireFiniteNumbers(Array.from(bounds.min ?? [], Number), `${label}.min`),
    max: requireFiniteNumbers(Array.from(bounds.max ?? [], Number), `${label}.max`),
  }
}

// --- facets ----------------------------------------------------------------------------------------

function structureFacet(info) {
  const counts = ['scenes', 'nodes', 'meshes', 'primitives', 'materials', 'textures', 'animations']
  const value = {}
  for (const key of counts) {
    const count = info?.[key]
    if (!Number.isInteger(count) || count < 0) {
      throw new TypeError(`uv.model/structure@1: info.${key} must be a non-negative integer`)
    }
    value[key] = count
  }
  if (info.geometryAccess !== 'decoded' && info.geometryAccess !== 'metadata-only') {
    throw new TypeError('uv.model/structure@1: info.geometryAccess must be decoded or metadata-only')
  }
  value.geometryAccess = info.geometryAccess
  return value
}

function hierarchyFacet(nodes) {
  if (!Array.isArray(nodes)) throw new TypeError('uv.model/hierarchy@1: nodes must be a drained array')
  const records = nodes.map(node => {
    if (typeof node?.id !== 'string' || node.id === '') {
      throw new TypeError('uv.model/hierarchy@1: every node needs a non-empty id')
    }
    const transform = requireFiniteNumbers(
      Array.from(node.transform ?? [], Number),
      `uv.model/hierarchy@1 node ${node.id} transform`,
    )
    if (transform.length !== 16) {
      throw new TypeError(`uv.model/hierarchy@1: node ${node.id} transform must carry 16 numbers`)
    }
    return {
      id: node.id,
      name: optionalString(node.name, `node ${node.id} name`),
      childIds: [...(node.childIds ?? [])],
      meshIds: [...(node.meshIds ?? [])],
      transform,
    }
  })
  const ids = new Set(records.map(record => record.id))
  if (ids.size !== records.length) throw new TypeError('uv.model/hierarchy@1: node ids must be unique')
  records.sort((left, right) => byUtf8(left.id, right.id))
  return { nodes: records }
}

function meshIndexFacet(meshes) {
  if (!Array.isArray(meshes)) throw new TypeError('uv.model/mesh-index@1: meshes must be a drained array')
  const records = meshes.map(mesh => {
    if (typeof mesh?.id !== 'string' || mesh.id === '') {
      throw new TypeError('uv.model/mesh-index@1: every mesh needs a non-empty id')
    }
    return {
      id: mesh.id,
      name: optionalString(mesh.name, `mesh ${mesh.id} name`),
      primitiveIds: [...(mesh.primitiveIds ?? [])],
    }
  })
  const ids = new Set(records.map(record => record.id))
  if (ids.size !== records.length) throw new TypeError('uv.model/mesh-index@1: mesh ids must be unique')
  records.sort((left, right) => byUtf8(left.id, right.id))
  return { meshes: records }
}

/** Bounded, algorithm-qualified digest of the decoded attribute values of one primitive. */
export function attributeDigest(primitive) {
  return uvDigest(GEOMETRY_ATTRIBUTE_DOMAIN, {
    positions: numbers(primitive.positions, 'positions'),
    normals: numbers(primitive.normals, 'normals'),
    textureCoordinates: numbers(primitive.textureCoordinates, 'textureCoordinates'),
    indices: primitive.indices === undefined || primitive.indices === null
      ? null
      : Array.from(primitive.indices, value => Number(value)),
  })
}

function geometryFacet(primitives) {
  if (!Array.isArray(primitives)) {
    throw new TypeError('uv.model/geometry@1: primitives must be a drained array')
  }
  const records = primitives.map(primitive => {
    if (typeof primitive?.id !== 'string' || primitive.id === '') {
      throw new TypeError('uv.model/geometry@1: every primitive needs a non-empty id')
    }
    if (!TOPOLOGIES.has(primitive.topology)) {
      throw new TypeError(`uv.model/geometry@1: primitive ${primitive.id} has an unknown topology`)
    }
    const positions = numbers(primitive.positions, `primitive ${primitive.id} positions`)
    if (positions === null || positions.length % 3 !== 0) {
      throw new TypeError(`uv.model/geometry@1: primitive ${primitive.id} needs VEC3 positions`)
    }
    const attributes = ['positions']
    if (primitive.normals !== undefined && primitive.normals !== null) attributes.push('normals')
    if (primitive.textureCoordinates !== undefined && primitive.textureCoordinates !== null) {
      attributes.push('textureCoordinates')
    }
    attributes.sort(byUtf8)
    return {
      id: primitive.id,
      topology: primitive.topology,
      vertexCount: positions.length / 3,
      indexCount:
        primitive.indices === undefined || primitive.indices === null ? null : primitive.indices.length,
      attributes,
      materialId: optionalString(primitive.materialId, `primitive ${primitive.id} materialId`),
      bounds: boundsValue(primitive.bounds, `primitive ${primitive.id} bounds`),
      attributeDigest: attributeDigest(primitive),
    }
  })
  const ids = new Set(records.map(record => record.id))
  if (ids.size !== records.length) throw new TypeError('uv.model/geometry@1: primitive ids must be unique')
  records.sort((left, right) => byUtf8(left.id, right.id))
  return { primitives: records }
}

function resourceClosureFacet(closure) {
  const mode = closure?.mode
  if (mode !== 'logical' && mode !== 'content-qualified') {
    throw new TypeError('uv.model/resource-closure@1: mode must be logical or content-qualified')
  }
  const roles = new Set(DESCRIPTOR.resourceClosure.roles)
  const entries = (closure.entries ?? []).map(entry => {
    if (!roles.has(entry?.role)) {
      throw new TypeError(`uv.model/resource-closure@1: unknown role ${String(entry?.role)}`)
    }
    if (typeof entry.logicalId !== 'string' || entry.logicalId === '') {
      throw new TypeError('uv.model/resource-closure@1: every entry needs a non-empty logicalId')
    }
    let digest = entry.digest === undefined ? null : entry.digest
    if (digest !== null && !isAlgorithmQualifiedDigest(digest)) {
      throw new TypeError(
        `uv.model/resource-closure@1: digest ${String(digest)} is not algorithm-qualified (expected ${DESCRIPTOR.resourceClosure.digestForm})`,
      )
    }
    // The mode is a policy, not a hint: a logical closure never carries content identity.
    if (mode === 'logical') digest = null
    return {
      role: entry.role,
      logicalId: entry.logicalId,
      mediaHint: optionalString(entry.mediaHint, `resource ${entry.logicalId} mediaHint`),
      digest,
    }
  })
  const seen = new Set()
  for (const entry of entries) {
    const key = `${entry.role} ${entry.logicalId}`
    if (seen.has(key)) {
      throw new TypeError(`uv.model/resource-closure@1: duplicate entry ${entry.role} ${entry.logicalId}`)
    }
    seen.add(key)
  }
  entries.sort((left, right) => byUtf8(left.role, right.role) || byUtf8(left.logicalId, right.logicalId))
  return { mode, entries }
}

// --- bundle and hash --------------------------------------------------------------------------------

/**
 * Build the scope's facet bundle from a drained model-scene projection.
 *
 * `projection`: { info, nodes, meshes, primitives?, resourceClosure? }
 */
export function buildFacetBundle(projection) {
  const present = new Map()
  const absent = []

  const structure = structureFacet(projection.info)
  present.set('uv.model/structure@1', structure)
  present.set('uv.model/hierarchy@1', hierarchyFacet(projection.nodes))
  present.set('uv.model/mesh-index@1', meshIndexFacet(projection.meshes))

  const bounds = boundsValue(projection.info?.bounds, 'info.bounds')
  if (bounds === null) absent.push('uv.model/bounds@1')
  else present.set('uv.model/bounds@1', bounds)

  const hasGeometry = projection.primitives !== undefined && projection.primitives !== null
  if (structure.geometryAccess === 'decoded' && !hasGeometry) {
    throw new TypeError(
      'model-interchange-v1: geometryAccess=decoded requires uv.model/geometry@1; a decoded source may not withhold it',
    )
  }
  if (structure.geometryAccess === 'metadata-only' && hasGeometry) {
    throw new TypeError(
      'model-interchange-v1: geometryAccess=metadata-only forbids uv.model/geometry@1; the two facts must agree',
    )
  }
  if (hasGeometry) present.set('uv.model/geometry@1', geometryFacet(projection.primitives))
  else absent.push('uv.model/geometry@1')

  if (projection.resourceClosure === undefined || projection.resourceClosure === null) {
    absent.push('uv.model/resource-closure@1')
  } else {
    present.set('uv.model/resource-closure@1', resourceClosureFacet(projection.resourceClosure))
  }

  const facets = [...present.entries()].sort((left, right) => byUtf8(left[0], right[0]))
  absent.sort(byUtf8)
  return { facets, absentFacets: absent }
}

/** The exact value the scope hashes. Exposed so a diff can show what two paths disagreed on. */
export function hashEnvelope(bundle) {
  return {
    scope: { id: DESCRIPTOR.scopeId, version: DESCRIPTOR.version },
    facets: bundle.facets.map(([key, value]) => [key, value]),
    absentFacets: [...bundle.absentFacets],
  }
}

/** `projectionSemanticHash(model-interchange-v1)` for a drained projection. */
export function projectionSemanticHash(projection) {
  const bundle = buildFacetBundle(projection)
  return uvDigest(DESCRIPTOR.hash.domain, hashEnvelope(bundle), {
    schemaVersion: DESCRIPTOR.hash.envelopeSchemaVersion,
    algorithm: DESCRIPTOR.hash.algorithm,
  })
}

/** The canonical text the hash was taken over. Only for diagnostics and vector authoring. */
export function hashInputText(projection) {
  const envelope = {
    schemaVersion: DESCRIPTOR.hash.envelopeSchemaVersion,
    domain: DESCRIPTOR.hash.domain,
    value: hashEnvelope(buildFacetBundle(projection)),
  }
  return new TextDecoder().decode(canonicalBytes(envelope))
}

export { sha256Hex }
