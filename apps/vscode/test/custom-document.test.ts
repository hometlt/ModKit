import { describe, expect, it, vi } from 'vitest'

import { CustomDocumentState } from '../src/custom-document.js'

describe('native custom document state', () => {
  it('fires one dirty transition and delegates save/revert to the resolved webview', async () => {
    const saveDocument = vi.fn(async () => undefined)
    const revertDocument = vi.fn(async () => undefined)
    const session = {
      saveDocument,
      revertDocument,
      undoDocument: vi.fn(async () => undefined),
      redoDocument: vi.fn(async () => undefined),
    }
    const document = new CustomDocumentState('C:\\workspace\\asset.bin')
    document.attach(session)

    expect(document.markDirty(true)).toBe('became-dirty')
    expect(document.markDirty(true)).toBe('unchanged')
    expect(document.isDirty).toBe(true)
    await document.save()
    expect(saveDocument).toHaveBeenCalledWith('C:\\workspace\\asset.bin')
    expect(document.isDirty).toBe(false)

    document.markDirty(true)
    await document.revert()
    expect(revertDocument).toHaveBeenCalledWith('C:\\workspace\\asset.bin')
    expect(document.isDirty).toBe(false)
  })

  it('refuses lifecycle calls before resolution and after its session detaches', async () => {
    const document = new CustomDocumentState('/workspace/asset.bin')
    await expect(document.save()).rejects.toThrow('no resolved webview')
    const session = {
      saveDocument: async () => undefined,
      revertDocument: async () => undefined,
      undoDocument: async () => undefined,
      redoDocument: async () => undefined,
    }
    document.attach(session)
    document.detach(session)
    await expect(document.revert()).rejects.toThrow('no resolved webview')
  })
})
