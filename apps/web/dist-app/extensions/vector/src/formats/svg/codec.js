import {
  createInspectionCodec,
  createTreeDataSource,
  createVectorSceneSource,
} from '@modkitx-x3/codec-kit'

const decoder = new TextDecoder('utf-8', { fatal: true })

function looksLikeSvg(bytes) {
  let text
  try {
    text = decoder
      .decode(bytes)
      .replace(/^\uFEFF/u, '')
      .trimStart()
      .toLowerCase()
  } catch {
    return false
  }
  return text.startsWith('<svg') || (text.startsWith('<?xml') && /<svg(?:\s|>)/u.test(text))
}

function attributes(source) {
  const result = {}
  const expression = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu
  for (const match of source.matchAll(expression)) result[match[1]] = match[2] ?? match[3] ?? ''
  return result
}

function parseSvg(text, maxNodes, maxDepth) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(text)) throw new TypeError('SVG DTDs and entities are forbidden')
  const root = { kind: 'document', label: 'SVG', children: [] }
  const stack = [root]
  const counts = new Map()
  let nodes = 0
  let rootAttributes
  const expression = /<\/?([A-Za-z_][A-Za-z0-9_.:-]*)([^<>]*?)(\/?)>/gu
  for (const match of text.matchAll(expression)) {
    const full = match[0]
    const name = match[1].toLowerCase()
    const closing = full.startsWith('</')
    if (closing) {
      if (stack.length > 1) stack.pop()
      continue
    }
    nodes += 1
    if (nodes > maxNodes) throw new RangeError('SVG node count exceeds maxNodes budget')
    if (stack.length > maxDepth) throw new RangeError('SVG depth exceeds maxDepth budget')
    counts.set(name, (counts.get(name) ?? 0) + 1)
    const attrs = attributes(match[2])
    if (name === 'svg' && rootAttributes === undefined) rootAttributes = attrs
    const node = {
      kind: name,
      label: attrs.id ? `${name}#${attrs.id}` : name,
      preview: attrs.d ? `${attrs.d.slice(0, 80)}${attrs.d.length > 80 ? '…' : ''}` : undefined,
      children: [],
    }
    stack.at(-1).children.push(node)
    const selfClosing =
      match[3] === '/' ||
      [
        'path',
        'rect',
        'circle',
        'ellipse',
        'line',
        'polyline',
        'polygon',
        'image',
        'use',
        'stop',
      ].includes(name)
    if (!selfClosing) stack.push(node)
  }
  if ((counts.get('svg') ?? 0) !== 1)
    throw new TypeError('SVG must contain exactly one root svg element')
  const unsafe = []
  if ((counts.get('script') ?? 0) > 0) unsafe.push('scripts')
  if ((counts.get('foreignobject') ?? 0) > 0) unsafe.push('foreign-object')
  if (count({ counts }, ['animate', 'animatetransform', 'animatemotion', 'set', 'discard']) > 0)
    unsafe.push('active-animation')
  if (count({ counts }, ['iframe', 'audio', 'video', 'canvas']) > 0) unsafe.push('embedded-content')
  if (/\son[a-z]+\s*=/iu.test(text)) unsafe.push('event-handlers')
  if (/(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|javascript:)/iu.test(text))
    unsafe.push('external-references')
  if (/url\(\s*["']?(?:https?:|data:|javascript:)/iu.test(text)) unsafe.push('external-css')
  return Object.freeze({
    root,
    counts,
    nodes,
    attributes: rootAttributes ?? {},
    unsafe: Object.freeze([...new Set(unsafe)]),
  })
}

function count(svg, names) {
  return names.reduce((total, name) => total + (svg.counts.get(name) ?? 0), 0)
}

function finiteDimension(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value))
    return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function viewBox(value) {
  if (typeof value !== 'string') return undefined
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .map(Number)
  return parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0
    ? parts
    : undefined
}

const definition = Object.freeze({
  id: 'org.modkitx/vector-svg',
  format: Object.freeze({ id: 'svg', label: 'SVG vector image', mediaType: 'image/svg+xml' }),
  async detect(bytes) {
    const match = looksLikeSvg(bytes)
    return {
      confidence: match ? 0.98 : 0.01,
      kind: 'structure',
      note: match ? 'svg-root' : 'svg-root-missing',
    }
  },
  async inspect(bytes, context) {
    const text = decoder.decode(bytes).replace(/^\uFEFF/u, '')
    const svg = parseSvg(text, context.budget.maxNodes, context.budget.maxDepth)
    const paths = count(svg, ['path'])
    const shapes = count(svg, ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
    const textNodes = count(svg, ['text', 'tspan', 'textpath'])
    const gradients = count(svg, ['lineargradient', 'radialgradient'])
    if (svg.unsafe.length > 0) {
      throw new TypeError(`SVG is outside the secure static profile: ${svg.unsafe.join(', ')}`)
    }
    const vector = createVectorSceneSource(
      {
        ...(finiteDimension(svg.attributes.width) === undefined
          ? {}
          : { width: finiteDimension(svg.attributes.width) }),
        ...(finiteDimension(svg.attributes.height) === undefined
          ? {}
          : { height: finiteDimension(svg.attributes.height) }),
        ...(viewBox(svg.attributes.viewBox ?? svg.attributes.viewbox) === undefined
          ? {}
          : { viewBox: viewBox(svg.attributes.viewBox ?? svg.attributes.viewbox) }),
        nodes: svg.nodes,
        paths,
        shapes,
        textNodes,
        gradients,
      },
      text,
    )
    return {
      summary: {
        format: 'svg',
        nodes: svg.nodes,
        width: svg.attributes.width ?? null,
        height: svg.attributes.height ?? null,
        viewBox: svg.attributes.viewBox ?? svg.attributes.viewbox ?? null,
        paths,
        shapes,
        text: textNodes,
        gradients,
        unsafeFeatures: svg.unsafe,
      },
      metadata: [
        {
          id: 'svg-scene',
          label: 'SVG scene',
          entries: [
            { key: 'nodes', value: svg.nodes },
            { key: 'width', value: svg.attributes.width ?? null },
            { key: 'height', value: svg.attributes.height ?? null },
            { key: 'viewBox', value: svg.attributes.viewBox ?? svg.attributes.viewbox ?? null },
            { key: 'paths', value: paths },
            { key: 'shapes', value: shapes },
            { key: 'textNodes', value: textNodes },
            { key: 'gradients', value: gradients },
          ],
        },
      ],
      traits: [
        { id: 'vector.scene', parameters: { nodes: svg.nodes } },
        ...(paths > 0 ? [{ id: 'vector.paths', parameters: { count: paths } }] : []),
        ...(shapes > 0 ? [{ id: 'vector.shapes', parameters: { count: shapes } }] : []),
        ...(textNodes > 0 ? [{ id: 'vector.text', parameters: { count: textNodes } }] : []),
        ...(gradients > 0 ? [{ id: 'vector.gradients', parameters: { count: gradients } }] : []),
        { id: 'structure.hierarchy', parameters: { nodeCount: svg.nodes, lazy: true } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      text: true,
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource(svg.root),
        'common.view/vector-scene-source': vector,
      },
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
