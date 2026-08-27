// Hand-ported structural inspection of authored SC2 TriggerData XML.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import { decodeStructuredText, lineCount, parseXmlElements } from '../galaxy/codec.js'

const ID = 'org.modkitx/sc2-triggers'
const ascii = new TextDecoder('ascii', { fatal: false })

function triggerRoot(text) {
  return /^\s*(?:<\?xml\b[^>]*>\s*)?<TriggerData(?:\s|>)/u.test(text)
}

function scanTriggers(text, budget) {
  const elements = parseXmlElements(text, budget, 'TriggerData', 'SC2 TriggerData')
  const libraries = elements
    .filter(element => element.name === 'Library' || element.name === 'Standard')
    .map(element => element.attributes.Id ?? '')
    .filter(Boolean)
  const authored = elements.filter(element => element.name === 'Element')
  const typeCounts = {}
  const externalLibraries = new Set()
  for (const element of authored) {
    const type = element.attributes.Type ?? 'Unknown'
    typeCounts[type] = (typeCounts[type] ?? 0) + 1
    const library = element.attributes.Library
    if (library !== undefined && !libraries.includes(library)) externalLibraries.add(library)
  }
  const scriptBlocks = elements.filter(element => element.name === 'ScriptCode').length
  return Object.freeze({
    elements,
    libraries: Object.freeze(libraries),
    authored: Object.freeze(authored),
    typeCounts: Object.freeze(typeCounts),
    externalLibraries: Object.freeze([...externalLibraries].sort()),
    scriptBlocks,
  })
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'sc2-triggers',
    label: 'StarCraft II Trigger XML',
    mediaType: 'application/xml',
  }),
  async detect(prefix) {
    return triggerRoot(ascii.decode(prefix))
      ? { confidence: 0.995, kind: 'structure', note: 'trigger-data-root' }
      : { confidence: 0, kind: 'structure', note: 'trigger-data-root-missing' }
  },
  async inspect(bytes, context) {
    const text = decodeStructuredText(bytes, context.budget, 'SC2 TriggerData')
    if (!triggerRoot(text)) throw new TypeError('SC2 TriggerData root is missing')
    const trigger = scanTriggers(text, context.budget)
    return {
      summary: {
        format: 'sc2-triggers',
        lines: lineCount(text),
        libraries: trigger.libraries,
        elements: trigger.authored.length,
        typeCounts: trigger.typeCounts,
        customScriptBlocks: trigger.scriptBlocks,
        externalLibraries: trigger.externalLibraries,
      },
      metadata: [
        {
          id: 'sc2-triggers',
          label: 'TriggerData',
          entries: [
            { key: 'libraries', value: trigger.libraries },
            { key: 'elements', value: trigger.authored.length },
            { key: 'types', value: trigger.typeCounts },
            { key: 'customScriptBlocks', value: trigger.scriptBlocks },
          ],
        },
      ],
      traits: [
        { id: 'content.text', parameters: { language: 'xml', lines: lineCount(text) } },
        { id: 'structure.hierarchy', parameters: { elements: trigger.authored.length } },
        {
          id: 'code.node-graph',
          parameters: {
            types: Object.keys(trigger.typeCounts).length,
            authority: 'native',
            scenarioRole: 'trigger',
            portableUvArtifact: false,
            semanticLowering: 'unavailable',
          },
        },
        ...(trigger.scriptBlocks === 0
          ? []
          : [{ id: 'content.scripts', parameters: { blocks: trigger.scriptBlocks } }]),
      ],
      text: true,
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'trigger-data',
          label: 'TriggerData',
          preview: `${trigger.authored.length} authored element(s)`,
          children: trigger.authored.map(element => ({
            kind: element.attributes.Type ?? 'element',
            label: element.attributes.Id ?? `element-${element.index}`,
            preview:
              element.attributes.Library === undefined
                ? undefined
                : `library ${element.attributes.Library}`,
          })),
        }),
      },
      unsupportedFeatures: [
        'semantic-trigger-library-lowering',
        'trigger-to-galaxy-conversion',
        'catalog-gamelink-rename',
        'language-services',
        'execution',
        'source-writing',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
