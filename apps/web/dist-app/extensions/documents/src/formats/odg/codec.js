import { createOdfCodec } from '../../odf/inspection.js'

export const abiVersion = 1
export const createCodec = context => createOdfCodec('odg', context)
