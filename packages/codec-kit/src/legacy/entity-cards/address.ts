/**
 * One address form for everything a view can open.
 *
 * The entity card had private `navigate`/`back` webview messages, the relation graph re-rooted
 * through its own call, and an archive entry opened by a third route. They are the same act —
 * "show me this" — and could not be shared because there was no single way to name a target.
 *
 * `modkit-subject://<provider>/<kind>/<id>`; every segment is percent-encoded, so a kind or id
 * containing a slash survives the round trip. See
 * `docs/tasks-active/entity-cards-strings/PLAN_wiki_subject_model.md` (W5).
 */

import type { SubjectRef } from './model.js'

const SCHEME = 'modkit-subject://'

/** Stable map key for a subject. Not an address — use {@link subjectAddress} for that. */
export function subjectKey(subject: SubjectRef): string {
  return `${subject.kind} ${subject.id}`
}

/** The address a host can store, restore, and put in a link. */
export function subjectAddress(provider: string, subject: SubjectRef): string {
  return (
    SCHEME +
    [provider, subject.kind, subject.id].map(segment => encodeURIComponent(segment)).join('/')
  )
}

export interface ParsedSubjectAddress {
  /** Which codec or extension owns this subject and can describe it. */
  readonly provider: string
  readonly subject: SubjectRef
}

/** Host-neutral back stack for restorable subject addresses. */
export class SubjectNavigationHistory {
  private currentAddress: string | undefined
  private readonly backStack: string[] = []
  private readonly forwardStack: string[] = []

  get current(): string | undefined {
    return this.currentAddress
  }

  get canBack(): boolean {
    return this.backStack.length > 0
  }

  get canForward(): boolean {
    return this.forwardStack.length > 0
  }

  get breadcrumbs(): readonly string[] {
    return [...this.backStack, ...(this.currentAddress ? [this.currentAddress] : [])]
  }

  reset(address: string): void {
    this.backStack.length = 0
    this.forwardStack.length = 0
    this.currentAddress = address
  }

  open(address: string): void {
    if (address === this.currentAddress) return
    if (this.currentAddress) this.backStack.push(this.currentAddress)
    this.currentAddress = address
    this.forwardStack.length = 0
  }

  back(): string | undefined {
    const address = this.backStack.pop()
    if (address) {
      if (this.currentAddress) this.forwardStack.push(this.currentAddress)
      this.currentAddress = address
    }
    return address
  }

  forward(): string | undefined {
    const address = this.forwardStack.pop()
    if (address) {
      if (this.currentAddress) this.backStack.push(this.currentAddress)
      this.currentAddress = address
    }
    return address
  }

  /** Jump to an earlier breadcrumb while retaining the newer branch for forward navigation. */
  jump(address: string): string | undefined {
    const index = this.backStack.indexOf(address)
    if (index < 0) return undefined
    const skipped = this.backStack.splice(index)
    if (this.currentAddress) this.forwardStack.push(this.currentAddress)
    for (let i = skipped.length - 1; i > 0; i--) this.forwardStack.push(skipped[i]!)
    this.currentAddress = address
    return address
  }
}

/**
 * Parse an address back. Returns `undefined` rather than throwing: an address usually arrives
 * from stored state or a link a user clicked, and a stale one is an ordinary condition.
 */
export function parseSubjectAddress(address: string): ParsedSubjectAddress | undefined {
  if (!address.startsWith(SCHEME)) return undefined
  const segments = address.slice(SCHEME.length).split('/')
  if (segments.length !== 3) return undefined
  const [provider, kind, id] = segments.map(segment => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return undefined
    }
  })
  if (!provider || !kind || id === undefined || id === '') return undefined
  return { provider, subject: { kind, id } }
}
