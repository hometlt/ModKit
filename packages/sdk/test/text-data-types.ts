import type { SourceSpan } from '@modkitx-x3/core'
import type { ResourceBudget } from '@modkitx-x3/sdk'
import type { ContractOf, TypedResolveRequest } from '@modkitx-x3/sdk/service-contracts'
import type {
  JsonDocument,
  ParseRequest,
  SerializeRequest,
  TextDataSourceMap,
  TextSyntaxProvider,
  XmlDocument,
} from '@modkitx-x3/sdk/text-data'

declare const span: SourceSpan
declare const budget: ResourceBudget

export const jsonDocument: JsonDocument = {
  dialect: 'json',
  root: {
    kind: 'scalar',
    value: { kind: 'integer', decimal: '9007199254740993', raw: '9007199254740993' },
    range: span,
  },
  trivia: [],
  source: { encoding: 'utf-8', bom: false, newline: 'none' },
}

export const jsonRequest: ParseRequest = {
  input: { text: '1' },
  dialect: 'json',
  budget,
}

export const jsonSerialize: SerializeRequest<'common.text-data/json-syntax'> = {
  document: jsonDocument,
  dialect: 'json',
  budget,
}

export const resolverRequest: TypedResolveRequest<'common.text-data/json-syntax', 1> = {
  contract: 'common.text-data/json-syntax',
  major: 1,
}

export type JsonHandle = ContractOf<'common.text-data/json-syntax', 1>
export type JsonTree = TextDataSourceMap['common.text-data/json-syntax']
export type JsonProvider = TextSyntaxProvider<'common.text-data/json-syntax'>

declare const xmlDocument: XmlDocument

export const wrongSerializer: SerializeRequest<'common.text-data/json-syntax'> = {
  // @ts-expect-error Contract-specific serializer cannot accept an XML document.
  document: xmlDocument,
  dialect: 'json',
  budget,
}

// @ts-expect-error Parse always requires an explicit resource budget.
export const missingBudget: ParseRequest = { input: { text: '{}' }, dialect: 'json' }

export const forbiddenFacet: TypedResolveRequest<'common.text-data/json-syntax', 1> = {
  contract: 'common.text-data/json-syntax',
  major: 1,
  // @ts-expect-error Resolver facet is forbidden for all v1 text syntax contracts.
  facet: { dialect: 'json' },
}
