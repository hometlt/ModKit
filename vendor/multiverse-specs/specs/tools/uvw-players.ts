/** Authored UVW player identities. No allocation, AI or native-game inference. */
import { encodeCanonicalValue } from './uv-value.mjs'

export interface UvwPlayer {
  readonly slot: number
  readonly address: string
  readonly name?: string
  readonly color?: readonly number[]
  readonly ramp?: readonly (readonly number[])[]
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
function refuse(rule: string, message: string): never { throw new TypeError(`${rule}: ${message}`) }
const rgb = (value: unknown): boolean => Array.isArray(value) && value.length === 3
  && value.every(channel => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1)

/** Both the spatial profile and glTF graph use these cross-field joins. */
export function assertUvwPlayers(space: Record<string, unknown>): void {
  const slots = new Set<number>(), addresses = new Set<string>()
  const declared = Object.hasOwn(space, 'players')
  if (declared) {
    if (!Array.isArray(space['players']) || space['players'].length > 65536)
      refuse('uvw-player-table', 'players must be a bounded array')
    for (const player of space['players'] as unknown[]) {
      if (!object(player) || Object.keys(player).some(key => !['slot', 'address', 'name', 'color', 'ramp'].includes(key))
          || typeof player['slot'] !== 'number' || !Number.isInteger(player['slot'])
          || player['slot'] < -2147483648 || player['slot'] > 2147483647
          || typeof player['address'] !== 'string' || !player['address']
          || player['address'].trim() !== player['address'] || player['address'].includes('\0'))
        refuse('uvw-player-table', 'each player needs a signed native slot and a nonempty portable address')
      const slot = player['slot'] as number, address = player['address'] as string
      try { encodeCanonicalValue({ type: 'strref', value: address }) }
      catch { refuse('uvw-player-address', 'player address exceeds the canonical UTF-8 string budget') }
      if (slots.has(slot) || addresses.has(address))
        refuse('uvw-player-duplicate', 'slots and addresses must be unique within one space')
      slots.add(slot); addresses.add(address)
      if (player['name'] !== undefined && (typeof player['name'] !== 'string' || !player['name']))
        refuse('uvw-player-name', 'player name must be nonempty text')
      if (player['color'] !== undefined && !rgb(player['color']))
        refuse('uvw-player-color', 'player color is linear RGB in 0..1')
      if (player['ramp'] !== undefined && (!Array.isArray(player['ramp']) || !player['ramp'].length
          || player['ramp'].length > 65536 || !player['ramp'].every(rgb)))
        refuse('uvw-player-ramp', 'player ramp contains 1..65536 exact linear RGB shades')
    }
  }
  const starts = space['startPositions']
  if (starts !== undefined) {
    if (!Array.isArray(starts) || starts.length > 65536)
      refuse('uvw-start-positions', 'start positions must be a bounded array')
    const ids = new Set<string>()
    for (const start of starts as unknown[]) {
      if (!object(start) || Object.keys(start).some(key => !['id', 'position', 'player'].includes(key))
          || typeof start['id'] !== 'string' || !start['id'] || ids.has(start['id'])
          || !Array.isArray(start['position']) || start['position'].length !== 3
          || !start['position'].every(value => typeof value === 'number' && Number.isFinite(value)))
        refuse('uvw-start-positions', 'start positions need unique IDs and finite local vec3 positions')
      ids.add(start['id'] as string)
      if (start['player'] !== undefined && (!declared || !slots.has(start['player'] as number)))
        refuse('uvw-player-slot', 'start position refers to an undeclared player slot')
    }
  }
  if (declared && Array.isArray(space['layers'])) for (const layer of space['layers']) {
    if (!object(layer) || layer['kind'] !== 'objects' || !Array.isArray(layer['instances'])) continue
    for (const instance of layer['instances']) if (object(instance) && instance['player'] !== undefined
        && !slots.has(instance['player'] as number))
      refuse('uvw-player-slot', 'object instance refers to an undeclared player slot')
  }
}

/** World instances qualify the space; explicit player addresses remain global identities. */
export function projectUvwPlayers(spaces: readonly { readonly address: string; readonly space: Record<string, unknown> }[]) {
  let declared = false
  const addresses = new Set<string>()
  const bindings: Readonly<{ space: string; player: UvwPlayer }>[] = []
  for (const row of spaces) {
    assertUvwPlayers(row.space)
    if (!Object.hasOwn(row.space, 'players')) continue
    declared = true
    for (const player of row.space['players'] as unknown as readonly UvwPlayer[]) {
      addresses.add(player.address)
      bindings.push(Object.freeze({ space: row.address, player }))
    }
  }
  return { declared, addresses: [...addresses].sort(), bindings }
}

/** Legacy worlds may use explicit setup; published tables cannot be replaced or extended. */
export function resolveUvwPlayerAddresses(roster: { readonly declared: boolean; readonly addresses: readonly string[] },
  provided?: readonly string[]): readonly string[] {
  if (provided === undefined) return roster.addresses
  if (roster.declared) {
    const wanted = new Set(provided)
    if (wanted.size !== provided.length || wanted.size !== roster.addresses.length
        || roster.addresses.some(address => !wanted.has(address)))
      refuse('uvw-player-roster', 'Runtime setup must match the captured UVW player identities')
  }
  return provided
}
