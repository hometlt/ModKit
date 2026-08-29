export interface ElectronManualExtensionRoot {
  readonly root: string
  readonly enabled: boolean
  readonly id?: string
}

export interface ElectronManagedExtensionRoot {
  readonly root: string
  readonly expectedId: string
}

export interface ElectronComposedExtensionRoot {
  readonly root: string
  readonly expectedId?: string
}

export interface ElectronExtensionRootConflict {
  readonly root: string
  readonly code: string
  readonly message: string
}

export interface ElectronExtensionRootComposition {
  readonly roots: readonly ElectronComposedExtensionRoot[]
  readonly conflicts: readonly ElectronExtensionRootConflict[]
}

export interface ElectronExtensionRootCompositionOptions {
  readonly manualRoots: readonly ElectronManualExtensionRoot[]
  readonly managedRoots: readonly ElectronManagedExtensionRoot[]
  readonly probeManual: (
    root: string,
    claimed: readonly string[],
  ) => Promise<
    | { readonly state: 'extension'; readonly root: string; readonly id: string }
    | {
        readonly state: 'refused'
        readonly root: string
        readonly code: string
        readonly message: string
      }
  >
}

export const ELECTRON_MANAGED_COORDINATE_CONFLICT =
  'x3.electron/managed-extension-coordinate-conflict'
export const ELECTRON_MANUAL_MANAGED_COORDINATE_CONFLICT =
  'x3.electron/manual-managed-extension-coordinate-conflict'

/**
 * Compose enabled manager-owned roots with the user's static folder settings.
 *
 * Manager coordinates are authoritative. A duplicate manager coordinate is rejected in full, so
 * ordering can never select one artifact accidentally. A manual folder that declares (or probes
 * as) a manager-owned coordinate is also rejected, leaving the immutable managed artifact in
 * place and returning a visible diagnostic instead of allowing the folder to shadow it.
 */
export async function composeElectronExtensionRoots(
  options: ElectronExtensionRootCompositionOptions,
): Promise<ElectronExtensionRootComposition> {
  const counts = new Map<string, number>()
  for (const root of options.managedRoots) {
    counts.set(root.expectedId, (counts.get(root.expectedId) ?? 0) + 1)
  }

  const conflicts: ElectronExtensionRootConflict[] = []
  const managed = options.managedRoots.filter(root => {
    if (counts.get(root.expectedId) === 1) return true
    conflicts.push({
      root: root.root,
      code: ELECTRON_MANAGED_COORDINATE_CONFLICT,
      message: `managed coordinate ${root.expectedId} is provided by more than one installed root; all copies were refused`,
    })
    return false
  })
  const claimed = Object.freeze(managed.map(root => root.expectedId))
  const roots: ElectronComposedExtensionRoot[] = managed.map(root => ({ ...root }))

  for (const manual of options.manualRoots) {
    if (!manual.enabled) continue
    if (manual.id !== undefined && claimed.includes(manual.id)) {
      conflicts.push({
        root: manual.root,
        code: ELECTRON_MANUAL_MANAGED_COORDINATE_CONFLICT,
        message: `manual root was refused because managed package state owns coordinate ${manual.id}`,
      })
      continue
    }

    // A legacy/manual entry may omit its id. Probe only to prevent it from shadowing a manager
    // coordinate; other loader failures still travel through the normal host composition.
    if (manual.id === undefined && claimed.length > 0) {
      const probe = await options.probeManual(manual.root, claimed)
      if (probe.state === 'refused' && probe.code === 'x3.host/extension-coordinate-conflict') {
        conflicts.push({
          root: manual.root,
          code: ELECTRON_MANUAL_MANAGED_COORDINATE_CONFLICT,
          message: probe.message,
        })
        continue
      }
    }
    roots.push({
      root: manual.root,
      ...(manual.id === undefined ? {} : { expectedId: manual.id }),
    })
  }

  return Object.freeze({ roots: Object.freeze(roots), conflicts: Object.freeze(conflicts) })
}
