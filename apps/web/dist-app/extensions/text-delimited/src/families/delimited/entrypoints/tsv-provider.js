import { createSelectedProvider, lease } from '@modkitx-x3/codec-kit/text'
import { createDelimitedSyntaxProvider } from '../provider.js'
import { profile } from '../profiles/tsv.js'

export const abiVersion = 1
export const provides = Object.freeze([profile.contract])
export const createTextSyntaxProvider = () => createDelimitedSyntaxProvider(profile)
export const createProvider = selection =>
  lease(createSelectedProvider(profile, selection, createDelimitedSyntaxProvider))
