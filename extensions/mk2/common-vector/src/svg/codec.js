// Hand-ported from the MK2 codec org.modkitx/svg (OPUS-MK2-01 task C pilot).
//
// The v1 manifest declared no magic, so detection reads structure: the first element of the
// document must be `<svg`. The published vector scene carries the `uvg.secure-static.v1`
// profile, and that claim is only true after the conservative pass below removes scripting,
// event handlers and external references — the same posture the v1 codec documented.
//
// SVGZ (gzip) is matched by the v1 extension rule but is not inflated here; it is reported as
// an unsupported feature rather than silently mis-parsed.

import {
  createInspectionCodec,
  createTreeDataSource,
  createVectorSceneSource,
} from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/svg'
const utf8 = new TextDecoder('utf-8')

function isGzip(bytes) {
  return bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/** Strips a BOM, XML declarations, doctypes, comments and processing instructions. */
function firstElement(text) {
  let rest = text.replace(/^﻿/u, '')
  for (;;) {
    const trimmed = rest.replace(/^\s+/u, '')
    if (trimmed.startsWith('<?')) {
      const end = trimmed.indexOf('?>')
      if (end === -1) return undefined
      rest = trimmed.slice(end + 2)
      continue
    }
    if (trimmed.startsWith('<!--')) {
      const end = trimmed.indexOf('-->')
      if (end === -1) return undefined
      rest = trimmed.slice(end + 3)
      continue
    }
    if (trimmed.startsWith('<!')) {
      const end = trimmed.indexOf('>')
      if (end === -1) return undefined
      rest = trimmed.slice(end + 1)
      continue
    }
    return trimmed.startsWith('<') ? trimmed : undefined
  }
}

function rootTag(text) {
  const element = firstElement(text)
  if (element === undefined) return undefined
  const match = /^<\s*(?:[A-Za-z_][\w.-]*:)?svg\b([^>]*)>/u.exec(element)
  return match === null ? undefined : (match[1] ?? '')
}

function attribute(attributes, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, 'u').exec(
    attributes,
  )
  return match === null ? undefined : (match[1] ?? match[2])
}

function length(value) {
  if (value === undefined) return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function viewBox(value) {
  if (value === undefined) return undefined
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .map(Number)
  return parts.length === 4 && parts.every(Number.isFinite)
    ? [parts[0], parts[1], parts[2], parts[3]]
    : undefined
}

const countTags = (text, name) =>
  (text.match(new RegExp(`<\\s*(?:[A-Za-z_][\\w.-]*:)?${name}\\b`, 'gu')) ?? []).length

/**
 * Conservative static profile: no scripts, no event handlers, no external references. It is a
 * reduction, not a full SVG security policy — anything it cannot prove safe is dropped.
 */
function toStaticProfile(text) {
  const removed = []
  let out = text
  const drop = (pattern, label) => {
    const before = out
    out = out.replace(pattern, '')
    if (out !== before) removed.push(label)
  }
  drop(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/giu, 'script')
  drop(/<\s*script\b[^>]*\/\s*>/giu, 'script')
  drop(/<\s*foreignObject\b[\s\S]*?<\s*\/\s*foreignObject\s*>/giu, 'foreignObject')
  drop(/\son[a-z]+\s*=\s*"[^"]*"/giu, 'event-handler')
  drop(/\son[a-z]+\s*=\s*'[^']*'/giu, 'event-handler')
  drop(/\s(?:xlink:)?href\s*=\s*"(?!#|data:image\/)[^"]*"/giu, 'external-reference')
  drop(/\s(?:xlink:)?href\s*=\s*'(?!#|data:image\/)[^']*'/giu, 'external-reference')
  return { text: out, removed: [...new Set(removed)].sort() }
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'svg',
    label: 'Scalable Vector Graphics',
    mediaType: 'image/svg+xml',
  }),
  async detect(prefix) {
    if (isGzip(prefix)) return { confidence: 0, kind: 'magic', note: 'svgz-needs-inflate' }
    const attributes = rootTag(utf8.decode(prefix))
    if (attributes === undefined) return { confidence: 0, kind: 'structure', note: 'no-svg-root' }
    const namespaced = attributes.includes('http://www.w3.org/2000/svg')
    return {
      confidence: namespaced ? 0.95 : 0.75,
      kind: 'structure',
      note: namespaced ? 'svg-root-namespaced' : 'svg-root',
    }
  },
  async inspect(bytes, context) {
    if (isGzip(bytes)) throw new TypeError('SVGZ needs an inflate pass this port does not carry')
    if (bytes.byteLength > context.budget.maxScalarBytes) {
      throw new RangeError('SVG document exceeds the maxScalarBytes budget')
    }
    const text = utf8.decode(bytes)
    const attributes = rootTag(text)
    if (attributes === undefined) throw new TypeError('SVG root element is missing')
    const box = viewBox(attribute(attributes, 'viewBox'))
    const paths = countTags(text, 'path')
    const shapes =
      countTags(text, 'rect') +
      countTags(text, 'circle') +
      countTags(text, 'ellipse') +
      countTags(text, 'line') +
      countTags(text, 'polyline') +
      countTags(text, 'polygon')
    const textNodes = countTags(text, 'text')
    const gradients = countTags(text, 'linearGradient') + countTags(text, 'radialGradient')
    const groups = countTags(text, 'g')
    const nodes = paths + shapes + textNodes + gradients + groups + 1
    const sanitized = toStaticProfile(text)
    const scene = createVectorSceneSource(
      {
        ...(length(attribute(attributes, 'width')) === undefined
          ? {}
          : { width: length(attribute(attributes, 'width')) }),
        ...(length(attribute(attributes, 'height')) === undefined
          ? {}
          : { height: length(attribute(attributes, 'height')) }),
        ...(box === undefined ? {} : { viewBox: box }),
        nodes,
        paths,
        shapes,
        textNodes,
        gradients,
      },
      sanitized.text,
    )
    const tree = createTreeDataSource({
      kind: 'vector',
      label: 'SVG',
      preview: box === undefined ? `${nodes} node(s)` : `viewBox ${box.join(' ')}`,
      children: [
        { kind: 'shapes', label: 'paths', preview: String(paths) },
        { kind: 'shapes', label: 'basic shapes', preview: String(shapes) },
        { kind: 'text', label: 'text nodes', preview: String(textNodes) },
        { kind: 'paint', label: 'gradients', preview: String(gradients) },
        { kind: 'group', label: 'groups', preview: String(groups) },
      ],
    })
    return {
      summary: {
        format: 'svg',
        nodes,
        paths,
        shapes,
        textNodes,
        gradients,
        sanitizedAway: sanitized.removed,
      },
      metadata: [
        {
          id: 'svg-document',
          label: 'SVG document',
          entries: [
            { key: 'width', value: attribute(attributes, 'width') ?? '' },
            { key: 'height', value: attribute(attributes, 'height') ?? '' },
            { key: 'viewBox', value: box === undefined ? '' : box.join(' ') },
            { key: 'paths', value: paths },
            { key: 'shapes', value: shapes },
            { key: 'textNodes', value: textNodes },
            { key: 'gradients', value: gradients },
            { key: 'sanitizedAway', value: sanitized.removed.join(', ') },
          ],
        },
      ],
      traits: [
        { id: 'vector.scene', parameters: { nodes } },
        ...(paths > 0 ? [{ id: 'vector.paths', parameters: { count: paths } }] : []),
        ...(shapes > 0 ? [{ id: 'vector.shapes', parameters: { count: shapes } }] : []),
        ...(textNodes > 0 ? [{ id: 'vector.text', parameters: { count: textNodes } }] : []),
        ...(gradients > 0 ? [{ id: 'vector.gradients', parameters: { count: gradients } }] : []),
        { id: 'structure.hierarchy', parameters: { groups } },
        { id: 'content.text', parameters: { bytes: String(bytes.byteLength) } },
      ],
      // No `text: true`: the generated spec declares vector/tree/byte-range only, and a session
      // that leases more than its manifest promises is the same drift in the other direction.
      dataSources: {
        'common.view/tree-data-source': tree,
        'common.view/vector-scene-source': scene,
      },
      unsupportedFeatures: ['svgz-inflate', 'rasterization', 'css-cascade-resolution'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
