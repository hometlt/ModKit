import { describe, expect, it } from 'vitest'

import { MODEL_FACET_CONTRACTS } from '@modkit/ui/model'

import { createVscodeLocalizer } from '../src/localization.js'
import { createVsCodePreviewStages } from '../src/stages.js'

describe('VS Code preview stages', () => {
  it("binds a model's facets to the model stage, as the web shell does", () => {
    const stages = createVsCodePreviewStages({
      localizer: createVscodeLocalizer('en'),
      portsFor: () => undefined,
      reopen: async () => true,
      lastOutcome: () => undefined,
      recordOutcome: () => undefined,
    })
    const model = stages.find(stage => stage.id === 'model')
    // without them the viewer shows the mesh and nothing of its materials, bones or animations
    expect(model?.optionalContracts).toEqual(expect.arrayContaining([...MODEL_FACET_CONTRACTS]))
  })

  it('opens the card on the subject of its selector a navigation named (5.29)', async () => {
    const asked: string[] = []
    const stages = createVsCodePreviewStages({
      localizer: createVscodeLocalizer('en'),
      portsFor: () => undefined,
      reopen: async () => true,
      lastOutcome: () => undefined,
      recordOutcome: () => undefined,
      cardSubject: () => {
        asked.push('mount')
        return 'modkit-subject://blizzard%2Fsc2-data/Unit/Marine'
      },
    })
    const card = stages.find(stage => stage.id === 'card')
    // the viewer itself needs a page; the stage asks for the named subject each time it mounts
    await card?.module.mount({} as never).catch(() => undefined)
    await card?.module.mount({} as never).catch(() => undefined)
    expect(asked).toEqual(['mount', 'mount'])
  })
})
