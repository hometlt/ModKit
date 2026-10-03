import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { revisionId, type ArtifactNamespaceSource, type ResourceBudget } from '@modkit/sdk'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
} from '../src/index.js'
import { loadExtensionDirectory } from '../src/node/index.js'
import { openSubject } from '../src/subject-open.js'

// The composition fixture with its semantic alias marked by a file, as a resource pack is.
const fixture = fileURLToPath(
  new URL('./fixtures/subject-open-container-extension/', import.meta.url),
)
const copy = mkdtempSync(join(tmpdir(), 'x3-container-marker-'))
afterAll(() => rmSync(copy, { recursive: true, force: true }))
cpSync(fixture, copy, { recursive: true })
const semanticPath = join(copy, 'contributions', 'semantic.json')
const semantic = JSON.parse(readFileSync(semanticPath, 'utf8'))
semantic.spec.container.markers = ['pack.mcmeta']
writeFileSync(semanticPath, JSON.stringify(semantic, null, 2))

const budget: ResourceBudget = {
  maxInputBytes: 1_048_576n,
  maxDepth: 8,
  maxNodes: 64,
  maxScalarBytes: 65_536,
  maxDiagnostics: 32,
  deadlineMs: 10_000,
}

function folder(paths: readonly string[]): ArtifactNamespaceSource {
  const uri = 'memory://container-marker/pack'
  const revision = revisionId('provider-token:pack')
  return Object.freeze({
    kind: 'namespace',
    ref: Object.freeze({ id: uri, uri }),
    revision,
    async openNamespace() {
      return Object.freeze({
        value: Object.freeze({
          revision,
          async *list() {
            for (const path of paths)
              yield { path, kind: path.includes('.') ? ('file' as const) : ('directory' as const) }
          },
          async open() {
            throw new Error('the probe needs no bytes')
          },
        }),
        release: async () => undefined,
      })
    },
  }) as ArtifactNamespaceSource
}

describe('a folder its container alias marks by a file', () => {
  it('is offered to that alias codec, as its container unpacked', async () => {
    const input = await loadExtensionDirectory(copy)
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
    const result = await openSubject({
      inventory,
      source: folder(['pack.mcmeta', 'Base.SC2Data', 'Base.SC2Data/world.bin']),
      path: 'pack',
      intent: 'inspect',
      target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
      grant: { id: 'marked-folder', classes: ['read-source'] },
      executionBackends,
      budget,
    })
    // before, the alias codec was never a candidate for a folder: 'no-candidate'
    expect(result.state === 'opened' || result.reason !== 'no-candidate').toBe(true)
    if (result.state === 'opened') {
      expect(result.selected.contributionId).toBe('org.example/test-semantic')
      await result.session.dispose()
    }
  })
})
