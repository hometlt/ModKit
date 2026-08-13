#!/usr/bin/env node
// Emits the published .json schema artifacts from the schema consts in
// @modkitx-x3/sdk (single wire authority; DoR workflow step 2). Serialization is
// canonical (sorted keys, LF, trailing newline) so the artifacts are byte-stable.
// `--check` compares instead of writing and exits 1 on drift. Requires a built sdk.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { canonicalJsonStringify } from '@modkitx-x3/core'
import * as sdk from '@modkitx-x3/sdk'

const root = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(root, 'packages', 'sdk', 'schemas')
const check = process.argv.includes('--check')

const artifacts = new Map([
  ['extension-manifest.v1.schema.json', sdk.extensionManifestSchema],
  ['extension-manifest-modkit-block.v1.schema.json', sdk.modkitBlockSchema],
  ['extension-requirement.v1.schema.json', sdk.extensionRequirementSchema],
])
if (sdk.contributionManifestSchema !== undefined) {
  artifacts.set('contribution-manifest.v1.schema.json', sdk.contributionManifestSchema)
  artifacts.set('runtime-variant-declaration.v1.schema.json', sdk.runtimeVariantDeclarationSchema)
  artifacts.set('scoped-contract-requirement.v1.schema.json', sdk.scopedContractRequirementSchema)
}

mkdirSync(outDir, { recursive: true })
const stale = []
for (const [name, schema] of artifacts) {
  const rendered = canonicalJsonStringify(schema)
  const path = join(outDir, name)
  if (check) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined
    if (current !== rendered) stale.push(name)
  } else {
    writeFileSync(path, rendered, 'utf8')
  }
}

if (check && stale.length > 0) {
  console.error(`schemas out of date (run: pnpm schemas:emit): ${stale.join(', ')}`)
  process.exit(1)
}
console.log(
  check ? `schemas up to date (${artifacts.size})` : `emitted ${artifacts.size} schema artifact(s)`,
)
