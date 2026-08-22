import { createOfficePackageCodec } from '../docx/office-package.js'

export const abiVersion = 1
export const createCodec = context => createOfficePackageCodec('ods', context)
