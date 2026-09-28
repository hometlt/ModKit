import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createNodeInstallationFiles } from '../src/node/installation-files.js'

const root = await mkdtemp(join(tmpdir(), 'modkit-installation-files-'))
afterAll(() => rm(root, { recursive: true, force: true }))

describe("a game installation's files", () => {
  it('are read by path under the root, a range at a time, and nowhere else', async () => {
    const install = join(root, 'Diablo III')
    await mkdir(join(install, 'x64'), { recursive: true })
    await writeFile(join(install, 'x64', 'Diablo III64.exe'), 'MZ....PE registry of SNO types')
    await writeFile(join(root, 'secret.txt'), 'outside')
    const files = createNodeInstallationFiles({
      installationOf: gameId => (gameId === 'blizzard/diablo-3' ? install : undefined),
    })
    const request = { gameId: 'blizzard/diablo-3', path: 'x64/Diablo III64.exe' }
    expect(await files.size(request)).toBe(30)
    const bytes = await files.read({ ...request, offset: 6, length: 100 })
    expect(new TextDecoder().decode(bytes)).toBe('PE registry of SNO types')
    expect(bytes.byteOffset).toBe(0)
    expect(await files.size({ gameId: 'blizzard/starcraft-2', path: 'x64/Diablo III64.exe' })).toBe(
      undefined,
    )
    expect(await files.size({ ...request, path: 'x64/missing.exe' })).toBe(undefined)
    await expect(files.size({ ...request, path: '../secret.txt' })).rejects.toThrow(
      /under the root/u,
    )
    await expect(files.read({ ...request, offset: 0, length: 65 * 1024 * 1024 })).rejects.toThrow(
      /bytes/u,
    )
  })
})
