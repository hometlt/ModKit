import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { revisionId, type ArtifactByteSource } from '@modkitx-x3/sdk'
import type { Diagnostic } from '@modkitx-x3/core'
import {
  codecFidelityEvidenceRecords,
  createElectronSubjectServices,
  ELECTRON_WORKER_REALM,
  resolveElectronPresentationPlan,
} from '../src/index.js'

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
  it('re-exports every host editing helper that the CommonJS main process composes', () => {
    expect(codecFidelityEvidenceRecords).toBeTypeOf('function')
  })

  it('loads a generated bundled input and opens JSON in the worker realm: portable variant, worker-brokered, provider proxied through the host', async () => {
    const backendDiagnostics: Diagnostic[] = []
    const services = await createElectronSubjectServices(
      [join(repositoryRoot, 'extensions', 'common', 'data', 'text-json')],
      { onDiagnostic: diagnostic => void backendDiagnostics.push(diagnostic) },
    )
    expect(services.application.main.inventory.extensions).toHaveLength(1)
    expect(services.supportedExtensions).toEqual(['json', 'jsonc'])
    expect(services.executionProfiles).toEqual(['trusted-in-process', 'worker-brokered'])
    expect(services.application.workers.profile.realmId).toBe(ELECTRON_WORKER_REALM)
    expect(services.application.workers.target.environment).toBe('node-worker')

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
      variantId: 'portable',
    })
    // the honest SB-1 statement travels with the open result (gate) and to the app sink (backend)
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
    expect(result.diagnostics.map(item => item.code)).not.toContain(
      'x3.host/full-process-authority',
    )
    // codec worker + json-syntax provider worker: two activations, two notices
    expect(
      backendDiagnostics.filter(item => item.code === 'x3.host/worker-shared-process'),
    ).toHaveLength(2)
    const presentation = await resolveElectronPresentationPlan(
      result.descriptor,
      {
        sessionId: 'electron-session',
        contributionId: result.selected.contributionId,
        variantId: result.selected.variantId,
      },
      { sourceBytes: BigInt(new TextEncoder().encode('{"ready":true}').byteLength) },
    )
    expect(presentation).toMatchObject({ activeStage: 'code', alternateStages: ['tree'] })
    const tree = await result.session.dataSource('common.view/tree-data-source', 1)
    await expect(tree.value.root()).resolves.toMatchObject({ id: 'root', hasChildren: true })
    await tree.release()
    await result.session.dispose()
    // the workers went away with the session: nothing crashed, nothing restarted
    expect(backendDiagnostics.some(item => item.code === 'x3.host/worker-crashed')).toBe(false)
    expect(backendDiagnostics.some(item => item.code === 'x3.host/worker-restarted')).toBe(false)
  }, 30_000)
})
