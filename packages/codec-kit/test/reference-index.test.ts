import { describe, expect, it } from 'vitest'
import { createReferenceIndex } from '../src/reference-index.js'

/**
 * The index answers "who points at this", and every case below is a way it could answer with
 * something that used to be true. A stale answer here becomes a diagnostic pointing at an edit
 * nobody made, which is worse than no index at all.
 */
describe('reference index', () => {
  it('reports the documents that reference a target', () => {
    const index = createReferenceIndex()
    index.set('a.xml', ['Unit/Marine', 'Effect/Damage'])
    index.set('b.xml', ['Unit/Marine'])
    expect(index.referencing('Unit/Marine')).toEqual(['a.xml', 'b.xml'])
    expect(index.referencing('Effect/Damage')).toEqual(['a.xml'])
  })

  it('forgets a reference a document no longer makes', () => {
    const index = createReferenceIndex()
    index.set('a.xml', ['Unit/Marine'])
    index.set('a.xml', ['Unit/Marauder'])
    expect(index.referencing('Unit/Marine')).toEqual([])
    expect(index.referencing('Unit/Marauder')).toEqual(['a.xml'])
  })

  it('drops a target nothing references any more instead of keeping an empty entry', () => {
    const index = createReferenceIndex()
    index.set('a.xml', ['Unit/Marine'])
    index.set('a.xml', [])
    expect(index.snapshot()).toEqual({ documents: 1, targets: 0 })
  })

  it('removes a deleted document from every target it touched', () => {
    const index = createReferenceIndex()
    index.set('a.xml', ['Unit/Marine', 'Effect/Damage'])
    index.set('b.xml', ['Unit/Marine'])
    index.remove('a.xml')
    expect(index.referencing('Unit/Marine')).toEqual(['b.xml'])
    expect(index.referencing('Effect/Damage')).toEqual([])
    expect(index.documents()).toEqual(['b.xml'])
  })

  it('answers empty for anything it has never seen', () => {
    const index = createReferenceIndex()
    expect(index.referencing('Unit/Nobody')).toEqual([])
    expect(index.targetsOf('missing.xml')).toEqual([])
  })

  it('collapses document ids only when the host asks it to', () => {
    const plain = createReferenceIndex()
    plain.set('C:/Mod/A.xml', ['Unit/Marine'])
    plain.set('c:/mod/a.xml', ['Unit/Marine'])
    // Two spellings, two documents: collapsing ids a host means to keep apart is the worse error.
    expect(plain.referencing('Unit/Marine')).toHaveLength(2)

    const folded = createReferenceIndex({ normalizeDocumentId: id => id.toLowerCase() })
    folded.set('C:/Mod/A.xml', ['Unit/Marine'])
    folded.set('c:/mod/a.xml', ['Unit/Marine'])
    expect(folded.referencing('Unit/Marine')).toEqual(['c:/mod/a.xml'])
  })

  it('counts a target once however many documents reference it', () => {
    const index = createReferenceIndex()
    index.set('a.xml', ['Unit/Marine'])
    index.set('b.xml', ['Unit/Marine'])
    expect(index.snapshot()).toEqual({ documents: 2, targets: 1 })
  })
})
