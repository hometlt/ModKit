import { createTextDocumentCodec } from '../csv/text-document.js'

export const abiVersion = 1
export const createCodec = context => createTextDocumentCodec('markdown', context)
