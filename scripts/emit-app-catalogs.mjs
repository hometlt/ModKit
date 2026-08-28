import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRoot = resolve(dirname(scriptPath), '..')
const outputNames = Object.freeze([
  'bundled-catalog.cjs',
  'viewer-catalog.d.ts',
  'viewer-catalog.js',
])
const outputNameSet = new Set(outputNames)
const sharedPresentationOutput = join(
  'packages',
  'host',
  'src',
  'presentation-catalog.generated.ts',
)
const absolutePathPattern = /(?:[A-Za-z]:[\\/]|(?:from\s+|require\(\s*)['"]\/)/u

/**
 * App-owned selection policy. Contribution metadata is read from the manifests below; this table
 * only chooses which independently-authored viewer backs each Electron preview tab and which UI
 * export mounts it. Adding a manifest therefore never grants execution in Electron by discovery.
 */
const previewPolicy = Object.freeze([
  {
    slotId: 'code',
    label: 'Code',
    contributionId: 'org.modkitx.ui-monaco/code-stage',
    module: 'monacoEditor',
    // the same Monaco, constructed `readOnly`; without it a subject this host cannot write showed
    // an editor with a Save that could not work, or lost the Code tab altogether
    readOnlyModule: 'monacoViewer',
    editable: true,
  },
  {
    slotId: 'video',
    label: 'Video',
    contributionId: 'org.modkitx.ui/video-stage',
    module: 'videoViewer',
  },
  {
    slotId: 'image',
    label: 'Image',
    contributionId: 'org.modkitx.ui/image-stage',
    module: 'imageViewer',
  },
  {
    slotId: 'audio',
    label: 'Audio',
    contributionId: 'org.modkitx.ui/audio-stage',
    module: 'audioViewer',
  },
  {
    slotId: 'world',
    label: 'World',
    contributionId: 'org.modkitx.ui/world-stage',
    module: 'worldViewer',
  },
  {
    slotId: 'model',
    label: 'Model',
    contributionId: 'org.modkitx.ui/model-stage',
    module: 'modelViewer',
  },
  {
    slotId: 'vector',
    label: 'Vector',
    contributionId: 'org.modkitx.ui/vector-stage',
    module: 'vectorViewer',
  },
  {
    slotId: 'table',
    label: 'Table',
    contributionId: 'org.modkitx.ui/table-stage',
    module: 'tableViewer',
  },
  {
    slotId: 'tree',
    label: 'Tree',
    contributionId: 'org.modkitx.ui/tree-stage',
    module: 'treeViewer',
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
    slotId: 'virtual-text',
    label: 'Large text',
    contributionId: 'org.modkitx.ui/virtual-text-stage',
    module: 'virtualTextViewer',
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

/**
 * One generated presentation catalog shared by every host.
 *
 * `previewPolicy` remains the Electron module-binding policy.  The archive stage is composed by
 * each application because it needs that application's nested-open and operation ports, but its
 * eligibility and slot identity still come from the same viewer contribution registry as every
 * other stage.
 */
const presentationPolicy = Object.freeze([
  ...previewPolicy,
  {
    slotId: 'archive',
    label: 'Archive',
    contributionId: 'org.modkitx.ui/archive-stage',
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

function selectedStages(root, policy = previewPolicy) {
  const contributions = viewerContributions(root)
  return policy.map(selected => {
    const contribution = contributions.get(selected.contributionId)
    if (contribution === undefined) {
      throw new Error(`preview contribution is missing: ${selected.contributionId}`)
    }
    const { manifest } = contribution
    if (manifest.spec?.kind !== 'stage') {
      throw new Error(`preview contribution is not a stage: ${selected.contributionId}`)
    }
    const sources = manifest.spec.consumesDataSources
    if (!Array.isArray(sources) || sources.length !== 1) {
      throw new Error(`preview stage must consume exactly one source: ${selected.contributionId}`)
    }
    const source = sources[0]
    if (typeof source.contract !== 'string' || source.major !== 1) {
      throw new Error(`preview stage has an unsupported source: ${selected.contributionId}`)
    }
    if (!Number.isSafeInteger(manifest.spec.priority)) {
      throw new Error(`preview stage has an invalid priority: ${selected.contributionId}`)
    }
    return {
      ...selected,
      extensionId: contribution.extensionId,
      kind: manifest.spec.kind,
      priority: manifest.spec.priority,
      singletonGroup: manifest.spec.singletonGroup,
      contract: source.contract,
      major: source.major,
      manifestSpec: manifest.spec,
      /*
       * Optional sources travel with the stage, and deliberately not through `consumesDataSources`:
       * that list decides eligibility, so a facet named there would cost the stage every subject
       * that publishes none of them. `createCodecPreview` binds these only when the descriptor
       * actually publishes them, which is what lets the shipped model viewer read the optional
       * model facets in Electron exactly as it does in the browser.
       */
      optionalContracts: (manifest.spec.optionalDataSources ?? []).map(item => {
        if (typeof item.contract !== 'string' || item.major !== 1) {
          throw new Error(
            `preview stage has an unsupported optional source: ${selected.contributionId}`,
          )
        }
        return item.contract
      }),
    }
  })
}

function quote(value) {
  return JSON.stringify(value)
}

/** `optionalContracts` for a stage that declares any; nothing at all for a stage that does not. */
function optionalOf(stage) {
  const contracts = stage.optionalContracts ?? []
  if (contracts.length === 0) return ''
  return `, optionalContracts: [${contracts.map(contract => quote(contract)).join(', ')}]`
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

function optionalBindingsOf(stage) {
  return (stage.optionalContracts ?? []).map((contract, index) => ({
    bindingId: `${stage.slotId}-optional-${index + 1}`,
    contract,
    major: 1,
  }))
}

function renderPresentationCatalog(root) {
  const entries = selectedStages(root, presentationPolicy)
    .map(stage => {
      const singleton =
        typeof stage.singletonGroup === 'string'
          ? `\n    singletonGroup: ${quote(stage.singletonGroup)},`
          : ''
      const optionalBindings = optionalBindingsOf(stage)
      const optional =
        optionalBindings.length === 0
          ? ''
          : `\n    optionalBindings: Object.freeze([\n${optionalBindings
              .map(
                binding =>
                  `      Object.freeze({ bindingId: ${quote(binding.bindingId)}, contract: ${quote(binding.contract)}, major: ${binding.major} }),`,
              )
              .join('\n')}\n    ]),`
      return `  Object.freeze({
    slot: Object.freeze({
      slotId: ${quote(stage.slotId)},
      kind: ${quote(stage.kind)},
      contributionId: ${quote(stage.contributionId)},
      extensionId: ${quote(stage.extensionId)},
      priority: ${stage.priority},${singleton}
      bindings: Object.freeze([
        Object.freeze({ bindingId: ${quote(`${stage.slotId}-content`)}, contract: ${quote(stage.contract)}, major: ${stage.major} }),
      ]),
    }),${optional}
    spec: Object.freeze(${JSON.stringify(stage.manifestSpec)}),
  }),`
    })
    .join('\n')
  return `/** Generated by scripts/emit-app-catalogs.mjs from UI contribution manifests. */
export const COMMON_PRESENTATION_CATALOG = Object.freeze([
${entries}
])
`
}

/**
 * Stage modules that do not come from `@modkitx-x3/ui`, and where each does come from.
 *
 * Monaco is an extension, not part of the ui package, so its modules need their own import line.
 * This is a map rather than a hard-coded name because it was a hard-coded name: adding the
 * read-only Monaco to the policy emitted a catalog that imported it from `@modkitx-x3/ui`, and the
 * app failed to build with "No matching export". A second forgotten name would do the same.
 */
const EXTERNAL_STAGE_MODULES = Object.freeze({
  monacoEditor: '../../../extensions/common/ui-monaco/src/index.js',
  monacoViewer: '../../../extensions/common/ui-monaco/src/index.js',
})

function renderViewerCatalog(root) {
  const stages = selectedStages(root)
  const used = [...new Set(stages.flatMap(stage => [stage.module, stage.readOnlyModule]))]
    .filter(module => module !== undefined)
    .sort()
  const uiModules = used.filter(module => EXTERNAL_STAGE_MODULES[module] === undefined)
  const external = new Map()
  for (const module of used) {
    const source = EXTERNAL_STAGE_MODULES[module]
    if (source === undefined) continue
    external.set(source, [...(external.get(source) ?? []), module])
  }
  const externalImports = [...external]
    .map(([source, modules]) => `import { ${modules.join(', ')} } from '${source}'`)
    .join('\n')
  const imports = `import {\n${uiModules.map(module => `  ${module},`).join('\n')}\n} from '@modkitx-x3/ui'`
  const stageEntries = stages
    .map(stage => {
      const editable = stage.editable === true ? ', editable: true' : ''
      return `  { id: ${quote(stage.slotId)}, label: ${quote(stage.label)}, contract: ${quote(stage.contract)}, module: ${stage.module}${optionalOf(stage)}${editable} },`
    })
    .join('\n')
  const readonlyEntries = stages
    .map(stage => {
      const module = stage.readOnlyModule ?? stage.module
      return `  { id: ${quote(stage.slotId)}, label: ${quote(stage.label)}, contract: ${quote(stage.contract)}, module: ${module}${optionalOf(stage)} },`
    })
    .join('\n')
  return `/** Generated by scripts/emit-app-catalogs.mjs from UI contribution manifests. */
${imports}
${externalImports}

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
    [sharedPresentationOutput, renderPresentationCatalog(normalizedRoot), 'typescript'],
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
    const stale = [...outputNames, sharedPresentationOutput].filter(name => {
      const path =
        name === sharedPresentationOutput ? join(resolve(root), name) : join(output, name)
      return !existsSync(path) || readFileSync(path, 'utf8') !== expected.get(name)
    })
    if (stale.length > 0) {
      throw new Error(`Electron app catalogs are stale: ${stale.join(', ')}`)
    }
    return { state: 'checked', count: expected.size }
  }
  mkdirSync(output, { recursive: true })
  for (const [name, content] of expected) {
    const path = name === sharedPresentationOutput ? join(resolve(root), name) : join(output, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
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
  process.stdout.write(`${result.count} shared app catalogs ${result.state}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  try {
    await run()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
