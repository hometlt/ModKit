/** Reject misspelled acceptance flags rather than falling back to a weaker check. */
export function parseFlags(args, values, switches = []) {
  const result = new Map()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if ((!values.includes(flag) && !switches.includes(flag)) || result.has(flag))
      throw new Error(`unknown or duplicate option: ${flag}`)
    if (switches.includes(flag)) result.set(flag, true)
    else {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`missing ${flag} value`)
      result.set(flag, value)
    }
  }
  return result
}

export function requiredFlag(flags, name) {
  const value = flags.get(name)
  if (typeof value !== 'string') throw new Error(`required ${name}`)
  return value
}
