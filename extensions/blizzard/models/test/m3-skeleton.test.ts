import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import {
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import type { ResourceBudget } from '@modkitx-x3/sdk'
import { proves } from '@modkitx-x3/testkit'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'
import { M3SectionList } from '../src/m3/native/binary/sections.js'
import { installM3PlatformAdapters } from '../src/m3/native/platform.js'

installM3PlatformAdapters({ DOMParser })

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..')
const MODEL_PATH =
  'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'
const MODEL_BYTES = 60_128
const MODEL_SHA256 = 'fb7680019ca7ec88aeb37591a7477c2555dd674d57f0c7486736ccb11919a436'
const MODEL_BONES = 12
const MODEL_ROOTS = 12

const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'm3-skeleton-preflight', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

const executionBackends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(context) {
      return {
        module: (await import(context.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function referencedString(sections: M3SectionList, reference: unknown): string | null {
  if (reference === null || typeof reference !== 'object') return null
  const value = reference as { readonly entries?: unknown; readonly index?: unknown }
  if (!Number.isInteger(value.entries) || Number(value.entries) <= 0) return null
  if (!Number.isInteger(value.index) || Number(value.index) < 0) return null
  const section = sections.getSectionByReference(value)
  if (section?.desc.history.name !== 'CHAR') return null
  const content = section.content
  if (!Array.isArray(content) || content.length < Number(value.entries)) return null
  const bytes = Uint8Array.from(content.slice(0, Number(value.entries)), item => Number(item))
  const zero = bytes.indexOf(0)
  const bounded = zero < 0 ? bytes : bytes.subarray(0, zero)
  return new TextDecoder('utf-8', { fatal: true }).decode(bounded)
}

async function inventory() {
  const inputs = await Promise.all(
    [
      ['blizzard', 'casc'],
      ['blizzard', 'models'],
    ].map(async parts => ({
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  return buildInventory(inputs, createHostContributionContractRegistry())
}

describe('M3 skeleton corpus preflight', () => {
  const sc2Root = process.env['MODKITX_SC2_ROOT']?.trim()
  const installed = sc2Root !== undefined && existsSync(join(sc2Root, '.build.info'))

  it.skipIf(!installed)(
    'pins a named BONE table reached through the host/CASC route',
    async () => {
      if (sc2Root === undefined) throw new TypeError('MODKITX_SC2_ROOT is not set')
      const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      const mount = await vfs.openMount(pathToFileURL(sc2Root).href)
      const casc = await openSubject({
        inventory: await inventory(),
        source: artifactNamespaceSourceFromVfsMount(mount),
        path: sc2Root,
        intent: 'full',
        target,
        grant,
        budget,
        executionBackends,
      })
      if (casc.state !== 'opened') {
        throw new Error(
          `CASC did not open: ${JSON.stringify({
            state: casc.state,
            reason: casc.reason,
            candidates: casc.candidates,
            diagnostics: casc.diagnostics,
          }).slice(0, 4000)}`,
        )
      }
      try {
        const extracted = await casc.session
          .operations()
          .invoke('extract-entry', { entryId: MODEL_PATH })
        if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
          throw new Error(`CASC extraction failed for ${MODEL_PATH}`)
        }
        const bytes = extracted.output.value
        const xml = await readFile(
          join(
            repoRoot,
            'extensions',
            'blizzard',
            'models',
            'src',
            'm3',
            'native',
            'structures.xml',
          ),
          'utf8',
        )
        const sections = await M3SectionList.load(arrayBufferOf(bytes), xml)
        const boneSection = sections.getSectionByReference(sections.model?.bones)
        const bones = boneSection?.content ?? []
        const names = bones.map(bone => referencedString(sections, bone.name))
        const rejectedParents = bones.filter((bone, index) => {
          const parent = Number(bone.parent ?? -1)
          return parent < -1 || parent >= bones.length || parent === index
        }).length
        const roots = bones.filter(bone => Number(bone.parent ?? -1) === -1).length
        const digest = createHash('sha256').update(bytes).digest('hex')

        expect(MODEL_PATH).not.toMatch(/^(?:[A-Za-z]:|[\\/]|[a-z][a-z0-9+.-]*:)/u)
        expect(bytes.byteLength).toBe(MODEL_BYTES)
        expect(digest).toBe(MODEL_SHA256)
        expect(boneSection?.desc.history.name).toBe('BONE')
        expect(bones.length).toBe(MODEL_BONES)
        expect(
          names.filter((name): name is string => name !== null && name.length > 0).length,
        ).toBe(bones.length)
        expect(roots).toBe(MODEL_ROOTS)
        expect(rejectedParents).toBe(0)
        console.info(
          `[sc2-live] ${MODEL_PATH}: bytes=${bytes.byteLength}, sha256=${digest}, ` +
            `bones=${bones.length}, named=${names.filter(Boolean).length}, roots=${roots}, ` +
            `rejectedParents=${rejectedParents}`,
        )
        proves({
          contributionId: 'org.modkitx/m3',
          operation: 'inspect',
          test: 'extensions/blizzard/models/test/m3-skeleton.test.ts',
          note: 'the live CASC sample contains a fully named BONE table reached through MODL.bones',
        })
      } finally {
        await casc.session.dispose()
      }
    },
    300_000,
  )
})
