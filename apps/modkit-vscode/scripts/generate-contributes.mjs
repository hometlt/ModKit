#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const source = new URL('../bundled-contributes.v1.json', import.meta.url)
const output = new URL('../contributes.generated.json', import.meta.url)
const check = process.argv.includes('--check')
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
const views = sortedGroups(input.views, 'id')
const viewsContainers = sortedGroups(input.viewsContainers, 'id')
// The settings schema is authored as one object; only its property order is normalised, because a
// JSON Schema's own keyword order carries no meaning but its nesting does.
const configuration = {
  title: input.configuration.title,
  properties: sortedKeys(input.configuration.properties),
}

const rendered = `${JSON.stringify(
  { commands, configuration, customEditors, views, viewsContainers },
  null,
  2,
)}\n`

if (check) {
  let existing = ''
  try {
    existing = await readFile(output, 'utf8')
  } catch {}
  if (existing !== rendered) {
    console.error('contributes:check: generated static contributions differ')
    process.exit(1)
  }
  console.log(
    `contributes:check: ${commands.length} commands, ${customEditors.length} generic editor, ` +
      `${Object.values(views).flat().length} views in ` +
      `${Object.values(viewsContainers).flat().length} container, ` +
      `${Object.keys(configuration.properties).length} setting`,
  )
} else {
  await writeFile(output, rendered, 'utf8')
  console.log('contributes:emit: static VS Code contributions generated')
}
