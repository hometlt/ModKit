import { createUiLocalizer } from '@modkit/ui/localization'
import { describe, expect, it, vi } from 'vitest'

const catalog = vi.hoisted(() => {
  const editor = Object.freeze({ mount: vi.fn() })
  return {
    editor,
    editable: Object.freeze([
      Object.freeze({
        id: 'code',
        label: 'Code',
        contract: 'common.view/text-data-source',
        module: editor,
        editable: true,
      }),
    ]),
    readonly: Object.freeze([
      Object.freeze({
        id: 'code',
        label: 'Code',
        contract: 'common.view/text-data-source',
        module: editor,
      }),
    ]),
  }
})

vi.mock('../generated/viewer-catalog.js', () => ({
  PREVIEW_STAGES: catalog.editable,
  PREVIEW_STAGES_READONLY: catalog.readonly,
  createPreviewStages: () => catalog.editable,
  createPreviewStagesReadonly: () => catalog.readonly,
}))

import { createElectronReadOnlyStages } from '../src/stages.js'

describe('localized Electron read-only stages', () => {
  it('drops an editor when the generated read-only catalog reuses the same module', () => {
    const stages = createElectronReadOnlyStages({
      localizer: createUiLocalizer('ru'),
      operationsFor: async () => undefined,
    })

    expect(stages.map(stage => stage.id)).toEqual(['archive'])
  })
})
