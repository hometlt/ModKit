/**
 * Block 12 slice 12-2 — RTF was the last double route left by slice 11A, and it was not merely
 * untidy: both contributions answered a valid RTF with *exactly* 0.995, the host's untie rule is
 * "strictly highest confidence wins, an exact tie is `ambiguous`", and so an RTF file did not open
 * at all in any host that loaded both families. This file pins the fix from both ends.
 *
 *  - the surviving route reads two pieces of evidence (the `{\rtfN` header and the `.rtf` alias)
 *    where the retired one reads a byte signature, so it wins decisively — and it still wins on a
 *    renamed file, because the header alone is already magic;
 *  - the extension alone never decides: `.rtf` over bytes that are not RTF stays far below any
 *    threshold that opens a subject;
 *  - through the real host, with both extension families loaded, the subject opens and the winner
 *    is the `common/documents` contribution.
 *
 * The staging contribution is still present on purpose — physical removal of `extensions/mk2` is
 * block 30 — but it is now the generated port-pending stub, so it cannot open anything even if it
 * did win. That is asserted here too: a retired route that could still serve is not retired.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildInventory,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  createSubjectServices,
  type Inventory,
} from '@modkitx-x3/host'
import { createPathSubjectOpener, loadExtensionDirectory } from '@modkitx-x3/host/node'
import {
  revisionId,
  type ArtifactByteSource,
  type Codec,
  type ContributionContext,
  type ResourceBudget,
  type TreeDataSource,
} from '@modkitx-x3/sdk'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const nativeModule = join(repoRoot, 'extensions', 'common', 'documents', 'src', 'rtf', 'codec.js')
const stagingModule = join(
  repoRoot,
  'extensions',
  'mk2',
  'uncommon-documents',
  'src',
  'rtf',
  'codec.js',
)

const target = { environment: 'node', operatingSystem: 'windows', architecture: 'x64' } as const
const grant = { id: 'rtf-routing', classes: ['read-source'] } as const
const budget: ResourceBudget = {
  maxInputBytes: 10_000_000n,
  maxDepth: 32,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}

const context: ContributionContext = {
  budgets: budget,
  diagnostics: { report: () => undefined },
  contracts: {
    async resolve() {
      throw new Error('rtf has no service dependency')
    },
    async resolveUnknown() {
      throw new Error('rtf has no foreign service dependency')
    },
  },
}

const executionBackends = createExecutionBackendRegistry([
  {
    profile: 'trusted-in-process',
    supports: (_target, variant) => variant.executionProfile === 'trusted-in-process',
    async activate(activation) {
      return {
        module: (await import(activation.entrypoint.href)) as Record<string, unknown>,
        release: async () => undefined,
      }
    },
  },
])

let cached: Inventory | undefined
async function inventory(): Promise<Inventory> {
  if (cached !== undefined) return cached
  const inputs = await Promise.all(
    [
      ['common', 'documents'],
      ['mk2', 'uncommon-documents'],
    ].map(async parts => ({
      ...(await loadExtensionDirectory(join(repoRoot, 'extensions', ...parts))),
      execution: { origin: 'bundled' as const, allowTrustedInProcess: true },
    })),
  )
  cached = await buildInventory(inputs, createHostContributionContractRegistry())
  return cached
}

const temporaries: string[] = []
afterEach(async () => {
  while (temporaries.length > 0) {
    const directory = temporaries.pop()
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
})

const encode = (text: string): Uint8Array =>
  Uint8Array.from(text, character => character.charCodeAt(0) & 0xff)

function byteSource(bytes: Uint8Array, uri: string): ArtifactByteSource {
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId('content-hash.sha256:common-documents-rtf'),
    size: BigInt(bytes.byteLength),
    async read(offset, length, signal) {
      if (signal?.aborted) throw new Error('cancelled')
      return bytes.slice(Number(offset), Number(offset) + length)
    },
    async *stream() {
      yield bytes
    },
  }
}

async function codecFrom(modulePath: string): Promise<Codec> {
  const module = (await import(pathToFileURL(modulePath).href)) as {
    createCodec(context: ContributionContext): Codec
  }
  return module.createCodec(context)
}

async function confidence(modulePath: string, text: string, uri: string): Promise<number> {
  const probed = await (
    await codecFrom(modulePath)
  ).probe({
    source: byteSource(encode(text), uri),
    plan: { kind: 'bytes', ranges: [{ from: 'start', length: 8192 }], maxBytes: 8192 },
  })
  return probed.confidence
}

const SAMPLE = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times;}}\\f0\\fs24 Hello.\\par}'

describe('12-2 RTF has exactly one active route', () => {
  it('wins on the alias and still wins on a renamed file, where the retired route only reads magic', async () => {
    const uri = 'memory://doc/note.rtf'
    const native = await confidence(nativeModule, SAMPLE, uri)
    const staging = await confidence(stagingModule, SAMPLE, uri)
    // header plus alias against a byte signature: two pieces of evidence beat one
    expect(native).toBe(0.998)
    expect(staging).toBe(0.99)
    expect(native).toBeGreaterThan(staging)

    /*
     * The renamed case is the one the Markdown precedent could leave open and RTF cannot: a `.dat`
     * RTF still reaches both probes through the staging signature rule, so the surviving route has
     * to beat it there too or a renamed file would resolve to a codec that cannot open.
     */
    const renamedNative = await confidence(nativeModule, SAMPLE, 'memory://doc/note.dat')
    const renamedStaging = await confidence(stagingModule, SAMPLE, 'memory://doc/note.dat')
    expect(renamedNative).toBe(0.995)
    expect(renamedNative).toBeGreaterThan(renamedStaging)
  })

  it('never lets the extension alone decide', async () => {
    expect(await confidence(nativeModule, 'not rtf at all\n', 'memory://doc/note.rtf')).toBe(0.3)
    expect(await confidence(nativeModule, 'not rtf at all\n', 'memory://doc/note.txt')).toBe(0.01)
  })

  it('detects the RTF versions the legacy route accepted, so retiring it lost no coverage', async () => {
    // the retired staging manifest matched `{\rtf` with no version at all, and its hand-port
    // accepted `\rtfN`; a surviving route that only knew `\rtf1` would have been a narrowing
    for (const version of [1, 2, 9]) {
      const sample = SAMPLE.replace('\\rtf1', `\\rtf${version}`)
      expect(await confidence(nativeModule, sample, 'memory://doc/note.rtf'), `rtf${version}`).toBe(
        0.998,
      )
    }
  })

  it('leaves the staging route unable to open even if it were selected', async () => {
    const source = byteSource(encode(SAMPLE), 'memory://doc/note.rtf')
    const codec = await codecFrom(stagingModule)
    const input = {
      originKind: 'single' as const,
      bindings: [
        {
          sourceKind: 'candidate' as const,
          bindingId: 'content',
          role: 'content',
          ownership: 'owned' as const,
          source: source.ref,
          revision: source.revision,
        },
      ],
      primaryBindingId: 'content',
      revisions: {
        topology: 'single' as const,
        revision: source.revision,
        bindings: [{ bindingId: 'content', revision: source.revision }],
        compositionFingerprint: 'rtf-staging',
      },
      bindingsFor: () => [],
      async openBinding() {
        return { value: source, release: async () => undefined }
      },
    }
    await expect(codec.open(input as never, 'inspect', budget)).rejects.toThrow(/not ported yet/u)
  })

  it('opens through the real host with both families loaded, and names the surviving route', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'x3-rtf-'))
    temporaries.push(directory)
    await writeFile(join(directory, 'note.rtf'), encode(SAMPLE))
    const subjects = createSubjectServices({
      inventory: await inventory(),
      target,
      executionBackends,
    })
    const open = createPathSubjectOpener({ subjects, roots: [directory], budget, grant })
    const { snapshot, session } = await open(join(directory, 'note.rtf'))
    /*
     * Before this slice the same call returned `unresolved / ambiguous`: two candidates at 0.995
     * each, and the host refuses to guess between equals. That is what the tie cost — not a wrong
     * winner, but no winner at all.
     */
    expect(snapshot.state).toBe('opened')
    if (session === undefined) throw new Error('the RTF subject opened without a session')
    const descriptor = (await session.descriptor()) as unknown as {
      identity: { codecId: string; confidence: number }
    }
    expect(descriptor.identity.codecId).toBe('org.modkitx/document-rtf')
    expect(descriptor.identity.confidence).toBe(0.998)
    const candidates = (snapshot.candidates ?? []) as readonly {
      contributionId: string
      confidence?: number
    }[]
    const retired = candidates.filter(item => item.contributionId === 'org.modkitx/rtf')
    // the retired route is still shortlisted and still probes; it simply loses, visibly
    expect(retired.some(item => item.confidence === 0.99)).toBe(true)

    const lease = await session.dataSource('common.view/tree-data-source', 1)
    const tree = lease.value as TreeDataSource
    // the surviving route really serves the plane the retired one claimed, not just the id
    expect((await tree.facts(await tree.root())).label).toBe('RTF')
    await lease.release()
    await session.dispose()
  })

  it('keeps the staging contribution present as the generated stub the migration mechanic uses', async () => {
    const module = await readFile(stagingModule, 'utf8')
    // `superseded-staging-present` in the registry means exactly this file: the id is still
    // claimed, the implementation is gone, and block 30 removes the directory
    expect(module).toContain('@generated by scripts/convert-mk2.mjs')
    expect(module).toContain('x3.mk2/port-pending')
    const ratchet = JSON.parse(
      await readFile(join(repoRoot, 'scripts', 'mk2-port-ratchet.json'), 'utf8'),
    ) as { families: Record<string, number>; minimumTotal: number }
    // the port relocated rather than evaporated: one family lost it, the other gained it
    expect(ratchet.families['mk2/uncommon-documents']).toBe(13)
    expect(ratchet.families['common/documents']).toBe(4)
    expect(ratchet.minimumTotal).toBe(168)
  })
})
