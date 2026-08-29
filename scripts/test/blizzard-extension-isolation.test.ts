import { join, resolve } from 'node:path'

import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { buildInventory, createHostContributionContractRegistry } from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const modelsRoot = join(repoRoot, '..', 'modkit-blizzard', 'models')

describe('Blizzard extension domain isolation', () => {
  it('a models-only consumer carries M3/M3A without replay or trigger code', async () => {
    const input = await loadExtensionDirectory(modelsRoot)
    const inventory = await buildInventory(
      [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
      createHostContributionContractRegistry(),
    )
    expect(inventory.extensions).toHaveLength(1)
    expect(inventory.extensions[0]?.manifest).toMatchObject({
      publisher: 'org.modkitx.blizzard',
      id: 'models',
    })
    expect(inventory.extensions[0]?.contributions.map(item => item.manifest?.id)).toEqual([
      'org.modkitx/m3',
      'org.modkitx.blizzard/m3-preserving-writer',
    ])

    const result = await build({
      absWorkingDir: repoRoot,
      entryPoints: [join(modelsRoot, 'src', 'm3', 'codec.js')],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      packages: 'external',
      metafile: true,
      write: false,
      logLevel: 'silent',
    })
    const inputs = Object.keys(result.metafile?.inputs ?? {})
    const externalPrefix = '../modkit-blizzard/models/src/m3/'
    expect(inputs.some(path => /sc2-replay|sc2-triggers/u.test(path))).toBe(false)
    expect(inputs).toContain(`${externalPrefix}codec.js`)
    expect(inputs).toContain(`${externalPrefix}geometry.node.js`)
    expect(inputs.every(path => path.startsWith(externalPrefix))).toBe(true)
  })
})
