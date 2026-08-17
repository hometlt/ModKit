import type { Architecture, OperatingSystem, RuntimeTargetBase } from '@modkitx-x3/sdk'

function operatingSystem(): Exclude<OperatingSystem, 'any'> {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'darwin'
  return 'linux'
}

function architecture(): Exclude<Architecture, 'any'> {
  if (process.arch === 'ia32') return 'x86'
  if (process.arch === 'arm') return 'arm32'
  if (process.arch === 'arm64') return 'arm64'
  return 'x64'
}

export function nodeRuntimeTargetBase(): RuntimeTargetBase {
  return Object.freeze({
    environment: 'node',
    operatingSystem: operatingSystem(),
    architecture: architecture(),
  })
}
