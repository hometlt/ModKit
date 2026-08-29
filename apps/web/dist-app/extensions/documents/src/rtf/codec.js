import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const latin1 = new TextDecoder('latin1')

/**
 * `{\rtfN` for any major version, not just `1`.
 *
 * The retired staging port accepted `\rtfN`; this route is the only one left, so narrowing to
 * `\rtf1` would have made retiring the other one a loss of coverage. Only version 1 has ever
 * shipped, but a reader that refuses to *detect* a version it has not seen tells the user "unknown
 * file" where the truth is "RTF, newer than I know".
 */
const RTF_HEADER = /^\{\\rtf([1-9][0-9]*)(?:\\|\s|\{)/u

function rtfVersion(bytes) {
  const match = RTF_HEADER.exec(latin1.decode(bytes).replace(/^\uFEFF/u, ''))
  return match === null ? undefined : Number(match[1])
}

function looksLikeRtf(bytes) {
  return rtfVersion(bytes) !== undefined
}

function parseRtf(text, budget) {
  if (!looksLikeRtf(new TextEncoder().encode(text.slice(0, 32)))) {
    throw new TypeError('RTF header must start with {\\rtfN')
  }
  /*
   * The scalar ceiling, checked before the walk instead of never.
   *
   * The staging port this route replaced enforced `maxScalarBytes` and this one did not, which came
   * to light only when slice 12-2 ran the staging port's own budget case against the survivor. A
   * reader that ignores the caller's scalar ceiling turns a hostile 300 MB document into 300 MB of
   * resident string no matter what the caller asked for, and retiring a route must not cost a
   * safety property. Text length is the honest measure here: the decode already happened.
   */
  if (text.length > budget.maxScalarBytes) {
    throw new RangeError('RTF document exceeds maxScalarBytes budget')
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
  async detect(bytes, uri) {
    const version = rtfVersion(bytes)
    const header = version !== undefined
    const extension = uri?.split(/[?#]/u, 1)[0]?.split('.').at(-1)?.toLowerCase()
    const alias = extension === 'rtf'
    /*
     * Two pieces of evidence beat one (slice 12-2 routing, the same rule slice 11A applied to
     * Markdown). The header alone is already decisive — it is a magic string — so a renamed RTF
     * still resolves here rather than falling to the retired staging route; the alias only adds
     * the margin that makes "exactly one active route" a fact rather than a coin toss.
     *
     * The extension alone never decides: `.rtf` over bytes that are not RTF stays far below any
     * threshold that opens a subject.
     */
    const confidence = header ? (alias ? 0.998 : 0.995) : alias ? 0.3 : 0.01
    return {
      confidence,
      kind: 'structure',
      note: header ? `rtf${version}-header${alias ? '-and-alias' : ''}` : 'rtf-header-missing',
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
