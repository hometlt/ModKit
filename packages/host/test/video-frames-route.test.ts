import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import { createHostTopology, type NamespaceEntrySource, type VideoMediaSource } from '@modkit/sdk'
import type { ExtensionInput } from '@modkit/host'
import {
  createNodeSubjectServices,
  createNodeVideoFrameDecoder,
  findFfmpeg,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  openFileArtifactSource,
  workerBackendPolicy,
} from '@modkit/host/node'
import { nestedSubjectServices, openNestedSubject } from '../src/nested-subject.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const scratch = mkdtempSync(join(tmpdir(), 'x3-video-frames-route-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const ffmpeg = findFfmpeg()

/** One ustar member: header (checksum = byte sum with the field as spaces), data padded to 512. */
function tar(name: string, data: Uint8Array): Uint8Array {
  const header = new Uint8Array(512)
  const put = (at: number, text: string) => header.set(new TextEncoder().encode(text), at)
  put(0, name)
  put(100, '0000644\0')
  put(108, '0000000\0')
  put(116, '0000000\0')
  put(124, `${data.byteLength.toString(8).padStart(11, '0')}\0`)
  put(136, '00000000000\0')
  put(148, '        ')
  put(156, '0')
  put(257, 'ustar\u000000')
  const sum = header.reduce((total, value) => total + value, 0)
  put(148, `${sum.toString(8).padStart(6, '0')}\0 `)
  const padded = Math.ceil(data.byteLength / 512) * 512
  const out = new Uint8Array(512 + padded + 1024)
  out.set(header)
  out.set(data, 512)
  return out
}

const HOST = 'org.example.app/host'
const WORKERS = 'org.example.app/workers'
const topology = createHostTopology({
  schemaVersion: 1,
  topologyId: 'org.example.app/video-frames',
  realms: [
    {
      schemaVersion: 1,
      realmId: HOST,
      revision: '1',
      target: nodeRuntimeTargetBase(),
      facilities: ['filesystem.read-random', 'worker.module'],
      budgets: {
        maxConcurrentTasks: 4,
        maxWorkerCount: 2,
        maxResidentBytes: uint64('1073741824'),
        maxTransferBytes: uint64('268435456'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/video', revision: '1' },
    },
    nodeWorkerRealmProfile({
      realmId: WORKERS,
      budgets: {
        maxConcurrentTasks: 2,
        maxWorkerCount: 0,
        maxResidentBytes: uint64('536870912'),
        maxTransferBytes: uint64('134217728'),
        defaultDeadlineMs: 60_000,
      },
      policy: { id: 'org.example.policy/video-worker', revision: '1' },
    }),
  ],
  links: [...nodeWorkerLinks(HOST, WORKERS)],
})

describe('video frames through the host route', () => {
  it.skipIf(ffmpeg === undefined)(
    'a worker-run MP4 codec reads a frame from the host decoder',
    { timeout: 120_000 },
    async () => {
      const path = join(scratch, 'bars.mp4')
      execFileSync(ffmpeg!, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=64x48:rate=10',
        '-t',
        '2',
        '-c:v',
        'mpeg4',
        '-y',
        path,
      ])
      const video: ExtensionInput = {
        ...(await loadExtensionDirectory(join(repoRoot, 'extensions', 'video'))),
        execution: { origin: 'linked', allowTrustedInProcess: false },
      }
      const services = await createNodeSubjectServices({
        topology,
        realms: { host: HOST, workers: WORKERS },
        extensions: [video],
        policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 60_000 }),
      })
      const opened = await services.open({
        source: await openFileArtifactSource(path),
        path,
        intent: 'full',
        grant: { id: 'video-read', classes: ['read-source'] },
        budget: {
          maxInputBytes: 10_000_000n,
          maxDepth: 64,
          maxNodes: 100_000,
          maxScalarBytes: 1_000_000,
          maxDiagnostics: 100,
        },
      })
      if (opened.state !== 'opened') throw new Error(`open failed: ${opened.reason}`)
      const lease = await opened.session.dataSource('common.view/video-media-source', 1)
      try {
        const source = lease.value as VideoMediaSource
        const info = await source.info()
        expect(info.frameAccess).toBe(true)
        const track = info.tracks.find(item => item.kind === 'video')!
        const frame = await source.readFrame!({
          trackId: track.id,
          timestampMs: 500,
          pixelFormat: 'rgba8',
          maxBytes: 64 * 48 * 4,
        })
        expect([frame.width, frame.height, frame.pixelFormat]).toEqual([64, 48, 'rgba8'])
        expect(frame.pixels.some(value => value !== 0)).toBe(true)
      } finally {
        await lease.release()
        await opened.session.dispose?.()
      }
    },
  )

  it.skipIf(ffmpeg === undefined)(
    'an MP4 entry of a container reads frames like an MP4 file',
    { timeout: 120_000 },
    async () => {
      const mp4 = join(scratch, 'entry.mp4')
      execFileSync(ffmpeg!, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=32x24:rate=10',
        '-t',
        '1',
        '-c:v',
        'mpeg4',
        '-y',
        mp4,
      ])
      const path = join(scratch, 'clip.tar')
      writeFileSync(path, tar('clip.mp4', new Uint8Array(readFileSync(mp4))))
      const load = async (directory: string): Promise<ExtensionInput> => ({
        ...(await loadExtensionDirectory(join(repoRoot, 'extensions', directory))),
        execution: { origin: 'linked', allowTrustedInProcess: false },
      })
      const services = await createNodeSubjectServices({
        topology,
        realms: { host: HOST, workers: WORKERS },
        extensions: [await load('archives'), await load('video')],
        policy: workerBackendPolicy({ loadDeadlineMs: 15_000, defaultCallDeadlineMs: 60_000 }),
      })
      const grant = { id: 'video-read', classes: ['read-source' as const] }
      const budget = {
        maxInputBytes: 10_000_000n,
        maxDepth: 64,
        maxNodes: 100_000,
        maxScalarBytes: 1_000_000,
        maxDiagnostics: 100,
      }
      const parent = await services.open({
        source: await openFileArtifactSource(path),
        path,
        intent: 'full',
        grant,
        budget,
      })
      if (parent.state !== 'opened') throw new Error(`open failed: ${parent.reason}`)
      const entries = await parent.session.dataSource('common.view/namespace-entry-source', 1)
      const listed = await (entries.value as NamespaceEntrySource).list('', { limit: 10 })
      await entries.release()
      const entry = listed.items.find(item => item.path.endsWith('clip.mp4'))!
      const decoder = createNodeVideoFrameDecoder()!
      // the services bundle carries the decoder a nested open needs
      expect(nestedSubjectServices({ ...services, videoFrames: decoder }).videoFrames).toBe(decoder)
      const nested = await openNestedSubject({
        ...nestedSubjectServices(services),
        videoFrames: decoder,
        parent: parent.session,
        entryId: entry.id,
        grant,
        budget,
      })
      const opened = nested.result
      if (opened.state !== 'opened') throw new Error(`nested open failed: ${opened.state}`)
      const lease = await opened.session.dataSource('common.view/video-media-source', 1)
      try {
        const source = lease.value as VideoMediaSource
        expect((await source.info()).frameAccess).toBe(true)
        const track = (await source.info()).tracks.find(item => item.kind === 'video')!
        const frame = await source.readFrame!({
          trackId: track.id,
          timestampMs: 200,
          pixelFormat: 'rgba8',
          maxBytes: 32 * 24 * 4,
        })
        expect([frame.width, frame.height]).toEqual([32, 24])
      } finally {
        await lease.release()
      }
    },
  )
})
