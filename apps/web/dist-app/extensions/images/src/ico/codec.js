import { createInspectionCodec } from '@modkit/codec-kit'

import { createIconDefinition } from './container.js'

const definition = createIconDefinition({
  id: 'modkit/ico',
  formatId: 'ico',
  label: 'Windows Icon',
  type: 1,
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
