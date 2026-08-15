import { createDelimitedSyntaxProvider } from '../../families/delimited/provider.js'
import { createSelectedProvider } from '../../shared/provider-runtime.js'
import { definition } from './definition.js'

export const abiVersion = 1
export const createTextSyntaxProvider = () => createDelimitedSyntaxProvider(definition)
export const createProvider = selection =>
  createSelectedProvider(definition, selection, createDelimitedSyntaxProvider)
