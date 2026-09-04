export { parseCatalogXml } from './parser.js'
export { lineStartOffsets, positionAt, commentSpans, insideComment } from './text-position.js'
export type { TextPosition, Span } from './text-position.js'
export {
  parseSc2Ini,
  parseSc2Strings,
  parseSc2ComponentList,
  parseComponentList,
} from './formats.js'
export type { ComponentEntry, ComponentListResult } from './formats.js'
export {
  parseSc2StringsOrdered,
  serializeStringModel,
  effectiveValue,
  setStringValue,
  renameStringKey,
  addStringEntry,
} from './formats.js'
export type { StringLine, StringFileModel } from './formats.js'
export type {
  RawCatalogEntry,
  RawValue,
  RawObject,
  RawArray,
  RawFields,
  ParsedCatalogFile,
  EntrySource,
  Sc2XmlParseOptions,
  TokenDecl,
} from './types.js'
