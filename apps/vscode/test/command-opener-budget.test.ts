import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createVsCodeCommandOpener, VSCODE_MODEL_THUMBNAIL_OPEN_BUDGET } from '../src/host.js'
import { containerUriText } from '../src/container-uri.js'

it('passes an explicit budget through path, content-source and container command routes', async () => {
  const directory = await mkdtemp('C:/MKTEMP/vscode-gallery-budget-')
  const file = join(directory, 'model.prefab')
  await writeFile(file, new Uint8Array([1, 2, 3]))
  const open = vi.fn(async () => ({ state: 'unresolved', reason: 'no-codec', diagnostics: [] }))
  const containerOpen = vi.fn(async () => ({ snapshot: { state: 'unresolved' } }))
  const options = {
    services: { open, inventory: { extensions: [] } } as never,
    roots: () => [directory],
    containers: { open: containerOpen } as never,
    readContentSource: async () => new Uint8Array([1, 2, 3]),
  }
  try {
    const opener = createVsCodeCommandOpener({
      ...options,
      budget: VSCODE_MODEL_THUMBNAIL_OPEN_BUDGET,
    })
    await opener(file)
    await opener('modkit-source://test/game/model.prefab')
    const member = containerUriText(join(directory, 'archive.zip'), 'model.prefab')
    await opener(member)
    expect(open).toHaveBeenCalledTimes(2)
    for (const call of open.mock.calls)
      expect((call as unknown as [{ budget: unknown }])[0].budget).toBe(
        VSCODE_MODEL_THUMBNAIL_OPEN_BUDGET,
      )
    expect(containerOpen).toHaveBeenCalledWith(
      member,
      undefined,
      VSCODE_MODEL_THUMBNAIL_OPEN_BUDGET,
    )
    const ordinary = createVsCodeCommandOpener(options)
    await ordinary('modkit-source://test/game/ordinary.txt')
    expect(
      (open.mock.calls[2] as unknown as [{ budget: { maxNodes: number } }])[0].budget.maxNodes,
    ).toBe(1_000_000)
    await ordinary(member)
    expect(containerOpen).toHaveBeenLastCalledWith(member, undefined, undefined)
    await expect(opener(join(directory, '..', 'outside.prefab'))).rejects.toThrow('outside')
  } finally {
    await unlink(file)
    await rmdir(directory)
  }
})
