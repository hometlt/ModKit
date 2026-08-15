/**
 * Format-neutral text-data contracts (BRIEF-13B TD-1).
 *
 * Provider implementations live in external extensions. This subpath intentionally contains
 * only browser-safe types and the open service-contract augmentation.
 */

import type { Diagnostic, SourceSpan } from '@modkitx-x3/core'
import type { Lease, TableDataSource, TreeDataSource } from '../asset-capabilities/data-sources.js'
import type { ResourceBudget, ServiceProviderModule } from '../runtime-abi.js'

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be'
export type NewlineStyle = 'lf' | 'crlf' | 'cr' | 'mixed' | 'none'

export interface TextSourceFacts {
  readonly encoding: Encoding
  readonly bom: boolean
  readonly newline: NewlineStyle
}

export interface TextTrivia {
  readonly kind: 'line-comment' | 'block-comment' | 'whitespace'
  readonly text: string
  readonly range: SourceSpan
}

export type TextScalar =
  | { readonly kind: 'null'; readonly raw: string }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly raw: string }
  | { readonly kind: 'string'; readonly value: string; readonly raw: string }
  | { readonly kind: 'number'; readonly raw: string; readonly finiteValue?: number }
  | { readonly kind: 'integer'; readonly decimal: string; readonly raw: string }
  | { readonly kind: 'date-time'; readonly iso: string; readonly raw: string }

export interface JsonMember {
  readonly key: string
  readonly keyRange: SourceSpan
  readonly value: JsonNode
}

export type JsonNode =
  | { readonly kind: 'object'; readonly members: readonly JsonMember[]; readonly range: SourceSpan }
  | { readonly kind: 'array'; readonly items: readonly JsonNode[]; readonly range: SourceSpan }
  | { readonly kind: 'scalar'; readonly value: TextScalar; readonly range: SourceSpan }

export interface JsonDocument {
  readonly dialect: 'json' | 'jsonc'
  readonly root: JsonNode
  readonly trivia: readonly TextTrivia[]
  readonly source: TextSourceFacts
}

export interface XmlAttribute {
  readonly qualifiedName: string
  readonly localName: string
  readonly prefix?: string
  readonly namespaceUri?: string
  readonly value: string
  readonly range: SourceSpan
}

export type XmlNode =
  | {
      readonly kind: 'element'
      readonly qualifiedName: string
      readonly localName: string
      readonly prefix?: string
      readonly namespaceUri?: string
      readonly attributes: readonly XmlAttribute[]
      readonly children: readonly XmlNode[]
      readonly range: SourceSpan
    }
  | {
      readonly kind: 'text' | 'comment' | 'cdata'
      readonly value: string
      readonly range: SourceSpan
    }
  | {
      readonly kind: 'processing-instruction'
      readonly target: string
      readonly value: string
      readonly range: SourceSpan
    }

export interface XmlDocument {
  readonly declaration?: string
  readonly doctype?: string
  readonly root: Extract<XmlNode, { readonly kind: 'element' }>
  readonly source: TextSourceFacts
}

export interface YamlPair {
  readonly key: YamlNode
  readonly value: YamlNode
}

export type YamlNode =
  | {
      readonly kind: 'mapping'
      readonly pairs: readonly YamlPair[]
      readonly anchor?: string
      readonly tag?: string
      readonly range: SourceSpan
    }
  | {
      readonly kind: 'sequence'
      readonly items: readonly YamlNode[]
      readonly anchor?: string
      readonly tag?: string
      readonly range: SourceSpan
    }
  | {
      readonly kind: 'scalar'
      readonly value: TextScalar
      readonly anchor?: string
      readonly tag?: string
      readonly range: SourceSpan
    }
  | { readonly kind: 'alias'; readonly target: string; readonly range: SourceSpan }

export interface YamlDocument {
  readonly documents: readonly YamlNode[]
  readonly trivia: readonly TextTrivia[]
  readonly source: TextSourceFacts
}

export type TomlValue =
  | { readonly kind: 'scalar'; readonly value: TextScalar; readonly range: SourceSpan }
  | { readonly kind: 'array'; readonly items: readonly TomlValue[]; readonly range: SourceSpan }
  | {
      readonly kind: 'inline-table'
      readonly entries: readonly TomlEntry[]
      readonly range: SourceSpan
    }

export interface TomlEntry {
  readonly path: readonly string[]
  readonly value: TomlValue
  readonly range: SourceSpan
}

export interface TomlDocument {
  readonly entries: readonly TomlEntry[]
  readonly source: TextSourceFacts
}

export interface IniEntry {
  readonly key: string
  readonly value: string
  readonly range: SourceSpan
}

export interface IniSection {
  readonly name: string
  readonly entries: readonly IniEntry[]
  readonly range: SourceSpan
}

export interface IniDocument {
  readonly sections: readonly IniSection[]
  readonly source: TextSourceFacts
}

export interface DelimitedCell {
  readonly value: string
  readonly range: SourceSpan
}

export interface DelimitedRow {
  readonly index: number
  readonly cells: readonly DelimitedCell[]
}

/** Bounded convenience snapshot. The UI model is always a paged TableDataSource. */
export interface DelimitedSnapshot {
  readonly rows: readonly DelimitedRow[]
  readonly header?: readonly string[]
  readonly complete: boolean
  readonly source: TextSourceFacts
}

export interface TextDocumentMap {
  'common.text-data/json-syntax': JsonDocument
  'common.text-data/jsonc-syntax': JsonDocument
  'common.text-data/xml-syntax': XmlDocument
  'common.text-data/yaml-syntax': YamlDocument
  'common.text-data/toml-syntax': TomlDocument
  'common.text-data/ini-syntax': IniDocument
  'common.text-data/csv-syntax': DelimitedSnapshot
  'common.text-data/tsv-syntax': DelimitedSnapshot
}

export type TextDataContractId = keyof TextDocumentMap

export interface TextDataSourceMap {
  'common.text-data/json-syntax': TreeDataSource
  'common.text-data/jsonc-syntax': TreeDataSource
  'common.text-data/xml-syntax': TreeDataSource
  'common.text-data/yaml-syntax': TreeDataSource
  'common.text-data/toml-syntax': TreeDataSource
  'common.text-data/ini-syntax': TreeDataSource
  'common.text-data/csv-syntax': TableDataSource
  'common.text-data/tsv-syntax': TableDataSource
}

export type TextInput =
  | { readonly text: string; readonly bytes?: never; readonly encoding?: never }
  | { readonly bytes: Uint8Array; readonly text?: never; readonly encoding?: Encoding }

export interface ParseRequest {
  readonly input: TextInput
  readonly dialect: string
  readonly budget: ResourceBudget
  readonly signal?: AbortSignal
}

export interface TruncationReport {
  readonly limit: string
}

export type ParseResult<Model> =
  | { readonly state: 'ok'; readonly document: Model; readonly diagnostics: readonly Diagnostic[] }
  | {
      readonly state: 'recovered'
      readonly document: Model
      readonly diagnostics: readonly Diagnostic[]
    }
  | {
      readonly state: 'truncated'
      readonly document: Model
      readonly truncated: TruncationReport
      readonly diagnostics: readonly Diagnostic[]
    }
  | { readonly state: 'failed'; readonly diagnostics: readonly Diagnostic[] }

export interface SerializeResult {
  readonly bytes: Uint8Array
  readonly encoding: Encoding
  readonly bom: boolean
  readonly newline: NewlineStyle
  readonly diagnostics: readonly Diagnostic[]
}

export interface SerializeRequest<Contract extends TextDataContractId> {
  readonly document: TextDocumentMap[Contract]
  readonly dialect: string
  readonly target?: Partial<TextSourceFacts>
  readonly budget: ResourceBudget
  readonly signal?: AbortSignal
}

export interface DataSourceRequest {
  readonly input: TextInput
  readonly dialect: string
  readonly budget: ResourceBudget
  readonly signal?: AbortSignal
}

export interface TextSyntaxProvider<Contract extends TextDataContractId> {
  readonly contract: Contract
  parse(request: ParseRequest): Promise<ParseResult<TextDocumentMap[Contract]>>
  serialize(request: SerializeRequest<Contract>): Promise<SerializeResult>
  dataSource(request: DataSourceRequest): Promise<Lease<TextDataSourceMap[Contract]>>
}

export type TextSyntaxProviderModule<Contract extends TextDataContractId> = ServiceProviderModule<
  Contract,
  1
>

declare module '../service-contracts.js' {
  interface ContractMap {
    'common.text-data/json-syntax': { 1: TextSyntaxProvider<'common.text-data/json-syntax'> }
    'common.text-data/jsonc-syntax': { 1: TextSyntaxProvider<'common.text-data/jsonc-syntax'> }
    'common.text-data/xml-syntax': { 1: TextSyntaxProvider<'common.text-data/xml-syntax'> }
    'common.text-data/yaml-syntax': { 1: TextSyntaxProvider<'common.text-data/yaml-syntax'> }
    'common.text-data/toml-syntax': { 1: TextSyntaxProvider<'common.text-data/toml-syntax'> }
    'common.text-data/ini-syntax': { 1: TextSyntaxProvider<'common.text-data/ini-syntax'> }
    'common.text-data/csv-syntax': { 1: TextSyntaxProvider<'common.text-data/csv-syntax'> }
    'common.text-data/tsv-syntax': { 1: TextSyntaxProvider<'common.text-data/tsv-syntax'> }
  }

  interface ContractRequestMap {
    'common.text-data/json-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/jsonc-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/xml-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/yaml-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/toml-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/ini-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/csv-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/tsv-syntax': { 1: { presence: 'forbidden' } }
  }

  interface ContractOfferMap {
    'common.text-data/json-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/jsonc-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/xml-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/yaml-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/toml-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/ini-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/csv-syntax': { 1: { presence: 'forbidden' } }
    'common.text-data/tsv-syntax': { 1: { presence: 'forbidden' } }
  }
}
