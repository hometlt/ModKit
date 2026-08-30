import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const testDirectory = import.meta.dirname
const guardFile = 'sc2-real-corpus.test.ts'

describe('StarCraft II real-corpus source boundaries', () => {
  it('requires provider resolution and CASC/VFS access in every SC2 product-path test', async () => {
    const files = (await readdir(testDirectory))
      .filter(name => /^sc2-.*\.test\.ts$/u.test(name) && name !== guardFile)
      .sort()
    expect(files).not.toHaveLength(0)

    for (const file of files) {
      const source = await readFile(join(testDirectory, file), 'utf8')
      expect(source, `${file} directly imports a StarCraft II provider implementation`).not.toMatch(
        /starcraft2[\s\S]{0,160}src[\s\S]{0,160}game[\s\S]{0,160}(?:workspace-provider|data-provider|map-provider|provider)\.js/u,
      )
      expect(source, `${file} reads an unpacked installation Maps child`).not.toMatch(
        /['"]Maps(?:\/|['"])/u,
      )
      expect(source, `${file} labels unpacked installation content as evidence`).not.toMatch(
        /unpacked installed map/iu,
      )
      expect(
        source,
        `${file} routes SC2 evidence through the legacy acceptance helper`,
      ).not.toMatch(/runMk2Acceptance/u)
    }
  })
})
