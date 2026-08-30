import { lease } from '../../../../runtime/basic.js'
import { createSelectedProvider } from '../../../../runtime/text.js'
import { createJsonSyntaxProvider } from '../provider.js'
import { profile } from '../profiles/json.js'

export const abiVersion = 1
export const provides = Object.freeze([profile.contract])
export const createTextSyntaxProvider = () => createJsonSyntaxProvider(profile)
export const createProvider = selection =>
  lease(createSelectedProvider(profile, selection, createJsonSyntaxProvider))
