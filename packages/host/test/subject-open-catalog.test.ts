import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  revisionId,
  type ArtifactByteSource,
  type DataResolvedEntity,
  type ResourceBudget,
  type SubjectCatalogPort,
} from '@modkit/sdk'
import type { ContentSources, ModContextRequest } from '@modkit/vfs/content-sources'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
} from '../src/index.js'
import { loadExtensionDirectory } from '../src/node/index.js'
import { openSubject } from '../src/subject-open.js'

const fixture = fileURLToPath(new URL('./fixtures/subject-catalog-extension/', import.meta.url))
const budget: ResourceBudget = {
  maxInputBytes: 1024n,
  maxDepth: 8,
  maxNodes: 8,
  maxScalarBytes: 1024,
  maxDiagnostics: 8,
}

it('a codec asks the resolved catalog of its subject mod context, opened on the first question', async () => {
  const requests: ModContextRequest[] = []
  let disposed = 0
  const contentSources = {
    async openModContext(request: ModContextRequest) {
      requests.push(request)
      return {
        query: async (question: { refs: readonly { namespace: string; entityId: string }[] }) => ({
          entities: question.refs.map(ref => ({
            ...ref,
            // Liberty's value, inherited by the mod that does not set it
            fields: { LifeMax: '45' },
            complete: true,
          })),
        }),
        dispose: async () => {
          disposed += 1
        },
      }
    },
  } as unknown as ContentSources
  const input = await loadExtensionDirectory(fixture)
  const inventory = await buildInventory(
    [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
    createHostContributionContractRegistry(),
  )
  const executionBackends = createExecutionBackendRegistry([
    {
      profile: 'trusted-in-process',
      supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
      async activate(context) {
        return {
          module: (await import(context.entrypoint.href)) as Record<string, unknown>,
          release: async () => undefined,
        }
      },
    },
  ])
  const uri = 'file:///C:/Mods/Probe.SC2Mod/Base.SC2Data/GameData/UnitData.card'
  const bytes = new TextEncoder().encode('Unit/Marine')
  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('provider-token:catalog-card'),
    size: BigInt(bytes.byteLength),
    read: async (offset, length) => bytes.slice(Number(offset), Number(offset) + length),
    async *stream() {
      yield bytes
    },
  }
  const holder = globalThis as { __x3SubjectCatalog?: SubjectCatalogPort }
  delete holder.__x3SubjectCatalog
  const result = await openSubject({
    inventory,
    source,
    path: 'UnitData.card',
    intent: 'full',
    target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
    grant: { id: 'catalog-card', classes: ['read-source'] },
    executionBackends,
    budget,
    subjectCatalog: { contentSources: async () => contentSources },
  })
  expect(result.state).toBe('opened')
  if (result.state !== 'opened') return
  const catalog = holder.__x3SubjectCatalog
  expect(catalog).toBeDefined()
  // nothing opens a mod context until the codec asks
  expect(requests).toEqual([])
  const answered: readonly DataResolvedEntity[] = await catalog!.entities([
    { namespace: 'Unit', entityId: 'Marine' },
  ])
  expect(answered).toMatchObject([
    { namespace: 'Unit', entityId: 'Marine', fields: { LifeMax: '45' } },
  ])
  await catalog!.entities([{ namespace: 'Unit', entityId: 'Hero' }])
  expect(requests).toEqual([
    { schemaVersion: 1, target: 'C:/Mods/Probe.SC2Mod/Base.SC2Data/GameData/UnitData.card' },
  ])
  await result.session.dispose()
  expect(disposed).toBe(1)
})
