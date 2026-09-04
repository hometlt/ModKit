export interface Disposable {
  dispose(): void
}

export type Event<T> = (listener: (e: T) => void) => Disposable

export class Emitter<T> {
  private listeners: Array<(e: T) => void> = []

  get event(): Event<T> {
    return listener => {
      this.listeners.push(listener)
      return {
        dispose: () => {
          const i = this.listeners.indexOf(listener)
          if (i !== -1) this.listeners.splice(i, 1)
        },
      }
    }
  }

  fire(e: T): void {
    // iterate a copy so a listener that disposes during dispatch is safe
    for (const listener of this.listeners.slice()) {
      listener(e)
    }
  }

  dispose(): void {
    this.listeners = []
  }
}
