import { diagnostic, uint64 } from '@modkitx-x3/core'

function textOf(input) {
  return typeof input.text === 'string'
    ? input.text
    : new TextDecoder(input.encoding ?? 'utf-8', { fatal: true }).decode(input.bytes)
}

function sourceFacts() {
  return { encoding: 'utf-8', bom: false, newline: 'none' }
}

function xmlDocument(text) {
  const match = /^\s*<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>([\s\S]*)<\/\1>\s*$/u.exec(text)
  if (!match) return undefined
  const range = {
    byteOffset: uint64(0n),
    byteLength: uint64(BigInt(new TextEncoder().encode(text).byteLength)),
    utf16Offset: 0,
    utf16Length: text.length,
    line: 0,
    column: 0,
  }
  return {
    root: {
      kind: 'element',
      qualifiedName: match[1],
      localName: match[1].split(':').at(-1),
      attributes: [],
      children: match[2] ? [{ kind: 'text', value: match[2], range }] : [],
      range,
    },
    source: sourceFacts(),
  }
}

export function createProvider(selection) {
  if (selection.contract !== 'common.text-data/xml-syntax') {
    throw new TypeError(`unsupported contract: ${selection.contract}`)
  }
  return Object.freeze({
    contract: selection.contract,
    async parse(request) {
      const text = textOf(request.input)
      const document = xmlDocument(text)
      return document
        ? { state: 'ok', document, diagnostics: [] }
        : {
            state: 'failed',
            diagnostics: [
              diagnostic(
                'error',
                'org.example/alternate-xml-invalid',
                'alternate XML parser rejected the document',
              ),
            ],
          }
    },
    async serialize(request) {
      const name = request.document.root.qualifiedName
      const bytes = new TextEncoder().encode(`<${name}></${name}>`)
      return {
        bytes,
        encoding: 'utf-8',
        bom: false,
        newline: 'none',
        diagnostics: [],
      }
    },
    async dataSource(request) {
      const result = await this.parse(request)
      if (result.state === 'failed') throw new TypeError('invalid XML')
      const root = { id: 'root', hasChildren: false }
      return {
        value: {
          async root() {
            return root
          },
          async children() {
            return { items: [] }
          },
          async facts() {
            return { kind: 'element', label: result.document.root.qualifiedName }
          },
          async *search(query) {
            if ('root'.includes(query.pattern)) yield root
          },
        },
        async release() {
          return undefined
        },
      }
    },
  })
}

export const abiVersion = 1
