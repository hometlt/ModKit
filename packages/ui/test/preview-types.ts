import type { CodecPreviewOptions, PreviewSession } from '../src/explorer/preview.js'

type AssertFalse<Value extends false> = Value

/** Compile gate: the UI preview API must not regain its direct codec-instantiation path. */
export type CodecPreviewHasNoFormats = AssertFalse<
  'formats' extends keyof CodecPreviewOptions ? true : false
>
export type CodecPreviewHasNoCreateCodec = AssertFalse<
  'createCodec' extends keyof CodecPreviewOptions ? true : false
>
export type CodecPreviewHasNoPrivateBudget = AssertFalse<
  'maximumBytes' extends keyof CodecPreviewOptions ? true : false
>

export const hostOwnedPreviewOptions = {
  stages: [],
  async openSession() {
    return undefined
  },
} satisfies CodecPreviewOptions

export const sessionScopedSubjectNavigation = {
  descriptor: async () => ({}),
  dataSource: async () => ({ value: {} }),
  subjectNavigation: {
    scope: {
      sessionId: 'fixture-session',
      subject: 'x3-subject:fixture',
      workspace: 'fixture-workspace',
    },
    async open() {
      return { state: 'opened' as const }
    },
  },
  dispose: async () => undefined,
} satisfies PreviewSession
