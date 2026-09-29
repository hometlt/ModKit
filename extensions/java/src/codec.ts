/** `modkit/java-class`: a JVM class file — header, pool, fields, methods and a bytecode listing. */

import {
  createInspectionCodec,
  createTreeDataSource,
  type InspectionCodecDefinition,
} from '@modkit/codec-kit'
import type { ContributionContext } from '@modkit/sdk'
import { classListing } from './bytecode.js'
import { CLASS_MAGIC, javaRelease, parseClassFile, type ClassMember } from './class-file.js'

const ID = 'modkit/java-class'

/**
 * `CAFEBABE` also opens a Mach-O universal binary, whose next word is a small architecture count;
 * a class file carries its major version there (45 and up).
 */
function plausible(prefix: Uint8Array): boolean {
  if (prefix.byteLength < 8) return false
  const view = new DataView(prefix.buffer, prefix.byteOffset, 8)
  const major = view.getUint16(6)
  return view.getUint32(0) === CLASS_MAGIC && major >= 45 && major < 256
}

const memberNode = (member: ClassMember, method: boolean) => ({
  kind: method ? 'method' : 'field',
  label: `${member.name}${method ? '' : ': '}${member.descriptor}`,
  preview: method
    ? member.code === undefined
      ? 'no code'
      : `${member.code.code.byteLength} bytes of bytecode`
    : member.constantValueIndex === undefined
      ? 'field'
      : 'constant',
})

const definition: InspectionCodecDefinition = Object.freeze({
  id: ID,
  format: Object.freeze({
    id: 'java-class',
    label: 'JVM class file',
    mediaType: 'application/java-vm',
  }),
  async detect(prefix: Uint8Array) {
    return plausible(prefix)
      ? { confidence: 0.98, kind: 'magic' as const, note: 'cafebabe-class' }
      : { confidence: 0, kind: 'magic' as const, note: 'signature-mismatch' }
  },
  async inspect(bytes: Uint8Array) {
    const file = parseClassFile(bytes)
    const release = javaRelease(file.majorVersion)
    const withCode = file.methods.filter(method => method.code !== undefined).length
    return {
      summary: {
        format: 'java-class',
        className: file.thisClass,
        superClass: file.superClass ?? null,
        release,
        fields: file.fields.length,
        methods: file.methods.length,
      },
      metadata: [
        {
          id: 'java-class',
          label: 'JVM class file',
          entries: [
            { key: 'class', value: file.thisClass },
            { key: 'superClass', value: file.superClass ?? '' },
            { key: 'interfaces', value: file.interfaces.join(', ') },
            { key: 'version', value: `${file.majorVersion}.${file.minorVersion}` },
            { key: 'javaRelease', value: release },
            { key: 'constants', value: file.constantPool.length - 1 },
            { key: 'fields', value: file.fields.length },
            { key: 'methods', value: file.methods.length },
            { key: 'methodsWithCode', value: withCode },
          ],
        },
      ],
      traits: [{ id: 'content.binary', parameters: { bytes: String(bytes.byteLength) } }],
      text: classListing(file),
      dataSources: {
        'common.view/tree-data-source': createTreeDataSource({
          kind: 'class',
          label: file.thisClass,
          preview: `Java ${release}, ${file.fields.length} fields, ${file.methods.length} methods`,
          children: [
            ...file.fields.map(field => memberNode(field, false)),
            ...file.methods.map(method => memberNode(method, true)),
          ],
        }),
      },
      unsupportedFeatures: ['java-decompilation', 'class-writing'],
    }
  },
})

export const abiVersion = 1
export const createCodec = (context: ContributionContext) =>
  createInspectionCodec(definition, context)
