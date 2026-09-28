import { describe, expect, it } from 'vitest'
import type { AssetInput } from '@modkit/sdk'
import { editPlanFromBindings, replaceBytes } from '../src/editing.js'

const binding = (id: string, ownership: 'owned' | 'companion' = 'owned') => ({
  bindingId: id,
  ownership,
  source: { id: `source-${id}`, uri: `file:///mod/${id}.SC2Data/LocalizedData/GameStrings.txt` },
  revision: `revision-${id}`,
})
const input = {
  originKind: 'bundle',
  primaryBindingId: 'enUS',
  bindings: [binding('enUS'), binding('ruRU'), binding('deDE', 'companion')],
} as unknown as AssetInput
const fidelity = { claim: 'byte-identical-except-edited' } as never

describe('one atomic plan over several owned bindings', () => {
  it('sends each edit to the owner it names and keeps every member a revision guard', () => {
    const plan = editPlanFromBindings(input, ['enUS', 'ruRU'], {
      planId: 'rename-key',
      fidelity,
      edits: [
        { ...replaceBytes(0, 4, Uint8Array.of(1)), targetId: 'enUS' },
        { ...replaceBytes(0, 4, Uint8Array.of(2)), targetId: 'ruRU' },
      ],
    })
    expect(plan.targets.map(target => target.targetId)).toEqual(['enUS', 'ruRU', 'deDE'])
    expect(plan.edits.map(edit => [edit.targetId, edit.source?.id])).toEqual([
      ['enUS', 'source-enUS'],
      ['ruRU', 'source-ruRU'],
    ])
    expect(plan.semantics.minimumGuarantee).toBe('atomic')
  })

  it('refuses an edit without its owner, a companion owner and a repeated owner', () => {
    const edit = replaceBytes(0, 1, Uint8Array.of(1))
    const options = { planId: 'bad', fidelity, edits: [edit] }
    expect(() => editPlanFromBindings(input, ['enUS', 'ruRU'], options)).toThrow('different owner')
    expect(() => editPlanFromBindings(input, ['enUS', 'deDE'], options)).toThrow('owned binding')
    expect(() => editPlanFromBindings(input, ['enUS', 'enUS'], options)).toThrow('owned binding')
    expect(editPlanFromBindings(input, ['ruRU'], options).edits[0]?.targetId).toBe('ruRU')
  })
})
