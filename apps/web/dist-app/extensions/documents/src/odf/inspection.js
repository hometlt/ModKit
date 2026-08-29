/**
 * The four ODF codecs, assembled from one reader.
 *
 * Each contribution keeps its own identity, manifest, aliases and limitations — a single codec
 * answering for four formats would make "which format is this?" unanswerable — but the container
 * rules, the XML reader and the `draw:page` geometry are read once, here, and shared.
 *
 * Which data sources appear is decided by what was really recovered, never by the format name:
 * ODT and ODP publish text and a tree, ODS adds the table, ODP adds the deck, ODP and ODG add the
 * vector scene. The applications pick viewers from those contracts, so ODS lands in the same table
 * viewer as CSV and ODG in the same vector viewer as SVG with no format branch anywhere.
 */

import {
  createInspectionCodec,
  createTreeDataSource,
  createVectorSceneSource,
} from '@modkitx-x3/codec-kit'

import {
  ODF_FORMATS,
  descendants,
  detectOdf,
  openOdfPackage,
  packageTreeNode,
  textOf,
} from './package.js'
import {
  createSlideDeckSource,
  pageSceneSvg,
  readDrawPages,
  readOdg,
  readOdp,
  readOds,
  readOdt,
} from './document.js'

/**
 * What every ODF route in this extension refuses to claim.
 *
 * Layout fidelity is first because it is the one a reader is most likely to assume: styles live in
 * `styles.xml` and the automatic styles this reader does not interpret, so nothing here is a
 * faithful rendering of the page. Editing is absent for the reason the plan gives — a writer is not
 * declarable until preserving repack and round-trip are proved, and neither is.
 */
const UNSUPPORTED = Object.freeze([
  'layout-fidelity',
  'style-resolution',
  'macro-and-script-execution',
  'external-resource-fetch',
  'source-editing',
])

/** Text of every paragraph and heading under an element, in document order, empties dropped. */
function recoveredLines(element, prefixes) {
  const lines = []
  for (const node of descendants(element)) {
    if (node.name === `${prefixes.text}:p` || node.name === `${prefixes.text}:h`) {
      const value = textOf(node)
      if (value !== '') lines.push(value)
    }
  }
  return lines
}

function packageMetadata(pkg) {
  return {
    id: 'odf-package',
    label: 'OpenDocument package',
    entries: [
      { key: 'mediaType', value: pkg.declaredMediaType },
      { key: 'entries', value: pkg.entries.length },
      { key: 'manifestEntries', value: pkg.manifest.entries },
      { key: 'manifestUndeclared', value: pkg.manifest.undeclared.length },
      { key: 'manifestMissing', value: pkg.manifest.missing.length },
      { key: 'macroEntries', value: pkg.macroEntries.length },
      { key: 'decodedBytes', value: pkg.decodedBytes },
    ],
  }
}

/**
 * Package-level diagnostics.
 *
 * Both directions of a manifest disagreement are reported rather than repaired: an entry the
 * manifest never declared is content nobody vouched for, and a declared entry that is not in the
 * package is a promise the package did not keep. Macro storages are named because "this document
 * carries code that was not run" is a fact a reader deserves, not an implementation note.
 */
function packageDiagnostics(pkg) {
  const diagnostics = []
  if (pkg.manifest.undeclared.length > 0) {
    diagnostics.push({
      id: 'odf-manifest-undeclared',
      category: 'structure',
      severity: 'warning',
      code: 'x3.documents/odf-manifest-undeclared',
      message: `META-INF/manifest.xml does not declare ${pkg.manifest.undeclared.length} package entry/entries: ${pkg.manifest.undeclared.slice(0, 8).join(', ')}`,
    })
  }
  if (pkg.manifest.missing.length > 0) {
    diagnostics.push({
      id: 'odf-manifest-missing',
      category: 'structure',
      severity: 'warning',
      code: 'x3.documents/odf-manifest-missing',
      message: `META-INF/manifest.xml declares ${pkg.manifest.missing.length} entry/entries the package does not contain: ${pkg.manifest.missing.slice(0, 8).join(', ')}`,
    })
  }
  if (pkg.macroEntries.length > 0) {
    diagnostics.push({
      id: 'odf-macros-present',
      category: 'fidelity',
      severity: 'warning',
      code: 'x3.documents/odf-macros-present',
      message: `this document carries ${pkg.macroEntries.length} macro or script storage entry/entries; they are listed and never executed`,
    })
  }
  return diagnostics
}

async function inspectOdt(pkg) {
  const read = readOdt(pkg)
  const text = recoveredLines(pkg.body, pkg.prefixes).join('\n')
  return {
    summary: read.summary,
    traits: read.traits,
    metadata: [
      packageMetadata(pkg),
      {
        id: 'odf-text-document',
        label: 'Text document',
        entries: Object.entries(read.summary).map(([key, value]) => ({ key, value })),
      },
    ],
    text,
    tree: read.tree,
    dataSources: {},
  }
}

async function inspectOds(pkg) {
  const read = readOds(pkg)
  return {
    summary: read.summary,
    traits: read.traits,
    metadata: [
      packageMetadata(pkg),
      {
        id: 'odf-spreadsheet',
        label: 'Spreadsheet',
        entries: Object.entries(read.summary).map(([key, value]) => ({ key, value })),
      },
      ...(read.formulas.length === 0
        ? []
        : [
            {
              // formulas are published as text with their coordinates; nothing evaluates them
              id: 'odf-formulas',
              label: 'Formulas (text only, never evaluated)',
              entries: read.formulas.map(item => ({
                key: `${item.sheet}!r${item.row}c${item.column}`,
                value: `${item.formula} → ${item.storedValue}`,
              })),
            },
          ]),
    ],
    text: sheetText(pkg),
    tree: read.tree,
    dataSources: read.table === undefined ? {} : { 'common.view/table-data-source': read.table },
  }
}

/** Every materialised row of every sheet, as the text plane sees it. */
function sheetText(pkg) {
  const p = pkg.prefixes
  const lines = []
  for (const node of descendants(pkg.body)) {
    if (node.name !== `${p.table}:table-row`) continue
    const cells = node.children
      .filter(
        child =>
          child.name === `${p.table}:table-cell` || child.name === `${p.table}:covered-table-cell`,
      )
      .map(cell => textOf(cell))
    const line = cells.join('\t')
    if (line.trim() !== '') lines.push(line)
  }
  return lines.join('\n')
}

async function inspectOdp(pkg) {
  const { pages, size } = await readDrawPages(pkg)
  const read = readOdp(pages, pkg)
  const scene = pages[0] === undefined ? undefined : pageSceneSvg(pages[0], pkg.prefixes, size)
  const text = recoveredLines(pkg.body, pkg.prefixes).join('\n')
  return {
    summary: {
      ...read.summary,
      vectorScenePage: pages[0] === undefined ? null : 1,
      pageSizeKnown: scene?.pageSizeKnown ?? false,
    },
    traits: [
      ...read.traits,
      ...(scene === undefined
        ? []
        : [{ id: 'vector.scene', parameters: { nodes: scene.info.nodes, page: 1 } }]),
    ],
    metadata: [
      packageMetadata(pkg),
      {
        id: 'odf-presentation',
        label: 'Presentation',
        entries: Object.entries(read.summary).map(([key, value]) => ({ key, value })),
      },
    ],
    text,
    tree: read.tree,
    dataSources: {
      'common.view/slide-deck-source': createSlideDeckSource(read.deck),
      ...(scene === undefined
        ? {}
        : {
            'common.view/vector-scene-source': createVectorSceneSource(scene.info, scene.text),
          }),
    },
  }
}

async function inspectOdg(pkg) {
  const { pages, size } = await readDrawPages(pkg)
  const read = readOdg(pages, pkg)
  const scene = pages[0] === undefined ? undefined : pageSceneSvg(pages[0], pkg.prefixes, size)
  const text = recoveredLines(pkg.body, pkg.prefixes).join('\n')
  return {
    summary: {
      ...read.summary,
      vectorScenePage: pages[0] === undefined ? null : 1,
      pageSizeKnown: scene?.pageSizeKnown ?? false,
    },
    traits: [
      ...read.traits,
      ...(scene === undefined
        ? []
        : [{ id: 'vector.scene', parameters: { nodes: scene.info.nodes } }]),
    ],
    metadata: [
      packageMetadata(pkg),
      {
        id: 'odf-drawing',
        label: 'Drawing',
        entries: Object.entries(read.summary).map(([key, value]) => ({ key, value })),
      },
    ],
    text,
    tree: read.tree,
    dataSources:
      scene === undefined
        ? {}
        : { 'common.view/vector-scene-source': createVectorSceneSource(scene.info, scene.text) },
  }
}

const READERS = Object.freeze({
  odt: inspectOdt,
  ods: inspectOds,
  odp: inspectOdp,
  odg: inspectOdg,
})

export function createOdfCodec(formatId, context) {
  const details = ODF_FORMATS[formatId]
  if (details === undefined) throw new TypeError(`unknown ODF format ${formatId}`)
  return createInspectionCodec(
    Object.freeze({
      id: details.id,
      format: Object.freeze({
        id: details.formatId,
        label: details.label,
        mediaType: details.mediaType,
      }),
      async detect(prefix) {
        return detectOdf(prefix, formatId)
      },
      async inspect(bytes, inspectionContext) {
        const pkg = await openOdfPackage(
          bytes,
          formatId,
          inspectionContext.budget,
          inspectionContext.signal,
        )
        const read = await READERS[formatId](pkg)
        // one tree, both planes: what the document says, and what the package physically holds
        read.tree.children.push(packageTreeNode(pkg))
        return {
          ...read,
          traits: [
            ...read.traits,
            { id: 'content.metadata', parameters: { package: 'odf', entries: pkg.entries.length } },
          ],
          dataSources: {
            ...read.dataSources,
            'common.view/tree-data-source': createTreeDataSource(read.tree),
          },
          diagnostics: packageDiagnostics(pkg),
          maxDecodedBytes: pkg.decodedBytes,
          unsupportedFeatures: UNSUPPORTED,
        }
      },
    }),
    context,
  )
}
