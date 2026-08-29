import { realpath } from 'node:fs/promises'
import { dirname } from 'node:path'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'

import { createHostMcpPort } from '../src/host-port.js'
import { createModkitMcpServer } from '../src/server.js'
import type { McpEnvelope } from '../src/protocol.js'

const required = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
}

const handleFrom = (data: unknown): string => (data as { readonly handle: string }).handle

const structured = (value: { readonly structuredContent?: unknown }): McpEnvelope =>
  value.structuredContent as McpEnvelope

async function proveSelectableSubject(
  subjectPath: string,
  extensionRoots: readonly string[],
  query: { readonly kind?: string; readonly type?: string; readonly text?: string },
  candidatePath?: string,
  allowedRoots?: readonly string[],
): Promise<void> {
  const canonicalSubject = await realpath(subjectPath)
  const roots =
    allowedRoots === undefined
      ? [dirname(canonicalSubject)]
      : await Promise.all(allowedRoots.map(root => realpath(root)))
  const host = await createHostMcpPort({
    roots,
    extensions: extensionRoots,
  })
  const app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'modkit-mcp-corpus', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
  let parentHandle: string | undefined
  let entityHandle: string | undefined
  try {
    let opened = structured(
      await client.callTool({
        name: 'modkit.open_subject',
        arguments: { path: canonicalSubject },
      }),
    )
    parentHandle = handleFrom(opened.data)
    let openedData = opened.data as {
      readonly descriptor: { readonly dataSources: readonly { readonly contract: string }[] }
      readonly selectionCandidates?: readonly {
        readonly candidateId: string
        readonly sourcePath?: string
      }[]
    }
    if (openedData.selectionCandidates !== undefined && candidatePath !== undefined) {
      const candidate = openedData.selectionCandidates.find(
        item => item.sourcePath === candidatePath,
      )
      if (candidate === undefined) {
        throw new Error(`requested candidate absent: ${candidatePath}`)
      }
      opened = structured(
        await client.callTool({
          name: 'modkit.open_selection',
          arguments: { handle: parentHandle, selectionId: candidate.candidateId },
        }),
      )
      openedData = opened.data as typeof openedData
    }
    if (candidatePath !== undefined) {
      const diagnosticCodes = opened.diagnostics.map(item => item.code)
      expect(diagnosticCodes).toContain(
        'org.modkitx.blizzard.starcraft2/map-preview-document-info-closure',
      )
      expect(diagnosticCodes).not.toContain(
        'org.modkitx.blizzard.starcraft2/map-preview-document-info-unavailable',
      )
      const unresolvedDependency = opened.diagnostics.find(
        item =>
          item.code ===
          'org.modkitx.blizzard.starcraft2/map-preview-document-info-dependency-unresolved',
      )
      expect(unresolvedDependency, JSON.stringify(unresolvedDependency)).toBeUndefined()
      const unavailableDependencyDocument = opened.diagnostics.find(
        item =>
          item.code ===
          'org.modkitx.blizzard.starcraft2/map-preview-dependency-document-info-unavailable',
      )
      if (unavailableDependencyDocument !== undefined) {
        expect(unavailableDependencyDocument).toMatchObject({
          severity: 'warning',
          message:
            '3 dependency DocumentInfo document(s) were unavailable: mods/liberty.sc2mod (missing), campaigns/liberty.sc2campaign (missing), campaigns/libertystory.sc2campaign (missing)',
        })
      }
    }
    if (openedData === null || openedData === undefined) {
      throw new Error(
        `subject open returned no descriptor data: diagnostics=${JSON.stringify(opened.diagnostics)}`,
      )
    }
    const descriptor = openedData.descriptor
    if (descriptor === undefined) {
      throw new Error(
        `selected subject did not open: data=${JSON.stringify(opened.data)} diagnostics=${JSON.stringify(opened.diagnostics)}`,
      )
    }
    if (
      !descriptor.dataSources.some(
        source => source.contract === 'common.view/subject-selector-source',
      )
    ) {
      throw new Error(
        `subject selector absent; sources=${JSON.stringify(descriptor.dataSources)} diagnostics=${JSON.stringify(opened.diagnostics)}`,
      )
    }
    const subjects = structured(
      await client.callTool({
        name: 'modkit.list_subjects',
        arguments: { handle: parentHandle, limit: 20, ...query },
      }),
    )
    const items = (subjects.data as { readonly items: readonly { readonly subjectId: string }[] })
      .items
    if (items.length === 0) {
      const sample = structured(
        await client.callTool({
          name: 'modkit.list_subjects',
          arguments: { handle: parentHandle, limit: 20 },
        }),
      )
      throw new Error(
        `no subject matched ${JSON.stringify(query)}; sample=${JSON.stringify(sample.data)}`,
      )
    }
    const first = items[0]
    if (first === undefined) throw new Error('subject selector returned an empty first item')
    const exact = structured(
      await client.callTool({
        name: 'modkit.search_subjects',
        arguments: { handle: parentHandle, subjectId: first.subjectId, limit: 20 },
      }),
    )
    expect(exact.data).toMatchObject({
      items: [
        {
          subjectId: first.subjectId,
          locator: { kind: 'nested-subject', handle: parentHandle },
          coordinate: { namespace: expect.any(String), entityId: expect.any(String) },
        },
      ],
    })
    const selected = structured(
      await client.callTool({
        name: 'modkit.select_subject',
        arguments: { handle: parentHandle, subjectId: first.subjectId },
      }),
    )
    entityHandle = handleFrom(selected.data)
    const facts = structured(
      await client.callTool({
        name: 'modkit.subject_facts',
        arguments: { handle: entityHandle, view: 'summary' },
      }),
    )
    const calculations = structured(
      await client.callTool({
        name: 'modkit.subject_calculations',
        arguments: { handle: entityHandle, view: 'summary' },
      }),
    )
    expect(facts.snapshotId).toBe(selected.snapshotId)
    expect(calculations.snapshotId).toBe(selected.snapshotId)
    expect(facts.completeness).not.toBe('invalid')
    expect(calculations.completeness).not.toBe('invalid')

    const entityClosed = structured(
      await client.callTool({
        name: 'modkit.close_selected_subject',
        arguments: { handle: entityHandle },
      }),
    )
    expect(entityClosed.data).toMatchObject({ state: 'closed', handle: entityHandle })
    const duplicateEntityClose = structured(
      await client.callTool({
        name: 'modkit.close_selected_subject',
        arguments: { handle: entityHandle },
      }),
    )
    expect(duplicateEntityClose.diagnostics[0]?.code).toBe('x3.mcp/unknown-handle')
    entityHandle = undefined

    const parentClosed = structured(
      await client.callTool({
        name: 'modkit.close_subject',
        arguments: { handle: parentHandle },
      }),
    )
    expect(parentClosed.data).toMatchObject({ state: 'closed', handle: parentHandle })
    const duplicateParentClose = structured(
      await client.callTool({
        name: 'modkit.close_subject',
        arguments: { handle: parentHandle },
      }),
    )
    expect(duplicateParentClose.diagnostics[0]?.code).toBe('x3.mcp/unknown-handle')
    parentHandle = undefined
  } finally {
    if (entityHandle !== undefined) {
      await client.callTool({
        name: 'modkit.close_selected_subject',
        arguments: { handle: entityHandle },
      })
    }
    if (parentHandle !== undefined) {
      await client.callTool({
        name: 'modkit.close_subject',
        arguments: { handle: parentHandle },
      })
    }
    await client.close()
    await app.dispose()
    await host.close()
  }
}

async function proveDiscoveredInstallation(
  installedRoot: string,
  extensionRoots: readonly string[],
  gameId: string,
): Promise<void> {
  const canonicalRoot = await realpath(installedRoot)
  const host = await createHostMcpPort({ roots: [canonicalRoot], extensions: extensionRoots })
  const app = createModkitMcpServer(host)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'modkit-mcp-installed-corpus', version: '1.0.0' })
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)])
  let handle: string | undefined
  try {
    const discovered = structured(
      await client.callTool({
        name: 'modkit.discover_installations',
        arguments: { gameId, maxCandidates: 16 },
      }),
    )
    const items = (
      discovered.data as {
        readonly items: readonly {
          readonly selectionId: string
          readonly gameId: string
          readonly openable: boolean
          readonly version?: string
        }[]
      }
    ).items
    const installation = items.find(item => item.gameId === gameId)
    expect(installation).toMatchObject({ openable: true, version: expect.any(String) })
    if (installation === undefined) throw new Error(`installed ${gameId} selection is absent`)
    const opened = structured(
      await client.callTool({
        name: 'modkit.open_discovered',
        arguments: { selectionId: installation.selectionId },
      }),
    )
    expect(opened.data, JSON.stringify(opened.diagnostics)).toMatchObject({
      state: 'opened',
      handle: expect.any(String),
    })
    handle = handleFrom(opened.data)
    const inspected = structured(
      await client.callTool({ name: 'modkit.inspect', arguments: { handle } }),
    )
    expect(inspected.completeness).not.toBe('invalid')
    const closed = structured(
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle } }),
    )
    expect(closed.data).toMatchObject({ state: 'closed', handle })
    handle = undefined
  } finally {
    if (handle !== undefined) {
      await client.callTool({ name: 'modkit.close_subject', arguments: { handle } })
    }
    await client.close()
    await app.dispose()
    await host.close()
  }
}

describe('real read-only MCP subject selection', () => {
  it('discovers and opens the installed Warzone Windows Store package', async () => {
    await proveDiscoveredInstallation(
      required('MODKIT_MCP_WZ_INSTALLED_ROOT'),
      [required('MODKIT_MCP_WZ_EXTENSION')],
      'org.modkitx/warzone-2100',
    )
  }, 120_000)

  it('discovers and opens the installed StarCraft II CASC root', async () => {
    await proveDiscoveredInstallation(
      required('MODKIT_MCP_SC2_INSTALLED_ROOT'),
      required('MODKIT_MCP_SC2_EXTENSIONS').split(';'),
      'org.modkitx/starcraft-2',
    )
  }, 120_000)

  it('selects dependency-resolved SC2 data through the map preview host', async () => {
    await proveSelectableSubject(
      required('MODKIT_MCP_SC2_SUBJECT'),
      required('MODKIT_MCP_SC2_EXTENSIONS').split(';'),
      { kind: 'Unit' },
      required('MODKIT_MCP_SC2_CANDIDATE_PATH'),
    )
  }, 120_000)

  it('opens a loose SC2Map directory and selects a custom dependency-merged unit', async () => {
    await proveSelectableSubject(
      required('MODKIT_MCP_SC2_LOOSE_SUBJECT'),
      required('MODKIT_MCP_SC2_EXTENSIONS').split(';'),
      { kind: 'Unit', text: 'Nod' },
      undefined,
      required('MODKIT_MCP_SC2_ALLOWED_ROOTS').split(';'),
    )
  }, 120_000)

  it('selects a Scavenger entity through the Warzone package codec', async () => {
    await proveSelectableSubject(
      required('MODKIT_MCP_WZ_SUBJECT'),
      [required('MODKIT_MCP_WZ_EXTENSION')],
      { text: 'scav' },
    )
  }, 120_000)

  it('selects current entities from the installed Warzone base and multiplayer archives', async () => {
    for (const subjectPath of [
      required('MODKIT_MCP_WZ_INSTALLED_BASE'),
      required('MODKIT_MCP_WZ_INSTALLED_MP'),
    ]) {
      await proveSelectableSubject(subjectPath, [required('MODKIT_MCP_WZ_EXTENSION')], {})
    }
  }, 120_000)
})
