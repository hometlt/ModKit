import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '@modkitx-x3/core'
import {
  TRUSTED_IN_PROCESS_EXECUTION_BACKEND,
  buildInventory,
  createBundledServiceDefinitionRegistry,
  createExecutionBackendRegistry,
  createHostContributionContractRegistry,
  registerServiceDefinitionsOrThrow,
} from '@modkitx-x3/host'
import { loadExtensionDirectory } from '@modkitx-x3/host/node'
import { openRuntimeSession } from '@modkitx-x3/host/runtime'
import { runRuntimeSessionV2Conformance } from '@modkitx-x3/testkit'
import type {
  ArtifactByteSource,
  ArtifactSource,
  InputSearchScope,
  Lease,
  ResourceSessionPort,
} from '@modkitx-x3/sdk'
import { revisionId } from '@modkitx-x3/sdk'
import type { RuntimeEvent, RuntimeSessionV2, RuntimeSnapshot } from '@modkitx-x3/sdk/runtime'
import type { CompanionOrigin, CompanionOriginEntry } from '../../host/src/input-resolution.js'
import { createResourceSession } from '../../host/src/resource-session.js'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const extensionRoot = join(repoRoot, 'extensions', 'blizzard', 'starcraft2')
const runtimeId = 'blizzard.starcraft2.playable-subset-v1'
const activationBudget = {
  maxInputBytes: 1_000_000n,
  maxDepth: 64,
  maxNodes: 100_000,
  maxScalarBytes: 1_000_000,
  maxDiagnostics: 100,
}
const sessionBudget = { maxWallTimeMs: 100, maxTicks: 1_000, maxMemoryBytes: 1_000_000 }
const catalog = {
  'Unit/Runner': { LifeMax: '40', LifeStart: '40', Speed: '2', Food: '-1' },
}
const definition = JSON.stringify({
  schemaVersion: 1,
  profile: 'org.modkitx.sc2/playable-subset-v1',
  tickRate: 16,
  randomSeed: 7,
  catalog,
})
const commands = [
  {
    player: -1,
    seq: 0,
    atTick: 0,
    command: { kind: 'spawn', unitType: 'Runner', owner: 1, x: 0, y: 0 },
  },
  {
    player: 1,
    seq: 0,
    atTick: 1,
    command: { kind: 'move', unitIds: ['unit1'], x: 1, y: 0 },
  },
  {
    player: 1,
    seq: 1,
    atTick: 20,
    command: { kind: 'stop', unitIds: ['unit1'] },
  },
] as const

interface OriginHarness {
  readonly origin: CompanionOrigin
  readonly opened: () => number
  readonly released: () => number
}

function memoryOrigin(text: string): OriginHarness {
  const bytes = new TextEncoder().encode(text)
  let opened = 0
  let released = 0
  const logicalId = 'PlayableCatalog.json'
  const origin: CompanionOrigin = Object.freeze({
    primaryLogicalId: logicalId,
    caseSensitivity: 'sensitive',
    scopes: Object.freeze(['current-mount'] as const),
    async *enumerate(
      scope: InputSearchScope,
      options: { readonly prefix: string },
    ): AsyncIterable<CompanionOriginEntry> {
      if (scope === 'current-mount' && logicalId.startsWith(options.prefix)) {
        yield { logicalId, size: BigInt(bytes.byteLength) }
      }
    },
    async open(requested: string): Promise<Lease<ArtifactSource>> {
      if (requested !== logicalId) throw new Error(`missing fixture ${requested}`)
      opened += 1
      let live = true
      const source: ArtifactByteSource = Object.freeze({
        kind: 'bytes',
        ref: { id: 'memory://sc2-playable/catalog', uri: 'memory://sc2-playable/catalog' },
        revision: revisionId('content-hash.sha256:sc2-playable-catalog-v1'),
        size: BigInt(bytes.byteLength),
        async read(offset: bigint, length: number) {
          return bytes.slice(Number(offset), Number(offset) + length)
        },
        async *stream() {
          yield bytes
        },
      })
      return Object.freeze({
        value: source,
        async release() {
          if (!live) return
          live = false
          released += 1
        },
      })
    },
  })
  return { origin, opened: () => opened, released: () => released }
}

async function services() {
  const extension = await loadExtensionDirectory(extensionRoot)
  const inventory = await buildInventory(
    [{ ...extension, execution: { origin: 'bundled', allowTrustedInProcess: true } }],
    createHostContributionContractRegistry(),
  )
  const serviceDefinitions = createBundledServiceDefinitionRegistry()
  await registerServiceDefinitionsOrThrow(inventory, serviceDefinitions)
  return {
    inventory,
    target: {
      environment: 'node' as const,
      operatingSystem: 'windows' as const,
      architecture: 'x64' as const,
    },
    executionBackends: createExecutionBackendRegistry([TRUSTED_IN_PROCESS_EXECUTION_BACKEND]),
    serviceDefinitions,
  }
}

function resourceSession(harness: OriginHarness): ResourceSessionPort {
  return createResourceSession({
    origin: harness.origin,
    revision: revisionId('provider-token:sc2-runtime-playable'),
    sessionId: `sc2-runtime-playable-resources-${Math.random()}`,
  })
}

async function openPlayable(sessionId: string) {
  const harness = memoryOrigin(definition)
  const resources = resourceSession(harness)
  const resolution = await openRuntimeSession({
    services: await services(),
    runtimeId,
    sessionId,
    budget: sessionBudget,
    grant: { id: `sc2-playable-${sessionId}`, classes: [] },
    activationBudget,
    providerInvocation: {
      resources,
      inputs: [
        {
          id: 'playable-catalog',
          kind: 'definition',
          logicalId: 'PlayableCatalog.json',
          scopes: ['current-mount'],
          maxBytes: 64 * 1024,
        },
      ],
    },
  })
  if (resolution.state !== 'resolved') {
    await resources.dispose()
    throw new Error(resolution.diagnostics.map(item => item.message).join('; '))
  }
  return { harness, resources, resolution, session: resolution.session as RuntimeSessionV2 }
}

async function issueScenario(session: RuntimeSessionV2) {
  for (const command of commands) {
    await expect(
      session.execute({
        entrypoint: 'sc2.simulation.issue-command',
        arguments: [command],
        resources: { wallTimeMs: 1, ticks: 0, memoryBytes: 0 },
      }),
    ).resolves.toMatchObject({ state: 'completed' })
  }
}

function snapshotState(snapshot: RuntimeSnapshot) {
  return JSON.parse(new TextDecoder().decode(snapshot.bytes)) as {
    readonly tick: number
    readonly time: number
    readonly randomSeed: number
    readonly commands: readonly unknown[]
    readonly units: Readonly<Record<string, unknown>>
  }
}

function stateProjection(snapshot: RuntimeSnapshot) {
  const state = snapshotState(snapshot)
  const units = Object.values(state.units)
    .map(value => {
      const unit = value as {
        readonly id: string
        readonly unitType: string
        readonly owner: number
        readonly alive: boolean
        readonly x: number
        readonly y: number
        readonly life: { readonly current: number; readonly max: number }
        readonly speed: number
        readonly food: number
        readonly orderQueue: readonly {
          readonly kind: string
          readonly x: number
          readonly y: number
        }[]
      }
      return {
        id: unit.id,
        unitType: unit.unitType,
        owner: unit.owner,
        alive: unit.alive,
        x: unit.x,
        y: unit.y,
        life: { current: unit.life.current, max: unit.life.max },
        speed: unit.speed,
        food: unit.food,
        orderQueue: unit.orderQueue.map(order => ({
          kind: order.kind,
          x: order.x,
          y: order.y,
        })),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  const commands = state.commands.map(value => {
    const issued = value as {
      readonly tick: number
      readonly player: number
      readonly seq: number
      readonly command: Readonly<Record<string, unknown>>
    }
    const command = issued.command
    const normalized =
      command.kind === 'spawn'
        ? {
            kind: command.kind,
            unitType: command.unitType,
            owner: command.owner,
            x: command.x,
            y: command.y,
          }
        : command.kind === 'move'
          ? { kind: command.kind, unitIds: command.unitIds, x: command.x, y: command.y }
          : { kind: command.kind, unitIds: command.unitIds }
    return { tick: issued.tick, player: issued.player, seq: issued.seq, command: normalized }
  })
  return {
    tick: state.tick,
    time: state.time,
    randomSeed: state.randomSeed,
    commands,
    units,
  }
}

function semanticEvents(events: readonly RuntimeEvent[]) {
  return events
    .filter(event => event.kind === 'SimUnitArrived')
    .map(event => ({ tick: event.tick, type: event.kind, payload: event.data }))
}

function hashProjection(value: unknown) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

function snapshotFromText(original: RuntimeSnapshot, text: string): RuntimeSnapshot {
  const bytes = new TextEncoder().encode(text)
  return {
    identity: {
      ...original.identity,
      contentDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    },
    bytes,
  }
}

function unitRecords(state: Record<string, unknown>) {
  return state.units as Record<string, Record<string, unknown>>
}

function requiredUnit(state: Record<string, unknown>, id: string) {
  const unit = unitRecords(state)[id]
  if (unit === undefined) throw new Error(`snapshot unit ${id} is absent`)
  return unit
}

async function collectEvents(session: RuntimeSessionV2) {
  const events: RuntimeEvent[] = []
  for await (const event of session.events()) events.push(event)
  return events
}

async function captured(session: RuntimeSessionV2) {
  const result = await session.snapshot()
  if (result.outcome !== 'captured') throw new Error(`snapshot refused: ${result.reason}`)
  return result.snapshot
}

async function close(opened: Awaited<ReturnType<typeof openPlayable>>) {
  await opened.resolution.release()
  await opened.resources.dispose()
}

async function runSealedLegacyPlayableOracle() {
  const legacyRoot = resolve(repoRoot, '..', 'modkitx')
  const lock = JSON.parse(
    await readFile(join(repoRoot, 'migration', 'oracle', 'legacy-oracle.lock.json'), 'utf8'),
  ) as { readonly legacy: { readonly headCommit: string } }
  if (!existsSync(join(legacyRoot, '.git'))) throw new Error('sealed legacy oracle is unavailable')
  const head = spawnSync('git', ['-C', legacyRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (head.status !== 0 || head.stdout.trim() !== lock.legacy.headCommit) {
    throw new Error(`sealed legacy oracle HEAD mismatch: ${head.stdout.trim()}`)
  }
  const temporary = await mkdtemp(join(tmpdir(), 'x3-sc2-playable-oracle-'))
  try {
    const file = join(temporary, 'PlayableCatalog.json')
    await writeFile(file, definition, 'utf8')
    const windowsPnpm =
      process.platform === 'win32'
        ? resolve(
            process.env.MODKIT_PARITY_PNPM_CLI ??
              join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
          )
        : undefined
    const command = windowsPnpm === undefined ? 'pnpm' : process.execPath
    const commandPrefix = windowsPnpm === undefined ? [] : [windowsPnpm]
    const request = Buffer.from(
      JSON.stringify({
        canonicalRoot: legacyRoot,
        canonicalModule: 'extensions/blizzard/starcraft-2/codecs/sc2-runtime/src/index.ts',
        canonicalAdapter: 'sc2-runtime-playable',
        file,
        catalog,
        randomSeed: 7,
        commands,
        steps: 9,
        checkpointStep: 4,
      }),
    ).toString('base64url')
    return await new Promise<Record<string, unknown>>((resolvePromise, reject) => {
      const child = spawn(
        command,
        [
          ...commandPrefix,
          '--dir',
          legacyRoot,
          'exec',
          'tsx',
          join(repoRoot, 'scripts', 'parity', 'modkitx-probe.mjs'),
          request,
        ],
        { cwd: legacyRoot, windowsHide: true },
      )
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => (stdout += String(chunk)))
      child.stderr.on('data', chunk => (stderr += String(chunk)))
      child.on('error', reject)
      child.on('close', code => {
        if (code !== 0) {
          reject(new Error(`sealed SC2 playable oracle exited ${String(code)}: ${stderr.trim()}`))
          return
        }
        const marker = stdout.split(/\r?\n/u).find(line => line.startsWith('MODKIT_PARITY_RESULT '))
        if (marker === undefined) {
          reject(new Error(`sealed SC2 playable oracle returned no result: ${stdout} ${stderr}`))
          return
        }
        resolvePromise(JSON.parse(marker.slice('MODKIT_PARITY_RESULT '.length)))
      })
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

describe('Block 19 SC2 deterministic playable subset', () => {
  it('passes the frozen runtime-session v2 contract', async () => {
    const opened: Awaited<ReturnType<typeof openPlayable>>[] = []
    try {
      const report = await runRuntimeSessionV2Conformance({
        openSession: async () => {
          const next = await openPlayable(`conformance-${opened.length}`)
          opened.push(next)
          return next.session
        },
        foreignSnapshot: {
          identity: {
            contentDigest: `sha256:${'0'.repeat(64)}`,
            schemaId: 'org.modkitx.test/foreign',
            schemaVersion: 1,
          },
          bytes: new TextEncoder().encode('{}'),
        },
      })
      expect(report.failures).toEqual([])
      expect(report.offers).toEqual(['step', 'events', 'snapshot', 'restore', 'state-hash'])
    } finally {
      await Promise.all(opened.map(close))
    }
  })

  it('runs the same no-install catalog and command log byte-for-byte repeatedly', async () => {
    const first = await openPlayable('repeat-a')
    const second = await openPlayable('repeat-b')
    try {
      await issueScenario(first.session)
      await issueScenario(second.session)
      await expect(first.session.step(9)).resolves.toMatchObject({ outcome: 'stepped' })
      await expect(second.session.step(9)).resolves.toMatchObject({ outcome: 'stepped' })
      expect(await first.session.stateHash()).toEqual(await second.session.stateHash())
      expect(semanticEvents(await collectEvents(first.session))).toEqual([
        { tick: 9, type: 'SimUnitArrived', payload: { unit: 'unit1', x: 1, y: 0 } },
      ])
      expect(first.harness.opened()).toBe(1)
      expect(first.harness.released()).toBe(1)
    } finally {
      await close(first)
      await close(second)
    }
  })

  it('fails closed on unsupported commands, budgets, cancellation and forged state', async () => {
    const opened = await openPlayable('refusals')
    try {
      const before = await opened.session.stateHash()
      await expect(
        opened.session.execute({
          entrypoint: 'sc2.simulation.issue-command',
          arguments: [
            {
              player: 1,
              seq: 0,
              atTick: 0,
              command: { kind: 'attack', unitIds: ['unit1'], targetUnit: 'unit2' },
            },
          ],
          resources: { wallTimeMs: 1, ticks: 0, memoryBytes: 0 },
        }),
      ).resolves.toMatchObject({ state: 'refused', reason: 'unsupported-runtime-subset' })
      await expect(opened.session.step(1_001)).resolves.toMatchObject({
        outcome: 'refused',
        reason: 'budget-exceeded',
      })
      const controller = new AbortController()
      controller.abort('fixture cancellation')
      await expect(opened.session.step(1, controller.signal)).resolves.toMatchObject({
        outcome: 'refused',
        reason: 'cancelled',
      })
      const original = await captured(opened.session)
      const parsed = JSON.parse(new TextDecoder().decode(original.bytes)) as Record<string, unknown>
      const forgedBytes = new TextEncoder().encode(JSON.stringify({ ...parsed, attacker: true }))
      await expect(
        opened.session.restore({
          identity: {
            ...original.identity,
            contentDigest: `sha256:${createHash('sha256').update(forgedBytes).digest('hex')}`,
          },
          bytes: forgedBytes,
        }),
      ).resolves.toMatchObject({ outcome: 'refused', reason: 'schema-mismatch' })
      expect(await opened.session.stateHash()).toEqual(before)
    } finally {
      await close(opened)
    }
  })

  it('rejects canonical schema forgeries and semantically equal noncanonical key order', async () => {
    const opened = await openPlayable('schema-forgeries')
    try {
      await issueScenario(opened.session)
      await expect(opened.session.step(4)).resolves.toMatchObject({ outcome: 'stepped' })
      const original = await captured(opened.session)
      const baselineHash = await opened.session.stateHash()
      const base = JSON.parse(new TextDecoder().decode(original.bytes)) as Record<string, unknown>

      const invalidOrder = structuredClone(base)
      requiredUnit(invalidOrder, 'unit1').orderQueue = [{ kind: 'attack', x: 1, y: 0 }]

      const catalogMismatch = structuredClone(base)
      requiredUnit(catalogMismatch, 'unit1').speed = 99

      const invalidUnitId = structuredClone(base)
      const invalidUnits = unitRecords(invalidUnitId)
      invalidUnits.unit7 = { ...requiredUnit(invalidUnitId, 'unit1'), id: 'unit7' }
      delete invalidUnits.unit1
      invalidUnitId.nextId = 8

      for (const forged of [invalidOrder, catalogMismatch, invalidUnitId]) {
        await expect(
          opened.session.restore(snapshotFromText(original, canonicalJsonStringify(forged))),
        ).resolves.toMatchObject({ outcome: 'refused', reason: 'schema-mismatch' })
        expect(await opened.session.stateHash()).toEqual(baselineHash)
      }

      const reordered = Object.fromEntries(Object.entries(base).reverse())
      await expect(
        opened.session.restore(
          snapshotFromText(original, `${JSON.stringify(reordered, null, 2)}\n`),
        ),
      ).resolves.toMatchObject({ outcome: 'refused', reason: 'schema-mismatch' })
      expect(await opened.session.stateHash()).toEqual(baselineHash)
    } finally {
      await close(opened)
    }
  })

  it('restores at tick four and reproduces the exact continuation state and event stream', async () => {
    const opened = await openPlayable('restore')
    try {
      await issueScenario(opened.session)
      await expect(opened.session.step(4)).resolves.toMatchObject({ outcome: 'stepped' })
      const checkpoint = await captured(opened.session)
      await expect(opened.session.step(5)).resolves.toMatchObject({ outcome: 'stepped' })
      const expectedState = await opened.session.stateHash()
      const expectedEvents = semanticEvents(await collectEvents(opened.session)).filter(
        event => event.tick > 4,
      )
      await expect(opened.session.restore(checkpoint)).resolves.toMatchObject({
        outcome: 'restored',
      })
      await expect(opened.session.step(5)).resolves.toMatchObject({ outcome: 'stepped' })
      expect(await opened.session.stateHash()).toEqual(expectedState)
      expect(
        semanticEvents(await collectEvents(opened.session)).filter(event => event.tick > 4),
      ).toEqual(expectedEvents)
    } finally {
      await close(opened)
    }
  })

  it('matches the sealed legacy SimEngine on the declared state and event projection', async () => {
    const oracle = await runSealedLegacyPlayableOracle()
    const opened = await openPlayable('legacy-differential')
    try {
      await issueScenario(opened.session)
      await expect(opened.session.step(4)).resolves.toMatchObject({ outcome: 'stepped' })
      const checkpoint = await captured(opened.session)
      await expect(opened.session.step(5)).resolves.toMatchObject({ outcome: 'stepped' })
      const finalSnapshot = await captured(opened.session)
      const finalEvents = semanticEvents(await collectEvents(opened.session))
      expect(hashProjection(stateProjection(finalSnapshot))).toBe(oracle.stateHash)
      expect(hashProjection(finalEvents)).toBe(oracle.eventHash)
      await expect(opened.session.restore(checkpoint)).resolves.toMatchObject({
        outcome: 'restored',
      })
      await expect(opened.session.step(5)).resolves.toMatchObject({ outcome: 'stepped' })
      expect(hashProjection(stateProjection(await captured(opened.session)))).toBe(
        oracle.continuationStateHash,
      )
      expect(
        hashProjection(
          semanticEvents(await collectEvents(opened.session)).filter(event => event.tick > 4),
        ),
      ).toBe(oracle.continuationEventHash)
      expect(oracle.continuationEventHash).toBe(oracle.expectedContinuationEventHash)
      expect(oracle.differentialScope).toEqual([
        'tick',
        'time',
        'randomSeed',
        'pending-command-envelopes',
        'unit.identity-owner-alive-position-life-speed-food-order',
        'SimUnitArrived.tick-type-payload',
      ])
    } finally {
      await close(opened)
    }
  }, 60_000)
})
