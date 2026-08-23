let _config = {
  isNode: typeof process !== 'undefined' && process.versions?.node != null,
}
/** Get the current loader configuration. */
export function getConfig() {
  return _config
}
/** Update the loader configuration. Merges with existing values. */
export function setConfig(partial) {
  _config = { ..._config, ...partial }
}
