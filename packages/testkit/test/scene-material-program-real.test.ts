import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { materialCaseProgram, materialProgramCases } from './fixtures/scene-material-program.js'
import { encodeRgbaPng } from '../../scene/src/output/png.js'

let browser: Browser, page: Page
const reports: unknown[] = []
const evidence = process.env['MODKIT_MATERIAL_PROGRAM_EVIDENCE_DIR']
beforeAll(async () => {
  const executablePath = [
    process.env['CHROME_PATH'],
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((path): path is string => path !== undefined && existsSync(path))
  if (executablePath === undefined)
    throw new Error('Chrome/Chromium required for material program tests')
  const bundle = await build({
    entryPoints: ['packages/testkit/test/fixtures/scene-material-webgl.ts'],
    absWorkingDir: resolve(import.meta.dirname, '../../..'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'materialProbe',
    write: false,
  })
  const output = bundle.outputFiles[0]
  if (output === undefined) throw new Error('material probe bundle missing')
  browser = await chromium.launch({ executablePath, headless: true })
  page = await browser.newPage()
  await page.addScriptTag({ content: output.text })
  if (evidence !== undefined) mkdirSync(evidence, { recursive: true })
}, 60_000)
afterAll(async () => {
  await browser?.close()
  if (evidence !== undefined)
    writeFileSync(
      resolve(evidence, 'cases.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          scope:
            'generated material vertex/fragment link and isolated fragment pixels; not whole-scene renderer parity',
          width: 8,
          height: 8,
          tolerance: 1,
          cases: reports,
        },
        null,
        2,
      ) + '\n',
    )
})

it('refuses missing resources and device limits before allocation, and releases failed GPU programs', async () => {
  const result = await page.evaluate(() => {
    const scope = globalThis as unknown as {
      materialProbe: {
        materialFailureProbe(): {
          missing: string
          missingAllocations: number
          limit: string
          limitAllocations: number
          compile: string
          link: string
          sampler: string
          allocated: number
          deleted: number
          shaderDeletes: number
          clean: boolean
          ownedTextureAlive: boolean
        }
      }
    }
    return scope.materialProbe.materialFailureProbe()
  })
  expect(result.missing).toContain('unresolved')
  expect(result.limit).toContain('texture samplers')
  expect(result.missingAllocations).toBe(0)
  expect(result.limitAllocations).toBe(0)
  expect(result.compile).toContain('compilation failed')
  expect(result.link).toContain('link failed')
  expect(result.sampler).toContain('allocate a material sampler')
  expect(result.clean).toBe(true)
  expect(result.allocated).toBe(3)
  expect(result.shaderDeletes).toBe(6)
  expect(result.ownedTextureAlive).toBe(true)
})

it.each(materialProgramCases().map((item, index) => ({ name: item.name, index })))(
  '$name executes the shared material in real WebGL2',
  async ({ index }) => {
    const item = materialProgramCases()[index]
    if (item === undefined) throw new Error('material case missing')
    const source = materialCaseProgram(item),
      cpu = source.shade(item.pixel)
    const pixel = cpu.alphaTestPassed
      ? cpu.rgba.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255))
      : [0, 0, 0, 0]
    if (item.expected !== undefined)
      expect(pixel).toEqual(item.expected.map(x => Math.round(x * 255)))
    const gpu = await page.evaluate(index => {
      const scope = globalThis as unknown as {
        materialProbe: {
          renderMaterialCase(index: number): {
            name: string
            rgba: number[]
            error: number
            releasedRefused: boolean
          }
        }
      }
      return scope.materialProbe.renderMaterialCase(index)
    }, index)
    expect(gpu.name).toBe(item.name)
    expect(gpu.error).toBe(0)
    expect(gpu.releasedRefused).toBe(true)
    for (const [offset, component] of gpu.rgba.entries())
      expect(
        Math.abs(component - (pixel[offset % 4] ?? NaN)),
        `${item.name} pixel ${Math.floor(offset / 4)} channel ${offset % 4}`,
      ).toBeLessThanOrEqual(1)
    if (evidence !== undefined) {
      const rgba = Uint8Array.from(gpu.rgba)
      writeFileSync(
        resolve(evidence, `${item.name}.png`),
        await encodeRgbaPng({ width: 8, height: 8, rgba }),
      )
      reports.push({
        name: item.name,
        expected: pixel,
        sha256: createHash('sha256').update(rgba).digest('hex'),
        shaderKey: source.key,
        diagnostics: source.diagnostics,
        textureBindings: source.textures.length,
      })
    }
  },
)
