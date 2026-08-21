import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  artifactNamespaceSourceFromVfsMount,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type NamespaceEntrySource,
  type ResourceBudget,
} from '@modkitx-x3/sdk'
import { VirtualFileSystem } from '@modkitx-x3/vfs'
import { createFileVfsProvider } from '@modkitx-x3/vfs/providers/file'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const sc2Override = process.env.MODKITX_SC2_ROOT?.trim()
const sc2Root = sc2Override ? sc2Override : 'C:\\Apps\\StarCraft II'
const buildInfoPath = join(sc2Root, '.build.info')
const m3Path =
  'campaigns/liberty.sc2campaign/base.sc2assets/assets/campaign/terran/artifact1/artifact1.m3'
const ddsPath = 'campaigns/liberty.sc2campaign/base.sc2assets/assets/textures/alpha2.dds'
const mpqPath =
  'mods/liberty.sc2mod/base.sc2data/battlenetcache/fc2161abf876306f1a0467cfacf5e513cba4281fdc13532b440e8c8abb8835ac.s2ma'

const budget: ResourceBudget = {
  maxInputBytes: 268_435_456n,
  maxDepth: 128,
  maxNodes: 750_000,
  maxScalarBytes: 134_217_728,
  maxDiagnostics: 100,
}

function memorySource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://sc2-casc/${encodeURIComponent(name)}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(
      `provider-token:${encodeURIComponent(`sc2-casc:${name}:${bytes.byteLength}`)}`,
    ),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream(range, signal) {
      if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
      const offset = Number(range?.offset ?? 0n)
      const length = Number(range?.length ?? BigInt(bytes.byteLength - offset))
      yield bytes.slice(offset, offset + length)
    },
  }
}

describe('installed StarCraft II CASC product path', () => {
  it.skipIf(!existsSync(buildInfoPath))(
    'opens CASC and reopens nested M3, DDS and MPQ bytes through Host',
    async () => {
      const before = statSync(buildInfoPath)
      const directories = [
        ['mk2', 'blizzard-casc'],
        ['mk2', 'blizzard-models'],
        ['mk2', 'blizzard-mpq'],
        ['mk2', 'common-images'],
      ]
      const inputs = await Promise.all(
        directories.map(parts => loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
      )
      const inventory = await buildInventory(
        inputs.map(input => ({
          ...input,
          execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
        })),
        createHostContributionContractRegistry(),
      )
      const executionBackends = createExecutionBackendRegistry([
        TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
      ])
      const vfs = new VirtualFileSystem().registerProvider(createFileVfsProvider())
      const mount = await vfs.openMount(pathToFileURL(sc2Root).href)
      const casc = await openSubject({
        inventory,
        source: artifactNamespaceSourceFromVfsMount(mount),
        path: 'StarCraft II',
        intent: 'full',
        target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
        grant: { id: 'sc2-casc-real', classes: ['read-source'] },
        executionBackends,
        budget,
      })
      try {
        if (casc.state !== 'opened') {
          throw new Error(
            `CASC open failed: ${casc.reason} ${JSON.stringify({ candidates: casc.candidates, diagnostics: casc.diagnostics })}`,
          )
        }
        expect(casc.selected).toMatchObject({
          contributionId: 'org.modkitx/casc',
          confidence: 0.99,
        })
        expect(casc.descriptor).toMatchObject({
          identity: { formatId: 'casc' },
          constraints: { readOnly: true, randomAccess: false },
        })

        const namespaceLease = await casc.session.dataSource(
          'common.view/namespace-entry-source',
          1,
        )
        try {
          const namespace = namespaceLease.value as NamespaceEntrySource
          const first = await namespace.list('campaigns/liberty.sc2campaign/', { limit: 1 })
          expect(first.items).toHaveLength(1)
          expect(first.nextCursor).toBeDefined()
          if (first.nextCursor === undefined) throw new Error('CASC first page had no cursor')
          const second = await namespace.list('campaigns/liberty.sc2campaign/', {
            cursor: first.nextCursor,
            limit: 1,
          })
          expect(second.items).toHaveLength(1)
          expect(second.items[0]?.id).not.toBe(first.items[0]?.id)

          const cancelled = new AbortController()
          cancelled.abort()
          await expect(namespace.list('', { limit: 1 }, cancelled.signal)).rejects.toMatchObject({
            name: 'AbortError',
          })
        } finally {
          await namespaceLease.release()
        }

        const reopen = async (path: string, expectedFormat: string): Promise<void> => {
          const extracted = await casc.session
            .operations()
            .invoke('extract-entry', { entryId: path })
          if (extracted.state !== 'ok' || extracted.output.kind !== 'bytes') {
            throw new Error(`CASC extraction failed for ${path}`)
          }
          const nested = await openSubject({
            inventory,
            source: memorySource(extracted.output.value, path),
            path,
            intent: 'full',
            target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
            grant: { id: `sc2-casc-nested-${expectedFormat}`, classes: ['read-source'] },
            executionBackends,
            budget,
          })
          if (nested.state !== 'opened') {
            throw new Error(
              `nested ${expectedFormat} open failed: ${nested.reason} ${JSON.stringify(nested.candidates)}`,
            )
          }
          try {
            expect(nested.descriptor).toMatchObject({ identity: { formatId: expectedFormat } })
            if (expectedFormat === 'mpq') {
              const lease = await nested.session.dataSource('common.view/namespace-entry-source', 1)
              try {
                expect(
                  (await (lease.value as NamespaceEntrySource).list('', { limit: 1 })).items,
                ).not.toHaveLength(0)
              } finally {
                await lease.release()
              }
            }
          } finally {
            await nested.session.dispose()
          }
        }

        await reopen(m3Path, 'm3')
        await reopen(ddsPath, 'dds')
        await reopen(mpqPath, 'mpq')
      } finally {
        if (casc.state === 'opened') await casc.session.dispose()
        await vfs.dispose()
      }
      const after = statSync(buildInfoPath)
      expect({ size: after.size, mtimeMs: after.mtimeMs }).toEqual({
        size: before.size,
        mtimeMs: before.mtimeMs,
      })
    },
    120_000,
  )
})
