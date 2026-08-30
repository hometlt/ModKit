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
import type { UiLocalizationOptions, UiLocalizer } from '../localization/index.js'
import { METADATA_FALLBACK_MESSAGES } from '../localization/fallback-catalogs.generated.js'
import { withEnglishUiFallback } from '../localization/fallback.js'

/** `AnyDescriptor` also covers the unresolved arm, which carries neither metadata nor identity. */
function resolved(descriptor: AnyDescriptor): ResolvedAssetDescriptor | undefined {
  return 'identity' in descriptor ? (descriptor as ResolvedAssetDescriptor) : undefined
}

/** One trait as a value line: its state, then whatever parameters it carries. */
function traitValue(trait: AnyDescriptor['traits'][number]): string {
  const parameters = Object.entries(trait.parameters ?? {})
  if (parameters.length === 0) return trait.state
  const stated = parameters.map(([key, item]) => `${key}=${String(item)}`).join(', ')
  return `${trait.state} · ${stated}`
}

function renderMetadata(
  root: HTMLElement,
  descriptor: AnyDescriptor,
  localizer: UiLocalizer,
): void {
  root.replaceChildren()
  const groups: readonly MetadataGroup[] = resolved(descriptor)?.metadata ?? []
  const traits = descriptor.traits
  if (groups.length === 0 && traits.length === 0) {
    element(root, 'p', { text: localizer.text('metadata.empty'), part: 'viewer.empty' })
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

  /*
   * Observed traits, in the same panel as the metadata groups.
   *
   * A codec's `metadata` is what it chose to write out for a reader; its `traits` are what the
   * host observed about the subject, and several facts live only there — a W3D's pivot count in
   * `model.skeleton`, a VXL's `provenance=companion` in `model.animations`. Those were reachable
   * through `propertiesTable` and nowhere else, so a host that offers a Metadata stage and not a
   * Properties stage simply never showed them. Rendering both here keeps one stage answering
   * "what is known about this subject", which is what the panel is for — and no host has to grow
   * another tab to see descriptor truth.
   */
  if (traits.length === 0) return
  const section = element(root, 'section', { part: 'metadata.group' })
  element(section, 'h3', {
    text: localizer.text('metadata.observedTraits'),
    part: 'metadata.heading',
  })
  const list = element(section, 'dl')
  for (const trait of traits) {
    const row = element(list, 'div', { part: 'metadata.row' })
    element(row, 'dt', { text: trait.id, part: 'metadata.label' })
    const value = element(row, 'dd', { part: 'metadata.value' })
    const text = traitValue(trait)
    setViewerText(value, text, 4096)
    value.title = text
  }
}

export function createMetadataPanel(options: UiLocalizationOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, METADATA_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('metadata.title'))
      const body = element(root, 'div', { part: 'metadata' })
      renderMetadata(body, args.descriptor, localizer)
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
        renderMetadata(body, descriptor, localizer)
      })
    },
  })
}

export const metadataPanel: ViewerModule = createMetadataPanel()

/**
 * Observed traits, their state and their parameters, as a flat property table.
 * This is the "what does the codec actually claim about this subject" view MK2 showed as
 * the properties pane; it is descriptor truth, not a semantic property graph (that is V18).
 */
function renderProperties(
  root: HTMLElement,
  descriptor: AnyDescriptor,
  localizer: UiLocalizer,
): void {
  root.replaceChildren()
  const rows: { name: string; value: string; origin: string }[] = [
    {
      name: localizer.text('metadata.subject'),
      value: descriptor.subjectUri,
      origin: localizer.text('metadata.identity'),
    },
    {
      name: localizer.text('metadata.revision'),
      value: descriptor.revision,
      origin: localizer.text('metadata.identity'),
    },
    {
      name: localizer.text('metadata.interpretation'),
      value: String(resolved(descriptor)?.interpretation ?? localizer.text('metadata.unresolved')),
      origin: localizer.text('metadata.identity'),
    },
  ]
  const identity = resolved(descriptor)?.identity as
    { formatId?: string; formatLabel?: string; codecId?: string; confidence?: number } | undefined
  if (identity !== undefined) {
    if (identity.formatId !== undefined)
      rows.push({
        name: localizer.text('metadata.format'),
        value: identity.formatId,
        origin: localizer.text('metadata.identity'),
      })
    if (identity.codecId !== undefined)
      rows.push({
        name: localizer.text('metadata.codec'),
        value: identity.codecId,
        origin: localizer.text('metadata.identity'),
      })
    if (identity.confidence !== undefined)
      rows.push({
        name: localizer.text('metadata.confidence'),
        value: identity.confidence.toFixed(2),
        origin: localizer.text('metadata.detection'),
      })
  }
  for (const trait of descriptor.traits) {
    const parameters = Object.entries(trait.parameters ?? {})
    rows.push({
      name: trait.id,
      value:
        parameters.length === 0
          ? trait.state
          : `${trait.state} · ${parameters.map(([key, item]) => `${key}=${String(item)}`).join(', ')}`,
      origin: localizer.text('metadata.trait'),
    })
  }
  for (const operation of descriptor.operations) {
    rows.push({
      name: operation.id,
      value: `${operation.state}${operation.mutatesSource ? ` · ${localizer.text('metadata.mutatesSource')}` : ''}`,
      origin: localizer.text('metadata.operation'),
    })
  }

  for (const row of rows) {
    const line = element(root, 'div', { part: 'properties.row' })
    element(line, 'span', { text: row.name, part: 'properties.name' })
    element(line, 'span', { text: row.value, part: 'properties.value' })
    element(line, 'span', { text: row.origin, part: 'properties.origin' })
  }
}

export function createPropertiesTable(options: UiLocalizationOptions = {}): ViewerModule {
  const localizer = withEnglishUiFallback(options.localizer, METADATA_FALLBACK_MESSAGES)
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal)
      const root = createSurface(args.container, localizer.text('metadata.properties'))
      const body = element(root, 'div', { part: 'properties' })
      body.setAttribute('role', 'table')
      renderProperties(body, args.descriptor, localizer)
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset['revision'] = descriptor.revision
        renderProperties(body, descriptor, localizer)
      })
    },
  })
}

export const propertiesTable: ViewerModule = createPropertiesTable()
