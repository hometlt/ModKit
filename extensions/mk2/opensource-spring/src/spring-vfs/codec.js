// Portable, conservative parser for Spring modinfo.lua/mapinfo.lua metadata.

import { createInspectionCodec, createTreeDataSource } from '@modkitx-x3/codec-kit'

const ID = 'org.modkitx/spring-vfs'
const SECTIONS = Object.freeze({ 0: 'Mod', 1: 'Mod', 3: 'Map', 4: 'Base', 5: 'Menu' })

function stripComments(source) {
  return source.replace(/--\[\[[\s\S]*?\]\]/gu, '').replace(/--[^\r\n]*/gu, '')
}

function stringField(source, key) {
  const match = new RegExp(`(?:^|[,;\\s])${key}\\s*=\\s*(['"])(.*?)\\1`, 'iu').exec(source)
  return match?.[2] ?? ''
}

function numberField(source, key) {
  const match = new RegExp(`(?:^|[,;\\s])${key}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, 'iu').exec(source)
  return match === null ? undefined : Number(match[1])
}

function stringList(source, key) {
  const match = new RegExp(`(?:^|[,;\\s])${key}\\s*=\\s*\\{([\\s\\S]*?)\\}`, 'iu').exec(source)
  if (match === null) return []
  return [...match[1].matchAll(/(['"])(.*?)\1/gu)].map(item => item[2])
}

function parseInfo(bytes, budget, uri) {
  if (bytes.byteLength > budget.maxScalarBytes)
    throw new RangeError('Spring info exceeds maxScalarBytes')
  const source = stripComments(new TextDecoder().decode(bytes))
  if (!/\breturn\s*\{/iu.test(source)) throw new TypeError('Spring info must return a Lua table')
  const namePure = stringField(source, 'name')
  const modType = numberField(source, 'modtype')
  const section = SECTIONS[modType]
  if (namePure.length === 0 || section === undefined) {
    throw new TypeError('Spring info requires a supported name and modtype')
  }
  const version = stringField(source, 'version')
  const name =
    version.length === 0 || namePure.endsWith(version) ? namePure : `${namePure} ${version}`
  return Object.freeze({
    kind: uri.toLowerCase().includes('mapinfo.lua') ? 'mapinfo' : 'modinfo',
    name,
    namePure,
    version,
    modType,
    section,
    shortName: stringField(source, 'shortname'),
    description: stringField(source, 'description'),
    depend: Object.freeze(stringList(source, 'depend')),
    replace: Object.freeze(stringList(source, 'replace')),
  })
}

const definition = Object.freeze({
  id: ID,
  version: '1.0.0',
  format: Object.freeze({ id: 'spring-vfs', label: 'Spring archive VFS and load order' }),
  async detect(prefix, uri) {
    const name = uri.toLowerCase().split(/[?#]/u, 1)[0] ?? uri.toLowerCase()
    if (
      !name.endsWith('/modinfo.lua') &&
      !name.endsWith('/mapinfo.lua') &&
      !name.endsWith('modinfo.lua') &&
      !name.endsWith('mapinfo.lua')
    ) {
      return { confidence: 0, kind: 'structure', note: 'filename-mismatch' }
    }
    const text = new TextDecoder().decode(prefix)
    return /\breturn\s*\{/iu.test(text)
      ? { confidence: 0.96, kind: 'structure', note: 'Spring Lua metadata table' }
      : { confidence: 0, kind: 'structure', note: 'table-mismatch' }
  },
  async inspect(bytes, context) {
    const info = parseInfo(bytes, context.budget, context.source.ref.uri)
    return {
      summary: {
        format: 'spring-vfs',
        kind: info.kind,
        name: info.name,
        modType: info.modType,
        section: info.section,
        dependencies: info.depend,
        replaces: info.replace,
      },
      metadata: [
        {
          id: 'spring-vfs',
          label: 'Spring archive metadata',
          entries: [
            { key: 'kind', value: info.kind },
            { key: 'name', value: info.name },
            { key: 'version', value: info.version },
            { key: 'modType', value: info.modType },
            { key: 'section', value: info.section },
            { key: 'dependencies', value: info.depend.join(', ') },
            { key: 'replaces', value: info.replace.join(', ') },
          ],
        },
      ],
      traits: [
        { id: 'content.metadata', parameters: { language: 'lua', kind: info.kind } },
        { id: 'content.text', parameters: { encoding: 'utf-8' } },
      ],
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'metadata',
          label: info.name,
          preview: `${info.section}, ${info.depend.length} dependencies`,
          children: [
            {
              kind: 'dependencies',
              label: 'Dependencies',
              children: info.depend.map(dependency => ({ kind: 'dependency', label: dependency })),
            },
            {
              kind: 'replacements',
              label: 'Replaces',
              children: info.replace.map(replacement => ({
                kind: 'replacement',
                label: replacement,
              })),
            },
          ],
        }),
      },
      maxDecodedBytes: bytes.byteLength,
      unsupportedFeatures: [
        'vfs-mounting',
        'load-order-resolution',
        'metadata-writing',
        'archive-scanning',
      ],
    }
  },
})

export const abiVersion = 1
export const createCodec = context => createInspectionCodec(definition, context)
