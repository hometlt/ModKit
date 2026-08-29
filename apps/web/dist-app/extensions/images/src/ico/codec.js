import { createInspectionCodec } from '@modkitx-x3/codec-kit'

import { createIconDefinition } from './container.js'

const definition = createIconDefinition({
  id: 'org.modkitx/ico',
  formatId: 'ico',
  label: 'Windows Icon',
  type: 1,
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
