/**
 * Lifecycle/disposal (canon §6.1 core row): providers/hosts release files, processes,
 * memory and leases through one idempotent disposal contract.
 */

import { ModkitError } from './errors.js'

export interface ModkitDisposable {
  dispose(): void | Promise<void>
}

/** Disposes in reverse registration order; idempotent; aggregates failures. */
export class DisposableStore implements ModkitDisposable {
  private readonly items: ModkitDisposable[] = []
  private disposed = false

  get isDisposed(): boolean {
    return this.disposed
  }

  add<T extends ModkitDisposable>(item: T): T {
    if (this.disposed) {
      throw new ModkitError({
        code: 'x3.core/store-disposed',
        message: 'cannot add to a disposed DisposableStore',
      })
    }
    this.items.push(item)
    return item
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const failures: unknown[] = []
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      try {
        await (this.items[i] as ModkitDisposable).dispose()
      } catch (error) {
        failures.push(error)
      }
    }
    this.items.length = 0
    if (failures.length > 0) {
      throw new ModkitError({
        code: 'x3.core/dispose-failed',
        message: `${failures.length} disposable(s) failed to dispose`,
        context: { count: failures.length },
        cause: failures[0],
      })
    }
  }
}
