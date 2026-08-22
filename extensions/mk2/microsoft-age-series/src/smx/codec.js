import { createSmxCodec } from './smx-document.js'

export const abiVersion = 1
export const createCodec = context => createSmxCodec(context)
