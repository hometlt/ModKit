import { RUNTIME_PROVIDER_CONTRACT, RUNTIME_SESSION_CONTRACT } from '@modkitx-x3/sdk/runtime'

let createSessionCalls = 0

export function resetCreateSessionCalls() {
  createSessionCalls = 0
}

export function getCreateSessionCalls() {
  return createSessionCalls
}

export const abiVersion = 1
export const provides = Object.freeze([RUNTIME_PROVIDER_CONTRACT])

export function createProvider() {
  return Object.freeze({
    value: Object.freeze({
      contract: RUNTIME_PROVIDER_CONTRACT,
      providerId: 'org.modkitx.test/runtime-provider-boundaries',
      runtimeIds: Object.freeze(['test.boundary']),
      async createSession(request) {
        createSessionCalls += 1
        const session = Object.freeze({
          contract: RUNTIME_SESSION_CONTRACT,
          sessionId: request.sessionId,
          providerId: 'org.modkitx.test/runtime-provider-boundaries',
          budget: request.budget,
          async execute() {
            return Object.freeze({
              state: 'completed',
              usage: Object.freeze({ wallTimeMs: 0, ticks: 0, memoryBytes: 0 }),
              diagnostics: Object.freeze([]),
            })
          },
          async status() {
            return Object.freeze({ state: 'ready', executions: 0, ticks: 0, memoryBytes: 0 })
          },
        })
        return Object.freeze({ value: session, release: async () => undefined })
      },
    }),
    release: async () => undefined,
  })
}
