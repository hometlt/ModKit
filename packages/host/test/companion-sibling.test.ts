/**
 * The folder case of block 9, end to end: a synthetic `sample.vxl` with a synthetic `sample.hva`
 * beside it, a codec contribution that declares the HVA as a companion, and the Node product path
 * that actually opens it.
 *
 * What is being proved is not "the file opened". It is that the codec reached its second file
 * *only* through the bindings the host chose — the fixture codec has no filesystem access, no path
 * and no name construction — and that removing that second file produces two different, named
 * outcomes depending on whether the codec declared it required or optional. A codec that quietly
 * carried on with an invented animation would pass a weaker test than this one.
 */

import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  type SubjectServices,
} from '@modkit/host'
import {
  createFileEditingBackend,
  createFilesystemInputResolver,
  createPathSubjectOpener,
  loadExtensionDirectory,
  openFileArtifactSource,
} from '@modkit/host/node'
import { isModkitError, type Diagnostic } from '@modkit/core'
import { revisionId, type ResourceBudget } from '@modkit/sdk'
import {
  COMPANION_REQUIRED_MISSING,
  COMPANION_UNAVAILABLE,
  createCompanionInputResolver,
} from '../src/input-resolution.js'
import {
  COMPANION_ORIGIN_OUTSIDE_ROOTS,
  createFilesystemCompanionOrigin,
} from '../src/node/companion-origin.js'

const fixtureRoot = join(import.meta.dirname, 'fixtures', 'companion-sibling')
const extensionRoot = join(import.meta.dirname, 'fixtures', 'companion-extension')

const budget: ResourceBudget = {
  maxInputBytes: 100_000n,
  maxDepth: 16,
  maxNodes: 1000,
  maxScalarBytes: 100_000,
  maxDiagnostics: 100,
}

const temporaries: string[] = []

afterEach(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop()
    if (directory !== undefined) {
      if (dirname(resolve(directory)) !== resolve(tmpdir()))
        throw new Error('test cleanup target is outside its temporary root')
      await rm(directory, { recursive: true, force: true })
    }
  }
})

/** A throwaway copy of the fixture directory, so a test may delete the companion from it. */
async function workingCopy(options: { readonly companion: boolean }): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'x3-companion-'))
  temporaries.push(directory)
  await cp(fixtureRoot, directory, { recursive: true })
  if (!options.companion) await rm(join(directory, 'sample.hva'))
  return directory
}

async function fixtureServices(): Promise<SubjectServices> {
  const input = await loadExtensionDirectory(extensionRoot)
  const inventory = await buildInventory(
    [{ ...input, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
    createHostContributionContractRegistry(),
  )
  return createSubjectServices({
    inventory,
    target: { environment: 'node', operatingSystem: 'windows', architecture: 'x64' },
    executionBackends: createExecutionBackendRegistry([
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
    ]),
  })
}

it('filesystem exact-prefix enumeration excludes unrelated siblings and honors declared case matching', async () => {
  const directory = await workingCopy({ companion: true })
  await mkdir(join(directory, 'Assets'))
  await Promise.all(
    Array.from({ length: 70 }, (_, index) =>
      writeFile(join(directory, 'Assets', `Texture-${index}.DDS`), Uint8Array.of(index)),
    ),
  )
  const create = (caseSensitivity: 'sensitive' | 'insensitive') =>
    createFilesystemCompanionOrigin({
      primaryPath: join(directory, 'sample.vxl'),
      roots: [directory],
      caseSensitivity,
    })
  const insensitive = create('insensitive')
  for (let index = 0; index < 70; index++) {
    const found: string[] = []
    for await (const entry of insensitive.enumerate('sibling-directory', {
      prefix: `Assets/texture-${index}.dds`,
    }))
      found.push(entry.logicalId)
    expect(found).toEqual([`Assets/Texture-${index}.DDS`])
  }
  const sensitive = create('sensitive'),
    absent: string[] = []
  for await (const entry of sensitive.enumerate('sibling-directory', {
    prefix: 'Assets/texture-0.dds',
  }))
    absent.push(entry.logicalId)
  expect(absent).toEqual([])
})

interface DescriptorShape {
  readonly origin: {
    readonly kind: string
    readonly bindings?: readonly { readonly id: string; readonly role: string }[]
    readonly primary?: string
  }
  readonly companions?: readonly {
    readonly id: string
    readonly state: string
    readonly bindingIds?: readonly string[]
  }[]
  readonly traits: readonly {
    readonly id: string
    readonly parameters?: Record<string, unknown>
  }[]
}

describe('sibling companion resolution, end to end through the Node path opener', () => {
  it('resolves post-open resources through the same origin, pins content and closes with its subject', async () => {
    const directory = await workingCopy({ companion: true })
    const path = join(directory, 'sample.vxl')
    await mkdir(join(directory, 'textures'))
    const texture = join(directory, 'textures', 'late.dds')
    await writeFile(texture, new Uint8Array([1, 2, 3, 4]))
    const subjects = await fixtureServices()
    const result = await subjects.open({
      source: await openFileArtifactSource(path),
      path,
      intent: 'full',
      grant: { id: 'post-open-test', classes: ['read-source'] },
      budget,
      resolveInput: createFilesystemInputResolver({
        primaryPath: path,
        roots: [directory],
        inventory: subjects.inventory,
      }),
      resourceLimits: { maxResources: 1 },
    })
    if (result.state !== 'opened' || result.resources === undefined)
      throw new Error('resource origin was not retained')
    const resources = result.resources
    const requirement = {
      id: 'late',
      logicalId: 'textures/late.dds',
      role: 'texture' as const,
      scopes: ['sibling-directory'] as const,
    }
    try {
      expect(resources.revision).toBe(result.session.revision)
      expect(resources.provenance()).toEqual([])
      const first = await resources.resolve(requirement)
      if (first.state !== 'resolved' || first.lease.value.kind !== 'bytes')
        throw new Error('late texture missing')
      expect(await first.lease.value.read(0n, 4)).toEqual(new Uint8Array([1, 2, 3, 4]))
      expect(await resources.resolve({ ...requirement, id: 'over-limit' })).toMatchObject({
        state: 'unresolved',
        reason: 'budget-exceeded',
      })
      await first.lease.release()
      await writeFile(texture, new Uint8Array([5, 6, 7, 8, 9]))
      expect(await resources.resolve({ ...requirement, id: 'changed' })).toMatchObject({
        state: 'unresolved',
        reason: 'source-revision-changed',
      })
      expect(
        await resources.resolve({ ...requirement, id: 'traversal', logicalId: '../outside.dds' }),
      ).toMatchObject({ state: 'unresolved', reason: 'path-refused' })
      // A cached location is not permission to follow a replacement path.
      await rm(texture)
      await mkdir(texture)
      expect(await resources.resolve({ ...requirement, id: 'replaced-path' })).toMatchObject({
        state: 'unresolved',
        reason: 'path-refused',
      })
    } finally {
      await result.session.dispose()
    }
    expect(resources.state()).toBe('disposed')
    expect(await resources.resolve(requirement)).toMatchObject({
      state: 'unresolved',
      reason: 'session-disposed',
    })
  })

  it('binds the HVA beside the VXL and hands it to the codec only as a binding', async () => {
    const directory = await workingCopy({ companion: true })
    const open = createPathSubjectOpener({
      subjects: await fixtureServices(),
      roots: [directory],
      budget,
    })

    const { snapshot, session } = await open(join(directory, 'sample.vxl'))
    expect(snapshot.state).toBe('opened')
    if (snapshot.state !== 'opened') throw new Error(JSON.stringify(snapshot.diagnostics))
    expect(snapshot.selected.contributionId).toBe('org.example/companion-required')

    const descriptor = snapshot.descriptor as unknown as DescriptorShape
    expect(descriptor.origin.kind).toBe('bundle')
    expect(descriptor.origin.bindings?.map(item => item.role)).toEqual(['content', 'animation'])
    expect(descriptor.origin.primary).toBe('content')
    expect(descriptor.companions).toEqual([
      expect.objectContaining({
        id: 'motion',
        state: 'resolved',
        bindingIds: ['motion#sample.hva'],
      }),
    ])
    // the codec read the real companion bytes, and could only have got them from openBinding
    expect(
      descriptor.traits.find(trait => trait.id === 'model.animations')?.parameters?.['companion'],
    ).toContain('X3HVAFIX')

    await session?.dispose()
  })

  it('refuses the open when a required companion is gone, naming requirement, role and scopes', async () => {
    const directory = await workingCopy({ companion: false })
    const open = createPathSubjectOpener({
      subjects: await fixtureServices(),
      roots: [directory],
      budget,
    })

    const { snapshot } = await open(join(directory, 'sample.vxl'))
    expect(snapshot.state).toBe('unresolved')
    if (snapshot.state !== 'unresolved') throw new Error('a missing required companion opened')
    expect(snapshot.reason).toBe('input-unresolved')
    const refusal = snapshot.diagnostics.find(item => item.code === COMPANION_REQUIRED_MISSING)
    expect(refusal).toBeDefined()
    expect(refusal?.message).toContain('motion')
    expect(refusal?.message).toContain('animation')
    expect(refusal?.message).toContain('sibling-directory')
    // and nothing was substituted: no candidate was selected, so no invented animation exists
    const candidates = snapshot.candidates as readonly { readonly state: string }[]
    expect(candidates.some(item => item.state === 'selected')).toBe(false)
  })

  it('opens without the optional companion and says the capability is unavailable', async () => {
    const directory = await workingCopy({ companion: false })
    const open = createPathSubjectOpener({
      subjects: await fixtureServices(),
      roots: [directory],
      budget,
    })

    const { snapshot, session } = await open(join(directory, 'sample-optional.vxl'))
    expect(snapshot.state).toBe('opened')
    if (snapshot.state !== 'opened') throw new Error(JSON.stringify(snapshot.diagnostics))
    expect(snapshot.selected.contributionId).toBe('org.example/companion-optional')

    const descriptor = snapshot.descriptor as unknown as DescriptorShape
    expect(descriptor.origin.bindings?.map(item => item.role)).toEqual(['content'])
    expect(descriptor.companions).toEqual([
      expect.objectContaining({ id: 'motion', state: 'missing' }),
    ])
    expect(descriptor.traits.some(trait => trait.id === 'model.animations')).toBe(false)
    expect(snapshot.diagnostics.map(item => item.code)).toContain(COMPANION_UNAVAILABLE)

    await session?.dispose()
  })

  it('binds the optional companion when it is present', async () => {
    const directory = await workingCopy({ companion: true })
    const open = createPathSubjectOpener({
      subjects: await fixtureServices(),
      roots: [directory],
      budget,
    })

    const { snapshot, session } = await open(join(directory, 'sample-optional.vxl'))
    if (snapshot.state !== 'opened') throw new Error(JSON.stringify(snapshot.diagnostics))
    const descriptor = snapshot.descriptor as unknown as DescriptorShape
    expect(descriptor.companions).toEqual([
      expect.objectContaining({ id: 'motion', state: 'resolved' }),
    ])
    await session?.dispose()
  })

  it('never offers a sibling the requirement did not ask for', async () => {
    const directory = await workingCopy({ companion: true })
    await writeFile(join(directory, 'decoy.pal'), 'X3PALFIX\n')
    const open = createPathSubjectOpener({
      subjects: await fixtureServices(),
      roots: [directory],
      budget,
    })

    const { snapshot, session } = await open(join(directory, 'sample.vxl'))
    if (snapshot.state !== 'opened') throw new Error(JSON.stringify(snapshot.diagnostics))
    const descriptor = snapshot.descriptor as unknown as DescriptorShape
    expect(descriptor.origin.bindings?.map(item => item.id)).toEqual([
      'content',
      'motion#sample.hva',
    ])
    await session?.dispose()
  })
})

describe('the two root boundaries stay distinguishable', () => {
  /*
   * Two backends refuse a path outside the granted roots, for the same reason and to different
   * ends: the editing backend is about to write, the companion origin is about to look. They
   * therefore report different codes, and these two assertions are deliberately independent — a
   * single shared helper would let one code drift into the other's place without a failure.
   */
  it('the companion filesystem origin refuses with its own read-side code', async () => {
    const directory = await workingCopy({ companion: true })
    const elsewhere = await mkdtemp(join(tmpdir(), 'x3-other-root-'))
    temporaries.push(elsewhere)

    let code = 'no-error'
    try {
      createFilesystemCompanionOrigin({
        primaryPath: join(directory, 'sample.vxl'),
        roots: [elsewhere],
      })
    } catch (error) {
      code = isModkitError(error) ? error.code : `not-a-modkit-error:${String(error)}`
    }
    expect(code).toBe(COMPANION_ORIGIN_OUTSIDE_ROOTS)
    // and specifically not the editing backend's code, which means something else happened
    expect(code).not.toBe('x3.host/edit-path-outside-roots')
  })

  it('the file editing backend keeps reporting the editing code', async () => {
    const directory = await workingCopy({ companion: true })
    const elsewhere = await mkdtemp(join(tmpdir(), 'x3-edit-root-'))
    temporaries.push(elsewhere)
    const backend = createFileEditingBackend({ roots: [elsewhere] })
    const outside = join(directory, 'sample.vxl')
    const uri = pathToFileURL(outside).href

    await expect(
      backend.currentRevision({
        targetId: 'content',
        subjectUri: uri,
        ownerSource: { id: uri, uri },
        semanticPath: [],
        expectedRevision: {
          bindings: { content: revisionId('provider-token:companion-boundary') },
          compositionFingerprint: 'companion-boundary',
        },
      }),
    ).rejects.toMatchObject({ code: 'x3.host/edit-path-outside-roots' })
  })
})

describe('subject services carry the resolver a product supplies', () => {
  it('opens a composite plan when the caller passes resolveInput, and fails closed without it', async () => {
    const directory = await workingCopy({ companion: true })
    const services = await fixtureServices()
    const path = join(directory, 'sample.vxl')
    const request = {
      source: await openFileArtifactSource(path),
      path,
      intent: 'full' as const,
      grant: { id: 'companion-propagation', classes: ['read-source'] as const },
      budget,
    }

    const withoutResolver = await services.open(request)
    expect(withoutResolver.state).toBe('unresolved')
    expect(withoutResolver.diagnostics.map(item => item.code)).toContain(
      'x3.host/input-resolver-required',
    )

    const resolveInput = createCompanionInputResolver(
      createFilesystemCompanionOrigin({ primaryPath: path, roots: [directory] }),
    )
    const withResolver = await services.open({ ...request, resolveInput })
    expect(withResolver.state).toBe('opened')
    if (withResolver.state !== 'opened') throw new Error('the supplied resolver did not open')
    await withResolver.session.dispose()
  })

  it('reports the structured refusal a product needs to explain the failure', async () => {
    const directory = await workingCopy({ companion: false })
    const services = await fixtureServices()
    const path = join(directory, 'sample.vxl')
    const reported: Diagnostic[] = []
    const resolveInput = createCompanionInputResolver(
      createFilesystemCompanionOrigin({ primaryPath: path, roots: [directory] }),
      { onDiagnostic: item => reported.push(item) },
    )

    const result = await services.open({
      source: await openFileArtifactSource(path),
      path,
      intent: 'full',
      grant: { id: 'companion-refusal', classes: ['read-source'] },
      budget,
      resolveInput,
    })

    expect(result.state).toBe('unresolved')
    expect(reported).toEqual([
      expect.objectContaining({
        code: COMPANION_REQUIRED_MISSING,
        severity: 'error',
        data: expect.objectContaining({
          requirementId: 'motion',
          role: 'animation',
          cardinality: 'one',
          checkedScopes: ['sibling-directory'],
        }),
      }),
    ])
  })

  it('refuses a composite plan for an in-memory source that has no origin at all', async () => {
    const directory = await workingCopy({ companion: true })
    const services = await fixtureServices()
    const bytes = new TextEncoder().encode('X3VXLREQ\nsections=2\n')
    const uri = 'memory://companion/no-origin.vxl'
    const result = await services.open({
      source: {
        kind: 'bytes',
        ref: { id: uri, uri },
        revision: (await openFileArtifactSource(join(directory, 'sample.vxl'))).revision,
        size: BigInt(bytes.byteLength),
        async read(offset, length) {
          return bytes.slice(Number(offset), Number(offset) + length)
        },
        async *stream() {
          yield bytes
        },
      },
      path: 'no-origin.vxl',
      intent: 'full',
      grant: { id: 'companion-no-origin', classes: ['read-source'] },
      budget,
    })

    expect(result.state).toBe('unresolved')
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/input-resolver-required')
  })
})
