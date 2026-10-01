#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const argValue = flag => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}
const source = path.resolve(
  argValue('--authority') ?? path.join(appRoot, 'bundled-contributes.v1.json'),
)
const output = path.resolve(
  argValue('--output') ?? path.join(appRoot, 'contributes.generated.json'),
)
const manifestPath = path.resolve(argValue('--manifest') ?? path.join(appRoot, 'package.json'))
const check = args.includes('--check')
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))
const input = JSON.parse(await readFile(source, 'utf8'))

if (input.schemaVersion !== 1) throw new TypeError('bundled contributes authority must be v1')

/** Sort a `{ container: [entry] }` map by container, then each list by the entry's key. */
const sortedGroups = (groups, key) =>
  Object.fromEntries(
    Object.entries(groups)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([container, entries]) => [
        container,
        [...entries].sort((a, b) => compareUtf8(a[key], b[key])),
      ]),
  )

/** Object keys in byte order, so the emitted document is independent of authoring order. */
const sortedKeys = value =>
  Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, item]) => [
        key,
        item !== null && typeof item === 'object' && !Array.isArray(item) ? sortedKeys(item) : item,
      ]),
  )

const commands = [...input.commands].sort((a, b) => compareUtf8(a.command, b.command))
const customEditors = [...input.customEditors].sort((a, b) => compareUtf8(a.viewType, b.viewType))
const grammars = [...(input.grammars ?? [])].sort((a, b) => compareUtf8(a.language, b.language))
if (
  grammars.some(
    (grammar, index) =>
      typeof grammar.language !== 'string' ||
      grammar.language.length === 0 ||
      typeof grammar.scopeName !== 'string' ||
      grammar.scopeName.length === 0 ||
      typeof grammar.path !== 'string' ||
      grammar.path.length === 0 ||
      (index > 0 && grammar.language === grammars[index - 1].language),
  )
) {
  throw new TypeError('grammars must contain unique languages and non-empty scopes and paths')
}
const languages = [...(input.languages ?? [])].sort((a, b) => compareUtf8(a.id, b.id))
if (
  languages.some(
    (language, index) =>
      typeof language.id !== 'string' ||
      language.id.length === 0 ||
      (index > 0 && language.id === languages[index - 1].id),
  )
) {
  throw new TypeError('languages must contain unique non-empty ids')
}
const views = sortedGroups(input.views, 'id')
const viewsContainers = sortedGroups(input.viewsContainers, 'id')
// What a view shows before its provider exists (VS Code shows it instead of "no data provider").
const viewsWelcome = [...(input.viewsWelcome ?? [])].sort((a, b) => compareUtf8(a.view, b.view))
const menus = sortedGroups(input.menus ?? {}, 'command')
// Launch configuration types (`launch.json`): resolved by the extension, never a debug adapter.
const debuggers = [...(input.debuggers ?? [])].sort((a, b) => compareUtf8(a.type, b.type))
if (
  debuggers.some(
    (row, index) =>
      typeof row.type !== 'string' ||
      row.type.length === 0 ||
      (index > 0 && row.type === debuggers[index - 1].type),
  )
) {
  throw new TypeError('debuggers must contain unique non-empty types')
}
// Snippets, the file icon theme and editor defaults for the game languages (from MK2).
const snippets = [...(input.snippets ?? [])].sort((a, b) => compareUtf8(a.language, b.language))
const iconThemes = [...(input.iconThemes ?? [])].sort((a, b) => compareUtf8(a.id, b.id))
if (
  snippets.some(row => typeof row.language !== 'string' || typeof row.path !== 'string') ||
  iconThemes.some(
    (row, index) =>
      typeof row.id !== 'string' ||
      typeof row.path !== 'string' ||
      (index > 0 && row.id === iconThemes[index - 1].id),
  )
) {
  throw new TypeError('snippets need a language and a path; icon themes a unique id and a path')
}
const configurationDefaults =
  input.configurationDefaults === undefined ? undefined : sortedKeys(input.configurationDefaults)
// The settings schema is authored as one object; only its property order is normalised, because a
// JSON Schema's own keyword order carries no meaning but its nesting does.
const configuration = {
  title: input.configuration.title,
  properties: sortedKeys(input.configuration.properties),
}

const document = {
  commands,
  configuration,
  ...(configurationDefaults === undefined ? {} : { configurationDefaults }),
  customEditors,
  ...(debuggers.length === 0 ? {} : { debuggers }),
  grammars,
  ...(iconThemes.length === 0 ? {} : { iconThemes }),
  languages,
  menus,
  ...(snippets.length === 0 ? {} : { snippets }),
  views,
  viewsContainers,
  ...(viewsWelcome.length === 0 ? {} : { viewsWelcome }),
}
const rendered = await format(`${JSON.stringify(document, null, 2)}\n`, {
  ...(await resolveConfig(output)),
  filepath: output,
})
const fileSystemSchemes = [...(input.fileSystemSchemes ?? [])].sort(compareUtf8)
if (
  fileSystemSchemes.some(
    (scheme, index) =>
      typeof scheme !== 'string' ||
      scheme.length === 0 ||
      (index > 0 && scheme === fileSystemSchemes[index - 1]),
  )
) {
  throw new TypeError('fileSystemSchemes must contain unique non-empty strings')
}
/*
 * No `onStartupFinished` (plan 8.6): a window with nothing of Modkit's in it does not activate it
 * and pays nothing. A workspace that holds a package `workspaceMarkers` names, or a file of a
 * language Modkit contributes (named as the language names its files), activates it at startup;
 * opening such a file does too (VS Code's implicit `onLanguage`), as do a Modkit view, editor,
 * file system, debug type or command.
 */
const workspaceMarkers = [
  ...new Set([
    ...(input.workspaceMarkers ?? []),
    ...languages.flatMap(language => [
      ...(language.extensions ?? []).map(extension => `**/*${extension}`),
      ...(language.filenames ?? []).map(name => `**/${name}`),
      ...(language.filenamePatterns ?? []),
    ]),
  ]),
].sort(compareUtf8)
if (workspaceMarkers.some(glob => typeof glob !== 'string' || glob.length === 0)) {
  throw new TypeError('workspaceMarkers must be non-empty glob strings')
}
const activationEvents = [
  ...commands.map(row => `onCommand:${row.command}`),
  ...customEditors.map(row => `onCustomEditor:${row.viewType}`),
  ...Object.values(views)
    .flat()
    .map(row => `onView:${row.id}`),
  ...fileSystemSchemes.map(scheme => `onFileSystem:${scheme}`),
  ...debuggers.map(row => `onDebugResolve:${row.type}`),
  ...workspaceMarkers.map(glob => `workspaceContains:${glob}`),
]

if (check) {
  let existing = ''
  try {
    existing = await readFile(output, 'utf8')
  } catch {}
  if (existing !== rendered) {
    console.error('contributes:check: generated static contributions differ')
    process.exit(1)
  }
  let generated
  let manifest
  try {
    generated = JSON.parse(existing)
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    console.error('contributes:check: generated contributions or package manifest is invalid JSON')
    process.exit(1)
  }
  if (!isDeepStrictEqual(manifest.contributes, generated)) {
    console.error(
      'contributes:check: package.json.contributes must exactly equal contributes.generated.json',
    )
    process.exit(1)
  }
  if (!isDeepStrictEqual(manifest.activationEvents, activationEvents)) {
    console.error(
      'contributes:check: package.json.activationEvents must exactly match the derived ordered activation events',
    )
    process.exit(1)
  }
  console.log(
    `contributes:check: ${commands.length} commands, ${customEditors.length} generic editor, ` +
      `${languages.length} language associations, ` +
      `${grammars.length} language grammars, ` +
      `${Object.values(menus).flat().length} menu items, ` +
      `${Object.values(views).flat().length} views in ` +
      `${Object.values(viewsContainers).flat().length} container, ` +
      `${Object.keys(configuration.properties).length} setting, ${activationEvents.length} activation events`,
  )
} else {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.contributes = document
  manifest.activationEvents = activationEvents
  await writeFile(output, rendered, 'utf8')
  await writeFile(
    manifestPath,
    await format(JSON.stringify(manifest), {
      ...(await resolveConfig(manifestPath)),
      parser: 'json',
    }),
    'utf8',
  )
  console.log('contributes:emit: static VS Code contributions and package manifest generated')
}
