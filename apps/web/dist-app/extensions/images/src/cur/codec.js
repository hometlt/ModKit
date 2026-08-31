import { createInspectionCodec } from '@modkit/codec-kit'

import { createIconDefinition } from '../ico/container.js'

const definition = createIconDefinition({
  id: 'modkit/cur',
  formatId: 'cur',
  label: 'Windows Cursor',
  type: 2,
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
