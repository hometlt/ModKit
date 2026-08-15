import { parseXml } from '@rgrove/parse-xml'
import {
  createSelectedProvider,
  createTextSyntaxProvider as createRuntimeProvider,
} from '../../shared/provider-runtime.js'
import { encodeText, failure, span } from '../../shared/text.js'
import { definition } from './definition.js'

function xmlNode(node, text) {
  const range = span(text)
  const name = node.name ?? node.target ?? ''
  if (node.type === 'element' || node.children) {
    return {
      kind: 'element',
      qualifiedName: name,
      localName: name.includes(':') ? name.split(':').at(-1) : name,
      attributes: Object.entries(node.attributes ?? {}).map(([key, value]) => ({
        qualifiedName: key,
        localName: key.includes(':') ? key.split(':').at(-1) : key,
        value: String(value),
        range,
      })),
      children: (node.children ?? []).map(child => xmlNode(child, text)).filter(Boolean),
      range,
    }
  }
  if (node.type === 'comment') {
    return { kind: 'comment', value: node.text ?? node.value ?? '', range }
  }
  if (node.type === 'cdata') return { kind: 'cdata', value: node.text ?? node.value ?? '', range }
  if (node.type === 'processing-instruction') {
    return {
      kind: 'processing-instruction',
      target: name,
      value: node.text ?? node.value ?? '',
      range,
    }
  }
  return { kind: 'text', value: node.text ?? node.value ?? String(node), range }
}

function parseXmlDocument(decoded) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(decoded.text)) {
    return failure(
      'org.modkitx/text-data-xml-doctype',
      'DTD and custom entities are forbidden',
      decoded.text,
    )
  }
  try {
    const parsed = parseXml(decoded.text)
    const element = parsed.children?.find(child => child.type === 'element' || child.name)
    if (!element) {
      return failure('org.modkitx/text-data-xml-root', 'XML root element is missing', decoded.text)
    }
    return {
      state: 'ok',
      document: { root: xmlNode(element, decoded.text), source: decoded.source },
      diagnostics: [],
    }
  } catch (error) {
    return failure(
      'org.modkitx/text-data-xml-parse',
      error instanceof Error ? error.message : String(error),
      decoded.text,
    )
  }
}

function createXmlSyntaxProvider() {
  return createRuntimeProvider({
    contract: definition.contract,
    parse: decoded => parseXmlDocument(decoded),
    serialize(request) {
      const root = request.document.root
      const text = root ? `<${root.qualifiedName}></${root.qualifiedName}>\n` : ''
      return encodeText(text, request.document.source, request.target)
    },
  })
}

export const abiVersion = 1
export const createTextSyntaxProvider = createXmlSyntaxProvider
export const createProvider = selection =>
  createSelectedProvider(definition, selection, createXmlSyntaxProvider)
