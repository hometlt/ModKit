import { createInspectionCodec } from '@modkitx-x3/codec-kit'

import { createIconDefinition } from '../ico/container.js'

const definition = createIconDefinition({
  id: 'org.modkitx/cur',
  formatId: 'cur',
  label: 'Windows Cursor',
  type: 2,
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
