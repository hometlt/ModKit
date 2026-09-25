/**
 * Part vocabulary — the public styling surface.
 *
 * Themes and applications select `[data-mk-part="table.row"]`. They never select the internal
 * `modkit-viewer__*` classes, which stay private implementation and may change without notice.
 *
 * Adding a part is a compatibility commitment: it becomes selectable by third-party themes and is
 * covered by the conformance assertion below. Removing one is a breaking change to that component.
 * States are separate and use `[data-mk-state~="…"]`, or native ARIA where an equivalent exists.
 */

export const PARTS = Object.freeze([
  // shared surface
  'viewer',
  'viewer.toolbar',
  'viewer.status',
  'viewer.empty',

  /*
   * Toolbar items, shared by every viewer that has a toolbar.
   *
   * They are one vocabulary rather than one per viewer because a theme styles "a toggle in a
   * toolbar" once: a tree, a table and a strings editor that each invented their own part names
   * would make the same button three different things to style.
   */
  'toolbar.group',
  'toolbar.toggle',
  'toolbar.chip',
  'toolbar.action',
  'toolbar.search',
  'toolbar.search-input',
  'toolbar.separator',
  'toolbar.spacer',
  'toolbar.label',

  // bounded + virtual text
  'text',
  'text.line',
  'virtual-text',
  'virtual-text.line',

  // hex
  'hex',
  'hex.toolbar',
  'hex.offset-input',
  'hex.go',
  'hex.content',
  'hex.row',
  'hex.gutter',
  'hex.cell',
  'hex.ascii',

  // tree
  'tree',
  'tree.list',
  'tree.item',
  'tree.row',
  'tree.key',
  'tree.twisty',
  'tree.label',
  'tree.value',
  'tree.children',

  // one displayed value, drawn with its syntax runs
  'value.token',

  // inline, schema-driven field editing shared by the tree, the table and the metadata panel
  'field',
  'field.control',
  'field.status',
  'field.target',

  // table
  'table',
  'table.caption',
  'table.body',
  'table.row',
  'table.cell',
  'table.next',
  // variant (localization) tables
  'table.head',
  'table.controls',
  'table.group',
  'table.columns',
  'table.asset',
  'table.unresolved',
  'table.note',
  'table.panel',
  'table.add',
  'table.compare',
  'table.select',

  // namespace
  'namespace',
  'namespace.list',
  'namespace.item',
  'namespace.label',
  'namespace.detail',
  'namespace.children',

  // transport
  'transport',
  'transport.status',
  'transport.controls',
  'transport.button',
  'transport.track',

  // playback stage: a transport with its world positions, participants, series and events
  'playback',
  'playback.bar',
  'playback.seek',
  'playback.time',
  'playback.rate',
  'playback.body',
  'playback.map',
  'playback.note',
  'playback.side',
  'playback.participants',
  'playback.participant',
  'playback.swatch',
  'playback.charts',
  'playback.chart',
  'playback.playhead',
  'playback.events',
  'playback.event',

  // diagnostics panel
  'diagnostics',
  'diagnostics.group',
  'diagnostics.heading',
  'diagnostics.list',
  'diagnostics.item',
  'diagnostics.message',

  // operation toolbar
  'operations',
  'operations.status',
  'operations.button',

  // search field (PR3 member) and filter chrome
  'search',
  'search.input',
  'search.toggles',
  'search.toggle',
  'search.status',
  'search.nav',
  'search.message',
  'filter-bar',
  'filter-bar.facets',
  'filter-bar.facet',

  // format inspector
  'format',
  'format.header',
  'format.badge',
  'format.body',

  // metadata and properties (MK2 assets-viewer parity)
  'metadata',
  'metadata.group',
  'metadata.heading',
  'metadata.row',
  'metadata.label',
  'metadata.value',
  'metadata.note',
  'properties',
  'properties.row',
  'properties.name',
  'properties.value',
  'properties.origin',

  // game template stage: the resolved tree, the drawn template and the element view side by side
  'template.body',
  'template.canvas',

  // image stage
  'image',
  'image.canvas',
  'image.toolbar',
  'image.readout',
  'image.subresources',
  'image.convert',
  'image.metadata',

  // image editing surface (MK2 assetsTextureViewer parity)
  'imageedit',
  'imageedit.tools',
  'imageedit.tool',
  'imageedit.options',
  'imageedit.swatch',
  'imageedit.size',
  'imageedit.actions',
  'imageedit.action',
  'imageedit.marquee',
  'imageedit.status',
  'imageedit.warning',

  // audio stage
  'audio',
  'audio.waveform',
  'audio.toolbar',
  'audio.readout',
  'audio.player',

  // vector stage
  'vector',
  'vector.image',
  'vector.readout',

  // archive stage
  'archive.members',
  'archive.member-list',
  'archive.item',
  'archive.row',
  'archive.name',
  'archive.detail',
  'archive.children',

  // video stage
  'video',
  'video.player',
  'video.readout',

  // model stage
  'model',
  'model.canvas',
  'model.readout',
  'model.toolbar',
  'model.primitive-selector',
  'model.animation-selector',
  'model.animation-seek',
  'model.animation-name',
  'model.convert-selector',
  'model.convert-status',
  'model.animation-name-status',
  'model.playback-status',
  'model.controls',
  'model.control-row',
  'model.control-label',
  'model.control-field',
  'model.control-note',
  'model.scale',
  'model.team-color',
  'model.facets',
  'model.facet',
  'model.facet-summary',
  'model.facet-list',
  'model.facet-item',

  // view gizmo — its own component, usable by any 3D stage
  'gizmo',
  'gizmo.svg',
  'gizmo.axis',
  'gizmo.handle',
  'gizmo.label',

  // archive explorer composite
  'archive',
  'archive.tree',
  'archive.entries',
  'archive.preview',

  // file tree (MK2 archive explorer chrome)
  'filetree',
  'filetree.toolbar',
  'filetree.list',
  'filetree.node',
  'filetree.row',
  'filetree.twisty',
  'filetree.icon',
  'filetree.label',
  'filetree.badge',
  'filetree.action',
  'filetree.children',
  'filetree.empty',

  // explorer: tree + preview shell shared by every host that browses real files
  'explorer',
  'explorer.toolbar',
  'explorer.action',
  'explorer.sidebar',
  'explorer.preview',
  'explorer.dropzone',
  'explorer.status',
  'explorer.tabs',
  'explorer.tab',
  'explorer.stage',
  'explorer.placeholder',
  // preview header and view picker
  'explorer.header',
  'explorer.breadcrumb',
  'explorer.crumb',
  'explorer.viewpicker',
  // editor area: one or more groups, each with its own tab strip
  'explorer.editors',
  'explorer.group',
  'explorer.tabstrip',
  'explorer.filetab',
  'explorer.filetab-close',
  'explorer.tabcontent',
  'explorer.opening',
  'explorer.split',
  // right-click menu on a tab: Close / Close Others / Close to the Right / Close All
  'explorer.tabmenu',
  'explorer.tabmenu-item',

  // custom window chrome, drawn by the app when the native frame is hidden
  'titlebar',
  'titlebar.drag',
  'titlebar.title',
  'titlebar.controls',
  'titlebar.button',
  'titlebar.menu',
  'titlebar.menu-item',
  'titlebar.menu-panel',
  'titlebar.menu-entry',
  'titlebar.menu-separator',

  // settings surface
  'settings',
  'settings.groups',
  'settings.group',
  'settings.pane',
  'settings.row',
  'settings.label',
  'settings.description',
  'settings.control',
  'settings.select',
  'settings.input',
  'settings.list',
  'settings.extension',
  'settings.extension-text',
  'settings.toggle',
  'settings.remove',
  'settings.adder',
  'settings.add',
  'settings.close',
  'settings.status',

  // generic form vocabulary — any surface that collects input (an edit panel, a dialog).
  // Named generically because the settings.* family is named for the settings surface, and a
  // theme styling a form should not have to know which surface hosts it.
  'form',
  'form.row',
  'form.label',
  'form.description',
  'form.control',
  'form.input',
  'form.select',
  'form.actions',
  'form.button',
  'form.status',

  // collapsible property sections
  'accordion',
  'accordion.section',
  'accordion.header',
  'accordion.twisty',
  'accordion.title',
  'accordion.hint',
  'accordion.body',
  'accordion.field',
  'accordion.field-name',
  'accordion.field-value',

  // shell chrome
  'shell',
  'shell.header',
  'shell.breadcrumb',
  'shell.crumb',
  'shell.crumb-icon',
  'shell.crumb-more',
  'shell.footer',
  'shell.footer-start',
  'shell.footer-end',
  'shell.status-item',

  // application workbench
  'workbench',
  'workbench.titlebar',
  'workbench.activitybar',
  'workbench.sidebar',
  'workbench.main',
  'workbench.panel',
  'workbench.auxbar',
  'workbench.statusbar',
  'workbench.status-slot',
  'workbench.host-status',

  // view picker
  'viewpicker',
  'viewpicker.modes',
  'viewpicker.mode',
  'viewpicker.select',

  // subject card composition
  'card',
  'card.section',
  'card.header',
  'card.portrait',
  'card.identity',
  'card.title',
  'card.subtitle',
  'card.ref',
  'card.locale',
  'card.chips',
  'card.chip',
  'card.description',
  'card.note',
  'card.statrow',
  'card.stat',
  'card.stat-icon',
  'card.stat-value',
  'card.stat-delta',
  'card.grid',
  'card.grid-cell',
  'card.grid-hotkey',
  'card.grid-icon',
  'card.fields',
  'card.field',
  'card.field-name',
  'card.field-value',
  'card.field-note',
  'card.nav',
  'card.knowledge',
  'card.links',
  'card.link-item',
  'card.subcards',
  'card.subcard',
  'card.subcard-head',
  'card.subcard-body',
  'card.custom',
  'image.metadata-group',
  'image.operation',
  'media-shell',
  'media-shell.toggle',
  'media-shell.gallery',
  'media-shell.splitter',
  'media-shell.stage',
  'media-shell.sidebar',
  'media-shell.section',
  'media-shell.section-header',
  'media-shell.section-chevron',
  'media-shell.section-icon',
  'media-shell.section-title',
  'media-shell.section-body',
  'media-shell.gallery-toolbar',
  'media-shell.gallery-mode',
  'media-shell.gallery-list',
  'media-shell.gallery-group',
  'media-shell.gallery-group-header',
  'media-shell.gallery-count',
  'media-shell.gallery-cells',
  'media-shell.gallery-item',
  'media-shell.gallery-thumb-box',
  'media-shell.gallery-thumb',
  'media-shell.gallery-label',
  'media-shell.gallery-empty',
  /** Quick filter (case / whole word / regular expression), shared by every list. */
  'filter',
  'filter.opener',
  'filter.input',
  'filter.option',
  /** Image editing tools, in a sidebar section of whichever viewer shows the pixels. */
  'image-editing',
  'image-editing.group',
  'image-editing.group-title',
  'image-editing.row',
  'image-editing.tools',
  'image-editing.tool',
  'image-editing.chip',
  'image-editing.label',
  'image-editing.range',
  'image-editing.value',
  'image-editing.swatch-button',
  'image-editing.swatch-alpha',
  'image-editing.swatches',
  'image-editing.swatch',
  'image-editing.popover',
  'image-editing.color',
  'image-editing.actions',
  'image-editing.note',
  'image-editing.marquee',
  'image-editing.dialog',
  'image-editing.number',
  'image-editing.select',
  'image-editing.check',
  'card.preview',

  // relation graph
  'graph',
  'graph.sidebar',
  'graph.sidebar-head',
  'graph.types',
  'graph.type',
  'graph.type-swatch',
  'graph.type-count',
  'graph.main',
  'graph.controls',
  'graph.control',
  'graph.canvas',
  'graph.status',
  'graph.hint',
  'graph.search',
  'graph.node-list',
  'graph.tooltip',
  'graph.footer',
  'graph.footer-group',
  'graph.footer-item',

  // auditable subject calculations
  'calculations',
  'calculations.summary',
  'calculations.list',
  'calculations.item',
  'calculations.heading',
  'calculations.result',
  'calculations.formula',
  'calculations.inputs',
  'calculations.input',
  'calculations.warnings',

  // editor
  'editor',
  'editor.toolbar',
  'editor.text',
] as const)

export type PartName = (typeof PARTS)[number]

const PART_SET: ReadonlySet<string> = new Set(PARTS)

export const PART_ATTRIBUTE = 'data-mk-part'
export const STATE_ATTRIBUTE = 'data-mk-state'

/**
 * Registered state tokens. `data-mk-state` is space separated and selected with `~=`,
 * so a node may carry several at once.
 */
export const STATES = Object.freeze([
  'loading',
  'empty',
  'error',
  'disabled',
  'readonly',
  'truncated',
  'over-budget',
  'degraded',
  'active',
  'stale',
  'mutating',
  'invalid',
  'no-match',
  'selected',
  /** A drop is hovering over this surface and would be accepted. */
  'drop-target',
] as const)

export type StateName = (typeof STATES)[number]

const STATE_SET: ReadonlySet<string> = new Set(STATES)

export function isPartName(value: string): value is PartName {
  return PART_SET.has(value)
}

export function isStateName(value: string): value is StateName {
  return STATE_SET.has(value)
}

/** Stamp the public part marker. Unregistered names throw so the vocabulary cannot drift silently. */
export function setPart(element: Element, part: PartName): void {
  if (!PART_SET.has(part)) throw new TypeError(`unregistered part: ${part}`)
  element.setAttribute(PART_ATTRIBUTE, part)
}

/** Replace the state set on an element. Every token must be registered. */
export function setState(element: Element, states: readonly StateName[]): void {
  for (const state of states) {
    if (!STATE_SET.has(state)) throw new TypeError(`unregistered state: ${state}`)
  }
  if (states.length === 0) element.removeAttribute(STATE_ATTRIBUTE)
  else element.setAttribute(STATE_ATTRIBUTE, [...new Set(states)].join(' '))
}

export interface PartAudit {
  readonly present: readonly string[]
  readonly missing: readonly string[]
  readonly unregistered: readonly string[]
}

/**
 * Conformance helper: every part found under `root` must be registered, and every part in
 * `required` must be present. Used by the role conformance suites.
 */
export function auditParts(root: Element, required: readonly PartName[] = []): PartAudit {
  const found = new Set<string>()
  const own = root.getAttribute(PART_ATTRIBUTE)
  if (own !== null) found.add(own)
  for (const node of root.querySelectorAll(`[${PART_ATTRIBUTE}]`)) {
    const value = node.getAttribute(PART_ATTRIBUTE)
    if (value !== null) found.add(value)
  }
  return Object.freeze({
    present: Object.freeze([...found].sort()),
    missing: Object.freeze(required.filter(part => !found.has(part)).sort()),
    unregistered: Object.freeze([...found].filter(part => !PART_SET.has(part)).sort()),
  })
}
