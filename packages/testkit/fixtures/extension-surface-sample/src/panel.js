export const abiVersion = 1

// Inventory-only fixture. A real field-editor module is intentionally absent until P1 defines
// that contribution contract; this panel proves the already-public viewer contribution seam.
export const createViewer = () => ({
  abiVersion: 1,
  provides: ['common.ui/viewer'],
})
