import { describe, expect, it } from 'vitest'
import {
  associationPattern,
  defaultAssociationPatterns,
  planEditorAssociations,
  TEXT_FIRST_EXTENSIONS,
  type AssociationContribution,
} from '../src/editor-associations.js'

/**
 * Per-codec «open by default» (Wave 2B, anchor 2B-5).
 *
 * The interesting cases are not "does it write an association" but the three ways it must NOT: a
 * codec the user opted out of, a format the user pointed at somebody else's editor, and an entry
 * this extension never wrote.
 */

const OWN = ['modkit.genericAssetPreview', 'modkit.hexViewer', 'modkit.imageViewer']
const DEFAULT_VIEW = 'modkit.genericAssetPreview'

const codec = (
  id: string,
  fileExtensions: readonly string[],
  disabled = false,
): AssociationContribution => ({ id, disabled, fileExtensions })

const plan = (overrides: {
  contributions?: readonly AssociationContribution[]
  nonDefault?: readonly string[]
  current?: Readonly<Record<string, string>>
  managed?: readonly string[]
  includeTextFormats?: boolean
}) =>
  planEditorAssociations({
    contributions: overrides.contributions ?? [codec('modkit/dds', ['dds'])],
    nonDefault: overrides.nonDefault ?? [],
    current: overrides.current ?? {},
    managed: overrides.managed ?? [],
    ownViewTypes: OWN,
    defaultViewType: DEFAULT_VIEW,
    includeTextFormats: overrides.includeTextFormats ?? false,
  })

describe('which formats an enabled codec claims by default', () => {
  it('claims an anchor document by its exact name, since it has no extension', () => {
    expect(
      defaultAssociationPatterns({
        contributions: [
          { id: 'blizzard/sc2-map', disabled: false, fileExtensions: ['sc2map'],
            anchorFileNames: ['MapInfo'] },
        ],
        nonDefault: [],
        includeTextFormats: false,
      }),
      // Without this, MapInfo opens in the text editor and the anchor rule is never consulted.
    ).toEqual(['**/MapInfo', '*.sc2map'])
  })

  it('does not claim an anchor of a codec the user opted out of', () => {
    expect(
      defaultAssociationPatterns({
        contributions: [
          { id: 'blizzard/sc2-map', disabled: false, fileExtensions: ['sc2map'],
            anchorFileNames: ['MapInfo'] },
        ],
        nonDefault: ['blizzard/sc2-map'],
        includeTextFormats: false,
      }),
    ).toEqual([])
  })

  it('claims every extension of every enabled codec, common formats included', async () => {
    expect(
      defaultAssociationPatterns({
        contributions: [codec('modkit/dds', ['dds']), codec('modkit/png', ['png'])],
        nonDefault: [],
        includeTextFormats: false,
      }),
    ).toEqual(['*.dds', '*.png'])
  })

  it('claims nothing for a disabled codec', async () => {
    expect(
      defaultAssociationPatterns({
        contributions: [codec('modkit/dds', ['dds'], true)],
        nonDefault: [],
        includeTextFormats: false,
      }),
    ).toEqual([])
  })

  it('claims nothing for a codec the user opted out of, without disabling it', async () => {
    expect(
      defaultAssociationPatterns({
        contributions: [codec('modkit/dds', ['dds']), codec('modkit/png', ['png'])],
        nonDefault: ['modkit/dds'],
        includeTextFormats: false,
      }),
    ).toEqual(['*.png'])
  })

  it('still claims a format a second, still-default codec also reads', async () => {
    expect(
      defaultAssociationPatterns({
        contributions: [codec('modkit/dds', ['dds']), codec('vendor/dds-extra', ['dds'])],
        nonDefault: ['modkit/dds'],
        includeTextFormats: false,
      }),
    ).toEqual(['*.dds'])
  })

  it('leaves text-first formats to the built-in editor unless asked otherwise', async () => {
    const contributions = [codec('modkit/xml', ['xml']), codec('modkit/dds', ['dds'])]
    expect(
      defaultAssociationPatterns({ contributions, nonDefault: [], includeTextFormats: false }),
    ).toEqual(['*.dds'])
    expect(
      defaultAssociationPatterns({ contributions, nonDefault: [], includeTextFormats: true }),
    ).toEqual(['*.dds', '*.xml'])
    expect(TEXT_FIRST_EXTENSIONS).toContain('xml')
  })
})

describe('planning the association map', () => {
  it('adds the association for a newly enabled codec and remembers it as managed', async () => {
    const result = plan({})
    expect(result.next).toEqual({ '*.dds': DEFAULT_VIEW })
    expect(result.added).toEqual(['*.dds'])
    expect(result.managed).toEqual(['*.dds'])
    expect(result.changed).toBe(true)
  })

  it('removes only what it added when the codec stops being the default', async () => {
    const result = plan({
      nonDefault: ['modkit/dds'],
      current: { '*.dds': DEFAULT_VIEW, '*.png': 'somebody.else' },
      managed: ['*.dds'],
    })
    expect(result.next).toEqual({ '*.png': 'somebody.else' })
    expect(result.removed).toEqual(['*.dds'])
    expect(result.managed).toEqual([])
  })

  it('never overwrites an association the user pointed at another editor', async () => {
    const result = plan({ current: { '*.dds': 'imageviewer.preview' } })
    expect(result.next).toEqual({ '*.dds': 'imageviewer.preview' })
    expect(result.added).toEqual([])
    expect(result.respected).toEqual(['*.dds'])
    expect(result.changed).toBe(false)
  })

  it('adopts an association the user set to one of our own view types', async () => {
    const result = plan({ current: { '*.dds': 'modkit.hexViewer' } })
    expect(result.next).toEqual({ '*.dds': 'modkit.hexViewer' })
    expect(result.added).toEqual([])
    expect(result.managed).toEqual(['*.dds'])
  })

  it('forgets a managed pattern the user repointed, and leaves their choice standing', async () => {
    const result = plan({
      nonDefault: ['modkit/dds'],
      current: { '*.dds': 'imageviewer.preview' },
      managed: ['*.dds'],
    })
    expect(result.next).toEqual({ '*.dds': 'imageviewer.preview' })
    expect(result.removed).toEqual([])
    expect(result.managed).toEqual([])
  })

  it('is idempotent: a second run over its own output changes nothing', async () => {
    const first = plan({})
    const second = planEditorAssociations({
      contributions: [codec('modkit/dds', ['dds'])],
      nonDefault: [],
      current: first.next,
      managed: first.managed,
      ownViewTypes: OWN,
      defaultViewType: DEFAULT_VIEW,
      includeTextFormats: false,
    })
    expect(second.changed).toBe(false)
    expect(second.next).toEqual(first.next)
    expect(second.managed).toEqual(first.managed)
  })

  it('keys associations by a lower-case dotted glob', async () => {
    expect(associationPattern('DDS')).toBe('*.dds')
    expect(associationPattern('.SC2Map')).toBe('*.sc2map')
  })
})
