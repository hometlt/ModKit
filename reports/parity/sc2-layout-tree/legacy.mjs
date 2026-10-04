// Compare the MK2 DescIndex/schema view with MK3's common tree; never read installed content here.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { kitFile, loadPinned } from '../lib/kit.mjs'

export async function prepareOracle({ operation, corpus }) {
  const loaderFiles = [fileURLToPath(import.meta.url), kitFile]
  const core = await loadPinned('packages/layouts-processing/src/sc2-layout-core/index.ts', {
    operation, corpus, loaderFiles, runtimeDependencies: [{ name: 'fast-xml-parser' }],
    operationOptions: { execution: 'DescIndex and SchemaRegistry' },
  })
  const schema = await loadPinned('packages/layouts-processing/bundled-schema.js', {
    operation, corpus, loaderFiles,
    additionalFiles: ['packages/layouts-processing/generated/sc2layout-schema-data.json'],
    operationOptions: { execution: 'canonical bundled layout schema; adapt Git artifact paths to the oracle OS path.join convention' },
  })
  const { Store, createRegistry, DescKind } = core.module
  const valueOf = (item, type, extra = {}) => ({
    name: item.name, type, ...extra,
    ...(item.label === undefined ? {} : { label: item.label }),
    ...(item.documentation === undefined ? {} : { description: item.documentation }),
  })
  const invoke = async input => {
    // MK2 used path.join for Markdown keys. Its pinned generated artifact uses POSIX keys;
    // match the OS on which the unmodified oracle runs, without changing schema values.
    const schemaData = schema.module.default
    const store = new Store(createRegistry({
      ...schemaData,
      mdStorage: Object.fromEntries(Object.entries(schemaData.mdStorage).map(([key, value]) => [path.normalize(key), value])),
    }))
    store.updateDocument(`file:///parity/${input.name}.SC2Layout`, input.text, 1)
    const schemaOf = desc => {
      const type = desc.kind === DescKind.Frame && desc.stype !== undefined
        ? store.schema.getFrameType(desc.stype) : undefined
      if (type === undefined) return undefined
      return {
        frameType: type.name, blizzardOnly: type.blizzOnly,
        hookups: [...type.hookups.values()].map(item => ({ path: item.path, frameClass: item.fClass.name, required: item.required })),
        descriptions: store.schema.getFrameDescs(type).map(item => ({
          name: item.name, fields: [...item.struct.values()].map(field => valueOf(field, field.type.name)),
        })),
        classes: [...type.fclasses.values()].map(item => ({
          name: item.name, properties: [...item.properties.values()].map(property =>
            valueOf(property.etype, property.etype.type.name, { name: property.name, readOnly: property.isReadonly })),
        })),
      }
    }
    const project = desc => {
      const declaration = desc.xDecls.values().next().value
      const position = declaration.getDocument().lang.tdoc.positionAt(declaration.start)
      return {
        kind: desc.kind === DescKind.Animation ? 'animation' : desc.kind === DescKind.StateGroup ? 'state-group' : 'frame',
        label: desc.name, path: desc.fqn.split('/'),
        range: { utf16Offset: declaration.start, utf16Length: declaration.end - declaration.start, line: position.line, column: position.character },
        ...(desc.stype === undefined ? {} : { type: desc.stype.name }),
        schema: schemaOf(desc), children: [...desc.children.values()].map(project),
      }
    }
    return [...store.index.rootNs.get(input.name).children.values()].map(project)
  }
  return { module: { [operation]: invoke }, evidence: { modules: [core.evidence, schema.evidence] } }
}
