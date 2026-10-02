/** Common material shadow policy. Omitted defaults are interpreted, never written. */
export function assertGltfShadowFlags(gameValue: unknown): void {
  if (!gameValue || typeof gameValue !== 'object' || Array.isArray(gameValue))
    throw new TypeError('material-shadow-flags: expected a game material')
  const game = gameValue as Record<string, unknown>
  for (const name of ['castShadows', 'receiveShadows'])
    if (game[name] !== undefined && typeof game[name] !== 'boolean')
      throw new TypeError(`material-shadow-flags: ${name} must be boolean`)
}
