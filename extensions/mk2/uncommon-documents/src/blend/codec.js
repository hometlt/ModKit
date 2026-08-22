import { createBlendCodec } from './blend-document.js'

export const abiVersion = 1
export const createCodec = context => createBlendCodec(context)
