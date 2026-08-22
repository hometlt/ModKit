import { createSlpCodec } from './slp-document.js'

export const abiVersion = 1
export const createCodec = context => createSlpCodec(context)
