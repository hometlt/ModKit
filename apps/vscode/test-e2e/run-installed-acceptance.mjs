/**
 * Installed-package acceptance for GA recovery Wave 1A.
 *
 * This is deliberately an external process test. It packages (or accepts) one VSIX, installs it
 * into isolated user/extension stores, drives the ordinary VS Code workbench through "Reopen
 * Editor With...", reads the rendered webview over CDP, quits the application, and repeats with the
 * same profile. There is no extensionDevelopmentPath and no Extension Development Host.
 *
 * Build one artifact and exercise it across three full VS Code generations:
 *
 *   pnpm --filter @modkit/modkit-vscode test:e2e:installed -- \
 *     --artifact-out C:/drop/modkit-vscode.vsix \
 *     --receipt C:/drop/installed-acceptance.json \
 *     --screenshot C:/drop/installed-dds.png
 *
 * Reuse an already built artifact without producing a second VSIX:
 *
 *   pnpm --filter @modkit/modkit-vscode test:e2e:installed -- \
 *     --vsix C:/drop/modkit-vscode.vsix --receipt C:/drop/installed-acceptance.json
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { release as osRelease, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

import {
  assertFormatSmokeWebviewResult,
  loadFormatSmokeAuthority,
  resolveFormatSmokeCases,
} from './format-smoke-runtime.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const repoRoot = resolve(appRoot, '..', '..')
const argumentsList = process.argv.slice(2)
const argument = flag => {
  const index = argumentsList.indexOf(flag)
  return index < 0 ? undefined : argumentsList[index + 1]
}
const hasFlag = flag => argumentsList.includes(flag)
const suppliedVsix = argument('--vsix') ?? process.env.MODKIT_VSCODE_VSIX
const artifactOut = argument('--artifact-out')
if (suppliedVsix !== undefined && artifactOut !== undefined) {
  throw new TypeError('--vsix and --artifact-out are mutually exclusive')
}

const codeCommand = argument('--code') ?? process.env.MODKIT_VSCODE_CLI ?? 'code'
const keepProfile = hasFlag('--keep-profile')
const scratch = mkdtempSync(join(tmpdir(), 'modkit-vscode-installed-'))
const receiptPath = resolve(
  argument('--receipt') ?? join(tmpdir(), `modkit-vscode-installed-receipt-${process.pid}.json`),
)
const screenshotPath = resolve(
  argument('--screenshot') ?? join(tmpdir(), `modkit-vscode-installed-dds-${process.pid}.png`),
)
const workspace = join(scratch, 'workspace')
const workspaceFile = join(scratch, 'modkit-acceptance.code-workspace')
const userData = join(scratch, 'user-data')
const extensionsDir = join(scratch, 'extensions')
const ddsPath = join(workspace, 'wave1a-minimal.dds')
const corruptDdsPath = join(workspace, 'wave1c-corrupt.dds')
const packageInstallGateCommand = '_modkit.acceptance.packageInstallGate'
const packageInstallGateFlag = 'MODKIT_VSCODE_ACCEPTANCE_PACKAGE_GATE'
const packageInstallGateGenerationFlag = 'MODKIT_VSCODE_ACCEPTANCE_GENERATION'
const packageInstallGateArtifactFlag = 'MODKIT_VSCODE_ACCEPTANCE_ARTIFACT_SHA256'
const packageInstallGateContinueFlag = 'MODKIT_VSCODE_ACCEPTANCE_CONTINUE'
const packageInstallGateDisabledUriFlag = 'MODKIT_VSCODE_ACCEPTANCE_DISABLED_URI'
const formatSmokeWorkspaceRootFlag = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_WORKSPACE_ROOT'
const formatSmokeSc2RootFlag = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_SC2_ROOT'
const formatSmokeWarzoneRootFlag = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_WARZONE_ROOT'
const formatSmokeStartFlag = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_START'
const formatSmokeAckFlag = 'MODKIT_VSCODE_ACCEPTANCE_FORMAT_SMOKE_ACK'
const archiveAcceptanceStartFlag = 'MODKIT_VSCODE_ACCEPTANCE_ARCHIVE_START'
const archiveAcceptanceAckFlag = 'MODKIT_VSCODE_ACCEPTANCE_ARCHIVE_ACK'
const packageInstallGatePath = join(
  userData,
  'User',
  'globalStorage',
  'modkit.modkit-vscode',
  'package-install-gate.json',
)
const packageInstallGateContinuePath = join(userData, 'package-install-gate-continue-generation-2')
const formatSmokeStartPath = join(userData, 'format-smoke-start-generation-3')
const formatSmokeAckPath = join(userData, 'format-smoke-ack-generation-3.json')
const archiveAcceptanceStartPath = join(userData, 'archive-acceptance-start-generation-3')
const archiveAcceptanceAckPath = join(userData, 'archive-acceptance-ack-generation-3.json')
const archiveAcceptanceCaseIds = Object.freeze([
  'mpq-tree-search-lazy',
  'casc-tree-search-lazy',
  'wz-tree-search-lazy',
  'casc-dds-nested-open',
  'casc-dds-materialize',
  'mpq-m3-nested-open',
  'mpq-m3-materialize',
  'wz-pie-nested-open',
  'wz-pie-materialize',
  'wte70-save-as-reopen',
  'armod-open',
  'corrupt-mpq-then-canary',
  'corrupt-casc-then-canary',
  'corrupt-wz-then-canary',
])
const archiveMaterializationAuthorities = Object.freeze({
  'casc-dds-materialize': Object.freeze({
    entry: 'campaigns/liberty.sc2campaign/base.sc2assets/assets/textures/alpha2.dds',
    target: 'wave2a-casc-alpha2.dds',
    bytes: 824,
    sha256: 'b0a41b1a08611e2e6f6070c6c0f9122646389974e059793f37ac018874733b79',
  }),
  'mpq-m3-materialize': Object.freeze({
    entry:
      'Assets/Doodads/SpacePlatform_LandingLights_NoLensFlare/avex_SpacePlatform_LandingLights_NoLensFlare.m3',
    target: 'wave2a-rustbucket.m3',
    bytes: 27_968,
    sha256: '4b5b6137720be779adf341790e75b134a026321181d8b37db96abf2669d250e8',
  }),
  'wz-pie-materialize': Object.freeze({
    entry: 'components/bodies/cybd_run.pie',
    target: 'wave2a-cybd_run.pie',
    bytes: 22_053,
    sha256: '0674a8044d71f12c8f9362eae9efea946f5b0ba04b065d9d8b861eae669fef23',
  }),
})
const archiveNestedAuthorities = Object.freeze({
  'casc-dds-nested-open': Object.freeze([
    Object.freeze({ formatId: 'casc', contributionId: 'blizzard/casc' }),
    Object.freeze({ formatId: 'dds', contributionId: 'modkit/dds' }),
  ]),
  'mpq-m3-nested-open': Object.freeze([
    Object.freeze({ formatId: 'mpq', contributionId: 'blizzard/mpq' }),
    Object.freeze({ formatId: 'm3', contributionId: 'blizzard/m3' }),
  ]),
  'wz-pie-nested-open': Object.freeze([
    Object.freeze({ formatId: 'warzone-wz', contributionId: 'modkit/warzone-wz' }),
    Object.freeze({ formatId: 'warzone-pie', contributionId: 'modkit/warzone-pie' }),
  ]),
})
const archiveCorruptAuthorities = Object.freeze({
  'corrupt-mpq-then-canary': Object.freeze({
    family: 'mpq',
    route: 'file-container',
    contributionId: 'blizzard/mpq',
    formatId: 'mpq',
  }),
  'corrupt-casc-then-canary': Object.freeze({
    family: 'casc',
    route: 'casc-namespace',
    contributionId: 'blizzard/casc',
    formatId: 'casc',
  }),
  'corrupt-wz-then-canary': Object.freeze({
    family: 'wz',
    route: 'file-container',
    contributionId: 'modkit/warzone-wz',
    formatId: 'warzone-wz',
  }),
})
const armodInstalledAuthority = Object.freeze({
  extensionId: 'wz2100project/warzone-2100',
  contributionId: 'modkit/warzone-wz',
  variantId: 'trusted-node',
  entrypoint: './src/warzone-wz/range-codec.js',
  manifestDigest: 'sha256:9f09effbbae1ee1e9755619cc250085dd5581cee395154d4f44d21055d733d20',
  artifactDigest: 'sha256:f68011827cbc50bff184910c78776c6ffae39d4607f2827c77d6af7782556db9',
  installedManifestSha256:
    'sha256:777d236663780b6f327e60bd014be9eab09a3efb7921c2a1353c0bf84255f306',
})
// ARmod's installed route is metadata-first (65,557 bytes from a 102 MB archive). This permits
// normal VS Code tree scheduling without permitting an unbounded full-archive materialization.
const armodProcessTreeMemoryDeltaCeilingBytes = 128 * 1024 * 1024
const armodProcessTreeRequestedSampleIntervalMs = 25
const armodProcessTreeMaximumObservedIntervalMs = 15_000
const armodProcessTreeMinimumSamples = 3
const processListTimeoutMs = 10_000
const disabledRouteUri =
  argument('--disabled-uri') ?? process.env[packageInstallGateDisabledUriFlag]
const defaultFormatSmokeWorkspaceRoot = existsSync(join(repoRoot, 'references'))
  ? repoRoot
  : existsSync(join(resolve(repoRoot, '..'), 'references'))
    ? resolve(repoRoot, '..')
    : repoRoot
const formatSmokeRoots = Object.freeze({
  workspaceRoot: resolve(
    argument('--format-smoke-workspace-root') ?? defaultFormatSmokeWorkspaceRoot,
  ),
  sc2InstallRoot: resolve(
    argument('--format-smoke-sc2-root') ??
      process.env[formatSmokeSc2RootFlag] ??
      'C:\\apps\\StarCraft II',
  ),
  warzoneInstallRoot: resolve(
    argument('--format-smoke-warzone-root') ??
      process.env[formatSmokeWarzoneRootFlag] ??
      'C:\\Program Files\\WindowsApps\\48148WZ2100Project.Warzone2100forWindows_4.7.0.0_x64__qsk72963svc8a',
  ),
})
let installedExtensionRoot
let formatSmokeAuthority
let formatSmokeCases
let formatSmokeAuthoritySha256
const builtArtifact = resolve(artifactOut ?? join(scratch, 'artifact', 'modkit-vscode.vsix'))
const artifactPath = resolve(suppliedVsix ?? builtArtifact)
const portablePath = (path, fallback = basename(path)) =>
  path.startsWith(scratch)
    ? path.replaceAll(scratch, '<isolated-profile>').replaceAll('\\', '/')
    : fallback
const portableString = value => {
  let result = value
  for (const [actual, label] of [
    [userData, '<isolated-profile>/user-data'],
    [extensionsDir, '<isolated-profile>/extensions'],
    [workspace, '<isolated-profile>/workspace'],
    [scratch, '<isolated-profile>'],
    [formatSmokeRoots.workspaceRoot, '<format-smoke-workspace>'],
    [formatSmokeRoots.sc2InstallRoot, '<sc2-install>'],
    [formatSmokeRoots.warzoneInstallRoot, '<warzone-install>'],
    [appRoot, '<app>'],
    [repoRoot, '<repo>'],
    [artifactPath, basename(artifactPath)],
  ]) {
    const fileUrl = pathToFileURL(actual).href
    for (const candidate of [
      actual,
      actual.replaceAll('\\', '/'),
      fileUrl,
      fileUrl.replace(
        /^file:\/\/\/([A-Z]):/u,
        (_match, drive) => `file:///${drive.toLowerCase()}:`,
      ),
    ]) {
      result = result.split(candidate).join(label)
    }
  }
  return result
}
const portableReceiptValue = value => {
  if (typeof value === 'string') return portableString(value)
  if (Array.isArray(value)) return value.map(item => portableReceiptValue(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, portableReceiptValue(item)]),
    )
  }
  return value
}
for (const directory of [workspace, userData, extensionsDir, dirname(artifactPath)]) {
  mkdirSync(directory, { recursive: true })
}
copyFileSync(
  join(repoRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic', 'minimal.dds'),
  ddsPath,
)
writeFileSync(corruptDdsPath, Buffer.concat([Buffer.from('DDS ', 'ascii'), Buffer.alloc(16)]))
/*
 * The window is opened on an ordinary `.code-workspace`, not on a bare folder.
 *
 * Adding a folder to a *folder* window is not an edit: VS Code has to create an untitled workspace
 * and enter it, and until that transition is confirmed the extension host refuses every further
 * `updateWorkspaceFolders`. Browsing three archives one after another is exactly that sequence, so
 * the acceptance uses the workspace shape in which adding a root is an ordinary edit and says so.
 */
writeFileSync(
  workspaceFile,
  `${JSON.stringify({ folders: [{ path: basename(workspace) }], settings: {} }, null, 2)}\n`,
)

const startedAt = new Date().toISOString()
const receipt = {
  kind: 'x3.vscode-installed-package-acceptance-receipt',
  schemaVersion: 1,
  startedAt,
  artifact: { path: portablePath(artifactPath), sha256: null },
  environment: {
    os: { platform: process.platform, architecture: process.arch, release: osRelease() },
    node: process.versions.node,
    vscode: null,
    vscodeLauncher: null,
  },
  profile: {
    mode: 'isolated-user-data-and-extensions-dir',
    userData: '<isolated-profile>/user-data',
    extensionsDir: '<isolated-profile>/extensions',
    extensionDevelopmentPathUsed: false,
    retained: keepProfile,
  },
  package: {
    command: 'pnpm --dir <app> package:vsix -- --out <artifact>',
    launcher: null,
    invokedFromCleanTemp: suppliedVsix === undefined,
    attempted: false,
    exitCode: null,
    commandPresent: false,
    localVscePresent: false,
    output: '',
  },
  install: {
    attempted: false,
    exitCode: null,
    extension: null,
    commandPaletteMatches: [],
    reopenCommand: null,
    output: '',
  },
  packageInstallGate: {
    kind: 'x3.vscode-installed-package-install-gate',
    schemaVersion: 1,
    expected: {
      command: packageInstallGateCommand,
      offlineCatalog: {
        signed: true,
        visible: true,
        networkAccess: false,
        checkoutDependency: false,
      },
      games: [
        { id: 'blizzard/starcraft-2', displayName: 'StarCraft II', expectedState: 'available' },
        {
          id: 'wz2100project/warzone-2100',
          displayName: 'Warzone 2100',
          expectedState: 'available',
        },
      ],
      lifecycle: ['available', 'install', 'disable', 'enable', 'uninstall', 'reinstall'],
      generations: [1, 2, 3],
      restart:
        'same isolated profile preserves installed/enabled state across full process restart',
      typedFailures: true,
      disabledRoute: {
        uri: disabledRouteUri === undefined ? '<required>' : '<supplied>',
        suppression:
          '__MODKIT_ACCEPTANCE__.packageInstallGate.disabledProbe.diagnostics contains x3.host/candidate-suppressed + x3.host/extension-disabled',
      },
    },
    runtime: {
      receipt: portablePath(packageInstallGatePath),
      environment: {
        MODKIT_EXTENSION_REGISTRY: '<cleared>',
        MODKIT_EXTENSION_ALLOWED_ORIGINS: '<cleared>',
        MODKIT_EXTENSION_RAPID_POOL_ROOT: '<cleared>',
      },
      received: false,
      verdict: null,
      phases: [],
      phaseDetails: [],
      failures: [],
      error: null,
    },
    verdict: 'fail',
  },
  formatSmoke: {
    kind: 'x3.vscode-installed-format-smoke-receipt',
    schemaVersion: 1,
    artifactSha256: null,
    authoritySha256: null,
    expectedCases: 14,
    openedCases: 0,
    exclusions: [],
    cases: [],
    failures: [],
    verdict: 'fail',
  },
  archiveAcceptance: {
    kind: 'x3.vscode-installed-archive-acceptance',
    schemaVersion: 1,
    expectedCases: archiveAcceptanceCaseIds,
    cases: [],
    failures: [],
    verdict: 'fail',
  },
  corruptInput: {
    kind: 'x3.vscode-installed-corrupt-input-refusal',
    schemaVersion: 1,
    file: basename(corruptDdsPath),
    expectedStep: 'input-open',
    code: null,
    message: null,
    verdict: 'fail',
  },
  runs: [],
  restart: { attempted: false, sameProfile: true, passed: false },
  cleanup: {
    attempted: !keepProfile,
    profileRemoved: null,
    applicationCloseAttempts: [],
    applicationCloseErrors: [],
    error: null,
  },
  verdict: 'fail',
}

const compact = (value, limit = 2_000) => {
  const text = String(value ?? '').replaceAll(scratch, '<isolated-profile>')
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function pathEntries() {
  return (process.env.PATH ?? '')
    .split(delimiter)
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
}

function resolveCommand(command) {
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : ['']
  const hasDirectory = /[\\/]/u.test(command)
  const bases = hasDirectory ? [''] : pathEntries()
  for (const base of bases) {
    for (const extension of extensions) {
      const candidate = hasDirectory
        ? `${command}${extension}`
        : join(base, `${command}${extension}`)
      if (existsSync(candidate)) return resolve(candidate)
    }
  }
  return undefined
}

let vscodeCliLauncher
function resolveVsCodeCliLauncher() {
  if (vscodeCliLauncher !== undefined) return vscodeCliLauncher
  const discoveredCommand = resolveCommand(codeCommand) ?? codeCommand
  let resolvedCommand =
    process.platform === 'win32' &&
    !/\.(?:cmd|bat|exe)$/iu.test(discoveredCommand) &&
    existsSync(`${discoveredCommand}.cmd`)
      ? `${discoveredCommand}.cmd`
      : discoveredCommand
  if (process.platform === 'win32' && /(?:^|[\\/])Code\.exe$/iu.test(resolvedCommand)) {
    const installedCommandShim = resolve(dirname(resolvedCommand), 'bin', 'code.cmd')
    if (existsSync(installedCommandShim)) resolvedCommand = installedCommandShim
  }
  if (process.platform === 'win32' && /\.cmd$/iu.test(resolvedCommand)) {
    const script = readFileSync(resolvedCommand, 'utf8')
    const cliMatch = script.match(/"%~dp0\.\.\\([^"\r\n]*resources\\app\\out\\cli\.js)"/iu)
    const executable = resolve(dirname(resolvedCommand), '..', 'Code.exe')
    const cli =
      cliMatch?.[1] === undefined ? undefined : resolve(dirname(resolvedCommand), '..', cliMatch[1])
    if (!existsSync(executable) || cli === undefined || !existsSync(cli)) {
      throw new Error('installed code.cmd does not identify an existing Code.exe CLI runtime')
    }
    vscodeCliLauncher = Object.freeze({
      command: executable,
      argsPrefix: Object.freeze([cli]),
      environment: Object.freeze({ ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' }),
      label: 'Code.exe ELECTRON_RUN_AS_NODE <installed-cli.js>',
    })
    return vscodeCliLauncher
  }
  vscodeCliLauncher = Object.freeze({
    command: resolvedCommand,
    argsPrefix: Object.freeze([]),
    environment: Object.freeze({}),
    label: basename(resolvedCommand),
  })
  return vscodeCliLauncher
}

function runCode(commandArguments, options = {}) {
  const launcher = resolveVsCodeCliLauncher()
  const result = spawnSync(launcher.command, [...launcher.argsPrefix, ...commandArguments], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...process.env, ...launcher.environment },
  })
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`,
  }
}

function pnpmScriptCandidates(commandPath) {
  if (commandPath === undefined) return []
  const commandDirectory = dirname(commandPath)
  return [
    commandPath,
    join(commandDirectory, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    join(commandDirectory, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    resolve(commandDirectory, '..', '..', 'node', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    resolve(commandDirectory, '..', '..', 'node', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
  ]
}

function resolvePnpmLauncher() {
  const candidateCommands = [
    process.env.MODKIT_PNPM_CLI,
    process.env.npm_execpath,
    resolveCommand('pnpm'),
  ].filter(candidate => typeof candidate === 'string' && candidate.length > 0)
  for (const commandPath of candidateCommands) {
    for (const candidate of pnpmScriptCandidates(commandPath)) {
      if (/\.(?:cjs|mjs|js)$/iu.test(candidate) && existsSync(candidate)) {
        return {
          command: process.execPath,
          argsPrefix: [candidate],
          shell: false,
          label: `node <resolved-pnpm-cli:${basename(candidate)}>`,
        }
      }
    }
  }
  if (process.platform === 'win32') {
    const commandPath = resolveCommand('pnpm.cmd') ?? resolveCommand('pnpm')
    if (commandPath !== undefined) {
      return {
        command: process.env.ComSpec ?? 'cmd.exe',
        argsPrefix: ['/d', '/s', '/c', `"${commandPath}"`],
        shell: false,
        label: 'cmd.exe /d /s /c <resolved-pnpm-cmd>',
      }
    }
  }
  return { command: 'pnpm', argsPrefix: [], shell: false, label: 'pnpm' }
}

function runPnpm(commandArguments, options = {}) {
  const launcher = resolvePnpmLauncher()
  receipt.package.launcher = launcher.label
  const result = spawnSync(launcher.command, [...launcher.argsPrefix, ...commandArguments], {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    shell: launcher.shell,
    windowsHide: true,
    env: process.env,
  })
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`,
  }
}

const freePort = () =>
  new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolvePromise(address.port))
    })
  })
const activeApplications = new Map()

async function waitFor(check, { timeoutMs = 30_000, stepMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value !== undefined && value !== false && value !== null) return value
    } catch (error) {
      lastError = error
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, stepMs))
  }
  if (lastError !== undefined) throw lastError
  return undefined
}

function readPackageTooling() {
  const manifest = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  receipt.package.commandPresent = typeof manifest.scripts?.['package:vsix'] === 'string'
  receipt.package.localVscePresent = existsSync(
    join(appRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce'),
  )
}

function packageVsix() {
  readPackageTooling()
  if (suppliedVsix !== undefined) return
  receipt.package.attempted = true
  const result = runPnpm(
    ['--dir', appRoot, 'package:vsix', '--', '--out', artifactPath],
    // The product command owns its staging directory; invoking it from another clean temp proves
    // that it does not inherit cwd files or require a monorepo-positioned staging package.
    { cwd: scratch },
  )
  receipt.package.exitCode = result.code
  receipt.package.output = compact(result.output)
  if (result.code !== 0) {
    throw new Error(
      `official VSIX package command failed (${result.code}): ${compact(result.output)}`,
    )
  }
}

function identifyArtifact() {
  if (!existsSync(artifactPath)) throw new Error(`VSIX does not exist: ${artifactPath}`)
  const bytes = readFileSync(artifactPath)
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('official package output is not a ZIP/VSIX artifact')
  }
  receipt.artifact.sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function findInstalledManifest(directory) {
  for (const name of readdirSync(directory, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const candidate = join(directory, name.name, 'package.json')
    if (!existsSync(candidate)) continue
    const manifest = JSON.parse(readFileSync(candidate, 'utf8'))
    if (manifest.publisher === 'modkit' && manifest.name === 'modkit-vscode') {
      return { path: candidate, manifest }
    }
  }
  return undefined
}

function readPackageInstallGateReceipt() {
  if (!existsSync(packageInstallGatePath)) return undefined
  try {
    return JSON.parse(readFileSync(packageInstallGatePath, 'utf8'))
  } catch (error) {
    receipt.packageInstallGate.runtime.error =
      error instanceof Error ? error.message : String(error)
    return undefined
  }
}

function capturePackageInstallGateRuntime() {
  const gateReceipt = readPackageInstallGateReceipt()
  receipt.packageInstallGate.runtime.received = gateReceipt !== undefined
  if (gateReceipt === undefined) return undefined
  receipt.packageInstallGate.runtime.verdict =
    typeof gateReceipt.verdict === 'string' ? gateReceipt.verdict : null
  receipt.packageInstallGate.runtime.phases = Array.isArray(gateReceipt.phases)
    ? gateReceipt.phases.map(phase => ({
        generation: Number(phase?.generation),
        state: String(phase?.state ?? ''),
        verdict: String(phase?.verdict ?? ''),
        failures: Array.isArray(phase?.failures)
          ? phase.failures.map(failure => ({
              code: String(failure?.code ?? 'x3.acceptance/package-install-gate-unknown'),
              message: compact(failure?.message ?? ''),
            }))
          : [],
      }))
    : []
  receipt.packageInstallGate.runtime.phaseDetails = Array.isArray(gateReceipt.phases)
    ? portableReceiptValue(gateReceipt.phases)
    : []
  receipt.packageInstallGate.runtime.failures = Array.isArray(gateReceipt.failures)
    ? gateReceipt.failures.map(failure => ({
        code: String(failure?.code ?? 'x3.acceptance/package-install-gate-unknown'),
        message: compact(failure?.message ?? ''),
      }))
    : []
  return gateReceipt
}

function assertPackageInstallGate() {
  const gateReceipt = capturePackageInstallGateRuntime()
  if (gateReceipt === undefined) {
    const message = `A3/A5 package/install gate produced no runtime receipt: ${receipt.packageInstallGate.runtime.receipt}`
    receipt.packageInstallGate.runtime.failures = [
      {
        code: 'x3.acceptance/package-install-gate-receipt-missing',
        message,
      },
    ]
    receipt.packageInstallGate.runtime.error = message
    throw new Error(message)
  }
  if (
    gateReceipt.kind !== 'x3.modkit/vscode-package-install-gate' ||
    gateReceipt.schemaVersion !== 1
  ) {
    const message = 'A3/A5 package/install gate receipt has an unsupported schema'
    receipt.packageInstallGate.runtime.failures = [
      {
        code: 'x3.acceptance/package-install-gate-schema-unsupported',
        message,
      },
    ]
    receipt.packageInstallGate.runtime.error = message
    throw new Error(message)
  }
  const phaseGenerations = receipt.packageInstallGate.runtime.phases.map(phase => phase.generation)
  if (JSON.stringify(phaseGenerations) !== JSON.stringify([1, 2, 3])) {
    const message = `A3/A5 package/install gate phases are incomplete: ${JSON.stringify(phaseGenerations)}`
    receipt.packageInstallGate.runtime.error = message
    throw new Error(message)
  }
  const artifactMismatches = Array.isArray(gateReceipt.phases)
    ? gateReceipt.phases.filter(
        phase =>
          typeof phase?.artifactSha256 === 'string' &&
          phase.artifactSha256 !== receipt.artifact.sha256,
      )
    : []
  if (gateReceipt.artifactSha256 !== receipt.artifact.sha256 || artifactMismatches.length > 0) {
    const message = `A3/A5 package/install gate artifact SHA mismatch: ${gateReceipt.artifactSha256} !== ${receipt.artifact.sha256}`
    receipt.packageInstallGate.runtime.error = message
    throw new Error(message)
  }
  if (gateReceipt.verdict !== 'pass') {
    const failures =
      receipt.packageInstallGate.runtime.failures.length === 0
        ? 'no typed failure was reported'
        : receipt.packageInstallGate.runtime.failures
            .map(failure => `${failure.code}: ${failure.message}`)
            .join('; ')
    throw new Error(`A3/A5 package/install gate failed: ${failures}`)
  }
  receipt.packageInstallGate.verdict = 'pass'
}

async function waitForPackageInstallGatePhase(generation, states, timeoutMs = 180_000) {
  const expectedStates = Array.isArray(states) ? states : [states]
  return await waitFor(
    () => {
      const gateReceipt = readPackageInstallGateReceipt()
      const phase = gateReceipt?.phases?.find?.(
        item => item?.generation === generation && expectedStates.includes(item?.state),
      )
      return phase === undefined ? undefined : phase
    },
    { timeoutMs, stepMs: 500 },
  )
}

async function waitForFormatSmokeCurrent(operationRevision, timeoutMs = 180_000) {
  return await waitFor(
    () => {
      const phase = readPackageInstallGateReceipt()?.phases?.find?.(item => item?.generation === 3)
      const current = phase?.formatSmoke?.current
      return phase?.state === 'awaiting-format-smoke-observation' &&
        current?.operationRevision === operationRevision
        ? current
        : undefined
    },
    { timeoutMs, stepMs: 500 },
  )
}

/*
 * The three archive searches publish the same `awaiting-archive-search-picker` state one after the
 * other, and the product does not clear it between them. Waiting on the state alone therefore
 * answers the second and third search with the phase the previous one already left behind, so a
 * caller that knows which case it is waiting for must say so and be answered only by that case.
 */
async function waitForArchiveAcceptanceStage(state, expectedCase = undefined, timeoutMs = 180_000) {
  return await waitFor(
    () => {
      const phase = readPackageInstallGateReceipt()?.phases?.find?.(item => item?.generation === 3)
      if (phase?.state !== state) return undefined
      if (expectedCase === undefined) return phase
      const archive = phase.archiveAcceptance
      return archive?.caseId === expectedCase.caseId && archive?.stage === expectedCase.stage
        ? phase
        : undefined
    },
    { timeoutMs, stepMs: 500 },
  )
}

function writeArchiveAcceptanceAck(stage, source, target, nativeUserCommand) {
  const acknowledgement = {
    kind: 'x3.vscode-installed-archive-acceptance-ack',
    schemaVersion: 1,
    artifactSha256: receipt.artifact.sha256,
    generation: 3,
    caseId: 'wte70-save-as-reopen',
    stage,
    source,
    target,
    observedBy: 'cdp',
    ...(nativeUserCommand === undefined ? {} : { nativeUserCommand }),
    verdict: 'pass',
  }
  const temporary = `${archiveAcceptanceAckPath}.${process.pid}.${stage}.tmp`
  writeFileSync(temporary, `${JSON.stringify(acknowledgement, null, 2)}\n`)
  rmSync(archiveAcceptanceAckPath, { force: true })
  renameSync(temporary, archiveAcceptanceAckPath)
}

function writeArchiveSearchAck(search) {
  const acknowledgement = {
    kind: 'x3.vscode-installed-archive-acceptance-ack',
    schemaVersion: 1,
    artifactSha256: receipt.artifact.sha256,
    generation: 3,
    caseId: search.caseId,
    stage: 'search-picker-selected',
    container: search.container,
    query: search.query,
    requiredEntry: search.requiredEntry,
    selectedUri: search.selectedUri,
    selectedRoute: 'modkit-container',
    observedBy: 'cdp',
    inputBoxObserved: true,
    quickPickObserved: true,
    pickedLabel: search.pickedLabel,
    verdict: 'pass',
  }
  const temporary = `${archiveAcceptanceAckPath}.${process.pid}.${search.caseId}.tmp`
  writeFileSync(temporary, `${JSON.stringify(acknowledgement, null, 2)}\n`)
  rmSync(archiveAcceptanceAckPath, { force: true })
  renameSync(temporary, archiveAcceptanceAckPath)
}

function writeArmodProcessTreeMemoryAck(stage, memoryEvidence) {
  const acknowledgement = {
    kind: 'x3.vscode-installed-archive-acceptance-ack',
    schemaVersion: 1,
    artifactSha256: receipt.artifact.sha256,
    generation: 3,
    caseId: 'armod-open',
    stage,
    ...memoryEvidence,
  }
  const temporary = `${archiveAcceptanceAckPath}.${process.pid}.${stage}.tmp`
  writeFileSync(temporary, `${JSON.stringify(acknowledgement, null, 2)}\n`)
  rmSync(archiveAcceptanceAckPath, { force: true })
  renameSync(temporary, archiveAcceptanceAckPath)
}

async function observeAndSelectArchiveSearch(page, expected) {
  const widget = page.locator('.quick-input-widget:visible').last()
  const input = widget.locator('input:visible').last()
  await input.waitFor({ state: 'visible', timeout: 20_000 })
  await input.fill(expected.query)
  const inputValue = await input.inputValue()
  if (inputValue !== expected.query) {
    throw new Error(
      `${expected.caseId} InputBox value ${JSON.stringify(inputValue)} is not its authority query`,
    )
  }
  await page.keyboard.press('Enter')
  const rows = widget.locator('.quick-input-list .monaco-list-row:visible')
  const row = rows.filter({ hasText: expected.requiredEntry }).first()
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  const rowText = await row.innerText()
  /*
   * The row renders the container entry as its QuickPick label and the member size as a separate
   * description element. Read the label on its own so the receipt records what the row actually
   * said instead of echoing the expectation, and keep the description as separate evidence.
   */
  const labelNodes = row.locator('.label-name')
  const descriptionNodes = row.locator('.label-description')
  let pickedLabel
  let pickedDescription
  let pickedLabelSource
  if ((await labelNodes.count()) > 0) {
    pickedLabel = (await labelNodes.first().innerText()).trim()
    pickedDescription =
      (await descriptionNodes.count()) > 0
        ? (await descriptionNodes.first().innerText()).trim()
        : ''
    pickedLabelSource = 'quick-input-label-element'
  } else {
    const collapsed = rowText.replace(/\s+/gu, ' ').trim()
    pickedDescription = (collapsed.match(/\d[\d,. ]*bytes$/u) ?? [''])[0].trim()
    pickedLabel = collapsed.slice(0, collapsed.length - pickedDescription.length).trim()
    pickedLabelSource = 'row-text-minus-description'
  }
  if (pickedLabel !== expected.requiredEntry) {
    throw new Error(
      `${expected.caseId} QuickPick label ${JSON.stringify(pickedLabel)} is not its authority entry ` +
        `(description ${JSON.stringify(pickedDescription)}, row ${JSON.stringify(rowText)})`,
    )
  }
  await row.click()
  return {
    inputBoxObserved: true,
    quickPickObserved: true,
    pickedLabel,
    pickedDescription,
    pickedLabelSource,
    rowText,
  }
}

async function attemptNativeSaveAs(page) {
  // Native OS Save dialogs are outside CDP. Do not synthesize the shortcut: it can leave the
  // isolated workbench modal-blocked without a deterministic close path.
  void page
  return {
    command: 'workbench.action.files.saveAs',
    attempted: false,
    cdpQuickInputObserved: false,
    proof: false,
    classification: 'native-os-dialog-not-automated',
  }
}

async function observeArchiveAcceptanceEditor(port, expected) {
  const observed = await waitFor(
    async () => {
      const values = await webviewValues(
        port,
        webviewDocumentExpression(`(_doc, win) => {
          const archive = win.__MODKIT_ACCEPTANCE__?.archiveAcceptance;
          const selected = win.__MODKIT_ACCEPTANCE__?.subject?.selected;
          const route = win.__MODKIT_ACCEPTANCE__?.subject?.selectedRoute;
          if (
            archive?.caseId !== 'wte70-save-as-reopen' ||
            archive?.stage !== ${JSON.stringify(expected.stage)} ||
            archive?.source !== ${JSON.stringify(expected.source)} ||
            archive?.target !== ${JSON.stringify(expected.target)} ||
            !Array.isArray(archive?.materializations) ||
            archive.materializations.length !== 3 ||
            !archive.materializations.every(item =>
              item?.command === 'modkit.materializeContainerEntry' &&
              item?.dialogBypass === true &&
              typeof item?.target === 'string' &&
              item?.corpus?.sha256 &&
              item?.extraction?.bytes === item?.corpus?.bytes
            ) ||
            selected?.contributionId !== 'blizzard/sc2-map' ||
            !Array.isArray(route) ||
            !route.some(item => item?.formatId === 'sc2-map')
          ) return undefined;
          return {
            contributionId: selected.contributionId,
            selectedRoute: route.map(item => ({
              formatId: item?.formatId,
              extensionId: item?.extensionId,
              contributionId: item?.contributionId,
            })),
            archive: {
              stage: archive.stage,
              source: archive.source,
              target: archive.target,
              materializations: archive.materializations.map(item => ({
                caseId: item.caseId,
                command: item.command,
                dialogBypass: item.dialogBypass,
                target: item.target,
                sha256: item.corpus.sha256,
              })),
            },
          };
        }`),
      )
      return values[0]
    },
    { timeoutMs: 120_000, stepMs: 500 },
  )
  if (observed === undefined) {
    throw new Error(`CDP did not observe the live WTE70 editor at ${expected.stage}`)
  }
  return observed
}

function packageGatePhaseFailures(phase) {
  if (!Array.isArray(phase?.failures)) return 'phase did not publish typed failures'
  if (phase.failures.length === 0) return 'phase did not pass and published no typed failures'
  return phase.failures.map(failure => `${failure.code}: ${failure.message}`).join('; ')
}

function assertExactArchiveEvidence(archiveCases) {
  for (const [caseId, authority] of Object.entries(archiveMaterializationAuthorities)) {
    const evidence = archiveCases.find(item => item?.caseId === caseId)?.evidence
    if (
      evidence?.command !== 'modkit.materializeContainerEntry' ||
      evidence?.dialogBypass !== true ||
      evidence?.target !== authority.target ||
      evidence?.corpus?.bytes !== authority.bytes ||
      evidence?.corpus?.sha256 !== authority.sha256 ||
      evidence?.extraction?.entry !== authority.entry ||
      evidence?.extraction?.bytes !== authority.bytes ||
      typeof evidence?.extraction?.container !== 'string'
    ) {
      throw new Error(`Wave 2A ${caseId} is not bound to its exact materialized authority`)
    }
  }
  for (const [caseId, authority] of Object.entries(archiveNestedAuthorities)) {
    const evidence = archiveCases.find(item => item?.caseId === caseId)?.evidence
    const route = Array.isArray(evidence?.selectedRoute)
      ? evidence.selectedRoute.map(item => ({
          formatId: item?.formatId,
          contributionId: item?.contributionId,
        }))
      : undefined
    if (
      JSON.stringify(route) !== JSON.stringify(authority) ||
      evidence?.selected?.contributionId !== authority.at(-1)?.contributionId
    ) {
      throw new Error(`Wave 2A ${caseId} is not bound to its exact nested route`)
    }
  }
  for (const [caseId, authority] of Object.entries(archiveCorruptAuthorities)) {
    const evidence = archiveCases.find(item => item?.caseId === caseId)?.evidence
    if (
      evidence?.family !== authority.family ||
      evidence?.route !== authority.route ||
      evidence?.failedStep !== 'container-index' ||
      evidence?.attempted?.contributionId !== authority.contributionId ||
      evidence?.attempted?.formatId !== authority.formatId ||
      evidence?.attempted?.state !== 'rejected' ||
      typeof evidence?.attempted?.diagnostic?.code !== 'string' ||
      evidence.attempted.diagnostic.code === 'x3.app/vscode-not-a-container' ||
      typeof evidence?.attempted?.diagnostic?.message !== 'string' ||
      evidence?.refusal?.source !== 'candidate-diagnostic' ||
      evidence?.refusal?.code !== evidence?.attempted?.diagnostic?.code ||
      evidence?.refusal?.message !== evidence?.attempted?.diagnostic?.message ||
      evidence?.appAlive?.validCascCanary !== true
    ) {
      throw new Error(`Wave 2A ${caseId} lacks an actual candidate-attributed typed refusal`)
    }
  }
  const armod = archiveCases.find(item => item?.caseId === 'armod-open')?.evidence
  const armodRoute = Array.isArray(armod?.selectedRoute) ? armod.selectedRoute.at(-1) : undefined
  const externalMemory = armod?.externalProcessTreeMemory
  const externalMemoryStart = externalMemory?.startAcknowledgement
  const externalMemoryStop = externalMemory?.stopAcknowledgement
  const validExternalMetric = metric =>
    Number.isSafeInteger(metric?.baselineBytes) &&
    Number.isSafeInteger(metric?.peakBytes) &&
    Number.isSafeInteger(metric?.deltaBytes) &&
    metric.baselineBytes >= 0 &&
    metric.peakBytes >= metric.baselineBytes &&
    metric.deltaBytes === metric.peakBytes - metric.baselineBytes &&
    metric.deltaCeilingBytes === armodProcessTreeMemoryDeltaCeilingBytes &&
    metric.deltaBytes <= metric.deltaCeilingBytes
  const validExternalObservedCadence = (samples, cadence) => {
    if (
      !Array.isArray(samples) ||
      samples.length < 2 ||
      cadence === null ||
      typeof cadence !== 'object'
    ) {
      return false
    }
    if (
      samples.some(
        sample =>
          !Number.isSafeInteger(sample?.timestampMs) ||
          !Number.isSafeInteger(sample?.workingSetBytes) ||
          !Number.isSafeInteger(sample?.privateBytes),
      )
    ) {
      return false
    }
    const intervals = samples
      .slice(1)
      .map((sample, index) => sample.timestampMs - samples[index].timestampMs)
    const averageIntervalMs =
      intervals.reduce((total, interval) => total + interval, 0) / intervals.length
    return (
      Number.isSafeInteger(cadence.intervalCount) &&
      cadence.intervalCount === intervals.length &&
      Number.isSafeInteger(cadence.minIntervalMs) &&
      cadence.minIntervalMs === Math.min(...intervals) &&
      cadence.minIntervalMs > 0 &&
      Number.isSafeInteger(cadence.maxIntervalMs) &&
      cadence.maxIntervalMs === Math.max(...intervals) &&
      cadence.maxIntervalMs >= cadence.minIntervalMs &&
      cadence.maxIntervalMs <= armodProcessTreeMaximumObservedIntervalMs &&
      typeof cadence.averageIntervalMs === 'number' &&
      Number.isFinite(cadence.averageIntervalMs) &&
      cadence.averageIntervalMs === averageIntervalMs &&
      cadence.averageIntervalMs >= cadence.minIntervalMs &&
      cadence.averageIntervalMs <= cadence.maxIntervalMs
    )
  }
  if (
    armod?.installedManifestSha256 !== armodInstalledAuthority.installedManifestSha256 ||
    armod?.entrypoint !== armodInstalledAuthority.entrypoint ||
    armod?.selected?.extensionId !== armodInstalledAuthority.extensionId ||
    armod?.selected?.contributionId !== armodInstalledAuthority.contributionId ||
    armod?.selected?.variantId !== armodInstalledAuthority.variantId ||
    armodRoute?.formatId !== 'warzone-wz' ||
    armodRoute?.contributionId !== armodInstalledAuthority.contributionId ||
    armod?.selectedDetection?.formatId !== 'warzone-wz' ||
    armod?.selectedDetection?.manifestDigest !== armodInstalledAuthority.manifestDigest ||
    armod?.selectedDetection?.artifactDigest !== armodInstalledAuthority.artifactDigest ||
    armod?.inspection?.inspectionMode !== 'metadata-first-range' ||
    armod?.inspection?.sourceBytes !== '102362635' ||
    armod?.inspection?.metadataBytesRead !== 65_557 ||
    armod?.metadataIo?.readCount !== 8 ||
    armod?.metadataIo?.bytes !== 70_978 ||
    armod?.metadataIo?.maxReadBytes !== 65_557 ||
    armod?.metadataIo?.streamCount !== 0 ||
    externalMemoryStart?.kind !== 'x3.vscode-installed-archive-acceptance-ack' ||
    externalMemoryStart?.schemaVersion !== 1 ||
    externalMemoryStart?.artifactSha256 !== receipt.artifact.sha256 ||
    externalMemoryStart?.generation !== 3 ||
    externalMemoryStart?.caseId !== 'armod-open' ||
    externalMemoryStart?.stage !== 'armod-memory-sampling-start' ||
    externalMemoryStart?.observedBy !== 'external-process-tree' ||
    externalMemoryStart?.collector !== 'Win32_Process' ||
    externalMemoryStart?.requestedSampleIntervalMs !== armodProcessTreeRequestedSampleIntervalMs ||
    externalMemoryStart?.verdict !== 'pass' ||
    externalMemoryStop?.kind !== 'x3.vscode-installed-archive-acceptance-ack' ||
    externalMemoryStop?.schemaVersion !== 1 ||
    externalMemoryStop?.artifactSha256 !== receipt.artifact.sha256 ||
    externalMemoryStop?.generation !== 3 ||
    externalMemoryStop?.caseId !== 'armod-open' ||
    externalMemoryStop?.stage !== 'armod-memory-sampling-stop' ||
    externalMemoryStop?.observedBy !== 'external-process-tree' ||
    externalMemoryStop?.collector !== 'Win32_Process' ||
    externalMemoryStop?.requestedSampleIntervalMs !== armodProcessTreeRequestedSampleIntervalMs ||
    externalMemoryStop?.verdict !== 'pass' ||
    !Array.isArray(externalMemoryStop?.matchedRootPids) ||
    externalMemoryStop.matchedRootPids.length === 0 ||
    !Array.isArray(externalMemoryStop?.descendantPids) ||
    externalMemoryStop.descendantPids.length === 0 ||
    !Number.isSafeInteger(externalMemoryStop?.sampleCount) ||
    externalMemoryStop.sampleCount < armodProcessTreeMinimumSamples ||
    !Array.isArray(externalMemoryStop?.samples) ||
    externalMemoryStop.samples.length !== externalMemoryStop.sampleCount ||
    !validExternalObservedCadence(externalMemoryStop.samples, externalMemoryStop.observedCadence) ||
    !Array.isArray(externalMemoryStop?.errors) ||
    externalMemoryStop.errors.length !== 0 ||
    !validExternalMetric(externalMemoryStop?.workingSetBytes) ||
    !validExternalMetric(externalMemoryStop?.privateBytes) ||
    armod?.extensionHostRss?.source !== 'process.memoryUsage().rss' ||
    !Number.isSafeInteger(armod?.extensionHostRss?.deltaBytes) ||
    armod.extensionHostRss.deltaBytes > armod.extensionHostRss.deltaCeilingBytes
  ) {
    throw new Error(
      'Wave 2A ARmod route/metadata/I/O/external-process-tree memory evidence differs from its exact authority',
    )
  }
}

function packageGatePhaseSummary(phase, generation) {
  if (phase === undefined) {
    return {
      generation,
      state: 'missing',
      verdict: 'fail',
      changeEventCount: null,
    }
  }
  return {
    generation: phase.generation,
    state: phase.state,
    verdict: phase.verdict,
    changeEventCount: phase.changeEventCount,
  }
}

async function observeDisabledRouteSuppression(port) {
  if (disabledRouteUri === undefined || disabledRouteUri.trim() === '') {
    return {
      attempted: false,
      observed: false,
      error: `${packageInstallGateDisabledUriFlag} is not set`,
    }
  }
  const observed = await waitFor(
    async () => {
      const values = await webviewValues(
        port,
        webviewDocumentExpression(
          `(_doc, win) => {
            const diagnostics = win.__MODKIT_ACCEPTANCE__?.packageInstallGate?.disabledProbe?.diagnostics;
            if (!Array.isArray(diagnostics)) return undefined;
            const match = diagnostics.find(
              item =>
                item?.code === 'x3.host/candidate-suppressed' &&
                String(item?.message ?? '').includes('x3.host/extension-disabled'),
            );
            return match === undefined
              ? undefined
              : { code: match.code, message: String(match.message).slice(0, 1000) };
          }`,
        ),
      )
      return values.find(value => value?.code === 'x3.host/candidate-suppressed')
    },
    { timeoutMs: 60_000, stepMs: 500 },
  )
  return {
    attempted: true,
    observed: observed !== undefined,
    diagnostic: observed ?? null,
  }
}

function installVsix() {
  receipt.environment.vscodeLauncher = resolveVsCodeCliLauncher().label
  const version = runCode(['--version'])
  if (version.code !== 0) throw new Error(`installed VS Code CLI is unavailable: ${version.output}`)
  receipt.environment.vscode = version.output.split(/\r?\n/u)[0]?.trim() ?? null
  receipt.install.attempted = true
  const result = runCode([
    '--user-data-dir',
    userData,
    '--extensions-dir',
    extensionsDir,
    '--install-extension',
    artifactPath,
    '--force',
  ])
  receipt.install.exitCode = result.code
  receipt.install.output = compact(result.output)
  if (result.code !== 0)
    throw new Error(`VSIX installation failed (${result.code}): ${result.output}`)
  const installed = findInstalledManifest(extensionsDir)
  if (installed === undefined)
    throw new Error('VS Code reported success but no modkit.modkit-vscode manifest was installed')
  receipt.install.extension = {
    id: `${installed.manifest.publisher}.${installed.manifest.name}`,
    version: installed.manifest.version,
    manifest: portablePath(installed.path),
  }
  installedExtensionRoot = dirname(installed.path)
  const authorityPath = join(installedExtensionRoot, 'dist-app', 'format-smoke.v1.json')
  const authorityBytes = readFileSync(authorityPath)
  formatSmokeAuthoritySha256 = `sha256:${createHash('sha256').update(authorityBytes).digest('hex')}`
  formatSmokeAuthority = loadFormatSmokeAuthority(authorityPath)
  formatSmokeCases = resolveFormatSmokeCases(formatSmokeAuthority, formatSmokeRoots)
  receipt.formatSmoke.artifactSha256 = receipt.artifact.sha256
  receipt.formatSmoke.authoritySha256 = formatSmokeAuthoritySha256
  receipt.formatSmoke.exclusions = formatSmokeCases
    .filter(testCase => testCase.kind === 'excluded')
    .map(testCase => ({
      caseId: testCase.id,
      reason: testCase.reason,
      authorityMatched: true,
    }))
}

const formatSmokeContextLiteral = current =>
  JSON.stringify({
    caseId: current.caseId,
    operationRevision: current.operationRevision,
    observationToken: current.observationToken,
  })

const formatSmokeWebviewExpression = (current, body) =>
  webviewDocumentExpression(`(doc, win) => {
    const expected = ${formatSmokeContextLiteral(current)};
    const actual = win.__MODKIT_ACCEPTANCE__?.formatSmoke;
    if (
      actual?.caseId !== expected.caseId ||
      actual?.operationRevision !== expected.operationRevision ||
      actual?.observationToken !== expected.observationToken ||
      actual?.readOnly !== true
    ) return undefined;
    ${body}
  }`)

async function formatSmokeValue(port, current, body, timeoutMs = 120_000) {
  return await waitFor(
    async () => {
      const values = await webviewValues(port, formatSmokeWebviewExpression(current, body))
      return values[0]
    },
    { timeoutMs, stepMs: 500 },
  )
}

async function formatSmokeWebviewDiagnostics(port) {
  return await webviewValues(
    port,
    webviewDocumentExpression(`(doc, win) => {
      const acceptance = win.__MODKIT_ACCEPTANCE__;
      const body = (doc.body?.innerText ?? '').trim();
      if (acceptance === undefined && body === '') return undefined;
      return {
        current: acceptance?.formatSmoke === undefined
          ? null
          : {
              caseId: acceptance.formatSmoke.caseId,
              operationRevision: acceptance.formatSmoke.operationRevision,
              readOnly: acceptance.formatSmoke.readOnly,
            },
        selectedRoute: Array.isArray(acceptance?.subject?.selectedRoute)
          ? acceptance.subject.selectedRoute.map(item => ({
              formatId: item?.formatId,
              extensionId: item?.extensionId,
              contributionId: item?.contributionId,
            }))
          : null,
        body: body.slice(-2_000),
      };
    }`),
  )
}

async function selectFormatSmokeStage(port, current, stage) {
  const selected = await formatSmokeValue(
    port,
    current,
    `const stage = ${JSON.stringify(stage)};
     for (const select of doc.querySelectorAll('select')) {
       const option = Array.from(select.options).find(item => item.value === stage);
       if (option === undefined) continue;
       select.value = stage;
       select.dispatchEvent(new win.Event('change', { bubbles: true }));
       return { selected: stage };
     }
     return undefined;`,
    60_000,
  )
  if (selected?.selected !== stage) {
    throw new Error(`${current.caseId} did not expose required ${stage} stage`)
  }
}

async function observeFormatSmokeCase(port, testCase, current) {
  const opened = await formatSmokeValue(
    port,
    current,
    `const route = win.__MODKIT_ACCEPTANCE__?.subject?.selectedRoute;
     if (!Array.isArray(route) || route.length === 0) return undefined;
     return {
       selectedRoute: route.map(item => ({
         formatId: item?.formatId,
         extensionId: item?.extensionId,
         contributionId: item?.contributionId,
       })),
       readOnly: actual.readOnly,
     };`,
  )
  if (opened === undefined) {
    const diagnostics = await formatSmokeWebviewDiagnostics(port)
    throw new Error(
      `${testCase.id} published no matching installed webview; observed ` +
        portableString(JSON.stringify(diagnostics)).slice(0, 6_000),
    )
  }

  const evidence = {}
  if (testCase.stage === 'raster') {
    await selectFormatSmokeStage(port, current, 'image')
    evidence.raster = await formatSmokeValue(
      port,
      current,
      `const canvas = doc.querySelector('[data-mk-part="image.canvas"]');
       if (!(canvas instanceof win.HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) return undefined;
       const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
       if (pixels === undefined) return undefined;
       let opaquePixels = 0;
       for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) opaquePixels += 1;
       return opaquePixels > 0
         ? { width: canvas.width, height: canvas.height, pixelBytes: pixels.byteLength, opaquePixels }
         : undefined;`,
    )
    await selectFormatSmokeStage(port, current, 'metadata')
    evidence.metadata = await formatSmokeValue(
      port,
      current,
      `const entryCount = doc.querySelectorAll('[data-mk-part="metadata.row"]').length;
       return entryCount > 0 ? { entryCount } : undefined;`,
    )
  } else if (testCase.stage === 'tree-text') {
    await selectFormatSmokeStage(port, current, 'tree')
    evidence.tree = await formatSmokeValue(
      port,
      current,
      `const nodeCount = doc.querySelectorAll('[data-mk-part="tree.item"]').length;
       return nodeCount > 0 ? { nodeCount } : undefined;`,
    )
    await selectFormatSmokeStage(port, current, 'text')
    evidence.text = await formatSmokeValue(
      port,
      current,
      `const node = doc.querySelector('[data-mk-part="text"], [data-mk-part="virtual-text"]');
       const characterCount = node?.textContent?.length ?? 0;
       return characterCount > 0 ? { characterCount } : undefined;`,
    )
  } else if (testCase.stage === 'tree') {
    await selectFormatSmokeStage(port, current, 'archive')
    evidence.tree = await formatSmokeValue(
      port,
      current,
      `const nodeCount = doc.querySelectorAll('[data-mk-part="namespace.item"]').length;
       return nodeCount > 0 ? { nodeCount } : undefined;`,
    )
  } else if (testCase.stage === 'metadata-tree') {
    await selectFormatSmokeStage(port, current, 'metadata')
    evidence.metadata = await formatSmokeValue(
      port,
      current,
      `const entryCount = doc.querySelectorAll('[data-mk-part="metadata.row"]').length;
       return entryCount > 0 ? { entryCount } : undefined;`,
    )
    await selectFormatSmokeStage(port, current, 'tree')
    evidence.tree = await formatSmokeValue(
      port,
      current,
      `const nodeCount = doc.querySelectorAll('[data-mk-part="tree.item"]').length;
       return nodeCount > 0 ? { nodeCount } : undefined;`,
    )
  } else if (testCase.stage === 'model-or-wireframe') {
    await selectFormatSmokeStage(port, current, 'model')
    evidence.model = await formatSmokeValue(
      port,
      current,
      `const canvas = doc.querySelector('[data-mk-part="model.canvas"][data-model-renderer="wireframe"]');
       if (!(canvas instanceof win.HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) return undefined;
       const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
       if (pixels === undefined) return undefined;
       let opaquePixels = 0;
       for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) opaquePixels += 1;
       return opaquePixels > 0
         ? { canvas: { width: canvas.width, height: canvas.height }, renderer: 'wireframe', opaquePixels }
         : undefined;`,
    )
  } else {
    throw new Error(`${testCase.id} has unsupported stage ${testCase.stage}`)
  }

  const asserted = assertFormatSmokeWebviewResult(testCase, {
    caseId: testCase.id,
    uri: testCase.source.uri,
    selectedRoute: opened.selectedRoute,
    ...evidence,
  })
  const safeObservation = {
    caseId: testCase.id,
    selectedRoute: asserted.selectedRoute,
    stage: asserted.stage,
    assertions: asserted.assertions,
    evidence,
    readOnly: opened.readOnly === true,
  }
  const observationSha256 = `sha256:${createHash('sha256')
    .update(JSON.stringify(safeObservation))
    .digest('hex')}`
  return { safeObservation, observationSha256 }
}

function writeFormatSmokeAck(current, observation) {
  const ack = {
    kind: 'x3.vscode-installed-format-smoke-ack',
    schemaVersion: 1,
    artifactSha256: receipt.artifact.sha256,
    generation: 3,
    operationRevision: current.operationRevision,
    caseId: current.caseId,
    observationToken: current.observationToken,
    observationSha256: observation.observationSha256,
    verdict: 'pass',
    observation: observation.safeObservation,
  }
  const temporary = `${formatSmokeAckPath}.${process.pid}.${current.operationRevision}.tmp`
  writeFileSync(temporary, `${JSON.stringify(ack, null, 2)}\n`)
  rmSync(formatSmokeAckPath, { force: true })
  renameSync(temporary, formatSmokeAckPath)
}

const portableFormatSmokeCase = (testCase, current, observation) => ({
  caseId: testCase.id,
  family: testCase.family,
  stage: testCase.stage,
  corpus: {
    kind: testCase.source.kind,
    bytes: current.corpus.bytes,
    sha256: current.corpus.sha256,
    verifiedBeforeOpen: current.corpus.verifiedBeforeOpen === true,
    readOnly: current.corpus.readOnly === true,
  },
  observedRoute: observation.safeObservation.selectedRoute,
  evidence: observation.safeObservation.evidence,
  assertions: observation.safeObservation.assertions,
  operationRevision: current.operationRevision,
  observationSha256: observation.observationSha256,
  verdict: 'pass',
})

function evaluateTarget(webSocketDebuggerUrl, expression, timeoutMs = 10_000) {
  return new Promise(resolvePromise => {
    let socket
    const finish = value => {
      try {
        socket?.close()
      } catch {
        // The target may have disappeared during a full application restart.
      }
      resolvePromise(value)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    try {
      socket = new WebSocket(webSocketDebuggerUrl)
    } catch {
      clearTimeout(timer)
      resolvePromise(undefined)
      return
    }
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      )
    })
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      clearTimeout(timer)
      finish(message.result?.result?.value)
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      finish(undefined)
    })
  })
}

async function cdpVersion(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) return undefined
    return await response.json()
  } catch {
    return undefined
  }
}

async function waitForEndpointStopped(port, timeoutMs) {
  const stopped = await waitFor(
    async () => {
      const version = await cdpVersion(port)
      return version === undefined ? true : undefined
    },
    { timeoutMs, stepMs: 250 },
  )
  return stopped === true
}

async function sendBrowserClose(webSocketDebuggerUrl) {
  const evidence = {
    method: 'Browser.close',
    attempted: typeof webSocketDebuggerUrl === 'string',
    sent: false,
    acknowledged: false,
    socketClosed: false,
    timedOut: false,
    error: null,
  }
  if (!evidence.attempted) return evidence
  await new Promise(resolvePromise => {
    let socket
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        // Browser.close normally tears the socket down before it can acknowledge the request.
      }
      resolvePromise()
    }
    const timer = setTimeout(() => {
      evidence.timedOut = true
      finish()
    }, 5_000)
    try {
      socket = new WebSocket(webSocketDebuggerUrl)
    } catch (error) {
      evidence.error = error instanceof Error ? error.message : String(error)
      finish()
      return
    }
    socket.addEventListener('open', () => {
      evidence.sent = true
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    })
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (message.id !== 1) return
      evidence.acknowledged = true
      finish()
    })
    socket.addEventListener('close', () => {
      evidence.socketClosed = true
      finish()
    })
    socket.addEventListener('error', event => {
      evidence.error = String(event?.message ?? 'WebSocket error')
      finish()
    })
  })
  return evidence
}

function normalizeProcessList(value) {
  const processes = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return processes
    .map(item => ({
      pid: Number(item.ProcessId ?? item.pid),
      ppid: Number(item.ParentProcessId ?? item.ppid),
      name: String(item.Name ?? item.name ?? ''),
      commandLine: String(item.CommandLine ?? item.commandLine ?? ''),
      workingSetBytes: Number(item.WorkingSetSize ?? item.workingSetBytes),
      privateBytes: Number(item.PrivatePageCount ?? item.privateBytes),
    }))
    .filter(item => Number.isInteger(item.pid) && item.pid > 0)
}

function listProcesses() {
  if (process.platform === 'win32') {
    const powershell =
      resolveCommand('powershell.exe') ?? resolveCommand('pwsh.exe') ?? 'powershell.exe'
    const result = spawnSync(
      powershell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress',
      ],
      {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: processListTimeoutMs,
      },
    )
    if ((result.status ?? 1) !== 0) {
      return {
        processes: [],
        error: compact(result.stderr ?? result.error?.message ?? result.stdout),
      }
    }
    try {
      return { processes: normalizeProcessList(JSON.parse(result.stdout || '[]')), error: null }
    } catch (error) {
      return { processes: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], {
    encoding: 'utf8',
    shell: false,
    timeout: processListTimeoutMs,
  })
  if ((result.status ?? 1) !== 0) {
    return {
      processes: [],
      error: compact(result.stderr ?? result.error?.message ?? result.stdout),
    }
  }
  return {
    processes: result.stdout
      .split(/\r?\n/u)
      .map(line => line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/u))
      .filter(match => match !== null)
      .map(([, pid, ppid, name, commandLine]) => ({
        pid: Number(pid),
        ppid: Number(ppid),
        name,
        commandLine,
        workingSetBytes: Number.NaN,
        privateBytes: Number.NaN,
      })),
    error: null,
  }
}

function isolatedProcessMatch(processInfo, port) {
  const commandLine = processInfo.commandLine
  const reasons = []
  if (commandLine.includes(userData)) reasons.push('isolated-user-data-dir')
  if (commandLine.includes(extensionsDir)) reasons.push('isolated-extensions-dir')
  if (
    commandLine.includes(`--remote-debugging-port=${port}`) ||
    commandLine.includes(`--remote-debugging-port ${port}`)
  ) {
    reasons.push('remote-debugging-port')
  }
  return reasons
}

function findIsolatedProcesses(port) {
  const listed = listProcesses()
  const errors = listed.error === null ? [] : [`process-list: ${listed.error}`]
  const matched = listed.processes
    .map(processInfo => ({ processInfo, reasons: isolatedProcessMatch(processInfo, port) }))
    .filter(match => match.reasons.length > 0)
  return {
    processes: listed.processes,
    matched,
    evidence: {
      processes: matched.map(({ processInfo, reasons }) => ({
        pid: processInfo.pid,
        name: processInfo.name,
        reasons,
      })),
      errors,
    },
  }
}

async function waitForIsolatedProcessesExited(port, timeoutMs) {
  let lastEvidence = { processes: [], errors: [] }
  const exited = await waitFor(
    async () => {
      lastEvidence = findIsolatedProcesses(port).evidence
      if (lastEvidence.errors.length > 0) return undefined
      return lastEvidence.processes.length === 0 ? true : undefined
    },
    { timeoutMs, stepMs: 1_000 },
  )
  return { exited: exited === true, ...lastEvidence }
}

function descendantPids(processes, rootPids) {
  const children = new Map()
  for (const processInfo of processes) {
    const siblings = children.get(processInfo.ppid) ?? []
    siblings.push(processInfo.pid)
    children.set(processInfo.ppid, siblings)
  }
  const discovered = new Set(rootPids)
  const queue = [...rootPids]
  while (queue.length > 0) {
    const pid = queue.shift()
    for (const child of children.get(pid) ?? []) {
      if (discovered.has(child)) continue
      discovered.add(child)
      queue.push(child)
    }
  }
  return discovered
}

function sampleIsolatedProcessTreeMemory(port) {
  const listed = listProcesses()
  if (listed.error !== null) return { error: `process-list: ${listed.error}` }
  const matched = listed.processes
    .map(processInfo => ({ processInfo, reasons: isolatedProcessMatch(processInfo, port) }))
    .filter(match => match.reasons.length > 0)
  const matchedPidSet = new Set(matched.map(match => match.processInfo.pid))
  // VS Code propagates the isolated command-line switches to several children. Keep only the
  // outermost matched processes as roots so those matched children remain explicit descendants.
  const matchedRootPids = matched
    .filter(match => !matchedPidSet.has(match.processInfo.ppid))
    .map(match => match.processInfo.pid)
  if (matchedRootPids.length === 0) {
    return {
      error:
        'no isolated VS Code process root matched the user-data/extensions/debug-port evidence',
    }
  }
  const processPids = descendantPids(listed.processes, matchedRootPids)
  const processes = listed.processes.filter(processInfo => processPids.has(processInfo.pid))
  const descendants = processes
    .map(processInfo => processInfo.pid)
    .filter(pid => !matchedRootPids.includes(pid))
  if (descendants.length === 0) {
    return { error: 'isolated VS Code process tree exposed no descendants to sample' }
  }
  if (
    processes.some(
      processInfo =>
        !Number.isSafeInteger(processInfo.workingSetBytes) ||
        processInfo.workingSetBytes < 0 ||
        !Number.isSafeInteger(processInfo.privateBytes) ||
        processInfo.privateBytes < 0,
    )
  ) {
    return { error: 'Win32_Process WorkingSetSize or PrivatePageCount was unavailable' }
  }
  const workingSetBytes = processes.reduce(
    (total, processInfo) => total + processInfo.workingSetBytes,
    0,
  )
  const privateBytes = processes.reduce((total, processInfo) => total + processInfo.privateBytes, 0)
  if (!Number.isSafeInteger(workingSetBytes) || !Number.isSafeInteger(privateBytes)) {
    return { error: 'isolated VS Code process-tree memory total was not a safe integer' }
  }
  return {
    timestampMs: Date.now(),
    matchedRootPids,
    descendantPids: descendants,
    processPids: processes.map(processInfo => processInfo.pid),
    workingSetBytes,
    privateBytes,
  }
}

function startArmodProcessTreeMemorySampler(port) {
  const samples = []
  const errors = []
  const matchedRootPids = new Set()
  const descendantProcessPids = new Set()
  const sampledProcessPids = new Set()
  const sample = () => {
    const observation = sampleIsolatedProcessTreeMemory(port)
    if ('error' in observation) {
      if (!errors.includes(observation.error)) errors.push(observation.error)
      return
    }
    samples.push(observation)
    for (const pid of observation.matchedRootPids) matchedRootPids.add(pid)
    for (const pid of observation.descendantPids) descendantProcessPids.add(pid)
    for (const pid of observation.processPids) sampledProcessPids.add(pid)
  }
  sample()
  const timer =
    errors.length === 0 ? setInterval(sample, armodProcessTreeRequestedSampleIntervalMs) : undefined
  timer?.unref()
  let stoppedEvidence
  const startAcknowledgement = () => ({
    observedBy: 'external-process-tree',
    collector: 'Win32_Process',
    requestedSampleIntervalMs: armodProcessTreeRequestedSampleIntervalMs,
    errors: [...errors],
    verdict: errors.length === 0 && samples.length === 1 ? 'pass' : 'fail',
  })
  const stop = () => {
    if (stoppedEvidence !== undefined) return stoppedEvidence
    if (timer !== undefined) clearInterval(timer)
    sample()
    const baseline = samples[0]
    const peakWorkingSetBytes = Math.max(...samples.map(item => item.workingSetBytes), 0)
    const peakPrivateBytes = Math.max(...samples.map(item => item.privateBytes), 0)
    const workingSetBaselineBytes = baseline?.workingSetBytes ?? 0
    const privateBaselineBytes = baseline?.privateBytes ?? 0
    const intervals = samples
      .slice(1)
      .map((item, index) => item.timestampMs - samples[index].timestampMs)
    const observedCadence = {
      intervalCount: intervals.length,
      minIntervalMs: intervals.length === 0 ? 0 : Math.min(...intervals),
      maxIntervalMs: intervals.length === 0 ? 0 : Math.max(...intervals),
      averageIntervalMs:
        intervals.length === 0
          ? 0
          : intervals.reduce((total, interval) => total + interval, 0) / intervals.length,
    }
    const evidence = {
      observedBy: 'external-process-tree',
      collector: 'Win32_Process',
      requestedSampleIntervalMs: armodProcessTreeRequestedSampleIntervalMs,
      matchedRootPids: [...matchedRootPids].sort((left, right) => left - right),
      descendantPids: [...descendantProcessPids].sort((left, right) => left - right),
      sampledProcessPids: [...sampledProcessPids].sort((left, right) => left - right),
      sampleCount: samples.length,
      samples: samples.map(item => ({
        timestampMs: item.timestampMs,
        workingSetBytes: item.workingSetBytes,
        privateBytes: item.privateBytes,
      })),
      observedCadence,
      errors: [...errors],
      workingSetBytes: {
        baselineBytes: workingSetBaselineBytes,
        peakBytes: peakWorkingSetBytes,
        deltaBytes: peakWorkingSetBytes - workingSetBaselineBytes,
        deltaCeilingBytes: armodProcessTreeMemoryDeltaCeilingBytes,
      },
      privateBytes: {
        baselineBytes: privateBaselineBytes,
        peakBytes: peakPrivateBytes,
        deltaBytes: peakPrivateBytes - privateBaselineBytes,
        deltaCeilingBytes: armodProcessTreeMemoryDeltaCeilingBytes,
      },
    }
    const validMetric = metric =>
      Number.isSafeInteger(metric.baselineBytes) &&
      Number.isSafeInteger(metric.peakBytes) &&
      Number.isSafeInteger(metric.deltaBytes) &&
      metric.peakBytes >= metric.baselineBytes &&
      metric.deltaBytes === metric.peakBytes - metric.baselineBytes &&
      metric.deltaBytes <= metric.deltaCeilingBytes
    stoppedEvidence = {
      ...evidence,
      verdict:
        evidence.errors.length === 0 &&
        evidence.sampleCount >= armodProcessTreeMinimumSamples &&
        evidence.matchedRootPids.length > 0 &&
        evidence.descendantPids.length > 0 &&
        evidence.observedCadence.intervalCount === evidence.sampleCount - 1 &&
        evidence.observedCadence.minIntervalMs > 0 &&
        evidence.observedCadence.maxIntervalMs >= evidence.observedCadence.minIntervalMs &&
        evidence.observedCadence.maxIntervalMs <= armodProcessTreeMaximumObservedIntervalMs &&
        evidence.observedCadence.averageIntervalMs >= evidence.observedCadence.minIntervalMs &&
        evidence.observedCadence.averageIntervalMs <= evidence.observedCadence.maxIntervalMs &&
        validMetric(evidence.workingSetBytes) &&
        validMetric(evidence.privateBytes)
          ? 'pass'
          : 'fail',
    }
    return stoppedEvidence
  }
  return { startAcknowledgement, stop }
}

function terminateIsolatedProcessTree(port) {
  const evidence = {
    attempted: true,
    platform: process.platform,
    matchedProcesses: [],
    killedProcesses: [],
    errors: [],
  }
  const isolated = findIsolatedProcesses(port)
  evidence.errors.push(...isolated.evidence.errors)
  const matched = isolated.matched
  evidence.matchedProcesses = matched.map(({ processInfo, reasons }) => ({
    pid: processInfo.pid,
    name: processInfo.name,
    reasons,
  }))
  if (matched.length === 0) return evidence

  const matchedPids = matched.map(match => match.processInfo.pid)
  const killPids = descendantPids(isolated.processes, matchedPids)
  killPids.delete(process.pid)

  if (process.platform === 'win32') {
    const taskkill = resolveCommand('taskkill.exe') ?? 'taskkill.exe'
    const matchedPidSet = new Set(matchedPids)
    const treeRoots = matched
      .filter(match => !matchedPidSet.has(match.processInfo.ppid))
      .map(match => match.processInfo.pid)
    for (const pid of treeRoots) {
      if (pid === process.pid) continue
      const result = spawnSync(taskkill, ['/PID', String(pid), '/T', '/F'], {
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      })
      evidence.killedProcesses.push({ pid, method: 'taskkill /T /F', exitCode: result.status ?? 1 })
      if ((result.status ?? 1) !== 0) {
        evidence.errors.push(
          `taskkill ${pid}: ${compact(result.stderr || result.stdout || result.error?.message)}`,
        )
      }
    }
    return evidence
  }

  for (const pid of killPids) {
    try {
      process.kill(pid, 'SIGTERM')
      evidence.killedProcesses.push({ pid, method: 'SIGTERM', exitCode: 0 })
    } catch (error) {
      evidence.errors.push(
        `SIGTERM ${pid}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return evidence
}

async function closeApplication(port, generation = null) {
  const started = Date.now()
  const evidence = {
    generation,
    port,
    startedAt: new Date(started).toISOString(),
    endpointReachableBefore: false,
    cdp: null,
    endpointStoppedAfterCdp: false,
    isolatedProcessesExitedAfterCdp: false,
    isolatedProcessesAfterCdp: [],
    isolatedProcessErrorsAfterCdp: [],
    fallback: { attempted: false },
    endpointStoppedAfterFallback: false,
    isolatedProcessesExitedAfterFallback: false,
    isolatedProcessesAfterFallback: [],
    isolatedProcessErrorsAfterFallback: [],
    finishedAt: null,
    elapsedMs: null,
    verdict: 'fail',
  }
  const version = await cdpVersion(port)
  evidence.endpointReachableBefore = version !== undefined
  if (version === undefined) {
    evidence.endpointStoppedAfterCdp = true
  } else {
    evidence.cdp = await sendBrowserClose(version.webSocketDebuggerUrl)
    evidence.endpointStoppedAfterCdp = await waitForEndpointStopped(port, 20_000)
  }
  const afterCdpProcesses = await waitForIsolatedProcessesExited(port, 10_000)
  evidence.isolatedProcessesExitedAfterCdp = afterCdpProcesses.exited
  evidence.isolatedProcessesAfterCdp = afterCdpProcesses.processes
  evidence.isolatedProcessErrorsAfterCdp = afterCdpProcesses.errors
  if (!evidence.endpointStoppedAfterCdp || !evidence.isolatedProcessesExitedAfterCdp) {
    evidence.fallback = terminateIsolatedProcessTree(port)
    evidence.endpointStoppedAfterFallback = await waitForEndpointStopped(port, 15_000)
    const afterFallbackProcesses = await waitForIsolatedProcessesExited(port, 10_000)
    evidence.isolatedProcessesExitedAfterFallback = afterFallbackProcesses.exited
    evidence.isolatedProcessesAfterFallback = afterFallbackProcesses.processes
    evidence.isolatedProcessErrorsAfterFallback = afterFallbackProcesses.errors
  }
  evidence.verdict =
    (evidence.endpointStoppedAfterCdp && evidence.isolatedProcessesExitedAfterCdp) ||
    (evidence.endpointStoppedAfterFallback && evidence.isolatedProcessesExitedAfterFallback)
      ? 'pass'
      : 'fail'
  evidence.finishedAt = new Date().toISOString()
  evidence.elapsedMs = Date.now() - started
  return evidence
}

async function webviewValues(port, expression) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  const targets = await response.json()
  const webviews = (Array.isArray(targets) ? targets : []).filter(
    target =>
      typeof target?.url === 'string' &&
      target.url.includes('vscode-webview') &&
      typeof target.webSocketDebuggerUrl === 'string',
  )
  const values = []
  for (const target of webviews) {
    const value = await evaluateTarget(target.webSocketDebuggerUrl, expression)
    if (value !== undefined && value !== null) values.push(value)
  }
  return values
}

const webviewDocumentExpression = body => `(() => {
  const candidates = [{ doc: document, win: globalThis }];
  for (const frame of document.querySelectorAll('iframe')) {
    try {
      if (frame.contentDocument && frame.contentWindow) {
        candidates.push({ doc: frame.contentDocument, win: frame.contentWindow });
      }
    } catch (error) { void error; }
  }
  for (const candidate of candidates) {
    try {
      const value = (${body})(candidate.doc, candidate.win);
      if (value !== undefined && value !== null) return value;
    } catch (error) { void error; }
  }
  return undefined;
})()`

async function fillQuickInput(page, query) {
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.keyboard.press('Escape').catch(() => undefined)
    await page.waitForTimeout(100)
    await page.keyboard.press('F1')
    const widget = page.locator('.quick-input-widget:visible').last()
    const input = widget.locator('input:visible').last()
    try {
      await input.waitFor({ state: 'visible', timeout: 5_000 })
      // F1 starts in command mode with a `>` prefix. `fill` replaces the complete value, so keep
      // that prefix explicitly instead of accidentally turning the request into file Quick Open.
      await input.fill(`>${query}`, { timeout: 5_000 })
      return widget
    } catch (error) {
      lastError = error
      await page.waitForTimeout(250)
    }
  }
  throw new Error(
    `quick input did not stay open for ${JSON.stringify(query)}: ${String(lastError)}`,
  )
}

async function chooseQuickInput(page, query, expectedText) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const widget = await fillQuickInput(page, query)
    const row = widget
      .locator('.quick-input-list .monaco-list-row:visible')
      .filter({ hasText: expectedText })
      .first()
    try {
      await row.waitFor({ state: 'visible', timeout: 20_000 })
      const selectedText = await row.innerText()
      await row.click()
      return selectedText
    } catch (error) {
      lastError = error
      await page.keyboard.press('Escape').catch(() => undefined)
      await page
        .locator('.monaco-workbench')
        .click({ position: { x: 8, y: 8 }, timeout: 5_000 })
        .catch(() => undefined)
      await page.waitForTimeout(250)
    }
  }
  throw new Error(
    `quick input exposed no ${String(expectedText)} for ${JSON.stringify(query)}: ${String(lastError)}`,
  )
}

async function activateEditor(page, filePath = ddsPath) {
  const file = basename(filePath)
  const tabs = page.locator('.tabs-container .tab:visible')
  const tab = tabs.filter({ hasText: file }).last()
  if ((await tab.count()) === 0) {
    const visibleTabs = await tabs.allInnerTexts()
    throw new Error(
      `editor tab ${JSON.stringify(file)} is not visible; visible tabs: ${JSON.stringify(visibleTabs)}`,
    )
  }
  await tab.click()
  await page.waitForTimeout(250)
}

async function openWorkspaceFile(page, filePath) {
  const file = basename(filePath)
  await page.keyboard.press('Control+P')
  const widget = page.locator('.quick-input-widget:visible').last()
  const input = widget.locator('input:visible').last()
  await input.waitFor({ state: 'visible', timeout: 5_000 })
  await input.fill(file)
  const row = widget
    .locator('.quick-input-list .monaco-list-row:visible')
    .filter({ hasText: file })
    .first()
  await row.waitFor({ state: 'visible', timeout: 20_000 })
  await row.click()
  await page
    .locator('.tabs-container .tab:visible')
    .filter({ hasText: file })
    .last()
    .waitFor({ state: 'visible', timeout: 20_000 })
}

async function inspectModkitCommands(page) {
  const widget = await fillQuickInput(page, 'modkit')
  const rows = widget.locator('.quick-input-list .monaco-list-row:visible')
  const commandTexts = await waitFor(
    async () => {
      const texts = await rows.allInnerTexts()
      return texts.length > 0 ? texts : undefined
    },
    { timeoutMs: 20_000 },
  )
  await page.keyboard.press('Escape')
  if (commandTexts === undefined) {
    throw new Error('installed extension exposed no Modkit commands in the command palette')
  }
  return commandTexts
}

async function reopenWithModkit(page, filePath = ddsPath) {
  await activateEditor(page, filePath)
  try {
    receipt.install.reopenCommand = await chooseQuickInput(
      page,
      'reopen editor with',
      /^View: Reopen Editor With(?:\.\.\.|…)?$/u,
    )
  } catch (paletteError) {
    // VS Code can hide the palette command after an editor association changed earlier in the
    // same session. The editor-tab context menu is the equivalent ordinary user UI route.
    await page.keyboard.press('Escape').catch(() => undefined)
    const file = basename(filePath)
    const tab = page.locator('.tabs-container .tab:visible').filter({ hasText: file }).last()
    await tab.click({ button: 'right' })
    const menuItem = page
      .getByRole('menuitem', { name: /^Reopen Editor With(?:\.\.\.|…)?$/u })
      .last()
    try {
      await menuItem.waitFor({ state: 'visible', timeout: 10_000 })
      receipt.install.reopenCommand = `tab context menu: ${await menuItem.innerText()}`
      await menuItem.click()
    } catch (contextMenuError) {
      throw new Error(
        `Reopen Editor With was unavailable in both command palette and tab context menu; ` +
          `palette=${String(paletteError)}; context=${String(contextMenuError)}`,
      )
    }
  }
  const widget = page.locator('.quick-input-widget:visible').last()
  const rows = widget.locator('.quick-input-list .monaco-list-row:visible')
  const option = page.locator(':text-is("Modkit Asset Preview"):visible').last()
  try {
    await option.waitFor({ state: 'visible', timeout: 20_000 })
  } catch (error) {
    const visibleRows = await rows.allInnerTexts().catch(() => [])
    const allVisibleRows = await page
      .locator('.monaco-list-row:visible')
      .allInnerTexts()
      .catch(() => [])
    const visibleContexts = await page
      .locator('.context-view:visible')
      .allInnerTexts()
      .catch(() => [])
    const widgetText = await widget.innerText().catch(() => '<no visible quick input>')
    const activeTabs = await page
      .locator('.tabs-container .tab.active:visible')
      .allInnerTexts()
      .catch(() => [])
    const relevantBodyLines = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    )
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(line => /modkit|editor|wave1a|dds|encoding/iu.test(line))
      .slice(0, 80)
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined)
    throw new Error(
      `Reopen Editor With exposed no Modkit option; active tabs=${JSON.stringify(activeTabs)}; ` +
        `picker rows=${JSON.stringify(visibleRows)}; all rows=${JSON.stringify(allVisibleRows)}; ` +
        `contexts=${JSON.stringify(visibleContexts)}; picker=${JSON.stringify(widgetText)}; ` +
        `relevant body=${JSON.stringify(relevantBodyLines)}; ` +
        `cause=${String(error)}`,
    )
  }
  await option.click()
}

async function observeCorruptInputRefusal(page, port, timeoutMs = 60_000) {
  const file = basename(corruptDdsPath)
  const webviewMessage = await waitFor(
    async () => {
      const values = await webviewValues(
        port,
        webviewDocumentExpression(
          `doc => {
            const text = (doc.body?.innerText || '').slice(0, 8000);
            return text.includes(${JSON.stringify(file)}) &&
              text.includes('x3.host/subject-input-open-failed') &&
              text.includes('input-open')
              ? text
              : undefined;
          }`,
        ),
      )
      return values.find(value => typeof value === 'string')
    },
    { timeoutMs, stepMs: 500 },
  )
  if (webviewMessage !== undefined) return webviewMessage

  await page.keyboard.press('Escape').catch(() => undefined)
  const panel = page.locator('.markers-panel:visible').last()
  if ((await panel.count()) === 0) await page.keyboard.press('Control+Shift+M')
  await panel.waitFor({ state: 'visible', timeout: 20_000 })
  return waitFor(
    async () => {
      const text = await panel.innerText().catch(() => '')
      return text.includes(file) &&
        text.includes('x3.host/subject-input-open-failed') &&
        text.includes('input-open')
        ? text
        : undefined
    },
    { timeoutMs: 20_000, stepMs: 250 },
  )
}

function assertA7(a7) {
  for (const field of [
    'expectedRoots',
    'loadedRoots',
    'missingRoots',
    'unexpectedRoots',
    'expectedContributions',
    'loadedContributions',
    'missingContributions',
    'unexpectedContributions',
    'loadErrors',
  ]) {
    if (!Array.isArray(a7?.[field])) throw new Error(`A7 receipt has no ${field} array`)
  }
  if (a7.expectedRoots.length !== 8 || a7.loadedRoots.length !== 8) {
    throw new Error(
      `A7 expected/loaded roots are ${a7.expectedRoots.length}/${a7.loadedRoots.length}, not 8/8`,
    )
  }
  if (a7.expectedContributions.length !== 87 || a7.loadedContributions.length !== 87) {
    throw new Error(
      `A7 expected/loaded contributions are ${a7.expectedContributions.length}/${a7.loadedContributions.length}, not 87/87`,
    )
  }
  for (const field of [
    'missingRoots',
    'unexpectedRoots',
    'missingContributions',
    'unexpectedContributions',
    'loadErrors',
  ]) {
    if (a7[field].length !== 0)
      throw new Error(`A7 ${field} is not empty: ${JSON.stringify(a7[field])}`)
  }
  if (a7.verdict !== 'pass') throw new Error(`A7 verdict is ${String(a7.verdict)}, not pass`)
}

function assertDds(probe) {
  const selected = probe.acceptance?.subject?.selected
  const identity = probe.acceptance?.subject?.descriptor?.identity
  if (selected?.contributionId !== 'modkit/dds') {
    throw new Error(`DDS selected ${String(selected?.contributionId)}, not modkit/dds`)
  }
  if (identity?.formatId !== 'dds')
    throw new Error(`DDS format metadata is ${String(identity?.formatId)}, not dds`)
  if (probe.raster?.width !== 4 || probe.raster?.height !== 4 || probe.raster?.pixelBytes !== 64) {
    throw new Error(
      `DDS raster is not the expected non-empty 4x4 RGBA surface: ${JSON.stringify(probe.raster)}`,
    )
  }
  if ((probe.raster?.opaquePixels ?? 0) <= 0)
    throw new Error('DDS raster contains no visible pixel')
  if (
    !Array.isArray(probe.stages) ||
    !probe.stages.includes('Image') ||
    !probe.stages.includes('Metadata')
  ) {
    throw new Error(`DDS did not expose Image and Metadata stages: ${JSON.stringify(probe.stages)}`)
  }
}

async function launchGeneration(generation) {
  const port = await freePort()
  activeApplications.set(port, { generation, launchPid: null })
  const launchArguments = [
    '--new-window',
    '--user-data-dir',
    userData,
    '--extensions-dir',
    extensionsDir,
    '--disable-gpu',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--locale=en',
    `--remote-debugging-port=${port}`,
    workspaceFile,
    ...(generation === 1 ? [ddsPath] : []),
  ]
  // Intentionally no --extensionDevelopmentPath and no --disable-extensions.
  const codeLauncher = resolveVsCodeCliLauncher()
  const launcher = spawn(codeLauncher.command, [...codeLauncher.argsPrefix, ...launchArguments], {
    cwd: workspace,
    detached: false,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ...codeLauncher.environment,
      MODKIT_EXTENSION_ALLOWED_ORIGINS: '',
      MODKIT_EXTENSION_RAPID_POOL_ROOT: '',
      MODKIT_EXTENSION_REGISTRY: '',
      [packageInstallGateFlag]: '1',
      [packageInstallGateGenerationFlag]: String(generation),
      [packageInstallGateArtifactFlag]: receipt.artifact.sha256 ?? '',
      [packageInstallGateContinueFlag]: packageInstallGateContinuePath,
      [formatSmokeWorkspaceRootFlag]: formatSmokeRoots.workspaceRoot,
      [formatSmokeSc2RootFlag]: formatSmokeRoots.sc2InstallRoot,
      [formatSmokeWarzoneRootFlag]: formatSmokeRoots.warzoneInstallRoot,
      [formatSmokeStartFlag]: formatSmokeStartPath,
      [formatSmokeAckFlag]: formatSmokeAckPath,
      [archiveAcceptanceStartFlag]: archiveAcceptanceStartPath,
      [archiveAcceptanceAckFlag]: archiveAcceptanceAckPath,
      ...(disabledRouteUri === undefined
        ? {}
        : { [packageInstallGateDisabledUriFlag]: disabledRouteUri }),
    },
  })
  launcher.unref()
  activeApplications.set(port, { generation, launchPid: launcher.pid ?? null })
  const endpoint = await waitFor(
    async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      return response.ok ? `http://127.0.0.1:${port}` : undefined
    },
    { timeoutMs: 45_000, stepMs: 500 },
  )
  if (endpoint === undefined)
    throw new Error(`VS Code generation ${generation} exposed no CDP endpoint`)
  const browser = await chromium.connectOverCDP(endpoint)
  const context = browser.contexts()[0]
  const page = await waitFor(
    () =>
      context
        ?.pages()
        .find(
          candidate =>
            candidate.url().includes('workbench') || candidate.url().includes('vscode-app'),
        ),
    { timeoutMs: 30_000 },
  )
  if (page === undefined)
    throw new Error(`VS Code generation ${generation} exposed no workbench page`)
  page.setDefaultTimeout(30_000)
  await page.waitForFunction(file => document.body?.innerText.includes(file), basename(ddsPath), {
    timeout: 30_000,
  })
  const installedCommands = await inspectModkitCommands(page)
  receipt.install.commandPaletteMatches = installedCommands
  const readAcceptance = () =>
    waitFor(
      async () => {
        const values = await webviewValues(
          port,
          webviewDocumentExpression(
            `(_doc, win) => win.__MODKIT_ACCEPTANCE__?.subject?.selected?.contributionId
              ? JSON.parse(JSON.stringify(win.__MODKIT_ACCEPTANCE__))
              : undefined`,
          ),
        )
        return values.find(value => value?.subject?.selected?.contributionId === 'modkit/dds')
      },
      { timeoutMs: 60_000, stepMs: 500 },
    )

  let route
  let acceptance
  if (generation === 1) {
    await reopenWithModkit(page)
    route = 'Reopen Editor With -> Modkit Asset Preview'
    acceptance = await readAcceptance()
  } else {
    route = 'full application restart -> restored Modkit Asset Preview'
    acceptance = await readAcceptance()
  }

  if (acceptance === undefined)
    throw new Error('installed DDS webview published no machine-readable subject receipt')
  assertA7(acceptance.a7)

  await waitFor(
    async () => {
      const values = await webviewValues(
        port,
        webviewDocumentExpression(
          `(doc, win) => {
            for (const select of doc.querySelectorAll('select')) {
              const option = Array.from(select.options).find(item => (item.textContent || '').trim() === 'Image');
              if (!option) continue;
              select.value = option.value;
              select.dispatchEvent(new win.Event('change', { bubbles: true }));
              return true;
            }
            return undefined;
          }`,
        ),
      )
      return values.includes(true) ? true : undefined
    },
    { timeoutMs: 20_000 },
  )

  const probe = await waitFor(
    async () => {
      const values = await webviewValues(
        port,
        webviewDocumentExpression(
          `(doc, win) => {
            const canvas = doc.querySelector('[data-mk-part="image.canvas"]');
            if (!(canvas instanceof win.HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) return undefined;
            const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
            if (!pixels) return undefined;
            let opaquePixels = 0;
            for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) opaquePixels += 1;
            return {
              acceptance: JSON.parse(JSON.stringify(win.__MODKIT_ACCEPTANCE__)),
              stages: Array.from(doc.querySelectorAll('select option')).map(item => (item.textContent || '').trim()),
              raster: { width: canvas.width, height: canvas.height, pixelBytes: pixels.byteLength, opaquePixels },
              text: (doc.body?.innerText || '').slice(0, 4000),
            };
          }`,
        ),
      )
      return values.find(
        value =>
          value?.raster?.width === 4 &&
          value.raster.height === 4 &&
          value.raster.pixelBytes === 64 &&
          value.raster.opaquePixels > 0,
      )
    },
    { timeoutMs: 60_000, stepMs: 500 },
  )
  if (probe === undefined)
    throw new Error('installed DDS Image stage rendered no readable raster canvas')
  assertDds(probe)
  if (generation === 1) await page.screenshot({ path: screenshotPath, fullPage: false })

  const metadataSelected = await waitFor(
    async () => {
      const values = await webviewValues(
        port,
        webviewDocumentExpression(
          `(doc, win) => {
            for (const select of doc.querySelectorAll('select')) {
              const option = Array.from(select.options).find(item => (item.textContent || '').trim() === 'Metadata');
              if (!option) continue;
              select.value = option.value;
              select.dispatchEvent(new win.Event('change', { bubbles: true }));
              return true;
            }
            return undefined;
          }`,
        ),
      )
      return values.includes(true) ? true : undefined
    },
    { timeoutMs: 20_000 },
  )
  if (metadataSelected !== true)
    throw new Error('installed DDS Metadata stage could not be selected')
  const metadata = await waitFor(
    async () => {
      const values = await webviewValues(
        port,
        webviewDocumentExpression(
          `doc => {
            const selected = Array.from(doc.querySelectorAll('select')).some(
              select => (select.selectedOptions[0]?.textContent || '').trim() === 'Metadata',
            );
            if (!selected) return undefined;
            const text = (doc.body?.innerText || '').slice(0, 4000);
            return /dds|format|width|height/i.test(text) && text.length > 80 ? text : undefined;
          }`,
        ),
      )
      return values.find(value => typeof value === 'string')
    },
    { timeoutMs: 20_000, stepMs: 500 },
  )
  if (metadata === undefined)
    throw new Error('installed DDS Metadata stage exposed no non-empty format metadata')

  let corruptInput = null
  if (generation === 1) {
    await openWorkspaceFile(page, corruptDdsPath)
    // The first explicit Reopen With may leave the Modkit custom editor selected for later DDS
    // files in this isolated profile. Accept that installed-user route when it is already visible;
    // otherwise exercise Reopen With again before requiring the same typed refusal.
    let message = await observeCorruptInputRefusal(page, port, 5_000)
    let corruptRoute = 'workspace open -> selected installed Modkit editor'
    if (message === undefined) {
      await activateEditor(page, corruptDdsPath)
      await chooseQuickInput(
        page,
        'modkit open active file in workbench',
        /^Modkit: Open Active File in Workbench$/u,
      )
      corruptRoute = 'workspace open -> command palette -> Modkit: Open Active File in Workbench'
      message = await observeCorruptInputRefusal(page, port, 60_000)
    }
    if (message === undefined) {
      const webviewTexts = await webviewValues(
        port,
        webviewDocumentExpression(`doc => (doc.body?.innerText || '').slice(0, 8000)`),
      ).catch(() => [])
      const activeTabs = await page
        .locator('.tabs-container .tab.active:visible')
        .allInnerTexts()
        .catch(() => [])
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined)
      throw new Error(
        `C3 corrupt DDS exposed no typed input-open refusal in the installed UI; ` +
          `active tabs=${JSON.stringify(activeTabs)}; webviews=${JSON.stringify(webviewTexts)}`,
      )
    }
    corruptInput = {
      file: basename(corruptDdsPath),
      code: 'x3.host/subject-input-open-failed',
      missingStep: 'input-open',
      route: corruptRoute,
      message: compact(message, 2_000),
      verdict: 'pass',
    }
    Object.assign(receipt.corruptInput, corruptInput)
    // Restart proof is for the valid DDS raster/metadata canary. Leave that editor active after the
    // corrupt-input refusal so VS Code restores the intended installed-user surface in generation 2.
    await activateEditor(page, ddsPath)
  }

  let packageGatePhase
  let packageGateExternal = null
  let packageGateExternalFailure
  if (generation === 2) {
    const progress =
      disabledRouteUri === undefined || disabledRouteUri.trim() === ''
        ? undefined
        : await waitForPackageInstallGatePhase(generation, ['awaiting-continuation', 'complete'])
    const awaiting = progress?.state === 'awaiting-continuation' ? progress : undefined
    packageGateExternal = {
      awaitingContinuation: awaiting !== undefined,
      disabledRouteObservation:
        awaiting === undefined
          ? {
              attempted: false,
              observed: false,
              error:
                progress?.state === 'complete'
                  ? `package gate completed before external observation: ${packageGatePhaseFailures(progress)}`
                  : `${packageInstallGateDisabledUriFlag} is not set`,
            }
          : await observeDisabledRouteSuppression(port),
      continuationSentinel: portablePath(packageInstallGateContinuePath),
      continuationWritten: false,
    }
    if (!packageGateExternal.disabledRouteObservation.observed) {
      packageGateExternalFailure =
        packageGateExternal.disabledRouteObservation.error ??
        'A3/A5 disabled-route suppression was not externally visible over CDP'
    }
    if (packageGateExternalFailure === undefined) {
      writeFileSync(packageInstallGateContinuePath, `${new Date().toISOString()}\n`)
      packageGateExternal.continuationWritten = true
    }
  }
  if (generation === 3) {
    const progress = await waitForPackageInstallGatePhase(generation, [
      'awaiting-format-smoke-start',
      'complete',
    ])
    if (progress?.state !== 'awaiting-format-smoke-start') {
      throw new Error(
        `A8 format smoke did not reach its start barrier: ${packageGatePhaseFailures(progress)}`,
      )
    }
    if (progress.formatSmoke?.authoritySha256 !== formatSmokeAuthoritySha256) {
      throw new Error('A8 installed authority SHA-256 differs from the harness authority')
    }
    writeFileSync(formatSmokeStartPath, `${new Date().toISOString()}\n`)
    const openCases = formatSmokeCases.filter(testCase => testCase.kind === 'open')
    for (let index = 0; index < openCases.length; index += 1) {
      const testCase = openCases[index]
      const operationRevision = index + 1
      const current = await waitForFormatSmokeCurrent(operationRevision)
      if (current === undefined || current.caseId !== testCase.id) {
        throw new Error(
          `A8 operation ${operationRevision} expected ${testCase.id}, got ${String(current?.caseId)}`,
        )
      }
      const observation = await observeFormatSmokeCase(port, testCase, current)
      writeFormatSmokeAck(current, observation)
      receipt.formatSmoke.cases.push(portableFormatSmokeCase(testCase, current, observation))
      receipt.formatSmoke.openedCases = receipt.formatSmoke.cases.length
    }
    const archiveStart = await waitForArchiveAcceptanceStage('awaiting-archive-acceptance-start')
    if (archiveStart?.archiveAcceptance?.artifactSha256 !== receipt.artifact.sha256) {
      throw new Error('Wave 2A archive acceptance artifact SHA-256 differs from the installed VSIX')
    }
    writeFileSync(archiveAcceptanceStartPath, `${new Date().toISOString()}\n`)
    for (const expectedCaseId of [
      'mpq-tree-search-lazy',
      'casc-tree-search-lazy',
      'wz-tree-search-lazy',
    ]) {
      const searchPhase = await waitForArchiveAcceptanceStage('awaiting-archive-search-picker', {
        caseId: expectedCaseId,
        stage: 'search-picker',
      })
      const search = searchPhase?.archiveAcceptance
      if (
        search?.caseId !== expectedCaseId ||
        search?.stage !== 'search-picker' ||
        typeof search?.container !== 'string' ||
        typeof search?.query !== 'string' ||
        typeof search?.requiredEntry !== 'string' ||
        typeof search?.selectedUri !== 'string' ||
        !search.selectedUri.startsWith('modkit-container:')
      ) {
        throw new Error(`Wave 2A ${expectedCaseId} did not publish a complete visible-search phase`)
      }
      const observation = await observeAndSelectArchiveSearch(page, search)
      writeArchiveSearchAck({ ...search, ...observation })
      receipt.archiveAcceptance.searches ??= []
      receipt.archiveAcceptance.searches.push({
        caseId: expectedCaseId,
        ...portableReceiptValue({ ...search, ...observation }),
      })
    }
    const sourcePhase = await waitForArchiveAcceptanceStage('awaiting-wte70-source-observation')
    const source = sourcePhase?.archiveAcceptance?.source
    const target = sourcePhase?.archiveAcceptance?.target
    if (typeof source !== 'string' || typeof target !== 'string') {
      throw new Error('Wave 2A source Save As barrier has no portable source/target names')
    }
    const sourceObservation = await observeArchiveAcceptanceEditor(port, {
      stage: 'source-open',
      source,
      target,
    })
    const nativeUserCommand = await attemptNativeSaveAs(page)
    writeArchiveAcceptanceAck('source-observed', source, target, nativeUserCommand)
    const targetPhase = await waitForArchiveAcceptanceStage('awaiting-wte70-target-observation')
    if (
      targetPhase?.archiveAcceptance?.source !== source ||
      targetPhase?.archiveAcceptance?.target !== target
    ) {
      throw new Error('Wave 2A target Save As barrier changed its source/target identity')
    }
    const targetObservation = await observeArchiveAcceptanceEditor(port, {
      stage: 'target-reopen',
      source,
      target,
    })
    writeArchiveAcceptanceAck('target-observed', source, target)
    receipt.archiveAcceptance.externalSaveAs = {
      bridge: 'live-custom-document-save-as',
      nativeUserCommand,
      sourceObservation,
      targetObservation,
    }
    const armodMemoryStart = await waitForArchiveAcceptanceStage(
      'awaiting-armod-external-memory-start',
    )
    const armodStartBoundary = armodMemoryStart?.archiveAcceptance
    if (
      armodStartBoundary?.caseId !== 'armod-open' ||
      armodStartBoundary?.stage !== 'armod-memory-sampling-start' ||
      armodStartBoundary?.artifactSha256 !== receipt.artifact.sha256 ||
      armodStartBoundary?.collector !== 'Win32_Process' ||
      armodStartBoundary?.requestedSampleIntervalMs !== armodProcessTreeRequestedSampleIntervalMs
    ) {
      throw new Error('Wave 2A ARmod external-memory start barrier is not artifact-bound')
    }
    const armodMemorySampler = startArmodProcessTreeMemorySampler(port)
    const armodStartAcknowledgement = armodMemorySampler.startAcknowledgement()
    writeArmodProcessTreeMemoryAck('armod-memory-sampling-start', armodStartAcknowledgement)
    if (armodStartAcknowledgement.verdict !== 'pass') {
      throw new Error(
        `Wave 2A ARmod external process-tree memory sampling is unavailable: ${armodStartAcknowledgement.errors.join('; ')}`,
      )
    }
    try {
      const armodMemoryStop = await waitForArchiveAcceptanceStage(
        'awaiting-armod-external-memory-stop',
      )
      const armodStopBoundary = armodMemoryStop?.archiveAcceptance
      if (
        armodStopBoundary?.caseId !== 'armod-open' ||
        armodStopBoundary?.stage !== 'armod-memory-sampling-stop' ||
        armodStopBoundary?.artifactSha256 !== receipt.artifact.sha256 ||
        armodStopBoundary?.collector !== 'Win32_Process' ||
        armodStopBoundary?.requestedSampleIntervalMs !== armodProcessTreeRequestedSampleIntervalMs
      ) {
        throw new Error('Wave 2A ARmod external-memory stop barrier is not artifact-bound')
      }
      const armodStopAcknowledgement = armodMemorySampler.stop()
      writeArmodProcessTreeMemoryAck('armod-memory-sampling-stop', armodStopAcknowledgement)
      if (armodStopAcknowledgement.verdict !== 'pass') {
        throw new Error(
          `Wave 2A ARmod external process-tree memory exceeded its ${armodProcessTreeMemoryDeltaCeilingBytes}-byte ceiling or sampling failed: ${armodStopAcknowledgement.errors.join('; ')}`,
        )
      }
      receipt.archiveAcceptance.externalArmodMemory = portableReceiptValue({
        startAcknowledgement: armodStartAcknowledgement,
        stopAcknowledgement: armodStopAcknowledgement,
      })
    } catch (error) {
      armodMemorySampler.stop()
      throw error
    }
  }
  packageGatePhase = await waitForPackageInstallGatePhase(generation, 'complete')

  if (generation === 3 && packageGatePhase?.verdict === 'pass') {
    const productSmoke = packageGatePhase.formatSmoke
    if (
      productSmoke?.verdict !== 'pass' ||
      productSmoke?.authoritySha256 !== formatSmokeAuthoritySha256 ||
      productSmoke?.artifactSha256 !== receipt.artifact.sha256 ||
      productSmoke?.expectedCases !== 14 ||
      productSmoke?.openedCases !== 14 ||
      !Array.isArray(productSmoke?.cases) ||
      productSmoke.cases.length !== 14 ||
      !Array.isArray(productSmoke?.failures) ||
      productSmoke.failures.length !== 0
    ) {
      throw new Error('A8 product-side final receipt is incomplete or mismatched')
    }
    for (const recorded of receipt.formatSmoke.cases) {
      const productCase = productSmoke.cases.find(item => item?.caseId === recorded.caseId)
      if (productCase === undefined) {
        throw new Error(`A8 product receipt omitted ${recorded.caseId}`)
      }
      if (productCase.corpus?.unchangedAfterClose === true) {
        recorded.corpus.unchangedAfterClose = true
      }
    }
    const mpq = receipt.formatSmoke.cases.find(item => item.caseId === 'archive-mpq')
    if (mpq?.corpus?.unchangedAfterClose !== true) {
      throw new Error('A8 archive-mpq did not prove unchanged bytes after read-only close')
    }
    receipt.formatSmoke.verdict = 'pass'
    const archive = packageGatePhase.archiveAcceptance
    const archiveCases = Array.isArray(archive?.cases) ? archive.cases : []
    if (
      archive?.kind !== 'x3.vscode-installed-archive-acceptance' ||
      archive?.schemaVersion !== 1 ||
      archive?.artifactSha256 !== receipt.artifact.sha256 ||
      archive?.verdict !== 'pass' ||
      JSON.stringify(archive?.expectedCases) !== JSON.stringify(archiveAcceptanceCaseIds) ||
      !Array.isArray(archive?.failures) ||
      archive.failures.length !== 0 ||
      JSON.stringify(archiveCases.map(item => item?.caseId)) !==
        JSON.stringify(archiveAcceptanceCaseIds)
    ) {
      throw new Error('Wave 2A product-side final receipt is incomplete or mismatched')
    }
    assertExactArchiveEvidence(archiveCases)
    const saveAs = archiveCases.find(item => item?.caseId === 'wte70-save-as-reopen')
    const searches = archiveCases.filter(item =>
      ['mpq-tree-search-lazy', 'casc-tree-search-lazy', 'wz-tree-search-lazy'].includes(
        item?.caseId,
      ),
    )
    if (
      searches.length !== 3 ||
      searches.some(
        item =>
          item?.evidence?.searchCommand !== 'modkit.searchContainer' ||
          item?.evidence?.uiPickerObserved !== true ||
          item?.evidence?.inputBoxObserved !== true ||
          item?.evidence?.quickPickObserved !== true ||
          item?.evidence?.pickedLabel !== item?.evidence?.requiredEntry ||
          typeof item?.evidence?.selectedUri !== 'string' ||
          item?.evidence?.selectedRoute !== 'modkit-container' ||
          item?.evidence?.resultOnly !== false,
      )
    ) {
      throw new Error('Wave 2A registered search UI/QuickPick journey is not externally proven')
    }
    if (
      saveAs?.verdict !== 'pass' ||
      saveAs?.evidence?.bridge !== 'live-custom-document-save-as' ||
      saveAs?.evidence?.providerMethod !== 'CustomEditorProvider.saveCustomDocumentAs' ||
      saveAs?.evidence?.acceptanceGated !== true ||
      saveAs?.evidence?.cleanCopy !== false ||
      saveAs?.evidence?.nativeWriterProof !== true ||
      saveAs?.evidence?.nativeUserCommandProof !== false ||
      saveAs?.evidence?.classification !== 'installed-acceptance-native-writer-save-as' ||
      saveAs?.evidence?.elapsedScope !== 'save-as-through-cdp-reopen' ||
      saveAs?.evidence?.sourceObservedByCdp !== true ||
      saveAs?.evidence?.targetObservedByCdp !== true ||
      saveAs?.evidence?.sourceUnchanged !== true ||
      saveAs?.evidence?.saved?.sha256 === saveAs?.evidence?.source?.sha256 ||
      saveAs?.evidence?.nativeWriterReceipt?.kind !== 'mpq-native-export-receipt-v1' ||
      saveAs?.evidence?.nativeWriterReceipt?.strategy !== 'whole-archive-save-as-fixed-slots' ||
      saveAs?.evidence?.nativeWriterReceipt?.archiveByteIdentity !== 'changed' ||
      !Array.isArray(saveAs?.evidence?.nativeWriterReceipt?.changed) ||
      saveAs.evidence.nativeWriterReceipt.changed.some(
        item => item?.path === 'MapScript.galaxy',
      ) !== true ||
      typeof saveAs?.evidence?.elapsedMs !== 'number' ||
      saveAs.evidence.elapsedMs >= 60_000 ||
      typeof saveAs?.evidence?.saveOperationElapsedMs !== 'number' ||
      saveAs.evidence.saveOperationElapsedMs < 0 ||
      saveAs.evidence.saveOperationElapsedMs > saveAs.evidence.elapsedMs
    ) {
      throw new Error('Wave 2A WTE70 live Save As/reopen evidence is incomplete')
    }
    receipt.archiveAcceptance.artifactSha256 = archive.artifactSha256
    receipt.archiveAcceptance.cases = portableReceiptValue(archiveCases)
    receipt.archiveAcceptance.failures = portableReceiptValue(archive.failures)
    receipt.archiveAcceptance.verdict = 'pass'
  }

  const runReceipt = {
    generation,
    artifactSha256: receipt.artifact.sha256,
    vscode: receipt.environment.vscode,
    os: receipt.environment.os,
    profileMode: receipt.profile.mode,
    installedCommands,
    route,
    a7: acceptance.a7,
    dds: {
      selected: probe.acceptance.subject.selected,
      identity: probe.acceptance.subject.descriptor.identity,
      stages: probe.stages,
      raster: probe.raster,
      metadataExcerpt: compact(metadata, 1_200),
    },
    screenshot: generation === 1 ? portablePath(screenshotPath) : null,
    packageInstallGate: {
      phase: packageGatePhaseSummary(packageGatePhase, generation),
      external: packageGateExternal,
    },
    formatSmoke: generation === 3 ? receipt.formatSmoke : null,
    archiveAcceptance: generation === 3 ? receipt.archiveAcceptance : null,
    corruptInput,
  }
  receipt.runs.push(runReceipt)

  if (packageGatePhase?.verdict !== 'pass') {
    throw new Error(
      `A3/A5 package gate generation ${generation} failed: ${packageGatePhaseFailures(packageGatePhase)}`,
    )
  }
  if (packageGateExternalFailure !== undefined) {
    throw new Error(packageGateExternalFailure)
  }

  // Stop the installed workbench deterministically through CDP, then prove the endpoint is gone
  // before the next generation starts. If CDP close wedges, the fallback only targets processes
  // whose command lines prove they belong to this isolated profile or exact debug port.
  const teardown = await closeApplication(port, generation)
  runReceipt.teardown = teardown
  await browser.close().catch(() => undefined)
  if (teardown.verdict !== 'pass') {
    throw new Error(`VS Code generation ${generation} did not fully exit`)
  }
  activeApplications.delete(port)
}

let failure
try {
  packageVsix()
  identifyArtifact()
  installVsix()
  await launchGeneration(1)
  receipt.restart.attempted = true
  await launchGeneration(2)
  await launchGeneration(3)
  receipt.restart.passed = true
  if (receipt.runs.some(runReceipt => runReceipt.artifactSha256 !== receipt.artifact.sha256)) {
    throw new Error('run receipts do not name the one accepted VSIX SHA-256')
  }
  assertPackageInstallGate()
  receipt.verdict = 'pass'
} catch (error) {
  failure = error
  receipt.error = error instanceof Error ? error.message : String(error)
  capturePackageInstallGateRuntime()
} finally {
  for (const [port, application] of activeApplications) {
    const teardown = await closeApplication(port, application.generation ?? null)
    receipt.cleanup.applicationCloseAttempts.push(teardown)
    if (teardown.verdict !== 'pass') {
      receipt.cleanup.applicationCloseErrors.push(`CDP endpoint ${port} did not stop`)
    }
  }
  activeApplications.clear()
  if (!keepProfile) {
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
      receipt.cleanup.profileRemoved = !existsSync(scratch)
    } catch (error) {
      receipt.cleanup.profileRemoved = false
      receipt.cleanup.error = error instanceof Error ? error.message : String(error)
    }
  }
  receipt.finishedAt = new Date().toISOString()
  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
}

if (failure !== undefined) {
  console.error(`installed acceptance: FAIL - ${receipt.error}`)
  console.error(`receipt: ${receiptPath}`)
  process.exitCode = 1
} else {
  console.log(
    `installed acceptance: PASS - ${receipt.runs.length}/${receipt.runs.length} generations`,
  )
  console.log(`artifact: ${receipt.artifact.sha256} ${artifactPath}`)
  console.log(`receipt: ${receiptPath}`)
  console.log(`screenshot: ${screenshotPath}`)
}
