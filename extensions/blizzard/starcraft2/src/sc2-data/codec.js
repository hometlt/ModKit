// Hand-ported local catalog surface of org.modkitx/sc2-data. Schema resolution, inheritance,
// dependency overlays, and semantic edits remain consumers of the X3 data/mod contracts.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'
import {
  createTableDataSource,
  decodeStructuredText,
  lineCount,
  parseXmlElements,
} from '../galaxy/codec.js'

const ID = 'org.modkitx/sc2-data'
const ascii = new TextDecoder('ascii', { fatal: false })

function rootCatalog(text) {
  return /^\s*(?:<\?xml[^>]*>\s*)?<Catalog(?:\s|>)/iu.test(text)
}

function catalogEntities(elements) {
  return Object.freeze(
    elements
      .filter(
        element =>
          /^C[A-Z][A-Za-z0-9_]*$/u.test(element.name) && element.attributes.id !== undefined,
      )
      .map(element =>
        Object.freeze({
          className: element.name,
          id: element.attributes.id,
          parent: element.attributes.parent ?? '',
          default: element.attributes.default ?? '',
        }),
      ),
  )
}

const definition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'sc2-data',
    label: 'StarCraft II GameData',
    mediaType: 'application/x-sc2-gamedata+xml',
  }),
  async detect(prefix, uri) {
    const text = ascii.decode(prefix)
    return /\.xml$/iu.test(uri) && rootCatalog(text)
      ? { confidence: 0.98, kind: 'structure', note: 'catalog-root' }
      : { confidence: 0, kind: 'structure', note: 'sc2-catalog-root-missing' }
  },
  async inspect(bytes, context) {
    const text = decodeStructuredText(bytes, context.budget, 'SC2 GameData')
    if (!rootCatalog(text)) throw new TypeError('SC2 GameData root must be Catalog')
    const elements = parseXmlElements(text, context.budget, 'Catalog', 'SC2 GameData')
    const entities = catalogEntities(elements)
    const classes = [...new Set(entities.map(entity => entity.className))]
    return {
      summary: {
        format: 'sc2-data',
        lines: lineCount(text),
        elements: elements.length,
        entities: entities.length,
        classes,
        inheritedEntities: entities.filter(entity => entity.parent !== '').length,
      },
      metadata: [
        {
          id: 'sc2-data-catalog',
          label: 'SC2 GameData catalog',
          entries: [
            { key: 'lines', value: lineCount(text) },
            { key: 'elements', value: elements.length },
            { key: 'entities', value: entities.length },
            { key: 'classes', value: classes },
            {
              key: 'inheritedEntities',
              value: entities.filter(entity => entity.parent !== '').length,
            },
          ],
        },
      ],
      traits: [
        { id: 'content.text', parameters: { language: 'sc2-gamedata', lines: lineCount(text) } },
        { id: 'structure.hierarchy', parameters: { elements: elements.length } },
      ],
      text: true,
      dataSources: {
        'common.view/table-data-source': createTableDataSource(
          ['Class', 'Id', 'Parent', 'Default'],
          entities.map(entity => [entity.className, entity.id, entity.parent, entity.default]),
        ),
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'catalog',
          label: 'SC2 GameData Catalog',
          preview: `${entities.length} entity/entities in ${classes.length} class(es)`,
          children: classes.map(className => ({
            kind: 'entity-class',
            label: className,
            preview: `${entities.filter(entity => entity.className === className).length} entity/entities`,
            children: entities
              .filter(entity => entity.className === className)
              .map(entity => ({
                kind: 'entity',
                label: entity.id,
                preview: entity.parent === '' ? undefined : `parent ${entity.parent}`,
              })),
          })),
        }),
      },
      unsupportedFeatures: [
        'schema-field-validation',
        'dependency-overlay-loading',
        'inheritance-resolution',
        'cross-catalog-references',
        'semantic-editing',
        'catalog-export',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
