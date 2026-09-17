/**
 * Screenshot Electron screens for owner review.
 *
 *   node scripts/screens/capture-electron.mjs <scenarios.json> <out-dir>
 *
 * scenarios.json: [{ "id", "title", "folder", "path": ["Base.SC2Data", "GameData", "UnitData.xml"],
 *                    "wait"?: ms, "actions"?: [{ "click": "text" } | { "wait": ms } |
 *                    { "view": "Hex" } | { "screenshot": "suffix" }] }]
 * Each scenario launches the real app on `folder` (`--open`), expands the tree along `path`, opens
 * the last row, runs the optional actions, and writes <id>.png plus <id>.txt (visible text).
 */
import { _electron as electron } from 'playwright-core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..', '..', 'apps', 'electron')
const [scenarioFile, outDir] = process.argv.slice(2)
if (scenarioFile === undefined || outDir === undefined)
  throw new Error('usage: capture-electron.mjs <scenarios.json> <out-dir>')
const scenarios = JSON.parse(await readFile(scenarioFile, 'utf8'))
await mkdir(outDir, { recursive: true })

// The header's view selector (Карточка / Hex / Модель …), not a select inside a mounted viewer.
const viewPicker = page =>
  page
    .locator("select[data-mk-part='explorer.viewpicker'], select[data-mk-part='viewpicker.select']")
    .first()

async function row(page, label) {
  const candidates = page.getByText(label, { exact: true })
  await candidates.first().waitFor({ timeout: 90_000 })
  return candidates.first()
}

const results = []
for (const scenario of scenarios) {
  const app = await electron.launch({
    args: [join(appRoot, 'electron', 'main.cjs'), '--open', scenario.folder],
    cwd: appRoot,
  })
  const result = { id: scenario.id, title: scenario.title, ok: true }
  const log = []
  app.process().stdout?.on('data', chunk => log.push(String(chunk)))
  app.process().stderr?.on('data', chunk => log.push(String(chunk)))
  try {
    const page = await app.firstWindow({ timeout: 180_000 })
    await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
    for (const [index, label] of (scenario.path ?? []).entries()) {
      const target = await row(page, label)
      if (index === scenario.path.length - 1) await target.dblclick()
      else await target.click()
      await page.waitForTimeout(400)
    }
    // The status bar says "Открывается …" / "Opening …" until the subject has rendered.
    await page
      .waitForFunction(() => !/Открывается|Opening/u.test(document.body.innerText), undefined, {
        timeout: 240_000,
      })
      .catch(() => {
        result.note = 'still opening after 240 s'
      })
    await page.waitForTimeout(scenario.wait ?? 3000)
    for (const action of scenario.actions ?? []) {
      if (action.click !== undefined) await (await row(page, action.click)).click()
      if (action.view !== undefined) {
        await viewPicker(page).selectOption({ label: action.view })
        await page.waitForTimeout(action.settle ?? 4000)
      }
      if (action.screenshot !== undefined)
        await page.screenshot({ path: join(outDir, `${scenario.id}--${action.screenshot}.png`) })
      if (action.wait !== undefined) await page.waitForTimeout(action.wait)
    }
    await page.screenshot({ path: join(outDir, `${scenario.id}.png`) })
    result.views = await viewPicker(page)
      .evaluate(select => [...select.options].map(option => option.label))
      .catch(() => [])
    const text = await page.evaluate(() => document.body.innerText)
    await writeFile(join(outDir, `${scenario.id}.txt`), text)
  } catch (error) {
    result.ok = false
    result.error = String(error?.message ?? error).split('\n')[0]
  } finally {
    await app.close().catch(() => {})
    await writeFile(join(outDir, `${scenario.id}.log`), log.join(''))
  }
  console.log(`${result.ok ? "ok  " : "FAIL"} ${scenario.id} ${result.error ?? result.note ?? ""}`)
  results.push(result)
}
await writeFile(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
