/**
 * The translation service provider.
 *
 * A codec asks for `common.language/translation@1` and gets this; what it does with the answer — and
 * what it masked before asking — is its own business. That split is the whole point of the module:
 * StarCraft II's localization codec had a working translator with six backends inside it, and every
 * other format with localized text needed the same six.
 *
 * Credentials come from the host, not from the request. A key in an operation input would travel
 * through the same JSON that gets logged, cached and shown in a receipt; the host holds them and
 * this provider is constructed with them.
 */
import { BACKENDS, callBackend } from './backends.js'

const TRANSLATION_CONTRACT = 'common.language/translation'

export const abiVersion = 1
export const provides = Object.freeze([TRANSLATION_CONTRACT])

/** Whether a backend can run with what the host supplied. */
function availability(backend, credentials) {
  if (!backend.requiresCredentials) return true
  const configured = credentials[backend.id]
  return typeof configured?.apiKey === 'string' && configured.apiKey !== ''
}

export function createProvider(selection, context = {}) {
  if (selection.contract !== TRANSLATION_CONTRACT || selection.major !== 1) {
    throw new TypeError(
      `Unsupported translation selection ${selection.contract}@${selection.major}`,
    )
  }
  const credentials = context.credentials ?? {}
  const defaultBackend = context.defaultBackend ?? 'google'
  const fetchImpl = context.fetchImpl

  return Object.freeze({
    value: Object.freeze({
      contract: TRANSLATION_CONTRACT,

      async backends() {
        return Object.freeze(
          BACKENDS.map(backend =>
            Object.freeze({ ...backend, available: availability(backend, credentials) }),
          ),
        )
      },

      async translate(request) {
        const text = typeof request?.text === 'string' ? request.text : undefined
        if (text === undefined) throw new TypeError('translation requires text')
        const sourceLanguage = request.sourceLanguage
        const targetLanguage = request.targetLanguage
        if (typeof sourceLanguage !== 'string' || typeof targetLanguage !== 'string') {
          throw new TypeError('translation requires sourceLanguage and targetLanguage')
        }
        const backend = request.backend ?? defaultBackend
        const known = BACKENDS.find(item => item.id === backend)
        if (known === undefined) throw new TypeError(`unknown translation backend: ${backend}`)
        if (!availability(known, credentials)) {
          throw new TypeError(`${known.label} has no credentials configured`)
        }
        request.signal?.throwIfAborted()

        const translated = await callBackend(backend, text, {
          sourceLanguage,
          targetLanguage,
          ...(request.context === undefined ? {} : { context: request.context }),
          ...(request.key === undefined ? {} : { key: request.key }),
          ...(credentials[backend] ?? {}),
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
        })
        request.signal?.throwIfAborted()
        return Object.freeze({
          text: translated,
          /*
           * Reported rather than left to be inferred. A backend returns the input when it has
           * nothing to translate, and "already in the target language" and "the service declined"
           * are indistinguishable from the text alone.
           */
          changed: translated !== text,
          backend,
        })
      },
    }),
    release: async () => undefined,
  })
}
