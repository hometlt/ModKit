// ../MODDING/modkit-core/packages/host/dist/subject-field-projections.js
function referencePath(path, segment) {
  return path === "" ? segment : `${path}.${segment}`;
}
function metadataFieldProjections(groups) {
  return Object.freeze(groups.flatMap((group) => group.entries.flatMap((entry) => entry.type === void 0 ? [] : [{ path: referencePath(group.id, entry.key), type: entry.type, value: entry.value }])));
}

export {
  referencePath,
  metadataFieldProjections
};
