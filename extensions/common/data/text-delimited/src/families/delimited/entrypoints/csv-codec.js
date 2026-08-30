import { createDelimitedCodec } from '../codec.js'
import { profile } from '../profiles/csv.js'

export const abiVersion = 1
export const createCodec = context => createDelimitedCodec(profile, context)
