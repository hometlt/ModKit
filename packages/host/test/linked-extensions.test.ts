/**
 * The static lane: `import` as the extension connection mechanism.
 *
 * Importing an extension's own `linked` entry is the whole setup: the extension carries its
 * contributions as JSON imports and its entrypoints as real ESM imports, and
 * `createModkit({ modules })` composes a host from them with no extension directory anywhere.
 * The trust rule under test: linked code runs in-process because the import *was* the trust
 * decision, and the gate still says so out loud on every activation.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { defineBuiltinModule, defineLinkedExtension, type LinkedExtension } from '@modkitx-x3/host'
import { createModkit, type Modkit } from '@modkitx-x3/host/node'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const { images } = (await import(
  pathToFileURL(join(repoRoot, 'extensions', 'images', 'src', 'linked.js')).href
)) as { readonly images: LinkedExtension }
const pngFixture = join(repoRoot, 'apps', 'web', 'public', 'favicon-32.png')
const audioDir = join(repoRoot, 'extensions', 'audio')

const scratch = mkdtempSync(join(tmpdir(), 'x3-linked-'))
mkdirSync(join(scratch, 'writable'), { recursive: true })
let modkit: Modkit | undefined
afterAll(async () => {
  await modkit?.close()
  rmSync(scratch, { recursive: true, force: true })
})

async function host(): Promise<Modkit> {
  if (modkit !== undefined) return modkit
  modkit = await createModkit({
    // static lane: imported at build time, no directory involved
    modules: [images],
    // dynamic lane, side by side: a real directory, loaded and worker-executed as always
    extensions: [audioDir],
    roots: [scratch],
    writableRoots: [join(scratch, 'writable')],
  })
  return modkit
}

describe('statically linked extensions (import lane)', () => {
  it('a linked extension opens a subject in-process, and the audit notice says so', async () => {
    const m = await host()
    expect(m.extensionCoordinates).toContain('org.modkitx/images')
    const path = join(scratch, 'linked.png')
    writeFileSync(path, readFileSync(pngFixture))
    const opened = await m.open(path)
    expect(opened.snapshot.state).toBe('opened')
    if (opened.snapshot.state !== 'opened') return
    // the selected variant is the manifest's own trusted-in-process declaration, not a rewrite
    expect(opened.snapshot.selected.variantId).toBe('trusted-node')
    const codes = opened.snapshot.diagnostics.map(item => item.code)
    // no worker was involved…
    expect(codes).not.toContain('x3.host/worker-shared-process')
    // …and the gate's audit notice fired, because this is a boundary, not a sandbox
    expect(codes).toContain('x3.host/full-process-authority')
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

  it('what cannot be linked is excluded with its reason, never silently dropped', () => {
    // the PNG encoder writer is authored worker-only, so the linked build says exactly that
    expect(images.excluded.map(item => item.reason).join(' ')).toMatch(
      /png-encoder-writer declares no trusted-in-process variant/u,
    )
  })

  it('static and dynamic lanes compose into one host', async () => {
    const m = await host()
    // linked images beside the directory-loaded audio extension, one inventory
    expect(m.extensionCoordinates).toEqual(
      expect.arrayContaining(['org.modkitx/images', 'org.modkitx/audio']),
    )
  })

  it('a linked variant whose module was not imported refuses at definition time', () => {
    expect(() =>
      defineLinkedExtension({
        source: 'linked:test',
        packageJson: { modkit: { publisher: 'org.example', id: 'broken' } },
        files: ['contributions/x.json'],
        contributions: [
          {
            path: 'contributions/x.json',
            digest: 'sha256:0',
            manifest: {
              id: 'org.example/broken',
              runtimeVariants: [
                {
                  variantId: 'trusted-node',
                  entrypoint: './src/missing.js',
                  executionProfile: 'trusted-in-process',
                },
              ],
            },
          },
        ],
        artifactDigest: 'sha256:0',
        modules: {},
      }),
    ).toThrow(/has no imported module/u)
  })

  it('built-in modules use the linked protocol lane but carry an explicit product kind', () => {
    const module = defineBuiltinModule({
      coordinate: 'org.modkitx/code',
      packageJson: { name: '@modkitx-x3/code', version: '1.0.0' },
      contributions: [],
      modules: {},
    })

    expect(module.kind).toBe('builtin')
    expect(module.coordinate).toBe('org.modkitx/code')
    expect(module.input.source).toBe('builtin:org.modkitx/code')
    expect(module.input.execution).toEqual({ origin: 'bundled', allowTrustedInProcess: true })
  })

  it('editing works over a linked subject exactly as over a loaded one', async () => {
    const m = await host()
    const path = join(scratch, 'writable', 'linked-edit.png')
    writeFileSync(path, readFileSync(pngFixture))
    const opened = await m.open(path)
    const ports = opened.editing?.editorPorts
    if (ports === undefined) throw new Error('no editor ports on a writable linked subject')
    const edit = ports.edit as {
      targets: readonly { targetId: string; ownerSource: unknown }[]
      propose(change: unknown): Promise<{ valid: boolean }>
    }
    const target = edit.targets[0]
    if (target === undefined) throw new Error('no target')
    const validation = await edit.propose({
      targets: edit.targets,
      edits: [
        {
          operation: 'replace',
          targetId: target.targetId,
          source: target.ownerSource,
          range: { kind: 'bytes', offset: 8n, length: 2n },
          payload: { kind: 'inline', bytes: new Uint8Array([7, 7]) },
        },
      ],
      provenance: { actor: 'user' },
    })
    expect(validation.valid).toBe(true)
    await opened.close()
  })
})
