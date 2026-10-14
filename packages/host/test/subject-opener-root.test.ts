import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { revisionId } from '@modkit/sdk'
import type { ContentSources, ModContextRequest } from '@modkit/vfs/content-sources'
import type { CompanionOrigin } from '../src/input-resolution.js'
import { createPathSubjectOpener } from '../src/node/subject-opener.js'
import type { SubjectInputResolver } from '../src/subject-open.js'
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

it('passes the path-specific base mod setting to a loose file resource origin', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'modkit-base-mod-subject-'))
  temporary.push(folder)
  const file = join(folder, 'model.bin')
  await writeFile(file, Uint8Array.of(1))
  const targets: string[] = []
  const contexts: ModContextRequest[] = []
  const contentSources = {
    async snapshot() { return { label: 'test', regions: [], connections: [], roots: [] } },
    async openModContext(request: ModContextRequest) {
      contexts.push(request)
      return {
        schemaVersion: 1,
        gameId: 'example/game',
        contextId: 'empty',
        layers: [],
        unresolved: [],
        diagnostics: [],
        files: async () => ({ items: [] }),
        read: async () => new Uint8Array(),
        locate: async () => undefined,
        dispose: async () => {},
      }
    },
  } as unknown as ContentSources
  const subjects = {
    inventory: { extensions: [], diagnostics: [] },
    async open(request: { resolveInput?: SubjectInputResolver }) {
      const resources = request.resolveInput?.openResources?.({
        revision: revisionId('provider-token:base-mod-test'),
      })
      expect(resources).toBeDefined()
      await resources!.resolve({
        id: 'material',
        logicalId: 'missing.dds',
        role: 'sidecar',
        scopes: ['workspace-dependency-layer'],
      })
      await resources!.dispose()
      return { state: 'unresolved', reason: 'no-candidate', candidates: [], diagnostics: [] }
    },
  } as unknown as SubjectServices
  await createPathSubjectOpener({
    subjects,
    roots: [folder],
    contentSources,
    baseMods: path => {
      targets.push(path)
      return { '*': ['Mods/Liberty.SC2Mod'] }
    },
  })(file)
  expect(targets).toEqual([file])
  expect(contexts).toEqual([{
    schemaVersion: 1,
    target: file,
    baseMods: ['Mods/Liberty.SC2Mod'],
  }])
})
