import {
  crc32c
} from "../../../chunks/chunk-NRZAER5X.js";
import "../../../chunks/chunk-UCBII6KW.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/storage/leveldb.js
var TABLE_MAGIC = [87, 251, 128, 139, 36, 117, 71, 219];
var FOOTER_BYTES = 48;
var BLOCK_TRAILER_BYTES = 5;
var LOG_BLOCK_BYTES = 32768;
var LOG_HEADER_BYTES = 7;
function corrupt(message) {
  return new TypeError(`LevelDB ${message}`);
}
function unmask(masked) {
  const rotated = masked - 2726488792 >>> 0;
  return (rotated >>> 17 | rotated << 15) >>> 0;
}
var u32 = (bytes, at) => ((bytes[at] ?? 0) | (bytes[at + 1] ?? 0) << 8 | (bytes[at + 2] ?? 0) << 16) + (bytes[at + 3] ?? 0) * 16777216;
var Reader = class {
  bytes;
  at;
  end;
  constructor(bytes, at = 0, end = bytes.byteLength) {
    this.bytes = bytes;
    this.at = at;
    this.end = end;
  }
  get done() {
    return this.at >= this.end;
  }
  byte() {
    if (this.at >= this.end)
      throw corrupt("record is truncated");
    return this.bytes[this.at++] ?? 0;
  }
  /** A varint of up to 64 bits, within safe integers. */
  varint() {
    let value = 0;
    for (let shift = 0; shift < 64; shift += 7) {
      const byte = this.byte();
      value += (byte & 127) * 2 ** shift;
      if ((byte & 128) === 0) {
        if (!Number.isSafeInteger(value))
          throw corrupt("varint exceeds safe integers");
        return value;
      }
    }
    throw corrupt("varint is too long");
  }
  take(length) {
    if (length < 0 || this.at + length > this.end)
      throw corrupt("record is truncated");
    const value = this.bytes.subarray(this.at, this.at + length);
    this.at += length;
    return value;
  }
  lengthPrefixed() {
    return this.take(this.varint());
  }
};
function logRecords(bytes, tolerateTail) {
  const records = [];
  let pending;
  for (let block = 0; block < bytes.byteLength; block += LOG_BLOCK_BYTES) {
    const end = Math.min(bytes.byteLength, block + LOG_BLOCK_BYTES);
    let at = block;
    while (end - at >= LOG_HEADER_BYTES) {
      const length = (bytes[at + 4] ?? 0) | (bytes[at + 5] ?? 0) << 8;
      const type = bytes[at + 6] ?? 0;
      if (type === 0 && length === 0)
        break;
      const dataEnd = at + LOG_HEADER_BYTES + length;
      const valid = type >= 1 && type <= 4 && dataEnd <= end && unmask(u32(bytes, at)) === crc32c(bytes, at + 6, dataEnd);
      if (!valid) {
        if (tolerateTail)
          return records;
        throw corrupt(`log record at ${at} is corrupt`);
      }
      const data = bytes.subarray(at + LOG_HEADER_BYTES, dataEnd);
      if (type === 1) {
        records.push(data);
        pending = void 0;
      } else if (type === 2)
        pending = [data];
      else if (pending !== void 0) {
        pending.push(data);
        if (type === 4) {
          const whole = new Uint8Array(pending.reduce((total, part) => total + part.byteLength, 0));
          let offset = 0;
          for (const part of pending) {
            whole.set(part, offset);
            offset += part.byteLength;
          }
          records.push(whole);
          pending = void 0;
        }
      } else if (!tolerateTail)
        throw corrupt(`log record at ${at} continues nothing`);
      at = dataEnd;
    }
  }
  return records;
}
function currentVersion(manifest) {
  const tables = /* @__PURE__ */ new Map();
  let logNumber = 0;
  let prevLogNumber = 0;
  for (const record of logRecords(manifest, false)) {
    const edit = new Reader(record);
    while (!edit.done) {
      const tag = edit.varint();
      switch (tag) {
        case 1: {
          const comparator = new TextDecoder().decode(edit.lengthPrefixed());
          if (comparator !== "leveldb.BytewiseComparator")
            throw corrupt(`comparator ${comparator} is not supported`);
          break;
        }
        case 2:
          logNumber = edit.varint();
          break;
        case 3:
        // next file number
        case 4:
          edit.varint();
          break;
        case 5:
          edit.varint();
          edit.lengthPrefixed();
          break;
        case 6: {
          const level = edit.varint();
          tables.delete(`${level}:${edit.varint()}`);
          break;
        }
        case 7: {
          const level = edit.varint();
          const number = edit.varint();
          edit.varint();
          edit.lengthPrefixed();
          edit.lengthPrefixed();
          tables.set(`${level}:${number}`, { level, number });
          break;
        }
        case 9:
          prevLogNumber = edit.varint();
          break;
        default:
          throw corrupt(`manifest tag ${tag} is unknown`);
      }
    }
  }
  return { tables: [...tables.values()], logNumber, prevLogNumber };
}
function blockHandle(reader) {
  return { offset: reader.varint(), size: reader.varint() };
}
function* blockEntries(block) {
  if (block.byteLength < 4)
    throw corrupt("block is truncated");
  const restarts = u32(block, block.byteLength - 4);
  const dataEnd = block.byteLength - 4 - restarts * 4;
  if (restarts < 1 || dataEnd < 0)
    throw corrupt("block restart array is invalid");
  const reader = new Reader(block, 0, dataEnd);
  let key = new Uint8Array(0);
  while (!reader.done) {
    const shared = reader.varint();
    const unshared = reader.varint();
    const valueLength = reader.varint();
    if (shared > key.byteLength)
      throw corrupt("block key shares more than the previous key");
    const next = new Uint8Array(shared + unshared);
    next.set(key.subarray(0, shared));
    next.set(reader.take(unshared), shared);
    key = next;
    const valueOffset = reader.at;
    reader.take(valueLength);
    yield { key, valueOffset, valueLength };
  }
}
var latin1 = (bytes) => {
  let out = "";
  for (let at = 0; at < bytes.byteLength; at += 4096)
    out += String.fromCharCode(...bytes.subarray(at, at + 4096));
  return out;
};
var bytesOf = (key) => {
  const bytes = new Uint8Array(key.length);
  for (let at = 0; at < key.length; at += 1)
    bytes[at] = key.charCodeAt(at);
  return bytes;
};
function trailer(key) {
  if (key.byteLength < 8)
    throw corrupt("internal key is shorter than its trailer");
  const at = key.byteLength - 8;
  const low = u32(key, at);
  const high = u32(key, at + 4);
  return {
    user: key.subarray(0, at),
    sequence: high * 2 ** 24 + Math.floor(low / 256),
    type: low & 255
  };
}
async function openLevelDb(directory, options = {}) {
  const maxKeys = options.maxKeys ?? 1e7;
  const maxBlockBytes = options.maxBlockBytes ?? 16 * 1024 * 1024;
  const maxLogBytes = options.maxLogBytes ?? 256 * 1024 * 1024;
  const signal = options.signal;
  const files = new Map((await directory.list(signal)).map((file) => [file.name, file.size]));
  const whole = async (name) => {
    const size = files.get(name);
    if (size === void 0)
      throw corrupt(`${name} is missing`);
    if (size > maxLogBytes)
      throw new RangeError(`LevelDB ${name} exceeds the ${maxLogBytes}-byte budget`);
    return size === 0 ? new Uint8Array(0) : directory.read(name, 0, size, signal);
  };
  if (!files.has("CURRENT"))
    throw corrupt("directory has no CURRENT file");
  const current = new TextDecoder().decode(await whole("CURRENT")).replace(/\r?\n$/u, "");
  if (!/^MANIFEST-\d+$/u.test(current))
    throw corrupt(`CURRENT names ${JSON.stringify(current)}`);
  const version = currentVersion(await whole(current));
  const decoded = /* @__PURE__ */ new Map();
  const readBlock = (file, handle) => {
    const key = `${file}@${handle.offset}`;
    let pending = decoded.get(key);
    if (pending === void 0) {
      pending = decodeBlock(file, handle);
      if (decoded.size >= 16)
        decoded.delete(decoded.keys().next().value);
      decoded.set(key, pending);
      pending.catch(() => decoded.delete(key));
    }
    return pending;
  };
  const decodeBlock = async (file, handle) => {
    const size = files.get(file) ?? 0;
    if (handle.offset + handle.size + BLOCK_TRAILER_BYTES > size)
      throw corrupt(`block of ${file} runs past the file`);
    if (handle.size > maxBlockBytes)
      throw new RangeError(`LevelDB block exceeds the ${maxBlockBytes}-byte budget`);
    const raw = await directory.read(file, handle.offset, handle.size + BLOCK_TRAILER_BYTES, signal);
    const type = raw[handle.size] ?? 0;
    if (unmask(u32(raw, handle.size + 1)) !== crc32c(raw, 0, handle.size + 1))
      throw corrupt(`block at ${handle.offset} of ${file} fails its CRC-32C`);
    const body = raw.subarray(0, handle.size);
    if (type === 0)
      return body;
    if (type !== 2 && type !== 4)
      throw corrupt(`block compression ${type} is not supported`);
    const { decompressBounded } = await import("../compression/bounded.js");
    return decompressBounded(body, type === 2 ? "deflate" : "deflate-raw", {
      maxOutputBytes: maxBlockBytes,
      ...signal === void 0 ? {} : { signal }
    });
  };
  const newest = /* @__PURE__ */ new Map();
  const note = (user, entry) => {
    const key = latin1(user);
    const known = newest.get(key);
    if (known !== void 0 && known.sequence >= entry.sequence)
      return;
    if (known === void 0 && newest.size >= maxKeys)
      throw new RangeError(`LevelDB holds more than ${maxKeys} keys`);
    newest.set(key, entry);
  };
  const tableNames = /* @__PURE__ */ new Map();
  for (const name of files.keys()) {
    const match = /^(\d+)\.(ldb|sst)$/u.exec(name);
    if (match !== null)
      tableNames.set(Number(match[1]), name);
  }
  for (const table of version.tables) {
    signal?.throwIfAborted();
    const file = tableNames.get(table.number);
    if (file === void 0)
      throw corrupt(`live table ${table.number} is missing`);
    const size = files.get(file) ?? 0;
    if (size < FOOTER_BYTES)
      throw corrupt(`table ${file} is shorter than its footer`);
    const footer = await directory.read(file, size - FOOTER_BYTES, FOOTER_BYTES, signal);
    if (!TABLE_MAGIC.every((value, at) => footer[40 + at] === value))
      throw corrupt(`table ${file} has no table magic`);
    const handles = new Reader(footer, 0, 40);
    blockHandle(handles);
    const index = await readBlock(file, blockHandle(handles));
    for (const item of blockEntries(index)) {
      const handle = blockHandle(new Reader(index, item.valueOffset, item.valueOffset + item.valueLength));
      const block = await readBlock(file, handle);
      for (const entry of blockEntries(block)) {
        const { user, sequence, type } = trailer(entry.key);
        note(user, type === 1 ? {
          sequence,
          deleted: false,
          location: {
            kind: "table",
            file,
            block: handle,
            valueOffset: entry.valueOffset,
            valueLength: entry.valueLength
          }
        } : { sequence, deleted: true });
      }
    }
  }
  const logs = [...files.keys()].map((name) => /^(\d+)\.log$/u.exec(name)).filter((match) => match !== null).map((match) => Number(match[1])).filter((number) => number >= version.logNumber || number === version.prevLogNumber).sort((a, b) => a - b);
  for (const number of logs) {
    signal?.throwIfAborted();
    const name = `${String(number).padStart(6, "0")}.log`;
    for (const record of logRecords(await whole(name), true)) {
      const batch = new Reader(record);
      const low = u32(record, 0);
      const high = u32(record, 4);
      batch.take(8);
      let sequence = high * 2 ** 32 + low;
      const count = u32(record, 8);
      batch.take(4);
      for (let index = 0; index < count; index += 1, sequence += 1) {
        const type = batch.byte();
        const user = batch.lengthPrefixed();
        if (type === 1)
          note(user, {
            sequence,
            deleted: false,
            location: { kind: "log", value: batch.lengthPrefixed().slice() }
          });
        else if (type === 0)
          note(user, { sequence, deleted: true });
        else
          throw corrupt(`write batch record type ${type} is unknown`);
      }
    }
  }
  const live = [...newest.entries()].filter(([, entry]) => !entry.deleted).map(([key]) => key);
  live.sort();
  const keys = Object.freeze(live.map(bytesOf));
  const get = async (key, readSignal) => {
    readSignal?.throwIfAborted();
    const location = newest.get(latin1(key))?.location;
    if (location === void 0)
      return void 0;
    if (location.kind === "log")
      return location.value.slice();
    const block = await readBlock(location.file, location.block);
    return block.slice(location.valueOffset, location.valueOffset + location.valueLength);
  };
  return Object.freeze({
    keys,
    get,
    async *entries(prefix = new Uint8Array(0), readSignal) {
      const start = latin1(prefix);
      for (let index = lowerBound(live, start); index < live.length; index += 1) {
        const key = live[index];
        if (!key.startsWith(start))
          break;
        const value = await get(keys[index], readSignal);
        if (value !== void 0)
          yield { key: keys[index], value };
      }
    }
  });
}
function lowerBound(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = low + high >>> 1;
    if (sorted[middle] < value)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}
export {
  openLevelDb
};
