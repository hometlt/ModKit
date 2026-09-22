// Parity harness for the sc2-mod resolved workspace: MK2's ModContextManager against MK3's
// published content.mount handler, over the same mod trees.
//   node reports/parity/sc2-mod-content/run.mjs --config <absolute>/config.json
import { runDifferentialCli } from '../../../scripts/migration/lib/port-generators.mjs'

await runDifferentialCli({
  codec: 'sc2-mod',
  requirementIds: [
    'legacy/codec-manifest/modkit/sc2-mod/feature/0f9f0dcbd4e44d35',
    'legacy/codec-manifest/modkit/sc2-mod/feature/47287c753221de5f',
    'legacy/codec-manifest/modkit/sc2-mod/feature/5030c905dd91a52c',
    'legacy/codec-manifest/modkit/sc2-mod/operation/content.mount',
    'legacy/codec-manifest/modkit/sc2-mod/operation/content.resolve-dependencies',
  ],
})
