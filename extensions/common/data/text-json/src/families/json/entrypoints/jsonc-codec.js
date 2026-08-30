import { createJsonCodec } from '../codec.js'
import { profile } from '../profiles/jsonc.js'

export const abiVersion = 1
export const createCodec = context => createJsonCodec(profile, context)
