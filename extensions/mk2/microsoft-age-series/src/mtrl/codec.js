// AoM MTRL layout follows the published AoM Engine Library parser and 010 template:
// https://github.com/Ryder25/Age-of-Mythology/blob/master/src/AoMEngineLibrary/Graphics/Brg/MtrlFile.cs

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/mtrl'
const FIXED_BYTES = 212
const PATH_LABELS = Object.freeze([
  'texture',
  'secondaryTexture',
  'bumpMap',
  'specularMap',
  'glossMap',
  'emissiveMap',
])
const ALPHA_MODES = Object.freeze([
  'off',
  'one-bit',
  'on',
  'lightmap',
  'lightmap-in-alpha',
  'inverted-lightmap-in-alpha',
  'additive',
  'additive-squared',
  'additive-modulate-source-alpha',
  'subtractive',
  'texture',
])

function checkedRange(bytes, offset, length, label) {
  if (offset < 0 || length < 0 || offset > bytes.byteLength || length > bytes.byteLength - offset)
    throw new RangeError(`MTRL ${label} is outside the file`)
}

function finiteFloat(view, offset, label) {
  const value = view.getFloat32(offset, true)
  if (!Number.isFinite(value)) throw new TypeError(`MTRL ${label} is not finite`)
  return value
}

function decodePath(bytes, offset, length, label) {
  checkedRange(bytes, offset, length + 1, label)
  if (bytes[offset + length] !== 0) throw new TypeError(`MTRL ${label} is not NUL terminated`)
  let value
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset, offset + length),
    )
  } catch (error) {
    throw new TypeError(`MTRL ${label} is not valid UTF-8: ${String(error)}`)
  }
  if (value.includes('\0')) throw new TypeError(`MTRL ${label} contains a NUL character`)
  return value
}

function parseMtrl(bytes, budget) {
  if (budget.maxDepth < 2) throw new RangeError('MTRL structure exceeds maxDepth budget')
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError('MTRL metadata exceeds maxScalarBytes budget')
  checkedRange(bytes, 0, FIXED_BYTES, 'header')
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'MTRL')
    throw new TypeError('MTRL magic is missing')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const lengths = PATH_LABELS.map((_, index) => view.getUint32(4 + index * 4, true))
  for (const [index, length] of lengths.entries()) {
    if (length > 260) throw new RangeError(`MTRL ${PATH_LABELS[index]} exceeds 260 UTF-8 bytes`)
  }

  const vectorAt = (offset, label) => [
    finiteFloat(view, offset, `${label}.r`),
    finiteFloat(view, offset + 4, `${label}.g`),
    finiteFloat(view, offset + 8, `${label}.b`),
  ]
  const colors = {
    diffuse: vectorAt(28, 'diffuse'),
    ambient: vectorAt(40, 'ambient'),
    specular: vectorAt(52, 'specular'),
    emissive: vectorAt(64, 'emissive'),
  }
  const specularPower = finiteFloat(view, 76, 'specular power')
  const alpha = finiteFloat(view, 80, 'alpha')
  const flags = {
    selfIlluminating: bytes[88] !== 0,
    clampU: bytes[89] !== 0,
    clampV: bytes[90] !== 0,
    lightSpecular: bytes[91] !== 0,
    affectsAmbient: bytes[92] !== 0,
    affectsDiffuse: bytes[93] !== 0,
    affectsSpecular: bytes[94] !== 0,
    updateable: bytes[95] !== 0,
  }
  const alphaModeValue = view.getInt32(96, true)
  if (alphaModeValue < 0 || alphaModeValue >= ALPHA_MODES.length)
    throw new TypeError(`MTRL alpha mode ${alphaModeValue} is invalid`)

  let offset = FIXED_BYTES
  const references = {}
  for (const [index, label] of PATH_LABELS.entries()) {
    const length = lengths[index]
    if (length === 0) {
      references[label] = ''
      continue
    }
    references[label] = decodePath(bytes, offset, length, label)
    offset += length + 1
  }
  if (offset !== bytes.byteLength)
    throw new TypeError(`MTRL has ${bytes.byteLength - offset} trailing byte(s)`)
  const referenceCount = Object.values(references).filter(Boolean).length
  const nodes = 5 + referenceCount
  if (nodes > budget.maxNodes) throw new RangeError('MTRL fields exceed maxNodes budget')
  return Object.freeze({
    colors: Object.freeze(colors),
    specularPower,
    alpha,
    id: view.getInt32(84, true),
    flags: Object.freeze(flags),
    alphaMode: ALPHA_MODES[alphaModeValue],
    colorTransform: view.getInt32(116, true),
    textureTransform: view.getInt32(120, true),
    textureFactor: view.getUint32(124, true),
    multitextureMode: view.getInt32(128, true),
    references: Object.freeze(references),
    referenceCount,
  })
}

export const abiVersion = 1
export const createCodec = context =>
  createInspectionCodec(
    Object.freeze({
      id: ID,
      version: '1.0.0',
      format: Object.freeze({ id: 'mtrl', label: 'AoM MTRL material' }),
      async detect(prefix) {
        const matches =
          prefix.byteLength >= 4 && String.fromCharCode(...prefix.subarray(0, 4)) === 'MTRL'
        return matches
          ? { confidence: 0.99, kind: 'magic', note: 'MTRL magic' }
          : { confidence: 0, kind: 'magic', note: 'MTRL magic missing' }
      },
      async inspect(bytes, inspectionContext) {
        const material = parseMtrl(bytes, inspectionContext.budget)
        const summary = {
          format: 'mtrl',
          id: material.id,
          alpha: material.alpha,
          alphaMode: material.alphaMode,
          specularPower: material.specularPower,
          referenceCount: material.referenceCount,
          references: material.references,
        }
        return {
          summary,
          metadata: [
            {
              id: 'mtrl-material',
              label: 'AoM material',
              entries: Object.entries(summary)
                .filter(([key]) => key !== 'references')
                .map(([key, value]) => ({ key, value })),
            },
          ],
          traits: [
            { id: 'content.metadata', parameters: { kind: 'material' } },
            { id: 'structure.hierarchy', parameters: { references: material.referenceCount } },
            {
              id: 'content.binary',
              parameters: { bytes: String(bytes.byteLength), magic: 'MTRL' },
            },
          ],
          dataSources: {
            'common.view/tree-data-source': createTreeDataSource({
              kind: 'material',
              label: `MTRL material ${material.id}`,
              preview: `${material.alphaMode}, ${material.referenceCount} reference(s)`,
              children: [
                {
                  kind: 'section',
                  label: 'Colors',
                  children: Object.entries(material.colors).map(([name, value]) => ({
                    kind: 'color',
                    label: name,
                    preview: value.join(', '),
                  })),
                },
                {
                  kind: 'section',
                  label: 'Flags',
                  children: Object.entries(material.flags).map(([name, value]) => ({
                    kind: 'flag',
                    label: name,
                    preview: String(value),
                  })),
                },
                {
                  kind: 'section',
                  label: 'Texture references',
                  children: Object.entries(material.references).map(([name, value]) => ({
                    kind: 'reference',
                    label: name,
                    preview: value || '(none)',
                  })),
                },
              ],
            }),
          },
          maxDecodedBytes: BigInt(bytes.byteLength),
          unsupportedFeatures: ['referenced-texture-resolution', 'mtrl-writing'],
        }
      },
    }),
    context,
  )
