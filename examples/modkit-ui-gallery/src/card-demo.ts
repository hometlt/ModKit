/**
 * The SC2 unit card and the relations panel, composed from card sections.
 *
 * A unit owns no file: its card is assembled from data scattered across many. Nothing in this file
 * is SC2-aware code — it is a section list. A different subject (a file, a texture, an upgrade)
 * gets a different list and the same renderer.
 */
import { createRelationGraph, createSubjectCard, type CardSection } from '@modkitx-x3/ui'
import { threeGraphRenderer } from '../../../extensions/common/ui-graph-3d/src/index.js'

const STATS: readonly (readonly [string, string, string?])[] = [
  ['Acceleration', '1000'],
  ['AttackTargetPriority', '20'],
  ['CargoSize', '2'],
  ['Collide', 'Ground, ForceField'],
  ['FlagArray', 'Turnable, ArmySelect, AICaster, AIPressForwardDisabled'],
  ['GlossaryAlias', 'Aquila', 'Unit'],
  ['GlossaryPriority', '6'],
  ['HotkeyAlias', 'Aquila', 'Unit'],
  ['InnerRadius', '0.375'],
  ['MinimapRadius', '0.4375'],
  ['LifeArmorName', 'Neosteel Frame', 'Unit'],
  ['Mob', 'Terran', 'Unit'],
  ['Radius', '0.5625'],
  ['Speed', '2.25'],
  ['TacticalAIFilters', 'Visible;Missile,Stasis,Dead,Hidden'],
]

const COMMAND_CARD = [
  { id: 'move', icon: '→', hotkey: 'M', label: 'Move' },
  { id: 'stop', icon: '⊗', hotkey: 'S', label: 'Stop' },
  { id: 'hold', icon: '⊙', hotkey: 'H', label: 'Hold position' },
  { id: 'patrol', icon: '◍', hotkey: 'P', label: 'Patrol' },
  { id: 'attack', icon: '⊞', hotkey: 'A', label: 'Attack' },
  ...Array.from({ length: 5 }, (_, index) => ({ id: `empty-${index}`, empty: true })),
  { id: 'nanite', icon: '◉', hotkey: 'G', label: 'Nanite Emitter' },
  ...Array.from({ length: 4 }, (_, index) => ({ id: `empty-b-${index}`, empty: true })),
]

export function mountCardDemo(host: HTMLElement, log: (line: string) => void): void {
  const document = host.ownerDocument
  const sections: CardSection[] = [
    {
      kind: 'header',
      title: 'Aquila',
      portrait: '◈',
      refs: [
        { label: 'Unit/Aquila', title: 'Subject reference' },
        { label: 'CUnit', title: 'Catalog class' },
        { label: 'UnitData.xml:315', title: 'Authored location' },
      ],
      chips: [{ label: 'Mechanical' }, { label: 'Light' }, { label: 'Psionic' }],
      description: 'Support trooper. Can use Nanite Emitter.',
      notes: ['Power user.', 'Can attack ground and air units.'],
      stats: [
        { icon: '◇', value: '100', title: 'Minerals' },
        { icon: '◆', value: '100', title: 'Vespene' },
        { icon: '⌂', value: '-2', title: 'Supply' },
        { icon: '♥', value: '70', delta: '0', title: 'Life' },
        { icon: '✦', value: '150', delta: '+1.13/s', title: 'Energy' },
      ],
      aside: {
        options: ['enus', 'ruru', 'dede', 'kokr'],
        value: 'enus',
        onChange: value => log(`locale → ${value}`),
      },
    },
    {
      kind: 'custom',
      id: 'command-card',
      title: 'Command card',
      expanded: true,
      render(panel) {
        // A bespoke template still lives inside the shared chrome.
        const grid = document.createElement('div')
        grid.dataset['mkPart'] = 'card.grid'
        panel.append(grid)
        const card = createSubjectCard(document, {
          label: 'Command card grid',
          sections: [
            {
              kind: 'grid',
              id: 'grid',
              title: 'Slots',
              expanded: true,
              columns: 5,
              cells: COMMAND_CARD,
            },
          ],
        })
        panel.replaceChildren(card.root)
      },
    },
    {
      kind: 'links',
      id: 'produced-by',
      title: 'Produced by',
      expanded: true,
      lead: '[production] Train · InfoArray.Train5.Unit.0',
      links: [
        { label: 'Manufacturer', title: 'Producing structure' },
        { label: '→ Train Lightweight Mechs', title: 'Ability' },
      ],
    },
    {
      kind: 'cards',
      id: 'weapons',
      title: 'Weapons',
      expanded: true,
      cards: [
        {
          title: 'D-15 Magnum',
          icon: '⌁',
          badge: 'D15Magnum',
          ref: { label: 'D-15 Magnum' },
          fields: [
            { name: 'Damage', value: '18' },
            { name: 'DPS', value: '11.7' },
            { name: 'Period', value: '1.54s' },
            { name: 'Range', value: '7' },
            { name: 'Targets', value: 'Visible' },
          ],
        },
      ],
    },
    {
      kind: 'fields',
      id: 'stats',
      title: 'Stats',
      expanded: true,
      fields: STATS.map(([name, value, badge]) => ({
        name,
        value,
        ...(badge === undefined ? {} : { badge }),
      })),
    },
  ]

  const card = createSubjectCard(document, {
    label: 'Aquila unit card',
    sections,
    onNavigate: reference => log(`navigate → ${reference.label}`),
  })
  host.replaceChildren(card.root)
}

const TYPES = [
  ['CSound', 10716],
  ['CModel', 10565],
  ['CActorDoodad', 2384],
  ['CButton', 1959],
  ['CRewardIcon', 1673],
  ['CUnit', 1291],
  ['CActorUnit', 1073],
  ['CActorModel', 962],
  ['CSoundtrack', 915],
  ['CActorSound', 871],
  ['CRequirementCo…', 773],
  ['CTerrainTex', 702],
  ['CLight', 688],
  ['CBehaviorBuff', 680],
  ['CSkin', 579],
  ['CRewardPortrait', 578],
  ['CRewardModel', 559],
  ['CTexture', 558],
  ['CRequirement', 530],
  ['CEffectApplyBeh…', 476],
  ['CEffectSet', 453],
  ['CTalent', 423],
] as const

export function mountGraphDemo(host: HTMLElement, log: (line: string) => void): void {
  const nodes = TYPES.flatMap(([type], index) =>
    Array.from({ length: Math.min(24, 4 + index) }, (_, position) => ({
      id: `${type}-${position}`,
      label: position === 0 ? type : `${type} ${position}`,
      type,
    })),
  )
  const edges = nodes.slice(1).map((node, index) => ({
    from: nodes[index % Math.max(1, Math.floor(nodes.length / 8))]?.id ?? node.id,
    to: node.id,
    ...(index % 37 === 0 ? { dead: true } : {}),
  }))

  const graph = createRelationGraph(host.ownerDocument, {
    label: 'Relations',
    nodes,
    edges,
    totalNodes: 53_698,
    types: TYPES.map(([label, count], index) => ({
      id: label,
      label,
      count,
      tone: index,
    })),
    footer: [
      {
        id: 'uses',
        title: 'Uses',
        items: [
          { label: 'Unit', count: 9 },
          { label: 'Button', count: 6 },
        ],
      },
      {
        id: 'used-by',
        title: 'Used by',
        items: [
          { label: 'Upgrade', count: 11 },
          { label: 'Unit', count: 3 },
        ],
      },
    ],
    // Both renderers are offered on one component: the built-in 2D canvas and the three.js
    // backend MK2 used. Switching is a control, not a different widget.
    renderers: [threeGraphRenderer],
    onOpen: node => log(`open subject → ${node.label}`),
  })
  host.replaceChildren(graph.root)
  const observer = new ResizeObserver(() => graph.resize())
  observer.observe(host)
}
