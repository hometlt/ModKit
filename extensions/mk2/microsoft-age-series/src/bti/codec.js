// Bang Texture Info grammar follows the AoM Engine Library implementation:
// https://github.com/Ryder25/Age-of-Mythology/blob/master/src/AoMEngineLibrary/Graphics/BtiFile.cs

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/bti'
const FORMATS = new Map(
  ['BC1', 'BC2', 'BC3', 'DeflatedRGBA8', 'DeflatedRGB8', 'DeflatedRG8', 'DeflatedR8'].map(value => [
    value.toLowerCase(),
    value,
  ]),
)

function decodeText(bytes) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new TypeError(`BTI text is not valid UTF-8: ${String(error)}`)
  }
  if (text.includes('\0')) throw new TypeError('BTI text contains a NUL character')
  return text
}

function parseBti(bytes, budget) {
  if (budget.maxDepth < 2) throw new RangeError('BTI structure exceeds maxDepth budget')
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError('BTI text exceeds maxScalarBytes budget')
  const text = decodeText(bytes)
  const tokens = text.split(/[\s=]+/u).filter(Boolean)
  if (tokens.length > budget.maxNodes) throw new RangeError('BTI tokens exceed maxNodes budget')

  let alphaBits
  let format
  let useMips = true
  let alphaTest = true
  let canBeLowDetail = true
  let displacement = false
  const seen = new Set()
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const key = token.toLowerCase()
    if (seen.has(key)) throw new TypeError(`BTI token ${token} is duplicated`)
    if (key === 'alpha') {
      const value = tokens[index + 1]
      if (value === undefined || !['0', '1', '4', '8'].includes(value))
        throw new TypeError('BTI alpha bits must be 0, 1, 4, or 8')
      alphaBits = Number(value)
      seen.add(key)
      index += 1
    } else if (key === 'fmt') {
      const value = tokens[index + 1]
      const canonical = value === undefined ? undefined : FORMATS.get(value.toLowerCase())
      if (canonical === undefined)
        throw new TypeError(`BTI texture format ${value ?? ''} is invalid`)
      format = canonical
      seen.add(key)
      index += 1
    } else if (key === 'nomip') {
      useMips = false
      seen.add(key)
    } else if (key === 'noalphatest') {
      alphaTest = false
      seen.add(key)
    } else if (key === 'nolowdetail') {
      canBeLowDetail = false
      seen.add(key)
    } else if (key === 'displacement') {
      displacement = true
      seen.add(key)
    } else {
      throw new TypeError(`BTI token ${token} is unknown`)
    }
  }
  if (alphaBits === undefined || format === undefined)
    throw new TypeError('BTI must specify both alpha and fmt')
  return Object.freeze({
    text,
    alphaBits,
    format,
    useMips,
    alphaTest,
    canBeLowDetail,
    displacement,
  })
}

function looksLikeBti(prefix) {
  try {
    const text = decodeText(prefix)
    return (
      /(?:^|[\s=])alpha(?:[\s=])+(?:0|1|4|8)(?:$|\s)/iu.test(text) &&
      /(?:^|[\s=])fmt(?:[\s=])+(?:bc[123]|deflated(?:rgba8|rgb8|rg8|r8))(?:$|\s)/iu.test(text)
    )
  } catch {
    return false
  }
}

export const abiVersion = 1
export const createCodec = context =>
  createInspectionCodec(
    Object.freeze({
      id: ID,
      version: '1.0.0',
      format: Object.freeze({ id: 'bti', label: 'AoM BTI texture info' }),
      async detect(prefix) {
        return looksLikeBti(prefix)
          ? { confidence: 0.9, kind: 'structure', note: 'BTI alpha/fmt grammar' }
          : { confidence: 0, kind: 'structure', note: 'BTI grammar missing' }
      },
      async inspect(bytes, inspectionContext) {
        const bti = parseBti(bytes, inspectionContext.budget)
        const summary = {
          format: 'bti',
          textureFormat: bti.format,
          alphaBits: bti.alphaBits,
          useMips: bti.useMips,
          alphaTest: bti.alphaTest,
          canBeLowDetail: bti.canBeLowDetail,
          displacement: bti.displacement,
        }
        return {
          summary,
          text: true,
          metadata: [
            {
              id: 'bti-texture-info',
              label: 'Bang texture info',
              entries: Object.entries(summary).map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'content.text', parameters: { encoding: 'utf-8' } },
            { id: 'content.metadata', parameters: { kind: 'texture-info' } },
          ],
          dataSources: {
            'common.view/tree-data-source': createTreeDataSource({
              kind: 'texture-info',
              label: 'BTI texture settings',
              preview: `${bti.format}, ${bti.alphaBits} alpha bit(s)`,
              children: Object.entries(summary)
                .filter(([key]) => key !== 'format')
                .map(([key, value]) => ({ kind: 'property', label: key, preview: String(value) })),
            }),
          },
          maxDecodedBytes: BigInt(bytes.byteLength),
          unsupportedFeatures: ['bti-writing'],
        }
      },
    }),
    context,
  )
