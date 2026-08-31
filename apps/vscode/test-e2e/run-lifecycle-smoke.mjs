/**
 * Block-14 VS Code lifecycle smoke.
 *
 * The ordinary smoke proves the workbench and its format paths. This smaller run asks the one
 * lifecycle question that a fresh build cannot answer: can a running Extension Development Host
 * consume a changed deterministic shell, reload after a bad update, and recover by loading the
 * exact shell built from the current checkout?
 *
 * No VSIX claim is made here. Block 14D's package topology is owner-owned; this uses the supported
 * development-extension folder that the existing smoke already launches. The staged folder lives
 * beside the real app so its repository-relative catalog lookup is identical, while isolated
 * user-data and extensions directories keep the user's VS Code profile untouched.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir, platform, release, arch } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron'

const here = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(here, '..')
const repoRoot = resolve(extensionRoot, '..', '..')
const reportPath = join(repoRoot, 'reports', 'vscode-smoke', 'lifecycle-receipt.json')
const publication = JSON.parse(
  readFileSync(join(extensionRoot, 'publication-artifact.v1.json'), 'utf8'),
)

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

const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

const shellDigests = root =>
  Object.fromEntries(
    publication.shellEntries.map(name => [
      name,
      digest(readFileSync(join(root, 'dist-app', name))),
    ]),
  )

function copyCurrentExtension(destination) {
  mkdirSync(destination, { recursive: true })
  for (const name of [
    'app.css',
    'bundled-contributes.v1.json',
    'contributes.generated.json',
    'package.json',
    'publication-artifact.v1.json',
  ]) {
    cpSync(join(extensionRoot, name), join(destination, name))
  }
  for (const name of ['dist-app', 'generated', 'media']) {
    cpSync(join(extensionRoot, name), join(destination, name), { recursive: true })
  }
}

function stagePredecessor(destination) {
  copyCurrentExtension(destination)
  const manifestPath = join(destination, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.version = '0.0.0'
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const entryPath = join(destination, 'dist-app', 'extension.cjs')
  writeFileSync(
    entryPath,
    Buffer.concat([
      readFileSync(entryPath),
      Buffer.from('\n/* x3 block-14 lifecycle predecessor shell */\n'),
    ]),
  )
}

function describeEditor(executable) {
  const executableRoot = dirname(executable)
  const candidates = [
    executableRoot,
    ...readdirSync(executableRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(executableRoot, entry.name)),
  ]
  for (const directory of candidates) {
    const app = join(directory, 'resources', 'app')
    if (existsSync(join(app, 'package.json'))) {
      const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
      let commit = null
      try {
        commit = JSON.parse(readFileSync(join(app, 'product.json'), 'utf8')).commit ?? null
      } catch {
        // A version still identifies the runtime when an unpacked editor has no product metadata.
      }
      return { version: manifest.version, commit }
    }
  }
  return { version: 'unknown', commit: null }
}

async function main() {
  if (
    publication.schemaVersion !== 1 ||
    publication.artifactKind !== 'deterministic-shell' ||
    publication.shellEntries.length === 0
  ) {
    throw new TypeError('lifecycle smoke requires the deterministic-shell v1 publication inventory')
  }

  console.log('lifecycle smoke: building the current deterministic shell...')
  const build = await run('pnpm', ['--filter', '@modkit/modkit-vscode', 'ext:build'])
  if (build.code !== 0) throw new Error(`ext:build failed (${build.code})\n${build.output}`)
  const deterministic = await run('pnpm', ['--filter', '@modkit/modkit-vscode', 'dist-app:check'])
  if (deterministic.code !== 0) {
    throw new Error(`dist-app:check failed (${deterministic.code})\n${deterministic.output}`)
  }

  const scratch = mkdtempSync(join(tmpdir(), 'x3-vscode-lifecycle-'))
  const stagedExtension = mkdtempSync(join(repoRoot, 'apps', '.vscode-lifecycle-'))
  const statePath = join(scratch, 'state.json')
  const resultsPath = join(scratch, 'results.json')
  const userData = join(scratch, 'user-data')
  const extensionsDir = join(scratch, 'extensions')
  const workspace = join(scratch, 'workspace')
  for (const directory of [userData, extensionsDir, workspace]) {
    mkdirSync(directory, { recursive: true })
  }

  try {
    stagePredecessor(stagedExtension)
    const currentManifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'))
    const expectedDigests = shellDigests(extensionRoot)
    const predecessorDigests = shellDigests(stagedExtension)
    if (predecessorDigests['extension.cjs'] === expectedDigests['extension.cjs']) {
      throw new Error('the staged predecessor unexpectedly equals the current extension entry')
    }

    const cachePath =
      process.env.MODKIT_VSCODE_TEST_CACHE ??
      // Deprecated compatibility alias for existing local CI configuration.
      process.env.MODKITX_VSCODE_TEST_CACHE ??
      join(tmpdir(), 'modkit-vscode-test')
    console.log('lifecycle smoke: resolving VS Code...')
    const executable = await downloadAndUnzipVSCode({ version: 'stable', cachePath })
    const editor = describeEditor(executable)
    const commit = (await run('git', ['rev-parse', 'HEAD'])).output.trim()

    console.log('lifecycle smoke: predecessor -> failed update -> current HEAD recovery...')
    const attempts = []
    for (let attempt = 1; attempt <= 3 && !existsSync(resultsPath); attempt += 1) {
      let exitCode = 0
      let error
      try {
        exitCode = await runTests({
          vscodeExecutablePath: executable,
          extensionDevelopmentPath: stagedExtension,
          extensionTestsPath: join(here, 'suite', 'lifecycle.cjs'),
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
          ],
          extensionTestsEnv: {
            MODKIT_LIFECYCLE_CURRENT_EXTENSION: extensionRoot,
            MODKIT_LIFECYCLE_EXPECTED_DIGESTS: JSON.stringify(expectedDigests),
            MODKIT_LIFECYCLE_EXPECTED_HEAD: commit,
            MODKIT_LIFECYCLE_EXPECTED_VERSION: currentManifest.version,
            MODKIT_LIFECYCLE_RESULTS: resultsPath,
            MODKIT_LIFECYCLE_STAGE: stagedExtension,
            MODKIT_LIFECYCLE_STATE: statePath,
          },
        })
      } catch (failure) {
        exitCode = typeof failure?.code === 'number' ? failure.code : 1
        error = failure instanceof Error ? failure.message : String(failure)
      }
      const state = existsSync(statePath)
        ? JSON.parse(readFileSync(statePath, 'utf8'))
        : { phase: 'missing-state' }
      attempts.push({
        attempt,
        exitCode,
        phaseAfterExit: state.phase,
        ...(error === undefined ? {} : { error }),
      })
      /*
       * @vscode/test-electron owns the editor process. A native reload intentionally kills the
       * extension-test host, which the runner reports as exit 1 rather than reconnecting to the
       * new host. Re-launching with the same isolated profile is the supported way to attach the
       * next test phase; the state transition and fresh host together are the reload evidence.
       */
      const expectedBoundary =
        (attempt === 1 && state.phase === 'broken-update-installed') ||
        (attempt === 2 && state.phase === 'current-head-installed')
      if (!existsSync(resultsPath) && !expectedBoundary) break
    }

    const suite = existsSync(resultsPath)
      ? JSON.parse(readFileSync(resultsPath, 'utf8'))
      : {
          allPassed: false,
          failure: 'the lifecycle suite did not write a result',
        }
    const receipt = {
      kind: 'x3.vscode-extension-lifecycle-receipt',
      version: 1,
      block: 'block-14',
      subject: {
        x3Commit: commit,
        extensionVersion: currentManifest.version,
        publicationArtifact: 'deterministic-shell',
        shellEntries: publication.shellEntries,
        shellDigests: expectedDigests,
      },
      environment: {
        os: `${platform()} ${release()} ${arch()}`,
        node: process.versions.node,
        vscode: editor,
        hermetic: true,
      },
      build: {
        command: 'pnpm --filter @modkit/modkit-vscode ext:build',
        exitCode: build.code,
        deterministicCheck: 'pnpm --filter @modkit/modkit-vscode dist-app:check',
        deterministicExitCode: deterministic.code,
      },
      lifecycle: suite,
      runner: {
        attempts,
        finalExitCode: attempts.at(-1)?.exitCode ?? 1,
      },
      summary: {
        allPassed:
          attempts.length === 3 && attempts.at(-1)?.exitCode === 0 && suite.allPassed === true,
      },
    }
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`)
    console.log(
      `lifecycle smoke: ${receipt.summary.allPassed ? 'PASS' : 'FAIL'}; ` +
        'receipt written to reports/vscode-smoke/lifecycle-receipt.json',
    )
    if (!receipt.summary.allPassed) process.exitCode = 1
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(stagedExtension, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error('lifecycle smoke: harness failed', error)
  process.exit(2)
})
