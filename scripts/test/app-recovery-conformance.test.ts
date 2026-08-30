/**
 * Block 20 app lifecycle matrix.
 *
 * The existing command-contract matrix proves that every product calls the shared command
 * runtime. This suite drives those real app-shaped boundaries through the failure cases that were
 * still missing from the release candidate: denied authority, cancellation, endpoint restart and
 * worker crash recovery. There is no game or format branch here; one deliberately permissioned
 * test extension and the host's existing crashy worker fixture are used for every row.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Diagnostic } from '@modkitx-x3/core'
import type {
  ContributionContext,
  PermissionGrant,
  ResourceBudget,
  RuntimeVariantDeclaration,
} from '@modkitx-x3/sdk'
import {
  commandRequest,
  commandSubjectsFrom,
  createSubjectCommandEndpoint,
  createSubjectCommandRuntime,
  createSubjectServices,
  executeCommandRequest,
  type CommandReceipt,
  type ExtensionInput,
  type SubjectServices,
} from '@modkitx-x3/host'
import {
  createNodeSubjectServices,
  createPathSubjectOpener,
  loadExtensionDirectory,
  openFileArtifactSource,
  type NodeSubjectServices,
} from '@modkitx-x3/host/node'
import {
  activateExecutionBackend,
  type ExecutionBackendActivation,
  type ExecutionModuleLease,
} from '../../packages/host/src/execution/backend.js'
import type { ActivationTicket } from '../../packages/host/src/security/gate.js'
import { createAutomationHost, type AutomationHost } from '../../apps/automation-host/src/index.js'
import { createElectronApp, type ElectronApp } from '../../apps/electron/src/index.js'
import { runCommand } from '../../apps/cli/src/commands.js'
import { createModkitCliSubjectServices } from '../../apps/cli/src/profile.js'
import {
  createVsCodeDesktopTopology,
  VSCODE_DESKTOP_EXTENSION_REALM,
  VSCODE_DESKTOP_WORKER_REALM,
  VSCODE_WORKER_POLICY,
} from '../../apps/vscode/src/index.js'
import { createVsCodeCommandOpener } from '../../apps/vscode/src/host.js'
import { createServerApp, type ServerApp } from '../../apps/server/src/index.js'
import { createWebCommandProtocol } from '../../apps/web/src/commands.js'
import { createWebApp, type WebApp } from '../../apps/web/src/index.js'
import type { WebFileAccess } from '../../apps/web/src/files.js'

const APPLICATIONS = Object.freeze([
  'cli',
  'automation-host',
  'server',
  'electron',
  'pwa',
  'vscode',
] as const)
type Application = (typeof APPLICATIONS)[number]

const READ_GRANT: PermissionGrant = Object.freeze({
  id: 'block20-app-matrix',
  classes: ['read-source'] as const,
})
const OPEN_BUDGET = Object.freeze({
  maxInputBytes: 1_048_576n,
  maxDepth: 16,
  maxNodes: 1_000,
  maxScalarBytes: 1_048_576,
  maxDiagnostics: 100,
})
const CRASH_CONTEXT_BUDGET = {
  maxInputBytes: '1048576',
  maxDepth: 8,
  maxNodes: 1_000,
  maxScalarBytes: 4_096,
  maxDiagnostics: 16,
} as unknown as ResourceBudget

interface AppFixture {
  readonly name: Application
  readonly services: SubjectServices
  readonly diagnostics: Diagnostic[]
}

let extensionRoot = ''
let guardedFile = ''
let extension: ExtensionInput
let automation: AutomationHost
let server: ServerApp
let electron: ElectronApp
let web: WebApp
let vscodeSubjects: NodeSubjectServices
let apps: readonly AppFixture[] = []

const crashFixtureRoot = pathToFileURL(
  `${join(import.meta.dirname, '..', '..', 'packages', 'host', 'test', 'fixtures', 'worker-codec')}${sep}`,
)
const crashEntrypoint = new URL('crashy.mjs', crashFixtureRoot)

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function writePermissionFixture(): void {
  extensionRoot = mkdtempSync(join(tmpdir(), 'modkit-block20-app-matrix-'))
  mkdirSync(join(extensionRoot, 'contributions'))
  mkdirSync(join(extensionRoot, 'src'))
  guardedFile = join(extensionRoot, 'denied.guarded')
  writeFileSync(guardedFile, 'permission must fail before this source is activated\n', 'utf8')
  writeFileSync(
    join(extensionRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'modkit-block20-permission-fixture',
        version: '1.0.0',
        license: 'MIT',
        type: 'module',
        modkit: {
          schemaVersion: 1,
          publisher: 'org.modkitx.test',
          id: 'block20-permission-fixture',
          contributionManifests: ['./contributions/*.json'],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  writeFileSync(
    join(extensionRoot, 'contributions', 'codec-guarded.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        contract: { id: 'org.modkitx/codec-contribution', major: 1 },
        id: 'org.modkitx.test/block20-permission-codec',
        displayName: 'Block 20 permission fixture',
        runtimeVariants: [
          {
            variantId: 'portable',
            entrypoint: './src/codec.js',
            target: { environments: ['browser-worker', 'node-worker'] },
            executionProfile: 'worker-brokered',
            requestedPermissionClasses: ['read-source', 'process-launch'],
          },
        ],
        spec: {
          formatRefs: [{ formatId: 'block20-guarded', label: 'Block 20 guarded fixture' }],
          roles: ['semantic'],
          sourceTopology: 'single',
          artifactStages: ['authored'],
          openIntents: ['probe', 'inspect', 'full'],
          match: { extensions: ['guarded'] },
          probe: {
            kind: 'bytes',
            ranges: [{ from: 'start', length: 64 }],
            maxBytes: 64,
          },
          representations: [
            {
              id: 'guarded',
              contract: 'org.modkitx.test/block20-guarded',
              major: 1,
              stage: 'authored',
              lossy: false,
            },
          ],
          publishesDataSources: [],
          operations: [],
          implementationTier: { claimed: 1 },
          budgets: {
            maxInputBytes: '1048576',
            maxDepth: 16,
            maxNodes: 1000,
            maxScalarBytes: 1048576,
            maxDiagnostics: 100,
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  writeFileSync(
    join(extensionRoot, 'src', 'codec.js'),
    [
      'export const abiVersion = 1',
      'export function createCodec() {',
      "  throw new Error('permission gate executed forbidden codec code')",
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
}

function pwaAccess(path: string): WebFileAccess {
  const bytes = new Uint8Array(readFileSync(path))
  const file = {
    name: 'denied.guarded',
    size: bytes.byteLength,
    lastModified: 1,
    slice: (start: number, end: number) => ({
      arrayBuffer: async (): Promise<ArrayBuffer> => bytes.slice(start, end).buffer,
    }),
  }
  const handle = { kind: 'file' as const, name: file.name, getFile: async () => file }
  return {
    label: 'block20-pwa-root',
    writeGrant: { queryPermission: async () => 'granted' },
    list: async () => [],
    sizeOf: id => (id === 'guarded' ? bytes.byteLength : undefined),
    handleOf: id => (id === 'guarded' ? handle : undefined),
    snapshotOf: async id =>
      id === 'guarded' ? { size: bytes.byteLength, lastModified: file.lastModified } : undefined,
    read: async (id, maximum, signal) => {
      signal?.throwIfAborted()
      if (id !== 'guarded') throw new TypeError('outside the granted PWA root')
      return bytes.slice(0, maximum)
    },
  }
}

function pathEndpoint(services: SubjectServices) {
  return createSubjectCommandEndpoint({
    openSubject: createPathSubjectOpener({
      subjects: services,
      roots: [extensionRoot],
      grant: READ_GRANT,
      budget: OPEN_BUDGET,
    }),
  })
}

async function captureCli(signal?: AbortSignal): Promise<CommandReceipt> {
  let stdout = ''
  let stderr = ''
  const exit = await runCommand(
    {
      command: 'subject.open',
      file: guardedFile,
      roots: [extensionRoot],
      trust: false,
      format: 'protocol-json',
    },
    {
      ...(signal === undefined ? {} : { signal }),
      writeStdout: text => void (stdout += text),
      writeStderr: text => void (stderr += text),
    },
  )
  expect(exit).toBe(1)
  expect(stderr).toBe('')
  return JSON.parse(stdout) as CommandReceipt
}

async function appCommandReceipts(
  signal?: AbortSignal,
): Promise<ReadonlyMap<Application, CommandReceipt>> {
  const request = commandRequest('subject.open', { subject: guardedFile })
  const electronEndpoint = pathEndpoint(
    createSubjectServices({
      inventory: electron.main.inventory,
      target: electron.workers.target,
      executionBackends: electron.executionBackends,
    }),
  )
  const pwaServices = apps.find(row => row.name === 'pwa')?.services
  if (pwaServices === undefined) {
    throw new Error('app fixture setup is incomplete')
  }
  const pwaProtocol = createWebCommandProtocol(pwaServices)
  const access = pwaAccess(guardedFile)
  const pwaSize = access.sizeOf('guarded')
  if (pwaSize === undefined) throw new Error('PWA permission fixture has no size')
  const pwaLease = pwaProtocol.authorize({
    access,
    entry: { id: 'guarded', name: 'denied.guarded', directory: false, size: pwaSize },
    request: { intent: 'full', grant: READ_GRANT, budget: OPEN_BUDGET },
  })
  const vscodeRuntime = createSubjectCommandRuntime()
  try {
    const rows = await Promise.all([
      captureCli(signal).then(receipt => ['cli', receipt] as const),
      automation
        .runCommand(request, {
          roots: [extensionRoot],
          ...(signal === undefined ? {} : { signal }),
        })
        .then(receipt => ['automation-host', receipt] as const),
      server
        .runCommand(request, {
          roots: [extensionRoot],
          ...(signal === undefined ? {} : { signal }),
        })
        .then(receipt => ['server', receipt] as const),
      electronEndpoint
        .execute(request, { ...(signal === undefined ? {} : { signal }) })
        .then(receipt => ['electron', receipt] as const),
      pwaProtocol
        .execute(commandRequest('subject.open', { subject: pwaLease.ref }), {
          ...(signal === undefined ? {} : { signal }),
        })
        .then(receipt => ['pwa', receipt] as const),
      executeCommandRequest(vscodeRuntime, request, {
        openSubject: commandSubjectsFrom(
          createVsCodeCommandOpener({
            services: vscodeSubjects,
            roots: () => [extensionRoot],
          }),
        ),
        ...(signal === undefined ? {} : { signal }),
      }).then(receipt => ['vscode', receipt] as const),
    ])
    return new Map(rows)
  } finally {
    pwaLease.revoke()
    await Promise.all([electronEndpoint.dispose(), pwaProtocol.dispose()])
    expect(electronEndpoint.activeRuns).toBe(0)
    expect(pwaProtocol.activeRuns).toBe(0)
  }
}

function crashActivation(app: AppFixture): ExecutionBackendActivation {
  const variant = {
    variantId: 'portable',
    executionProfile: 'worker-brokered',
    targets: [],
    entrypoint: 'crashy.mjs',
  } as unknown as RuntimeVariantDeclaration
  return {
    ticket: {
      contributionId: `org.modkitx.test/block20-${app.name}`,
      artifactDigest: sha256(new Uint8Array(readFileSync(crashEntrypoint))),
    } as unknown as ActivationTicket,
    entrypoint: crashEntrypoint,
    artifactRoot: crashFixtureRoot,
    variant,
    target: app.services.target,
    grant: READ_GRANT,
  }
}

function crashContext(): ContributionContext {
  return {
    budgets: CRASH_CONTEXT_BUDGET,
    diagnostics: { report: () => undefined },
    contracts: {} as ContributionContext['contracts'],
  }
}

function crashSource(path: '/ok' | '/crash') {
  const bytes = new Uint8Array([1, 2, 3])
  return {
    ref: { kind: 'file', path },
    revision: 'block20-crash-revision',
    kind: 'bytes',
    size: BigInt(bytes.byteLength),
    read: async (offset: bigint, length: number) =>
      bytes.slice(Number(offset), Number(offset) + length),
    stream: async function* () {
      yield bytes
    },
  }
}

beforeAll(async () => {
  writePermissionFixture()
  extension = await loadExtensionDirectory(extensionRoot)
  const diagnostics = new Map<Application, Diagnostic[]>(
    APPLICATIONS.map(name => [name, []] as const),
  )
  const cli = await createModkitCliSubjectServices([extension], {
    onDiagnostic: item => diagnostics.get('cli')?.push(item),
  })
  automation = await createAutomationHost([extension], {
    onDiagnostic: item => diagnostics.get('automation-host')?.push(item),
  })
  server = await createServerApp([extension], {
    onDiagnostic: item => diagnostics.get('server')?.push(item),
  })
  electron = await createElectronApp([extension], {
    onDiagnostic: item => diagnostics.get('electron')?.push(item),
  })
  vscodeSubjects = await createNodeSubjectServices({
    topology: createVsCodeDesktopTopology(),
    realms: {
      host: VSCODE_DESKTOP_EXTENSION_REALM,
      workers: VSCODE_DESKTOP_WORKER_REALM,
    },
    extensions: [extension],
    policy: VSCODE_WORKER_POLICY,
    onDiagnostic: item => diagnostics.get('vscode')?.push(item),
  })
  web = await createWebApp({ operatingSystem: 'windows', architecture: 'x64' }, [extension], {
    main: ['worker.module'],
    worker: [],
    sharedMemory: false,
  })
  const pwa = createSubjectServices({
    inventory: web.main.inventory,
    target: web.worker.target,
    executionBackends: web.worker.executionBackends,
  })
  apps = Object.freeze([
    { name: 'cli', services: cli, diagnostics: diagnostics.get('cli') ?? [] },
    {
      name: 'automation-host',
      services: automation.subjects,
      diagnostics: diagnostics.get('automation-host') ?? [],
    },
    { name: 'server', services: server.subjects, diagnostics: diagnostics.get('server') ?? [] },
    {
      name: 'electron',
      services: createSubjectServices({
        inventory: electron.main.inventory,
        target: electron.workers.target,
        executionBackends: electron.executionBackends,
      }),
      diagnostics: diagnostics.get('electron') ?? [],
    },
    { name: 'pwa', services: pwa, diagnostics: diagnostics.get('pwa') ?? [] },
    {
      name: 'vscode',
      services: vscodeSubjects,
      diagnostics: diagnostics.get('vscode') ?? [],
    },
  ])
})

afterAll(() => {
  if (extensionRoot !== '') rmSync(extensionRoot, { recursive: true, force: true })
})

describe('Block 20 six-app permission, cancellation and recovery matrix', () => {
  it('denies one undeclared process permission with the same typed command outcome in every app', async () => {
    const receipts = await appCommandReceipts()
    for (const app of apps) {
      const opened = await app.services.open({
        source: await openFileArtifactSource(guardedFile),
        path: guardedFile,
        intent: 'full',
        grant: READ_GRANT,
        budget: OPEN_BUDGET,
      })
      expect(opened.state, app.name).toBe('unresolved')
      const candidateCodes = opened.candidates.flatMap(candidate =>
        candidate.diagnostics.map(item => item.code),
      )
      const candidateMessages = opened.candidates.flatMap(candidate =>
        candidate.diagnostics.map(item => item.message),
      )
      if (app.name === 'pwa') {
        expect(candidateCodes, app.name).toContain('x3.host/codec-execution-unavailable')
      } else {
        expect(candidateCodes, app.name).toContain('x3.host/codec-resolution-unresolved')
        expect(
          candidateMessages.some(message => message.includes('permission-required')),
          app.name,
        ).toBe(true)
      }
      if (opened.state === 'opened') await opened.session.dispose()
    }
    expect([...receipts.keys()]).toEqual(APPLICATIONS)
    for (const application of APPLICATIONS) {
      const receipt = receipts.get(application)
      expect(receipt?.result, application).toMatchObject({
        state: 'failed',
        code: 'x3.command/subject-unresolved',
      })
    }
  }, 60_000)

  it('turns one pre-cancelled run into the same receipt and leaves no command session behind', async () => {
    const controller = new AbortController()
    controller.abort('block20 app matrix cancellation')
    const receipts = await appCommandReceipts(controller.signal)
    for (const application of APPLICATIONS) {
      expect(receipts.get(application)?.result, application).toMatchObject({
        state: 'failed',
        code: 'x3.command/cancelled',
      })
    }
  }, 60_000)

  it('recreates a disposed endpoint without carrying closed state or an active run across restart', async () => {
    for (const app of apps) {
      const stopped = pathEndpoint(app.services)
      await stopped.dispose()
      expect(stopped.closed, app.name).toBe(true)
      expect(stopped.activeRuns, app.name).toBe(0)
      const restarted = pathEndpoint(app.services)
      const receipt = await restarted.execute(
        commandRequest('org.modkitx.test/not-installed', { subject: guardedFile }),
      )
      expect(receipt.result, app.name).toMatchObject({
        state: 'failed',
        code: 'x3.command/unknown',
      })
      expect(restarted.activeRuns, app.name).toBe(0)
      await restarted.dispose()
      expect(restarted.activeRuns, app.name).toBe(0)
    }
  })

  it('recovers every Node app in a fresh worker generation and reports PWA as typed unavailable', async () => {
    const nodeApps = apps.filter(app => app.name !== 'pwa')
    const leases: ExecutionModuleLease[] = []
    try {
      for (const app of nodeApps) {
        const beforeDiagnosticCount = app.diagnostics.length
        const lease = await activateExecutionBackend(
          app.services.executionBackends,
          crashActivation(app),
        )
        leases.push(lease)
        const createCodec = lease.module['createCodec'] as (context: ContributionContext) => {
          probe(request: unknown): Promise<Readonly<Record<string, unknown>>>
        }
        const first = createCodec(crashContext())
        const before = await first.probe({ source: crashSource('/ok'), plan: {} })
        await expect(
          first.probe({ source: crashSource('/crash'), plan: {} }),
          app.name,
        ).rejects.toMatchObject({ code: 'x3.host/rpc-peer-exited' })
        const recovered = createCodec(crashContext())
        const after = await recovered.probe({ source: crashSource('/ok'), plan: {} })
        expect(after['confidence'], app.name).toBe(1)
        expect(after['threadId'], app.name).not.toBe(before['threadId'])
        const newDiagnostics = app.diagnostics.slice(beforeDiagnosticCount)
        expect(
          newDiagnostics.filter(item => item.code === 'x3.host/worker-restarted'),
          app.name,
        ).toHaveLength(1)
        await lease.release()
        leases.splice(leases.indexOf(lease), 1)
        await expect(
          recovered.probe({ source: crashSource('/ok'), plan: {} }),
          app.name,
        ).rejects.toMatchObject({
          code: 'x3.host/rpc-endpoint-closed',
        })
      }

      const pwa = apps.find(app => app.name === 'pwa')
      if (pwa === undefined) throw new Error('PWA fixture is missing')
      await expect(
        activateExecutionBackend(pwa.services.executionBackends, crashActivation(pwa)),
      ).rejects.toMatchObject({ code: 'x3.host/execution-backend-unavailable' })
    } finally {
      await Promise.all(leases.map(lease => lease.release().catch(() => undefined)))
    }
  }, 120_000)
})
