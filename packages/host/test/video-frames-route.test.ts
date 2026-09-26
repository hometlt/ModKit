import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { uint64 } from '@modkit/core'
import { createHostTopology, type VideoMediaSource } from '@modkit/sdk'
import type { ExtensionInput } from '@modkit/host'
import {
  createNodeSubjectServices,
  findFfmpeg,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  openFileArtifactSource,
  workerBackendPolicy,
} from '@modkit/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const scratch = mkdtempSync(join(tmpdir(), 'x3-video-frames-route-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
const ffmpeg = findFfmpeg()

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
})
