import { createCdrCodec } from './cdr-document.js'

export const abiVersion = 1
export const createCodec = context => createCdrCodec(context)
