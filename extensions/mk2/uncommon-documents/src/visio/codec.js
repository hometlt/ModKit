import { createVisioCodec } from './visio-document.js'

export const abiVersion = 1
export const createCodec = context => createVisioCodec(context)
