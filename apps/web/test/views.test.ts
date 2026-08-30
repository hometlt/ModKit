/**
 * A2: the PWA's preview policy, decided by the descriptor a real codec produced.
 *
 * The subjects are opened the way the page opens them — the attested catalog, the served artifacts,
 * the production worker entry in a fake module Worker — so the stage list is asserted against what
 * the codecs actually publish, not against a hand-written descriptor. The one synthetic descriptor
 * JSON is native Core functionality; the synthetic case below isolates presentation policy.
 */
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AnyDescriptor } from '@modkitx-x3/sdk'
import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import { createWebSubjectServices, type WebSubjectServices } from '../src/subjects.js'
import {
  applicableStages,
  createWebPreviewStages,
  EDITABLE_STAGE_IDS,
  stageIdOf,
} from '../src/views.js'
import {
  budget,
  diskOrigin,
  domGlobals,
  fileSource,
  identity,
  memorySource,
  nodeModuleMap,
  ORIGIN,
  probe,
  repositoryRoot,
  spawned,
} from './browser-harness.js'

const stages = createWebPreviewStages({ operationsFor: () => undefined })
const publicDir = join(repositoryRoot, 'apps', 'web', 'public')

afterEach(() => {
  spawned.splice(0)
})

async function services(): Promise<WebSubjectServices> {
  const site = diskOrigin()
  return createWebSubjectServices({
    baseUrl: ORIGIN,
    catalog: WEB_EXTENSION_CATALOG,
    identity,
    probe,
    dom: domGlobals(site.fetch),
    moduleMap: nodeModuleMap,
  })
}

/** Open a served file exactly as the shell does and return the stage ids the policy resolves. */
async function stageIdsFor(
  path: string,
  name: string,
): Promise<{ readonly ids: readonly string[]; readonly descriptor: AnyDescriptor }> {
  const host = await services()
  const result = await host.open({
    source: fileSource(path, name),
    path: name,
    intent: 'full',
    grant: { id: 'pwa-views', classes: ['read-source'] },
    budget,
  })
  if (result.state !== 'opened') throw new Error(`${name} did not open: ${JSON.stringify(result)}`)
  const descriptor = await result.session.descriptor()
  const ids = applicableStages(stages, descriptor).map(stageIdOf)
  await result.session.dispose()
  return { ids, descriptor }
}

describe('web preview policy', () => {
  it('offers every first-party viewer the ui package ships, in preference order', () => {
    expect(stages.map(stageIdOf)).toEqual([
      'image',
      'vector',
      'world',
      'model',
      'audio',
      'video',
      'archive',
      'template',
      'card',
      'calculations',
      'table',
      'tree',
      'relations',
      'text',
      'virtual-text',
      'metadata',
      'hex',
      ...EDITABLE_STAGE_IDS,
    ])
  })

  it('marks only the app-owned metadata and editor surfaces as plan-independent', () => {
    expect(stages.filter(stage => stage.appLocal === true).map(stageIdOf)).toEqual([
      'metadata',
      'text-editor',
      'hex-editor',
    ])
    expect(stages.find(stage => stageIdOf(stage) === 'archive')?.appLocal).not.toBe(true)
    expect(stages.find(stage => stageIdOf(stage) === 'text')?.appLocal).not.toBe(true)
    expect(stages.find(stage => stageIdOf(stage) === 'hex')?.appLocal).not.toBe(true)
  })

  it('drops every editable stage in a host with no editor ports, and only those', () => {
    const descriptor = syntheticDescriptor(
      ['common.view/text-data-source', 'common.view/byte-range-source'],
      ['content.text'],
    )
    const readOnly = applicableStages(stages, descriptor).map(stageIdOf)
    const editing = applicableStages(stages, descriptor, { editorPorts: true }).map(stageIdOf)
    expect(readOnly).toEqual(['text', 'virtual-text', 'metadata', 'hex'])
    expect(editing).toEqual(['text', 'virtual-text', 'metadata', 'hex', ...EDITABLE_STAGE_IDS])
  })

  it('resolves image, tree, metadata and hex for a real PNG, and no text stage', async () => {
    const { ids, descriptor } = await stageIdsFor(
      join(publicDir, 'favicon-32.png'),
      'favicon-32.png',
    )
    expect(ids).toContain('image')
    expect(ids).toContain('tree')
    expect(ids).toContain('metadata')
    expect(ids).toContain('hex')
    // The PNG publishes no text data source, so no text stage may be offered for it.
    expect(ids).not.toContain('text')
    expect(ids).not.toContain('virtual-text')
    expect(descriptor.dataSources.map(offer => offer.contract)).toContain(
      'common.view/raster-image-source',
    )
  }, 30_000)

  it('resolves the table and text stages for a real delimited file', async () => {
    const { ids } = await stageIdsFor(join(publicDir, 'samples', 'sample.csv'), 'sample.csv')
    expect(ids).toContain('table')
    expect(ids).toContain('text')
    expect(ids).toContain('virtual-text')
    expect(ids).toContain('hex')
  }, 30_000)

  it('resolves the tree and text stages for a real INI file', async () => {
    const { ids } = await stageIdsFor(join(publicDir, 'samples', 'sample.ini'), 'sample.ini')
    expect(ids).toContain('tree')
    expect(ids).toContain('text')
    expect(ids).toContain('hex')
    expect(ids).not.toContain('table')
  }, 30_000)

  it('resolves the entries stage for a real container, and its entry bytes come from a non-mutating operation', async () => {
    const host = await services()
    const result = await host.open({
      source: fileSource(join(publicDir, 'samples', 'sample.zip'), 'sample.zip'),
      path: 'sample.zip',
      intent: 'full',
      grant: { id: 'pwa-archive', classes: ['read-source'] },
      budget,
    })
    if (result.state !== 'opened') throw new Error(`sample.zip did not open: ${result.reason}`)
    const descriptor = await result.session.descriptor()
    expect(applicableStages(stages, descriptor).map(stageIdOf)).toContain('archive')

    // the namespace lists the entries the archive really holds
    const namespace = await result.session.dataSource('common.view/namespace-entry-source', 1)
    const page = await namespace.value.list('', { limit: 50 })
    expect(page.items.map(item => item.path)).toContain('readme.txt')
    // and `openEntry` answers with a reference, which is why the bytes need the operation
    const first = page.items.find(item => item.kind === 'file')
    if (first === undefined) throw new Error('the archive listed no file entry')
    const reference = await namespace.value.openEntry(first.id)
    expect(reference.value.uri).toMatch(/^zip-entry:/u)
    await reference.release()
    await namespace.release()

    const extract = descriptor.operations.find(operation => operation.id === 'container.extract')
    expect(extract?.mutatesSource).toBe(false)
    if (extract === undefined) throw new Error('the container declares no entry extraction')
    const invoked = await result.session
      .operations()
      .invoke(extract.handlerId, { entryId: first.id })
    expect(invoked.state).toBe('ok')
    if (invoked.state !== 'ok' || invoked.output.kind !== 'bytes') {
      throw new Error('entry extraction did not answer with bytes')
    }
    expect(new TextDecoder().decode(invoked.output.value)).toMatch(/lives inside sample\.zip/u)
    await result.session.dispose()
  }, 30_000)

  it('resolves the vector stage for a real SVG', async () => {
    const { ids } = await stageIdsFor(join(publicDir, 'samples', 'sample.svg'), 'sample.svg')
    expect(ids).toContain('vector')
    expect(ids).toContain('hex')
  }, 30_000)

  it('a JSON-shaped descriptor resolves text, tree and table as applicable', () => {
    expect(WEB_EXTENSION_CATALOG.excluded.map(entry => entry.name)).not.toContain('text-json')

    const treeShaped = syntheticDescriptor(
      [
        'common.view/text-data-source',
        'common.view/tree-data-source',
        'common.view/byte-range-source',
      ],
      ['content.text', 'structure.hierarchy'],
    )
    expect(applicableStages(stages, treeShaped).map(stageIdOf)).toEqual([
      'tree',
      'text',
      'virtual-text',
      'metadata',
      'hex',
    ])

    const tableShaped = syntheticDescriptor(
      [
        'common.view/text-data-source',
        'common.view/table-data-source',
        'common.view/byte-range-source',
      ],
      ['content.text', 'table.cells'],
    )
    expect(applicableStages(stages, tableShaped).map(stageIdOf)).toEqual([
      'table',
      'text',
      'virtual-text',
      'metadata',
      'hex',
    ])
  })

  it('a text data source without the content.text trait gets no text stage', () => {
    const untagged = syntheticDescriptor(
      ['common.view/text-data-source', 'common.view/byte-range-source'],
      [],
    )
    expect(applicableStages(stages, untagged).map(stageIdOf)).toEqual(['metadata', 'hex'])
  })

  it('a container publishing a namespace gets the entries stage', () => {
    const archive = syntheticDescriptor(
      [
        'common.view/namespace-entry-source',
        'common.view/tree-data-source',
        'common.view/byte-range-source',
      ],
      ['container.entries'],
    )
    expect(applicableStages(stages, archive).map(stageIdOf)).toEqual([
      'archive',
      'tree',
      'metadata',
      'hex',
    ])
  })

  it('media descriptors get their own stage plus the universal ones', () => {
    const audio = syntheticDescriptor(
      [
        'common.view/audio-media-source',
        'common.view/transport-source',
        'common.view/byte-range-source',
      ],
      ['audio.streams'],
    )
    expect(applicableStages(stages, audio).map(stageIdOf)).toEqual(['audio', 'metadata', 'hex'])

    const video = syntheticDescriptor(
      ['common.view/video-media-source', 'common.view/byte-range-source'],
      ['video.streams'],
    )
    expect(applicableStages(stages, video).map(stageIdOf)).toEqual(['video', 'metadata', 'hex'])

    const model = syntheticDescriptor(
      ['common.view/model-scene-source', 'common.view/byte-range-source'],
      ['model.geometry'],
    )
    expect(applicableStages(stages, model).map(stageIdOf)).toEqual(['model', 'metadata', 'hex'])
  })

  it('a subject that publishes nothing resolves no stage at all', () => {
    expect(applicableStages(stages, syntheticDescriptor([], []))).toEqual([])
    // and the byte source alone is still worth two: the metadata panel and hex
    expect(
      applicableStages(stages, syntheticDescriptor(['common.view/byte-range-source'], [])).map(
        stageIdOf,
      ),
    ).toEqual(['metadata', 'hex'])
  })

  it('reads an in-memory subject through the same services the page uses', async () => {
    const host = await services()
    const bytes = new TextEncoder().encode('a,b\n1,2\n')
    const result = await host.open({
      source: memorySource('inline.csv', bytes),
      path: 'inline.csv',
      intent: 'full',
      grant: { id: 'pwa-inline', classes: ['read-source'] },
      budget,
    })
    expect(result.state).toBe('opened')
    if (result.state !== 'opened') throw new Error(result.reason)
    expect(result.diagnostics.map(item => item.code)).toContain('x3.host/worker-shared-process')
    expect(applicableStages(stages, await result.session.descriptor()).map(stageIdOf)).toContain(
      'table',
    )
    await result.session.dispose()
  }, 30_000)
})

/** A descriptor with only the two fields the policy reads, in the shape the wire uses. */
function syntheticDescriptor(
  contracts: readonly string[],
  traits: readonly string[],
): AnyDescriptor {
  return {
    schemaVersion: 2,
    subjectUri: 'memory://web/synthetic',
    revision: 'content-hash.sha256:synthetic',
    interpretation: 'none',
    candidates: [],
    origin: { kind: 'source' },
    constraints: { readOnly: true, seekable: true, randomAccess: true, trusted: false },
    operations: [],
    diagnostics: [],
    traits: traits.map(id => ({ id, descriptorVersion: 1, state: 'available' })),
    dataSources: contracts.map(contract => ({ contract, major: 1 })),
  } as unknown as AnyDescriptor
}
