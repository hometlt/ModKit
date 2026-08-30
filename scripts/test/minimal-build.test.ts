/**
 * The minimal-build gate — «ModKit — это набор независимых строительных блоков, а не монолитный
 * фреймворк» is a claim about what a bundler produces, so this suite bundles and looks.
 *
 * Each case builds a tiny consumer with esbuild exactly as an application would, then asserts on
 * the emitted text. Markers are strings unique to each surface's own code — its UI text and
 * messages — deliberately NOT the part-name vocabulary: `parts.ts` is one shared array carrying
 * every part name, so any module that stamps a part carries all the names, and a part-name marker
 * would report the dictionary as the surface. (The first draft of this gate did exactly that, and
 * "the hex viewer rode along" turned out to be four bytes of string table.)
 *
 * The root barrel is deliberately measured, not forbidden: an app that wants everything may take
 * everything. What the gate forbids is a *subpath* import paying for the barrel.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '..', '..')

function productionSources(root: string): readonly string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) files.push(path)
    }
  }
  visit(root)
  return files.sort()
}

async function bundled(
  source: string,
  options: { platform?: 'browser' | 'node' } = {},
): Promise<string> {
  const result = await build({
    // stdin with resolveDir: bare specifiers resolve from the repo root's node_modules, exactly
    // as a consumer checked out beside the workspace would resolve them
    stdin: { contents: source, resolveDir: repoRoot, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: options.platform ?? 'browser',
    absWorkingDir: repoRoot,
    logLevel: 'silent',
    external: ['node:*'],
  })
  const output = result.outputFiles[0]
  if (output === undefined) throw new Error('esbuild produced no output')
  return output.text
}

/** Surfaces that must NOT ride along uninvited, with the marker that proves each one's presence. */
const HEAVY_MARKERS: readonly (readonly [string, string])[] = [
  ['the hex viewer', 'Byte offset'],
  ['the explorer/file tree', 'Drop a file here to preview it.'],
  ['the settings surface', 'No extensions are configured yet.'],
  ['the workbench shell', 'Workbench activities'],
  ['the relation graph', 'Filter node types'],
  ['the text editor', 'requires a streaming editor'],
  ['monaco', 'monaco-editor'],
]

const expectNone = (text: string, except: readonly string[] = []): void => {
  for (const [label, marker] of HEAVY_MARKERS) {
    if (except.includes(marker)) continue
    expect(text.includes(marker), `${label} rode along uninvited (found ${marker})`).toBe(false)
  }
}

describe('minimal builds stay minimal', () => {
  it('keeps production web and VS Code graphs on explicit UI surface imports', () => {
    const rootImports: string[] = []
    for (const appRoot of ['apps/web/src', 'apps/vscode/src']) {
      for (const file of productionSources(resolve(repoRoot, appRoot))) {
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, index) => {
          if (/from ['"]@modkitx-x3\/ui['"]/u.test(line)) {
            rootImports.push(`${relative(repoRoot, file)}:${index + 1}`)
          }
        })
      }
    }
    expect(rootImports).toEqual([])
  })

  it('an image-viewer consumer gets the image viewer and none of the rest', async () => {
    const text = await bundled(
      `export { imageViewer } from '@modkitx-x3/ui/image'\n` +
        `export { metadataPanel } from '@modkitx-x3/ui/metadata'\n`,
    )
    expect(text).toContain('pixelFormat')
    expect(text).toContain('No metadata reported by the codec.')
    expectNone(text)
  }, 60_000)

  it('a hex-only consumer gets hex and nothing visual beyond it', async () => {
    const text = await bundled(`export { hexViewer } from '@modkitx-x3/ui/hex'\n`)
    expect(text).toContain('Byte offset')
    expectNone(text, ['Byte offset'])
  }, 60_000)

  it('a subpath import costs a fraction of the barrel, and the barrel is measured, not banned', async () => {
    const subpath = await bundled(`export { imageViewer } from '@modkitx-x3/ui/image'\n`)
    const barrel = await bundled(`export { imageViewer } from '@modkitx-x3/ui'\n`)
    /*
     * With `sideEffects: false` a good bundler can shake the barrel too — if this ratio collapses
     * toward 1, that is a win, not a failure. What must never happen is the reverse: the subpath
     * paying for the whole package.
     */
    expect(subpath.length).toBeLessThan(barrel.length)
    expect(subpath.length).toBeLessThan(200_000)
  }, 60_000)

  it('a headless host carries no UI vocabulary at all', async () => {
    const text = await bundled(`export { createModkit } from '@modkitx-x3/host/node'\n`, {
      platform: 'node',
    })
    expect(text.includes('data-mk-part'), 'UI leaked into the headless host').toBe(false)
    expect(text.includes('monaco-editor'), 'monaco leaked into the headless host').toBe(false)
  }, 60_000)

  it('a linked extension carries its codecs, not a user interface', async () => {
    const text = await bundled(
      `export { images } from './extensions/common/images/src/linked.js'\n`,
      {
        platform: 'node',
      },
    )
    expect(text).toContain('image-png')
    expect(text.includes('data-mk-part'), 'UI leaked into a linked extension').toBe(false)
  }, 60_000)

  it('the file VFS provider does not carry unrelated provider implementations', async () => {
    const text = await bundled(
      `export { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'\n`,
      { platform: 'node' },
    )
    expect(text).toContain('file provider refused to escape its confined root boundary')
    for (const [label, marker] of [
      ['memory', 'memory provider exceeded its configured entry boundary'],
      ['git', 'git provider exceeded its configured checkout boundary'],
      ['http', 'http provider exceeded its configured response boundary'],
      ['browser-file', 'browser-file provider exceeded its selected-file boundary'],
    ] as const) {
      expect(text.includes(marker), `${label} VFS provider rode along uninvited`).toBe(false)
    }
    expect(text.length).toBeLessThan(80_000)
  }, 60_000)

  it('the portable VFS root carries no provider implementation', async () => {
    const text = await bundled(`export { VirtualFileSystem } from '@modkitx-x3/vfs'\n`)
    expect(text).not.toContain('file provider refused to escape its confined root boundary')
    expect(text).not.toContain('memory provider exceeded its configured entry boundary')
  }, 60_000)

  it('the language contract subpath carries no host, runtime ABI or presentation contracts', async () => {
    const text = await bundled(
      `export { LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT } from '@modkitx-x3/sdk/language'\n`,
    )
    expect(text).toContain('common.language/document-analysis')
    expect(text).not.toContain('service activation cycle detected')
    expect(text).not.toContain('ModelPrimitive')
    expect(text).not.toContain('presentationSlotId')
    expect(text).not.toContain('data-mk-part')
    expect(text.length).toBeLessThan(2_000)
  }, 60_000)

  it('the runtime contract subpath carries neither language, renderer nor host implementation', async () => {
    const text = await bundled(
      `export { RUNTIME_PROVIDER_CONTRACT } from '@modkitx-x3/sdk/runtime'\n`,
    )
    expect(text).toContain('common.runtime/provider')
    expect(text).not.toContain('common.language/document-analysis')
    expect(text).not.toContain('common.render/scene-3d')
    expect(text).not.toContain('service activation cycle detected')
    expect(text).not.toContain('presentationSlotId')
    expect(text).not.toContain('data-mk-part')
    expect(text.length).toBeLessThan(2_500)
  }, 60_000)

  it('the renderer contract subpath carries neither language, runtime nor host implementation', async () => {
    const text = await bundled(
      `export { SCENE_RENDERER_CONTRACT } from '@modkitx-x3/sdk/renderer'\n`,
    )
    expect(text).toContain('common.render/scene-3d')
    expect(text).not.toContain('common.language/document-analysis')
    expect(text).not.toContain('common.runtime/provider')
    expect(text).not.toContain('service activation cycle detected')
    expect(text).not.toContain('presentationSlotId')
    expect(text).not.toContain('data-mk-part')
    expect(text.length).toBeLessThan(2_500)
  }, 60_000)

  it('the games contract subpath carries no language, runtime, renderer or host implementation', async () => {
    const text = await bundled(
      `export { GAME_INSTALLATION_DISCOVERY_CONTRACT } from '@modkitx-x3/sdk/games'\n`,
    )
    expect(text).toContain('common.game/installation-discovery')
    expect(text).not.toContain('common.language/document-analysis')
    expect(text).not.toContain('common.runtime/provider')
    expect(text).not.toContain('common.render/scene-3d')
    expect(text).not.toContain('service activation cycle detected')
    expect(text).not.toContain('data-mk-part')
    expect(text.length).toBeLessThan(2_500)
  }, 60_000)

  it('the mods contract subpath carries no language, runtime, renderer or host implementation', async () => {
    const text = await bundled(
      `export { MOD_WORKSPACE_COMPOSITION_CONTRACT } from '@modkitx-x3/sdk/mods'\n`,
    )
    expect(text).toContain('common.mod/workspace-composition')
    expect(text).not.toContain('common.language/document-analysis')
    expect(text).not.toContain('common.runtime/provider')
    expect(text).not.toContain('common.render/scene-3d')
    expect(text).not.toContain('service activation cycle detected')
    expect(text).not.toContain('data-mk-part')
    expect(text.length).toBeLessThan(6_000)
  }, 60_000)

  it('the data contract subpath carries no game parser, renderer or host implementation', async () => {
    const text = await bundled(
      `export { DATA_CATALOG_ANALYSIS_CONTRACT } from '@modkitx-x3/sdk/data'\n`,
    )
    expect(text).toContain('common.data/catalog-analysis')
    expect(text).not.toContain('parseXml')
    expect(text).not.toContain('common.render/scene-3d')
    expect(text).not.toContain('service activation cycle detected')
    expect(text).not.toContain('data-mk-part')
    expect(text.length).toBeLessThan(2_500)
  }, 60_000)

  it('the maps contract subpath carries no game parser, renderer or host implementation', async () => {
    const text = await bundled(
      `export { MAP_SEMANTIC_ANALYSIS_CONTRACT } from '@modkitx-x3/sdk/maps'\n`,
    )
    expect(text).toContain('common.map/semantic-analysis')
    expect(text).not.toContain('parseXml')
    expect(text).not.toContain('HMAP')
    expect(text).not.toContain('common.render/scene-3d')
    expect(text).not.toContain('service activation cycle detected')
    expect(text).not.toContain('data-mk-part')
    expect(text.length).toBeLessThan(2_500)
  }, 60_000)
})
