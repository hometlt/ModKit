// AoM CUB face ordering follows the AoM Engine Library implementation:
// https://github.com/Ryder25/Age-of-Mythology/blob/master/src/AoMEngineLibrary/Graphics/CubFile.cs

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/cub'
const FACE_NAMES = Object.freeze(['up', 'down', 'front', 'back', 'left', 'right'])

function decodeText(bytes) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new TypeError(`CUB text is not valid UTF-8: ${String(error)}`)
  }
  if (text.includes('\0')) throw new TypeError('CUB text contains a NUL character')
  return text
}

function parseCub(bytes, budget) {
  if (budget.maxDepth < 2) throw new RangeError('CUB structure exceeds maxDepth budget')
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError('CUB text exceeds maxScalarBytes budget')
  const text = decodeText(bytes)
  const references = text
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('//'))
  if (references.length !== FACE_NAMES.length)
    throw new TypeError(`CUB expected 6 texture references, found ${references.length}`)
  if (references.length > budget.maxNodes) throw new RangeError('CUB faces exceed maxNodes budget')
  for (const reference of references) {
    if (new TextEncoder().encode(reference).byteLength > 260)
      throw new RangeError('CUB texture reference exceeds 260 UTF-8 bytes')
  }
  return Object.freeze({ text, references: Object.freeze(references) })
}

function looksLikeCub(prefix) {
  try {
    const references = decodeText(prefix)
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('//'))
    return references.length === FACE_NAMES.length
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
      format: Object.freeze({ id: 'cub', label: 'AoM CUB cubemap descriptor' }),
      async detect(prefix) {
        return looksLikeCub(prefix)
          ? { confidence: 0.82, kind: 'structure', note: 'six CUB face references' }
          : { confidence: 0, kind: 'structure', note: 'CUB face list missing' }
      },
      async inspect(bytes, inspectionContext) {
        const cub = parseCub(bytes, inspectionContext.budget)
        const faces = Object.fromEntries(
          FACE_NAMES.map((name, index) => [name, cub.references[index]]),
        )
        const summary = { format: 'cub', faceCount: FACE_NAMES.length, faces }
        return {
          summary,
          text: true,
          metadata: [
            {
              id: 'cubemap-faces',
              label: 'Cubemap face references',
              entries: FACE_NAMES.map(name => ({ key: name, value: faces[name] })),
            },
          ],
          traits: [
            { id: 'content.text', parameters: { encoding: 'utf-8' } },
            { id: 'content.metadata', parameters: { kind: 'cubemap-descriptor' } },
            { id: 'structure.hierarchy', parameters: { nodes: FACE_NAMES.length } },
          ],
          dataSources: {
            'common.view/tree-data-source': createTreeDataSource({
              kind: 'cubemap',
              label: 'CUB cubemap',
              preview: '6 ordered texture references',
              children: FACE_NAMES.map(name => ({
                kind: 'face',
                label: name,
                preview: faces[name],
              })),
            }),
          },
          maxDecodedBytes: BigInt(bytes.byteLength),
          unsupportedFeatures: ['referenced-texture-resolution', 'cub-writing'],
        }
      },
    }),
    context,
  )
