/**
 * Product-GA application matrix.
 *
 * This is deliberately more than a list of application names. One real repository PNG is opened
 * through the production composition root of every non-MCP product surface, and every opened
 * session must publish and answer the same standard byte-range contract. The CLI row crosses a
 * real process boundary. MCP is named in the machine-readable matrix but remains owned by its
 * separate real Client/Server corpus, so this suite cannot accidentally replace that stronger
 * proof with an in-process shortcut.
 *
 * Window rendering is not a host capability and is therefore not fabricated here. The exact
 * UI-only remainders live beside each row in product-ga-app-matrix.json.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { openFileArtifactSource } from '@modkitx-x3/host/node'
import type { ArtifactByteSource, ResourceBudget } from '@modkitx-x3/sdk'
import { createAutomationHost } from '../src/index.js'
import { createElectronSubjectServices } from '../../electron/src/index.js'
import { createServerApp } from '../../server/src/index.js'
import { createVsCodeCommandOpener, createVsCodeSubjectHost } from '../../vscode/src/host.js'
import { WEB_EXTENSION_CATALOG } from '../../web/generated/extension-catalog.js'
import { createWebSubjectServices } from '../../web/src/subjects.js'
import {
  diskOrigin,
  domGlobals,
  fileSource,
  identity,
  nodeModuleMap,
  ORIGIN,
  probe,
  spawned,
} from '../../web/test/browser-harness.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const subject = join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png')
const images = join(repositoryRoot, 'extensions', 'images')
const cli = join(repositoryRoot, 'apps', 'cli', 'dist', 'main.js')
const matrix = JSON.parse(
  readFileSync(join(import.meta.dirname, 'product-ga-app-matrix.json'), 'utf8'),
) as {
  readonly schemaVersion: number
  readonly subject: string
  readonly formatId: string
  readonly dataSource: string
  readonly surfaces: readonly {
    readonly id: string
    readonly execution: string
    readonly uiRemainder: string | null
  }[]
}

const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const grant = { id: 'product-ga-app-matrix', classes: ['read-source'] } as const

interface SessionLike {
  descriptor(): Promise<unknown>
  dataSource(
    contract: string,
    major: number,
  ): Promise<{
    readonly value: unknown
    release(): Promise<void>
  }>
  dispose(): Promise<void>
}

async function assertOpenedSession(session: SessionLike): Promise<void> {
  const descriptor = (await session.descriptor()) as {
    readonly identity: { readonly formatId: string }
    readonly dataSources: readonly { readonly contract: string; readonly major: number }[]
  }
  expect(descriptor.identity.formatId).toBe(matrix.formatId)
  expect(descriptor.dataSources).toContainEqual({ contract: matrix.dataSource, major: 1 })
  const lease = await session.dataSource(matrix.dataSource, 1)
  const bytes = lease.value as {
    size(): Promise<bigint>
    read(offset: bigint, length: number): Promise<Uint8Array>
  }
  expect(await bytes.size()).toBe(BigInt(readFileSync(subject).byteLength))
  expect([...(await bytes.read(0n, 8))]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await lease.release()
  await session.dispose()
}

async function assertNodeOpen(
  open: (request: {
    readonly source: ArtifactByteSource
    readonly path: string
    readonly intent: 'inspect'
    readonly grant: typeof grant
    readonly budget: ResourceBudget
  }) => Promise<{
    readonly state: string
    readonly selected?: { readonly contributionId: string; readonly variantId: string }
    readonly session?: SessionLike
  }>,
): Promise<void> {
  const result = await open({
    source: await openFileArtifactSource(subject),
    path: subject,
    intent: 'inspect',
    grant,
    budget,
  })
  expect(result.state).toBe('opened')
  expect(result.selected).toMatchObject({
    contributionId: 'org.modkitx/image-png',
    variantId: 'portable',
  })
  if (result.session === undefined)
    throw new Error('the application surface did not return a session')
  await assertOpenedSession(result.session)
}

describe('Product-GA application matrix', () => {
  it('is complete and names every UI-only remainder instead of turning it into a runtime claim', () => {
    expect(matrix.schemaVersion).toBe(1)
    expect(matrix.subject).toBe('apps/web/public/favicon-32.png')
    expect(matrix.surfaces.map(row => row.id)).toEqual([
      'vscode',
      'electron',
      'web',
      'cli',
      'automation',
      'server',
      'mcp',
    ])
    expect(matrix.surfaces.find(row => row.id === 'mcp')?.execution).toBe(
      'separate-real-client-server-corpus',
    )
    for (const row of matrix.surfaces) {
      expect(row.execution).not.toBe('declared-only')
      if (row.uiRemainder !== null) expect(row.uiRemainder.length).toBeGreaterThan(20)
    }
  })

  it('opens and reads the common subject through the VS Code host path', async () => {
    const host = await createVsCodeSubjectHost({
      catalogCandidates: [],
      configuredExtensions: [images],
    })
    const answer = await createVsCodeCommandOpener({
      services: host.services,
      roots: () => [dirname(subject)],
    })(subject)
    expect(answer.snapshot.state).toBe('opened')
    if (answer.snapshot.state !== 'opened') throw new Error('VS Code did not open the subject')
    expect(answer.snapshot.selected).toMatchObject({
      contributionId: 'org.modkitx/image-png',
      variantId: 'portable',
    })
    if (answer.session === undefined) throw new Error('VS Code did not return a subject session')
    await assertOpenedSession(answer.session)
  }, 30_000)

  it('opens and reads the common subject through the Electron main-process host path', async () => {
    const services = await createElectronSubjectServices([images])
    await assertNodeOpen(request => services.open(request))
  }, 30_000)

  it('opens and reads the common subject through the production browser-worker path', async () => {
    const origin = diskOrigin()
    spawned.splice(0)
    const services = await createWebSubjectServices({
      baseUrl: ORIGIN,
      catalog: WEB_EXTENSION_CATALOG,
      identity,
      probe,
      dom: domGlobals(origin.fetch),
      moduleMap: nodeModuleMap,
    })
    const result = await services.open({
      source: fileSource(subject, 'favicon-32.png'),
      path: 'favicon-32.png',
      intent: 'inspect',
      grant,
      budget,
    })
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') throw new Error(result.reason)
    expect(result.selected).toMatchObject({
      contributionId: 'org.modkitx/image-png',
      variantId: 'portable',
    })
    expect(spawned).toHaveLength(1)
    await assertOpenedSession(result.session)
  }, 30_000)

  it('opens and reads the common subject through the real CLI process', () => {
    const result = spawnSync(process.execPath, [cli, 'open', subject, '--ext', images, '--json'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    const report = JSON.parse(result.stdout) as {
      readonly state: string
      readonly selected: { readonly contributionId: string; readonly variantId: string }
      readonly descriptor: {
        readonly identity: { readonly formatId: string }
        readonly dataSources: readonly { readonly contract: string; readonly major: number }[]
      }
    }
    expect(report).toMatchObject({
      state: 'opened',
      selected: { contributionId: 'org.modkitx/image-png', variantId: 'portable' },
      descriptor: { identity: { formatId: matrix.formatId } },
    })
    expect(report.descriptor.dataSources).toContainEqual({ contract: matrix.dataSource, major: 1 })
  }, 40_000)

  it('opens and reads the common subject through the automation host path', async () => {
    const host = await createAutomationHost([], { extensionRoots: [images] })
    await assertNodeOpen(request => host.subjects.open(request))
  }, 30_000)

  it('opens and reads the common subject through the server host path', async () => {
    const app = await createServerApp([], { extensionRoots: [images] })
    await assertNodeOpen(request => app.subjects.open(request))
  }, 30_000)
})
