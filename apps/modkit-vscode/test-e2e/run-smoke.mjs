/**
 * Run the block-9 smoke against a real VS Code, and write the receipt.
 *
 *   pnpm --filter @modkitx-x3/modkit-vscode smoke:vscode
 *
 * This is the outside half: it builds the extension the same way a release does, downloads a real
 * editor, stages the fixtures the scenarios need, launches the editor with the suite attached, and
 * turns what comes back into `reports/vscode-smoke/receipt.json`.
 *
 * Two properties are load-bearing.
 *
 *  - **Hermetic.** The editor runs against a throwaway user-data and extensions directory, so the
 *    smoke can never read or write the settings of the VS Code a person uses on this machine.
 *  - **No absolute path reaches a tracked file.** The receipt and the logs are committed, and this
 *    machine's directory layout is not something a repository should carry. Everything written out
 *    goes through `redact`, which puts the environment variable's *name* where its value stood.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir, platform, release, arch } from 'node:os'
import { dirname, join, resolve, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron'

const here = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(here, '..')
const repoRoot = resolve(extensionRoot, '..', '..')
const reportDir = join(repoRoot, 'reports', 'vscode-smoke')
const logDir = join(reportDir, 'logs')

/*
 * The Kane's Wrath install, under either name.
 *
 * The owner's 2026-08-25 decision split the C&C roots per game — `MODKITX_CNC3_TW_ROOT`,
 * `MODKITX_CNC3_KW_ROOT`, `MODKITX_RA3_ROOT` — and left `MODKITX_CNC3_ROOT` as a deprecated alias
 * for Kane's Wrath. The suite reads one name; resolving both here means a correctly-configured
 * environment is not reported as a missing fixture, and the deprecated spelling does not quietly
 * become the only one that works.
 */
const kingsWrathRoot = process.env.MODKITX_CNC3_KW_ROOT ?? process.env.MODKITX_CNC3_ROOT

/** Fixtures the scenarios need, by the variable that names them and the value that resolved. */
const FIXTURES = {
  MODKITX_W3D_PATH: process.env.MODKITX_W3D_PATH,
  MODKITX_VXL_PATH: process.env.MODKITX_VXL_PATH,
  MODKITX_CNC3_KW_ROOT: kingsWrathRoot,
}

/**
 * Extension roots the smoke asks the editor to load, by the product's own `modkit.extensions`.
 *
 * The build bundles one catalog — `extensions/common` — and none of the three formats this smoke
 * opens is in it: W3D lives in `ea/models`, VXL in `ea/tiberian-sun`, BIG in `ea/big`. Without
 * these the editor is not broken, it is simply an editor that cannot read Westwood assets, and
 * every scenario below would fail on a file that opens as hex.
 *
 * Naming them in a workspace `.vscode/settings.json` is the supported way to add a root — the same
 * setting `modkit.addExtensionFolder` appends to — so this is the product's own mechanism, not a
 * back door around it.
 */
const EA_ROOTS = ['models', 'tiberian-sun', 'big'].map(name =>
  join(repoRoot, 'extensions', 'ea', name),
)

// ---------------------------------------------------------------------------------------------
// redaction

/**
 * Replace every absolute location this run touched with the name of the variable that held it.
 *
 * Built longest-first so a root never shadows a longer path inside it, and matched with either
 * separator and without case, because Windows hands the same directory back spelled several ways.
 */
function buildRedactor(map) {
  const entries = Object.entries(map)
    .filter(([, value]) => typeof value === 'string' && value.length > 2)
    .sort((left, right) => right[1].length - left[1].length)
  const rules = entries.map(([token, value]) => {
    const pattern = value
      .replace(/[.*+?^${}()|[\]\\/]/g, match => (/[\\/]/.test(match) ? '[\\\\/]' : `\\${match}`))
      .replace(/\[\\\\\/\](\[\\\\\/\])+/g, '[\\\\/]')
    return { token: `\${${token}}`, regex: new RegExp(pattern, 'gi') }
  })
  return function redact(input) {
    if (typeof input !== 'string') return input
    let out = input
    for (const rule of rules) out = out.replace(rule.regex, rule.token)
    // Anything still carrying a machine location is blanked rather than shipped.
    out = out.replace(/\\\\[^\s\\"']+\\[^\s"']*/g, '${UNC}')
    out = out.replace(/\b[A-Za-z]:[\\/][^\s"'<>|]*/g, '${ABS}')
    out = out.replace(/\bfile:\/\/\/?[^\s"'<>|]*/gi, '${FILE_URL}')
    return out
  }
}

/** Walk a JSON-ish value, redacting every string in it (keys included). */
function redactDeep(value, redact) {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(item => redactDeep(item, redact))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redact(key), redactDeep(item, redact)]),
    )
  }
  return value
}

// ---------------------------------------------------------------------------------------------
// small helpers

function run(command, args, options = {}) {
  return new Promise(resolvePromise => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      shell: process.platform === 'win32',
      env: { ...process.env, ...(options.env ?? {}) },
    })
    let out = ''
    child.stdout?.on('data', chunk => (out += chunk))
    child.stderr?.on('data', chunk => (out += chunk))
    child.on('error', error => resolvePromise({ code: -1, output: String(error) }))
    child.on('close', code => resolvePromise({ code: code ?? -1, output: out }))
  })
}

const freePort = () =>
  new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })

const tail = (text, lines = 12) => text.trim().split(/\r?\n/).slice(-lines).join('\n')

// ---------------------------------------------------------------------------------------------
// main

async function main() {
  mkdirSync(logDir, { recursive: true })
  const startedAt = new Date().toISOString()

  const missing = Object.entries(FIXTURES)
    .filter(([, value]) => (value ?? '') === '')
    .map(([name]) => name)
  if (missing.length > 0) {
    console.error(`smoke: these variables are not set: ${missing.join(', ')}`)
    process.exit(2)
  }

  // ------------------------------------------------------------------ 1. build the product
  console.log('smoke: building the extension…')
  const build = await run('pnpm', ['--filter', '@modkitx-x3/modkit-vscode', 'ext:build'])
  console.log(`smoke: build exited ${build.code}`)

  /*
   * And then: is the generated bundle fresh and deterministic?
   *
   * The smoke runs against `extensionDevelopmentPath`, which loads generated `dist-app/`. The
   * check compares it with two independent clean builds, proving freshness and deterministic
   * release output without relying on a committed bundle. It stays outside general `pnpm check`
   * because bundling the extension is slow and belongs to the receipt that claims to test it.
   */
  const distCheck = await run('pnpm', ['--filter', '@modkitx-x3/modkit-vscode', 'dist-app:check'])
  console.log(`smoke: dist-app:check exited ${distCheck.code}`)

  // ------------------------------------------------------------------ 2. stage the fixtures
  const scratch = mkdtempSync(join(tmpdir(), 'x3-vscode-smoke-'))
  const workspace = join(scratch, 'workspace')
  const userData = join(scratch, 'user-data')
  const extensionsDir = join(scratch, 'extensions')
  for (const dir of [workspace, userData, extensionsDir]) mkdirSync(dir, { recursive: true })

  /*
   * Scenario 5 needs the same model without its sidecar. Copying only the `.vxl` into a directory
   * that holds nothing else is the whole fixture: the companion is absent because it was never
   * brought along, not because anything was deleted.
   */
  const vxl = process.env.MODKITX_VXL_PATH
  const lonelyVxl = join(workspace, basename(vxl))
  copyFileSync(vxl, lonelyVxl)
  if (existsSync(join(workspace, `${basename(vxl, extname(vxl))}.hva`))) {
    throw new Error('the staged copy unexpectedly has a companion beside it')
  }

  // The EA catalog, added the way the product documents: a workspace setting the host reads once
  // at activation. Missing roots are reported rather than silently narrowing what the smoke proves.
  const presentRoots = EA_ROOTS.filter(root => existsSync(root))
  mkdirSync(join(workspace, '.vscode'), { recursive: true })
  writeFileSync(
    join(workspace, '.vscode', 'settings.json'),
    `${JSON.stringify({ 'modkit.extensions': presentRoots }, null, 2)}\n`,
  )

  // ------------------------------------------------------------------ 3. get a real editor
  const cachePath = process.env.MODKITX_VSCODE_TEST_CACHE ?? join(tmpdir(), 'modkitx-vscode-test')
  console.log('smoke: resolving VS Code (this downloads ~150 MB on a cold cache)…')
  const executable = await downloadAndUnzipVSCode({ version: 'stable', cachePath })
  const editor = describeEditor(executable)
  console.log(`smoke: VS Code ${editor.version} (${editor.commit ?? 'unknown commit'})`)

  // ------------------------------------------------------------------ 4. run it
  const port = await freePort()
  const resultsPath = join(scratch, 'results.json')
  const launchArgs = [
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
  ]

  let runnerCode = 0
  let runnerError
  try {
    runnerCode = await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: extensionRoot,
      extensionTestsPath: join(here, 'suite', 'index.cjs'),
      launchArgs,
      extensionTestsEnv: {
        MODKITX_SMOKE_EXT_PATH: extensionRoot,
        MODKITX_SMOKE_RESULTS: resultsPath,
        MODKITX_SMOKE_CDP_PORT: String(port),
        MODKITX_SMOKE_LONELY_VXL: lonelyVxl,
        MODKITX_W3D_PATH: process.env.MODKITX_W3D_PATH,
        MODKITX_VXL_PATH: process.env.MODKITX_VXL_PATH,
        MODKITX_CNC3_ROOT: kingsWrathRoot,
      },
    })
  } catch (error) {
    runnerError = error instanceof Error ? error.message : String(error)
    runnerCode = typeof error?.code === 'number' ? error.code : 1
  }

  // ------------------------------------------------------------------ 5. collect
  let suite
  if (existsSync(resultsPath)) {
    suite = JSON.parse(readFileSync(resultsPath, 'utf8'))
  }

  const redact = buildRedactor({
    MODKITX_W3D_PATH: process.env.MODKITX_W3D_PATH,
    MODKITX_VXL_PATH: process.env.MODKITX_VXL_PATH,
    MODKITX_CNC3_ROOT: kingsWrathRoot,
    MODKITX_SC2_ROOT: process.env.MODKITX_SC2_ROOT,
    SMOKE_SCRATCH: scratch,
    VSCODE_CACHE: cachePath,
    X3_ROOT: repoRoot,
    TMPDIR: tmpdir(),
    HOME: homedir(),
  })

  const commit = (await run('git', ['rev-parse', 'HEAD'])).output.trim()
  const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'))

  const scenarios = suite?.scenarios ?? []
  const failed = scenarios.filter(entry => entry.verdict !== 'pass')
  const receipt = {
    kind: 'x3.vscode-smoke-receipt',
    version: 1,
    rung: 'E5',
    block: 'block-9',
    startedAt,
    finishedAt: new Date().toISOString(),
    subject: {
      x3Commit: commit,
      extension: { id: `${manifest.publisher}.${manifest.name}`, version: manifest.version },
    },
    environment: {
      os: `${platform()} ${release()} ${arch()}`,
      node: process.versions.node,
      vscode: {
        version: editor.version,
        commit: editor.commit,
        channel: 'stable',
        downloadedTo: '${VSCODE_CACHE}',
      },
      extensionHost: suite?.extensionHost ?? null,
      fixtures: Object.keys(FIXTURES).map(name => ({ variable: name, resolved: true })),
      /*
       * What the editor was told to load, and why it had to be told. The bundled catalog is
       * `extensions/common`; every format this smoke opens is contributed by an `ea` root outside
       * it, so the receipt records the configuration as part of the subject under test.
       */
      configuredExtensionRoots: {
        setting: 'modkit.extensions',
        scope: 'workspace .vscode/settings.json',
        bundledCatalog: 'extensions/common',
        roots: presentRoots.map(root => root.slice(repoRoot.length + 1).replace(/\\/g, '/')),
        missing: EA_ROOTS.filter(root => !existsSync(root)).map(root =>
          root.slice(repoRoot.length + 1).replace(/\\/g, '/'),
        ),
      },
      hermetic: {
        userDataDir: '${SMOKE_SCRATCH}/user-data',
        extensionsDir: '${SMOKE_SCRATCH}/extensions',
        note: 'the smoke never reads or writes the VS Code profile a person uses on this machine',
      },
    },
    build: {
      command: 'pnpm --filter @modkitx-x3/modkit-vscode ext:build',
      exitCode: build.code,
      output: redact(tail(build.output, 8)),
      distAppCheck: {
        command: 'pnpm --filter @modkitx-x3/modkit-vscode dist-app:check',
        exitCode: distCheck.code,
        matchesFreshDeterministicBuild: distCheck.code === 0,
        output: redact(tail(distCheck.output, 4)),
      },
    },
    webviewChannel: redactDeep(suite?.webviewChannel ?? null, redact),
    scenarios: redactDeep(scenarios, redact).map(entry => ({
      id: entry.id,
      title: entry.title,
      verdict: entry.verdict === 'pass' ? 'PASS' : 'FAIL',
      evidence: entry.evidence,
      durationMs: entry.durationMs,
      details: entry.details,
    })),
    diagnosticCodeUnderTest: 'x3.host/companion-unavailable',
    /*
     * Context for the nested-subject scenario, read from the sources rather than observed in the
     * running editor — and named as such, because it is the weaker kind of claim. The route exists
     * and one product uses it; this one does not.
     */
    /*
     * Why the diagnostics scenario can fail with the diagnostic itself working perfectly: source
     * inspection of where a subject diagnostic goes once the webview receives it.
     */
    diagnosticsChannel: (() => {
      let source = ''
      try {
        source = readFileSync(join(repoRoot, 'apps/modkit-vscode/src/webview.ts'), 'utf8')
      } catch {
        source = ''
      }
      const handler = /onDiagnostic:\s*diagnostic\s*=>\s*\{([^}]*)\}/.exec(source)?.[1] ?? ''
      return {
        claimKind: 'source inspection, not runtime observation',
        site: 'apps/modkit-vscode/src/webview.ts — connectSubjectRpc({ onDiagnostic })',
        emitsToExtensionHost: /bridge\.emit/.test(handler),
        writesVisibleStatusLine: /\bsay\(/.test(handler),
        note:
          'the handler calls bridge.emit only, so a subject diagnostic reaches the extension ' +
          'host’s output channel and is never drawn on the page’s status bar — invisible to the ' +
          'user, and unreadable to any observer, because an OutputChannel has no read API',
      }
    })(),
    nestedSubjectRoute: (() => {
      const read = file => {
        try {
          return readFileSync(join(repoRoot, file), 'utf8')
        } catch {
          return ''
        }
      }
      return {
        claimKind: 'source inspection, not runtime observation',
        exportedByHost: /openNestedSubject/.test(read('packages/host/src/index.ts')),
        usedByElectron: /openNestedSubject/.test(
          read('apps/electron/test/subject-open-smoke.test.ts'),
        ),
        usedByVsCodeArchiveStage: /openNestedSubject/.test(
          read('apps/modkit-vscode/src/archive-stage.ts'),
        ),
        note:
          'the VS Code archive stage reads an entry’s bytes into a hex pane; it never opens the ' +
          'entry as a subject, so no descriptor, no stages and no nested diagnostics exist for it',
      }
    })(),
    absolutePathCheck: (() => {
      const scenario = scenarios.find(entry => entry.id === 'diagnostics-no-companion')
      const leaks = scenario?.details?.absolutePathLeaks
      if (!Array.isArray(leaks)) {
        return {
          performed: false,
          clean: false,
          note: 'the diagnostics scenario never got far enough to check',
        }
      }
      return {
        performed: true,
        clean: leaks.length === 0,
        scope:
          'the diagnostic lines themselves, not the whole page — the breadcrumb legitimately ' +
          'shows the opened file’s location, while a diagnostic is what travels into logs',
        patterns: ['drive letter', 'UNC path', 'file:// URL', 'home directory'],
        linesChecked: redactDeep(
          scenarios.find(entry => entry.id === 'diagnostics-no-companion')?.details
            ?.diagnosticLinesChecked ?? [],
          redact,
        ),
        leaks: redactDeep(leaks, redact),
      }
    })(),
    runner: {
      exitCode: runnerCode,
      ...(runnerError === undefined ? {} : { error: redact(runnerError) }),
      editorExited: runnerError === undefined,
    },
    summary: {
      total: scenarios.length,
      passed: scenarios.length - failed.length,
      failed: failed.length,
      allPassed: scenarios.length > 0 && failed.length === 0,
    },
    logs: ['reports/vscode-smoke/logs/suite-results.json'],
  }

  writeFileSync(join(reportDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  writeFileSync(
    join(logDir, 'suite-results.json'),
    `${JSON.stringify(redactDeep(suite ?? { note: 'the suite wrote no results' }, redact), null, 2)}\n`,
  )

  try {
    rmSync(scratch, { recursive: true, force: true })
  } catch {
    /* the OS will get it */
  }

  console.log(
    `smoke: ${receipt.summary.passed}/${receipt.summary.total} passed — receipt written to ` +
      'reports/vscode-smoke/receipt.json',
  )
  for (const entry of receipt.scenarios) console.log(`  ${entry.verdict}  ${entry.id}`)
  process.exit(receipt.summary.allPassed ? 0 : 1)
}

/** Version and commit of the editor that was actually launched, read from its own install. */
function describeEditor(executable) {
  let dir = dirname(executable)
  for (let depth = 0; depth < 4; depth += 1) {
    const app = join(dir, 'resources', 'app')
    if (existsSync(join(app, 'package.json'))) {
      const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
      let commit
      try {
        commit = JSON.parse(readFileSync(join(app, 'product.json'), 'utf8')).commit
      } catch {
        commit = undefined
      }
      return { version: pkg.version, commit: commit ?? null }
    }
    dir = dirname(dir)
  }
  const guess = /-(\d+\.\d+\.\d+)/.exec(executable)
  return { version: guess?.[1] ?? 'unknown', commit: null }
}

main().catch(error => {
  console.error('smoke: harness failed', error)
  process.exit(2)
})
