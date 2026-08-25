/**
 * Reference implementation of the `texture-interchange-v1` **candidate** semantic scope.
 *
 * Descriptor: ../semantic-scopes/texture-interchange-v1.json — that file is authoritative. Every
 * constant this module depends on is read back from it and asserted, so the code cannot drift away
 * from the descriptor without failing loudly.
 *
 * Candidate, not registered, and the reason is visible in the descriptor's own bindings: two of the
 * four facets have `live.contract: null`, because a decoded raster region says nothing about the
 * sampler a runtime should bind or about which rectangles of an atlas mean something. A projector
 * supplies both, and a scope whose facets are partly supplied rather than published is admission
 * evidence, not a compatibility guarantee.
 *
 * Input shape: `{ container, color, sampler, atlas? }` — the UVT sidecar's own blocks, which is
 * what makes the two paths comparable: a live projection assembles them from `RasterImageInfo`
 * plus its projector's decisions, and a reopened projection reads them back out of the KTX 2.0
 * container and the sidecar beside it.
 *
 * Dependency-free by design: Node built-ins only.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  canonicalBytes,
  compareCanonicalKeys,
  sha256Hex,
  uvDigest,
} from './uv-canonical.mjs'

const descriptorUrl = new URL('../semantic-scopes/texture-interchange-v1.json', import.meta.url)
export const DESCRIPTOR = JSON.parse(readFileSync(fileURLToPath(descriptorUrl), 'utf8'))

const REQUIRED_FACETS = ['uv.texture/container@1', 'uv.texture/color@1', 'uv.texture/sampler@1']
const OPTIONAL_FACETS = ['uv.texture/atlas@1']

const TRANSFER = new Set(['linear', 'srgb'])
const PRIMARIES = new Set(['bt709', 'unspecified'])
const ALPHA_MODES = new Set(['opaque', 'straight', 'premultiplied'])
const ORIENTATIONS = new Set(['rd', 'ru'])
const FILTERS = new Set(['nearest', 'linear'])
const MIP_FILTERS = new Set(['none', 'nearest', 'linear'])
const WRAPS = new Set(['repeat', 'clamp-to-edge', 'mirrored-repeat'])
const SUPERCOMPRESSION = new Set([0, 1, 2, 3])
const SWIZZLE = /^[rgba01]{4}$/u

// --- the descriptor is the authority; this module only implements it ------------------------------

function assertDescriptorAgreement() {
  const key = facet => `${facet.facetId}@${facet.version}`
  const declaredRequired = DESCRIPTOR.facets
    .filter(facet => facet.requirement === 'required')
    .map(key)
  const declaredOptional = DESCRIPTOR.facets
    .filter(facet => facet.requirement === 'optional')
    .map(key)
  const same = (left, right) => left.length === right.length && left.every((v, i) => v === right[i])
  if (!same(declaredRequired, REQUIRED_FACETS) || !same(declaredOptional, OPTIONAL_FACETS)) {
    throw new Error(
      `texture-interchange-v1: the descriptor declares [${DESCRIPTOR.facets.map(key).join(', ')}], this implementation carries [${[...REQUIRED_FACETS, ...OPTIONAL_FACETS].join(', ')}]`,
    )
  }
  if (DESCRIPTOR.status !== 'candidate') {
    throw new Error(
      'texture-interchange-v1: this implementation is written for a candidate scope; promoting the descriptor is a deliberate change that must be reviewed here too',
    )
  }
  if (
    DESCRIPTOR.hash.algorithm !== 'sha256' ||
    DESCRIPTOR.hash.canonicalForm !== 'uv.canonical/typed-form@1'
  ) {
    throw new Error('texture-interchange-v1: the descriptor names a hash this implementation does not carry')
  }
}
assertDescriptorAgreement()

// --- helpers ---------------------------------------------------------------------------------------

const byUtf8 = (left, right) => compareCanonicalKeys(left, right)

function requireInteger(value, minimum, label) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be an integer >= ${minimum}`)
  }
  return value
}

function requireMember(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new TypeError(`${label} must be one of ${[...allowed].join(' | ')}, found ${String(value)}`)
  }
  return value
}

// --- facets ----------------------------------------------------------------------------------------

function containerFacet(container) {
  const value = {
    vkFormat: requireInteger(container?.vkFormat, 0, 'uv.texture/container@1: vkFormat'),
    pixelWidth: requireInteger(container?.pixelWidth, 1, 'uv.texture/container@1: pixelWidth'),
    pixelHeight: requireInteger(container?.pixelHeight, 1, 'uv.texture/container@1: pixelHeight'),
    pixelDepth: requireInteger(container?.pixelDepth, 0, 'uv.texture/container@1: pixelDepth'),
    layerCount: requireInteger(container?.layerCount, 0, 'uv.texture/container@1: layerCount'),
    faceCount: container?.faceCount,
    levelCount: requireInteger(container?.levelCount, 1, 'uv.texture/container@1: levelCount'),
    supercompressionScheme: container?.supercompressionScheme,
  }
  if (value.faceCount !== 1 && value.faceCount !== 6) {
    throw new TypeError('uv.texture/container@1: faceCount must be 1 or 6')
  }
  if (value.pixelDepth !== 0) {
    throw new TypeError('uv.texture/container@1: this profile admits 2D, array and cube topologies only')
  }
  if (value.faceCount === 6 && value.pixelWidth !== value.pixelHeight) {
    throw new TypeError('uv.texture/container@1: a cubemap must be square')
  }
  requireMember(
    value.supercompressionScheme,
    SUPERCOMPRESSION,
    'uv.texture/container@1: supercompressionScheme',
  )
  return value
}

function colorFacet(color) {
  const swizzle = color?.swizzle
  if (swizzle !== null && swizzle !== undefined && !SWIZZLE.test(String(swizzle))) {
    throw new TypeError('uv.texture/color@1: swizzle must be four characters from rgba01, or null')
  }
  const value = {
    transferFunction: requireMember(
      color?.transferFunction,
      TRANSFER,
      'uv.texture/color@1: transferFunction',
    ),
    primaries: requireMember(color?.primaries, PRIMARIES, 'uv.texture/color@1: primaries'),
    premultipliedAlpha: color?.premultipliedAlpha,
    alphaMode: requireMember(color?.alphaMode, ALPHA_MODES, 'uv.texture/color@1: alphaMode'),
    orientation: requireMember(color?.orientation, ORIENTATIONS, 'uv.texture/color@1: orientation'),
    // null is a real answer here and the only member of this scope that may carry one
    swizzle: swizzle === undefined || swizzle === null ? null : String(swizzle),
  }
  if (typeof value.premultipliedAlpha !== 'boolean') {
    throw new TypeError('uv.texture/color@1: premultipliedAlpha must be a boolean')
  }
  if (value.alphaMode === 'premultiplied' && value.premultipliedAlpha !== true) {
    throw new TypeError(
      'uv.texture/color@1: alphaMode «premultiplied» contradicts a container whose alpha-premultiplied flag is clear',
    )
  }
  if (value.alphaMode === 'opaque' && value.premultipliedAlpha === true) {
    throw new TypeError(
      'uv.texture/color@1: alphaMode «opaque» contradicts a container that declares premultiplied alpha',
    )
  }
  return value
}

function samplerFacet(sampler, levelCount) {
  const value = {
    minFilter: requireMember(sampler?.minFilter, FILTERS, 'uv.texture/sampler@1: minFilter'),
    magFilter: requireMember(sampler?.magFilter, FILTERS, 'uv.texture/sampler@1: magFilter'),
    mipFilter: requireMember(sampler?.mipFilter, MIP_FILTERS, 'uv.texture/sampler@1: mipFilter'),
    wrapS: requireMember(sampler?.wrapS, WRAPS, 'uv.texture/sampler@1: wrapS'),
    wrapT: requireMember(sampler?.wrapT, WRAPS, 'uv.texture/sampler@1: wrapT'),
  }
  if (value.mipFilter !== 'none' && levelCount <= 1) {
    throw new TypeError(
      `uv.texture/sampler@1: mipFilter «${value.mipFilter}» asks for filtering across levels a single-level texture does not have`,
    )
  }
  return value
}

function atlasFacet(atlas, container) {
  const regions = atlas?.regions
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new TypeError('uv.texture/atlas@1: an atlas with no region is the absent facet, not an empty one')
  }
  const seen = new Set()
  const records = regions.map(region => {
    const id = region?.id
    if (typeof id !== 'string' || id === '') {
      throw new TypeError('uv.texture/atlas@1: every region needs a non-empty id')
    }
    if (seen.has(id)) throw new TypeError(`uv.texture/atlas@1: region id «${id}» is used twice`)
    seen.add(id)
    const x = requireInteger(region.x, 0, `uv.texture/atlas@1: region ${id} x`)
    const y = requireInteger(region.y, 0, `uv.texture/atlas@1: region ${id} y`)
    const width = requireInteger(region.width, 1, `uv.texture/atlas@1: region ${id} width`)
    const height = requireInteger(region.height, 1, `uv.texture/atlas@1: region ${id} height`)
    if (x + width > container.pixelWidth || y + height > container.pixelHeight) {
      throw new TypeError(
        `uv.texture/atlas@1: region «${id}» runs outside the ${container.pixelWidth}x${container.pixelHeight} image; clamping it would silently produce a different sprite`,
      )
    }
    const pivot = region.pivot
    if (pivot !== undefined && pivot !== null) {
      if (!Array.isArray(pivot) || pivot.length !== 2 || !pivot.every(Number.isFinite)) {
        throw new TypeError(`uv.texture/atlas@1: region ${id} pivot must be two finite numbers`)
      }
    }
    return {
      id,
      x,
      y,
      width,
      height,
      pivot: pivot === undefined || pivot === null ? null : [Number(pivot[0]), Number(pivot[1])],
    }
  })
  records.sort((left, right) => byUtf8(left.id, right.id))
  return { regions: records }
}

// --- bundle and hash --------------------------------------------------------------------------------

/**
 * Build the scope's facet bundle from a UVT projection.
 *
 * `projection`: `{ container, color, sampler, atlas? }` — the sidecar's own blocks. A reopened
 * projection assembles the same four from the container plus its sidecar, which is exactly why the
 * mandatory mapping of SPEC_UVT §1 exists: without it the two paths would be describing the same
 * bytes twice instead of agreeing about them once.
 */
export function buildFacetBundle(projection) {
  const container = containerFacet(projection?.container)
  const present = new Map()
  present.set('uv.texture/container@1', container)
  present.set('uv.texture/color@1', colorFacet(projection?.color))
  present.set('uv.texture/sampler@1', samplerFacet(projection?.sampler, container.levelCount))
  const absent = []
  if (projection?.atlas === undefined || projection?.atlas === null) absent.push('uv.texture/atlas@1')
  else present.set('uv.texture/atlas@1', atlasFacet(projection.atlas, container))
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

/** `projectionSemanticHash(texture-interchange-v1)` for a UVT projection. Admission-only evidence. */
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

/**
 * The scope projection a `.uvt.json` sidecar carries, in the order this scope names its parts.
 *
 * A sidecar and a projection are not the same object: the sidecar has a `uv` identity block this
 * scope does not hash, and it spells `swizzle` by omission where the scope spells it `null`.
 */
export function projectionFromSidecar(sidecar) {
  return {
    container: { ...sidecar?.ktx2 },
    color: {
      transferFunction: sidecar?.color?.transferFunction,
      primaries: sidecar?.color?.primaries,
      premultipliedAlpha: sidecar?.color?.premultipliedAlpha,
      alphaMode: sidecar?.alphaMode,
      orientation: sidecar?.orientation,
      swizzle: sidecar?.swizzle ?? null,
    },
    sampler: { ...sidecar?.sampler },
    ...(sidecar?.atlas === undefined ? {} : { atlas: sidecar.atlas }),
  }
}

export { sha256Hex }
