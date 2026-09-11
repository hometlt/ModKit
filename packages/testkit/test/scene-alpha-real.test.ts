import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { renderHeadless } from '../../scene/src/render/headless.js'
import { alphaCases } from './fixtures/scene-alpha.js'
import { encodeRgbaPng } from '../../scene/src/output/png.js'

let browser: Browser
let page: Page
beforeAll(async () => {
  const executablePath = [
    process.env['CHROME_PATH'],
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((path): path is string => path !== undefined && existsSync(path))
  if (executablePath === undefined)
    throw new Error('Chrome/Chromium is required for real scene alpha tests')
  const result = await build({
    stdin: {
      contents: `import { renderBrowser } from './packages/scene/src/render/browser.ts';
      import { alphaCases } from './packages/testkit/test/fixtures/scene-alpha.ts';
      export async function run() { const frames=[]; for(const item of alphaCases()) {
        const frame=await renderBrowser(item.request); frames.push({name:item.name,rgba:Array.from(frame.rgba),diagnostics:frame.diagnostics});
      } return frames; }`,
      resolveDir: resolve(import.meta.dirname, '../../..'),
      loader: 'ts',
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'alphaProbe',
    write: false,
  })
  const output = result.outputFiles[0]
  if (output === undefined) throw new Error('browser fixture bundle missing')
  browser = await chromium.launch({ executablePath, headless: true })
  page = await browser.newPage()
  await page.addScriptTag({ content: output.text })
}, 60_000)
afterAll(async () => {
  await browser?.close()
})

it('matches independent pixel expectations and CPU alpha rules in actual WebGL2', async () => {
  const gpu = await page.evaluate(async () => {
    const scope = globalThis as unknown as {
      alphaProbe: { run(): Promise<{ name: string; rgba: number[]; diagnostics: unknown[] }[]> }
    }
    return scope.alphaProbe.run()
  })
  const cases = alphaCases()
  const evidence = process.env['MODKIT_SCENE_ALPHA_EVIDENCE_DIR']
  const reports: {
    name: string
    pixel: readonly number[]
    gpuSha256: string
    cpuSha256: string
  }[] = []
  if (evidence !== undefined) mkdirSync(evidence, { recursive: true })
  expect(gpu.length).toBe(cases.length)
  for (const [index, item] of cases.entries()) {
    const cpu = await renderHeadless(item.request),
      frame = gpu[index]
    if (frame === undefined) throw new Error('missing GPU frame')
    expect(frame.name).toBe(item.name)
    expect(frame.diagnostics).toEqual([])
    for (let offset = 0; offset < cpu.rgba.length; offset++) {
      const expected = item.pixel[offset % 4],
        actual = frame.rgba[offset],
        reference = cpu.rgba[offset]
      if (expected === undefined || actual === undefined || reference === undefined)
        throw new Error('missing pixel component')
      expect(
        Math.abs(actual - expected),
        `${item.name}: WebGL component ${offset}`,
      ).toBeLessThanOrEqual(1)
      expect(reference, `${item.name}: CPU component ${offset}`).toBe(expected)
      expect(
        Math.abs(actual - reference),
        `${item.name}: CPU/GPU component ${offset}`,
      ).toBeLessThanOrEqual(1)
    }
    if (evidence !== undefined) {
      const rgba = Uint8Array.from(frame.rgba)
      writeFileSync(
        resolve(evidence, `${index}.webgl.png`),
        await encodeRgbaPng({ width: 8, height: 8, rgba }),
      )
      writeFileSync(resolve(evidence, `${index}.cpu.png`), await encodeRgbaPng(cpu))
      reports.push({
        name: item.name,
        pixel: item.pixel,
        gpuSha256: createHash('sha256').update(rgba).digest('hex'),
        cpuSha256: createHash('sha256').update(cpu.rgba).digest('hex'),
      })
    }
  }
  if (evidence !== undefined)
    writeFileSync(
      resolve(evidence, 'cases.json'),
      JSON.stringify(
        { schemaVersion: 1, width: 8, height: 8, tolerance: 1, cases: reports },
        null,
        2,
      ) + '\n',
    )
})
