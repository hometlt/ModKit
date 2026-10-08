import test from 'node:test'
import assert from 'node:assert/strict'
import { jenkinsLookup2 } from '../dist/checksum/index.js'

const text = value => new TextEncoder().encode(value)

// RGD key names and their hashes from Corsix's Mod Studio dictionary (RGD_DIC.TXT): every tail
// length from 1 to 11, a whole 12-byte block, and blocks with tails.
const DICTIONARY = [
  ['7', 0x14d0d63a],
  ['95', 0x07312d38],
  ['has', 0x021edfda],
  ['race', 0x07966cdd],
  ['title', 0x01bc7c22],
  ['chance', 0x0186f17d],
  ['text_20', 0x00374f54],
  ['Panel218', 0x00b001b9],
  ['Marker115', 0x001acb93],
  ['type_cover', 0x00af0d2d],
  ['unit_type09', 0x001acf7e],
  ['min_distance', 0x010e1c61],
  ['building_info', 0x00a4f8ba],
  ['anim_state_machine_name', 0x0039d973],
  ['ai_special_unit_immobile', 0x0258466d],
  ['melee_nr_attackers_weight', 0x05336dac],
  ['health_meleedamage_received_modifier', 0x0b1e328d],
  ['$REF', 0x49d60fae],
]

test('jenkinsLookup2 hashes RGD key names as the Mod Studio dictionary does', () => {
  for (const [name, hash] of DICTIONARY) assert.equal(jenkinsLookup2(text(name)), hash, name)
})

test('jenkinsLookup2 reads a view over part of a buffer in place', () => {
  const buffer = text('--health_meleedamage_received_modifier')
  assert.equal(jenkinsLookup2(buffer.subarray(2)), 0x0b1e328d)
})
