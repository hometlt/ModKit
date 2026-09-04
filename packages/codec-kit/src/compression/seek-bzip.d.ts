declare module 'seek-bzip' {
  const decoder: {
    decode(
      input: {
        readByte(): number
        read(buffer: Uint8Array, offset: number, length: number): number
      },
      output: { writeByte(byte: number): void },
      multistream?: boolean,
    ): void
  }
  export default decoder
}
