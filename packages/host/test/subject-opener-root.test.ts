import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CompanionOrigin } from '../src/input-resolution.js'
import { createPathSubjectOpener } from '../src/node/subject-opener.js'
import type { SubjectServices } from '../src/subject-services.js'

const temporary: string[] = []
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})

it('gives a granted root its mod layers and the product origins as companions, not its directory', async () => {
  // a mod folder opened as the workspace: the root itself is the subject
  const folder = await mkdtemp(join(tmpdir(), 'modkit-root-subject-'))
  temporary.push(folder)
  const requests: { resolveInput?: unknown }[] = []
  const subjects = {
    inventory: { extensions: [], diagnostics: [] },
    async open(request: { resolveInput?: unknown }) {
      requests.push(request)
      return { state: 'unresolved', reason: 'no-candidate', candidates: [], diagnostics: [] }
    },
  } as unknown as SubjectServices
  const layers: CompanionOrigin = {
    primaryLogicalId: 'mod',
    caseSensitivity: 'insensitive',
    scopes: ['workspace-dependency-layer'],
    async *enumerate() {},
    async open() {
      throw new RangeError('nothing here')
    },
  }
  await createPathSubjectOpener({ subjects, roots: [folder], assetOrigins: [layers] })(folder)
  expect(requests[0]?.resolveInput).toBeDefined()
  // without any origin the root opens without companions, as before
  await createPathSubjectOpener({ subjects, roots: [folder] })(folder)
  expect(requests[1]?.resolveInput).toBeUndefined()
})
