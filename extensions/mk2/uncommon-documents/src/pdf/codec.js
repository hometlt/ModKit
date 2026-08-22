import { createPdfDocumentCodec } from './pdf-document.js'

export const abiVersion = 1
export const createCodec = context => createPdfDocumentCodec('pdf', context)
