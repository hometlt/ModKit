/** Electron-main adapter between the validated host inventory, Extension Manager VFS and UI. */
import {
  createNodeExtensionVfs,
  type NodeExtensionVfsOptions,
} from '@modkitx/extension-manager/node'
import { loadLocalizationCatalogs, type Inventory } from '@modkitx-x3/host'
import {
  parseUiCatalogDocument,
  UI_MESSAGES,
  type UiCatalogDocument,
  type UiLocalizer,
} from '@modkitx-x3/ui/localization'
import type { Diagnostic } from '@modkitx-x3/core'

import { createElectronLocalizer, ELECTRON_UI_CATALOGS } from './localization.js'

export interface ElectronLocalizationSnapshot {
  readonly catalogs: readonly UiCatalogDocument[]
  readonly diagnostics: readonly Diagnostic[]
  readonly localizer: UiLocalizer
}

/** Load data-only language packs in main; only inert validated catalogs cross into the renderer. */
export async function loadElectronLocalization(
  inventory: Inventory,
  requestedLocale: string | readonly string[] | undefined,
  vfsOptions: NodeExtensionVfsOptions = {},
): Promise<ElectronLocalizationSnapshot> {
  const englishAppCatalog = ELECTRON_UI_CATALOGS[0]
  if (englishAppCatalog === undefined) throw new TypeError('Electron English catalog is missing')
  const fallbackCatalog = Object.freeze({
    ...UI_MESSAGES.en,
    ...englishAppCatalog.messages,
  })
  const allowedRoots = Object.freeze(
    [...new Set(Object.keys(fallbackCatalog).map(key => `${key.split('.')[0]}.`))].sort(),
  )
  const vfs = createNodeExtensionVfs(vfsOptions).vfs
  try {
    const loaded = await loadLocalizationCatalogs(inventory, {
      vfs,
      parseCatalog: parseUiCatalogDocument,
      fallbackCatalog,
      authorizeMessagePrefixes: request => {
        const tail = request.catalogNamespace.split(/[./]/u).at(-1) ?? request.catalogNamespace
        const owner = tail.replace(/-(?:app|ui|localization|messages)$/u, '') || tail
        const ownedPrefix = `${owner}.`
        return request.requestedMessagePrefixes.filter(
          prefix => prefix === ownedPrefix || allowedRoots.some(root => prefix.startsWith(root)),
        )
      },
    })
    return Object.freeze({
      catalogs: loaded.catalogs,
      diagnostics: loaded.diagnostics,
      localizer: createElectronLocalizer(requestedLocale, loaded.catalogs),
    })
  } finally {
    await vfs.dispose()
  }
}
