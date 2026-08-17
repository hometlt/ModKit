import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const latin1 = new TextDecoder('latin1')

function looksLikeRtf(bytes) {
  return /^\{\\rtf1(?:\\|\s)/u.test(latin1.decode(bytes).replace(/^\uFEFF/u, ''))
}

function parseRtf(text, budget) {
  if (!looksLikeRtf(new TextEncoder().encode(text.slice(0, 32)))) {
    throw new TypeError('RTF header must start with {\\rtf1')
  }
  let depth = 0
  let groups = 0
  let controls = 0
  let paragraphs = 0
  let sections = 1
  let pictures = 0
  let objects = 0
  let outlineLevels = 0
  const frequencies = new Map()
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '{') {
      depth += 1
      groups += 1
      if (depth > budget.maxDepth) throw new RangeError('RTF nesting exceeds maxDepth budget')
      if (groups > budget.maxNodes) throw new RangeError('RTF groups exceed maxNodes budget')
    } else if (character === '}') {
      depth -= 1
      if (depth < 0) throw new TypeError('RTF has an unmatched closing group')
    } else if (character === '\\') {
      const next = text[index + 1]
      if (next === '\\' || next === '{' || next === '}') {
        index += 1
        continue
      }
      if (next === "'") {
        if (!/^[0-9a-f]{2}$/iu.test(text.slice(index + 2, index + 4)))
          throw new TypeError('RTF hex escape is malformed')
        index += 3
        continue
      }
      const match = /^\\([A-Za-z]+)(-?[0-9]+)? ?/u.exec(text.slice(index))
      if (match === null) continue
      const word = match[1].toLowerCase()
      controls += 1
      if (controls + groups > budget.maxNodes)
        throw new RangeError('RTF controls exceed maxNodes budget')
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1)
      if (word === 'par') paragraphs += 1
      else if (word === 'sect') sections += 1
      else if (word === 'pict') pictures += 1
      else if (word === 'object') objects += 1
      else if (word === 'outlinelevel') outlineLevels += 1
      index += match[0].length - 1
    }
  }
  if (depth !== 0) throw new TypeError('RTF groups are unbalanced')
  const topControls = [...frequencies]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 32)
  return Object.freeze({
    groups,
    controls,
    paragraphs,
    sections,
    pictures,
    objects,
    outlineLevels,
    topControls: Object.freeze(topControls),
  })
}

const definition = Object.freeze({
  id: 'org.modkitx/document-rtf',
  format: Object.freeze({ id: 'rtf', label: 'Rich Text Format', mediaType: 'application/rtf' }),
  async detect(bytes) {
    const match = looksLikeRtf(bytes)
    return {
      confidence: match ? 0.995 : 0.01,
      kind: 'structure',
      note: match ? 'rtf1-header' : 'rtf-header-missing',
    }
  },
  async inspect(bytes, context) {
    const text = latin1.decode(bytes)
    const rtf = parseRtf(text, context.budget)
    const tree = createTreeDataSource({
      kind: 'document',
      label: 'RTF',
      preview: `${rtf.paragraphs} paragraphs, ${rtf.groups} groups`,
      children: rtf.topControls.map(([word, count]) => ({
        kind: 'control-word',
        label: `\\${word}`,
        preview: `${count} occurrence(s)`,
      })),
    })
    return {
      summary: {
        format: 'rtf',
        groups: rtf.groups,
        controls: rtf.controls,
        paragraphs: rtf.paragraphs,
        sections: rtf.sections,
        pictures: rtf.pictures,
        objects: rtf.objects,
        outlineLevels: rtf.outlineLevels,
      },
      metadata: [
        {
          id: 'rtf-document',
          label: 'RTF document',
          entries: [
            { key: 'groups', value: rtf.groups },
            { key: 'controlWords', value: rtf.controls },
            { key: 'paragraphs', value: rtf.paragraphs },
            { key: 'sections', value: rtf.sections },
            { key: 'pictures', value: rtf.pictures },
            { key: 'objects', value: rtf.objects },
            { key: 'outlineLevels', value: rtf.outlineLevels },
          ],
        },
      ],
      traits: [
        { id: 'document.flow', parameters: { paragraphs: rtf.paragraphs, sections: rtf.sections } },
        ...(rtf.outlineLevels > 0
          ? [{ id: 'document.outline', parameters: { levels: rtf.outlineLevels } }]
          : []),
        ...(rtf.pictures > 0
          ? [{ id: 'content.images', parameters: { embedded: rtf.pictures } }]
          : []),
        { id: 'structure.hierarchy', parameters: { groups: rtf.groups, lazy: true } },
        {
          id: 'content.binary',
          parameters: { bytes: String(bytes.byteLength), encoding: 'rtf-ansi' },
        },
      ],
      dataSources: { 'common.view/tree-data-source': tree },
      unsupportedFeatures: ['layout-rendering', 'embedded-object-activation'],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
