/** Anchor documents: a codec-declared entry opens the source that holds it. */

import { describe, expect, it } from 'vitest'
import type { Inventory } from '@modkit/host'

import { anchorDocumentIndex, anchoredSubjectPath } from '../src/anchor-documents.js'
import { containerUriText } from '../src/container-uri.js'

const inventoryWith = (specs: readonly unknown[]): Inventory =>
  ({
    extensions: [
      {
        source: 'fixture',
        origin: 'installed',
        container: 'directory',
        manifest: {},
        contributions: specs.map(spec => ({
          path: 'codec.json',
          manifest: { spec },
          specState: 'valid',
          inventoryEligible: true,
          activationEligible: true,
          facts: [],
          diagnostics: [],
        })),
      },
    ],
    diagnostics: [],
  }) as unknown as Inventory

const mapCodec = { match: { extensions: ['sc2map'] }, anchorDocuments: ['MapInfo'] }
const modCodec = { match: { extensions: ['sc2mod'] }, anchorDocuments: ['DocumentInfo'] }

describe('anchor documents', () => {
  const index = anchorDocumentIndex(inventoryWith([mapCodec, modCodec]))

  it('reads the declared names per matched extension', () => {
    expect([...index.keys()].sort()).toEqual(['sc2map', 'sc2mod'])
    expect(index.get('sc2map')).toEqual(new Set(['mapinfo']))
  })

  it('opens the loose map directory that holds MapInfo', () => {
    const backslash = String.fromCharCode(92)
    const directory = `C:${backslash}Maps${backslash}Amphion.SC2Map`
    expect(anchoredSubjectPath(`${directory}${backslash}MapInfo`, index)).toBe(directory)
    // The spelling of the name is the archive's, not the person's.
    expect(anchoredSubjectPath(`${directory}${backslash}mapinfo`, index)).toBe(directory)
  })

  it('opens the packed map that holds MapInfo', () => {
    const backslash = String.fromCharCode(92)
    const archive = `C:${backslash}Maps${backslash}Amphion.SC2Map`
    expect(anchoredSubjectPath(containerUriText(archive, 'MapInfo'), index)).toBe(archive)
  })

  it('opens the mod for DocumentInfo', () => {
    const backslash = String.fromCharCode(92)
    const archive = `C:${backslash}Mods${backslash}Core.SC2Mod`
    expect(anchoredSubjectPath(containerUriText(archive, 'DocumentInfo'), index)).toBe(archive)
  })

  it('leaves every other entry alone', () => {
    const backslash = String.fromCharCode(92)
    const archive = `C:${backslash}Maps${backslash}Amphion.SC2Map`
    // A document that is not an anchor stays openable on its own: t3HeightMap has its own view.
    const height = containerUriText(archive, 't3HeightMap')
    expect(anchoredSubjectPath(height, index)).toBe(height)
    // Only a direct child anchors; deeper is something else that happens to live there.
    const nested = containerUriText(archive, 'Backup/MapInfo')
    expect(anchoredSubjectPath(nested, index)).toBe(nested)
    // An unrelated extension is untouched.
    const other = `C:${backslash}Other${backslash}Thing.zip${backslash}MapInfo`
    expect(anchoredSubjectPath(other, index)).toBe(other)
  })

  it('does nothing when no codec declares an anchor', () => {
    const empty = anchorDocumentIndex(inventoryWith([{ match: { extensions: ['sc2map'] } }]))
    const backslash = String.fromCharCode(92)
    const path = `C:${backslash}Maps${backslash}Amphion.SC2Map${backslash}MapInfo`
    expect(anchoredSubjectPath(path, empty)).toBe(path)
  })
})
