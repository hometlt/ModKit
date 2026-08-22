import { createSldCodec } from './sld-document.js'

export const abiVersion = 1
export const createCodec = context => createSldCodec(context)
