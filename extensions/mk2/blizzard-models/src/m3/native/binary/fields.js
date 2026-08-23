import { PRIMITIVE_FIELD_INFO } from './constants.js'
export class M3FieldBase {
  name
  size = 0
  constructor(name) {
    this.name = name
  }
  fromBuffer() {
    throw new Error('fromBuffer not implemented')
  }
  toBuffer() {
    throw new Error('toBuffer not implemented')
  }
}
export class M3FieldPrimitive extends M3FieldBase {
  type
  defaultValue
  expectedValue
  structInfo
  bitMaskMap
  constructor(name, type, defaultValue = 0, expectedValue = null) {
    super(name)
    this.type = type
    this.defaultValue = defaultValue
    this.expectedValue = expectedValue
    this.structInfo = PRIMITIVE_FIELD_INFO[type]
    this.size = this.structInfo.size
  }
  fromBuffer(data, buffer, offset) {
    const view = new DataView(buffer, offset, this.size)
    const value = view[this.structInfo.getter](0, true)
    if (this.expectedValue !== null && value !== this.expectedValue) {
      console.warn(
        `${data.desc.history.name}V${data.desc.version}.${this.name} expected ${this.expectedValue} but got ${value}`,
      )
    }
    data[this.name] = value
  }
  toBuffer(data, buffer, offset) {
    const view = new DataView(buffer, offset, this.size)
    const setter = view[this.structInfo.setter]
    setter.call(view, 0, data[this.name], true)
  }
}
export class M3FieldBytes extends M3FieldBase {
  defaultValue
  expectedValue
  constructor(name, size, defaultValue, expectedValue = null) {
    super(name)
    this.size = size
    this.defaultValue = defaultValue
    this.expectedValue = expectedValue
  }
  fromBuffer(data, buffer, offset) {
    const bytes = new Uint8Array(buffer, offset, this.size)
    data[this.name] = new Uint8Array(bytes)
  }
  toBuffer(data, buffer, offset) {
    const bytes = data[this.name]
    new Uint8Array(buffer, offset, this.size).set(bytes)
  }
}
export class M3FieldStructure extends M3FieldBase {
  desc
  refTo
  constructor(name, desc, refTo = '') {
    super(name)
    this.desc = desc
    this.size = desc.size
    this.refTo = refTo
  }
  fromBuffer(data, buffer, offset) {
    const nested = this.desc.instance(buffer, offset)
    if (this.refTo) {
      nested.__refTo = this.refTo
    }
    data[this.name] = nested
  }
  toBuffer(data, buffer, offset) {
    const instance = data[this.name]
    if (!instance || typeof instance.toBuffer !== 'function') {
      throw new TypeError(
        `M3 structure ${data.desc.history.name} field ${this.name} requires a structured value.`,
      )
    }
    instance.toBuffer(buffer, offset)
  }
}
