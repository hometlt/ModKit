import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const APP_THEME_MANIFEST = 'modkit.themes.json'
export const APP_THEME_DOM_ID = 'modkit-app-themes'
export const APP_THEME_ROOTS_ENV = 'MODKIT_APP_THEME_ROOTS'

const MAX_ENVIRONMENT_LENGTH = 32 * 1024
const MAX_EXTERNAL_ROOTS = 16
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_STYLESHEET_BYTES = 2 * 1024 * 1024
const MAX_THEMES = 64
const THEME_ID = /^[a-z][a-z0-9-]{0,63}$/u

const recordOf = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined

function manifestRoots(environmentValue) {
  if (environmentValue.length > MAX_ENVIRONMENT_LENGTH) {
    throw new TypeError(`${APP_THEME_ROOTS_ENV} exceeds ${MAX_ENVIRONMENT_LENGTH} characters`)
  }
  const roots = environmentValue
    .split(delimiter)
    .map(value => value.trim())
    .filter(value => value !== '')
  if (roots.length > MAX_EXTERNAL_ROOTS) {
    throw new TypeError(`${APP_THEME_ROOTS_ENV} has more than ${MAX_EXTERNAL_ROOTS} roots`)
  }
  return roots
}

function requireRegularFile(path, what, maximumBytes) {
  if (!existsSync(path)) throw new TypeError(`${what} is missing: ${path}`)
  const details = statSync(path)
  if (!details.isFile()) throw new TypeError(`${what} is not a regular file: ${path}`)
  if (details.size > maximumBytes) {
    throw new TypeError(`${what} exceeds ${maximumBytes} bytes: ${path}`)
  }
}

function containedFile(root, stylesheet) {
  if (
    stylesheet === '' ||
    stylesheet.includes('\\') ||
    isAbsolute(stylesheet) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(stylesheet)
  ) {
    throw new TypeError(`theme stylesheet must be a relative POSIX path: ${stylesheet}`)
  }
  const segments = stylesheet.split('/')
  if (
    segments.some(segment => segment === '' || segment === '.' || segment === '..') ||
    !stylesheet.endsWith('.css')
  ) {
    throw new TypeError(`theme stylesheet must be a traversal-free .css path: ${stylesheet}`)
  }
  const realRoot = realpathSync(root)
  const candidate = join(realRoot, ...segments)
  requireRegularFile(candidate, 'theme stylesheet', MAX_STYLESHEET_BYTES)
  const realCandidate = realpathSync(candidate)
  const within = relative(realRoot, realCandidate)
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new TypeError(`theme stylesheet escapes its manifest root: ${stylesheet}`)
  }
  return realCandidate
}

function requireSelfContainedStylesheet(path, manifestPath) {
  const source = readFileSync(path, 'utf8')
  // Static external themes are copied as one reviewed file. Refuse network/import/resource edges
  // instead of silently producing a build whose CSS reaches outside the selected manifest root.
  if (/@import\b|url\s*\(/iu.test(source)) {
    throw new TypeError(
      `external theme stylesheet must be self-contained (no @import or url()): ${manifestPath}`,
    )
  }
}

function readManifest(root, allowIntegratedStylesheet) {
  const absoluteRoot = resolve(root)
  if (!existsSync(absoluteRoot) || !statSync(absoluteRoot).isDirectory()) {
    throw new TypeError(`theme manifest root is not a directory: ${absoluteRoot}`)
  }
  const manifestPath = join(absoluteRoot, APP_THEME_MANIFEST)
  requireRegularFile(manifestPath, 'theme manifest', MAX_MANIFEST_BYTES)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new TypeError(
      `theme manifest is not valid JSON: ${manifestPath} (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  const document = recordOf(parsed)
  if (document?.['schemaVersion'] !== 1 || !Array.isArray(document['themes'])) {
    throw new TypeError(
      `theme manifest must have schemaVersion 1 and a themes array: ${manifestPath}`,
    )
  }
  if (document['themes'].length > MAX_THEMES) {
    throw new TypeError(`theme manifest has more than ${MAX_THEMES} themes: ${manifestPath}`)
  }
  return document['themes'].map((value, index) => {
    const entry = recordOf(value)
    const id = entry?.['id']
    const label = entry?.['label']
    const stylesheet = entry?.['stylesheet']
    if (typeof id !== 'string' || !THEME_ID.test(id)) {
      throw new TypeError(`theme manifest entry ${index} has an invalid id: ${manifestPath}`)
    }
    if (
      typeof label !== 'string' ||
      label.trim() !== label ||
      label.length === 0 ||
      label.length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(label)
    ) {
      throw new TypeError(`theme manifest entry ${index} has an invalid label: ${manifestPath}`)
    }
    if (typeof stylesheet !== 'string') {
      throw new TypeError(`theme manifest entry ${index} has no stylesheet: ${manifestPath}`)
    }
    if (stylesheet === 'modkit-ui.css') {
      if (!allowIntegratedStylesheet) {
        throw new TypeError(
          `only the core theme manifest may name the integrated modkit-ui.css: ${manifestPath}`,
        )
      }
      return Object.freeze({ id, label, stylesheet: './modkit-ui.css', manifestPath })
    }
    const sourcePath = containedFile(dirname(manifestPath), stylesheet)
    if (!allowIntegratedStylesheet) requireSelfContainedStylesheet(sourcePath, manifestPath)
    return Object.freeze({
      id,
      label,
      stylesheet: `./theme-${id}.css`,
      sourcePath,
      manifestPath,
    })
  })
}

/** Resolve the core data manifest and optional external manifest roots. */
export function resolveAppThemes({
  repositoryRoot,
  environmentValue = process.env[APP_THEME_ROOTS_ENV] ?? '',
} = {}) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.trim() === '') {
    throw new TypeError('repositoryRoot is required')
  }
  const roots = [
    { root: join(resolve(repositoryRoot), 'assets', 'themes'), integrated: true },
    ...manifestRoots(environmentValue).map(root => ({ root: resolve(root), integrated: false })),
  ]
  const canonicalRoots = new Set()
  const themes = []
  const ids = new Set()
  for (const input of roots) {
    const canonicalRoot = realpathSync(input.root)
    if (canonicalRoots.has(canonicalRoot)) {
      throw new TypeError(`duplicate theme manifest root: ${input.root}`)
    }
    canonicalRoots.add(canonicalRoot)
    for (const theme of readManifest(canonicalRoot, input.integrated)) {
      if (ids.has(theme.id)) throw new TypeError(`duplicate theme id: ${theme.id}`)
      ids.add(theme.id)
      themes.push(theme)
      if (themes.length > MAX_THEMES) {
        throw new TypeError(`app theme set has more than ${MAX_THEMES} themes`)
      }
    }
  }
  return Object.freeze(themes)
}

/** JSON data embedded by a static app build and read by the format-neutral runtime picker. */
export function renderAppThemeDomData(themes) {
  const json = JSON.stringify(
    themes.map(({ id, label, stylesheet }) => ({ id, label, stylesheet })),
  )
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
  return `    <script id="${APP_THEME_DOM_ID}" type="application/json">${json}</script>`
}

/** Copyable stylesheets only; integrated core themes already live in modkit-ui.css. */
export function appThemeStylesheets(themes) {
  return themes.filter(theme => 'sourcePath' in theme)
}
