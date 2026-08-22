import { createSmpCodec } from './smp-document.js'

export const abiVersion = 1
export const createCodec = context => createSmpCodec(context)
