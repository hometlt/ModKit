import { createDelimitedCodec } from '../codec.js'
import { profile } from '../profiles/tsv.js'

export const abiVersion = 1
export const createCodec = context => createDelimitedCodec(profile, context)
