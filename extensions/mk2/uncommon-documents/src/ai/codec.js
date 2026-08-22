import { createPdfDocumentCodec } from '../pdf/pdf-document.js'

export const abiVersion = 1
export const createCodec = context => createPdfDocumentCodec('ai', context)
