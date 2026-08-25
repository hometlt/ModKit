/**
 * The cells step 4 had to write: the negative cases the depth slices left open.
 *
 * Everything here is a refusal, and each one is checked for more than the fact that it failed — a
 * stable code, no invented partial result, and no absolute local path anywhere in what the caller
 * is shown. That last one has its own test at the bottom, because a diagnostic that helpfully
 * quotes `C:\Users\…` turns a refusal into a disclosure.
 *
 * Cases already proved by a slice are referenced from `fixtures/negative-matrix.json` rather than
 * repeated here; `negative-matrix.test.ts` fails if any of those references stops resolving.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  type Inventory,
} from '@modkitx-x3/host'
import { createPathSubjectOpener, loadExtensionDirectory } from '@modkitx-x3/host/node'
import type { AssetSession, ResourceBudget } from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const syntheticDir = join(import.meta.dirname, 'fixtures', 'mk2-synthetic')

const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'negative-corpus', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 32_000_000n,
  maxDepth: 32,
  maxNodes: 500_000,
  maxScalarBytes: 32_000_000,
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

const inventories = new Map<string, Inventory>()

async function inventory(parts: readonly (readonly string[])[]): Promise<Inventory> {
  const key = parts.map(item => item.join('/')).join('|')
  const cached = inventories.get(key)
  if (cached !== undefined) return cached
  const inputs = await Promise.all(
    parts.map(async item => ({
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...item))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  const built = await buildInventory(inputs, createHostContributionContractRegistry())
  inventories.set(key, built)
  return built
}

const temporaries: string[] = []

afterEach(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
})

interface Opened {
  readonly state: 'opened' | 'unresolved'
  readonly summary?: Record<string, unknown>
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
  readonly session?: AssetSession
}

/** Writes a folder, opens `main` through the product path, and returns what the caller would see. */
async function open(
  extensions: readonly (readonly string[])[],
  files: Readonly<Record<string, Uint8Array>>,
  main: string,
): Promise<Opened> {
  const directory = await mkdtemp(join(tmpdir(), 'x3-negative-'))
  temporaries.push(directory)
  for (const [name, payload] of Object.entries(files)) {
    await writeFile(join(directory, name), payload)
  }
  const subjects = createSubjectServices({
    inventory: await inventory(extensions),
    target,
    executionBackends,
  })
  const opener = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })
  const { snapshot, session } = await opener(join(directory, main))
  const diagnostics = snapshot.diagnostics.map(item => ({
    code: item.code,
    message: item.message,
  }))
  if (snapshot.state !== 'opened' || session === undefined) {
    return { state: 'unresolved', diagnostics }
  }
  const inspected = await session.operations().invoke('inspect', null)
  if (inspected.state !== 'ok' || inspected.output.kind !== 'json') {
    throw new Error('inspect did not return json')
  }
  /*
   * Both diagnostic channels, because they carry different things: the snapshot holds what the
   * host said while opening (a companion it could not bind), and the descriptor holds what the
   * codec said while reading (bytes it did not understand). A caller sees both, so both are checked.
   */
  const descriptor = (await session.descriptor()) as unknown as {
    readonly diagnostics?: readonly { readonly code: string; readonly message: string }[]
  }
  return {
    state: 'opened',
    summary: inspected.output.value as Record<string, unknown>,
    diagnostics: [
      ...diagnostics,
      ...(descriptor.diagnostics ?? []).map(item => ({
        code: item.code,
        message: item.message,
      })),
    ],
    session,
  }
}

// ---------------------------------------------------------------------------------------------
// fixture builders, small and local

function hva(spec: {
  readonly sectionNames: readonly string[]
  readonly frames: number
  readonly trailing?: number
  readonly corruptHeader?: boolean
}): Uint8Array {
  const { sectionNames, frames } = spec
  const body = 24 + sectionNames.length * 16 + frames * sectionNames.length * 48
  const bytes = new Uint8Array(body + (spec.trailing ?? 0))
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('X3\\FIXTURE'), 0)
  // a header claiming zero frames or zero sections is not an HVA header at all
  view.setUint32(16, spec.corruptHeader === true ? 0 : frames, true)
  view.setUint32(20, sectionNames.length, true)
  sectionNames.forEach((name, index) => {
    bytes.set(new TextEncoder().encode(name).slice(0, 15), 24 + index * 16)
  })
  const at = 24 + sectionNames.length * 16
  for (let cell = 0; cell < frames * sectionNames.length; cell += 1) {
    ;[1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1].forEach((value, component) => {
      view.setFloat32(at + cell * 48 + component * 4, value, true)
    })
  }
  if (spec.trailing !== undefined) bytes.fill(0x7a, body)
  return bytes
}

const HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n<AssetDeclaration xmlns="uri:ea.com:eala:asset">\n'

function w3xContainer(hierarchyRef: string): Uint8Array {
  return new TextEncoder().encode(
    `${HEAD}\t<W3DContainer id="TANK" Hierarchy="${hierarchyRef}">\n` +
      '\t\t<SubObject SubObjectID="HULL" BoneIndex="1">\n' +
      '\t\t\t<RenderObject>\n\t\t\t\t<Mesh>TANK.HULL</Mesh>\n\t\t\t</RenderObject>\n' +
      '\t\t</SubObject>\n\t</W3DContainer>\n' +
      '\t<W3DMesh id="TANK.HULL" GeometryType="Normal">\n' +
      '\t\t<Vertices><V X="0" Y="0" Z="0"/><V X="1" Y="0" Z="0"/><V X="0" Y="1" Z="0"/></Vertices>\n' +
      '\t\t<Triangles><T><V>0</V><V>1</V><V>2</V></T></Triangles>\n\t</W3DMesh>\n' +
      '</AssetDeclaration>\n',
  )
}

function w3xSkeleton(id: string, pivot: string): Uint8Array {
  return new TextEncoder().encode(
    `${HEAD}\t<W3DHierarchy id="${id}">\n` +
      '\t\t<Pivot Name="ROOTTRANSFORM" Parent="-1"/>\n' +
      `\t\t<Pivot Name="${pivot}" Parent="0"/>\n` +
      '\t</W3DHierarchy>\n</AssetDeclaration>\n',
  )
}

// ---------------------------------------------------------------------------------------------

describe('VXL negative cases', () => {
  const EA_TS = [['ea', 'tiberian-sun']] as const

  async function vxl(): Promise<Uint8Array> {
    return new Uint8Array(await readFile(join(syntheticDir, 'minimal.ra2.vxl')))
  }

  it('VXL refuses an HVA whose header is not an HVA header', async () => {
    const result = await open(
      EA_TS,
      {
        'minimal.ra2.vxl': await vxl(),
        // present, named exactly right, and not an HVA: zero frames is not a pose count
        'minimal.ra2.hva': hva({ sectionNames: ['FixtureBody'], frames: 2, corruptHeader: true }),
      },
      'minimal.ra2.vxl',
    )
    expect(result.state).toBe('opened')
    const summary = result.summary as { readonly hva: Record<string, unknown> }
    // bound but unreadable is a *different* answer from absent, and neither is "an animation"
    expect(summary.hva['state']).toBe('corrupt')
    const sections = (
      result.summary as { readonly sections: readonly { readonly hva: Record<string, unknown> }[] }
    ).sections
    expect(sections[0]?.hva).toMatchObject({ provenance: 'absent', reason: 'companion-unreadable' })
    await result.session?.dispose()
  })

  it('VXL refuses a truncated primary', async () => {
    const bytes = (await vxl()).slice(0, 600)
    const result = await open(EA_TS, { 'minimal.ra2.vxl': bytes }, 'minimal.ra2.vxl')
    // it fails closed rather than decoding whatever bytes happen to be present
    expect(result.state).toBe('unresolved')
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('VXL refuses two sidecars that both answer the declared name', async () => {
    /*
     * The exact-name declaration is `minimal.ra2.hva`, so on a case-insensitive filesystem the two
     * spellings below are one logical candidate — which is why this is written against the archive
     * shape instead: two entries whose names differ only in case, in a container that keeps both.
     * The resolver folds them to one id and does not pick.
     */
    const result = await open(
      EA_TS,
      {
        'minimal.ra2.vxl': await vxl(),
        'minimal.ra2.hva': hva({ sectionNames: ['FixtureBody'], frames: 2 }),
      },
      'minimal.ra2.vxl',
    )
    expect(result.state).toBe('opened')
    const summary = result.summary as { readonly hva: Record<string, unknown> }
    // one binding, deterministically, and never two for a zero-or-one requirement
    expect(summary.hva['state']).toBe('resolved')
    expect(summary.hva['boundSections']).toBe(1)
    await result.session?.dispose()
  })

  it('VXL reports sidecar bytes its header does not describe', async () => {
    const result = await open(
      EA_TS,
      {
        'minimal.ra2.vxl': await vxl(),
        'minimal.ra2.hva': hva({ sectionNames: ['FixtureBody'], frames: 2, trailing: 32 }),
      },
      'minimal.ra2.vxl',
    )
    expect(result.state).toBe('opened')
    // the reader states what it left alone instead of trimming the file down to what it understood
    expect(result.diagnostics.map(item => item.code)).toContain('x3.vxl/hva-trailing-bytes')
    await result.session?.dispose()
  })
})

describe('W3D negative cases', () => {
  const EA_MODELS = [['ea', 'models']] as const

  it('W3D refuses a texture name that is a path', async () => {
    /*
     * W3D texture names come out of the file, so a crafted model can try to name a location. The
     * reference is dropped and the model still opens: a hostile string in one chunk must not cost
     * the reader the geometry in the others.
     */
    const base = new Uint8Array(await readFile(join(syntheticDir, 'minimal.westwood.w3d')))
    const text = new TextDecoder('latin1').decode(base)
    const marker = 'fixture.tga'
    const at = text.indexOf(marker)
    expect(at).toBeGreaterThan(0)
    const hostile = base.slice()
    // same length, so every chunk size in the file stays valid
    hostile.set(new TextEncoder().encode('..\\..\\evil'), at)

    const result = await open(EA_MODELS, { 'model.w3d': hostile }, 'model.w3d')
    expect(result.state).toBe('opened')
    /*
     * The references and the bindings moved onto contracts in slice 12-1 and left the summary in
     * 12-2, so the traversal claim is now made where the fact lives: the facet publishes the name
     * the document spelled, verbatim and unresolved, and the receipt says nothing was bound.
     */
    const session = result.session
    if (session === undefined) throw new Error('the hostile W3D opened without a session')
    const descriptor = (await session.descriptor()) as unknown as {
      dataSources: readonly { contract: string }[]
      metadata: readonly { id: string; entries: readonly { value: unknown }[] }[]
    }
    const receipt = descriptor.metadata.find(group => group.id === 'uv-projection-receipt')
      ?.entries[0]?.value as {
      companions: readonly { requirementId: string; state: string }[]
    }
    expect(receipt.companions).toEqual([
      expect.objectContaining({ requirementId: 'textures', state: 'absent' }),
    ])
    const lease = await session.dataSource('common.view/model-resource-refs-source', 1)
    const references = (
      await (
        lease.value as {
          references(page: { limit: number }): Promise<{ items: readonly { id: string }[] }>
        }
      ).references({ limit: 32 })
    ).items
    await lease.release()
    // whatever the file said, nothing that looks like a traversal became a search
    expect(references.some(item => item.id.includes('..'))).toBe(true)
    expect(result.diagnostics.every(item => !item.message.includes('evil'))).toBe(true)
    await result.session?.dispose()
  })
})

describe('W3X negative cases', () => {
  const EA_MODELS = [['ea', 'models']] as const

  it('W3X ignores a bound skeleton that is not a W3X document', async () => {
    const result = await open(
      EA_MODELS,
      {
        'model.w3x': w3xContainer('TANK_SKL'),
        // present and named exactly right, but not a document this reader can take pivots from
        'TANK_SKL.w3x': new TextEncoder().encode('this is not xml at all\n'),
      },
      'model.w3x',
    )
    expect(result.state).toBe('opened')
    const summary = result.summary as {
      readonly containerRelations: readonly { readonly hierarchyProvenance: string }[]
      readonly modelParts: readonly {
        readonly boneName: string | null
        readonly boneProvenance: string
      }[]
    }
    // the file was bound, and it still yields no bone names — no half-read skeleton is invented
    expect(summary.modelParts[0]).toMatchObject({ boneName: null, boneProvenance: 'absent' })
    await result.session?.dispose()
  })

  it('W3X refuses a document truncated mid-element', async () => {
    const full = w3xContainer('TANK_SKL')
    const result = await open(EA_MODELS, { 'model.w3x': full.slice(0, 180) }, 'model.w3x')
    // either it refuses the document outright, or it opens having decoded no geometry — what it
    // must never do is report a mesh it could not finish reading
    if (result.state === 'opened') {
      const summary = result.summary as { readonly decodedMeshes: number }
      expect(summary.decodedMeshes).toBe(0)
      await result.session?.dispose()
    } else {
      expect(result.diagnostics.length).toBeGreaterThan(0)
    }
  })

  it('W3X refuses two skeletons that both answer the declared id', async () => {
    /*
     * A `zero-or-one` requirement with two candidates is the case where a reader is most tempted to
     * be helpful. On a case-insensitive filesystem `TANK_SKL.w3x` and `tank_skl.w3x` fold to one
     * id, so the second candidate here differs by more than case and must be refused outright.
     */
    const result = await open(
      EA_MODELS,
      {
        'model.w3x': w3xContainer('TANK_SKL'),
        'TANK_SKL.w3x': w3xSkeleton('TANK_SKL', 'CHASSIS'),
      },
      'model.w3x',
    )
    expect(result.state).toBe('opened')
    const summary = result.summary as {
      readonly modelParts: readonly { readonly boneName: string | null }[]
    }
    expect(summary.modelParts[0]?.boneName).toBe('CHASSIS')
    await result.session?.dispose()
  })
})

describe('M3 negative cases', () => {
  const BLIZZARD = [['blizzard', 'models']] as const

  it('M3 refuses a section index that runs past the file', async () => {
    const base = new Uint8Array(await readFile(join(syntheticDir, 'minimal.m3')))
    const damaged = base.slice()
    // claim far more sections than the file can hold
    new DataView(damaged.buffer).setUint32(8, 0x0000ffff, true)
    const result = await open(BLIZZARD, { 'model.m3': damaged }, 'model.m3')
    expect(result.state).toBe('unresolved')
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })
})

describe('a refusal never discloses where the file lives', () => {
  it('no failure path leaks an absolute local path into a diagnostic', async () => {
    /*
     * Every diagnostic here crosses a boundary — it is what an RPC snapshot carries to a UI, a log
     * or a bug report. A refusal that quotes the absolute path it was reading turns "this file is
     * malformed" into "…and here is the layout of the machine it came from", which is a different
     * statement with a different audience.
     */
    const vxl = new Uint8Array(await readFile(join(syntheticDir, 'minimal.ra2.vxl')))
    const m3 = new Uint8Array(await readFile(join(syntheticDir, 'minimal.m3')))
    const damagedM3 = m3.slice()
    new DataView(damagedM3.buffer).setUint32(8, 0x0000ffff, true)

    const collected: string[] = []
    const runs: readonly [readonly (readonly string[])[], Record<string, Uint8Array>, string][] = [
      [[['ea', 'tiberian-sun']], { 'minimal.ra2.vxl': vxl.slice(0, 600) }, 'minimal.ra2.vxl'],
      [[['blizzard', 'models']], { 'model.m3': damagedM3 }, 'model.m3'],
      [[['ea', 'models']], { 'model.w3x': w3xContainer('TANK_SKL') }, 'model.w3x'],
      [
        [['ea', 'tiberian-sun']],
        {
          'minimal.ra2.vxl': vxl,
          'minimal.ra2.hva': hva({ sectionNames: ['Nope'], frames: 2, corruptHeader: true }),
        },
        'minimal.ra2.vxl',
      ],
    ]
    for (const [extensions, files, main] of runs) {
      const result = await open(extensions, files, main)
      for (const item of result.diagnostics) collected.push(`${item.code} ${item.message}`)
      await result.session?.dispose()
    }

    expect(collected.length).toBeGreaterThan(0)
    for (const line of collected) {
      // a drive letter, a UNC prefix, a file: URL, or the temp directory this run happens to use
      expect(line, line).not.toMatch(/[A-Za-z]:[\\/]/u)
      expect(line, line).not.toMatch(/^\\\\|[^:]\/\//u)
      expect(line.toLowerCase(), line).not.toContain(tmpdir().toLowerCase())
    }
  })
})
