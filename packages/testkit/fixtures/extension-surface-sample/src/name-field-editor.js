/** A deliberately tiny custom editor proving that the host/UI need no type-specific registry edit. */
export default Object.freeze({
  abiVersion: 1,
  mount({ container, initial }) {
    if (container === null || typeof container !== 'object') {
      throw new TypeError('surface-name editor requires a render target')
    }
    const target = container
    target.rendered = { kind: 'surface-name', value: String(initial ?? '') }
    return Object.freeze({
      read() {
        return target.rendered.value
      },
      validate() {
        return target.rendered.value.trim().length === 0 ? 'surface name is required' : undefined
      },
      unmount() {
        delete target.rendered
      },
    })
  },
})
