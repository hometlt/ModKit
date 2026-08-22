import { createOfficePackageCodec } from './office-package.js'

export const abiVersion = 1
export const createCodec = context => createOfficePackageCodec('docx', context)
