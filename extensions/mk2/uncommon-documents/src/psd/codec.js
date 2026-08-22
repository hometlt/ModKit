import { createPsdCodec } from './psd-document.js'

export const abiVersion = 1
export const createCodec = context => createPsdCodec(context)
