import { describe, expect, it, vi } from 'vitest'
import {
  createSubjectCandidateProvider,
  loadSubjectCandidatePage,
  type SubjectCandidateProvider,
} from '@modkit/sdk'
import {
  createResolvedDataSubjectSelectorLease,
  type ResolvedDataSubjectSelectorLimits,
} from '@modkit/host/data'
import { expandSubjectReferenceCompletions } from '@modkit/host/language'
import { SubjectSelectorModel, candidateTargetForField } from '@modkit/ui/selector'
import { mountFieldEditor } from '@modkit/ui/field-editor'

const definitions = [
  {
    namespace: 'unit',
    typeId: 'soldier',
    entityId: 'Alpha',
    inheritanceChain: [{ namespace: 'unit', entityId: 'Alpha' }],
    fields: { rank: 2 },
    sources: [],
    complete: true,
  },
  {
    namespace: 'unit',
    typeId: 'soldier',
    entityId: 'Bravo',
    inheritanceChain: [{ namespace: 'unit', entityId: 'Bravo' }],
    fields: { rank: 3 },
    sources: [],
    complete: true,
  },
  {
    namespace: 'unit',
    typeId: 'soldier',
    entityId: 'Default',
    inheritanceChain: [{ namespace: 'unit', entityId: 'Default' }],
    fields: { rank: 9 },
    sources: [],
    complete: true,
  },
  {
    namespace: 'unit',
    typeId: 'structure',
    entityId: 'Barracks',
    inheritanceChain: [{ namespace: 'unit', entityId: 'Barracks' }],
    fields: { rank: 4 },
    sources: [],
    complete: true,
  },
  {
    namespace: 'weapon',
    typeId: 'soldier',
    entityId: 'Arc',
    inheritanceChain: [{ namespace: 'weapon', entityId: 'Arc' }],
    fields: { rank: 7 },
    sources: [],
    complete: true,
  },
  {
    namespace: 'asset',
    typeId: 'image',
    entityId: 'Portrait',
    inheritanceChain: [{ namespace: 'asset', entityId: 'Portrait' }],
    fields: { rank: 1 },
    sources: [],
    complete: true,
  },
] as const

const selectorOptions = {
  maxPageSize: 8,
  maxEntities: 32,
  maxRelations: 32,
  maxCalculations: 32,
  candidateMetadata(entity) {
    if (entity.entityId === 'Default') return { tags: ['default'] }
    if (entity.entityId === 'Portrait') {
      return {
        tags: ['preview'],
        asset: { formatId: 'image-raster', traits: ['content.raster', 'content.binary'] },
      }
    }
    return { tags: ['selectable'] }
  },
  predicates: {
    'minimum-rank': context => {
      const params = context.params as { readonly minimum?: number } | undefined
      const rank = context.entity.fields['rank']
      return typeof rank === 'number' && rank >= (params?.minimum ?? 0)
    },
  },
} satisfies ResolvedDataSubjectSelectorLimits

function selector(complete = true) {
  const lease = createResolvedDataSubjectSelectorLease(
    {
      state: 'resolved',
      snapshot: {
        snapshotId: complete ? 'selector-complete' : 'selector-partial',
        definitions,
        localizedStrings: [],
        complete,
      },
      openSubjectFacts: async () => ({ value: {}, release: () => Promise.resolve() }),
      openSubjectCalculations: async () => ({ value: {}, release: () => Promise.resolve() }),
    } as never,
    selectorOptions,
  )
  if (lease === undefined) throw new Error('selector fixture did not open')
  return lease
}

const filter = {
  type: 'soldier',
  sameTypeAs: 'unit/Alpha',
  excludeTags: ['default'],
  predicate: { id: 'minimum-rank', params: { minimum: 2 } },
} as const

describe('P2 subject selector conformance', () => {
  it('applies kind, type, text and provider-owned predicate before stable paging', async () => {
    const lease = selector()
    try {
      const first = await lease.value.subjects({
        kind: 'unit',
        type: 'soldier',
        text: 'a',
        filter,
        limit: 1,
      })
      expect(first.items.map(item => item.subjectId)).toEqual(['unit/Alpha'])
      expect(first.nextCursor).toBe('subject:1')
      if (first.nextCursor === undefined) throw new Error('first selector page did not continue')
      const second = await lease.value.subjects({
        kind: 'unit',
        type: 'soldier',
        text: 'a',
        filter,
        cursor: first.nextCursor,
        limit: 1,
      })
      expect(second.items.map(item => item.subjectId)).toEqual(['unit/Bravo'])
      expect(second.nextCursor).toBeUndefined()
    } finally {
      await lease.release()
    }
  })

  it('fails closed for unknown same-type anchors and named predicates', async () => {
    const lease = selector()
    try {
      await expect(
        lease.value.subjects({
          kind: 'unit',
          filter: { sameTypeAs: 'unit/Missing' },
          limit: 1,
        }),
      ).rejects.toThrow(/sameTypeAs anchor not found/u)
      await expect(
        lease.value.subjects({
          kind: 'unit',
          filter: { predicate: { id: 'unpublished' } },
          limit: 1,
        }),
      ).rejects.toThrow(/predicate is unavailable/u)
    } finally {
      await lease.release()
    }
  })

  it('enforces limits and cursors and propagates provider and consumer completeness', async () => {
    const lease = selector(false)
    try {
      await expect(lease.value.subjects({ kind: 'unit', limit: 0 })).rejects.toThrow(
        /limit must be between/u,
      )
      await expect(
        lease.value.subjects({ kind: 'unit', cursor: 'subject:not-a-number', limit: 1 }),
      ).rejects.toThrow(/cursor is invalid or stale/u)
      const provider = createSubjectCandidateProvider(lease.value)
      const partial = new SubjectSelectorModel({
        candidates: provider,
        target: { kind: 'subject-ref', subjectKind: 'unit' },
        pageSize: 1,
        maximum: 8,
      })
      expect((await partial.search('')).completeness).toBe('partial')
      const capped = new SubjectSelectorModel({
        candidates: provider,
        target: { kind: 'subject-ref', subjectKind: 'unit' },
        pageSize: 1,
        maximum: 1,
      })
      const cappedSnapshot = await capped.search('')
      expect(cappedSnapshot.completeness).toBe('capped')
      expect(cappedSnapshot.nextCursor).toBeDefined()
    } finally {
      await lease.release()
    }
  })

  it('routes asset references through the same provider with format and trait constraints', async () => {
    const lease = selector()
    try {
      const provider = createSubjectCandidateProvider(lease.value)
      const target = candidateTargetForField({
        kind: 'asset-ref',
        accepts: { formatIds: ['image-raster'], traits: ['content.raster'] },
      })
      if (target === undefined) throw new Error('asset selector target was not created')
      const result = await loadSubjectCandidatePage(provider, { target, limit: 4 })
      expect(result.page.items.map(item => item.subjectId)).toEqual(['asset/Portrait'])
      expect(candidateTargetForField({ kind: 'text' })).toBeUndefined()
    } finally {
      await lease.release()
    }
  })

  it('rejects malformed or over-limit candidate pages at the shared consumer seam', async () => {
    const malformed: SubjectCandidateProvider = {
      summary: async () => ({
        snapshotId: 'malformed',
        totalSubjects: 2,
        completeness: 'complete',
      }),
      candidates: async () => ({
        items: [
          { subjectId: 'unit/A', label: 'A', kind: 'unit' },
          { subjectId: 'unit/B', label: 'B', kind: 'unit' },
        ],
      }),
    }
    await expect(
      loadSubjectCandidatePage(malformed, {
        target: { kind: 'subject-ref', subjectKind: 'unit' },
        limit: 1,
      }),
    ).rejects.toThrow(/exceeds its requested limit/u)
  })

  it('returns identical panel and completion candidates for one structured filter', async () => {
    const lease = selector()
    try {
      const provider = createSubjectCandidateProvider(lease.value)
      const target = { kind: 'subject-ref', subjectKind: 'unit', filter } as const
      const panel = new SubjectSelectorModel({
        candidates: provider,
        target,
        pageSize: 1,
        maximum: 8,
      })
      let panelSnapshot = await panel.search('')
      while (panelSnapshot.nextCursor !== undefined) panelSnapshot = await panel.loadMore()

      const completion = await expandSubjectReferenceCompletions(
        { items: [target], isIncomplete: false },
        provider,
        8,
      )
      expect(completion.items.map(item => item.insertText)).toEqual(
        panelSnapshot.candidates.map(item => item.subjectId),
      )
      expect(completion.isIncomplete).toBe(false)
    } finally {
      await lease.release()
    }
  })

  it('keeps reference fields non-writable when no selector source is available', async () => {
    const input = {
      type: '',
      value: '',
      disabled: false,
      setAttribute: vi.fn(),
      remove: vi.fn(),
    }
    const container = {
      ownerDocument: { createElement: () => input },
      append: vi.fn(),
    }
    const control = await mountFieldEditor(
      container as never,
      {
        key: 'parent',
        name: 'parent',
        label: 'Parent',
        kind: 'text',
        type: { kind: 'subject-ref', subjectKind: 'unit', filter },
        inputPath: ['value'],
        initial: 'unit/Alpha',
        initialText: 'unit/Alpha',
      },
      new AbortController().signal,
    )
    expect(input.disabled).toBe(true)
    expect(control.validate()).toMatch(/candidate source is unavailable/u)
    expect(control.read()).toBe('unit/Alpha')
  })
})
