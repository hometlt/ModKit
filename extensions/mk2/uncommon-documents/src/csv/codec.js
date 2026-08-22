import { createTextDocumentCodec } from './text-document.js'

export const abiVersion = 1
export const createCodec = context => createTextDocumentCodec('csv', context)
