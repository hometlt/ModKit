// Clean fixture: final vocabulary and legitimate mentions that must not trip the gate.
export interface TraitRecord {
  id: string
}
export const operations = ['detect', 'inspect'] as const
export const offers: readonly string[] = []
export const permissions = ['read-source'] as const
export const standaloneContainerName = 'modkit.extension.json'
export const label = permissions.length > 0 ? 'granted' : 'denied'
