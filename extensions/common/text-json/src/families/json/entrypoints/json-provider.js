import { createSelectedProvider } from '@modkitx-x3/codec-kit/text'
import { createJsonSyntaxProvider } from '../provider.js'
import { profile } from '../profiles/json.js'

export const abiVersion = 1
export const createTextSyntaxProvider = () => createJsonSyntaxProvider(profile)
export const createProvider = selection =>
  createSelectedProvider(profile, selection, createJsonSyntaxProvider)
