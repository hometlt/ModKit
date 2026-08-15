#!/usr/bin/env node
// Emits the published .json schema artifacts from the schema consts in core and
// sdk (single wire authority; DoR workflow step 2). Serialization is
// canonical (sorted keys, LF, trailing newline) so the artifacts are byte-stable.
// `--check` compares instead of writing and exits 1 on drift. Requires a built sdk.

import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { canonicalJsonStringify, sourceSpanSchema } from '../packages/core/dist/index.js'
import * as sdk from '../packages/sdk/dist/index.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const check = process.argv.includes('--check')

const artifacts = new Map([
  [join(root, 'packages', 'core', 'schemas', 'source-span.v1.schema.json'), sourceSpanSchema],
  [
    join(root, 'packages', 'sdk', 'schemas', 'extension-manifest.v1.schema.json'),
    sdk.extensionManifestSchema,
  ],
  [
    join(root, 'packages', 'sdk', 'schemas', 'extension-manifest-modkit-block.v1.schema.json'),
    sdk.modkitBlockSchema,
  ],
  [
    join(root, 'packages', 'sdk', 'schemas', 'extension-requirement.v1.schema.json'),
    sdk.extensionRequirementSchema,
  ],
  [
    join(root, 'packages', 'sdk', 'schemas', 'codec-contribution-spec.v1.schema.json'),
    sdk.codecContributionSpecV1Schema,
  ],
  [
    join(root, 'packages', 'sdk', 'schemas', 'service-provider-contribution-spec.v1.schema.json'),
    sdk.serviceProviderContributionSpecV1Schema,
  ],
  [
    join(root, 'packages', 'sdk', 'schemas', 'viewer-contribution-spec.v1.schema.json'),
    sdk.viewerContributionSpecV1Schema,
  ],
  [
    join(root, 'packages', 'sdk', 'schemas', 'editor-contribution-spec.v1.schema.json'),
    sdk.editorContributionSpecV1Schema,
  ],
  [
    join(root, 'packages', 'sdk', 'schemas', 'trait-definition-spec.v1.schema.json'),
    sdk.traitDefinitionSpecV1Schema,
  ],
  [
    join(root, 'packages', 'sdk', 'schemas', 'contract-definition-spec.v1.schema.json'),
    sdk.contractDefinitionSpecV1Schema,
  ],
  [
    join(root, 'packages', 'sdk', 'schemas', 'subject-descriptor.v2.schema.json'),
    sdk.subjectDescriptorV2Schema,
  ],
])
if (sdk.contributionManifestSchema !== undefined) {
  artifacts.set(
    join(root, 'packages', 'sdk', 'schemas', 'contribution-manifest.v1.schema.json'),
    sdk.contributionManifestSchema,
  )
  artifacts.set(
    join(root, 'packages', 'sdk', 'schemas', 'runtime-variant-declaration.v1.schema.json'),
    sdk.runtimeVariantDeclarationSchema,
  )
  artifacts.set(
    join(root, 'packages', 'sdk', 'schemas', 'scoped-contract-requirement.v1.schema.json'),
    sdk.scopedContractRequirementSchema,
  )
}

const stale = []
for (const [path, schema] of artifacts) {
  const rendered = canonicalJsonStringify(schema)
  if (check) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined
    if (current !== rendered) stale.push(relative(root, path).replaceAll('\\', '/'))
  } else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, rendered, 'utf8')
  }
}

if (check) {
  const managedDirectories = [
    join(root, 'packages', 'core', 'schemas'),
    join(root, 'packages', 'sdk', 'schemas'),
  ]
  for (const directory of managedDirectories) {
    if (!existsSync(directory)) continue
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.schema.json')) continue
      const path = join(directory, name)
      if (!artifacts.has(path)) {
        stale.push(`${relative(root, path).replaceAll('\\', '/')} (unexpected)`)
      }
    }
  }
}

if (check && stale.length > 0) {
  console.error(`schemas out of date (run: pnpm schemas:emit): ${stale.join(', ')}`)
  process.exit(1)
}
console.log(
  check ? `schemas up to date (${artifacts.size})` : `emitted ${artifacts.size} schema artifact(s)`,
)
