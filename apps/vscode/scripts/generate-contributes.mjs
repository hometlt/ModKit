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
const menus = sortedGroups(input.menus ?? {}, 'command')
// The settings schema is authored as one object; only its property order is normalised, because a
// JSON Schema's own keyword order carries no meaning but its nesting does.
const configuration = {
  title: input.configuration.title,
  properties: sortedKeys(input.configuration.properties),
}

const document = {
  commands,
  configuration,
  customEditors,
  languages,
  menus,
  views,
  viewsContainers,
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
const activationEvents = [
  ...commands.map(row => `onCommand:${row.command}`),
  ...customEditors.map(row => `onCustomEditor:${row.viewType}`),
  ...Object.values(views)
    .flat()
    .map(row => `onView:${row.id}`),
  ...fileSystemSchemes.map(scheme => `onFileSystem:${scheme}`),
  /*
   * Language routes come from the configured extension directories at runtime, so no static
   * `onLanguage` event can name them. Activate once startup has finished so opening an SC2 or other
   * extension-routed document gets diagnostics, navigation and tokens without first opening a panel.
   */
  'onStartupFinished',
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
      `${Object.values(menus).flat().length} menu items, ` +
      `${Object.values(views).flat().length} views in ` +
      `${Object.values(viewsContainers).flat().length} container, ` +
      `${Object.keys(configuration.properties).length} setting, ${activationEvents.length} activation events`,
  )
} else {
  await writeFile(output, rendered, 'utf8')
  console.log('contributes:emit: static VS Code contributions generated')
}
