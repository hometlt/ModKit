import { describe, expect, it } from 'vitest'
import { OutputArtifacts, OUTPUT_ARTIFACT_POLICY } from '../src/output-artifacts.js'
const provenance = { sourceRevision: 'revision-1', operationId: 'fixture.bytes' }

describe('bounded MCP output resources', () => {
  it('holds input transport quota until its running call releases it, even after subject close', () => {
    const outputs = new OutputArtifacts(true)
    const artifact = outputs.commit(outputs.reserve('owner'), Uint8Array.of(1), provenance)
    const inputs = Array.from({ length: OUTPUT_ARTIFACT_POLICY.maxArtifacts }, () =>
      outputs.input('owner', artifact.id, 'payload', {}),
    )
    expect(() => outputs.input('owner', artifact.id, 'payload', {})).toThrow(/remaining total/u)
    outputs.closeOwner('owner')
    const first = outputs.reserve('another')
    expect(() => outputs.reserve('another')).toThrow(/budget exhausted/u)
    inputs.forEach(input => input.release())
    const second = outputs.reserve('another')
    outputs.cancel(first)
    outputs.cancel(second)
  })
  it('requires host opt-in and reserves worst-case quota before completion', () => {
    expect(() => new OutputArtifacts(false).reserve('owner')).toThrow(/did not enable/u)
    const outputs = new OutputArtifacts(true)
    const first = outputs.reserve('owner'),
      second = outputs.reserve('owner')
    expect(() => outputs.reserve('owner')).toThrow(/budget exhausted/u)
    outputs.cancel(first)
    const replacement = outputs.reserve('owner')
    outputs.cancel(second)
    outputs.cancel(replacement)
    const next = outputs.reserve('owner')
    outputs.commit(next, Uint8Array.of(1), provenance)
    expect(() => outputs.reserve('owner')).not.toThrow()
  })

  it('owns complete bytes and validates chunk boundaries and input ownership', () => {
    const outputs = new OutputArtifacts(true)
    const bytes = new Uint8Array(OUTPUT_ARTIFACT_POLICY.chunkBytes + 3)
    bytes.fill(7)
    const artifact = outputs.commit(outputs.reserve('owner'), bytes, provenance)
    bytes.fill(0)
    const first = outputs.chunk(artifact.id, 0)
    expect(first.bytes).toHaveLength(OUTPUT_ARTIFACT_POLICY.chunkBytes)
    expect(first.bytes[0]).toBe(7)
    expect(first.nextUri).not.toBeNull()
    first.bytes.fill(0)
    expect(outputs.chunk(artifact.id, 0).bytes[0]).toBe(7)
    expect(outputs.chunk(artifact.id, OUTPUT_ARTIFACT_POLICY.chunkBytes).bytes).toEqual(
      Uint8Array.of(7, 7, 7),
    )
    expect(() => outputs.chunk(artifact.id, 1)).toThrow(/aligned range/u)
    expect(() => outputs.input('different-owner', artifact.id, 'payload', {})).toThrow(
      /another subject/u,
    )
    expect(() => outputs.input('owner', artifact.id, '__proto__', {})).toThrow(/reserved/u)
    expect(() => outputs.input('owner', artifact.id, 'payload', { payload: '' })).toThrow(
      /target field absent/u,
    )
    const input = outputs.input('owner', artifact.id, 'payload', { schemaVersion: 1 })
    expect(input.value['payload']).toBe('07'.repeat(bytes.length))
    expect(input.provenance.sha256).toBe(artifact.sha256)
    input.release()
  })

  it('invalidates completed outputs and pending reservations on close', () => {
    const outputs = new OutputArtifacts(true)
    const output = outputs.commit(outputs.reserve('owner'), Uint8Array.of(3), provenance)
    const pending = outputs.reserve('owner')
    outputs.closeOwner('owner')
    expect(() => outputs.manifest(output.id)).toThrow(/closed/u)
    expect(() => outputs.commit(pending, Uint8Array.of(4), provenance)).toThrow(
      /closed or cancelled/u,
    )
    expect(() => outputs.reserve('another')).not.toThrow()
    outputs.dispose()
  })

  it('refuses oversized full output without publishing a prefix', () => {
    const outputs = new OutputArtifacts(true),
      reservation = outputs.reserve('owner')
    expect(() =>
      outputs.commit(
        reservation,
        new Uint8Array(OUTPUT_ARTIFACT_POLICY.maxArtifactBytes + 1),
        provenance,
      ),
    ).toThrow(/complete operation output/u)
    outputs.cancel(reservation)
    expect(() => outputs.reserve('owner')).not.toThrow()
  })
})
