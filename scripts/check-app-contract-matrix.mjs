import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const cliMain = join(root, 'apps', 'modkit-cli', 'dist', 'main.js')
const counterRoot = join(root, 'extensions', '_reference', 'counter-runtime')

const UNKNOWN_COMMAND = 'org.modkitx.contract-matrix/not-installed'
const RUNTIME_ID = 'reference.counter'
const COMMAND_CALLERS = Object.freeze(['automation', 'cli', 'electron', 'pwa', 'server', 'vscode'])
const RUNTIME_BUDGET = Object.freeze({
  maxWallTimeMs: 1_000,
  maxTicks: 64,
  maxMemoryBytes: 1_048_576,
})
const ACTIVATION_BUDGET = Object.freeze({
  maxInputBytes: 1_048_576n,
  maxDepth: 32,
  maxNodes: 10_000,
  maxScalarBytes: 1_048_576,
  maxDiagnostics: 100,
})

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function fail(message) {
  throw new Error(`apps:check: command/runtime/session matrix ${message}`)
}

function cliJson(arguments_, expectedStatus) {
  const child = spawnSync(process.execPath, [cliMain, ...arguments_], {
    cwd: root,
    encoding: 'utf8',
  })
  if (child.error !== undefined) throw child.error
  if (child.status !== expectedStatus) {
    fail(
      `CLI ${arguments_.join(' ')} exited ${String(child.status)} instead of ${expectedStatus}: ${child.stderr}`,
    )
  }
  try {
    return JSON.parse(child.stdout)
  } catch (error) {
    fail(`CLI did not return JSON (${error instanceof Error ? error.message : String(error)})`)
  }
}

function runtimeRequest(services, application, runtimeId = RUNTIME_ID) {
  return {
    services,
    runtimeId,
    sessionId: `app-contract-${application}`,
    budget: RUNTIME_BUDGET,
    grant: { id: `app-contract-${application}`, classes: [] },
    activationBudget: ACTIVATION_BUDGET,
  }
}

async function checkRuntimeSession(openRuntimeSession, application, services) {
  const resolution = await openRuntimeSession(runtimeRequest(services, application))
  if (resolution.state !== 'resolved') {
    fail(
      `${application} did not resolve ${RUNTIME_ID}: ${resolution.diagnostics.map(item => item.code).join(', ')}`,
    )
  }
  try {
    const result = await resolution.session.execute({
      entrypoint: 'counter.advance',
      arguments: [3],
      resources: { wallTimeMs: 1, ticks: 2, memoryBytes: 16 },
    })
    const status = await resolution.session.status()
    if (
      result.state !== 'completed' ||
      result.value?.counter !== 3 ||
      status.state !== 'ready' ||
      status.executions !== 1 ||
      status.ticks !== 2 ||
      status.memoryBytes !== 16
    ) {
      fail(`${application} returned different runtime/session semantics`)
    }
    return Object.freeze({
      application,
      runtime: 'resolved',
      session: result.state,
      provider: resolution.providerId,
    })
  } finally {
    await resolution.release()
  }
}

/**
 * Execute one machine-readable matrix over every GA application root.
 *
 * Commands use each application's real boundary where it can be loaded without its GUI process.
 * Electron and VS Code additionally have source ratchets below because their production endpoints
 * are created inside Electron/VS Code lifecycle code. Runtime sessions use the reference provider
 * in every Node host; the PWA row exercises the same typed request refusal in its real topology,
 * while browser Worker execution remains in the browser-specific test suite.
 */
export async function checkAppContractMatrix() {
  const [server, automation, electron, web, webCommands, cli, vscode, host, runtime, nodeHost] =
    await Promise.all([
      import('../apps/server/dist/index.js'),
      import('../apps/automation-host/dist/index.js'),
      import('../apps/electron/dist/index.js'),
      import('../apps/web/dist/index.js'),
      import('../apps/web/dist/commands.js'),
      import('../apps/modkit-cli/dist/profile.js'),
      import('../apps/modkit-vscode/dist/host.js'),
      import('../packages/host/dist/index.js'),
      import('../packages/host/dist/runtime/index.js'),
      import('../packages/host/dist/node/index.js'),
    ])

  const canonicalCatalog = host.describeSubjectCommandContracts()
  const unknown = host.commandRequest(UNKNOWN_COMMAND, { subject: 'matrix.bin' })
  const refuseOpen = async () => {
    throw new Error('an unknown command must not open a subject')
  }
  const automationApp = await automation.createAutomationHost()
  const serverApp = await server.createServerApp()
  const electronEndpoint = host.createSubjectCommandEndpoint({ openSubject: refuseOpen })
  const pwaEndpoint = webCommands.createWebCommandProtocol({ open: refuseOpen })
  const vscodeRuntime = host.createSubjectCommandRuntime()

  const cliCatalog = cliJson(['commands', '--protocol-json'], 0)
  const cliReceipt = cliJson(
    [
      'run',
      UNKNOWN_COMMAND,
      'matrix.bin',
      '--ext',
      'matrix-extension-root',
      '--format',
      'protocol-json',
    ],
    1,
  )
  const commandRows = [
    { application: 'cli', catalog: cliCatalog, receipt: cliReceipt },
    {
      application: 'automation-host',
      catalog: automationApp.commandContracts,
      receipt: await automationApp.runCommand(unknown, { roots: [] }),
    },
    {
      application: 'server',
      catalog: serverApp.commandContracts,
      receipt: await serverApp.runCommand(unknown, { roots: [] }),
    },
    {
      application: 'electron',
      catalog: electronEndpoint.catalog,
      receipt: await electronEndpoint.execute(unknown),
    },
    {
      application: 'pwa',
      catalog: pwaEndpoint.catalog,
      receipt: await pwaEndpoint.execute(unknown),
    },
    {
      application: 'vscode',
      catalog: canonicalCatalog,
      receipt: await host.executeCommandRequest(vscodeRuntime, unknown, {
        openSubject: async () => {
          throw new Error('an unknown command must not open a subject')
        },
      }),
    },
  ]

  try {
    for (const row of commandRows) {
      if (!sameJson(row.catalog, canonicalCatalog)) {
        fail(`${row.application} command catalog drifted from the shared contract`)
      }
      if (
        row.receipt.schemaVersion !== canonicalCatalog.schemaVersion ||
        row.receipt.result.state !== 'failed' ||
        row.receipt.result.code !== 'x3.command/unknown'
      ) {
        fail(`${row.application} did not return the shared typed unknown-command refusal`)
      }
    }
    if (canonicalCatalog.commands.some(contract => !sameJson(contract.callers, COMMAND_CALLERS))) {
      fail('the shared command catalog does not name all six proved callers')
    }
  } finally {
    await Promise.all([electronEndpoint.dispose(), pwaEndpoint.dispose()])
  }

  const counter = await nodeHost.loadExtensionDirectory(counterRoot)
  const [cliServices, electronServices, vscodeHost] = await Promise.all([
    cli.createModkitCliSubjectServices([counter]),
    electron.createElectronSubjectServices([counterRoot]),
    vscode.createVsCodeSubjectHost({
      catalogCandidates: [],
      configuredExtensions: [counterRoot],
    }),
  ])
  const runtimeRows = []
  for (const [application, services] of [
    ['cli', cliServices],
    ['automation-host', (await automation.createAutomationHost([counter])).subjects],
    ['server', (await server.createServerApp([counter])).subjects],
    ['electron', electronServices],
    ['vscode', vscodeHost.services],
  ]) {
    runtimeRows.push(await checkRuntimeSession(runtime.openRuntimeSession, application, services))
  }

  const pwa = await web.createWebApp({ operatingSystem: 'linux', architecture: 'x64' }, [], {
    main: ['worker.module'],
    worker: [],
    sharedMemory: false,
  })
  const pwaServices = {
    inventory: pwa.main.inventory,
    target: pwa.worker.target,
    executionBackends: pwa.worker.executionBackends,
  }
  const invalidRequests = [
    ['cli', cliServices],
    ['automation-host', automationApp.subjects],
    ['server', serverApp.subjects],
    ['electron', electronServices],
    ['pwa', pwaServices],
    ['vscode', vscodeHost.services],
  ]
  for (const [application, services] of invalidRequests) {
    const refusal = await runtime.openRuntimeSession(runtimeRequest(services, application, ''))
    if (
      refusal.state !== 'unresolved' ||
      refusal.diagnostics.length !== 1 ||
      refusal.diagnostics[0]?.code !== 'x3.host/runtime-session-request-invalid'
    ) {
      fail(`${application} did not preserve the shared typed runtime request refusal`)
    }
  }
  const pwaRuntime = await runtime.openRuntimeSession(runtimeRequest(pwaServices, 'pwa'))
  if (
    pwaRuntime.state !== 'unresolved' ||
    pwaRuntime.diagnostics[0]?.code !== 'x3.host/runtime-provider-unavailable'
  ) {
    fail('PWA did not preserve the typed no-provider refusal in the non-browser app gate')
  }
  runtimeRows.push(
    Object.freeze({
      application: 'pwa',
      runtime: 'unresolved',
      session: 'typed-refusal',
      provider: 'x3.host/runtime-provider-unavailable',
    }),
  )

  const [electronMain, vscodeExtension] = await Promise.all([
    import('node:fs/promises').then(fs =>
      fs.readFile(join(root, 'apps', 'electron', 'electron', 'main.cjs'), 'utf8'),
    ),
    import('node:fs/promises').then(fs =>
      fs.readFile(join(root, 'apps', 'modkit-vscode', 'src', 'extension.ts'), 'utf8'),
    ),
  ])
  if (!/commandEndpoint\s*\.execute\(request/u.test(electronMain)) {
    fail('Electron production main process no longer calls the shared command endpoint')
  }
  if (
    !vscodeExtension.includes('createSubjectCommandRuntime()') ||
    !vscodeExtension.includes('commandRuntime.run(')
  ) {
    fail('VS Code production extension no longer calls the shared command runtime')
  }

  console.table(
    commandRows.map(row => ({
      application: row.application,
      commandSchema: row.catalog.schemaVersion,
      commands: row.catalog.commands.length,
      refusal: row.receipt.result.code,
    })),
  )
  console.table(runtimeRows)
  console.log(
    'apps:check: command/runtime/session contracts conform across CLI, automation-host, server, Electron, PWA and VS Code',
  )
}
