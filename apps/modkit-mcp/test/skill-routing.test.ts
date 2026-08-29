import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const codingRoot = resolve(import.meta.dirname, '..', '..', '..', '..')
const requiredOrder = [
  'modkit.open_subject',
  'modkit.inspect',
  'modkit.list_subjects',
  'modkit.select_subject',
  'modkit.subject_facts',
  'modkit.subject_calculations',
  'modkit.close_selected_subject',
  'modkit.close_subject',
]

const skills = [
  {
    name: 'modkit-core',
    root: join(codingRoot, 'modkitX3', '.agents', 'skills', 'modkit-core'),
  },
  {
    name: 'modkit-sc2',
    root: join(codingRoot, 'modkit-blizzard', '.agents', 'skills', 'modkit-sc2'),
  },
  {
    name: 'modkit-warzone',
    root: join(codingRoot, 'modkit-warzone', '.agents', 'skills', 'modkit-warzone'),
  },
] as const

describe('Product-GA inspection skill routing', () => {
  it.each(skills)(
    '$name uses the same bounded read-only entity lifecycle',
    async ({ name, root }) => {
      const [skill, rawContract] = await Promise.all([
        readFile(join(root, 'SKILL.md'), 'utf8'),
        readFile(join(root, 'references', 'routing-contract.json'), 'utf8'),
      ])
      const contract = JSON.parse(rawContract) as {
        readonly schemaVersion: number
        readonly skill: string
        readonly authority: string
        readonly readOnly: boolean
        readonly requiredOrder: readonly string[]
        readonly forbidden: Readonly<Record<string, boolean>>
      }
      expect(contract).toMatchObject({
        schemaVersion: 1,
        skill: name,
        authority: 'modkit-mcp',
        readOnly: true,
        requiredOrder,
        forbidden: {
          directArchiveParsing: true,
          guessedSubjectIds: true,
          mutation: true,
        },
      })
      expect(skill).toContain(
        '[references/routing-contract.json](references/routing-contract.json)',
      )
      for (const tool of requiredOrder) expect(skill).toContain(`\`${tool}\``)
    },
  )
})
