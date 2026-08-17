/** Generated inert viewer candidates. Modules stay in viewer-catalog.js; main sees data only. */
const stage = (id, contract, priority) =>
  Object.freeze({
    slotId: id,
    kind: 'stage',
    contributionId: `org.modkitx.ui/${id}`,
    extensionId: 'org.modkitx/ui',
    priority,
    bindings: Object.freeze([{ bindingId: `${id}-content`, contract, major: 1 }]),
  })

module.exports = Object.freeze([
  stage('image', 'common.view/raster-image-source', 700),
  stage('table', 'common.view/table-data-source', 650),
  stage('tree', 'common.view/tree-data-source', 600),
  stage('code', 'common.view/text-data-source', 500),
  stage('text', 'common.view/text-data-source', 400),
  stage('hex', 'common.view/byte-range-source', 100),
])
