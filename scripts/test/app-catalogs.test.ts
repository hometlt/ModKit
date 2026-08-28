import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const emitter = join(repoRoot, 'scripts', 'emit-app-catalogs.mjs')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'x3-app-catalogs-'))
  temporaryRoots.push(root)
  const common = join(repoRoot, 'extensions', 'common')
  for (const entry of readdirSync(common, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(common, entry.name)
    const destination = join(root, 'extensions', 'common', entry.name)
    mkdirSync(destination, { recursive: true })
    cpSync(join(source, 'package.json'), join(destination, 'package.json'))
    if (existsSync(join(source, 'contributions'))) {
      cpSync(join(source, 'contributions'), join(destination, 'contributions'), { recursive: true })
    }
  }
  cpSync(
    join(repoRoot, 'packages', 'ui', 'contributions'),
    join(root, 'packages', 'ui', 'contributions'),
    { recursive: true },
  )
  return root
}

function run(root: string, ...args: readonly string[]) {
  return spawnSync(process.execPath, [emitter, '--root', root, ...args], { encoding: 'utf8' })
}

describe('deterministic Electron app catalog emission', () => {
  it('derives portable catalogs from codec inventory and selected UI contribution manifests', () => {
    const root = fixtureRoot()
    const emitted = run(root)
    expect(emitted.status, emitted.stderr).toBe(0)
    expect(emitted.stdout).toBe('4 shared app catalogs emitted\n')

    const generated = join(root, 'apps', 'electron', 'generated')
    const bundled = readFileSync(join(generated, 'bundled-catalog.cjs'), 'utf8')
    expect(bundled).toContain("  'archives',")
    expect(bundled).toContain("  'text-json',")
    expect(bundled).toContain("  'video',")
    expect(bundled).not.toContain('ui-monaco')
    expect(bundled).not.toContain('ui-graph-3d')

    const presentation = readFileSync(
      join(root, 'packages', 'host', 'src', 'presentation-catalog.generated.ts'),
      'utf8',
    )
    expect(presentation).toContain("contributionId: 'org.modkitx.ui/image-stage'")
    expect(presentation).toContain("extensionId: 'org.modkitx/ui-monaco'")
    expect(presentation).toContain('priority: 360')

    for (const name of ['bundled-catalog.cjs', 'viewer-catalog.d.ts', 'viewer-catalog.js']) {
      const content = readFileSync(join(generated, name), 'utf8')
      expect(content).not.toContain(repoRoot.replaceAll('\\', '/'))
      expect(content).not.toMatch(/[A-Za-z]:[\\/]/)
      expect(content).not.toContain('\r')
    }
    expect(presentation).not.toContain(repoRoot.replaceAll('\\', '/'))
    expect(presentation).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(presentation).not.toContain('\r')

    const checked = run(root, '--check')
    expect(checked.status, checked.stderr).toBe(0)
    expect(checked.stdout).toBe('4 shared app catalogs checked\n')
  })

  it('fails --check on drift and reports every stale catalog in stable name order', () => {
    const root = fixtureRoot()
    expect(run(root).status).toBe(0)
    const generated = join(root, 'apps', 'electron', 'generated')
    writeFileSync(join(generated, 'bundled-catalog.cjs'), 'stale\n', 'utf8')
    writeFileSync(join(generated, 'viewer-catalog.js'), 'stale\n', 'utf8')

    const checked = run(root, '--check')
    expect(checked.status).toBe(1)
    expect(checked.stdout).toBe('')
    expect(checked.stderr).toBe(
      'Electron app catalogs are stale: bundled-catalog.cjs, viewer-catalog.js\n',
    )
  })

  it('rejects unexpected generated files instead of exempting handwritten app code', () => {
    const root = fixtureRoot()
    expect(run(root).status).toBe(0)
    const generated = join(root, 'apps', 'electron', 'generated')
    writeFileSync(join(generated, 'handwritten-loader.js'), 'export const unsafe = true\n', 'utf8')

    const checked = run(root, '--check')
    expect(checked.status).toBe(1)
    expect(checked.stderr).toBe(
      'Electron app catalogs contain unexpected files: handwritten-loader.js\n',
    )
    const emitted = run(root)
    expect(emitted.status).toBe(1)
    expect(emitted.stderr).toBe(
      'Electron app catalogs contain unexpected files: handwritten-loader.js\n',
    )
  })

  it('reflects manifest priority changes instead of retaining handwritten presentation data', () => {
    const root = fixtureRoot()
    const manifestPath = join(root, 'packages', 'ui', 'contributions', 'viewer-image-stage.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.spec.priority = 361
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')

    expect(run(root).status).toBe(0)
    const presentation = readFileSync(
      join(root, 'packages', 'host', 'src', 'presentation-catalog.generated.ts'),
      'utf8',
    )
    expect(presentation).toContain('priority: 361')
    /*
     * Scoped to the image slot: "no 360 anywhere" was only ever a proxy for "the priority came
     * from the manifest", and it stopped being one when the policy grew a second stage that
     * declares 360 (the audio stage). What must hold is that *this* slot moved.
     */
    const slot = presentation.slice(presentation.indexOf("slotId: 'image'"))
    const block = slot.slice(0, slot.indexOf('}),'))
    expect(block).toContain('priority: 361')
    expect(block).not.toContain('priority: 360')
  })
})
