import { createSelectedProvider, lease } from '@modkitx-x3/codec-kit/text'
import { createJsonSyntaxProvider } from '../provider.js'
import { profile } from '../profiles/jsonc.js'

export const abiVersion = 1
export const provides = Object.freeze([profile.contract])
export const createTextSyntaxProvider = () => createJsonSyntaxProvider(profile)
export const createProvider = selection =>
  lease(createSelectedProvider(profile, selection, createJsonSyntaxProvider))
