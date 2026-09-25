/**
 * Which focused documents already loaded their mod into Resources, and which failed and why.
 *
 * A document loads its mod once. A failure is remembered and reported instead of being retried on
 * every repaint of the tree; `forget` (a save, a refresh, a new content source) allows a retry.
 */
export type ActiveModLoad =
  | { readonly state: 'none'; readonly changed: false }
  | { readonly state: 'loaded'; readonly changed: boolean }
  | { readonly state: 'failed'; readonly changed: boolean; readonly failure: string }

export class ActiveModLoads {
  private readonly loaded = new Set<string>()
  private readonly failed = new Map<string, string>()

  forget(): void {
    this.loaded.clear()
    this.failed.clear()
  }

  /**
   * `inPackage` asks the game's loader whether the document lies in a mod package; a loose file
   * loads nothing. `load` loads that mod and says whether the loaded set changed.
   */
  async ensure(
    path: string,
    inPackage: () => Promise<boolean>,
    load: () => Promise<boolean>,
  ): Promise<ActiveModLoad> {
    const failure = this.failed.get(path)
    if (failure !== undefined) return { state: 'failed', changed: false, failure }
    if (this.loaded.has(path)) return { state: 'loaded', changed: false }
    try {
      if (!(await inPackage())) return { state: 'none', changed: false }
      const changed = await load()
      this.loaded.add(path)
      return { state: 'loaded', changed }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.failed.set(path, message)
      return { state: 'failed', changed: true, failure: message }
    }
  }
}
