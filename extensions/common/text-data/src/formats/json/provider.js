import { createJsonSyntaxProvider } from '../../families/json/provider.js'
import { createSelectedProvider } from '../../shared/provider-runtime.js'
import { definition } from './definition.js'

export const abiVersion = 1
export const createTextSyntaxProvider = () => createJsonSyntaxProvider(definition)
export const createProvider = selection =>
  createSelectedProvider(definition, selection, createJsonSyntaxProvider)
