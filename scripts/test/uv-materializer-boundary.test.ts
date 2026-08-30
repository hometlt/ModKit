/**
 * The materializer boundary (block 11, slice 11C1, plan item 14).
 *
 * "Native model codecs and their live projectors do not import the materializer" is the kind of
 * rule that decays into a comment the first time someone is in a hurry, so it is a build here
 * instead: every model codec in the tree is bundled and its input graph inspected. A codec that
 * could also write UVM would make one format have two owners, and the second owner is always the
 * one nobody remembers to update.
 *
 * The reverse direction is checked too — the materializer must not drag a codec in — because a
 * writer that imported a native reader would be deciding what a model is a second time.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { buildInventory, createHostContributionContractRegistry } from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

const repoRoot = resolve(import.meta.dirname, '..', '..')

/** Every entrypoint that reads a native model and publishes a live projection. */
const MODEL_CODECS = [
  'extensions/common/models/src/gltf/codec.js',
  'extensions/common/models/src/obj/codec.js',
  'extensions/common/models/src/uvm/codec.js',
  'extensions/common/models/src/dae/codec.js',
  'extensions/common/models/src/ply/codec.js',
  'extensions/common/models/src/stl/codec.js',
]

/** The image codecs whose decoded regions the UVT materializer consumes, and the KTX2 reader. */
const IMAGE_CODECS = [
  'extensions/common/images/src/bmp/codec.js',
  'extensions/common/images/src/tga/codec.js',
  'extensions/common/images/src/png/codec.js',
  'extensions/common/images/src/dds/codec.js',
  'extensions/common/images/src/ktx2/codec.js',
]

const graphOf = async (entry: string): Promise<readonly string[]> => {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    packages: 'external',
    metafile: true,
    write: false,
    logLevel: 'silent',
  })
  return Object.keys(result.metafile?.inputs ?? {})
}

describe('the UVM materializer is the only writer, and no codec is a second one', () => {
  it('no native model codec reaches the materializer or its writer', async () => {
    for (const codec of MODEL_CODECS) {
      const inputs = await graphOf(codec)
      expect(
        inputs.some(path => path.includes('uv-materializer')),
        `${codec} must not import the materializer`,
      ).toBe(false)
      // and no codec carries a UVM writer of its own under a different name
      expect(
        inputs.some(path => /materializ|uvm-writer/u.test(path)),
        `${codec} must not carry a second UVM writer`,
      ).toBe(false)
    }
  }, 120_000)

  it('the materializer reaches no native codec and no platform package', async () => {
    const inputs = await graphOf('extensions/common/uv-materializer/src/materializer.js')
    // it is the whole point that this module is self-contained: one file, no dependencies at all
    expect(inputs).toEqual(['extensions/common/uv-materializer/src/materializer.js'])
  }, 60_000)

  it('the same boundary holds for the texture materializer (block 12, slice 12-1)', async () => {
    /*
     * The UVT materializer joined the family, so the rule has to hold on its side too — otherwise
     * an image codec would quietly become a second owner of the container format, which is the
     * exact failure the model side was fenced off from.
     */
    for (const codec of IMAGE_CODECS) {
      const inputs = await graphOf(codec)
      expect(
        inputs.some(path => path.includes('uv-materializer')),
        `${codec} must not import the texture materializer`,
      ).toBe(false)
      expect(
        inputs.some(path => /uvt-writer|texture-materializer/u.test(path)),
        `${codec} must not carry a second UVT writer`,
      ).toBe(false)
    }
    const inputs = await graphOf('extensions/common/uv-materializer/src/texture-materializer.js')
    expect(inputs).toEqual(['extensions/common/uv-materializer/src/texture-materializer.js'])
  }, 120_000)

  it('no minimal-closure profile carries the writer', () => {
    /*
     * Exit gate of block 11: "minimal inspection does not pull writer, render or runtime". The
     * materializer is a separate extension family precisely so that a profile can leave it out, and
     * the composition lock is where that is decided — so this reads the lock rather than trusting
     * that nobody added it.
     */
    const profiles = JSON.parse(
      readFileSync(join(repoRoot, 'migration', 'product-profiles.json'), 'utf8'),
    ) as {
      presets: readonly {
        id: string
        minimalClosure: boolean
        extensionFamilies: readonly string[]
        plannedFamilies: readonly string[]
      }[]
    }
    const minimal = profiles.presets.filter(preset => preset.minimalClosure)
    expect(minimal.length).toBeGreaterThan(0)
    for (const preset of minimal) {
      expect(
        [...preset.extensionFamilies, ...preset.plannedFamilies],
        `${preset.id} must not carry the materializer`,
      ).not.toContain('uv-materializer')
    }
  })

  it('the UVM reader and the UVM writer are separate contributions of separate extensions', async () => {
    const [models, materializer] = await Promise.all([
      loadExtensionDirectory(join(repoRoot, 'extensions', 'common', 'models')),
      loadExtensionDirectory(join(repoRoot, 'extensions', 'common', 'uv-materializer')),
    ])
    const inventory = await buildInventory(
      [models, materializer].map(input => ({
        ...input,
        execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
      })),
      createHostContributionContractRegistry(),
    )
    const byExtension = new Map(
      inventory.extensions.map(extension => [
        extension.manifest?.id,
        extension.contributions.map(item => item.manifest?.id),
      ]),
    )
    // the reader stays where it was; the writer and the materializer service live elsewhere
    expect(byExtension.get('models')).toContain('org.modkitx/model-uvm')
    expect(byExtension.get('models')).not.toContain('org.modkitx/uvm-writer')
    expect(byExtension.get('uv-materializer')).toEqual([
      'org.modkitx/uv-model-materializer-contract',
      'org.modkitx/uv-texture-materializer-contract',
      'org.modkitx/uvm-materializer',
      'org.modkitx/uvt-materializer',
      'org.modkitx/uvm-writer',
      'org.modkitx/uvt-writer',
    ])
  })
})
