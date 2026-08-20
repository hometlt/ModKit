/**
 * Two directories for the "connect a third-party extension" verification run.
 *
 *   node apps/electron/test/fixtures/build-extension-folders.mjs <target-directory>
 *
 * `<target>/ok` is a real, minimal extension: an authored `package.json#modkit` block and one
 * codec contribution for a made-up `.mkfixture` format. It declares no entrypoint that does
 * anything useful, and it does not need to — what is being verified is that a folder the *user*
 * picked reaches the inventory and appears in the settings page's list of codecs.
 *
 * `<target>/junk` is deliberately not an extension: an ordinary Node package, exactly the mistake
 * a user makes when they point the folder dialog at a project instead of at its extension
 * directory. The loader must refuse it by name (`x3.host/extension-not-an-extension`) and the
 * application must show that refusal rather than dropping the folder silently.
 *
 * Kept out of `build-sample-folder.mjs` on purpose: these are not files to open, and putting them
 * beside the samples would change what the previewer sweep walks.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const target = process.argv[2]
if (target === undefined) {
  console.error('usage: build-extension-folders.mjs <target-directory>')
  process.exit(2)
}

const root = resolve(target)
rmSync(root, { recursive: true, force: true })

// ---------------------------------------------------------------------------------------------
// the extension that loads

const ok = join(root, 'ok')
mkdirSync(join(ok, 'contributions'), { recursive: true })
mkdirSync(join(ok, 'src'), { recursive: true })

writeFileSync(
  join(ok, 'package.json'),
  `${JSON.stringify(
    {
      name: 'modkit-extension-x3-fixture-thirdparty',
      version: '1.0.0',
      license: 'MIT',
      type: 'module',
      exports: { './codec': './src/codec.js', './package.json': './package.json' },
      modkit: {
        schemaVersion: 1,
        publisher: 'org.example',
        id: 'fixture-thirdparty',
        contributionManifests: ['./contributions/*.json'],
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
)

/**
 * One codec contribution. The spec carries every field the v1 schema requires — a partial one
 * would be inventoried as invalid and the fixture would prove nothing about a *working* folder.
 */
writeFileSync(
  join(ok, 'contributions', 'codec-fixture.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      contract: { id: 'org.modkitx/codec-contribution', major: 1 },
      id: 'org.example/fixture-thirdparty',
      displayName: 'Fixture third-party format',
      runtimeVariants: [
        {
          variantId: 'portable',
          entrypoint: './src/codec.js',
          target: { environments: ['browser-worker', 'node-worker'] },
          executionProfile: 'worker-brokered',
          requestedPermissionClasses: ['read-source'],
        },
      ],
      spec: {
        formatRefs: [
          { formatId: 'mkfixture', label: 'Modkit fixture', mediaType: 'application/x-mkfixture' },
        ],
        roles: ['semantic'],
        sourceTopology: 'single',
        artifactStages: ['authored'],
        openIntents: ['probe', 'inspect', 'full'],
        match: { extensions: ['mkfixture'], mediaTypes: ['application/x-mkfixture'] },
        probe: { kind: 'bytes', ranges: [{ from: 'start', length: 512 }], maxBytes: 512 },
        representations: [
          {
            id: 'fixture-document',
            contract: 'common.text-data/text-document',
            major: 1,
            stage: 'authored',
            lossy: false,
          },
        ],
        publishesDataSources: [{ contract: 'common.view/text-data-source', major: 1 }],
        operations: [
          {
            id: 'view.inspect',
            handlerId: 'inspect',
            mutatesSource: false,
            requiredPermissions: ['read-source'],
            outputKinds: ['json'],
          },
        ],
        traitDeclarations: [
          { id: 'content.text', representation: 'source', presence: 'will-expose' },
        ],
        implementationTier: { claimed: 1 },
        budgets: {
          maxInputBytes: '1048576',
          maxDepth: 16,
          maxNodes: 4096,
          maxScalarBytes: 65536,
          maxDiagnostics: 128,
        },
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
)

writeFileSync(
  join(ok, 'src', 'codec.js'),
  `/* Fixture codec: the inventory records the manifest; nothing here is ever activated. */\nexport const codec = { id: 'org.example/fixture-thirdparty' }\n`,
  'utf8',
)

// ---------------------------------------------------------------------------------------------
// the folder that is not an extension

const junk = join(root, 'junk')
mkdirSync(junk, { recursive: true })
writeFileSync(
  join(junk, 'package.json'),
  `${JSON.stringify({ name: 'not-an-extension', version: '0.0.0' }, null, 2)}\n`,
  'utf8',
)
writeFileSync(join(junk, 'README.md'), 'An ordinary folder a user might pick by mistake.\n', 'utf8')

console.log(`extension fixtures: ${ok}`)
console.log(`extension fixtures: ${junk}`)
