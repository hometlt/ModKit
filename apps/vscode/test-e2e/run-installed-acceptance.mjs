/**
 * Installed-package acceptance for GA recovery Wave 1A.
 *
 * This is deliberately an external process test. It packages (or accepts) one VSIX, installs it
 * into isolated user/extension stores, drives the ordinary VS Code workbench through "Reopen
 * Editor With...", reads the rendered webview over CDP, quits the application, and repeats with the
 * same profile. There is no extensionDevelopmentPath and no Extension Development Host.
 *
 * Build one artifact and exercise it twice:
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
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { release as osRelease, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

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
const userData = join(scratch, 'user-data')
const extensionsDir = join(scratch, 'extensions')
const ddsPath = join(workspace, 'wave1a-minimal.dds')
const builtArtifact = resolve(artifactOut ?? join(scratch, 'artifact', 'modkit-vscode.vsix'))
const artifactPath = resolve(suppliedVsix ?? builtArtifact)
const portablePath = (path, fallback = basename(path)) =>
  path.startsWith(scratch) ? path.replaceAll(scratch, '<isolated-profile>') : fallback
for (const directory of [workspace, userData, extensionsDir, dirname(artifactPath)]) {
  mkdirSync(directory, { recursive: true })
}
copyFileSync(
  join(repoRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic', 'minimal.dds'),
  ddsPath,
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
  install: { attempted: false, exitCode: null, extension: null, output: '' },
  runs: [],
  restart: { attempted: false, sameProfile: true, passed: false },
  verdict: 'fail',
}

const compact = (value, limit = 2_000) => {
  const text = String(value ?? '').replaceAll(scratch, '<isolated-profile>')
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function run(command, commandArguments, options = {}) {
  const result = spawnSync(command, commandArguments, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    env: process.env,
  })
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`,
  }
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

function installVsix() {
  const version = run(codeCommand, ['--version'])
  if (version.code !== 0) throw new Error(`installed VS Code CLI is unavailable: ${version.output}`)
  receipt.environment.vscode = version.output.split(/\r?\n/u)[0]?.trim() ?? null
  receipt.install.attempted = true
  const result = run(codeCommand, [
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
    manifest: installed.path.replaceAll(scratch, '<isolated-profile>'),
  }
}

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

async function chooseQuickInput(page, query, expectedText) {
  await page.keyboard.press('F1')
  const input = page.locator('.quick-input-widget input').first()
  await input.waitFor({ state: 'visible', timeout: 20_000 })
  await input.fill(query)
  const row = page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: expectedText })
    .first()
  await row.waitFor({ state: 'visible', timeout: 20_000 })
  await row.click()
}

async function exitApplication(page) {
  await page.keyboard.press('F1')
  const input = page.locator('.quick-input-widget input').first()
  await input.waitFor({ state: 'visible', timeout: 20_000 })
  await input.fill('file exit')
  const row = page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'File: Exit' })
    .first()
  await row.waitFor({ state: 'visible', timeout: 20_000 })
  // The workbench is expected to disappear while the click is in flight.
  await row.click({ noWaitAfter: true }).catch(() => undefined)
}

async function reopenWithModkit(page) {
  await chooseQuickInput(page, 'reopen editor with', 'Reopen Editor With')
  const option = page
    .locator('.quick-input-list .monaco-list-row')
    .filter({ hasText: 'Modkit Asset Preview' })
    .first()
  await option.waitFor({ state: 'visible', timeout: 20_000 })
  await option.click()
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
    `--remote-debugging-port=${port}`,
    workspace,
    ddsPath,
  ]
  // Intentionally no --extensionDevelopmentPath and no --disable-extensions.
  const launcher = spawn(codeCommand, launchArguments, {
    cwd: workspace,
    detached: false,
    shell: process.platform === 'win32',
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  })
  launcher.unref()
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
  await reopenWithModkit(page)

  const acceptance = await waitFor(
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
  if (acceptance === undefined)
    throw new Error('installed DDS webview published no machine-readable subject receipt')
  assertA7(acceptance.a7)

  await waitFor(
    async () => {
      const values = await webviewValues(
        port,
        webviewDocumentExpression(
          `doc => {
            for (const select of doc.querySelectorAll('select')) {
              const option = Array.from(select.options).find(item => (item.textContent || '').trim() === 'Image');
              if (!option) continue;
              select.value = option.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
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
            if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) return undefined;
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
      return values.find(value => value?.raster?.pixelBytes > 0)
    },
    { timeoutMs: 60_000, stepMs: 500 },
  )
  if (probe === undefined)
    throw new Error('installed DDS Image stage rendered no readable raster canvas')
  assertDds(probe)

  const metadataSelected = await waitFor(
    async () => {
      const values = await webviewValues(
        port,
        webviewDocumentExpression(
          `doc => {
            for (const select of doc.querySelectorAll('select')) {
              const option = Array.from(select.options).find(item => (item.textContent || '').trim() === 'Metadata');
              if (!option) continue;
              select.value = option.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
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

  if (generation === 1) await page.screenshot({ path: screenshotPath, fullPage: false })
  const runReceipt = {
    generation,
    artifactSha256: receipt.artifact.sha256,
    vscode: receipt.environment.vscode,
    os: receipt.environment.os,
    profileMode: receipt.profile.mode,
    route: 'Reopen Editor With -> Modkit Asset Preview',
    a7: acceptance.a7,
    dds: {
      selected: probe.acceptance.subject.selected,
      identity: probe.acceptance.subject.descriptor.identity,
      stages: probe.stages,
      raster: probe.raster,
      metadataExcerpt: compact(metadata, 1_200),
    },
    screenshot: generation === 1 ? portablePath(screenshotPath) : null,
  }
  receipt.runs.push(runReceipt)

  // A palette-level File: Exit is a full application stop, not a webview reload or an Extension
  // Host restart. The second generation cannot start until the CDP endpoint is gone.
  await exitApplication(page)
  const stopped = await waitFor(
    async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/json/version`)
        return undefined
      } catch {
        return true
      }
    },
    { timeoutMs: 30_000, stepMs: 500 },
  )
  if (stopped !== true) throw new Error(`VS Code generation ${generation} did not fully exit`)
  await browser.close().catch(() => undefined)
}

let failure
try {
  packageVsix()
  identifyArtifact()
  installVsix()
  await launchGeneration(1)
  receipt.restart.attempted = true
  await launchGeneration(2)
  receipt.restart.passed = true
  if (receipt.runs.some(runReceipt => runReceipt.artifactSha256 !== receipt.artifact.sha256)) {
    throw new Error('run receipts do not name the one accepted VSIX SHA-256')
  }
  receipt.verdict = 'pass'
} catch (error) {
  failure = error
  receipt.error = error instanceof Error ? error.message : String(error)
} finally {
  receipt.finishedAt = new Date().toISOString()
  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  if (!keepProfile) rmSync(scratch, { recursive: true, force: true })
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
