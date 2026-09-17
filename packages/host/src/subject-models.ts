/**
 * Related models on subject cards, resolved by the host.
 *
 * A facts producer only names a model (`identity.model`, a logical id such as the model an SC2 unit
 * is drawn with). The host resolves that name through the subject's own resource session (the
 * subject, its dependencies, the installation) and converts it with the same model port the world
 * scene uses, then offers the result on the facts source as `openModel`, `openModelMaterials` and
 * `openModelResources`. A card mounts its model stage over those leases; it never sees a path.
 */

import type {
  AssetSession,
  Lease,
  ModelMaterialRef,
  ModelResourceAsset,
  ModelResourcePort,
  ModelResourceRef,
  Page,
  PageRequest,
  SubjectFactsSource,
  SubjectSelectorSource,
} from '@modkit/sdk'

const FACTS = 'common.view/subject-facts-source'
const SELECTOR = 'common.view/subject-selector-source'
/** Converted-model bytes one card preview may hold. */
const MODEL_PREVIEW_BYTES = 64 * 1024 * 1024
const FACET_RECORDS = 4_096

type Acquired = { readonly asset: ModelResourceAsset; release(): Promise<void> }

function withModel(facts: SubjectFactsSource, port: ModelResourcePort): SubjectFactsSource {
  // One conversion per facts source, shared by the scene and facet leases, released with the last.
  let shared: { lease: Promise<Lease<ModelResourceAsset>>; users: number } | undefined
  const acquire = async (signal?: AbortSignal): Promise<Acquired> => {
    const { model: logicalId, modelMetersPerSourceUnit } = (await facts.summary(signal)).identity
    if (logicalId === undefined || logicalId.length === 0) {
      throw new TypeError('this subject names no model')
    }
    const entry = (shared ??= {
      users: 0,
      lease: port.acquire({
        requirement: {
          id: 'subject-model',
          logicalId,
          role: 'sidecar',
          scopes: [
            'sibling-directory',
            'current-mount',
            'enclosing-container',
            'workspace-dependency-layer',
          ],
        },
        maxBytes: MODEL_PREVIEW_BYTES,
        ...(modelMetersPerSourceUnit === undefined ? {} : { metersPerSourceUnit: modelMetersPerSourceUnit }),
      }),
    })
    entry.users += 1
    let released = false
    const release = async () => {
      if (released) return
      released = true
      entry.users -= 1
      if (entry.users > 0) return
      if (shared === entry) shared = undefined
      await (await entry.lease).release()
    }
    try {
      const { value: asset } = await entry.lease
      if (asset.result.state !== 'converted') {
        throw new TypeError(
          asset.result.diagnostics.map(item => item.message).join('; ') ||
            `model ${logicalId} did not resolve`,
        )
      }
      return { asset, release }
    } catch (error) {
      if (shared === entry) shared = undefined
      await release().catch(() => undefined)
      throw error
    }
  }
  const facet = async <Value>(
    signal: AbortSignal | undefined,
    build: (asset: ModelResourceAsset) => Value | undefined,
  ): Promise<Lease<Value>> => {
    const { asset, release } = await acquire(signal)
    const value = build(asset)
    if (value === undefined) {
      await release()
      throw new TypeError('the converted model does not publish this facet')
    }
    return Object.freeze({ value, release })
  }
  const count = async <Item>(
    read: (request: PageRequest, signal?: AbortSignal) => Promise<Page<Item>>,
    signal?: AbortSignal,
  ): Promise<{ items: number; truncated: boolean }> => {
    let items = 0
    let cursor: string | undefined
    do {
      const page = await read({ limit: 256, ...(cursor === undefined ? {} : { cursor }) }, signal)
      items += page.items.length
      cursor = page.nextCursor
    } while (cursor !== undefined && items < FACET_RECORDS)
    return { items, truncated: cursor !== undefined }
  }
  return Object.freeze({
    summary: (signal?: AbortSignal) => facts.summary(signal),
    groups: (page: PageRequest, signal?: AbortSignal) => facts.groups(page, signal),
    facts: (groupId: string, page: PageRequest, signal?: AbortSignal) =>
      facts.facts(groupId, page, signal),
    relations: (page: PageRequest, signal?: AbortSignal) => facts.relations(page, signal),
    openModel: (signal?: AbortSignal) =>
      facet(signal, asset => {
        const { sceneInfo, nodes, meshes, primitive } = asset
        if (sceneInfo === undefined || nodes === undefined || meshes === undefined) return undefined
        return Object.freeze({
          info: sceneInfo,
          nodes,
          meshes,
          ...(primitive === undefined ? {} : { primitive }),
        })
      }),
    openModelMaterials: (signal?: AbortSignal) =>
      facet(signal, asset => {
        const materials = asset.materials
        if (materials === undefined) return undefined
        return Object.freeze({
          materials,
          info: async (abort?: AbortSignal) => ({
            materials: (await count<ModelMaterialRef>(materials, abort)).items,
          }),
        })
      }),
    openModelResources: (signal?: AbortSignal) =>
      facet(signal, asset => {
        const references = asset.resourceReferences
        if (references === undefined) return undefined
        return Object.freeze({
          references,
          info: async (abort?: AbortSignal) => {
            const counted = await count<ModelResourceRef>(references, abort)
            return { references: counted.items, bound: 0, truncated: counted.truncated }
          },
        })
      }),
  })
}

function withModelSelector(
  selector: SubjectSelectorSource,
  port: ModelResourcePort,
): SubjectSelectorSource {
  return Object.freeze({
    summary: (signal?: AbortSignal) => selector.summary(signal),
    subjects: (query: Parameters<SubjectSelectorSource['subjects']>[0], signal?: AbortSignal) =>
      selector.subjects(query, signal),
    openFacts: async (subjectId: string, signal?: AbortSignal) => {
      const lease = await selector.openFacts(subjectId, signal)
      return Object.freeze({ value: withModel(lease.value, port), release: () => lease.release() })
    },
    openCalculations: (subjectId: string, signal?: AbortSignal) =>
      selector.openCalculations(subjectId, signal),
    ...(selector.editTarget === undefined
      ? {}
      : { editTarget: selector.editTarget.bind(selector) }),
    ...(selector.isolation === undefined ? {} : { isolation: selector.isolation.bind(selector) }),
    ...(selector.isolationPlan === undefined
      ? {}
      : { isolationPlan: selector.isolationPlan.bind(selector) }),
  })
}

/**
 * The session's data sources with related models attached to every facts source it hands out:
 * its own and the ones its subject selector lends.
 */
export function subjectModelDataSources(
  dataSource: AssetSession['dataSource'],
  port: ModelResourcePort,
): AssetSession['dataSource'] {
  return (async (contract: string, major: number) => {
    const lease = (await dataSource(contract as never, major as never)) as Lease<unknown>
    if (major !== 1 || (contract !== FACTS && contract !== SELECTOR)) return lease
    const value =
      contract === FACTS
        ? withModel(lease.value as SubjectFactsSource, port)
        : withModelSelector(lease.value as SubjectSelectorSource, port)
    return Object.freeze({ value, release: () => lease.release() })
  }) as AssetSession['dataSource']
}
