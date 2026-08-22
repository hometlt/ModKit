import { createFigmaCodec } from './figma-document.js'

export const abiVersion = 1
export const createCodec = context => createFigmaCodec(context)
