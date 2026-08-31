// MK3 vocabulary restated for tooling that must not import X3 packages (the MK2 allocation
// report runs against a foreign checkout). Cross-checked against @modkit/core + sdk by
// scripts/test/report-mk2-allocation.test.ts so it cannot drift silently.

/** MK3/23 §3 grammars, identical to @modkit/core ids.ts. */
export const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const QUALIFIED =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/

/** @modkit/core OPERATION_DOMAINS + SHARED_OPERATION_IDS (AC §5). */
export const OPERATION_DOMAINS = [
  'archive',
  'model',
  'image',
  'audio',
  'video',
  'vector',
  'document',
  'game',
  'map',
  'mod',
  'data',
  'script',
  'layout',
  'localization',
  'replay',
  'save',
  'runtime',
]
export const SHARED_OPERATION_IDS = [
  'view.render',
  'view.inspect',
  'view.thumbnail',
  'view.hex',
  'view.template',
  'media.play',
  'media.play-pause',
  'media.seek',
  'media.set-rate',
  'media.select-track',
  'edit.content',
  'edit.structure',
  'edit.field',
  'edit.undo-redo',
  'source.save',
  'source.save-as',
  'export.raw',
  'export.convert',
  'container.extract',
  'container.pack',
  'asset.search',
  'asset.validate',
  'asset.compare',
  'content.resolve-dependencies',
  'content.mount',
]

/** @modkit/sdk PERMISSION_CLASSES (MK3/24 §3 canonical taxonomy). */
export const PERMISSION_CLASSES = [
  'read-source',
  'write-source',
  'filesystem-read',
  'filesystem-write',
  'network',
  'process-launch',
  'native-code',
  'credentials',
  'clipboard',
  'persistent-storage',
]

/**
 * G4 legacy → canonical permission mapping (24 §3 «legacy vocabularies получают explicit
 * mapping»). Sources: MK2 CODEC_PERMISSION_CLASSES (already canonical minus `credentials`),
 * ASSET_PERMISSIONS (packages/assets/src/operations.ts) and VFS SourceProviderPermission.
 */
export const PERMISSION_MAPPING = {
  'read-source': ['read-source'],
  'write-source': ['write-source'],
  'filesystem-read': ['filesystem-read'],
  'filesystem-write': ['filesystem-write'],
  network: ['network'],
  'process-launch': ['process-launch'],
  'native-code': ['native-code'],
  clipboard: ['clipboard'],
  'persistent-storage': ['persistent-storage'],
  credentials: ['credentials'],
  // ASSET_PERMISSIONS spellings
  'launch-process': ['process-launch'],
  'native-module': ['native-code'],
  'write-workspace': ['filesystem-write'],
  'external-tool': ['process-launch'], // + target.externalTools facility requirement
  // VFS SourceProviderPermission (coarse)
  filesystem: ['filesystem-read', 'filesystem-write'],
}

/** v1 coarse capability verb → v2 home (operations / data plane / other contribution kind). */
export const CAPABILITY_MAPPING = {
  detect: { home: 'implicit', note: 'codec.probe() + spec.probe plan' },
  inspect: { home: 'operation', ids: ['view.inspect'] },
  read: { home: 'data-plane', note: 'representations + publishesDataSources (family contract)' },
  render: { home: 'operation', ids: ['view.render'] },
  export: { home: 'operation', ids: ['export.raw', 'export.convert'] },
  extract: { home: 'operation', ids: ['container.extract'] },
  validate: { home: 'operation', ids: ['asset.validate'] },
  references: { home: 'operation', ids: ['content.resolve-dependencies'] },
  write: {
    home: 'blocked',
    note: 'X3 v1 is read-only (BRIEF-13A acceptance 19); needs the 13D writer/service contract',
  },
  edit: {
    home: 'blocked',
    note: '13D editing exists for text sources only; binary edit contracts absent',
  },
  language: {
    home: 'absent',
    note: 'language contribution kind / language contracts not in X3',
  },
  analyze: {
    home: 'unclear',
    note: 'no v2 verb; map per codec to view.inspect or a codec-local operation',
  },
  sign: { home: 'absent', note: 'no signing/launch/runtime plane in X3 (17 runtime/launch)' },
  provision: { home: 'absent', note: 'runtime plane not in X3' },
  launch: { home: 'absent', note: 'launch is a runtime side-effect operation (17); not in X3' },
  play: { home: 'absent', note: 'runtime plane not in X3' },
}

/** v1 `kind` → the X3 FormatRole a converter would propose. */
export const X3_ROLE_BY_KIND = {
  image: 'media',
  audio: 'media',
  video: 'media',
  vector: 'media',
  model: 'media',
  archive: 'container',
  document: 'semantic',
  data: 'semantic',
  map: 'semantic',
  localization: 'semantic',
  replay: 'semantic',
  script: 'semantic',
  mod: 'container',
  save: 'semantic',
  layout: 'semantic',
  runtime: 'semantic',
}
