import { createTextCodec } from './factory.js'
export const abiVersion = 1
export const createCodec = context => createTextCodec('json', context)
