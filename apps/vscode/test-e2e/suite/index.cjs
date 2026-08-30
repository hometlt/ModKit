/**
 * The block-9 smoke, run inside a real VS Code extension host.
 *
 * VS Code loads this file through `--extensionTestsPath` and awaits `run()`. It is CommonJS on
 * purpose: the package is `"type": "module"`, so a `.js` file here would be parsed as ESM and the
 * editor's `require` of it would fail before a single scenario ran.
 *
 * Two rules shape every assertion below.
 *
 *  - **Drive the product thread, never around it.** Each scenario reaches the subject the way a
 *    user does — the contributed custom editor, or the `modkit.openResource` command the Assets
 *    tree binds to its items. Nothing here composes a host of its own or calls into `dist/host.js`;
 *    a smoke that opened its own composition would prove that the library works and say nothing
 *    about whether the extension does.
 *  - **An unobservable claim is a FAIL, not a silence.** The subject's descriptor and its
 *    diagnostics live in the webview realm, and VS Code exposes no API for reading a webview from
 *    an extension host. Where this suite cannot see something through the product's own surface it
 *    says so in `evidence` and fails the scenario, rather than asserting something weaker and
 *    calling it a pass.
 *
 * The webview gap is closed where the editor allows it: VS Code is launched with a remote debugging
 * port, so the rendered page can be read over CDP exactly as a human reads it on screen. When that
 * channel is unavailable the scenarios that depend on it fail with the reason recorded.
 */
'use strict'
/*
 * `require` is not a style choice here: VS Code loads `--extensionTestsPath` through CommonJS, and
 * `vscode` itself is only resolvable that way. The rule that forbids it is written for the product
 * sources, which are ESM and stay ESM.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require('node:fs')
const path = require('node:path')
const url = require('node:url')
const vscode = require('vscode')

const CUSTOM_EDITOR = 'modkit.genericAssetPreview'

/*
 * Per-run ceilings (block 13, exit-gate line 4: "activation time and bundle closure did not
 * regress"). Slice 13D replaced the guesses behind them with measurement, and split the job in two.
 *
 * These constants are **crash guards**, not the §7.4 comparison. Their only purpose is to fail a
 * run where something has gone categorically wrong — a composition that started reading the disk
 * twice, a catalog that grew an order of magnitude — so they sit above the worst value ever
 * observed on this machine (activation ranged 2795–6493 ms across two sessions of five cold
 * launches; first open 1517–3640 ms). A ceiling nearer the median would fire on a busy laptop and
 * be trained away within a week.
 *
 * The real §7.4 work happens in `run-smoke.mjs`: five cold launches per run, raw samples kept, and
 * the medians compared against `reports/vscode-smoke/performance-baseline.json` with the policy's
 * own 5% threshold. That comparison is recorded as an alarm for investigation rather than an
 * automatic red gate, because §7.4 says an alarm may be accepted only by an ADR and a smoke run is
 * not an ADR.
 */
const ACTIVATION_BUDGET_MS = 10_000
const FIRST_OPEN_BUDGET_MS = 10_000
const COMPANION_DIAGNOSTIC = 'x3.host/companion-unavailable'

// ---------------------------------------------------------------------------------------------
// small helpers

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const samePath = (left, right) =>
  path.resolve(String(left)).toLowerCase() === path.resolve(String(right)).toLowerCase()

function requireEnv(name) {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

/**
 * A readable slice of what the page showed, for the receipt.
 *
 * Whitespace is collapsed because the rendered text is full of layout blank lines, and the cap
 * keeps a receipt reviewable — this is evidence of what was on screen, not a page dump. Absolute
 * locations inside it are replaced by the harness before anything is written to a tracked file.
 */
const excerpt = (text, limit = 2_500) => {
  const flat = String(text)
    .replace(/\s*\n\s*/g, ' · ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

/** Poll until `check` returns something truthy, or give up. Returns the value or `undefined`. */
async function waitFor(check, { timeoutMs = 20_000, stepMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() >= deadline) return undefined
    await sleep(stepMs)
  }
}

/** Every Modkit custom-editor tab currently open, by duck typing rather than `instanceof`. */
function modkitTabs() {
  const found = []
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input
      if (input !== null && typeof input === 'object' && 'viewType' in input && 'uri' in input) {
        if (input.viewType === CUSTOM_EDITOR) found.push({ tab, uri: input.uri })
      }
    }
  }
  return found
}

const tabFor = target => modkitTabs().find(entry => samePath(entry.uri.fsPath, target))

const tabForUri = text => modkitTabs().find(entry => entry.uri.toString() === text)

async function closeAllEditors() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await waitFor(() => modkitTabs().length === 0, { timeoutMs: 5_000 })
}

// ---------------------------------------------------------------------------------------------
// the container URI, built from outside
//
// Deliberately reimplemented here rather than imported from the extension. The address of a
// container member is a *published* shape — the Explorer holds it, a keybinding can carry it, and
// another extension could construct one — so a smoke that asked the extension to build its own URI
// would prove only that it agrees with itself. Three lines of hex is the whole encoding.

const CONTAINER_SCHEME = 'modkit-container'

const containerUri = (containerPath, entryPath = '') => {
  const token = [...Buffer.from(containerPath, 'utf8')]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
  return vscode.Uri.from({
    scheme: CONTAINER_SCHEME,
    path: entryPath === '' ? `/${token}` : `/${token}/${entryPath}`,
  })
}

// ---------------------------------------------------------------------------------------------
// reading the webview over CDP
//
// The rendered page is the only place the descriptor and the diagnostics exist. VS Code hands the
// extension host no way to read it, so the smoke reads it the way a debugger would: the editor was
// launched with `--remote-debugging-port`, and a webview is an ordinary target on it.

const cdp = {
  available: typeof WebSocket === 'function' && typeof fetch === 'function',
  port: Number(process.env.MODKITX_SMOKE_CDP_PORT ?? 0),
  note: '',
}

/** One `Runtime.evaluate` against one target, over a short-lived socket. */
function evaluateOnTarget(wsUrl, expression, timeoutMs = 8_000) {
  return new Promise(resolve => {
    let socket
    const finish = value => {
      try {
        socket?.close()
      } catch {
        /* already closing */
      }
      resolve(value)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    try {
      socket = new WebSocket(wsUrl)
    } catch {
      clearTimeout(timer)
      return resolve(undefined)
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
      try {
        const message = JSON.parse(String(event.data))
        if (message.id !== 1) return
        clearTimeout(timer)
        finish(message.result?.result?.value)
      } catch {
        clearTimeout(timer)
        finish(undefined)
      }
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      finish(undefined)
    })
    socket.addEventListener('close', () => {
      clearTimeout(timer)
      resolve(undefined)
    })
  })
}

/*
 * A VS Code webview is an `<iframe>` inside a `vscode-webview://` document, and depending on the
 * build either the outer document or the inner frame is the debuggable target. Rather than encode a
 * guess about which, every expression below is wrapped so it runs against whichever document in the
 * target actually holds the Modkit page — the one with the stage tabstrip in it.
 */
const inPage = body => `(() => {
  const docs = [document];
  for (const frame of document.querySelectorAll('iframe')) {
    try { if (frame.contentDocument) docs.push(frame.contentDocument) } catch (error) { void error }
  }
  const doc = docs.find(d => d.querySelector('[role=tab]')) ?? docs.find(d => (d.body?.innerText ?? '').trim() !== '') ?? document;
  return (${body})(doc);
})()`

/*
 * One CDP conversation at a time.
 *
 * The diagnostic sampler polls while a scenario is also listing stages and clicking them, and each
 * evaluation opens its own short-lived socket. Letting those overlap made the debugger hand back a
 * target list with no webview in it — a flake that reads exactly like "the page never rendered".
 * Serialising costs nothing here and removes the whole class of confusion.
 */
let cdpTurn = Promise.resolve()
const takeTurn = work => {
  const next = cdpTurn.then(work, work)
  cdpTurn = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/** Run one expression against every webview target; keep the richest answer. */
async function onWebviews(body, pick) {
  return takeTurn(() => onWebviewsNow(body, pick))
}

async function onWebviewsNow(body, pick) {
  if (!cdp.available || !Number.isFinite(cdp.port) || cdp.port <= 0) {
    cdp.note = 'no remote debugging port, or no WebSocket/fetch in this extension host runtime'
    return undefined
  }
  let targets
  try {
    const response = await fetch(`http://127.0.0.1:${cdp.port}/json/list`)
    targets = await response.json()
  } catch (error) {
    cdp.note = `target list unreachable: ${error instanceof Error ? error.message : String(error)}`
    return undefined
  }
  const webviews = (Array.isArray(targets) ? targets : []).filter(
    target =>
      typeof target?.url === 'string' &&
      target.url.includes('vscode-webview') &&
      typeof target.webSocketDebuggerUrl === 'string',
  )
  if (webviews.length === 0) {
    cdp.note = `no vscode-webview target among ${Array.isArray(targets) ? targets.length : 0}`
    return undefined
  }
  let best
  for (const target of webviews) {
    const value = await evaluateOnTarget(target.webSocketDebuggerUrl, inPage(body))
    best = pick(best, value)
  }
  return best
}

/** Everything the page renders as text, from whichever webview rendered the most of it. */
async function readWebviewText() {
  const text = await onWebviews("doc => doc.body ? doc.body.innerText : ''", (best, value) =>
    typeof value === 'string' && value.length > (best?.length ?? 0) ? value : best,
  )
  if (typeof text !== 'string' || text.trim() === '') {
    if (cdp.note === '') cdp.note = 'every webview target answered empty'
    return ''
  }
  return text
}

/*
 * Every stage label this build can offer, from `createVsCodePreviewStages`.
 *
 * The stage picker is drawn by the host page rather than by a shared component, so there is no one
 * selector to trust — an earlier version of this file keyed on `[role=tab]` and picked up the
 * shell's own Files/Extensions rail instead. Matching on the known vocabulary asks the question
 * that actually matters: which viewers did this subject get?
 */
const STAGE_LABELS = [
  'World',
  'Model',
  'Tree',
  'Metadata',
  'Hex',
  'Text',
  'Entries',
  'Table',
  'Image',
  'Vector',
  'Audio',
  'Video',
  'Edit',
]

/**
 * Stage labels the page is offering, read from its rendered text.
 *
 * Deliberately not a DOM query. The picker is drawn by the host page and its markup is not a
 * contract — two earlier versions of this function keyed on `[role=tab]` and on leaf elements, and
 * between them they found the shell's Files/Extensions rail, then nothing at all, while the page's
 * own text plainly said `Model · Tree · Metadata · Hex` the whole time. Reading what the page
 * displays is both what the manual checklist does and the thing that survives a markup change.
 */
function stagesIn(text) {
  return STAGE_LABELS.filter(label =>
    new RegExp(String.raw`(?:^|[·\n\t ])${label}(?:[·\n\t ]|$)`).test(text),
  )
}

async function readStageTabs() {
  return stagesIn(await readWebviewText())
}

/**
 * Click a stage by name, the way the person running the manual checklist does.
 *
 * A subject does not open on the stage that holds its numbers — a model opens on the canvas, and
 * the descriptor's groups are one click away. Selecting that panel is part of the scenario, not a
 * way around it: the click goes through whatever handler the page bound to its own picker.
 */
async function clickStage(name) {
  const clicked = await onWebviews(
    `doc => {
      const wanted = ${JSON.stringify(name.toLowerCase())};
      /*
       * The stage picker is a <select>, and clicking an <option> selects nothing — the browser
       * changes a select's value through its value, not through a click on its child. Driving it
       * the way the component listens for it is a change event on the select itself.
       */
      for (const select of doc.querySelectorAll('select')) {
        const option = Array.from(select.options)
          .find(item => (item.textContent || '').trim().toLowerCase() === wanted);
        if (!option) continue;
        if (select.value === option.value) return true;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      // Anything else that carries the label is an ordinary control; innermost wins, because a
      // wrapper whose whole text is the label would swallow the click.
      const matches = Array.from(doc.querySelectorAll('button, [role=tab], a, li'))
        .filter(node => (node.textContent || '').trim().toLowerCase() === wanted);
      const target = matches[matches.length - 1];
      if (!target) return false;
      target.click();
      return true;
    }`,
    (best, value) => best === true || value === true,
  )
  if (clicked === true) await sleep(2_000)
  return clicked === true
}

/**
 * Collect the page's diagnostic lines while something is happening.
 *
 * A diagnostic reaches this page as a *status* event — `webview.ts` turns every one into
 * `` `${code}: ${message}` `` on the status line — so it is transient by construction: the next
 * status overwrites it. Polling once after the page settles therefore misses it, which is exactly
 * what an earlier version of this suite did before concluding the diagnostic was never raised.
 *
 * Sampling fast from before the open until after it, and keeping every distinct diagnostic-shaped
 * line, turns that transient channel into something a scenario can assert on. It also scopes the
 * absolute-path check to the diagnostics themselves rather than to the whole page, which
 * legitimately shows the opened file's path in its breadcrumb.
 */
/**
 * Diagnostics VS Code itself holds for a subject.
 *
 * This is the surface the product now publishes to, and it is a better one to assert on than the
 * page in every way that matters: it has the code and the severity the host actually produced
 * rather than a string scraped out of prose, it does not vanish when the next status message
 * lands, and reading it needs no debugger — `getDiagnostics` is ordinary public API.
 */
function nativeDiagnostics(fsPath) {
  return vscode.languages.getDiagnostics(vscode.Uri.file(fsPath)).map(item => ({
    code:
      item.code !== null && typeof item.code === 'object'
        ? String(item.code.value)
        : String(item.code ?? ''),
    message: item.message,
    severity: vscode.DiagnosticSeverity[item.severity] ?? String(item.severity),
    source: item.source ?? '',
  }))
}

/** Wait for the host to publish at least one problem about this subject. */
async function waitForNativeDiagnostics(fsPath, timeoutMs = 30_000) {
  const found = await waitFor(
    () => {
      const items = nativeDiagnostics(fsPath)
      return items.length > 0 ? items : undefined
    },
    { timeoutMs, stepMs: 500 },
  )
  return found ?? []
}

function sampleDiagnostics() {
  const seen = new Set()
  let running = true
  const pattern = /x3\.[a-z0-9-]+\/[a-z0-9-]+:[^\n·]*/gi
  const loop = (async () => {
    while (running) {
      const text = await readWebviewText()
      for (const line of text.match(pattern) ?? []) seen.add(line.trim())
      await sleep(400)
    }
  })()
  return {
    lines: seen,
    async stop() {
      running = false
      await loop
      return [...seen]
    },
  }
}

/*
 * There is deliberately no "wait until the page text matches" helper here any more.
 *
 * The page renders asynchronously, so the obvious shape is to poll until the text says what the
 * scenario hoped for — and that shape quietly conflates two different things: a viewer's rendered
 * content, which persists, and a diagnostic, which arrives on the status line and is overwritten by
 * the next one. Waiting on the page for a diagnostic reports "never raised" for something that was
 * raised and scrolled past. Stage arrival is the settle signal; `sampleDiagnostics` is the channel.
 */

// ---------------------------------------------------------------------------------------------
// the product thread
//
// `resolveCustomEditor` is where the extension turns a URI into an open subject: it runs
// `describeOpenTarget`, grants the file's directory and attaches the webview. `vscode.openWith` is
// how a user reaches it ("Reopen Editor With… → Modkit Asset Preview"), so that is the door the
// smoke knocks on.

async function openThroughCustomEditor(fsPath) {
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(fsPath), CUSTOM_EDITOR)
  return waitFor(() => tabFor(fsPath), { timeoutMs: 20_000 })
}

/*
 * The other product door is `modkit.openResource`, the command every item in the Assets tree binds
 * to. It lands in the same `openResource` — grant the directory, route to the workbench — so it
 * reaches the subject pipeline through the same two functions the custom editor does. Scenario 1
 * asserts it is registered; opening a second panel through it here would only add another webview
 * for the page reader to disambiguate, without testing another code path.
 */

// ---------------------------------------------------------------------------------------------
// scenarios

const results = []

async function scenario(id, title, body) {
  const started = Date.now()
  const record = { id, title, verdict: 'fail', evidence: '', details: {} }
  try {
    const outcome = await body(record)
    record.verdict = outcome === false ? 'fail' : 'pass'
  } catch (error) {
    record.verdict = 'fail'
    const message = error instanceof Error ? error.message : String(error)
    record.evidence = record.evidence === '' ? message : `${record.evidence} — ${message}`
    record.details.error = message
    if (error instanceof Error && typeof error.stack === 'string') {
      record.details.stack = error.stack.split('\n').slice(0, 6).join('\n')
    }
  }
  record.durationMs = Date.now() - started
  results.push(record)
  console.log(`[smoke] ${record.verdict.toUpperCase()} ${id} — ${record.evidence}`)
}

/*
 * Core E2E rows exercise only first-party common viewers. Publisher-specific preview acceptance
 * lives with each external extension and is linked by the externalization owner receipts.
 */
const FOCUSED_PREVIEWS = Object.freeze([
  {
    id: 'focused-preview-document',
    title: 'The Common document reaches the real tree preview',
    file: 'fixture.odt',
    stage: 'Tree',
    formatId: 'odt',
  },
  {
    id: 'focused-preview-png',
    title: 'PNG reaches the real Image viewer',
    file: 'texture.png',
    stage: 'Image',
    formatId: 'png',
  },
  {
    id: 'focused-preview-dds',
    title: 'DDS reaches the real Image viewer',
    file: 'texture.dds',
    stage: 'Image',
    formatId: 'dds',
  },
])

async function runFocusedGaScenarios() {
  const staged = requireEnv('MODKITX_SMOKE_FIXTURE_DIR')
  for (const row of FOCUSED_PREVIEWS) {
    await scenario(row.id, row.title, async record => {
      const target = path.join(staged, row.file)
      const started = Date.now()
      const tab = await openThroughCustomEditor(target)
      record.details.tabOpened = tab !== undefined
      if (tab === undefined) {
        record.evidence = `no Modkit custom-editor tab appeared for ${row.file} within 20s`
        return false
      }
      await waitFor(async () => (await readStageTabs()).includes(row.stage), {
        timeoutMs: 45_000,
        stepMs: 500,
      })
      const stages = await readStageTabs()
      record.details.firstOpenMs = Date.now() - started
      record.details.stageTabs = stages
      record.details.expectedStage = row.stage
      if (!stages.includes(row.stage)) {
        record.evidence = `${row.file} opened, but ${row.stage} was absent from ${JSON.stringify(stages)}`
        return false
      }
      const clicked = await clickStage(row.stage)
      const visible = await readWebviewText()
      record.details.expectedStageSelected = clicked
      record.details.webviewReadable = visible.trim() !== ''
      record.details.pageExcerpt = excerpt(visible, 900)
      if (!clicked || visible.trim() === '') {
        record.evidence =
          `${row.stage} was offered for ${row.file}, but the rendered page could not be observed ` +
          `after selection (${cdp.note})`
        return false
      }

      const inspected = await vscode.commands.executeCommand('modkit.runCommand', {
        command: 'subject.inspect',
        subject: target,
      })
      const formatId = inspected?.data?.identity?.formatId ?? null
      record.details.inspect = {
        state: inspected?.state ?? 'no-answer',
        formatId,
        dataSources: inspected?.data?.dataSources ?? [],
      }
      if (inspected?.state !== 'ok' || formatId !== row.formatId) {
        record.evidence =
          `${row.stage} rendered, but subject.inspect expected ${row.formatId} and returned ` +
          `${formatId ?? inspected?.state ?? 'no answer'}`
        return false
      }
      record.evidence =
        `${row.file} opened in a real custom-editor tab, exposed and selected ${row.stage}, and ` +
        `subject.inspect identified ${row.formatId}`
      return true
    })
    await closeAllEditors()
  }

  await scenario(
    'focused-positive-conversion',
    'PNG conversion runs through the real editor command surface',
    async record => {
      const target = path.join(staged, 'texture.png')
      const result = await vscode.commands.executeCommand('modkit.runCommand', {
        command: 'subject.convert',
        subject: target,
        target: 'rgba8',
      })
      record.details.receipt = {
        command: result?.command ?? null,
        target: 'rgba8',
        state: result?.state ?? 'no-answer',
        outputKind: result?.data?.outputKind ?? null,
        byteLength: result?.data?.byteLength ?? null,
        wroteTo: result?.data?.wroteTo ?? null,
        diagnosticCodes: Array.isArray(result?.diagnostics)
          ? result.diagnostics.map(item => item.code)
          : [],
      }
      if (
        result?.state !== 'ok' ||
        result?.command !== 'subject.convert' ||
        result?.data?.outputKind !== 'bytes' ||
        !Number.isInteger(result?.data?.byteLength) ||
        result.data.byteLength <= 0
      ) {
        record.evidence =
          'subject.convert did not return a positive bytes receipt for target rgba8 through ' +
          'modkit.runCommand'
        return false
      }
      record.evidence =
        `modkit.runCommand returned subject.convert=ok and ${result.data.byteLength} rgba8 byte(s); ` +
        'the VS Code host intentionally received no output path, so wroteTo is null'
      return true
    },
  )

  await scenario(
    'focused-clean-close',
    'Focused editors close and the host stays responsive',
    async record => {
      await closeAllEditors()
      const after = modkitTabs().length
      record.details.tabsAfter = after
      if (after !== 0) {
        record.evidence = `${after} focused Modkit tab(s) survived closeAllEditors`
        return false
      }
      await vscode.commands.executeCommand('modkit.explainResolution')
      record.details.hostResponsiveAfterClose = true
      record.evidence = 'all focused tabs closed and the extension host still answers commands'
      return true
    },
  )
}

async function runScenarios(env) {
  let extension

  // ---------------------------------------------------------------- 1. activation
  await scenario('activation', 'The extension activates without error', async record => {
    const all = vscode.extensions.all.filter(item =>
      samePath(item.extensionPath, env.extensionPath),
    )
    if (all.length !== 1) {
      record.evidence = `expected exactly one extension at the development path, found ${all.length}`
      return false
    }
    extension = all[0]
    record.details.extensionId = extension.id
    await extension.activate()
    if (!extension.isActive) {
      record.evidence = 'activate() resolved but the extension reports itself inactive'
      return false
    }
    /*
     * Every `modkit.*` command is registered after `await createVsCodeSubjectHost(...)` in
     * `activate`, so finding all five is evidence that composition finished — the realms were
     * built, the catalog loaded and the worker policy resolved. An activation that threw anywhere
     * in that await would leave the command table short.
     */
    const registered = new Set(await vscode.commands.getCommands(true))
    const expected = [
      'modkit.showHostProfile',
      'modkit.openWith',
      'modkit.openResource',
      'modkit.explainResolution',
      'modkit.addExtensionFolder',
      ...(process.env.MODKITX_SMOKE_PROFILE === 'focused-ga'
        ? ['modkit.runCommand', 'modkit.game.launchActiveMap']
        : []),
    ]
    const missing = expected.filter(command => !registered.has(command))
    record.details.commands = { expected: expected.length, missing }
    if (missing.length > 0) {
      record.evidence = `activated, but these commands were never registered: ${missing.join(', ')}`
      return false
    }
    /*
     * The extension's own figure, not the harness's stopwatch: timing from out here would include
     * the editor's startup and the test runner's own scheduling, and would drift with both.
     */
    const api = extension.exports
    record.details.activationMs = api?.activationMs ?? null
    record.details.contributions = api?.contributions ?? null
    record.details.missingCatalogRoots = api?.missingCatalogRoots ?? null
    record.details.activationBudgetMs = ACTIVATION_BUDGET_MS
    if (api === undefined || typeof api.activationMs !== 'number') {
      record.evidence =
        'the extension activated but exported no activation figure, so exit-gate line 4 cannot be ' +
        'measured from the product surface'
      return false
    }
    if (api.missingCatalogRoots.length > 0) {
      record.evidence =
        'activated, but the shipped catalog names roots this build does not contain: ' +
        api.missingCatalogRoots.join('; ')
      return false
    }
    if (api.activationMs > ACTIVATION_BUDGET_MS) {
      record.evidence = `activate() took ${api.activationMs} ms, over the ${ACTIVATION_BUDGET_MS} ms budget`
      return false
    }
    record.evidence =
      `activate() resolved in ${api.activationMs} ms (budget ${ACTIVATION_BUDGET_MS} ms) with ` +
      `${api.contributions} contribution(s) from the shipped catalog and none missing; all ` +
      `${expected.length} modkit commands are registered, so the host composition completed ` +
      'inside activation'
    return true
  })

  if (extension === undefined || !extension.isActive) {
    const unreachable =
      process.env.MODKITX_SMOKE_PROFILE === 'focused-ga'
        ? [
            ...FOCUSED_PREVIEWS.map(row => row.id),
            'focused-world-presentation',
            'focused-positive-conversion',
          ]
        : ['w3d-single', 'vxl-companion', 'big-nested', 'diagnostics-no-companion']
    for (const id of unreachable) {
      results.push({
        id,
        title: 'not attempted',
        verdict: 'fail',
        evidence: 'the extension did not activate, so this scenario was never reached',
        details: {},
        durationMs: 0,
      })
    }
    return
  }

  if (process.env.MODKITX_SMOKE_PROFILE === 'focused-ga') {
    await runFocusedGaScenarios()
    return
  }

  // ---------------------------------------------------------------- 2. single W3D
  await scenario('w3d-single', 'A single W3D opens with its descriptor', async record => {
    const target = requireEnv('MODKITX_W3D_PATH')
    const diagnostics = sampleDiagnostics()
    const openStarted = Date.now()
    const tab = await openThroughCustomEditor(target)
    record.details.tabOpened = tab !== undefined
    if (tab === undefined) {
      await diagnostics.stop()
      record.evidence = 'no Modkit custom-editor tab appeared for the W3D within 20s'
      return false
    }
    /*
     * The stage list is what the page puts up once the host has answered with a descriptor and the
     * applicable viewers are known, so its arrival is the signal that the subject settled. Two
     * labels rather than one: every subject gets at least a pair, and a single stray match is more
     * likely to be a word elsewhere on the page than a picker that finished rendering.
     */
    await waitFor(async () => (await readStageTabs()).length >= 2, {
      timeoutMs: 45_000,
      stepMs: 500,
    })
    // First open, end to end: the command, the host's open, the worker spawn, the page's stages.
    record.details.firstOpenMs = Date.now() - openStarted
    record.details.firstOpenBudgetMs = FIRST_OPEN_BUDGET_MS
    const stages = await readStageTabs()
    record.details.stageTabs = stages

    // Whatever the subject opened on, before any stage is chosen. Kept unconditionally so the
    // receipt still shows what was on screen when no stage could be selected at all.
    const pages = { 'as-opened': await readWebviewText() }
    // Then walk the stages a person walks, keeping what each one said.
    for (const name of ['Metadata', 'Tree', 'Model']) {
      if (!stages.includes(name)) continue
      if (await clickStage(name)) pages[name] = await readWebviewText()
    }
    record.details.stagesVisited = Object.keys(pages)
    const text = Object.values(pages).join('\n')
    record.details.diagnosticsSeen = await diagnostics.stop()
    record.details.webviewReadable = text.trim() !== ''
    if (!record.details.webviewReadable) {
      record.evidence =
        'the custom editor tab opened, but the webview could not be read, so the descriptor ' +
        `could not be confirmed (${cdp.note})`
      return false
    }
    record.details.pageExcerpt = excerpt(text)

    /*
     * "Opened with a descriptor" is not a claim about text on a screen: it is the question of
     * whether a codec claimed the file. A W3D nothing claimed falls back to Text and Hex, so the
     * presence of the model stages is the assertion that matters here.
     */
    const modelStages = ['Model', 'Metadata', 'Tree'].filter(name => stages.includes(name))
    record.details.modelStages = modelStages
    if (!stages.includes('Model')) {
      record.evidence =
        `the W3D opened, but the only stages offered were ${JSON.stringify(stages)} — no codec ` +
        'claimed it, so it reached no model descriptor'
      return false
    }

    /*
     * The scene graph builds exactly one node per hierarchy pivot, so the node count the model
     * viewer prints *is* the pivot count. The animation count is not printed anywhere the page
     * shows, which is recorded rather than papered over.
     */
    const nodes = /(\d+)\s*nodes?/i.exec(text)
    const pivots = /(\d+)\s*pivots?/i.exec(text)
    const animations = /(\d+)\s*animations?/i.exec(text)
    record.details.nodes = nodes?.[1] ?? null
    record.details.pivotsLiteral = pivots?.[1] ?? null
    record.details.animationsLiteral = animations?.[1] ?? null

    /*
     * What the scene *contains* is no longer asserted here (owner decision, 2026-08-26): app
     * harnesses answer for wiring and lifecycle, and domain behaviour is proved by the browser/Node
     * suites. This used to fail on "the scene shows N nodes where block 9 expects 2 pivots" — a
     * claim about the W3D codec, asked through a screen-scrape of a webview, which is the weakest
     * possible way to ask it. `packages/testkit/test/ea-w3d-structure.test.ts` asks it properly,
     * against the same fixture, with the descriptor in hand.
     *
     * The numbers stay in `details` because a receipt showing what was on screen costs nothing and
     * helps when something does go wrong. They are evidence, not assertions.
     */
    record.details.contentProvedBy = 'packages/testkit/test/ea-w3d-structure.test.ts'
    if (record.details.firstOpenMs > FIRST_OPEN_BUDGET_MS) {
      record.evidence =
        `the W3D opened correctly but took ${record.details.firstOpenMs} ms to reach its stages, ` +
        `over the ${FIRST_OPEN_BUDGET_MS} ms budget`
      return false
    }
    record.evidence =
      'opened through "Reopen Editor With… → Modkit Asset Preview" in ' +
      `${record.details.firstOpenMs} ms (budget ${FIRST_OPEN_BUDGET_MS} ms) and mounted ` +
      `${modelStages.join('/')}; what the model contains is proved in ` +
      'packages/testkit/test/ea-w3d-structure.test.ts, not screen-scraped here'
    return true
  })
  await closeAllEditors()

  // ---------------------------------------------------------------- 3. VXL with companion
  await scenario('vxl-companion', 'A VXL resolves its .hva companion', async record => {
    const target = requireEnv('MODKITX_VXL_PATH')
    const companion = `${target.slice(0, -path.extname(target).length)}.hva`
    record.details.companionOnDisk = fs.existsSync(companion)
    const diagnostics = sampleDiagnostics()
    const tab = await openThroughCustomEditor(target)
    if (tab === undefined) {
      await diagnostics.stop()
      record.evidence = 'no Modkit custom-editor tab appeared for the VXL within 20s'
      return false
    }
    await waitFor(async () => (await readStageTabs()).length >= 2, {
      timeoutMs: 45_000,
      stepMs: 500,
    })
    const stages = await readStageTabs()
    record.details.stageTabs = stages
    const pages = { 'as-opened': await readWebviewText() }
    for (const name of ['Metadata', 'Model']) {
      if (stages.includes(name) && (await clickStage(name))) pages[name] = await readWebviewText()
    }
    const text = Object.values(pages).join('\n')
    record.details.diagnosticsSeen = await diagnostics.stop()
    if (text.trim() === '') {
      record.evidence =
        `the VXL tab opened, but the webview could not be read (${cdp.note}), so neither the ` +
        'companion provenance nor the absence of a sidecar diagnostic could be confirmed'
      return false
    }
    record.details.pageExcerpt = excerpt(text)
    if (!stages.includes('Model')) {
      record.evidence =
        `the VXL opened, but the only stages offered were ${JSON.stringify(stages)} — no codec ` +
        'claimed it, so no animation plane could carry companion provenance'
      return false
    }
    /*
     * The sidecar is beside the model, so the informational "an optional companion is absent"
     * diagnostic must not be raised. That is the half of this scenario the page can answer for
     * certain, because a diagnostic is a thing the page is given rather than a thing it draws.
     */
    record.details.nativeDiagnostics = nativeDiagnostics(target)
    const complainsMissing =
      record.details.nativeDiagnostics.some(item => item.code === COMPANION_DIAGNOSTIC) ||
      record.details.diagnosticsSeen.some(line => line.toLowerCase().includes(COMPANION_DIAGNOSTIC))
    record.details.companionDiagnosticPresent = complainsMissing
    if (complainsMissing) {
      record.evidence =
        'the sidecar is on disk next to the model, but the host still raised ' +
        `${COMPANION_DIAGNOSTIC}`
      return false
    }
    const mentionsCompanion = /\.hva\b/i.test(text) || /companion/i.test(text)
    const animationPlane = /(\d+)\s*animations?/i.exec(text)
    record.details.mentionsCompanion = mentionsCompanion
    record.details.animations = animationPlane?.[1] ?? null
    /*
     * The assertion is the *absence of the diagnostic*, which is an app surface: the host resolved
     * the sidecar and therefore said nothing about a missing one, and this window is where that
     * silence is observable. Whether the `.hva` decoded correctly is the codec's question, proved
     * in `packages/testkit/test/ea-vxl-hva-companion.test.ts` (owner decision, 2026-08-26).
     */
    record.details.contentProvedBy = 'packages/testkit/test/ea-vxl-hva-companion.test.ts'
    record.evidence =
      `opened with gnavrail.hva beside it and mounted ${stages.join('/')}; the host raised no ` +
      `${COMPANION_DIAGNOSTIC}, so the sidecar resolved. What the companion contains is proved in ` +
      'packages/testkit/test/ea-vxl-hva-companion.test.ts'
    return true
  })
  await closeAllEditors()

  // ---------------------------------------------------------------- 4. BIG → nested W3D
  await scenario('big-nested', 'A W3D nested in a BIG archive opens as a subject', async record => {
    const archive = path.join(requireEnv('MODKITX_CNC3_ROOT'), 'Core', '1.0', 'Misc.big')
    const entry = 'data/editor/molds/bowl.w3d'
    record.details.archiveOnDisk = fs.existsSync(archive)
    record.details.entry = entry
    if (!record.details.archiveOnDisk) {
      record.evidence = "Misc.big is not where the Kane's Wrath root says it should be"
      return false
    }
    const tab = await openThroughCustomEditor(archive)
    record.details.archiveTabOpened = tab !== undefined
    if (tab === undefined) {
      record.evidence = 'the archive itself did not open in a Modkit custom editor'
      return false
    }
    /*
     * The question this scenario asks is whether the *extension* can be told to open an entry
     * inside the archive — from outside the page, the way a person reaches anything else in this
     * editor. Three doors have to line up, and each is asserted separately so a failure names which
     * one gave:
     *
     *   1. the commands exist and are registered;
     *   2. the container's members are readable through the editor's own `workspace.fs`, which is
     *      the API the native Explorer uses — so this is the Explorer's question, asked directly;
     *   3. `modkit.openArchiveEntry` on a member URI reaches a Modkit editor showing that member as
     *      a subject of its own, not the archive and not a hex pane.
     */
    const commands = new Set(await vscode.commands.getCommands(true))
    record.details.nestedCommands = ['modkit.openArchiveEntry', 'modkit.browseContainer'].filter(
      command => commands.has(command),
    )
    if (record.details.nestedCommands.length !== 2) {
      record.evidence =
        'the archive opens, but the extension registers no command that names a member inside it ' +
        `(found ${JSON.stringify(record.details.nestedCommands)})`
      return false
    }

    /*
     * The archive's own tab is closed before anything else is read, and that is not tidying.
     *
     * `readWebviewText` keeps the *longest* answer among all live webview targets, so two open
     * Modkit pages are indistinguishable to it — and a BIG listing 210 entries is always longer
     * than one small model, which means the stages read back would be the archive's. (The first
     * run of this scenario reported exactly that: `["Tree","Metadata","Hex","Entries","Edit"]`,
     * where `Entries` is a stage only a namespace subject publishes.)
     *
     * Closing it also strengthens the claim. The granted directory and the container session
     * outlive the tab, so what follows shows the container filesystem answering with no Modkit
     * editor open on the archive at all — which is the situation the native Explorer is in.
     */
    await closeAllEditors()

    // The Explorer's own question: what does this container hold?
    const root = containerUri(archive)
    let listing
    try {
      listing = await vscode.workspace.fs.readDirectory(root)
    } catch (error) {
      record.evidence = `the container filesystem provider refused to list the archive: ${error}`
      return false
    }
    record.details.containerRootEntries = listing.map(([name]) => name).slice(0, 12)
    record.details.containerRootCount = listing.length
    const member = containerUri(archive, entry)
    let stat
    try {
      stat = await vscode.workspace.fs.stat(member)
    } catch (error) {
      record.evidence = `the provider listed the archive but could not stat «${entry}»: ${error}`
      return false
    }
    record.details.memberBytes = stat.size
    if (stat.size <= 0) {
      record.evidence = `the provider reports «${entry}» as ${stat.size} bytes`
      return false
    }

    // And the member as a subject: the same custom editor, reached by the same command a user runs.
    await vscode.commands.executeCommand('modkit.openArchiveEntry', member)
    const memberTab = await waitFor(() => tabForUri(member.toString()), { timeoutMs: 30_000 })
    record.details.memberTabOpened = memberTab !== undefined
    if (memberTab === undefined) {
      record.evidence = `«${entry}» did not open in a Modkit custom editor within 30s`
      return false
    }
    // One Modkit page is live, so the text read below is unambiguously this member's.
    record.details.liveModkitTabs = modkitTabs().length
    if (record.details.liveModkitTabs !== 1) {
      record.evidence =
        `${record.details.liveModkitTabs} Modkit tab(s) are open, so the page reader cannot be ` +
        'attributed to the member; the scenario refuses to guess'
      return false
    }
    await waitFor(async () => (await readStageTabs()).length >= 2, {
      timeoutMs: 45_000,
      stepMs: 500,
    })
    const stages = await readStageTabs()
    record.details.memberStages = stages
    const pages = { 'as-opened': await readWebviewText() }
    for (const name of ['Metadata', 'Tree', 'Model']) {
      if (!stages.includes(name)) continue
      if (await clickStage(name)) pages[name] = await readWebviewText()
    }
    const text = Object.values(pages).join('\n')
    record.details.pageExcerpt = excerpt(text)
    /*
     * A member nothing claimed falls back to Text and Hex — which is exactly the behaviour this
     * scenario used to record as the failure. The model stages are therefore the assertion: they
     * exist only when a codec opened the entry *as a W3D*, through the host's nested route, with
     * the container still open behind it.
     */
    if (!stages.includes('Model')) {
      record.evidence =
        `«${entry}» opened from inside the archive, but the only stages offered were ` +
        `${JSON.stringify(stages)} — no codec claimed it, so it did not become a model subject`
      return false
    }
    const nodes = /(\d+)\s*nodes?/i.exec(text)
    record.details.memberNodes = nodes?.[1] ?? null
    // Recorded, not asserted: what the nested model holds belongs to the host's own nested suite.
    record.details.contentProvedBy = 'packages/host/test/nested-subject-containers.test.ts'
    record.evidence =
      `with no editor open on the archive, the container filesystem lists ${listing.length} root ` +
      `entries through the editor's own workspace.fs and stats «${entry}» at ${stat.size} bytes; ` +
      '`modkit.openArchiveEntry` then opened it in a Modkit editor with the model stages ' +
      'mounted — the member is a subject, not a hex preview'
    return true
  })
  await closeAllEditors()

  // ---------------------------------------------------------------- 5. missing companion
  await scenario(
    'diagnostics-no-companion',
    'A VXL without its sidecar reports a leak-free diagnostic',
    async record => {
      const lonely = requireEnv('MODKITX_SMOKE_LONELY_VXL')
      record.details.copyOnDisk = fs.existsSync(lonely)
      record.details.companionAbsent = !fs.existsSync(
        `${lonely.slice(0, -path.extname(lonely).length)}.hva`,
      )
      if (!record.details.copyOnDisk || !record.details.companionAbsent) {
        record.evidence = 'the harness did not stage a companion-less copy of the VXL'
        return false
      }
      const diagnostics = sampleDiagnostics()
      const tab = await openThroughCustomEditor(lonely)
      if (tab === undefined) {
        await diagnostics.stop()
        record.evidence = 'the companion-less VXL did not open in a Modkit custom editor'
        return false
      }
      await waitFor(async () => (await readStageTabs()).length >= 2, {
        timeoutMs: 45_000,
        stepMs: 500,
      })
      const stages = await readStageTabs()
      record.details.stageTabs = stages
      const pages = { 'as-opened': await readWebviewText() }
      for (const name of ['Metadata', 'Model']) {
        if (stages.includes(name) && (await clickStage(name))) pages[name] = await readWebviewText()
      }
      // Keep sampling a little longer: the status line is transient and the open is asynchronous.
      await sleep(3_000)
      const seen = await diagnostics.stop()
      record.details.diagnosticsSeen = seen
      const text = Object.values(pages).join('\n')
      record.details.pageExcerpt = excerpt(text)
      if (stages.length === 0 && seen.length === 0) {
        record.evidence =
          `the tab opened, but neither a stage nor a diagnostic could be read (${cdp.note}), so ` +
          `${COMPANION_DIAGNOSTIC} could not be confirmed`
        return false
      }
      /*
       * The native collection first, the page second. The product publishes structured
       * diagnostics to VS Code's own Problems surface, so that is where the code and severity
       * are; the page's status line is kept as a secondary channel so a regression in either one
       * is still visible here.
       */
      const native = await waitForNativeDiagnostics(lonely)
      record.details.nativeDiagnostics = native
      const nativeRaised = native.filter(item => item.code === COMPANION_DIAGNOSTIC)
      const raised = [
        ...nativeRaised.map(item => `${item.code}: ${item.message}`),
        ...seen.filter(line => line.toLowerCase().includes(COMPANION_DIAGNOSTIC)),
      ]
      record.details.diagnosticCode = raised.length > 0 ? COMPANION_DIAGNOSTIC : null
      record.details.channels = {
        problemsPanel: nativeRaised.length > 0,
        pageStatusLine: seen.some(line => line.toLowerCase().includes(COMPANION_DIAGNOSTIC)),
      }
      if (raised.length === 0) {
        record.evidence =
          `the model opened without its sidecar on ${stages.join('/')} stages, but the page never ` +
          `showed ${COMPANION_DIAGNOSTIC} — in fact it showed no diagnostic of any kind ` +
          `(${seen.length} seen), so the code cannot be confirmed and its text cannot be checked ` +
          'for leaked paths'
        return false
      }
      /*
       * The negative half, checked on the diagnostic lines themselves rather than on the whole
       * page. The page's breadcrumb legitimately shows the opened file's location; a diagnostic is
       * the thing that must not hand out the shape of this machine, and it is the thing that
       * travels — into a log, a bug report, a support thread.
       */
      const leaks = []
      for (const [label, pattern] of [
        ['drive letter', /[A-Za-z]:[\\/]/g],
        ['UNC path', /\\\\[^\s\\]+\\/g],
        ['file:// URL', /file:\/\//gi],
        ['home directory', /\/(?:home|Users)\/[^\s/]+/g],
      ]) {
        const hits = raised.join('\n').match(pattern)
        if (hits !== null) leaks.push(`${label}: ${hits.slice(0, 3).join(', ')}`)
      }
      record.details.absolutePathLeaks = leaks
      record.details.diagnosticLinesChecked = raised
      if (leaks.length > 0) {
        record.evidence =
          `${COMPANION_DIAGNOSTIC} was raised, but the diagnostic text leaks an absolute ` +
          `location — ${leaks.join('; ')}`
        return false
      }
      record.evidence =
        `the model opened without its sidecar, the host raised ${COMPANION_DIAGNOSTIC}, and the ` +
        `${raised.length} diagnostic line(s) carry no drive letter, UNC path, file:// URL or ` +
        'home directory'
      return true
    },
  )

  /*
   * Publisher-specific transport matrices moved to their extension owners. Core keeps the generic
   * document, image and command-surface scenarios above.
   */

  /*
   * `gpu-texture-stages` lived here and is gone (owner decision, 2026-08-26).
   *
   * It opened `minimal.ani` and `minimal.astc` and asserted each reached an Image stage — which is
   * a claim about the ANI and ASTC *decoders*, asked through a screen-scrape of a webview. Those
   * decoders have their own suites, in-process, against the same fixtures:
   * `extensions/common/images/test/ani-raster-decode.test.ts` and `astc-void-extent.test.ts`, with
   * the parity ratchet recording both as poorer → richer. Asking the same question twice, once
   * weakly, is not extra assurance — it is a second thing to keep working.
   *
   * What a dev host still answers for is that a codec reaching this build shows up as stages at
   * all, and the transport matrix above asks exactly that, for five source families.
   */
  // ---------------------------------------------------------------- 6. shared command fixtures
  /*
   * The third column of exit-gate line 2 (block 13): *the same command fixtures pass in the CLI,
   * the Electron fake host and the VS Code integration*. The first two are asserted in
   * `scripts/test/command-fixtures-hosts.test.ts`; this is the one that needs a real editor.
   *
   * The fixture list is imported from the testkit, not restated — if it were restated, "the same
   * fixtures" would be a claim about three lists that happen to look alike. The command is reached
   * through `modkit.runCommand` with an argument object, which is the same door the palette opens.
   */
  await scenario(
    'command-fixtures',
    'The shared command fixtures run in the editor',
    async record => {
      const staged = requireEnv('MODKITX_SMOKE_FIXTURE_DIR')
      /*
       * `import()` rather than `require()`: the testkit is an ES module and this suite is CommonJS
       * (the editor's `extensionTestsPath` requires it). Node can require an ESM graph these days,
       * but a dynamic import is the form that is true on every version this smoke might run under.
       */
      const testkitUrl = url.pathToFileURL(
        path.join(requireEnv('MODKITX_SMOKE_REPO_ROOT'), 'packages', 'testkit', 'dist', 'index.js'),
      ).href
      const { COMMAND_FIXTURES, COMMAND_FIXTURE_FILES, checkCommandFixture } = await import(
        testkitUrl
      )
      const subjectFor = fixture =>
        path.join(
          staged,
          fixture.subject === 'png' ? COMMAND_FIXTURE_FILES.png : COMMAND_FIXTURE_FILES.archive,
        )

      const verdicts = []
      for (const fixture of COMMAND_FIXTURES) {
        const result = await vscode.commands.executeCommand('modkit.runCommand', {
          command: fixture.command,
          subject: subjectFor(fixture),
          ...(fixture.entry === undefined ? {} : { entry: fixture.entry }),
        })
        verdicts.push(
          result === undefined
            ? {
                id: fixture.id,
                command: fixture.command,
                passed: false,
                note: 'the command returned nothing',
              }
            : checkCommandFixture(fixture, result),
        )
      }
      record.details.fixtures = verdicts
      const failed = verdicts.filter(verdict => !verdict.passed)
      if (failed.length > 0) {
        record.evidence =
          `${failed.length} of ${verdicts.length} shared command fixture(s) did not reach their ` +
          `expected state in the editor: ${failed.map(item => `${item.id} (${item.note ?? ''})`).join('; ')}`
        return false
      }
      record.evidence =
        `all ${verdicts.length} shared command fixtures reached the same state here as in the CLI ` +
        'and the Electron fake host — one runtime, three products, one verdict per fixture'
      return true
    },
  )
  await closeAllEditors()

  // ---------------------------------------------------------------- 6. clean shutdown
  await scenario('clean-close', 'Editors close and the host stays responsive', async record => {
    const before = modkitTabs().length
    await closeAllEditors()
    const after = modkitTabs().length
    record.details.tabsBefore = before
    record.details.tabsAfter = after
    if (after !== 0) {
      record.evidence = `${after} Modkit tab(s) survived closeAllEditors`
      return false
    }
    /*
     * Disposing a panel runs `served.close(...)`, which disposes the bridge and closes the RPC
     * exposure. Neither is readable from here, so what this asserts is the observable consequence:
     * the extension host is still answering after every session was torn down, and — recorded by
     * the harness rather than by this process — the editor then exits on its own.
     */
    await vscode.commands.executeCommand('modkit.explainResolution')
    record.details.hostResponsiveAfterClose = true
    record.evidence =
      `all ${before} Modkit tab(s) closed and the extension host still answers commands ` +
      'afterwards; the editor’s own exit is recorded by the harness'
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// entry point

exports.run = async function run() {
  const env = { extensionPath: requireEnv('MODKITX_SMOKE_EXT_PATH') }
  const started = new Date().toISOString()
  let harnessError
  try {
    await runScenarios(env)
  } catch (error) {
    harnessError = error instanceof Error ? error.message : String(error)
  }
  const payload = {
    startedAt: started,
    finishedAt: new Date().toISOString(),
    extensionHost: {
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      chrome: process.versions.chrome ?? null,
      vscode: vscode.version,
    },
    webviewChannel: {
      cdpUsable: cdp.available,
      port: cdp.port,
      note: cdp.note,
    },
    scenarios: results,
    ...(harnessError === undefined ? {} : { harnessError }),
  }
  const out = process.env.MODKITX_SMOKE_RESULTS
  if (out !== undefined && out !== '') {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`)
  }
  /*
   * Resolve even when scenarios failed. The verdicts are the deliverable and the harness turns them
   * into the receipt and the exit code; rejecting here would lose the file that was just written
   * behind VS Code's own "tests failed" message.
   */
  console.log(
    `[smoke] ${results.filter(r => r.verdict === 'pass').length}/${results.length} passed`,
  )
}
