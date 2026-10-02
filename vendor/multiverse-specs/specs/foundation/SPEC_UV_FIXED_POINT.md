# SPEC — UV fixed-point arithmetic (fixed64) 1.0

Status: **normative for the runtime plane** (decided 2026-09-01 by the orchestrator to close
the gap the independent review named: ADR-RUNTIME-001 required a power-of-two denominator
and deferred the scale to a kernel specification that did not exist). Every family that
carries `fixed64` — UVD, UVS, UVB, UVC carryover, intrinsics, save/replay, receipts — means
THIS type.

## 1. Representation

- `fixed64` is a signed 64-bit integer `q` denoting the rational `q / 2^32` — **Q32.32**.
- Range: `[-2^31, 2^31)` in whole units; resolution `2^-32 ≈ 2.3e-10`.
- Serialisation everywhere (canonical JSON, UVB constants, save sections) is the integer
  quantum `q`, never a decimal string of the rational. A decimal that a game catalog
  publishes is quantised on lowering, and the quantisation is recorded (§4).

## 2. Arithmetic (normative for every conforming interpreter)

| Operation | Definition | On overflow / invalid |
|---|---|---|
| `add.fx`, `sub.fx` | integer add/sub of quanta | typed runtime error `fx-overflow` |
| `mul.fx` | `(a · b) >> 32` computed in a 128-bit intermediate, arithmetic shift (floor toward −∞) | `fx-overflow` if the result leaves the i64 range |
| `div.fx` | `(a << 32) / b` in a 128-bit intermediate, quotient truncated toward zero | `fx-div-by-zero` when `b = 0`; `fx-overflow` when the quotient leaves i64 |
| `i64` ops | two's-complement without wrapping | `i64-overflow`; `i64-div-by-zero` |

There is no saturating or wrapping variant in version 1: an overflow is an error the
verifier budgets for and the kernel reports by name, never undefined behaviour, never a
silently wrapped value. Saturating opcodes, if ever wanted, are new opcodes.

Conversions: `fixed.from-int(i) = i << 32` (error on overflow), `fixed.to-int(q) = q >> 32`
(floor), `fixed.trunc(q)` toward zero. Comparison is integer comparison of quanta.

## 3. Randomness

`rng.roll-fixed` returns a quantum uniform in `[0, 2^32)` — the fixed64 value in `[0, 1)`
— drawn from the named stream; no floating point is involved in its derivation.

## 4. Quantisation of decimal sources (lowering and admission rule)

A decimal value `d` from a native catalog becomes `q = round-half-even(d · 2^32)`.
Admission comparisons against a reference that holds decimals (Modkit's resolved values)
are made **at quantum level**: `quantise(reference) == q`. No epsilon exists. The
LoweringReceipt of an adapter names the quantisation rule it applied.

## 5. Why Q32.32 and not Q16.16 or a decimal scale

- A power of two keeps `mul`/`div` exact-shift operations and matches ADR-RUNTIME-001.
- Q32.32 round-trips any decimal with ≤ 9 fractional digits when printed at that precision,
  which covers every catalog value observed in SC2 and Warzone; Q16.16 (the phase-1 spike's
  toy choice) would not.
- A decimal scale (10^4) would have violated the ADR and made `mul.fx` a division.
- The 128-bit intermediate costs a few instructions per multiply; determinism is not
  affected by it, only throughput, which stage 13 measures.

## 6. Deterministic turn trigonometry (2026-10-01)

`math.sin-turns@1` and `math.cos-turns@1` take `fixed64` turns and return a
`fixed64` sine or cosine. One turn is exactly `2^32` input quanta. The full signed
input domain is admitted: range reduction uses Euclidean remainder by `2^32`,
not approximate radians or host floating point. They read/write no State and
use the registry's existing `read` capability class. The common Luau APIs are
`mv.math.sinTurns(angle)` and `mv.math.cosTurns(angle)`.

This executable profile uses the integer rotation algorithm described by
[Volder, 1959](https://www.ece.ucdavis.edu/~vojin/CLASSES/EPFL/Papers/3-Volder_CORDIC.pdf),
with the following normative bit-level rules; no source implementation is copied:

1. Reduce to a quadrant of `2^30` input quanta. Reflect its offset about the
   eighth turn when the offset exceeds `2^29`. At offset zero return `(sin,cos)`
   exactly `(0,2^32)` before quadrant reconstruction.
2. Work in i128 Q62 coordinates and Q62 turns. Initialize `x=GAIN,y=0` and
   `z=offset<<30`. `GAIN` and the 48 angles in
   [`trig_constants.rs`](../../runtime/kernel/src/trig_constants.rs) are reproduced
   by [`uv-trig-constants.ts`](../tools/uv-trig-constants.ts): 100-decimal-place
   integer atan series, Machin's pi identity, nearest-half-even angle rounding,
   and integer square-root rounding of the exact reciprocal gain product.
3. For indices 0..47, choose `d=+1` when `z>=0`, otherwise `−1`. Simultaneously
   assign `x'=x−d*(y>>i), y'=y+d*(x>>i), z'=z−d*ANGLES[i]`. Shifts are arithmetic.
4. Round coordinates from Q62 to Q32.32 with nearest-half-even on absolute
   magnitude, then restore the sign. Swap sine/cosine after reflection; apply
   the quadrant sign/swap to the pair. Period and odd/even symmetries are exact.

These steps and the checked constants define deterministic outputs, not a host
libm implementation or a claim of correctly rounding every mathematical sine.
The 48 rotations use constant bounded work; Node/Chrome share the exact bytes.
The independent presentation oracle and golden cardinal/octant cases check the
observed output error within one Q32.32 quantum. A changed output algorithm
requires a new intrinsic version rather than changing these semantics silently.

The typed source compiler maps `/` on explicit `i64`/`fixed64` operands to the
existing `div.i64`/`div.fx` instructions (§2), including zero/overflow refusals.
Thus a degree value can be explicitly divided by `Fixed(360)` before a turn
intrinsic. No implicit SC2 native fixed quantization, angle convention, model
correction, or turn-rate policy is introduced by this operation.
