import { describe, expect, it, vi } from 'vitest'
import { createTableViewer } from '@modkit/ui/table'
import { createVsCodePreviewStages } from '../src/stages.js'
import { createVscodeLocalizer } from '../src/localization.js'

vi.mock('@modkit/ui/table', () => ({ createTableViewer: vi.fn(() => ({ mount: vi.fn() })) }))

describe('VS Code localization stage write integration', () => {
  it('lends host-authorized ports without hiding the read-only viewer and reopens after commit', async () => {
    const reopen = vi.fn(async () => true)
    const stages = createVsCodePreviewStages({
      localizer: createVscodeLocalizer('en'),
      portsFor: () => undefined,
      reopen,
      lastOutcome: () => undefined,
      recordOutcome: () => undefined,
    })
    const stage = stages.find(item => item.id === 'localization')
    expect(stage?.usesEditorPorts).toBe(true)
    expect(stage?.editable).not.toBe(true)
    const options = vi
      .mocked(createTableViewer)
      .mock.calls.find(([value]) => value?.onCommitted !== undefined)?.[0]
    expect(options?.onCommitted).toBeTypeOf('function')
    const descriptor = { id: 'fixture-localization' }
    expect(await options?.onCommitted?.(descriptor as never)).toBe(true)
    expect(reopen).toHaveBeenCalledWith(descriptor)
    reopen.mockResolvedValueOnce(false)
    expect(await options?.onCommitted?.(descriptor as never)).toBe(false)
  })
})
