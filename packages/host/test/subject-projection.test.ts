import { describe, expect, it, vi } from 'vitest'
import {
  nestedSubject,
  parseSubjectRef,
  rootSubject,
  serializeSubjectRef,
} from '@modkit/sdk/subjects'
import {
  assembleSubjectDescriptor,
  createAssetSession,
  createCompositeRelationGraphSource,
  createFieldRelationGraphSource,
  type SubjectFieldReferenceRequest,
  type SubjectFieldReferenceResolver,
  type SubjectRelationTarget,
} from '@modkit/host'
import type {
  Page,
  PageRequest,
  PermissionGrant,
  RelationGraphEdge,
  RelationGraphNode,
  RelationGraphSource,
  ResolvedAssetDescriptorWire,
} from '@modkit/sdk'

const grant: PermissionGrant = { id: 'projection-grant', classes: ['read-source'] }

async function all<T>(read: (page: PageRequest) => Promise<Page<T>>): Promise<readonly T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const page = await read({ ...(cursor === undefined ? {} : { cursor }), limit: 2 })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor !== undefined)
  return items
}

function target(request: SubjectFieldReferenceRequest, resolved: boolean): SubjectRelationTarget {
  const root = rootSubject({ id: 'memory://fixture/map.SC2Map' }, 'fixture')
  if (request.type.kind === 'asset-ref') {
    return {
      subject: rootSubject({ id: `memory://fixture/${request.value}` }, 'fixture'),
      label: request.value,
      kind: 'format:dds',
    }
  }
  return {
    subject: nestedSubject(
      root,
      resolved
        ? request.type.kind === 'text-key'
          ? 'fixture/text-key'
          : 'fixture/weapon'
        : 'fixture/unresolved',
      request.value,
    ),
    label: request.value,
    kind: resolved
      ? request.type.kind === 'text-key'
        ? 'fixture/text-key'
        : 'fixture/weapon'
      : 'fixture/unresolved',
  }
}

const resolver: SubjectFieldReferenceResolver = {
  async resolve(request) {
    return request.value === 'MissingWeapon' ? undefined : target(request, true)
  },
  createUnresolved(request) {
    return target(request, false)
  },
}

describe('P3 generic subject projection', () => {
  it('projects asset, subject and text references with stable field roles and dead targets', async () => {
    const owner = nestedSubject(
      rootSubject({ id: 'memory://fixture/map.SC2Map' }, 'fixture'),
      'fixture/unit',
      'Marine',
    )
    const source = await createFieldRelationGraphSource({
      owner,
      ownerLabel: 'Marine',
      ownerKind: 'fixture/unit',
      resolver,
      fields: [
        {
          path: 'catalog.icon',
          type: { kind: 'asset-ref', accepts: { formatIds: ['dds'] } },
          value: 'Assets/Marine.dds',
        },
        {
          path: 'catalog.weapons',
          type: { kind: 'array', item: { kind: 'subject-ref', subjectKind: 'fixture/weapon' } },
          value: ['GaussRifle', 'MissingWeapon'],
        },
        {
          path: 'catalog.name',
          type: { kind: 'text-key', catalog: 'GameStrings' },
          value: 'Unit/Name/Marine',
        },
      ],
    })

    const nodes = await all(page => source.nodes(page))
    const edges = await all(page => source.edges(page))
    expect(edges.map(edge => edge.role).sort()).toEqual([
      'catalog.icon',
      'catalog.name',
      'catalog.weapons[0]',
      'catalog.weapons[1]',
    ])
    expect(edges.find(edge => edge.role === 'catalog.weapons[1]')).toMatchObject({ dead: true })
    const assetNode = nodes.find(node => node.label === 'Assets/Marine.dds')
    expect(assetNode?.subject).toBe(
      serializeSubjectRef(rootSubject({ id: 'memory://fixture/Assets/Marine.dds' }, 'fixture')),
    )
    expect(parseSubjectRef(assetNode?.subject ?? '').identity).toEqual({ kind: '', key: '' })
    expect(nodes.every(node => node.subject !== undefined && node.kind !== undefined)).toBe(true)
  })

  it('merges authoritative and generic graphs without duplicate edges and improves dead edges', async () => {
    const owner = rootSubject({ id: 'memory://fixture/unit' })
    const projected = await createFieldRelationGraphSource({
      owner,
      ownerLabel: 'Unit',
      ownerKind: 'fixture/unit',
      resolver,
      fields: [
        {
          path: 'weapon',
          type: { kind: 'subject-ref', subjectKind: 'fixture/weapon' },
          value: 'GaussRifle',
        },
      ],
    })
    const projectedNodes = await all(page => projected.nodes(page))
    const projectedEdges = await all(page => projected.edges(page))
    const authoritative = fixedGraph(
      projectedNodes.map(node => ({ id: node.id, label: node.label, type: node.type })),
      projectedEdges.map(edge => ({ ...edge, dead: true })),
    )
    const merged = createCompositeRelationGraphSource([authoritative, projected])
    expect(await all(page => merged.edges(page))).toEqual(projectedEdges)
    expect((await all(page => merged.nodes(page))).every(node => node.subject !== undefined)).toBe(
      true,
    )
  })

  it('adds a DDS-like fallback card with kind layout without codec-owned card code', async () => {
    const descriptor = await assembleSubjectDescriptor(ddsDescriptor())
    const managed = createAssetSession({
      revision: descriptor.revision,
      descriptor,
      operationDeclarations: [],
      permissionGrant: grant,
      handlers: new Map(),
      openDataSource: async () => {
        throw new Error('the fallback card must not acquire a preview codec source')
      },
      subjectProjection: {
        references: resolver,
        kindDefinition: {
          kindId: 'format:dds',
          label: 'DDS image',
          card: { sections: ['identity', 'traits', 'texture'], preview: 'raster' },
        },
      },
    })

    const sessionDescriptor = await managed.session.descriptor()
    expect(sessionDescriptor.dataSources).toContainEqual({
      contract: 'common.view/subject-facts-source',
      major: 1,
    })
    const lease = await managed.session.dataSource('common.view/subject-facts-source', 1)
    const summary = await lease.value.summary()
    expect(summary.identity).toMatchObject({ kind: 'format:dds', label: 'DirectDraw Surface' })
    expect(summary.preview).toMatchObject({
      source: { id: 'texture.dds', uri: 'memory://fixture/texture.dds' },
      mediaType: 'image/vnd-ms.dds',
    })
    expect(summary.card).toEqual({
      sections: ['identity', 'traits', 'texture'],
      preview: 'raster',
    })
    expect(summary.relationCount).toBe(1)
    expect(await all(page => lease.value.relations(page))).toEqual([
      expect.objectContaining({
        role: 'texture.source-image',
        label: 'Assets/Source.dds',
        kind: 'format:dds',
      }),
    ])
    const groups = await all(page => lease.value.groups(page))
    expect(groups.map(group => group.id)).toEqual(['identity', 'traits', 'texture'])
    await lease.release()
    await managed.session.dispose()
  })

  it('propagates an authoritative facts failure instead of replacing it with fallback facts', async () => {
    const base = ddsDescriptor()
    const wire: ResolvedAssetDescriptorWire = {
      ...base,
      dataSources: [
        ...base.dataSources,
        { contract: 'common.view/subject-facts-source', major: 1 },
      ],
    }
    const descriptor = await assembleSubjectDescriptor(wire)
    const failure = new Error('provider facts failed')
    const openDataSource = vi.fn(async () => {
      throw failure
    })
    const managed = createAssetSession({
      revision: descriptor.revision,
      descriptor,
      operationDeclarations: [],
      permissionGrant: grant,
      handlers: new Map(),
      openDataSource,
    })
    await expect(managed.session.dataSource('common.view/subject-facts-source', 1)).rejects.toBe(
      failure,
    )
    expect(openDataSource).toHaveBeenCalledOnce()
    await managed.session.dispose()
  })
})

function fixedGraph(
  nodes: readonly RelationGraphNode[],
  edges: readonly RelationGraphEdge[],
): RelationGraphSource {
  return {
    async summary() {
      return {
        snapshotId: 'authoritative',
        totalNodes: nodes.length,
        totalEdges: edges.length,
        types: [{ id: 'fixture/unit', label: 'Unit', count: nodes.length, tone: 0 }],
        completeness: 'complete',
      }
    },
    async nodes(page) {
      return slice(nodes, page)
    },
    async edges(page) {
      return slice(edges, page)
    },
  }
}

function slice<T>(items: readonly T[], page: PageRequest): Page<T> {
  const offset = Number(page.cursor ?? 0)
  const end = Math.min(offset + page.limit, items.length)
  return {
    items: items.slice(offset, end),
    ...(end < items.length ? { nextCursor: String(end) } : {}),
  }
}

function ddsDescriptor(): ResolvedAssetDescriptorWire {
  return {
    schemaVersion: 2,
    subjectUri: 'memory://fixture/texture.dds',
    origin: {
      kind: 'single',
      binding: {
        id: 'content',
        role: 'content',
        source: { id: 'texture.dds', uri: 'memory://fixture/texture.dds' },
        required: true,
        ownership: 'owned',
        revision: 'content-hash.sha256:dds-fixture',
        mediaType: 'image/vnd-ms.dds',
      },
    },
    interpretation: 'codec',
    identity: {
      codecId: 'fixture.codec/dds',
      codecVersion: '1.0.0',
      formatId: 'dds',
      formatLabel: 'DirectDraw Surface',
      mediaType: 'image/vnd-ms.dds',
      confidence: 1,
      detection: [{ kind: 'structure', weight: 1 }],
    },
    traits: [
      { id: 'content.images', descriptorVersion: 1, state: 'available' },
      { id: 'image.raster', descriptorVersion: 1, state: 'available' },
    ],
    operations: [],
    constraints: { readOnly: true, seekable: true, randomAccess: true, trusted: false },
    dataSources: [{ contract: 'common.view/raster-image-source', major: 1 }],
    diagnostics: [],
    revision: 'content-hash.sha256:dds-fixture',
    metadata: [
      {
        id: 'texture',
        label: 'Texture',
        entries: [
          { key: 'width', value: 256, type: { kind: 'number', integer: true, unit: 'px' } },
          { key: 'height', value: 128, type: { kind: 'number', integer: true, unit: 'px' } },
          {
            key: 'source-image',
            value: 'Assets/Source.dds',
            type: { kind: 'asset-ref', accepts: { formatIds: ['dds'] } },
          },
        ],
      },
    ],
  }
}
