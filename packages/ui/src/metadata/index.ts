/**
 * MetadataPanel (P5) and PropertiesTable — MK2 assets-viewer parity.
 *
 * Both read the descriptor only. No data-source binding, no new contract: metadata groups and
 * observed traits are already part of `AnyDescriptor`, which is what the MK2 panels showed too.
 */
import type {
  AnyDescriptor,
  MetadataGroup,
  ResolvedAssetDescriptor,
  ViewerModule,
} from '@modkitx-x3/sdk'
import {
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setViewerText,
  ViewerMountScope,
} from '../viewer/index.js'

/** `AnyDescriptor` also covers the unresolved arm, which carries neither metadata nor identity. */
function resolved(descriptor: AnyDescriptor): ResolvedAssetDescriptor | undefined {
  return 'identity' in descriptor ? (descriptor as ResolvedAssetDescriptor) : undefined
}

function renderMetadata(root: HTMLElement, descriptor: AnyDescriptor): void {
  root.replaceChildren()
  const groups: readonly MetadataGroup[] = resolved(descriptor)?.metadata ?? []
  if (groups.length === 0) {
    element(root, 'p', { text: 'No metadata reported by the codec.', part: 'viewer.empty' })
    return
  }
  for (const group of groups) {
    const section = element(root, 'section', { part: 'metadata.group' })
    element(section, 'h3', { text: group.label, part: 'metadata.heading' })
    const list = element(section, 'dl')
    for (const entry of group.entries) {
      const row = element(list, 'div', { part: 'metadata.row' })
      element(row, 'dt', { text: entry.key, part: 'metadata.label' })
      const value = element(row, 'dd', { part: 'metadata.value' })
      setViewerText(value, entry.value, 4096)
      value.title = String(entry.value)
    }
  }
}

export const metadataPanel: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Metadata')
    const body = element(root, 'div', { part: 'metadata' })
    renderMetadata(body, args.descriptor)
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
      renderMetadata(body, descriptor)
    })
  },
})

/**
 * Observed traits, their state and their parameters, as a flat property table.
 * This is the "what does the codec actually claim about this subject" view MK2 showed as
 * the properties pane; it is descriptor truth, not a semantic property graph (that is V18).
 */
function renderProperties(root: HTMLElement, descriptor: AnyDescriptor): void {
  root.replaceChildren()
  const rows: { name: string; value: string; origin: string }[] = [
    { name: 'subject', value: descriptor.subjectUri, origin: 'identity' },
    { name: 'revision', value: descriptor.revision, origin: 'identity' },
    {
      name: 'interpretation',
      value: String(resolved(descriptor)?.interpretation ?? 'unresolved'),
      origin: 'identity',
    },
  ]
  const identity = resolved(descriptor)?.identity as
    { formatId?: string; formatLabel?: string; codecId?: string; confidence?: number } | undefined
  if (identity !== undefined) {
    if (identity.formatId !== undefined)
      rows.push({ name: 'format', value: identity.formatId, origin: 'identity' })
    if (identity.codecId !== undefined)
      rows.push({ name: 'codec', value: identity.codecId, origin: 'identity' })
    if (identity.confidence !== undefined)
      rows.push({ name: 'confidence', value: identity.confidence.toFixed(2), origin: 'detection' })
  }
  for (const trait of descriptor.traits) {
    const parameters = Object.entries(trait.parameters ?? {})
    rows.push({
      name: trait.id,
      value:
        parameters.length === 0
          ? trait.state
          : `${trait.state} · ${parameters.map(([key, item]) => `${key}=${String(item)}`).join(', ')}`,
      origin: 'trait',
    })
  }
  for (const operation of descriptor.operations) {
    rows.push({
      name: operation.id,
      value: `${operation.state}${operation.mutatesSource ? ' · mutates source' : ''}`,
      origin: 'operation',
    })
  }

  for (const row of rows) {
    const line = element(root, 'div', { part: 'properties.row' })
    element(line, 'span', { text: row.name, part: 'properties.name' })
    element(line, 'span', { text: row.value, part: 'properties.value' })
    element(line, 'span', { text: row.origin, part: 'properties.origin' })
  }
}

export const propertiesTable: ViewerModule = defineViewerModule({
  abiVersion: 1,
  async mount(args) {
    const scope = new ViewerMountScope(args.signal)
    const root = createSurface(args.container, 'Properties')
    const body = element(root, 'div', { part: 'properties' })
    body.setAttribute('role', 'table')
    renderProperties(body, args.descriptor)
    return createViewerMount(root, scope, args, ({ descriptor }) => {
      root.dataset['revision'] = descriptor.revision
      renderProperties(body, descriptor)
    })
  },
})
