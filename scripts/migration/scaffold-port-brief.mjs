#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { portContext } from './lib/port-context.mjs'
import { scaffoldBrief } from './lib/port-generators.mjs'
import { MK2_PIN } from './lib/legacy-oracle.mjs'
import { parseFlags, requiredFlag } from './lib/port-cli.mjs'

const flags = parseFlags(process.argv.slice(2), ['--codec', '--out'])
const value = flag => requiredFlag(flags, flag)
const codec = value('--codec')
const out = path.resolve(value('--out'))
const context = await portContext()
const body = scaffoldBrief({
  codec,
  requirements: context.requirements,
  audit: context.audits[codec],
  sourceCommit: MK2_PIN,
})
await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, body, { flag: 'wx' })
console.log(out)
