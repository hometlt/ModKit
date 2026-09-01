import { describe, expect, it } from 'vitest'

import {
  ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES,
  INSTALLED_ARCHIVE_AUTHORITIES,
  INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS,
  assertInstalledArchiveAcceptanceReceipt,
} from '../src/installed-archive-acceptance.js'

const fixtureArtifactSha256 = `sha256:${'a'.repeat(64)}`

const searchEntryByCase = Object.freeze({
  'mpq-tree-search-lazy':
    'Assets/Doodads/SpacePlatform_LandingLights_NoLensFlare/avex_SpacePlatform_LandingLights_NoLensFlare.m3',
  'casc-tree-search-lazy':
    'campaigns/liberty.sc2campaign/base.sc2assets/assets/textures/alpha2.dds',
  'wz-tree-search-lazy': 'components/bodies/cybd_run.pie',
})

const searchQueryByCase = Object.freeze({
  'mpq-tree-search-lazy': 'LandingLights_NoLensFlare.m3',
  'casc-tree-search-lazy': 'alpha2.dds',
  'wz-tree-search-lazy': 'cybd_run.pie',
})

const passingEvidence = (caseId: (typeof INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS)[number]) => {
  const searchEntry = searchEntryByCase[caseId as keyof typeof searchEntryByCase]
  if (searchEntry !== undefined) {
    return {
      browseCommand: 'modkit.browseContainer',
      explorerFileSystem: 'modkit-container',
      workspaceEffect: 'added',
      indexedFiles: 1,
      explorerRootEntries: 1,
      explorerMember: { entry: searchEntry, kind: 'file', size: 1 },
      searchCommand: 'modkit.searchContainer',
      resultOnly: false,
      uiPickerObserved: true,
      inputBoxObserved: true,
      quickPickObserved: true,
      pickedLabel: searchEntry,
      selectedUri: `modkit-container:/authority/${searchEntry}`,
      selectedRoute: 'modkit-container',
      query: searchQueryByCase[caseId as keyof typeof searchQueryByCase],
      requiredEntry: searchEntry,
      extractionCountBeforeRead: 0,
    }
  }
  if (caseId.endsWith('-materialize')) {
    const authority =
      caseId === 'casc-dds-materialize'
        ? {
            entry: INSTALLED_ARCHIVE_AUTHORITIES.cascDds.entry,
            target: 'wave2a-casc-alpha2.dds',
            bytes: INSTALLED_ARCHIVE_AUTHORITIES.cascDds.bytes,
            sha256: INSTALLED_ARCHIVE_AUTHORITIES.cascDds.sha256,
          }
        : caseId === 'mpq-m3-materialize'
          ? {
              entry: INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entry,
              target: 'wave2a-rustbucket.m3',
              bytes: INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entryBytes,
              sha256: INSTALLED_ARCHIVE_AUTHORITIES.rustBucketM3.entrySha256,
            }
          : {
              entry: INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.entry,
              target: 'wave2a-cybd_run.pie',
              bytes: INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.bytes,
              sha256: INSTALLED_ARCHIVE_AUTHORITIES.warzonePie.sha256,
            }
    return {
      command: 'modkit.materializeContainerEntry',
      dialogBypass: true,
      target: authority.target,
      corpus: { sha256: authority.sha256, bytes: authority.bytes },
      extraction: {
        container: 'C:/authority/archive',
        entry: authority.entry,
        bytes: authority.bytes,
      },
    }
  }
  if (caseId.endsWith('-nested-open')) {
    const route =
      caseId === 'casc-dds-nested-open'
        ? [
            { formatId: 'casc', contributionId: 'blizzard/casc' },
            { formatId: 'dds', contributionId: 'modkit/dds' },
          ]
        : caseId === 'mpq-m3-nested-open'
          ? [
              { formatId: 'mpq', contributionId: 'blizzard/mpq' },
              { formatId: 'm3', contributionId: 'blizzard/m3' },
            ]
          : [
              { formatId: 'warzone-wz', contributionId: 'modkit/warzone-wz' },
              { formatId: 'warzone-pie', contributionId: 'modkit/warzone-pie' },
            ]
    return {
      selectedRoute: route,
      selected: { contributionId: route[1]?.contributionId, variantId: 'trusted-node' },
    }
  }
  if (caseId.startsWith('corrupt-')) {
    const authority = (
      {
        'corrupt-mpq-then-canary': {
          family: 'mpq',
          route: 'file-container',
          contributionId: 'blizzard/mpq',
          formatId: 'mpq',
        },
        'corrupt-casc-then-canary': {
          family: 'casc',
          route: 'casc-namespace',
          contributionId: 'blizzard/casc',
          formatId: 'casc',
        },
        'corrupt-wz-then-canary': {
          family: 'wz',
          route: 'file-container',
          contributionId: 'modkit/warzone-wz',
          formatId: 'warzone-wz',
        },
      } as const
    )[caseId as 'corrupt-mpq-then-canary' | 'corrupt-casc-then-canary' | 'corrupt-wz-then-canary']
    return {
      ...authority,
      corpusMutation: 'fixture-mutation',
      failedStep: 'container-index',
      attempted: {
        contributionId: authority.contributionId,
        formatId: authority.formatId,
        state: 'rejected',
        diagnostic: { code: 'x3.fixture/corrupt', message: 'fixture corruption' },
      },
      refusal: {
        source: 'candidate-diagnostic',
        code: 'x3.fixture/corrupt',
        message: 'fixture corruption',
      },
      appAlive: { validCascCanary: true },
    }
  }
  if (caseId === 'armod-open') {
    return {
      installedManifestSha256: INSTALLED_ARCHIVE_AUTHORITIES.armod.route.installedManifestSha256,
      entrypoint: './src/warzone-wz/range-codec.js',
      selected: {
        extensionId: 'wz2100project/warzone-2100',
        contributionId: 'modkit/warzone-wz',
        variantId: 'trusted-node',
      },
      selectedRoute: [{ formatId: 'warzone-wz', contributionId: 'modkit/warzone-wz' }],
      externalProcessTreeMemory: {
        startAcknowledgement: {
          kind: 'x3.vscode-installed-archive-acceptance-ack',
          schemaVersion: 1,
          artifactSha256: fixtureArtifactSha256,
          generation: 3,
          caseId: 'armod-open',
          stage: 'armod-memory-sampling-start',
          observedBy: 'external-process-tree',
          collector: 'Win32_Process',
          requestedSampleIntervalMs: 25,
          verdict: 'pass',
        },
        stopAcknowledgement: {
          kind: 'x3.vscode-installed-archive-acceptance-ack',
          schemaVersion: 1,
          artifactSha256: fixtureArtifactSha256,
          generation: 3,
          caseId: 'armod-open',
          stage: 'armod-memory-sampling-stop',
          observedBy: 'external-process-tree',
          collector: 'Win32_Process',
          requestedSampleIntervalMs: 25,
          matchedRootPids: [101],
          descendantPids: [102],
          sampleCount: 3,
          samples: [
            { timestampMs: 1_000, workingSetBytes: 1, privateBytes: 1 },
            { timestampMs: 1_025, workingSetBytes: 1, privateBytes: 1 },
            { timestampMs: 1_050, workingSetBytes: 1, privateBytes: 1 },
          ],
          observedCadence: {
            intervalCount: 2,
            minIntervalMs: 25,
            maxIntervalMs: 25,
            averageIntervalMs: 25,
          },
          errors: [],
          workingSetBytes: {
            baselineBytes: 1,
            peakBytes: 1,
            deltaBytes: 0,
            deltaCeilingBytes: ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES,
          },
          privateBytes: {
            baselineBytes: 1,
            peakBytes: 1,
            deltaBytes: 0,
            deltaCeilingBytes: ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES,
          },
          verdict: 'pass',
        },
      },
      extensionHostRss: {
        source: 'process.memoryUsage().rss',
        baselineBytes: 1,
        peakBytes: 1,
        deltaBytes: 0,
        deltaCeilingBytes: ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES,
      },
      metadataIo: { readCount: 8, bytes: 70_978, maxReadBytes: 65_557, streamCount: 0 },
      inspection: {
        inspectionMode: 'metadata-first-range',
        sourceBytes: '102362635',
        metadataBytesRead: 65_557,
      },
      selectedDetection: {
        formatId: 'warzone-wz',
        manifestDigest: INSTALLED_ARCHIVE_AUTHORITIES.armod.route.manifestDigest,
        artifactDigest: INSTALLED_ARCHIVE_AUTHORITIES.armod.route.artifactDigest,
      },
    }
  }
  if (caseId === 'wte70-save-as-reopen') {
    return {
      bridge: 'live-custom-document-save-as',
      providerMethod: 'CustomEditorProvider.saveCustomDocumentAs',
      mode: 'live-provider-bridge',
      acceptanceGated: true,
      cleanCopy: false,
      nativeUserCommandProof: false,
      nativeWriterProof: true,
      classification: 'installed-acceptance-native-writer-save-as',
      sourceObservedByCdp: true,
      targetObservedByCdp: true,
      elapsedScope: 'save-as-through-cdp-reopen',
      sourceUnchanged: true,
      modifiedWriterReceiptSha256:
        'CDE80A9C7FD856D024B1FC3C7E95A8D4CF7922F330150CBE0C47B1D9A265D1AD',
      elapsedMs: 0,
      saveOperationElapsedMs: 0,
      nativeWriterReceipt: {
        kind: 'mpq-native-export-receipt-v1',
        strategy: 'whole-archive-save-as-fixed-slots',
        archiveByteIdentity: 'changed',
        sourceArchiveDigest:
          'sha256:f654e212dcff3ffe3e1090e383b7b25fac4def2a723b4eda408c1b5cdfb2a305',
        outputArchiveDigest:
          'sha256:695b36139334fca493bd89a7cad49524ef28e96a13f30334307106ed5149a312',
        changed: [{ path: 'MapScript.galaxy' }],
      },
      source: {
        bytes: 22_703,
        sha256: 'f654e212dcff3ffe3e1090e383b7b25fac4def2a723b4eda408c1b5cdfb2a305',
      },
      saved: {
        bytes: 22_703,
        sha256: '695b36139334fca493bd89a7cad49524ef28e96a13f30334307106ed5149a312',
      },
    }
  }
  throw new TypeError(`no passing fixture for ${caseId}`)
}

const passingReceipt = () => ({
  kind: 'x3.vscode-installed-archive-acceptance',
  schemaVersion: 1,
  artifactSha256: fixtureArtifactSha256,
  expectedCases: INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS,
  cases: INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS.map(caseId => ({
    caseId,
    evidence: passingEvidence(caseId),
    verdict: 'pass',
  })),
  failures: [],
  verdict: 'pass',
})

describe('installed Wave 2A archive acceptance receipt', () => {
  it('keeps the old A7/A8-only receipt red: the Wave 2A phase is mandatory', () => {
    expect(() => assertInstalledArchiveAcceptanceReceipt(undefined)).toThrow(
      /Wave 2A archive acceptance is missing/u,
    )
  })

  it('requires the bounded product cases rather than accepting a generic archive success', () => {
    expect(() =>
      assertInstalledArchiveAcceptanceReceipt({
        kind: 'x3.vscode-installed-archive-acceptance',
        schemaVersion: 1,
        artifactSha256: `sha256:${'a'.repeat(64)}`,
        expectedCases: INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS,
        cases: INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS.slice(0, -1).map(caseId => ({
          caseId,
          verdict: 'pass',
        })),
        failures: [],
        verdict: 'pass',
      }),
    ).toThrow(/case order/u)
  })

  it('rejects case receipts that omit product-action evidence', () => {
    expect(() =>
      assertInstalledArchiveAcceptanceReceipt({
        kind: 'x3.vscode-installed-archive-acceptance',
        schemaVersion: 1,
        artifactSha256: `sha256:${'a'.repeat(64)}`,
        expectedCases: INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS,
        cases: INSTALLED_ARCHIVE_ACCEPTANCE_CASE_IDS.map(caseId => ({
          caseId,
          evidence: {},
          verdict: 'pass',
        })),
        failures: [],
        verdict: 'pass',
      }),
    ).toThrow(/(?:evidence is missing|registered browse\/search)/u)
  })

  it('requires a CDP-observed InputBox and QuickPick selection for every archive family', () => {
    for (const caseId of Object.keys(searchEntryByCase) as (keyof typeof searchEntryByCase)[]) {
      const receipt = passingReceipt()
      const target = receipt.cases.find(item => item.caseId === caseId)
      if (target === undefined) throw new TypeError(`fixture omitted ${caseId}`)
      const evidence = target.evidence as { quickPickObserved: boolean }
      evidence.quickPickObserved = false
      expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(
        /visible registered browse\/search/u,
      )
    }
  })

  it('binds materialized bytes and nested routes to their exact authorities', () => {
    const materialized = passingReceipt()
    const materializedCase = materialized.cases.find(item => item.caseId === 'mpq-m3-materialize')
    if (materializedCase === undefined) throw new TypeError('fixture omitted MPQ materialization')
    ;(materializedCase.evidence as { corpus: { sha256: string } }).corpus.sha256 = '0'.repeat(64)
    expect(() => assertInstalledArchiveAcceptanceReceipt(materialized)).toThrow(
      /explicit-target materialization/u,
    )

    const nested = passingReceipt()
    const nestedCase = nested.cases.find(item => item.caseId === 'wz-pie-nested-open')
    if (nestedCase === undefined) throw new TypeError('fixture omitted WZ nested open')
    ;(
      nestedCase.evidence as { selectedRoute: { formatId: string; contributionId: string }[] }
    ).selectedRoute[1]!.contributionId = 'fixture/not-the-pie-codec'
    expect(() => assertInstalledArchiveAcceptanceReceipt(nested)).toThrow(/nested product route/u)
  })

  it('pins the installed ARmod package manifest and selected route', () => {
    const receipt = passingReceipt()
    const target = receipt.cases.find(item => item.caseId === 'armod-open')
    if (target === undefined) throw new TypeError('fixture omitted ARmod')
    ;(target.evidence as { installedManifestSha256: string }).installedManifestSha256 =
      `sha256:${'0'.repeat(64)}`
    expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(
      /metadata-first installed-route telemetry/u,
    )

    const digestReceipt = passingReceipt()
    const digestTarget = digestReceipt.cases.find(item => item.caseId === 'armod-open')
    if (digestTarget === undefined) throw new TypeError('fixture omitted ARmod detection digest')
    ;(digestTarget.evidence as { selectedDetection: { artifactDigest: string } }).selectedDetection
      .artifactDigest = `sha256:${'0'.repeat(64)}`
    expect(() => assertInstalledArchiveAcceptanceReceipt(digestReceipt)).toThrow(
      /metadata-first installed-route telemetry/u,
    )
  })

  it('requires a complete external Win32 process-tree memory sample for ARmod', () => {
    const receipt = passingReceipt()
    const target = receipt.cases.find(item => item.caseId === 'armod-open')
    if (target === undefined) throw new TypeError('fixture omitted ARmod')
    const evidence = target.evidence as {
      externalProcessTreeMemory: {
        stopAcknowledgement: { privateBytes: { deltaBytes: number }; sampleCount: number }
      }
    }
    evidence.externalProcessTreeMemory.stopAcknowledgement.privateBytes.deltaBytes =
      ARMOD_EXTERNAL_PROCESS_TREE_MEMORY_DELTA_CEILING_BYTES + 1
    expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(
      /external process-tree memory/u,
    )

    evidence.externalProcessTreeMemory.stopAcknowledgement.privateBytes.deltaBytes = 0
    evidence.externalProcessTreeMemory.stopAcknowledgement.sampleCount = 1
    expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(
      /external process-tree memory/u,
    )

    const cadenceReceipt = passingReceipt()
    const cadenceTarget = cadenceReceipt.cases.find(item => item.caseId === 'armod-open')
    if (cadenceTarget === undefined) throw new TypeError('fixture omitted ARmod cadence')
    ;(
      cadenceTarget.evidence as {
        externalProcessTreeMemory: {
          stopAcknowledgement: { observedCadence: { averageIntervalMs: number } }
        }
      }
    ).externalProcessTreeMemory.stopAcknowledgement.observedCadence.averageIntervalMs = 24
    expect(() => assertInstalledArchiveAcceptanceReceipt(cadenceReceipt)).toThrow(
      /external process-tree memory/u,
    )
  })

  it('binds the external ARmod memory acknowledgement to the accepted artifact and case', () => {
    const receipt = passingReceipt()
    const target = receipt.cases.find(item => item.caseId === 'armod-open')
    if (target === undefined) throw new TypeError('fixture omitted ARmod')
    const evidence = target.evidence as {
      externalProcessTreeMemory: {
        startAcknowledgement: { artifactSha256: string }
        stopAcknowledgement: { caseId: string }
      }
    }
    evidence.externalProcessTreeMemory.startAcknowledgement.artifactSha256 = `sha256:${'0'.repeat(64)}`
    expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(
      /external process-tree memory/u,
    )

    evidence.externalProcessTreeMemory.startAcknowledgement.artifactSha256 = fixtureArtifactSha256
    evidence.externalProcessTreeMemory.stopAcknowledgement.caseId = 'fixture/wrong-case'
    expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(
      /external process-tree memory/u,
    )
  })

  it('rejects malformed actual refusal attribution for every corrupt family', () => {
    for (const caseId of [
      'corrupt-mpq-then-canary',
      'corrupt-casc-then-canary',
      'corrupt-wz-then-canary',
    ] as const) {
      const receipt = passingReceipt()
      const target = receipt.cases.find(item => item.caseId === caseId)
      if (target === undefined) throw new TypeError(`fixture omitted ${caseId}`)
      ;(target.evidence as { attempted: { contributionId: string } }).attempted.contributionId =
        'fixture/not-actually-attempted'
      expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(
        /typed family refusal/u,
      )
    }
  })

  it('rejects a clean copy or missing native-writer proof', () => {
    const receipt = passingReceipt()
    const target = receipt.cases.find(item => item.caseId === 'wte70-save-as-reopen')
    if (target === undefined) throw new TypeError('fixture omitted WTE70')
    ;(target.evidence as { cleanCopy: boolean }).cleanCopy = true
    expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(/WTE70 Save As/u)
    ;(target.evidence as { cleanCopy: boolean; nativeWriterProof: boolean }).cleanCopy = false
    ;(target.evidence as { nativeWriterProof: boolean }).nativeWriterProof = false
    expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(/WTE70 Save As/u)
  })

  it('requires the native destination digest to differ from the installed source', () => {
    const receipt = passingReceipt()
    const target = receipt.cases.find(item => item.caseId === 'wte70-save-as-reopen')
    if (target === undefined) throw new TypeError('fixture omitted WTE70')
    ;(target.evidence as { saved: { sha256: string } }).saved.sha256 =
      INSTALLED_ARCHIVE_AUTHORITIES.wte70.sha256
    expect(() => assertInstalledArchiveAcceptanceReceipt(receipt)).toThrow(/WTE70 Save As/u)
  })
})
