import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import {
  discoverAuthoredExtensionRoots,
  hasAuthoredExtensionContainer,
  toPosixPath,
} from '../../lib/authored-extension-roots.mjs'

export const SURFACE_ANCHORS = Object.freeze([
  'sections',
  'tree',
  'hex',
  'card',
  'preview',
  'relations',
  'selector',
  'mcp-inspect',
  'script',
  'no-op-edit',
])

const DATA_SOURCE_ANCHORS = Object.freeze({
  'common.view/tree-data-source': 'tree',
  'common.view/byte-range-source': 'hex',
  'common.view/subject-facts-source': 'card',
  'common.view/relation-graph-source': 'relations',
  'common.view/subject-selector-source': 'selector',
})

const PREVIEW_DATA_SOURCES = new Set([
  'common.view/raster-image-source',
  'common.view/vector-scene-source',
  'common.view/audio-media-source',
  'common.view/video-media-source',
  'common.view/model-scene-source',
  'common.view/world-scene-source',
  'common.view/slide-deck-source',
])

const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
const sorted = (values, pick = value => value) =>
  [...values].sort((a, b) => compare(pick(a), pick(b)))
const record = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
const array = value => (Array.isArray(value) ? value : [])
const string = value => (typeof value === 'string' && value.length > 0 ? value : undefined)

function operationFacts(spec) {
  return array(record(spec)?.operations)
    .map((value, index) => {
      const item = record(value)
      const id = string(item?.id)
      const handlerId = string(item?.handlerId)
      if (id === undefined || handlerId === undefined) return undefined
      return Object.freeze({
        id,
        handlerId,
        mutatesSource: item.mutatesSource === true,
        outputKinds: Object.freeze(
          array(item.outputKinds).filter(value => typeof value === 'string'),
        ),
        source: `spec.operations[${index}]`,
      })
    })
    .filter(Boolean)
}

function dataSourceFacts(spec) {
  return array(record(spec)?.publishesDataSources)
    .map((value, index) => {
      const item = record(value)
      const contract = string(item?.contract)
      if (contract === undefined || !Number.isSafeInteger(item?.major)) return undefined
      return Object.freeze({
        contract,
        major: item.major,
        source: `spec.publishesDataSources[${index}]`,
      })
    })
    .filter(Boolean)
}

function writerOffers(contributions, formatId) {
  const offers = []
  for (const contribution of contributions) {
    const manifest = contribution.manifest
    if (manifest?.contract?.id !== 'modkit/service-provider-contribution') continue
    for (const [index, rawOffer] of array(record(manifest.spec)?.provides).entries()) {
      const offer = record(rawOffer)
      const facet = record(offer?.facet)
      if (offer?.contract !== 'common.edit/writer' || facet?.formatId !== formatId) continue
      offers.push(
        Object.freeze({
          contributionId: manifest.id,
          offerId: string(offer.offerId) ?? `offer-${index}`,
          representationId: string(facet.representationId),
          minimumRoundTrip: string(facet.minimumRoundTrip),
          source: `${contribution.path}#spec.provides[${index}]`,
        }),
      )
    }
  }
  return sorted(offers, value => `${value.contributionId}\0${value.offerId}`)
}

function relatedFacts(contributions, contractId) {
  return sorted(
    contributions
      .filter(value => value.manifest?.contract?.id === contractId)
      .map(value => ({ id: value.manifest.id, path: value.path, spec: value.manifest.spec })),
    value => value.id,
  )
}

export function surfaceClaimsForCodec(spec, writers = []) {
  const dataSources = dataSourceFacts(spec)
  const operations = operationFacts(spec)
  const claims = new Map(SURFACE_ANCHORS.map(id => [id, []]))
  const add = (id, source) => claims.get(id).push(source)
  for (const fact of dataSources) {
    const anchor = DATA_SOURCE_ANCHORS[fact.contract]
    if (anchor !== undefined) add(anchor, fact.source)
    if (PREVIEW_DATA_SOURCES.has(fact.contract)) add('preview', fact.source)
  }
  for (const operation of operations) {
    if (operation.id === 'view.inspect') {
      add('sections', operation.source)
      add('card', `${operation.source}:metadata-fallback`)
      add('mcp-inspect', operation.source)
      add('script', `${operation.source}:metadata-projection`)
    }
    if (/^(?:preview|render|thumbnail)\./u.test(operation.id)) add('preview', operation.source)
    if (operation.mutatesSource) add('no-op-edit', operation.source)
  }
  for (const writer of writers) add('no-op-edit', writer.source)
  return Object.freeze(
    Object.fromEntries(
      SURFACE_ANCHORS.map(id => [
        id,
        Object.freeze({
          applicable: claims.get(id).length > 0,
          sources: Object.freeze(claims.get(id)),
        }),
      ]),
    ),
  )
}

export function buildSurfaceMatrix(inventories) {
  const rows = []
  const seen = new Set()
  for (const inventorySource of inventories) {
    const repositoryContributions = inventorySource.inventory.extensions.flatMap(
      extension => extension.contributions,
    )
    for (const extension of inventorySource.inventory.extensions) {
      for (const contribution of extension.contributions) {
        const manifest = contribution.manifest
        if (
          manifest?.contract?.id !== 'modkit/codec-contribution' ||
          !contribution.inventoryEligible
        )
          continue
        const spec = record(manifest.spec)
        if (spec === undefined) continue
        for (const [index, rawFormat] of array(spec.formatRefs).entries()) {
          const format = record(rawFormat)
          const formatId = string(format?.formatId)
          if (formatId === undefined) continue
          const rowId = `${manifest.id}#${formatId}`
          if (seen.has(rowId)) throw new Error(`duplicate format surface row ${rowId}`)
          seen.add(rowId)
          const formatWriters = writerOffers(repositoryContributions, formatId)
          const dataSources = dataSourceFacts(spec)
          const operations = operationFacts(spec)
          rows.push(
            Object.freeze({
              rowId,
              repository: inventorySource.label,
              extensionId: `${extension.manifest.publisher}/${extension.manifest.id}`,
              contributionId: manifest.id,
              contributionPath: contribution.path,
              format: Object.freeze({
                id: formatId,
                label: string(format.label) ?? formatId,
                ...(string(format.mediaType) === undefined ? {} : { mediaType: format.mediaType }),
                source: `spec.formatRefs[${index}]`,
              }),
              dataSources: Object.freeze(dataSources),
              operations: Object.freeze(operations),
              writerOffers: Object.freeze(formatWriters),
              languageProviders: Object.freeze(
                relatedFacts(
                  extension.contributions,
                  'modkit/service-provider-contribution',
                ).filter(value =>
                  array(record(value.spec)?.provides).some(offer =>
                    String(record(offer)?.contract ?? '').includes('language'),
                  ),
                ),
              ),
              runtimeProviders: Object.freeze(
                relatedFacts(
                  extension.contributions,
                  'modkit/service-provider-contribution',
                ).filter(value =>
                  array(record(value.spec)?.provides).some(offer =>
                    String(record(offer)?.contract ?? '').includes('runtime'),
                  ),
                ),
              ),
              subjectKinds: Object.freeze(
                relatedFacts(extension.contributions, 'modkit/subject-kind-definition'),
              ),
              projections: Object.freeze(
                dataSources
                  .filter(value =>
                    /(?:raster-image|model-scene|world-scene)-source$/u.test(value.contract),
                  )
                  .map(value => ({
                    id: `projection.${value.contract.split('/').at(-1)}`,
                    source: value.source,
                  })),
              ),
              surfaces: surfaceClaimsForCodec(spec, formatWriters),
              smoke: Object.freeze({ status: 'missing', receiptIds: Object.freeze([]) }),
            }),
          )
        }
      }
    }
  }
  const ordered = sorted(rows, value => value.rowId)
  const applicableClaims = ordered.reduce(
    (total, row) =>
      total + SURFACE_ANCHORS.filter(anchor => row.surfaces[anchor].applicable).length,
    0,
  )
  return Object.freeze({
    schemaVersion: 1,
    kind: 'modkit.format-surface-matrix',
    repositories: Object.freeze(
      sorted(
        inventories.map(value => value.provenance),
        value => value.label,
      ),
    ),
    anchors: SURFACE_ANCHORS,
    counts: Object.freeze({
      rows: ordered.length,
      applicableClaims,
      smokePassed: ordered.filter(value => value.smoke.status === 'pass').length,
      smokeMissing: ordered.filter(value => value.smoke.status === 'missing').length,
    }),
    rows: Object.freeze(ordered),
  })
}

export async function loadInventorySources({ repoRoot, roots = [], snapshots = [] }) {
  const hostDist = path.join(repoRoot, 'packages', 'host', 'dist')
  const { loadExtensionDirectory } = await import(
    pathToFileURL(path.join(hostDist, 'node', 'index.js')).href
  )
  const { buildInventory, createHostContributionContractRegistry, NATIVE_TEXT_INPUT } =
    await import(pathToFileURL(path.join(hostDist, 'index.js')).href)
  const sources = []
  const loadRoot = async (label, directory, provenance, includeNative = false) => {
    const extensionRoots = hasAuthoredExtensionContainer(directory)
      ? [directory]
      : discoverAuthoredExtensionRoots(directory)
    const inputs = await Promise.all(extensionRoots.map(root => loadExtensionDirectory(root)))
    const inventory = await buildInventory(
      [...(includeNative ? [NATIVE_TEXT_INPUT] : []), ...inputs],
      createHostContributionContractRegistry(),
    )
    const errors = [
      ...inventory.diagnostics,
      ...inventory.extensions.flatMap(extension =>
        extension.contributions.flatMap(contribution => contribution.diagnostics),
      ),
    ].filter(value => value.severity === 'error')
    if (errors.length > 0) {
      throw new Error(
        `${label} inventory has errors: ${errors.map(value => value.code).join(', ')}`,
      )
    }
    sources.push({ label, inventory, provenance })
  }

  if (roots.length === 0 && snapshots.length === 0) {
    await loadRoot(
      'core',
      path.join(repoRoot, 'extensions'),
      { label: 'core', kind: 'working-tree', path: 'extensions + packages/host/native-text' },
      true,
    )
  }
  for (const root of roots) {
    await loadRoot(root.label, root.directory, {
      label: root.label,
      kind: 'explicit-root',
      path: toPosixPath(path.resolve(root.directory)),
    })
  }
  for (const snapshot of snapshots) {
    if (!/^[0-9a-f]{40}$/u.test(snapshot.commit)) {
      throw new Error(`snapshot ${snapshot.label} requires a full 40-character lowercase commit`)
    }
    const verified = spawnSync(
      'git',
      ['-C', snapshot.repository, 'rev-parse', '--verify', `${snapshot.commit}^{commit}`],
      { encoding: 'utf8' },
    )
    if (verified.status !== 0 || verified.stdout.trim() !== snapshot.commit) {
      throw new Error(`snapshot ${snapshot.label} commit ${snapshot.commit} is unavailable`)
    }
    const directory = await mkdtemp(path.join(tmpdir(), 'modkit-surface-snapshot-'))
    const archive = path.join(directory, 'snapshot.tar')
    const tree = path.join(directory, 'tree')
    try {
      const archived = spawnSync(
        'git',
        ['-C', snapshot.repository, 'archive', '--format=tar', '-o', archive, snapshot.commit],
        { encoding: 'utf8' },
      )
      if (archived.status !== 0) throw new Error(archived.stderr.trim() || 'git archive failed')
      await mkdir(tree)
      const extracted = spawnSync('tar', ['-xf', archive, '-C', tree], { encoding: 'utf8' })
      if (extracted.status !== 0)
        throw new Error(extracted.stderr.trim() || 'tar extraction failed')
      await loadRoot(snapshot.label, tree, {
        label: snapshot.label,
        kind: 'git-snapshot',
        commit: snapshot.commit,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  return sources
}
