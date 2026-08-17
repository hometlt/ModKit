import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bindingId, presentationSlotId, revisionId, type ArtifactByteSource } from '@modkitx-x3/sdk'
import { createElectronSubjectServices, resolveElectronPresentationPlan } from '../src/index.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')

function memorySource(text: string): ArtifactByteSource {
  const bytes = new TextEncoder().encode(text)
  return {
    kind: 'bytes',
    ref: { id: 'memory://electron/document.json', uri: 'memory://electron/document.json' },
    revision: revisionId('content-hash.sha256:electron-json-fixture'),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

describe('Electron host-owned subject services', () => {
  it('loads a generated bundled input and opens JSON in the main realm', async () => {
    const services = await createElectronSubjectServices([
      join(repositoryRoot, 'extensions', 'common', 'text-json'),
    ])
    expect(services.application.main.inventory.extensions).toHaveLength(1)
    expect(services.supportedExtensions).toEqual(['json', 'jsonc'])

    const result = await services.open({
      source: memorySource('{"ready":true}'),
      path: 'document.json',
      intent: 'full',
      grant: { id: 'electron-test', classes: ['read-source'] },
      budget: {
        maxInputBytes: 1_000_000n,
        maxDepth: 128,
        maxNodes: 100_000,
        maxScalarBytes: 1_000_000,
        maxDiagnostics: 100,
      },
    })
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') throw new TypeError(result.reason)
    expect(result.selected).toMatchObject({
      contributionId: 'org.modkitx/text-json',
      variantId: 'trusted-node',
    })
    const presentation = await resolveElectronPresentationPlan(
      result.descriptor,
      [
        {
          slotId: presentationSlotId('tree'),
          kind: 'stage',
          contributionId: 'org.modkitx.ui/tree',
          extensionId: 'org.modkitx/ui',
          priority: 600,
          bindings: [
            {
              bindingId: bindingId('tree-content'),
              contract: 'common.view/tree-data-source',
              major: 1,
            },
          ],
        },
        {
          slotId: presentationSlotId('hex'),
          kind: 'stage',
          contributionId: 'org.modkitx.ui/hex',
          extensionId: 'org.modkitx/ui',
          priority: 100,
          bindings: [
            {
              bindingId: bindingId('hex-content'),
              contract: 'common.view/byte-range-source',
              major: 1,
            },
          ],
        },
      ],
      {
        sessionId: 'electron-session',
        contributionId: result.selected.contributionId,
        variantId: result.selected.variantId,
      },
    )
    expect(presentation).toMatchObject({ activeStage: 'tree', alternateStages: ['hex'] })
    const tree = await result.session.dataSource('common.view/tree-data-source', 1)
    await expect(tree.value.root()).resolves.toMatchObject({ id: 'root', hasChildren: true })
    await tree.release()
    await result.session.dispose()
  })
})
