import assert from 'node:assert/strict'
import { test } from 'node:test'
import { quantizeFixed64Decimal as quantize } from './uv-fixed-point.mjs'

test('native decimals use exact Q32.32 half-even, including negative ties', () => {
  assert.equal(quantize('0'), '0')
  assert.equal(quantize('-0.0'), '0')
  assert.equal(quantize('2.25'), '9663676416')
  assert.equal(quantize('-2.25'), '-9663676416')
  assert.equal(quantize('1e-1'), '429496730')
  assert.equal(quantize('1.16415321826934814453125e-10'), '0') // 0.5 quantum
  assert.equal(quantize('3.49245965480804443359375e-10'), '2') // 1.5 quanta
  assert.equal(quantize('-3.49245965480804443359375e-10'), '-2')
  assert.equal(quantize('2147483647.99999999976716935634613037109375'), '9223372036854775807')
  assert.equal(quantize('-2147483648'), '-9223372036854775808')
})

test('invalid native values and out-of-range quanta refuse without floating-point coercion', () => {
  for (const source of ['NaN', 'Infinity', '', '1,2', '0x10', '1e999', '0e257', '2147483648', '-2147483648.00000000023283064365386962890625']) {
    assert.throws(() => quantize(source), { name: /^(TypeError|RangeError)$/ })
  }
  assert.throws(() => quantize(0.1), TypeError)
})
