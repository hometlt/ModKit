import { canonicalJsonStringify } from '@modkit/core'
import { describe, expect, it } from 'vitest'
import {
  editChangeFromDataEditProposal,
  isolationChangeFromDataGraphProposal,
  type ResolvedDataDocumentTarget,
  type ResolvedDataWritableRoot,
} from '../src/data/index.js'
import type {
  AssetRevision,
  AssetSourceRef,
  DataEditPlanProposal,
  DataGraphIsolationPlanProposal,
  RevisionId,
  SubjectEditTarget,
} from '@modkit/sdk'
import { revisionId } from '@modkit/sdk'

const rev = (token: string): RevisionId => revisionId(`provider-token:${token}`)

function fileTarget(
  rootId: string,
  path: string,
  uri: string,
  token: string,
): ResolvedDataDocumentTarget {
  const source: AssetSourceRef = Object.freeze({ id: uri, uri })
  const revision = rev(token)
  const expectedRevision: AssetRevision = Object.freeze({
    bindings: Object.freeze({ [source.id]: revision }),
    compositionFingerprint: canonicalJsonStringify({
      topology: 'single',
      bindingId: source.id,
      source: { id: source.id, uri: source.uri },
      revision,
    }),
  })
  return Object.freeze({
    rootId,
    path,
    target: Object.freeze({
      targetId: source.id,
      subjectUri: uri,
      ownerSource: source,
      semanticPath: Object.freeze([]),
      expectedRevision,
    }),
  })
}

function namespaceTarget(
  rootId: string,
  sourcePath: string,
  uri: string,
): ResolvedDataWritableRoot {
  const source: AssetSourceRef = Object.freeze({ id: uri, uri })
  const revision = rev('namespace-r1')
  const expectedRevision: AssetRevision = Object.freeze({
    bindings: Object.freeze({ [source.id]: revision }),
    namespaceRevision: revision,
    compositionFingerprint: canonicalJsonStringify({
      topology: 'namespace',
      root: { id: source.id, uri: source.uri },
      revision,
    }),
  })
  const target: SubjectEditTarget = Object.freeze({
    targetId: source.id,
    subjectUri: uri,
    ownerSource: source,
    semanticPath: Object.freeze([]),
    expectedRevision,
  })
  return Object.freeze({ rootId, sourcePath, target })
}

function proposal(
  mode: 'replace' | 'create',
  path: string,
  guards: DataEditPlanProposal['target']['guards'],
): DataEditPlanProposal {
  return Object.freeze({
    schemaVersion: 1,
    target: Object.freeze({
      state: 'resolved',
      schemaVersion: 1,
      snapshotId: 'snapshot-1',
      workspaceId: 'workspace-1',
      selectedRootId: 'C',
      writableRootIds: Object.freeze(['C']),
      subject: Object.freeze({ namespace: 'unit', entityId: 'Marine' }),
      fieldPath: Object.freeze(['LifeMax']),
      action: mode === 'replace' ? 'create-local-field' : 'declare-local-entity',
      target: Object.freeze({ rootId: 'C', path, mode }),
      candidates: Object.freeze([]),
      selectionReason:
        mode === 'replace' ? 'last-local-declaration' : 'canonical-namespace-document',
      guards,
    }),
    intent: Object.freeze({ kind: 'set-field', value: '60' }),
    replacementText: '<Catalog><CUnit id="Marine"><LifeMax value="60"/></CUnit></Catalog>',
    previewSnapshotId: 'preview-1',
    expectedEffectiveValue: '60',
    diagnostics: Object.freeze([]),
  })
}

describe('resolved SC2 data edit binding', () => {
  it('binds the exact strict document when another spelling has the same revision', () => {
    const upper = {
      ...fileTarget('C', 'C.SC2Mod/Data/Unit.xml', 'file:///C.SC2Mod/Data/Unit.xml', 'same'),
      caseSensitive: true,
    }
    const lower = {
      ...fileTarget('C', 'C.SC2Mod/Data/unit.xml', 'file:///C.SC2Mod/Data/unit.xml', 'same'),
      caseSensitive: true,
    }
    const change = editChangeFromDataEditProposal(
      proposal('replace', lower.path, [
        { rootId: 'C', path: lower.path, revision: rev('same'), documentIndex: 1 },
      ]),
      [upper, lower],
      [],
    )
    expect(change.targets.map(target => target.targetId)).toEqual([lower.target.targetId])
    expect(change.edits[0]).toMatchObject({
      operation: 'replace',
      source: lower.target.ownerSource,
    })
    expect(() =>
      editChangeFromDataEditProposal(
        proposal('replace', 'C.SC2Mod/Data/UNIT.XML', [
          { rootId: 'C', path: 'C.SC2Mod/Data/UNIT.XML', revision: rev('same'), documentIndex: 1 },
        ]),
        [upper, lower],
        [],
      ),
    ).toThrow(/no host document binding/u)
  })

  it('confines a created document under the declared strict root spelling', () => {
    const root = { ...namespaceTarget('C', 'C.SC2Mod', 'file:///C.SC2Mod'), caseSensitive: true }
    expect(() =>
      editChangeFromDataEditProposal(proposal('create', 'c.sc2mod/Data/Unit.xml', []), [], [root]),
    ).toThrow(/outside writable root/u)
    expect(
      editChangeFromDataEditProposal(proposal('create', 'C.SC2Mod/Data/Unit.xml', []), [], [root])
        .edits[0],
    ).toMatchObject({
      operation: 'create',
      newPath: 'Data/Unit.xml',
      source: root.target.ownerSource,
    })
  })

  it('replaces the selected C document and retains A and C as revision guards', () => {
    const a = fileTarget('A', 'A.SC2Mod/Base.SC2Data/GameData/UnitData.xml', 'file:///A.xml', 'a1')
    const c = fileTarget('C', 'C.SC2Mod/Base.SC2Data/GameData/UnitData.xml', 'file:///C.xml', 'c1')
    const plan = editChangeFromDataEditProposal(
      proposal('replace', c.path, [
        { rootId: 'A', path: a.path, revision: rev('a1'), documentIndex: 0 },
        { rootId: 'C', path: c.path, revision: rev('c1'), documentIndex: 1 },
      ]),
      [a, c],
      [namespaceTarget('C', 'C.SC2Mod', 'file:///C.SC2Mod')],
    )

    expect(plan.targets.map(target => target.targetId)).toEqual(['file:///A.xml', 'file:///C.xml'])
    expect(plan.edits).toEqual([
      expect.objectContaining({
        operation: 'replace',
        targetId: 'file:///C.xml',
        source: { id: 'file:///C.xml', uri: 'file:///C.xml' },
      }),
    ])
  })

  it('creates a missing local declaration inside the exact active mod namespace', () => {
    const a = fileTarget('A', 'A.SC2Mod/Base.SC2Data/GameData/UnitData.xml', 'file:///A.xml', 'a1')
    const root = namespaceTarget('C', 'C.SC2Mod', 'file:///C.SC2Mod')
    const path = 'C.SC2Mod/Base.SC2Data/GameData/UnitData.xml'
    const plan = editChangeFromDataEditProposal(
      proposal('create', path, [
        { rootId: 'A', path: a.path, revision: rev('a1'), documentIndex: 0 },
      ]),
      [a],
      [root],
    )

    expect(plan.targets.map(target => target.targetId)).toEqual([
      'file:///A.xml',
      root.target.targetId,
    ])
    expect(plan.edits).toEqual([
      expect.objectContaining({
        operation: 'create',
        targetId: root.target.targetId,
        newPath: 'Base.SC2Data/GameData/UnitData.xml',
      }),
    ])
  })

  it('refuses stale guards and paths outside the selected writable root', () => {
    const a = fileTarget('A', 'A.SC2Mod/Base.SC2Data/GameData/UnitData.xml', 'file:///A.xml', 'a2')
    expect(() =>
      editChangeFromDataEditProposal(
        proposal('replace', a.path, [
          { rootId: 'A', path: a.path, revision: rev('a1'), documentIndex: 0 },
        ]),
        [a],
        [],
      ),
    ).toThrow('revision changed')

    expect(() =>
      editChangeFromDataEditProposal(
        proposal('create', 'B.SC2Mod/Base.SC2Data/GameData/UnitData.xml', []),
        [],
        [namespaceTarget('C', 'C.SC2Mod', 'file:///C.SC2Mod')],
      ),
    ).toThrow('outside writable root')
  })

  it('binds clone and rewire replacements into one guarded ChangeSet', () => {
    const a = fileTarget('A', 'A.SC2Mod/Base.SC2Data/GameData/UnitData.xml', 'file:///A.xml', 'a1')
    const c = fileTarget('C', 'C.SC2Mod/Base.SC2Data/GameData/UnitData.xml', 'file:///C.xml', 'c1')
    const root = namespaceTarget('C', 'C.SC2Mod', 'file:///C.SC2Mod')
    const isolation: DataGraphIsolationPlanProposal = {
      schemaVersion: 1,
      state: 'planned',
      analysis: {
        schemaVersion: 1,
        state: 'ready',
        owner: { namespace: 'Unit', entityId: 'Marine' },
        target: { namespace: 'Weapon', entityId: 'GaussRifle' },
        ownerFieldPath: ['WeaponArray', '0', 'Link'],
        shared: true,
        cloneRequired: true,
        referrers: [],
        otherReferrers: [{ namespace: 'Unit', entityId: 'Marauder' }],
        rewireFieldPaths: [['WeaponArray', '0', 'Link']],
      },
      snapshotId: 'snapshot-1',
      workspaceId: 'workspace-1',
      selectedRootId: 'C',
      writableRootIds: ['C'],
      clone: { namespace: 'Weapon', entityId: 'MarineGaussRifle' },
      guards: [
        { rootId: 'A', path: a.path, revision: rev('a1'), documentIndex: 0 },
        { rootId: 'C', path: c.path, revision: rev('c1'), documentIndex: 1 },
      ],
      replacements: [
        {
          purpose: 'rewire',
          target: { rootId: 'C', path: c.path, documentIndex: 1, mode: 'replace' },
          replacementText: '<Catalog><CUnit id="Marine"/></Catalog>',
        },
        {
          purpose: 'clone',
          target: {
            rootId: 'C',
            path: 'C.SC2Mod/Base.SC2Data/GameData/WeaponData.xml',
            mode: 'create',
          },
          replacementText: '<Catalog><CWeaponLegacy id="MarineGaussRifle"/></Catalog>',
        },
      ],
      previewSnapshotId: 'preview-1',
      diagnostics: [],
    }
    const change = isolationChangeFromDataGraphProposal(isolation, [a, c], [root])
    expect(change.targets.map(target => target.targetId)).toEqual([
      'file:///A.xml',
      'file:///C.xml',
      'file:///C.SC2Mod',
    ])
    expect(change.edits).toEqual([
      expect.objectContaining({ operation: 'replace', targetId: 'file:///C.xml' }),
      expect.objectContaining({
        operation: 'create',
        targetId: 'file:///C.SC2Mod',
        newPath: 'Base.SC2Data/GameData/WeaponData.xml',
      }),
    ])
    const caseDistinct: DataGraphIsolationPlanProposal = {
      ...isolation,
      guards: [],
      replacements: isolation.replacements.map((replacement, index) => ({
        ...replacement,
        target: {
          rootId: 'C',
          path: index === 0 ? 'C.SC2Mod/Data/Unit.xml' : 'C.SC2Mod/Data/unit.xml',
          mode: 'create',
        },
      })),
    }
    const strict = { ...root, caseSensitive: true }
    expect(isolationChangeFromDataGraphProposal(caseDistinct, [], [strict]).edits).toEqual([
      expect.objectContaining({ operation: 'create', newPath: 'Data/Unit.xml' }),
      expect.objectContaining({ operation: 'create', newPath: 'Data/unit.xml' }),
    ])
    expect(() => isolationChangeFromDataGraphProposal(caseDistinct, [], [root])).toThrow(
      /duplicate targets/u,
    )
    expect(() =>
      isolationChangeFromDataGraphProposal(
        {
          ...caseDistinct,
          replacements: [
            caseDistinct.replacements[0]!,
            {
              ...caseDistinct.replacements[1]!,
              target: { rootId: 'C', path: 'C.SC2Mod\\Data\\Unit.xml', mode: 'create' },
            },
          ],
        },
        [],
        [strict],
      ),
    ).toThrow(/duplicate targets/u)
  })
})
