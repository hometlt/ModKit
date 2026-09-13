import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import {
  connectSubjectRpc,
  exposeSubjectRpc,
  type SubjectClientOpenResult,
  type SubjectOpenedSnapshot,
} from '@modkit/host'
import { revisionId, type AssetSession } from '@modkit/sdk'
import { rootSubject, serializeSubjectRef, type SubjectRef } from '@modkit/sdk/subjects'

const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined)
})

const parentRef = rootSubject({ id: 'memory://container' }, 'workspace-a')
const childRef = rootSubject(
  { id: 'entry-image', parent: { id: 'memory://container' } },
  'workspace-a',
)

function snapshot(sessionId: string, subject: SubjectRef): SubjectOpenedSnapshot {
  return {
    state: 'opened',
    sessionId,
    descriptor: { subjectUri: serializeSubjectRef(subject) },
    selected: { contributionId: 'fixture/neutral', variantId: 'main', confidence: 1 },
    candidates: [],
    diagnostics: [],
  }
}

function session(subject: SubjectRef, disposed: () => void): AssetSession {
  let released = false
  return {
    revision: revisionId('content-hash.sha256:fixture'),
    state: () => 'live',
    descriptor: async () => ({ subjectUri: serializeSubjectRef(subject) }) as never,
    dataSource: async () => {
      throw new TypeError('fixture publishes no data sources')
    },
    operations: () =>
      ({
        invoke: async () => ({ state: 'rejected', reason: 'unsupported', diagnostics: [] }),
        dispose: async () => undefined,
      }) as never,
    events: async function* () {
      yield* []
    },
    dispose: async () => {
      if (released) return
      released = true
      disposed()
    },
  }
}

describe('subject RPC navigation', () => {
  it('mints a port from the attached session and hands an attached child to the app owner', async () => {
    const channel = new MessageChannel()
    let parentDisposed = 0
    let childDisposed = 0
    const delivered: Extract<SubjectClientOpenResult, { readonly state: 'opened' }>[] = []
    const exposure = exposeSubjectRpc({
      port: channel.port1 as never,
      listener: 'event-target',
      session: 'navigation-rpc',
      open: async () => ({
        snapshot: snapshot('parent-session', parentRef),
        session: session(parentRef, () => (parentDisposed += 1)),
      }),
      navigate: async request => {
        expect(request.sourceSessionId).toBe('parent-session')
        expect(request.parent.state()).toBe('live')
        expect(request.current).toEqual(parentRef)
        expect(request.target).toEqual(childRef)
        return {
          snapshot: snapshot('child-session', childRef),
          session: session(childRef, () => (childDisposed += 1)),
        }
      },
    })
    const client = await connectSubjectRpc({
      port: channel.port2 as never,
      listener: 'event-target',
      session: 'navigation-rpc',
      onNavigate: event => void delivered.push(event.result),
    })
    closers.push(
      () => client.close('test finished'),
      () => exposure.close('test finished'),
      async () => {
        channel.port1.close()
        channel.port2.close()
      },
    )

    const opened = await client.open('container.bin')
    if (opened.state !== 'opened') throw new Error('parent did not open')
    expect(opened.session.subjectNavigation?.scope).toEqual({
      sessionId: 'parent-session',
      subject: serializeSubjectRef(parentRef),
      workspace: 'workspace-a',
    })
    await expect(
      opened.session.subjectNavigation?.open({
        scope: opened.session.subjectNavigation.scope,
        target: serializeSubjectRef(childRef),
      }),
    ).resolves.toEqual({ state: 'opened' })
    expect(delivered).toHaveLength(1)
    expect(await delivered[0]?.session.descriptor()).toEqual({
      subjectUri: serializeSubjectRef(childRef),
    })

    await opened.session.dispose()
    expect(parentDisposed).toBe(1)
    await expect(
      opened.session.subjectNavigation?.open({
        scope: opened.session.subjectNavigation.scope,
        target: serializeSubjectRef(childRef),
      }),
    ).resolves.toEqual({ state: 'rejected', reason: 'disposed' })
    await delivered[0]?.session.dispose()
    expect(childDisposed).toBe(1)
  })

  it('fails closed without an app owner and rejects duplicate session ids without overwrite', async () => {
    const channel = new MessageChannel()
    let firstDisposed = 0
    let duplicateDisposed = 0
    let opens = 0
    const exposure = exposeSubjectRpc({
      port: channel.port1 as never,
      listener: 'event-target',
      session: 'navigation-collision',
      open: async () => {
        opens += 1
        return {
          snapshot: snapshot('same-session', parentRef),
          session: session(
            parentRef,
            opens === 1 ? () => (firstDisposed += 1) : () => (duplicateDisposed += 1),
          ),
        }
      },
    })
    const client = await connectSubjectRpc({
      port: channel.port2 as never,
      listener: 'event-target',
      session: 'navigation-collision',
    })
    closers.push(
      () => client.close('test finished'),
      () => exposure.close('test finished'),
      async () => {
        channel.port1.close()
        channel.port2.close()
      },
    )

    const first = await client.open('first.bin')
    if (first.state !== 'opened') throw new Error('first did not open')
    expect(first.session.subjectNavigation).toBeUndefined()
    await expect(client.open('duplicate.bin')).rejects.toThrow(/collides/u)
    expect(duplicateDisposed).toBe(1)
    expect(firstDisposed).toBe(0)
    await first.session.dispose()
    expect(firstDisposed).toBe(1)
  })

  it('serves bounded raster pixels only while the exact subject session is attached', async () => {
    const channel = new MessageChannel()
    const requests: unknown[] = []
    const exposure = exposeSubjectRpc({
      port: channel.port1 as never,
      listener: 'event-target',
      session: 'raster-rpc',
      open: async () => ({
        snapshot: snapshot('raster-session', parentRef),
        session: session(parentRef, () => undefined),
        rasterResources: {
          async read(request) {
            requests.push(request)
            return {
              state: 'decoded',
              info: {
                width: 1,
                height: 1,
                depth: 1,
                layers: 1,
                faces: 1,
                mipLevels: 1,
                frames: 1,
                channels: 4,
                bitDepth: 8,
                colorSpace: 'srgb',
                alphaMode: 'straight',
                orientation: 'top-left',
                decodedAccess: true,
              },
              region: {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                rowStride: 4,
                pixelFormat: 'rgba8',
                pixels: new Uint8Array([12, 34, 56, 255]),
              },
              provenance: {
                requirementId: 'diffuse',
                logicalId: 'Assets/Marine_Diffuse.dds',
                role: 'texture',
                state: 'resolved',
                revision: 'content-hash.sha256:texture',
                bytes: 4n,
                cached: false,
                scopes: ['workspace-dependency-layer'],
              },
              diagnostics: [],
            }
          },
        },
      }),
    })
    const client = await connectSubjectRpc({
      port: channel.port2 as never,
      listener: 'event-target',
      session: 'raster-rpc',
    })
    closers.push(
      () => client.close('test finished'),
      () => exposure.close('test finished'),
      async () => {
        channel.port1.close()
        channel.port2.close()
      },
    )

    const opened = await client.open('model.m3')
    if (opened.state !== 'opened') throw new Error('model did not open')
    const result = await opened.session.readRasterResource?.({
      kind: 'logical',
      requirement: {
        id: 'diffuse',
        logicalId: 'Assets/Marine_Diffuse.dds',
        role: 'texture',
        scopes: ['workspace-dependency-layer'],
      },
      maxBytes: 4,
    })
    expect(result?.state).toBe('decoded')
    if (result?.state !== 'decoded') throw new Error('texture was not decoded')
    expect([...result.region.pixels]).toEqual([12, 34, 56, 255])
    expect(result.provenance?.bytes).toBe(4n)
    expect(requests).toHaveLength(1)

    await opened.session.dispose()
    await expect(
      opened.session.readRasterResource?.({
        kind: 'logical',
        requirement: {
          id: 'late',
          logicalId: 'late.dds',
          role: 'texture',
          scopes: ['sibling-directory'],
        },
        maxBytes: 4,
      }),
    ).rejects.toThrow(/no raster resource origin/u)
  })
})
