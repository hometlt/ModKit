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
import { fileURLToPath, pathToFileURL } from 'node:url'
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron'

const here = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(here, '..')
const repoRoot = resolve(extensionRoot, '..', '..')
const focusedGa = process.argv.includes('--focused-ga')
const reportName = focusedGa ? 'vscode-focused-ga-smoke' : 'vscode-smoke'
const reportDir = join(repoRoot, 'reports', reportName)
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

/**
 * Cold editor launches per smoke run.
 *
 * §7.4 wants a median and a p95, and both need samples: one launch is an anecdote. Five is the
 * smallest count that gives a median which is an observation rather than the single value, and each
 * launch costs about a minute and a half, so this is the honest floor rather than a round number.
 * `--repeat N` overrides it for a deliberate longer baseline.
 */
const repeatFlag = process.argv.indexOf('--repeat')
const repeats = Math.max(
  1,
  repeatFlag === -1 ? 5 : Number.parseInt(process.argv[repeatFlag + 1] ?? '5', 10) || 5,
)

/** Nearest-rank on the sorted samples: with five runs a p95 *is* the maximum, and says so. */
const quantile = (values, fraction) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.max(1, Math.ceil(fraction * sorted.length))
  return sorted[rank - 1]
}

const median = values => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle]
}

/**
 * The budget a future run is held to, from what this one measured.
 *
 * `median + 50%`, floored at one second of headroom. The formula is written down rather than a
 * number chosen by feel: §7.4's alarm is a 5% median regression, and a budget that tight would fire
 * on ordinary machine variance — this catches the order-of-magnitude kind while leaving the
 * percentage comparison to the recorded samples.
 */
const budgetFrom = value =>
  value === null ? null : Math.max(value + 1000, Math.round(value * 1.5))

/** The committed §7.4 baseline, or `undefined` before one exists. */
const readBaseline = () => {
  try {
    return JSON.parse(readFileSync(join(reportDir, 'performance-baseline.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * This run's medians against the committed ones.
 *
 * `alarm` follows §7.4 exactly: a median more than 5% worse. It is reported, never thrown — the
 * policy says an alarm requires investigation and may be accepted only by an ADR with the owner's
 * decision, which is not something a smoke run can do on its own. One agent session on one machine
 * cannot tell a regression from a busy laptop, and a gate that pretended otherwise would be trained
 * to be ignored.
 */
const compareBaseline = observed => {
  const baseline = readBaseline()
  if (baseline === undefined) return { state: 'no-baseline' }
  const rows = {}
  let alarm = false
  for (const key of ['activationMs', 'firstOpenMs']) {
    const before = baseline[key]?.median ?? null
    const after = observed[key] ?? null
    if (before === null || after === null) continue
    const changePercent = Math.round(((after - before) / before) * 1000) / 10
    const raised = changePercent > 5
    if (raised) alarm = true
    rows[key] = { baselineMedian: before, observedMedian: after, changePercent, alarm: raised }
  }
  return {
    state: alarm ? 'alarm' : 'within-policy',
    policy: 'median worse by more than 5% (§7.4); an alarm is investigated, not auto-accepted',
    baselineCommit: baseline.recordedFrom?.x3Commit ?? null,
    rows,
  }
}

/** Fixtures the scenarios need, by the variable that names them and the value that resolved. */
const FIXTURES = focusedGa
  ? {}
  : {
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
const LEGACY_ROOTS = [
  ...['models', 'tiberian-sun', 'big'].map(name => join(repoRoot, 'extensions', 'ea', name)),
  /*
   * The transport matrix's SC2 row. MPQ is not in the bundled `common` catalog and never was —
   * the block-13 matrix needs it, so the smoke adds it the same way it adds the EA roots: through
   * the product's own `modkit.extensions` setting, not a back door.
   */
  join(repoRoot, 'extensions', 'blizzard', 'mpq'),
  /*
   * Warzone PIE and Spring S3O, landed by the round-2 integration. The matrix uses the first to go
   * a level deeper into a `.wz` than the generic ZIP route could; the second is carried so the row
   * that cannot reach an S3O today is refused by a *composed* codec rather than by its absence.
   */
  join(repoRoot, 'extensions', 'opensource', 'warzone-2100'),
  join(repoRoot, 'extensions', 'opensource', 'spring'),
]

/*
 * The local-GA profile deliberately stops at Common + StarCraft II + Warzone 2100. Every file it
 * opens is a repository fixture, and every non-Common codec/provider reaches the extension through
 * the public `modkit.extensions` setting. No installed game, C&C root or BAR root is a precondition
 * for this product wiring receipt.
 */
const FOCUSED_ROOTS = [
  join(repoRoot, 'extensions', 'blizzard', 'models'),
  join(repoRoot, 'extensions', 'blizzard', 'starcraft2'),
  join(repoRoot, 'extensions', 'blizzard', 'starcraft2-game'),
  join(repoRoot, 'extensions', 'opensource', 'warzone-2100'),
]
const CONFIGURED_ROOTS = focusedGa ? FOCUSED_ROOTS : LEGACY_ROOTS
const FOCUSED_FILES = Object.freeze([
  ['minimal.m3', 'sc2-model.m3'],
  ['minimal.warzone.pie', 'warzone-model.pie'],
  ['minimal.SC2Map', 'sc2-map.SC2Map'],
  ['minimal-world.SC2Map', 'sc2-world.SC2Map'],
  ['minimal.warzone.wz', 'warzone-map.wz'],
  ['minimal.png', 'texture.png'],
  ['minimal.dds', 'texture.dds'],
])

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

  let lonelyVxl = ''
  if (!focusedGa) {
    /*
     * Scenario 5 needs the same model without its sidecar. Copying only the `.vxl` into a directory
     * that holds nothing else is the whole fixture: the companion is absent because it was never
     * brought along, not because anything was deleted.
     */
    const vxl = process.env.MODKITX_VXL_PATH
    lonelyVxl = join(workspace, basename(vxl))
    copyFileSync(vxl, lonelyVxl)
    if (existsSync(join(workspace, `${basename(vxl, extname(vxl))}.hva`))) {
      throw new Error('the staged copy unexpectedly has a companion beside it')
    }
  }

  /*
   * The shared command fixtures, staged from the same bytes the CLI and Electron tests use
   * (`packages/testkit/src/command-fixtures.ts`). Inside the workspace folder, so the extension's
   * own confinement grants them without a second dialog.
   */
  const { stageCommandFixtures } = await import(
    pathToFileURL(join(repoRoot, 'packages', 'testkit', 'dist', 'index.js')).href
  )
  stageCommandFixtures(workspace, repoRoot)

  /*
   * The ANI and ASTC fixtures are no longer staged: the scenario that opened them asked a decoder
   * question, and decoder questions are answered by the codecs' own suites (owner decision,
   * 2026-08-26). `syntheticDir` still serves the ODT below.
   */
  const syntheticDir = join(repoRoot, 'packages', 'testkit', 'test', 'fixtures', 'mk2-synthetic')
  /*
   * The Common Documents row of the transport matrix. An ODT rather than a text file, because the
   * question is whether the *documents* family reaches this editor from the bundled catalog — and
   * a `.txt` would have answered for plain-text instead.
   */
  copyFileSync(join(syntheticDir, 'minimal.odt'), join(workspace, 'fixture.odt'))

  if (focusedGa) {
    for (const [source, target] of FOCUSED_FILES) {
      copyFileSync(join(syntheticDir, source), join(workspace, target))
    }
  }

  // The selected catalog, added the way the product documents: a workspace setting the host reads
  // once at activation. Missing roots are reported rather than silently narrowing the receipt.
  const presentRoots = CONFIGURED_ROOTS.filter(root => existsSync(root))
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

  /**
   * One cold editor, start to finish.
   *
   * Factored out because §7.4 asks for raw samples rather than a single figure, and the only
   * honest way to sample a *cold* activation is to launch the editor again. Each run gets its own
   * results file and its own debugging port, so nothing from the previous one can be read by
   * mistake.
   */
  const runEditorOnce = async index => {
    const runPort = index === 0 ? port : await freePort()
    const runResults = join(scratch, `results-${index}.json`)
    let code = 0
    let error
    try {
      code = await runTests({
        vscodeExecutablePath: executable,
        extensionDevelopmentPath: extensionRoot,
        extensionTestsPath: join(here, 'suite', 'index.cjs'),
        launchArgs: [...launchArgs.slice(0, -1), `--remote-debugging-port=${runPort}`],
        extensionTestsEnv: {
          MODKITX_SMOKE_EXT_PATH: extensionRoot,
          MODKITX_SMOKE_RESULTS: runResults,
          MODKITX_SMOKE_CDP_PORT: String(runPort),
          MODKITX_SMOKE_LONELY_VXL: lonelyVxl,
          MODKITX_SMOKE_FIXTURE_DIR: workspace,
          MODKITX_SMOKE_REPO_ROOT: repoRoot,
          MODKITX_SMOKE_PROFILE: focusedGa ? 'focused-ga' : 'legacy',
          ...(focusedGa
            ? {}
            : {
                MODKITX_W3D_PATH: process.env.MODKITX_W3D_PATH,
                MODKITX_VXL_PATH: process.env.MODKITX_VXL_PATH,
                MODKITX_CNC3_ROOT: kingsWrathRoot,
                MODKITX_SC2_ROOT: process.env.MODKITX_SC2_ROOT,
                MODKITX_WARZONE_ROOT: process.env.MODKITX_WARZONE_ROOT,
                MODKITX_BAR_ROOT: process.env.MODKITX_BAR_ROOT,
              }),
          /*
           * Only the last run walks the transport matrix. The repeats exist to sample activation
           * and first open; opening five real corpus containers five times would multiply the run
           * for numbers nobody is collecting.
           */
          MODKITX_SMOKE_MATRIX: index === repeats - 1 ? '1' : '',
        },
      })
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
      code = typeof failure?.code === 'number' ? failure.code : 1
    }
    const parsed = existsSync(runResults) ? JSON.parse(readFileSync(runResults, 'utf8')) : undefined
    if (parsed !== undefined) writeFileSync(resultsPath, JSON.stringify(parsed, null, 2))
    return { code, error, suite: parsed }
  }

  /*
   * Samples across cold runs, for the §7.4 baseline. The *verdicts* come from the last run — one
   * set of scenario answers, not an average of five — while the timings come from all of them.
   */
  const samples = []
  let runnerCode = 0
  let runnerError
  let suite
  for (let index = 0; index < repeats; index += 1) {
    console.log(`smoke: editor run ${index + 1}/${repeats}…`)
    const attempt = await runEditorOnce(index)
    runnerCode = attempt.code
    runnerError = attempt.error
    suite = attempt.suite ?? suite
    const scenarios = attempt.suite?.scenarios ?? []
    const activation = scenarios.find(entry => entry.id === 'activation')?.details?.activationMs
    const firstOpen = scenarios.find(entry =>
      focusedGa ? entry.id === 'focused-preview-sc2-model' : entry.id === 'w3d-single',
    )?.details?.firstOpenMs
    samples.push({
      run: index + 1,
      ...(typeof activation === 'number' ? { activationMs: activation } : {}),
      ...(typeof firstOpen === 'number' ? { firstOpenMs: firstOpen } : {}),
    })
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
  const activationSamples = samples.flatMap(item =>
    typeof item.activationMs === 'number' ? [item.activationMs] : [],
  )
  const firstOpenSamples = samples.flatMap(item =>
    typeof item.firstOpenMs === 'number' ? [item.firstOpenMs] : [],
  )

  const receipt = {
    kind: focusedGa ? 'x3.vscode-focused-ga-smoke-receipt' : 'x3.vscode-smoke-receipt',
    version: 1,
    rung: 'E5',
    block: focusedGa ? 'block-20' : 'block-9',
    ...(focusedGa
      ? {
          scope: {
            included: ['Common', 'StarCraft II', 'Warzone 2100'],
            excluded: ['C&C Tiberium Wars/Kane’s Wrath/Red Alert 3', 'Spring/Recoil/BAR'],
            corpus: 'repository-pinned fixtures; no installed game is required',
          },
        }
      : {}),
    startedAt,
    finishedAt: new Date().toISOString(),
    /*
     * §7.4's raw samples, kept rather than reduced away: a median with the numbers behind it
     * discarded cannot be compared with the next one, and the policy asks for before/after on every
     * touched hot path.
     */
    performance: {
      note:
        'Cold editor launches. `activationMs` is the extension`s own figure (activate() start to ' +
        `return); \`firstOpenMs\` is command to stage list for the ${focusedGa ? 'focused SC2 M3' : 'W3D'}. Budget formula: ` +
        'max(median + 1000 ms, median * 1.5) — see run-smoke.mjs `budgetFrom`.',
      runs: repeats,
      samples,
      activationMs: {
        samples: activationSamples,
        median: median(activationSamples),
        p95: quantile(activationSamples, 0.95),
        budget: budgetFrom(median(activationSamples)),
      },
      firstOpenMs: {
        samples: firstOpenSamples,
        median: median(firstOpenSamples),
        p95: quantile(firstOpenSamples, 0.95),
        budget: budgetFrom(median(firstOpenSamples)),
      },
      againstBaseline: compareBaseline({
        activationMs: median(activationSamples),
        firstOpenMs: median(firstOpenSamples),
      }),
    },
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
      profile: focusedGa ? 'focused-ga' : 'legacy',
      fixtures: focusedGa
        ? [
            { source: 'minimal.odt', stagedAs: 'fixture.odt', resolved: true },
            ...FOCUSED_FILES.map(([source, stagedAs]) => ({ source, stagedAs, resolved: true })),
          ]
        : Object.keys(FIXTURES).map(name => ({ variable: name, resolved: true })),
      /* What the editor was told to load beside the bundled Common catalog. */
      configuredExtensionRoots: {
        setting: 'modkit.extensions',
        scope: 'workspace .vscode/settings.json',
        bundledCatalog: 'extensions/common',
        roots: presentRoots.map(root => root.slice(repoRoot.length + 1).replace(/\\/g, '/')),
        missing: CONFIGURED_ROOTS.filter(root => !existsSync(root)).map(root =>
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
    ...(focusedGa
      ? {}
      : {
          diagnosticCodeUnderTest: 'x3.host/companion-unavailable',
          /* These source-inspection notes belong only to the legacy diagnostic scenario. */
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
        }),
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
    logs: [`reports/${reportName}/logs/suite-results.json`],
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
      `reports/${reportName}/receipt.json`,
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
