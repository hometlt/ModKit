import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandContributionManifests } from '@modkit/sdk'

/**
 * The «Modkit File Icons» theme (plan 8.20): every format a Modkit extension claims has an icon, so
 * choosing the theme does not leave files blank, and no icon file lies unused.
 */

const app = fileURLToPath(new URL('..', import.meta.url))
const repo = resolve(app, '..', '..')
const icons = join(app, 'media', 'file-icons')
const theme = JSON.parse(readFileSync(join(icons, 'modkit-icon-theme.json'), 'utf8')) as {
  iconDefinitions: Record<string, { iconPath: string }>
  file: string
  folder: string
  folderExpanded: string
  languageIds: Record<string, string>
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
}

/*
 * The icon of these follows their language: `GameStrings.txt` and a catalog under GameData keep
 * the strings and catalog icons, which an extension entry would override.
 */
const BY_LANGUAGE = new Set(['txt', 'xml'])

function jsonFiles(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory())
      return ['node_modules', 'dist', '.git', 'target'].includes(entry.name)
        ? []
        : jsonFiles(root, path)
    return entry.name.endsWith('.json') ? [path] : []
  })
}

/** The file extensions the contribution manifests of one extension root claim. */
function claimedExtensions(root: string): string[] {
  const modkit = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).modkit as
    { contributionManifests?: string[] } | undefined
  const { entries } = expandContributionManifests(
    modkit?.contributionManifests ?? [],
    jsonFiles(root),
  )
  return entries.flatMap(entry => {
    const spec = JSON.parse(readFileSync(join(root, entry.path), 'utf8')).spec ?? {}
    return [
      ...(spec.match?.extensions ?? []),
      ...(spec.provides ?? []).flatMap(
        (offer: { facet?: { extensions?: string[] } }) => offer.facet?.extensions ?? [],
      ),
    ].map((extension: string) => extension.replace(/^\./u, '').toLowerCase())
  })
}

/** The bundled roots, and the game repositories of the workspace when this checkout has them. */
function extensionRoots(): string[] {
  const roots = readdirSync(join(repo, 'extensions')).map(name => join(repo, 'extensions', name))
  const workspaceFile = resolve(repo, '..', 'modkit.workspace.json')
  if (existsSync(workspaceFile)) {
    for (const source of JSON.parse(readFileSync(workspaceFile, 'utf8')).sources as {
      uri: string
    }[]) {
      const base = resolve(repo, '..', source.uri)
      const manifest = join(base, 'modkit.repository.json')
      if (!existsSync(manifest)) continue
      for (const extension of JSON.parse(readFileSync(manifest, 'utf8')).extensions as {
        path: string
      }[])
        roots.push(join(base, extension.path))
    }
  }
  return roots.filter(root => existsSync(join(root, 'package.json')))
}

describe('the Modkit file icon theme', () => {
  it('gives every extension a Modkit extension claims an icon', () => {
    const themed = new Set(Object.keys(theme.fileExtensions).map(key => key.toLowerCase()))
    const missing = new Set<string>()
    for (const root of extensionRoots())
      for (const extension of claimedExtensions(root))
        if (!themed.has(extension) && !BY_LANGUAGE.has(extension))
          missing.add(`${extension} (${root})`)
    // add each to fileExtensions of media/file-icons/modkit-icon-theme.json with its family icon
    expect([...missing].sort()).toEqual([])
  })

  it('gives every language of this extension an icon', () => {
    const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
    const languages = (manifest.contributes.languages as { id: string }[]).map(
      language => language.id,
    )
    expect(languages.filter(id => theme.languageIds[id] === undefined)).toEqual([])
  })

  it('has a plain file and folder icon for everything it does not know', () => {
    for (const icon of [theme.file, theme.folder, theme.folderExpanded])
      expect(theme.iconDefinitions[icon]).toBeDefined()
  })

  it('names only icons it defines, and defines only icons that exist and are used', () => {
    const used = new Set([
      theme.file,
      theme.folder,
      theme.folderExpanded,
      ...Object.values(theme.languageIds),
      ...Object.values(theme.fileExtensions),
      ...Object.values(theme.fileNames),
    ])
    expect([...used].filter(icon => theme.iconDefinitions[icon] === undefined)).toEqual([])
    expect(Object.keys(theme.iconDefinitions).filter(icon => !used.has(icon))).toEqual([])
    const files = Object.values(theme.iconDefinitions).map(icon =>
      icon.iconPath.replace(/^\.\//u, ''),
    )
    expect(files.filter(file => !existsSync(join(icons, file)))).toEqual([])
    const present = readdirSync(icons).filter(name => name !== 'modkit-icon-theme.json')
    expect(present.filter(name => !files.includes(name))).toEqual([])
  })
})
