/**
 * Position-tracking XML scanner and parser — `@modkitx/xml/positional`.
 *
 * The package root parses XML into values through fast-xml-parser: the right tool when you want
 * the data. This one keeps every token's offset, recovers from malformed input, and reports
 * diagnostics, which is what a language service needs and what a value-oriented parser throws
 * away. Two parsers in one package on purpose; one subpath each, so a consumer states which
 * question it is asking.
 *
 * It arrived here as `@modkitx/lsp-xml`, whose name said which host it was written for rather than
 * what it does. Nothing in it is LSP-specific, and nothing in it is game-specific.
 */
export {
  XMLNodeKind,
  XMLNode,
  XMLDocument,
  XMLElement,
  type XMLAttr,
  TokenType,
  ScannerState,
  type Scanner,
  DiagnosticCategory,
  type DiagnosticReport,
} from './types.js'

export { CharacterCodes, createScanner, buildLineMap } from './scanner.js'

export { type ParserHooks, parse } from './parser.js'

export { findFirst, binarySearch } from './utils.js'
