/** Native plain-text, JSON and JSONC capabilities compiled into every Core host. */
import codecJson from '../native-text/contributions/codec-json.json' with { type: 'json' }
import codecJsonc from '../native-text/contributions/codec-jsonc.json' with { type: 'json' }
import codecTxt from '../native-text/contributions/codec-txt.json' with { type: 'json' }
import contractJson from '../native-text/contributions/contract-json-syntax.json' with { type: 'json' }
import contractJsonc from '../native-text/contributions/contract-jsonc-syntax.json' with { type: 'json' }
import providerJson from '../native-text/contributions/provider-json-default.json' with { type: 'json' }
import providerJsonc from '../native-text/contributions/provider-jsonc-default.json' with { type: 'json' }
import writerJson from '../native-text/contributions/writer-json.json' with { type: 'json' }
import writerPlain from '../native-text/contributions/writer-plain-text.json' with { type: 'json' }
// Native modules are deliberately JavaScript: codec ABI modules are runtime values, not host APIs.
// @ts-expect-error JavaScript ABI module is shipped verbatim with the package.
import * as jsonCodec from '../native-text/json/families/json/entrypoints/json-codec.js'
// @ts-expect-error JavaScript ABI module is shipped verbatim with the package.
import * as jsonProvider from '../native-text/json/families/json/entrypoints/json-provider.js'
// @ts-expect-error JavaScript ABI module is shipped verbatim with the package.
import * as jsoncCodec from '../native-text/json/families/json/entrypoints/jsonc-codec.js'
// @ts-expect-error JavaScript ABI module is shipped verbatim with the package.
import * as jsoncProvider from '../native-text/json/families/json/entrypoints/jsonc-provider.js'
// @ts-expect-error JavaScript ABI module is shipped verbatim with the package.
import * as jsonWriter from '../native-text/json/editing/text-writer.js'
// @ts-expect-error JavaScript ABI module is shipped verbatim with the package.
import * as plainCodec from '../native-text/plain/txt/codec.js'
// @ts-expect-error JavaScript ABI module is shipped verbatim with the package.
import * as plainWriter from '../native-text/plain/editing/text-writer.js'
import { defineLinkedExtension, type LinkedModule } from './linked.js'
import type { ExtensionInput } from './inventory.js'

const NATIVE_ENVIRONMENTS = Object.freeze(['node', 'node-worker', 'browser-main', 'browser-worker'])

const nativeExecutable = (manifest: unknown, entrypoint?: string): unknown => {
  const document = manifest as Readonly<Record<string, unknown>>
  const variants = Array.isArray(document.runtimeVariants) ? document.runtimeVariants : []
  if (variants.length === 0) return manifest
  const selected =
    variants.find(
      variant =>
        typeof variant === 'object' &&
        variant !== null &&
        (variant as { executionProfile?: unknown }).executionProfile === 'trusted-in-process',
    ) ?? variants[0]
  if (typeof selected !== 'object' || selected === null) return manifest
  return {
    ...document,
    runtimeVariants: [
      {
        ...(selected as Readonly<Record<string, unknown>>),
        variantId: 'core-native',
        ...(entrypoint === undefined ? {} : { entrypoint }),
        executionProfile: 'trusted-in-process',
        target: { environments: NATIVE_ENVIRONMENTS },
      },
    ],
  }
}

const nativeText = defineLinkedExtension({
  source: 'native:core/text',
  packageJson: {
    name: '@modkitx-x3/core-native-text',
    version: '1.0.0',
    license: 'MIT',
    modkit: {
      schemaVersion: 1,
      publisher: 'org.modkitx',
      id: 'core-native-text',
      contributionManifests: ['./contributions/*.json'],
    },
  },
  contributions: [
    { path: 'contributions/codec-txt.json', manifest: nativeExecutable(codecTxt) },
    {
      path: 'contributions/writer-plain-text.json',
      manifest: nativeExecutable(writerPlain),
    },
    { path: 'contributions/codec-json.json', manifest: nativeExecutable(codecJson) },
    { path: 'contributions/codec-jsonc.json', manifest: nativeExecutable(codecJsonc) },
    { path: 'contributions/contract-json-syntax.json', manifest: contractJson },
    { path: 'contributions/contract-jsonc-syntax.json', manifest: contractJsonc },
    { path: 'contributions/provider-json-default.json', manifest: nativeExecutable(providerJson) },
    {
      path: 'contributions/provider-jsonc-default.json',
      manifest: nativeExecutable(providerJsonc),
    },
    {
      path: 'contributions/writer-json.json',
      manifest: nativeExecutable(writerJson),
    },
  ],
  modules: {
    './plain/txt/codec.js': plainCodec,
    './plain/editing/text-writer.js': plainWriter,
    './json/editing/text-writer.js': jsonWriter,
    './json/families/json/entrypoints/json-codec.js': jsonCodec,
    './json/families/json/entrypoints/json-provider.js': jsonProvider,
    './json/families/json/entrypoints/jsonc-codec.js': jsoncCodec,
    './json/families/json/entrypoints/jsonc-provider.js': jsoncProvider,
  },
})

/** Inventory input injected before every installed or bundled extension input. */
export const NATIVE_TEXT_INPUT: ExtensionInput = nativeText.input

/** Native entrypoint modules served by the trusted in-process backend. */
export const NATIVE_TEXT_MODULES: ReadonlyMap<string, LinkedModule> = new Map(
  nativeText.moduleEntries,
)

/** Merge caller-linked modules with mandatory Core modules; caller keys win. */
export function withNativeTextModules(
  linked: ReadonlyMap<string, LinkedModule> = new Map(),
): ReadonlyMap<string, LinkedModule> {
  return new Map([...NATIVE_TEXT_MODULES, ...linked])
}
