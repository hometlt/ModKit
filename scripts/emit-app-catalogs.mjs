import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRoot = resolve(dirname(scriptPath), '..')
const outputNames = Object.freeze([
  'bundled-catalog.cjs',
  'presentation-catalog.cjs',
  'viewer-catalog.d.ts',
  'viewer-catalog.js',
])
const outputNameSet = new Set(outputNames)
const absolutePathPattern = /(?:[A-Za-z]:[\\/]|(?:from\s+|require\(\s*)['"]\/)/u

/**
 * App-owned selection policy. Contribution metadata is read from the manifests below; this table
 * only chooses which independently-authored viewer backs each Electron preview tab and which UI
 * export mounts it. Adding a manifest therefore never grants execution in Electron by discovery.
 */
const previewPolicy = Object.freeze([
  {
    slotId: 'tree',
    label: 'Tree',
    contributionId: 'org.modkitx.ui/tree-stage',
    module: 'treeViewer',
  },
  {
    slotId: 'table',
    label: 'Table',
    contributionId: 'org.modkitx.ui/table-stage',
    module: 'tableViewer',
  },
  {
    slotId: 'image',
    label: 'Image',
    contributionId: 'org.modkitx.ui/image-stage',
    module: 'imageViewer',
  },
  {
    slotId: 'code',
    label: 'Code',
    contributionId: 'org.modkitx.ui-monaco/code-stage',
    module: 'monacoEditor',
    editable: true,
  },
  {
    slotId: 'text',
    label: 'Text',
    contributionId: 'org.modkitx.ui/bounded-text-stage',
    module: 'textEditor',
    readOnlyModule: 'boundedTextViewer',
    editable: true,
  },
  {
    slotId: 'hex',
    label: 'Hex',
    contributionId: 'org.modkitx.ui/hex-stage',
    module: 'hexEditor',
    readOnlyModule: 'hexViewer',
    editable: true,
  },
])

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function contributionPaths(extensionRoot, patterns) {
  const paths = []
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern.startsWith('./')) {
      throw new Error(`unsupported contribution manifest pattern in ${extensionRoot}: ${pattern}`)
    }
    if (pattern.endsWith('/*.json')) {
      const directory = join(extensionRoot, pattern.slice(2, -'/*.json'.length))
      if (!existsSync(directory)) continue
      paths.push(
        ...readdirSync(directory)
          .filter(name => name.endsWith('.json'))
          .sort()
          .map(name => join(directory, name)),
      )
      continue
    }
    if (pattern.includes('*')) {
      throw new Error(`unsupported contribution manifest glob in ${extensionRoot}: ${pattern}`)
    }
    const path = join(extensionRoot, pattern.slice(2))
    if (existsSync(path)) paths.push(path)
  }
  return paths
}

function bundledExtensionDirectories(root) {
  const commonRoot = join(root, 'extensions', 'common')
  return readdirSync(commonRoot)
    .filter(name => statSync(join(commonRoot, name)).isDirectory())
    .filter(name => {
      const extensionRoot = join(commonRoot, name)
      const packagePath = join(extensionRoot, 'package.json')
      if (!existsSync(packagePath)) return false
      const packageJson = json(packagePath)
      const patterns = packageJson.modkit?.contributionManifests
      if (!Array.isArray(patterns)) return false
      return contributionPaths(extensionRoot, patterns).some(path => {
        const manifest = json(path)
        return (
          manifest.contract?.id === 'org.modkitx/codec-contribution' &&
          manifest.contract?.major === 1
        )
      })
    })
    .sort()
}

function viewerContributions(root) {
  const sources = [
    {
      extensionId: 'org.modkitx/ui',
      directory: join(root, 'packages', 'ui', 'contributions'),
    },
    {
      extensionId: 'org.modkitx/ui-monaco',
      directory: join(root, 'extensions', 'common', 'ui-monaco', 'contributions'),
    },
  ]
  const contributions = new Map()
  for (const source of sources) {
    for (const name of readdirSync(source.directory)
      .filter(name => name.endsWith('.json'))
      .sort()) {
      const manifest = json(join(source.directory, name))
      if (
        manifest.contract?.id !== 'org.modkitx/viewer-contribution' ||
        manifest.contract?.major !== 1
      )
        continue
      if (contributions.has(manifest.id)) {
        throw new Error(`duplicate viewer contribution id: ${manifest.id}`)
      }
      contributions.set(manifest.id, { extensionId: source.extensionId, manifest })
    }
  }
  return contributions
}

function selectedStages(root) {
  const contributions = viewerContributions(root)
  return previewPolicy.map(policy => {
    const contribution = contributions.get(policy.contributionId)
    if (contribution === undefined) {
      throw new Error(`Electron preview contribution is missing: ${policy.contributionId}`)
    }
    const { manifest } = contribution
    if (manifest.spec?.kind !== 'stage') {
      throw new Error(`Electron preview contribution is not a stage: ${policy.contributionId}`)
    }
    const sources = manifest.spec.consumesDataSources
    if (!Array.isArray(sources) || sources.length !== 1) {
      throw new Error(
        `Electron preview stage must consume exactly one source: ${policy.contributionId}`,
      )
    }
    const source = sources[0]
    if (typeof source.contract !== 'string' || source.major !== 1) {
      throw new Error(`Electron preview stage has an unsupported source: ${policy.contributionId}`)
    }
    if (!Number.isSafeInteger(manifest.spec.priority)) {
      throw new Error(`Electron preview stage has an invalid priority: ${policy.contributionId}`)
    }
    return {
      ...policy,
      extensionId: contribution.extensionId,
      kind: manifest.spec.kind,
      priority: manifest.spec.priority,
      singletonGroup: manifest.spec.singletonGroup,
      contract: source.contract,
      major: source.major,
    }
  })
}

function quote(value) {
  return JSON.stringify(value)
}

function renderBundledCatalog(root) {
  const entries = bundledExtensionDirectories(root)
    .map(name => `  ${quote(name)},`)
    .join('\n')
  return `/** Generated by scripts/emit-app-catalogs.mjs from first-party codec manifests. */
module.exports = Object.freeze([
${entries}
])
`
}

function renderPresentationCatalog(root) {
  const entries = selectedStages(root)
    .map(stage => {
      const singleton =
        typeof stage.singletonGroup === 'string'
          ? `\n    singletonGroup: ${quote(stage.singletonGroup)},`
          : ''
      return `  Object.freeze({
    slotId: ${quote(stage.slotId)},
    kind: ${quote(stage.kind)},
    contributionId: ${quote(stage.contributionId)},
    extensionId: ${quote(stage.extensionId)},
    priority: ${stage.priority},${singleton}
    bindings: Object.freeze([
      Object.freeze({ bindingId: ${quote(`${stage.slotId}-content`)}, contract: ${quote(stage.contract)}, major: ${stage.major} }),
    ]),
  }),`
    })
    .join('\n')
  return `/** Generated by scripts/emit-app-catalogs.mjs from UI contribution manifests. */
module.exports = Object.freeze([
${entries}
])
`
}

function renderViewerCatalog(root) {
  const stages = selectedStages(root)
  const uiModules = [...new Set(stages.flatMap(stage => [stage.module, stage.readOnlyModule]))]
    .filter(module => module !== undefined && module !== 'monacoEditor')
    .sort()
  const imports = `import {\n${uiModules.map(module => `  ${module},`).join('\n')}\n} from '@modkitx-x3/ui'`
  const stageEntries = stages
    .map(stage => {
      const editable = stage.editable === true ? ', editable: true' : ''
      return `  { id: ${quote(stage.slotId)}, label: ${quote(stage.label)}, contract: ${quote(stage.contract)}, module: ${stage.module}${editable} },`
    })
    .join('\n')
  const readonlyEntries = stages
    .map(stage => {
      const module = stage.readOnlyModule ?? stage.module
      return `  { id: ${quote(stage.slotId)}, label: ${quote(stage.label)}, contract: ${quote(stage.contract)}, module: ${module} },`
    })
    .join('\n')
  return `/** Generated by scripts/emit-app-catalogs.mjs from UI contribution manifests. */
${imports}
import { monacoEditor } from '../../../extensions/common/ui-monaco/src/index.js'

export const PREVIEW_STAGES = Object.freeze([
${stageEntries}
])

export const PREVIEW_STAGES_READONLY = Object.freeze([
${readonlyEntries}
])

export const PREVIEW_FALLBACK = Object.freeze({ text: boundedTextViewer, hex: hexViewer })
`
}

function renderViewerTypes() {
  return `import type { PreviewStage } from '@modkitx-x3/ui'
import type { ViewerModule } from '@modkitx-x3/sdk'

export declare const PREVIEW_STAGES: readonly PreviewStage[]
export declare const PREVIEW_STAGES_READONLY: readonly PreviewStage[]
export declare const PREVIEW_FALLBACK: {
  readonly text: ViewerModule
  readonly hex: ViewerModule
}
`
}

const prettierOptions = Object.freeze({
  singleQuote: true,
  semi: false,
  trailingComma: 'all',
  tabWidth: 2,
  arrowParens: 'avoid',
  printWidth: 100,
})

export async function buildAppCatalogs(root = defaultRoot) {
  const normalizedRoot = resolve(root)
  const unformatted = [
    ['bundled-catalog.cjs', renderBundledCatalog(normalizedRoot), 'babel'],
    ['presentation-catalog.cjs', renderPresentationCatalog(normalizedRoot), 'babel'],
    ['viewer-catalog.d.ts', renderViewerTypes(), 'typescript'],
    ['viewer-catalog.js', renderViewerCatalog(normalizedRoot), 'babel'],
  ]
  return new Map(
    await Promise.all(
      unformatted.map(async ([name, content, parser]) => [
        name,
        await format(content, { ...prettierOptions, parser }),
      ]),
    ),
  )
}

function validateCatalogContents(catalogs) {
  const absolute = [...catalogs]
    .filter(([, content]) => absolutePathPattern.test(content))
    .map(([name]) => name)
    .sort()
  if (absolute.length > 0) {
    throw new Error(`Electron app catalogs contain absolute paths: ${absolute.join(', ')}`)
  }
}

function unexpectedOutputNames(output) {
  if (!existsSync(output)) return []
  return readdirSync(output, { withFileTypes: true })
    .map(entry => entry.name)
    .filter(name => !outputNameSet.has(name))
    .sort()
}

export async function emitAppCatalogs({ root = defaultRoot, check = false } = {}) {
  const output = join(resolve(root), 'apps', 'electron', 'generated')
  const expected = await buildAppCatalogs(root)
  validateCatalogContents(expected)
  const unexpected = unexpectedOutputNames(output)
  if (unexpected.length > 0) {
    throw new Error(`Electron app catalogs contain unexpected files: ${unexpected.join(', ')}`)
  }
  if (check) {
    const stale = outputNames.filter(name => {
      const path = join(output, name)
      return !existsSync(path) || readFileSync(path, 'utf8') !== expected.get(name)
    })
    if (stale.length > 0) {
      throw new Error(`Electron app catalogs are stale: ${stale.join(', ')}`)
    }
    return { state: 'checked', count: expected.size }
  }
  mkdirSync(output, { recursive: true })
  for (const [name, content] of expected) writeFileSync(join(output, name), content, 'utf8')
  return { state: 'emitted', count: expected.size }
}

function parseArguments(argv) {
  let root = defaultRoot
  let check = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') check = true
    else if (argument === '--root') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error('--root requires a path')
      root = resolve(value)
      index += 1
    } else throw new Error(`unknown argument: ${argument}`)
  }
  return { root, check }
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  const result = await emitAppCatalogs(options)
  process.stdout.write(`${result.count} Electron app catalogs ${result.state}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  try {
    await run()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
