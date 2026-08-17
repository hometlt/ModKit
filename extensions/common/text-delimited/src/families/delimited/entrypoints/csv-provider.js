import { createSelectedProvider } from '@modkitx-x3/codec-kit/text'
import { createDelimitedSyntaxProvider } from '../provider.js'
import { profile } from '../profiles/csv.js'

export const abiVersion = 1
export const createTextSyntaxProvider = () => createDelimitedSyntaxProvider(profile)
export const createProvider = selection =>
  createSelectedProvider(profile, selection, createDelimitedSyntaxProvider)
