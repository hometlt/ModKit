/** Global registry of parsed M3 structure histories keyed by structure name. */
let structures = {}
/** Get the current structures registry. */
export function getStructures() {
  return structures
}
/** Replace the entire structures registry. */
export function setStructures(newStructures) {
  structures = newStructures
}
