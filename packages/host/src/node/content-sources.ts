/**
 * Host-owned Node composition of declared/configured content-source modules. Resolves only
 * contained extension entrypoints, preserves selected installation options, deduplicates roots,
 * supplies shared probes/cache/language routes and extension-scoped credential/service ports.
 * A module the host names in `startOnDemand` is composed deferred (vfs `DeferredContentSources`):
 * it is imported, and asked for its options, only when the catalogue first needs it.
 * Disposes already-loaded modules on failure; service resolution/activation remains owned by
 * createHostServiceResolver, not by this loader. No game-specific discovery or decoder lives here.
 */
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  composeContentSources,
  type ContentSources,
  type DeferredContentSources,
} from '@modkit/vfs/content-sources'
import {
  loadContentSourceModule,
  loadContentSources,
  readContentSourceConfig,
} from '@modkit/vfs/content-sources/node'
import type { ContractResolverPort, CredentialPort, IndexCacheSwitches, InstallationProbes } from '@modkit/sdk'
import { createLanguageFileClassifier, type LanguageProviderRoute } from '../language/workspace.js'
import { createNodeInstallationProbes } from './installation-probes.js'

export interface ResolveContentSourcesOptions {
  /** Every extension root the host loaded; each may declare `modkit.contentSources`. */
  readonly extensionRoots: readonly string[]
  /**
   * An explicit trusted `{ module, options, extension? }` configuration. With `extension` it stands in
   * for that extension's declared module and the others still compose; without it, it is the only one.
   */
  readonly configPath?: string
  /** Host storage; modules get `<storage>/cache` and `<storage>/state`. */
  readonly storage: string
  /**
   * Host options for one extension (`publisher/id`), overriding its configured defaults. Asked when
   * that extension's module loads, so a deferred module's options (its installation) may be found
   * only then.
   */
  readonly moduleOptions?: (
    extension: string,
  ) =>
    | Readonly<Record<string, unknown>>
    | undefined
    | Promise<Readonly<Record<string, unknown>> | undefined>
  /**
   * Whether an extension's module starts only when the catalogue first needs it (owner decision
   * 13.10): a call naming one of its sources, a host path no started module accepts, or
   * `startModule`. Undefined starts every module with the catalogue.
   */
  readonly startOnDemand?: (extension: string) => boolean
  /** Platform probes handed to every module; defaults to this host's `createNodeInstallationProbes()`. */
  readonly installationProbes?: InstallationProbes
  /** The credential port of one extension (`publisher/id`), handed to that extension's module. */
  readonly credentials?: (extension: string) => CredentialPort | undefined
  /** Host-authorized resolver for one extension; its lifetime must cover the returned sources. */
  readonly contracts?: (extension: string) => ContractResolverPort | undefined
  /** The host's one directory of index caches, handed to every module (shared with codecs). */
  readonly indexCacheDirectory?: string
  /** The user's index cache switches per product, handed to every module. */
  readonly indexCaches?: IndexCacheSwitches
  /** The inventory's language routes; every module gets their classifier (`languageFiles`). */
  readonly languageRoutes?: readonly LanguageProviderRoute[]
}

/**
 * The content sources of a trusted desktop host: the configured module, or else every extension's
 * declared `modkit.contentSources` composed into one catalogue. Undefined when there are none.
 */
export async function resolveContentSources(
  options: ResolveContentSourcesOptions,
): Promise<ContentSources | undefined> {
  const config = options.configPath ? await readContentSourceConfig(options.configPath) : undefined
  const context = {
    installationProbes: options.installationProbes ?? createNodeInstallationProbes(),
    ...(options.indexCacheDirectory === undefined
      ? {}
      : { indexCacheDirectory: options.indexCacheDirectory }),
    ...(options.indexCaches === undefined ? {} : { indexCaches: options.indexCaches }),
    ...(options.languageRoutes === undefined
      ? {}
      : { languageFiles: createLanguageFileClassifier(options.languageRoutes) }),
  }
  // A module receives only its own authority; an unowned configuration gets neither port.
  /** Supplies extension-scoped authority without granting a port to an unowned configuration. */
  const contextOf = (extension: string | undefined) => {
    const credentials = extension === undefined ? undefined : options.credentials?.(extension)
    const contracts = extension === undefined ? undefined : options.contracts?.(extension)
    return {
      ...context,
      ...(credentials === undefined ? {} : { credentials }),
      ...(contracts === undefined ? {} : { contracts }),
    }
  }
  if (config !== undefined && config.extension === undefined) {
    return loadContentSources(options.configPath, options.storage, context)
  }
  const seen = new Set<string>()
  const parts: ContentSources[] = []
  const deferred: DeferredContentSources[] = []
  /** Load one module now, or name it to load when the catalogue first needs it. */
  const compose = async (
    extension: string,
    label: string,
    load: () => Promise<ContentSources>,
  ): Promise<void> => {
    if (options.startOnDemand?.(extension) === true) deferred.push({ id: extension, label, load })
    else parts.push(await load())
  }
  try {
    if (config !== undefined && config.extension !== undefined) {
      const extension = config.extension
      await compose(extension, extension, async () =>
        loadContentSourceModule(
          config.module,
          { ...config.options, ...(await options.moduleOptions?.(extension)) },
          options.storage,
          contextOf(extension),
        ),
      )
    }
    for (const root of options.extensionRoots) {
      const declared = await declaredModule(root)
      if (declared === undefined || declared.extension === config?.extension) continue
      // one module per extension (the inventory keeps one root per id too): a second root of the
      // same extension — a live repository beside its snapshot — would claim the same regions and
      // make every snapshot() of the composition refuse; the first root wins
      const key = (await realpath(declared.module)).toLowerCase()
      if (seen.has(key) || seen.has(declared.extension)) continue
      seen.add(key)
      seen.add(declared.extension)
      // ponytail: one shared cache/state folder, as the single provider had; modules keep their own
      // file names apart. Give each module its own folder if two ever collide.
      await compose(declared.extension, declared.label, async () =>
        loadContentSourceModule(
          declared.module,
          (await options.moduleOptions?.(declared.extension)) ?? {},
          options.storage,
          contextOf(declared.extension),
        ),
      )
    }
  } catch (error) {
    await Promise.all(parts.map(part => part.dispose()))
    throw error
  }
  return parts.length === 0 && deferred.length === 0
    ? undefined
    : composeContentSources(parts, deferred)
}

/** Reads an extension's declared module and refuses a path outside its artifact root. */
async function declaredModule(
  root: string,
): Promise<
  { readonly extension: string; readonly label: string; readonly module: string } | undefined
> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
  const block = (manifest as { readonly modkit?: Record<string, unknown> } | null)?.modkit
  const declared = block?.['contentSources']
  if (typeof declared !== 'string') return undefined
  const base = resolve(root)
  const module = resolve(base, declared)
  const inside = relative(base, module)
  if (isAbsolute(declared) || inside.startsWith('..') || isAbsolute(inside)) {
    throw new TypeError(`${root}: modkit.contentSources must stay inside the extension root`)
  }
  const extension = `${String(block?.['publisher'])}/${String(block?.['id'])}`
  const presentation = block?.['presentation'] as { readonly displayName?: unknown } | undefined
  const label =
    typeof presentation?.displayName === 'string' && presentation.displayName.length > 0
      ? presentation.displayName
      : extension
  return { extension, label, module }
}
