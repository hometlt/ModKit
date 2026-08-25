import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  artifactByteSourceFromRandomAccess,
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  openSubject,
} from '@modkitx-x3/host'
import { loadExtensionDirectory, openFileSource } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type ModelSceneSource,
  type NamespaceEntry,
  type NamespaceEntrySource,
  type RasterImageSource,
  type ResourceBudget,
  type TableDataSource,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
/**
 * Kane's Wrath root, under its precise name.
 *
 * MODKITX_CNC3_ROOT named the engine, not the dialect, and the two SAGE corpora need separate
 * roots — so the exact name wins and the old one is read only when the new one is unset, with a
 * warning. A silent fallback would let a machine keep running on the deprecated name forever.
 */
function kanesWrathRoot(): string | undefined {
  const exact = process.env['MODKITX_CNC3_KW_ROOT']?.trim()
  if (exact !== undefined && exact !== '') return exact
  const alias = process.env['MODKITX_CNC3_ROOT']?.trim()
  if (alias === undefined || alias === '') return undefined
  console.warn(
    'deprecated alias MODKITX_CNC3_ROOT used for MODKITX_CNC3_KW_ROOT; set MODKITX_CNC3_KW_ROOT instead',
  )
  return alias
}
const cncRoot = kanesWrathRoot()
const requiredArchive = 'Core/1.0/Libraries.big'
const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const budget: ResourceBudget = {
  maxInputBytes: 16_000_000n,
  maxDepth: 128,
  maxNodes: 100_000,
  maxScalarBytes: 8_000_000,
  maxDiagnostics: 100,
}

const samples = {
  localization: {
    archive: 'Lang-english/1.0/English.big',
    entry: 'cnc3.csf',
    format: 'cnc3-localization',
  },
  map: {
    archive: requiredArchive,
    entry: 'libraries/lib_end_mission/lib_end_mission.map',
    format: 'cnc3-map',
  },
  data: {
    archive: requiredArchive,
    entry: 'libraries/lib_end_mission/map.xml',
    format: 'cnc3-data',
  },
  model: {
    archive: 'Core/1.0/Misc.big',
    entry: 'data/editor/molds/bowl.w3d',
    format: 'westwood-w3d',
  },
  raster: {
    archive: requiredArchive,
    entry: 'libraries/lib_mg_tacticalplay_campaign/lib_mg_tacticalplay_campaign.tga',
    format: 'tga',
  },
} as const

function memorySource(bytes: Uint8Array, name: string): ArtifactByteSource {
  const uri = `memory://cnc3-live/${encodeURIComponent(name)}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(
      `provider-token:${encodeURIComponent(`cnc3-live:${name}:${bytes.byteLength}`)}`,
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

function storedBigEntry(bytes: Uint8Array, wantedPath: string) {
  if (bytes.byteLength < 16) throw new TypeError('real BIG fixture is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(8, false)
  const dataOffset = view.getUint32(12, false)
  let cursor = 16
  for (let index = 0; index < count; index += 1) {
    if (cursor + 8 > dataOffset) throw new TypeError('real BIG fixture index is truncated')
    const offset = view.getUint32(cursor, false)
    const storedSize = view.getUint32(cursor + 4, false)
    cursor += 8
    let end = cursor
    while (end < dataOffset && bytes[end] !== 0) end += 1
    if (end >= dataOffset) throw new TypeError('real BIG fixture name is unterminated')
    const path = new TextDecoder().decode(bytes.subarray(cursor, end)).replaceAll('\\', '/')
    cursor = end + 1
    if (path.toLocaleLowerCase() === wantedPath.toLocaleLowerCase()) {
      if (offset + storedSize > bytes.byteLength)
        throw new TypeError('real BIG fixture entry is truncated')
      return Object.freeze({ id: String(index), offset, storedSize })
    }
  }
  throw new TypeError(`${wantedPath} is absent from the real BIG fixture`)
}

describe('installed C&C 3: Kane’s Wrath product vertical', () => {
  it.skipIf(
    cncRoot === undefined || !existsSync(join(cncRoot ?? '', ...requiredArchive.split('/'))),
  )(
    'opens BIG entries again as localization, map, data, model, and raster subjects',
    async () => {
      if (cncRoot === undefined) throw new TypeError('MODKITX_CNC3_KW_ROOT is not set')
      console.info(`[cnc3-live] root ${cncRoot}`)
      const directories = [
        ['ea', 'big'],
        ['ea', 'sage'],
        ['ea', 'models'],
        ['common', 'images'],
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

      const openNested = async (bytes: Uint8Array, path: string, expectedFormat: string) => {
        const nested = await openSubject({
          inventory,
          source: memorySource(bytes, path),
          path,
          intent: 'full',
          target,
          grant: { id: `cnc3-live-${expectedFormat}`, classes: ['read-source'] },
          executionBackends,
          budget,
        })
        if (nested.state !== 'opened') {
          throw new Error(
            `nested ${expectedFormat} open failed: ${nested.reason} ${JSON.stringify(nested.candidates)}`,
          )
        }
        expect(nested.descriptor).toMatchObject({ identity: { formatId: expectedFormat } })
        return nested
      }

      const extract = async (
        archivePath: string,
        entryPath: string,
        resourceBudget: ResourceBudget = budget,
      ): Promise<{ bytes: Uint8Array; entry: NamespaceEntry }> => {
        console.info(`[cnc3-live] ${archivePath} -> ${entryPath}`)
        const random = await openFileSource(join(cncRoot, ...archivePath.split('/')))
        try {
          const source = await artifactByteSourceFromRandomAccess(random, {
            ref: { id: random.id, uri: random.id },
            revision: revisionId(
              `provider-token:${encodeURIComponent(`cnc3-live:${archivePath}`)}`,
            ),
          })
          const archive = await openSubject({
            inventory,
            source,
            path: archivePath,
            intent: 'full',
            target,
            grant: { id: `cnc3-live-big-${archivePath}`, classes: ['read-source'] },
            executionBackends,
            budget: resourceBudget,
          })
          if (archive.state !== 'opened')
            throw new Error(`BIG open failed for ${archivePath}: ${archive.reason}`)
          try {
            expect(archive.descriptor).toMatchObject({ identity: { formatId: 'big' } })
            const lease = await archive.session.dataSource('common.view/namespace-entry-source', 1)
            try {
              const namespace = lease.value as NamespaceEntrySource
              const page = await namespace.list('', { limit: 10_000 })
              const entry = page.items.find(
                item => item.path.toLocaleLowerCase() === entryPath.toLocaleLowerCase(),
              )
              if (entry === undefined) throw new Error(`${entryPath} is absent from ${archivePath}`)
              const cancelled = new AbortController()
              cancelled.abort()
              await expect(
                namespace.list('', { limit: 1 }, cancelled.signal),
              ).rejects.toMatchObject({ name: 'AbortError' })
              await expect(
                archive.session.operations().invoke('extract-entry', { entryId: 'missing' }),
              ).rejects.toThrow(/not found/u)
              const output = await archive.session
                .operations()
                .invoke('extract-entry', { entryId: entry.id })
              if (output.state !== 'ok' || output.output.kind !== 'bytes')
                throw new Error(`BIG extraction failed for ${entryPath}`)
              return { bytes: output.output.value, entry }
            } finally {
              await lease.release()
            }
          } finally {
            await archive.session.dispose()
          }
        } finally {
          await random.dispose()
        }
      }

      const localizationBytes = await extract(
        samples.localization.archive,
        samples.localization.entry,
      )
      await expect(
        extract(samples.localization.archive, samples.localization.entry, {
          ...budget,
          maxScalarBytes: 16,
        }),
      ).rejects.toThrow(/scalar budget/u)
      const localization = await openNested(
        localizationBytes.bytes,
        samples.localization.entry,
        samples.localization.format,
      )
      try {
        const lease = await localization.session.dataSource('common.view/table-data-source', 1)
        try {
          const shape = await (lease.value as TableDataSource).shape()
          expect(shape.rows).not.toBe('unknown')
          expect(shape.rows).toBeGreaterThan(7_000)
          console.info(`[cnc3-live] localization rows ${shape.rows}`)
        } finally {
          await lease.release()
        }
      } finally {
        await localization.session.dispose()
      }

      const mapBytes = await extract(samples.map.archive, samples.map.entry)
      const map = await openNested(mapBytes.bytes, samples.map.entry, samples.map.format)
      try {
        const lease = await map.session.dataSource('common.view/namespace-entry-source', 1)
        try {
          const page = await (lease.value as NamespaceEntrySource).list('', { limit: 1_000 })
          expect(page.items.length).toBeGreaterThan(0)
          console.info(`[cnc3-live] map chunks ${page.items.length}`)
        } finally {
          await lease.release()
        }
      } finally {
        await map.session.dispose()
      }

      const dataBytes = await extract(samples.data.archive, samples.data.entry)
      expect(dataBytes.entry.compression).toBe('refpack')
      const corruptBig = new Uint8Array(
        await readFile(join(cncRoot, ...samples.data.archive.split('/'))),
      )
      const corruptEntry = storedBigEntry(corruptBig, samples.data.entry)
      expect((corruptBig[corruptEntry.offset] ?? 0) & 0x3e).toBe(0x10)
      expect(corruptBig[corruptEntry.offset + 1]).toBe(0xfb)
      corruptBig[corruptEntry.offset + corruptEntry.storedSize - 1] = 0
      const corruptArchive = await openSubject({
        inventory,
        source: memorySource(corruptBig, 'corrupt-libraries.big'),
        path: 'corrupt-libraries.big',
        intent: 'full',
        target,
        grant: { id: 'cnc3-live-corrupt-big', classes: ['read-source'] },
        executionBackends,
        budget,
      })
      if (corruptArchive.state !== 'opened')
        throw new Error(`corrupt BIG did not reach extraction: ${corruptArchive.reason}`)
      try {
        await expect(
          corruptArchive.session.operations().invoke('extract-entry', { entryId: corruptEntry.id }),
        ).rejects.toThrow(/RefPack/u)
      } finally {
        await corruptArchive.session.dispose()
      }
      const data = await openNested(dataBytes.bytes, samples.data.entry, samples.data.format)
      try {
        const lease = await data.session.dataSource('common.view/tree-data-source', 1)
        try {
          const tree = lease.value as TreeDataSource
          expect(
            (await tree.children(await tree.root(), { limit: 100 })).items.length,
          ).toBeGreaterThan(0)
        } finally {
          await lease.release()
        }
      } finally {
        await data.session.dispose()
      }

      const modelBytes = await extract(samples.model.archive, samples.model.entry)
      const model = await openNested(modelBytes.bytes, samples.model.entry, samples.model.format)
      try {
        const lease = await model.session.dataSource('common.view/model-scene-source', 1)
        try {
          const info = await (lease.value as ModelSceneSource).info()
          expect(info.scenes).toBe(1)
          expect(info.nodes).toBeGreaterThan(0)
          console.info(
            `[cnc3-live] W3D geometry ${info.geometryAccess}, meshes ${info.meshes}, primitives ${info.primitives}`,
          )
        } finally {
          await lease.release()
        }
      } finally {
        await model.session.dispose()
      }

      const rasterBytes = await extract(samples.raster.archive, samples.raster.entry)
      const raster = await openNested(
        rasterBytes.bytes,
        samples.raster.entry,
        samples.raster.format,
      )
      try {
        const lease = await raster.session.dataSource('common.view/raster-image-source', 1)
        try {
          const image = lease.value as RasterImageSource
          const info = await image.info()
          expect(info.width).toBeGreaterThan(0)
          expect(info.height).toBeGreaterThan(0)
          if (image.readRegion === undefined) throw new Error('real TGA has no decoded pixel path')
          expect(
            (
              await image.readRegion({
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                pixelFormat: 'rgba8',
                maxBytes: 4,
              })
            ).pixels,
          ).toHaveLength(4)
          console.info(`[cnc3-live] TGA ${info.width}x${info.height}, decoded RGBA8`)
        } finally {
          await lease.release()
        }
      } finally {
        await raster.session.dispose()
      }

      expect(pathToFileURL(cncRoot).protocol).toBe('file:')
    },
    60_000,
  )
})
