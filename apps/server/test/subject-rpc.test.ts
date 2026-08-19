/**
 * S9 — the server serves subjects over capability-RPC: `x3.app/subject-services@1` on a port pair
 * (the kit-proven Node MessageChannel), `open(path)` confined to the server's roots, `attach` →
 * the live session as a capability, data sources pulled through the standard surfaces, and the
 * honest boundary notices on the wire. Same root Electron serves its renderer; no HTTP framework.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it } from 'vitest'
import { connectSubjectRpc, type SubjectRpcClient } from '@modkitx-x3/host'
import type { MessagePortLike } from '@modkitx-x3/host/execution'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import { createServerApp } from '../src/index.js'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const favicon = join(repositoryRoot, 'apps', 'web', 'public', 'favicon-32.png')

const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined)
})

async function serverAndClient(roots: readonly string[]): Promise<SubjectRpcClient> {
  const images = await loadExtensionDirectory(
    join(repositoryRoot, 'extensions', 'common', 'images'),
  )
  const app = await createServerApp([
    { ...images, execution: { origin: 'installed', allowTrustedInProcess: false } },
  ])
  const channel = new MessageChannel()
  const session = 'server-rpc-test'
  const exposure = app.exposeSubjectRpc({
    // a Node MessagePort is an EventTarget: the same `event-target` style a DOM port uses
    port: channel.port1 as unknown as MessagePortLike,
    session,
    roots,
  })
  const client = await connectSubjectRpc({
    port: channel.port2 as unknown as MessagePortLike,
    session,
  })
  closers.push(
    () => client.close('test finished'),
    () => exposure.close('test finished'),
    async () => {
      channel.port1.close()
      channel.port2.close()
    },
  )
  return client
}

describe('server subject RPC (S9)', () => {
  it('opens a PNG under a granted root: snapshot on the wire, session attached as a capability, byte-range source answers over the RPC', async () => {
    const root = mkdtempSync(join(tmpdir(), 'x3-server-rpc-'))
    closers.push(async () => rmSync(root, { recursive: true, force: true }))
    const path = join(root, 'favicon-32.png')
    writeFileSync(path, readFileSync(favicon))
    const client = await serverAndClient([root])

    const opened = await client.open(path)
    expect(opened.state).toBe('opened')
    if (opened.state !== 'opened') throw new Error('open failed')
    expect(opened.snapshot.selected).toMatchObject({
      contributionId: 'org.modkitx/image-png',
      variantId: 'portable',
    })
    // the codec ran worker-brokered in the server's worker realm; the wire carried the notice
    expect(opened.snapshot.diagnostics.map(item => item.code)).toContain(
      'x3.host/worker-shared-process',
    )
    expect(opened.snapshot.presentation).toBeUndefined()
    const descriptor = await opened.session.descriptor()
    expect((descriptor as { identity: { formatId: string } }).identity.formatId).toBe('png')

    // a standard data source materialized through the surface registry, not an app method list
    const lease = await opened.session.dataSource('common.view/byte-range-source', 1)
    const bytes = lease.value as {
      size(): Promise<bigint>
      read(o: bigint, n: number): Promise<Uint8Array>
    }
    expect(await bytes.size()).toBe(2727n)
    expect([...(await bytes.read(0n, 8))]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await opened.session.dispose()
  }, 30_000)

  it('refuses a path outside the granted roots before touching the file, and reports unresolved honestly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'x3-server-rpc-roots-'))
    const elsewhere = mkdtempSync(join(tmpdir(), 'x3-server-rpc-elsewhere-'))
    closers.push(async () => {
      rmSync(root, { recursive: true, force: true })
      rmSync(elsewhere, { recursive: true, force: true })
    })
    writeFileSync(join(elsewhere, 'secret.png'), readFileSync(favicon))
    writeFileSync(join(root, 'garbage.bin'), 'not an image\n')
    const client = await serverAndClient([root])
    await expect(client.open(join(elsewhere, 'secret.png'))).rejects.toThrow(
      /outside the granted roots/u,
    )
    const unresolved = await client.open(join(root, 'garbage.bin'))
    expect(unresolved.state).toBe('unresolved')
    if (unresolved.state === 'unresolved') expect(unresolved.snapshot.reason).toBe('no-candidate')
  }, 30_000)
})
