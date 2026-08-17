#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const source = new URL('../bundled-contributes.v1.json', import.meta.url)
const output = new URL('../contributes.generated.json', import.meta.url)
const check = process.argv.includes('--check')
const compareUtf8 = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))
const input = JSON.parse(await readFile(source, 'utf8'))

if (input.schemaVersion !== 1) throw new TypeError('bundled contributes authority must be v1')
const commands = [...input.commands].sort((a, b) => compareUtf8(a.command, b.command))
const customEditors = [...input.customEditors].sort((a, b) => compareUtf8(a.viewType, b.viewType))
const views = Object.fromEntries(
  Object.entries(input.views)
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([container, entries]) => [
      container,
      [...entries].sort((a, b) => compareUtf8(a.id, b.id)),
    ]),
)
const rendered = `${JSON.stringify({ commands, customEditors, views }, null, 2)}\n`

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
    `contributes:check: ${commands.length} commands, ${customEditors.length} generic editor, ${Object.values(views).flat().length} views`,
  )
} else {
  await writeFile(output, rendered, 'utf8')
  console.log('contributes:emit: static VS Code contributions generated')
}
