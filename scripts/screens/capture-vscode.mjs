/**
 * Screenshot Modkit screens inside the installed VS Code for owner review.
 *
 *   node scripts/screens/capture-vscode.mjs <scenarios.json> <out-dir> --vsix <file.vsix>
 *
 * Uses an isolated user-data and extensions directory under <out-dir>/.profile, installs the VSIX
 * there, points `modkit.extensions` at every local extension repository, then opens each
 * scenario's file in one window (`-r <file>`) and saves <id>.png. Scenarios share the Electron
 * format: { id, title, folder, path: [...segments], wait? } — the file is folder/path.join('/').
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { localExtensionRoots } from './extension-roots.mjs'

const argv = process.argv.slice(2)
const [scenarioFile, outArgument] = argv
const vsix = argv[argv.indexOf('--vsix') + 1]
if (scenarioFile === undefined || outArgument === undefined || !argv.includes('--vsix'))
  throw new Error('usage: capture-vscode.mjs <scenarios.json> <out-dir> --vsix <file.vsix>')
const outDir = resolve(outArgument)
const coreRoot = resolve(import.meta.dirname, '..', '..')
const codeHome = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code')
const codeExe = join(codeHome, 'Code.exe')
const codeCli = join(codeHome, 'bin', 'code.cmd')
if (!existsSync(codeExe)) throw new Error(`VS Code not found at ${codeExe}`)

const scenarios = JSON.parse(await readFile(scenarioFile, 'utf8'))
// A relative `folder` is inside the workspace (the directory holding modkit-core), so moving it breaks nothing.
for (const scenario of scenarios) scenario.folder = resolve(coreRoot, '..', scenario.folder)
const profile = join(outDir, '.profile')
const userData = join(profile, 'user-data')
const extensionsDir = join(profile, 'extensions')
await rm(profile, { recursive: true, force: true })
await mkdir(join(userData, 'User'), { recursive: true })
await mkdir(extensionsDir, { recursive: true })
// A multi-root workspace over the scenario folders, as a user who opened their mod folders would
// have. The workspace file lives in the profile; nothing is written into the folders themselves.
const workspace = join(profile, 'screens.code-workspace')
await writeFile(
  workspace,
  JSON.stringify({ folders: [...new Set(scenarios.map(scenario => scenario.folder))].map(path => ({ path })) }),
)

const quote = value => `"${value}"`
const install = spawnSync(
  quote(codeCli),
  ['--extensions-dir', quote(extensionsDir), '--install-extension', quote(resolve(vsix)), '--force'],
  { shell: true, encoding: 'utf8' },
)
if (install.status !== 0) throw new Error(`VSIX install failed: ${install.stdout}${install.stderr}`)

await writeFile(
  join(userData, 'User', 'settings.json'),
  JSON.stringify(
    {
      'modkit.extensions': localExtensionRoots(coreRoot),
      'workbench.startupEditor': 'none',
      'security.workspace.trust.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'window.restoreWindows': 'none',
      // Modkit renders every file; one editor at a time keeps each screenshot to one subject.
      'workbench.editorAssociations': { '*': 'modkit.genericAssetPreview' },
      'workbench.editor.limit.enabled': true,
      'workbench.editor.limit.value': 1,
      'chat.disableAIFeatures': true,
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
    },
    null,
    2,
  ),
)

const port = await new Promise(done => {
  const server = createServer().listen(0, () => {
    const { port: free } = server.address()
    server.close(() => done(free))
  })
})
const common = ['--user-data-dir', userData, '--extensions-dir', extensionsDir]
const app = spawn(
  codeExe,
  [...common, '--new-window', '--disable-workspace-trust', '--skip-welcome',
    `--remote-debugging-port=${port}`, workspace],
  { stdio: 'ignore', detached: false },
)

const sleep = ms => new Promise(done => setTimeout(done, ms))
let browser
for (let attempt = 0; attempt < 90 && browser === undefined; attempt++) {
  await sleep(1000)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined)
}
if (browser === undefined) throw new Error('VS Code exposed no CDP endpoint')

async function workbench() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const page = browser
      .contexts()
      .flatMap(context => context.pages())
      .find(candidate => candidate.url().includes('workbench'))
    if (page !== undefined) return page
    await sleep(1000)
  }
  throw new Error('no workbench page')
}

/** Visible text of the workbench and every webview frame (Modkit editors live in iframes). */
async function allText(page) {
  const texts = await Promise.all(
    page.frames().map(frame => frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')),
  )
  return texts.join(String.fromCharCode(10))
}

const results = []
try {
  const page = await workbench()
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
  await sleep(15_000) // extension activation and Blizzard roots
  for (const scenario of scenarios) {
    const file = [scenario.folder, ...(scenario.path ?? [])].join('/')
    const result = { id: scenario.id, title: scenario.title, ok: true }
    try {
      // `-r <folder>` would replace this window's workspace (and hand the folder to extensions).
      if (statSync(file).isDirectory()) {
        result.note = 'папка: в VS Code открывается как папка рабочей области, отдельного экрана нет'
        console.log(`skip ${scenario.id} ${result.note}`)
        results.push(result)
        continue
      }
      spawnSync(codeExe, [...common, '-r', file], { stdio: 'ignore' })
      await sleep(scenario.wait ?? 8000)
      for (let waited = 0; /Opening|Открывается|Loading/u.test(await allText(page)); waited += 2000) {
        if (waited > 120_000) {
          result.note = 'still opening after 120 s'
          break
        }
        await sleep(2000)
      }
      await sleep(2000)
      await page.screenshot({ path: join(outDir, `${scenario.id}.png`) })
      const text = await allText(page)
      // The Modkit webview's own status line is the last non-empty line of its frame text.
      await writeFile(join(outDir, `${scenario.id}.txt`), text)
    } catch (error) {
      result.ok = false
      result.error = String(error?.message ?? error).split('\n')[0]
    }
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${scenario.id} ${result.error ?? result.note ?? ''}`)
    results.push(result)
  }
} finally {
  await browser.close().catch(() => {})
  app.kill()
  await writeFile(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
}
