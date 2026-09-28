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
})
