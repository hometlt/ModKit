/**
 * Run the Core-only VS Code smoke in an isolated Extension Development Host.
 *
 * Publisher-specific acceptance belongs to the external extension repositories. This harness
 * proves that the Core extension activates and opens representative Common files through the real
 * VS Code custom-editor surface.
 */
import { createServer } from 'node:net'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron'

const here = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(here, '..')
const repoRoot = resolve(extensionRoot, '..', '..')

function run(command, args) {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: process.platform === 'win32',
      env: process.env,
    })
    let output = ''
    child.stdout?.on('data', chunk => (output += chunk))
    child.stderr?.on('data', chunk => (output += chunk))
    child.on('error', error => resolvePromise({ code: -1, output: String(error) }))
    child.on('close', code => resolvePromise({ code: code ?? -1, output }))
  })
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

async function main() {
  console.log('VS Code smoke: building the extension...')
  const build = await run('pnpm', ['--filter', '@modkitx-x3/modkit-vscode', 'ext:build'])
  if (build.code !== 0) throw new Error(`ext:build failed (${build.code})\n${build.output}`)

  const deterministic = await run('pnpm', [
    '--filter',
    '@modkitx-x3/modkit-vscode',
    'dist-app:check',
  ])
  if (deterministic.code !== 0) {
    throw new Error(`dist-app:check failed (${deterministic.code})\n${deterministic.output}`)
  }

  const scratch = mkdtempSync(join(tmpdir(), 'modkit-vscode-smoke-'))
  const workspace = join(scratch, 'workspace')
  const userData = join(scratch, 'user-data')
  const extensionsDir = join(scratch, 'extensions')
  const resultsPath = join(scratch, 'results.json')
  for (const directory of [workspace, userData, extensionsDir]) {
    mkdirSync(directory, { recursive: true })
  }

  try {
    const fixtures = join(repoRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic')
    for (const [source, target] of [
      ['minimal.odt', 'fixture.odt'],
      ['minimal.png', 'texture.png'],
      ['minimal.dds', 'texture.dds'],
    ]) {
      const sourcePath = join(fixtures, source)
      if (!existsSync(sourcePath)) throw new Error(`missing smoke fixture: ${sourcePath}`)
      copyFileSync(sourcePath, join(workspace, target))
    }

    const cachePath = process.env.MODKITX_VSCODE_TEST_CACHE ?? join(tmpdir(), 'modkitx-vscode-test')
    console.log('VS Code smoke: resolving the isolated VS Code runtime...')
    const executable = await downloadAndUnzipVSCode({ version: 'stable', cachePath })
    const port = await freePort()

    console.log('VS Code smoke: activating and opening ODT, PNG and DDS...')
    let runnerError
    try {
      await runTests({
        vscodeExecutablePath: executable,
        extensionDevelopmentPath: extensionRoot,
        extensionTestsPath: join(here, 'suite', 'index.cjs'),
        launchArgs: [
          workspace,
          '--user-data-dir',
          userData,
          '--extensions-dir',
          extensionsDir,
          '--disable-extensions',
          '--disable-gpu',
          '--disable-workspace-trust',
          '--skip-welcome',
          '--skip-release-notes',
          '--no-sandbox',
          `--remote-debugging-port=${port}`,
        ],
        extensionTestsEnv: {
          MODKITX_SMOKE_EXT_PATH: extensionRoot,
          MODKITX_SMOKE_RESULTS: resultsPath,
          MODKITX_SMOKE_CDP_PORT: String(port),
          MODKITX_SMOKE_FIXTURE_DIR: workspace,
          MODKITX_SMOKE_REPO_ROOT: repoRoot,
          MODKITX_SMOKE_PROFILE: 'focused-ga',
        },
      })
    } catch (error) {
      runnerError = error instanceof Error ? error.message : String(error)
    }

    if (!existsSync(resultsPath)) {
      throw new Error(`the Extension Host wrote no result${runnerError ? `: ${runnerError}` : ''}`)
    }
    const result = JSON.parse(readFileSync(resultsPath, 'utf8'))
    const failed = result.scenarios.filter(scenario => scenario.verdict !== 'pass')
    for (const scenario of result.scenarios) {
      console.log(`VS Code smoke: ${scenario.verdict.toUpperCase()} ${scenario.id}`)
    }
    if (failed.length > 0 || result.harnessError !== undefined || runnerError !== undefined) {
      const details = failed.map(item => `${item.id}: ${item.evidence}`).join('\n')
      throw new Error(
        [runnerError, result.harnessError, details].filter(Boolean).join('\n') ||
          'the VS Code smoke failed',
      )
    }
    console.log(`VS Code smoke: PASS (${result.scenarios.length}/${result.scenarios.length})`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error('VS Code smoke failed:', error)
  process.exit(1)
})
