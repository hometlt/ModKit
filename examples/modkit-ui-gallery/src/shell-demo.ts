/**
 * The MK2 viewer window, assembled from primitives.
 *
 * Header breadcrumb, view picker, filtered file tree, collapsible property sections and a status
 * footer — the same composition the VS Code plugin shows, built only from `@modkit/ui`
 * primitives with no format knowledge anywhere in this file.
 */
import {
  accordionField,
  createAccordion,
  createFileTree,
  createSearchField,
  createShellFooter,
  createShellHeader,
  createViewPicker,
  matchRanges,
  type FileTreeNode,
} from '@modkit/ui'

interface ArchiveEntry {
  readonly id: string
  readonly label: string
  readonly icon: string
  readonly kind: string
  readonly badge?: string
  readonly children?: readonly ArchiveEntry[]
}

/** Shaped after the CASC tree in the screenshot: campaigns and mods under a storage root. */
const ARCHIVE: readonly ArchiveEntry[] = [
  {
    id: 'casc',
    label: 'CASC: StarCraft II',
    icon: '▤',
    kind: 'storage',
    badge: '2',
    children: [
      { id: 'campaigns', label: 'campaigns', icon: '▢', kind: 'directory', badge: '4' },
      {
        id: 'mods',
        label: 'mods',
        icon: '▸',
        kind: 'directory',
        badge: '12',
        children: [
          {
            id: 'alliedcommanders',
            label: 'alliedcommanders.sc2mod',
            icon: '◈',
            kind: 'mod',
            badge: '14',
            children: [
              ...[
                'dede',
                'enus',
                'eses',
                'esmx',
                'frfr',
                'itit',
                'kokr',
                'plpl',
                'ptbr',
                'ruru',
                'zhcn',
                'zhtw',
              ].map(locale => ({
                id: `ac-${locale}`,
                label: `${locale}.sc2data`,
                icon: '◫',
                kind: 'data',
              })),
              {
                id: 'ac-componentlist',
                label: 'componentlist.sc2components',
                icon: '⚙',
                kind: 'components',
              },
              { id: 'ac-documentheader', label: 'documentheader', icon: '≡', kind: 'record' },
              { id: 'ac-documentinfo', label: 'documentinfo', icon: '≡', kind: 'record' },
            ],
          },
          {
            id: 'liberty',
            label: 'liberty.sc2mod',
            icon: '◈',
            kind: 'mod',
            badge: '3',
            children: [
              {
                id: 'base-assets',
                label: 'base.sc2assets',
                icon: '◫',
                kind: 'data',
                children: [
                  {
                    id: 'assets',
                    label: 'assets',
                    icon: '▸',
                    kind: 'directory',
                    children: [
                      {
                        id: 'units',
                        label: 'units',
                        icon: '▸',
                        kind: 'directory',
                        children: [
                          {
                            id: 'terran',
                            label: 'terran',
                            icon: '▸',
                            kind: 'directory',
                            children: [
                              {
                                id: 'arcadewraith',
                                label: 'arcadewraith',
                                icon: '▸',
                                kind: 'directory',
                                children: [
                                  {
                                    id: 'arcadewraith.m3',
                                    label: 'arcadewraith.m3',
                                    icon: '◆',
                                    kind: 'model',
                                    badge: '918 KiB',
                                  },
                                  {
                                    id: 'arcadewraith_diffuse.dds',
                                    label: 'arcadewraith_diffuse.dds',
                                    icon: '▩',
                                    kind: 'image',
                                    badge: '341 KiB',
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]

const index = new Map<string, ArchiveEntry>()
const build = (entries: readonly ArchiveEntry[]): void => {
  for (const entry of entries) {
    index.set(entry.id, entry)
    if (entry.children !== undefined) build(entry.children)
  }
}
build(ARCHIVE)

const toNode = (entry: ArchiveEntry): FileTreeNode => ({
  id: entry.id,
  label: entry.label,
  hasChildren: (entry.children?.length ?? 0) > 0,
  icon: entry.icon,
  kind: entry.kind,
  ...(entry.badge === undefined ? {} : { badge: entry.badge }),
})

/** Bones from the screenshot, so the accordion has a realistic nested payload. */
const BONES = [
  'Box01',
  'Cylinder01',
  'Box02',
  'Box03',
  'Box04',
  'Box05',
  'HitTestFuzzy',
  'HitTestTight',
  'HitTestFuzzy01',
  'Ref_Weapon Right',
  'Ref_Weapon Bottom',
  'Ref_Weapon Left',
  'Ref_Overhead',
]

export function mountShellDemo(host: HTMLElement): void {
  const document = host.ownerDocument
  const frame = document.createElement('div')
  frame.className = 'mk2-frame'
  host.replaceChildren(frame)

  // ---------------------------------------------------------------- header
  const header = createShellHeader(document, {
    crumbs: [
      { id: 'mods', label: 'mods' },
      { id: 'liberty', label: 'liberty.sc2mod', icon: '◈' },
      { id: 'base', label: 'base.sc2assets', icon: '◫' },
      { id: 'assets', label: 'assets' },
      { id: 'units', label: 'units' },
      { id: 'terran', label: 'terran' },
      { id: 'arcadewraith', label: 'arcadewraith' },
      { id: 'file', label: 'arcadewraith.m3', icon: '◆' },
    ],
  })
  const picker = createViewPicker(document, {
    modes: [
      { id: 'tree', glyph: '≡', title: 'Tree' },
      { id: 'flat', glyph: '▤', title: 'Flat list' },
      { id: 'table', glyph: '▦', title: 'Table' },
    ],
    viewers: [
      { id: 'model', label: 'Modkit Model Viewer' },
      { id: 'hex', label: 'Hex' },
      { id: 'text', label: 'Text' },
    ],
    activeViewer: 'model',
  })
  header.root.append(picker.root)
  frame.append(header.root)

  // ---------------------------------------------------------------- body
  const body = document.createElement('div')
  body.className = 'mk2-body'
  frame.append(body)

  const left = document.createElement('div')
  left.className = 'mk2-left'
  body.append(left)

  let query = ''
  const tree = createFileTree(document, {
    label: 'Archives',
    async loadChildren(node) {
      if (node === undefined) return ARCHIVE.map(toNode)
      return (index.get(node.id)?.children ?? []).map(toNode)
    },
    matches(node) {
      if (query === '') return true
      return matchRanges(node.label, search.state.compiled, true).length > 0
    },
    onSelect(node) {
      footer.update([
        { id: 'errors', text: '⊗ 0', severity: 'ok' },
        { id: 'warnings', text: '⚠ 0', severity: 'ok' },
        { id: 'sel', text: node.label },
        { id: 'yaw', text: 'Yaw 45.1°', align: 'end' },
        { id: 'pitch', text: 'Pitch 39.1°', align: 'end' },
        { id: 'zoom', text: '1.00×', align: 'end' },
      ])
    },
  })

  const search = createSearchField(document, {
    label: 'Filter entries',
    placeholder: 'Filter',
    allowGlob: true,
    debounceMs: 60,
    onChange(state) {
      query = state.query
      tree.applyFilter()
    },
  })

  for (const [glyph, title, run] of [
    ['⊟', 'Collapse all', () => tree.collapseAll()],
    ['⊞', 'Expand all', () => void tree.expandAll()],
    ['⟳', 'Refresh', () => void tree.refresh()],
  ] as const) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = glyph
    button.title = title
    button.setAttribute('aria-label', title)
    button.addEventListener('click', run)
    tree.toolbar.append(button)
  }
  tree.toolbar.append(search.root)

  left.append(tree.root)
  void tree.refresh()

  // ---------------------------------------------------------------- stage
  const stage = document.createElement('div')
  stage.className = 'mk2-stage'
  stage.textContent = 'stage — the selected viewer mounts here'
  body.append(stage)

  // ---------------------------------------------------------------- properties
  const right = document.createElement('div')
  right.className = 'mk2-right'
  body.append(right)

  const accordion = createAccordion(document, {
    label: 'Model properties',
    sections: [
      {
        id: 'rendering',
        title: 'Rendering',
        expanded: true,
        render(panel) {
          accordionField(panel, 'renderer', 'Three.js')
          accordionField(panel, 'meshes', '0: M3_Region_0')
          accordionField(panel, 'effects', 'visible')
          accordionField(panel, 'diagnostics', 'no diagnostics')
        },
      },
      {
        id: 'animation',
        title: 'Animation',
        hint: '0',
        render(panel) {
          accordionField(panel, 'sequences', '0')
        },
      },
      {
        id: 'editing',
        title: 'Editing',
        render(panel) {
          accordionField(panel, 'state', 'read-only')
        },
      },
      {
        id: 'team-color',
        title: 'Team color',
        render(panel) {
          accordionField(panel, 'slot', 'team 01')
        },
      },
      {
        id: 'export',
        title: 'Export',
        render(panel) {
          accordionField(panel, 'formats', 'glTF, OBJ')
        },
      },
      {
        id: 'properties',
        title: 'Properties',
        render(panel) {
          accordionField(panel, 'version', 'm3 34')
        },
      },
      {
        id: 'sections',
        title: 'Sections',
        hint: '18',
        render(panel) {
          accordionField(panel, 'count', '18')
        },
      },
      {
        id: 'bounds',
        title: 'Bounds',
        render(panel) {
          accordionField(panel, 'min', '-1.84, -2.31, -0.62')
          accordionField(panel, 'max', '1.84, 2.31, 1.05')
          accordionField(panel, 'radius', '2.97')
        },
      },
      {
        id: 'meshes',
        title: 'Meshes',
        hint: '1',
        render(panel) {
          accordionField(panel, '0', 'M3_Region_0 · 4 812 tris')
        },
      },
      {
        id: 'materials',
        title: 'Materials',
        hint: '3',
        render(panel) {
          accordionField(panel, '0', 'Wraith_Body')
          accordionField(panel, '1', 'Wraith_Glow')
          accordionField(panel, '2', 'Wraith_Team')
        },
      },
      {
        id: 'bones',
        title: 'Bones',
        hint: String(BONES.length),
        expanded: true,
        render(panel) {
          BONES.forEach((bone, position) => {
            accordionField(panel, String(position), bone)
          })
        },
      },
    ],
  })
  right.append(accordion.root)

  // ---------------------------------------------------------------- footer
  const footer = createShellFooter(document, [
    { id: 'errors', text: '⊗ 0', severity: 'ok' },
    { id: 'warnings', text: '⚠ 0', severity: 'ok' },
    { id: 'yaw', text: 'Yaw 45.1°', align: 'end' },
    { id: 'pitch', text: 'Pitch 39.1°', align: 'end' },
    { id: 'zoom', text: '1.00×', align: 'end' },
  ])
  frame.append(footer.root)
}
