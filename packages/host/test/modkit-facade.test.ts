/**
 * `createModkit` — modkit as a Node library, proven the way a foreign project would use it.
 *
 * Every test here goes through the facade only: no topology, no realms, no grants are written by
 * the "consumer". That is the point under test — the facade's defaults must compose the same host
 * the applications compose by hand, and its refusals must be the host's own, not softer copies.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AssetEditPlan, EditSession, CommitCoordinator } from '@modkitx-x3/sdk'
import { createModkit, type Modkit } from '@modkitx-x3/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const imagesDir = join(repoRoot, 'extensions', 'common', 'images')
const pngFixture = join(repoRoot, 'apps', 'web', 'public', 'favicon-32.png')

const scratch = mkdtempSync(join(tmpdir(), 'x3-modkit-facade-'))
const outside = mkdtempSync(join(tmpdir(), 'x3-modkit-outside-'))
mkdirSync(join(scratch, 'writable'), { recursive: true })
let modkit: Modkit | undefined
afterAll(async () => {
  await modkit?.close()
  rmSync(scratch, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

async function host(): Promise<Modkit> {
  if (modkit !== undefined) return modkit
  modkit = await createModkit({
    extensions: [imagesDir],
    // a directory that is not an extension, beside a real one: composition must survive it
    userExtensions: [join(scratch, 'not-an-extension')],
    roots: [scratch],
    writableRoots: [join(scratch, 'writable')],
  })
  return modkit
}

describe('createModkit — the Node library facade', () => {
  it('composes from directories alone, and a broken one is a record, not an exception', async () => {
    const m = await host()
    expect(m.extensionCoordinates).toContain('org.modkitx/images')
    expect(m.extensionFailures.map(failure => failure.code)).toContain(
      'x3.host/extension-root-unreadable',
    )
    // the escape hatch is the real thing, not a summary of it
    expect(m.services.inventory.extensions.length).toBeGreaterThan(0)
  })

  it('opens a PNG worker-brokered with no host knowledge from the caller', async () => {
    const m = await host()
    const path = join(scratch, 'sample.png')
    writeFileSync(path, readFileSync(pngFixture))
    const opened = await m.open(path)
    expect(opened.snapshot.state).toBe('opened')
    if (opened.snapshot.state !== 'opened') return
    expect(opened.snapshot.selected.variantId).toBe('portable')
    // read-only location: the subject opens, and no editing surface is offered
    expect(opened.editing).toBeUndefined()
    const session = opened.session
    if (session === undefined) throw new Error('opened without a session')
    const lease = (await session.dataSource('common.view/byte-range-source', 1)) as {
      value: { size(): Promise<bigint> }
      release?: () => Promise<void>
    }
    expect(await lease.value.size()).toBe(BigInt(readFileSync(pngFixture).byteLength))
    await lease.release?.()
    await opened.close()
  })

  it('refuses a path outside the granted roots before any filesystem access', async () => {
    const m = await host()
    const path = join(outside, 'escape.png')
    writeFileSync(path, readFileSync(pngFixture))
    await expect(m.open(path)).rejects.toThrow(/outside the granted roots/u)
  })

  it('answers unresolved for bytes no codec claims, rather than throwing', async () => {
    const m = await host()
    const path = join(scratch, 'mystery.bin')
    writeFileSync(path, Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01]))
    const opened = await m.open(path)
    expect(opened.snapshot.state).toBe('unresolved')
    expect(opened.editing).toBeUndefined()
    await opened.close()
  })

  it('offers editing inside writableRoots, and a byte edit commits to the real file', async () => {
    const m = await host()
    const path = join(scratch, 'writable', 'edit-me.png')
    writeFileSync(path, readFileSync(pngFixture))
    const opened = await m.open(path)
    expect(opened.snapshot.state).toBe('opened')
    const editing = opened.editing
    if (editing === undefined) throw new Error('no editing surface inside writableRoots')
    const ports = editing.editorPorts
    if (ports === undefined) throw new Error('editing carries no editor ports')

    const edit = ports.edit as EditSession
    const commit = ports.commit as CommitCoordinator
    const target = edit.targets[0]
    if (target === undefined) throw new Error('no edit target')

    // flip four bytes in the middle of the file through the raw writer — a hex editor's save
    const change = {
      targets: edit.targets,
      edits: [
        {
          operation: 'replace' as const,
          targetId: target.targetId,
          source: target.ownerSource,
          range: { kind: 'bytes' as const, offset: 16n, length: 4n },
          payload: { kind: 'inline' as const, bytes: new Uint8Array([1, 2, 3, 4]) },
          label: 'facade proof',
        },
      ],
      provenance: { actor: 'user' as const },
    }
    const validation = await edit.propose(change)
    expect(validation.valid).toBe(true)
    const plan: AssetEditPlan = await edit.plan(change)
    const authorization = await (
      ports.authorization as {
        request(plan: AssetEditPlan): Promise<{ grant: unknown }>
      }
    ).request(plan)
    const prepared = await commit.prepare(plan, { grant: authorization.grant as never })
    expect(prepared.state).toBe('ready')
    if (prepared.state !== 'ready') return
    const receipt = await commit.commit(prepared.prepared, { grant: authorization.grant as never })
    expect(receipt.state).toBe('committed')

    const after = new Uint8Array(readFileSync(path))
    expect([...after.slice(16, 20)]).toEqual([1, 2, 3, 4])
    // and everything either side of the range is untouched
    const before = new Uint8Array(readFileSync(pngFixture))
    expect([...after.slice(0, 16)]).toEqual([...before.slice(0, 16)])
    expect([...after.slice(20)]).toEqual([...before.slice(20)])
    await opened.close()
  })

  it('close() sweeps the sessions a caller forgot', async () => {
    const m = await host()
    const path = join(scratch, 'forgotten.png')
    writeFileSync(path, readFileSync(pngFixture))
    const opened = await m.open(path)
    expect(opened.snapshot.state).toBe('opened')
    // deliberately not closed here; afterAll's modkit.close() must not hang or throw on it
  })
})

describe('disabling a contribution (the settings-page seam)', () => {
  it('a disabled codec stays listed, loses activation, and the subject answers unresolved', async () => {
    const disabled = await createModkit({
      extensions: [imagesDir],
      roots: [scratch],
      disabledContributions: ['org.modkitx/image-png'],
    })
    try {
      const path = join(scratch, 'disabled.png')
      writeFileSync(path, readFileSync(pngFixture))
      const opened = await disabled.open(path)
      // resolution never selects it…
      expect(opened.snapshot.state).toBe('unresolved')
      // …but the record still exists, with the reason on it — that is what lets a settings page
      // show the switch in its off position instead of the codec vanishing
      const contribution = disabled.services.inventory.extensions
        .flatMap(extension => extension.contributions)
        .find(item => item.manifest?.id === 'org.modkitx/image-png')
      if (contribution === undefined) throw new Error('disabled contribution vanished')
      expect(contribution.activationEligible).toBe(false)
      expect(contribution.diagnostics.map(item => item.code)).toContain(
        'x3.host/contribution-disabled',
      )
      await opened.close()
    } finally {
      await disabled.close()
    }
  })
})
