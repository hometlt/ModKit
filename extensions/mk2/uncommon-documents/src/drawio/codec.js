import { createDrawioCodec } from './drawio-document.js'

export const abiVersion = 1
export const createCodec = context => createDrawioCodec(context)
