import {
  crc32
} from "./chunk-NRZAER5X.js";

// packages/codec-kit/dist/container/zip.js
var ZIP_LOCAL = 67324752;
var ZIP_CENTRAL = 33639248;
var ZIP_EOCD = 101010256;
var ZIP64_EOCD = 101075792;
var ZIP64_LOCATOR = 117853008;
var EXTRA_ZIP64 = 1;
var ZIP_FLAG_UTF8_NAMES = 2048;
var MAX_U16 = 65535;
var MAX_U32 = 4294967295;
var DOS_EPOCH_DATE = 33;
var STORED = 0;
var VERSION_STORED = 10;
var VERSION_MADE_BY = 20;
var EMPTY = new Uint8Array(0);
var encoder = new TextEncoder();
function zip64Field(extra) {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let found;
  let at = 0;
  while (at + 4 <= extra.byteLength) {
    const length = view.getUint16(at + 2, true);
    if (at + 4 + length > extra.byteLength)
      throw new TypeError("a ZIP extra field is truncated");
    if (view.getUint16(at, true) === EXTRA_ZIP64) {
      if (found !== void 0)
        throw new TypeError("duplicate ZIP64 extra fields");
      found = at;
    }
    at += 4 + length;
  }
  if (at !== extra.byteLength)
    throw new TypeError("a ZIP extra field is malformed");
  return found;
}
function checkedSize(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("invalid ZIP size or offset");
  return value;
}
function sizeExtra(fields, local) {
  checkedSize(fields.size);
  checkedSize(fields.compressedSize);
  const at = zip64Field(fields.extraBytes);
  if (at !== void 0 && fields.size <= MAX_U32 && fields.compressedSize <= MAX_U32)
    return fields.extraBytes;
  if (fields.size < MAX_U32 && fields.compressedSize < MAX_U32)
    return fields.extraBytes;
  if (at !== void 0)
    throw new TypeError("new ZIP64 sizes require fresh ZIP64 metadata");
  const values = local ? [fields.size, fields.compressedSize] : [
    ...fields.size >= MAX_U32 ? [fields.size] : [],
    ...fields.compressedSize >= MAX_U32 ? [fields.compressedSize] : []
  ];
  const extra = new Uint8Array(fields.extraBytes.byteLength + 4 + values.length * 8);
  extra.set(fields.extraBytes);
  const view = new DataView(extra.buffer);
  const start = fields.extraBytes.byteLength;
  view.setUint16(start, EXTRA_ZIP64, true);
  view.setUint16(start + 2, values.length * 8, true);
  values.forEach((value, index) => view.setBigUint64(start + 4 + index * 8, BigInt(value), true));
  return extra;
}
function headerLengths(...fields) {
  if (fields.some((field) => field.byteLength > MAX_U16))
    throw new RangeError("ZIP name, extra field or comment is too long");
}
function zipLocalHeader(fields) {
  fields = { ...fields, extraBytes: sizeExtra(fields, true) };
  headerLengths(fields.nameBytes, fields.extraBytes);
  const header = new Uint8Array(30 + fields.nameBytes.byteLength + fields.extraBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, ZIP_LOCAL, true);
  view.setUint16(4, fields.size >= MAX_U32 || fields.compressedSize >= MAX_U32 ? Math.max(45, fields.versionNeeded) : fields.versionNeeded, true);
  view.setUint16(6, fields.flags, true);
  view.setUint16(8, fields.method, true);
  view.setUint16(10, fields.dosTime, true);
  view.setUint16(12, fields.dosDate, true);
  view.setUint32(14, fields.crc, true);
  const zip64Sizes = fields.size >= MAX_U32 || fields.compressedSize >= MAX_U32;
  view.setUint32(18, zip64Sizes ? MAX_U32 : fields.compressedSize, true);
  view.setUint32(22, zip64Sizes ? MAX_U32 : fields.size, true);
  view.setUint16(26, fields.nameBytes.byteLength, true);
  view.setUint16(28, fields.extraBytes.byteLength, true);
  header.set(fields.nameBytes, 30);
  header.set(fields.extraBytes, 30 + fields.nameBytes.byteLength);
  return header;
}
function zipCentralRecord(fields) {
  if (fields.localOffset !== void 0 && checkedSize(fields.localOffset) > MAX_U32)
    throw new RangeError("a ZIP central header offset must be a classic value or ZIP64 sentinel");
  fields = { ...fields, extraBytes: sizeExtra(fields, false) };
  headerLengths(fields.nameBytes, fields.extraBytes, fields.commentBytes);
  const nameLength = fields.nameBytes.byteLength;
  const extraLength = fields.extraBytes.byteLength;
  const commentLength = fields.commentBytes.byteLength;
  const record = new Uint8Array(46 + nameLength + extraLength + commentLength);
  const view = new DataView(record.buffer);
  view.setUint32(0, ZIP_CENTRAL, true);
  view.setUint16(4, fields.versionMadeBy, true);
  view.setUint16(6, fields.size >= MAX_U32 || fields.compressedSize >= MAX_U32 ? Math.max(45, fields.versionNeeded) : fields.versionNeeded, true);
  view.setUint16(8, fields.flags, true);
  view.setUint16(10, fields.method, true);
  view.setUint16(12, fields.dosTime, true);
  view.setUint16(14, fields.dosDate, true);
  view.setUint32(16, fields.crc, true);
  view.setUint32(20, Math.min(MAX_U32, fields.compressedSize), true);
  view.setUint32(24, Math.min(MAX_U32, fields.size), true);
  view.setUint16(28, nameLength, true);
  view.setUint16(30, extraLength, true);
  view.setUint16(32, commentLength, true);
  view.setUint16(34, fields.diskStart, true);
  view.setUint16(36, fields.internalAttributes, true);
  view.setUint32(38, fields.externalAttributes, true);
  view.setUint32(42, fields.localOffset ?? 0, true);
  record.set(fields.nameBytes, 46);
  record.set(fields.extraBytes, 46 + nameLength);
  record.set(fields.commentBytes, 46 + nameLength + extraLength);
  return record;
}
function zipEntryName(name) {
  const nameBytes = encoder.encode(name);
  if (nameBytes.byteLength === 0)
    throw new TypeError("a ZIP entry path cannot be empty");
  if (nameBytes.byteLength > MAX_U16)
    throw new RangeError(`the ZIP entry path \xAB${name}\xBB is too long`);
  return nameBytes;
}
var zipNeedsUtf8Flag = (nameBytes) => nameBytes.some((byte) => byte >= 128);
function zipStoredEntry(name, data) {
  const directory = name.endsWith("/");
  if (directory && data.byteLength > 0)
    throw new TypeError(`\xAB${name}\xBB is a directory entry and carries no bytes`);
  const nameBytes = zipEntryName(name);
  const shared = {
    versionNeeded: VERSION_STORED,
    flags: zipNeedsUtf8Flag(nameBytes) ? ZIP_FLAG_UTF8_NAMES : 0,
    method: STORED,
    dosTime: 0,
    dosDate: DOS_EPOCH_DATE,
    crc: directory ? 0 : crc32(data),
    compressedSize: data.byteLength,
    size: data.byteLength,
    nameBytes,
    extraBytes: EMPTY
  };
  return Object.freeze({
    name,
    local: Object.freeze([zipLocalHeader(shared), data]),
    central: zipCentralRecord({
      ...shared,
      versionMadeBy: VERSION_MADE_BY,
      diskStart: 0,
      internalAttributes: 0,
      externalAttributes: directory ? 16 : 0,
      commentBytes: EMPTY
    })
  });
}
function assembleZipArchive(entries, comment, budget, forceZip64 = false, zip64EndRecord) {
  headerLengths(comment);
  if (zip64EndRecord !== void 0) {
    const view2 = new DataView(zip64EndRecord.buffer, zip64EndRecord.byteOffset, zip64EndRecord.byteLength);
    if (zip64EndRecord.byteLength !== 56 || view2.getUint32(0, true) !== ZIP64_EOCD || view2.getBigUint64(4, true) !== 44n || view2.getUint32(16, true) !== 0 || view2.getUint32(20, true) !== 0)
      throw new TypeError("unsupported ZIP64 end record");
  }
  if (entries.length > budget.maxNodes) {
    throw new RangeError("the archive exceeds the maxNodes budget");
  }
  let localTotal = 0;
  let centralTotal = 0;
  const centrals = [];
  let zip64 = forceZip64 || zip64EndRecord !== void 0 || entries.length >= MAX_U16;
  for (const item of entries) {
    const central = centralAtOffset(item.central, localTotal);
    centrals.push(central);
    const view2 = new DataView(central.buffer);
    const extraAt = 46 + view2.getUint16(28, true);
    if (zip64Field(central.subarray(extraAt, extraAt + view2.getUint16(30, true))) !== void 0)
      zip64 = true;
    for (const part of item.local)
      localTotal += part.byteLength;
    checkedSize(localTotal);
    centralTotal += central.byteLength;
  }
  zip64 ||= localTotal >= MAX_U32 || centralTotal >= MAX_U32;
  const total = checkedSize(localTotal + centralTotal + (zip64 ? 76 : 0) + 22 + comment.byteLength);
  if (BigInt(total) > budget.maxInputBytes) {
    throw new RangeError("the archive exceeds the maxInputBytes budget");
  }
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const item of entries) {
    for (const part of item.local) {
      out.set(part, cursor);
      cursor += part.byteLength;
    }
  }
  const centralStart = cursor;
  for (const central of centrals) {
    out.set(central, cursor);
    cursor += central.byteLength;
  }
  const view = new DataView(out.buffer);
  if (zip64) {
    const recordOffset = cursor;
    if (zip64EndRecord !== void 0)
      out.set(zip64EndRecord, cursor);
    view.setUint32(cursor, ZIP64_EOCD, true);
    view.setBigUint64(cursor + 4, 44n, true);
    if (zip64EndRecord === void 0) {
      view.setUint16(cursor + 12, 45, true);
      view.setUint16(cursor + 14, 45, true);
    }
    view.setBigUint64(cursor + 24, BigInt(entries.length), true);
    view.setBigUint64(cursor + 32, BigInt(entries.length), true);
    view.setBigUint64(cursor + 40, BigInt(centralTotal), true);
    view.setBigUint64(cursor + 48, BigInt(centralStart), true);
    cursor += 56;
    view.setUint32(cursor, ZIP64_LOCATOR, true);
    view.setBigUint64(cursor + 8, BigInt(recordOffset), true);
    view.setUint32(cursor + 16, 1, true);
    cursor += 20;
  }
  view.setUint32(cursor, ZIP_EOCD, true);
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, Math.min(MAX_U16, entries.length), true);
  view.setUint16(cursor + 10, Math.min(MAX_U16, entries.length), true);
  view.setUint32(cursor + 12, Math.min(MAX_U32, centralTotal), true);
  view.setUint32(cursor + 16, Math.min(MAX_U32, centralStart), true);
  view.setUint16(cursor + 20, comment.byteLength, true);
  out.set(comment, cursor + 22);
  return out;
}
function centralAtOffset(record, offset) {
  checkedSize(offset);
  const result = record.slice();
  const view = new DataView(result.buffer);
  if (result.byteLength < 46 || view.getUint32(0, true) !== ZIP_CENTRAL)
    throw new TypeError("invalid ZIP central record");
  const nameEnd = 46 + view.getUint16(28, true);
  const extraEnd = nameEnd + view.getUint16(30, true);
  if (extraEnd + view.getUint16(32, true) !== result.byteLength)
    throw new TypeError("invalid ZIP central record length");
  const extra = result.subarray(nameEnd, extraEnd);
  const field = zip64Field(extra);
  if (view.getUint16(34, true) !== 0)
    throw new TypeError("multi-disk ZIP is unsupported");
  const saturated = view.getUint32(42, true) === MAX_U32;
  if (saturated) {
    if (field === void 0)
      throw new TypeError("ZIP64 offset extra is missing");
    const sizeBytes = (view.getUint32(24, true) === MAX_U32 ? 8 : 0) + (view.getUint32(20, true) === MAX_U32 ? 8 : 0);
    if (view.getUint16(nameEnd + field + 2, true) < sizeBytes + 8)
      throw new TypeError("ZIP64 offset extra is truncated");
    view.setBigUint64(nameEnd + field + 4 + sizeBytes, BigInt(offset), true);
  } else if (offset >= MAX_U32) {
    const insert = field === void 0 ? extraEnd : nameEnd + field + 4 + view.getUint16(nameEnd + field + 2, true);
    const added = field === void 0 ? 12 : 8;
    if (extra.byteLength + added > MAX_U16)
      throw new RangeError("ZIP64 extra field is too long");
    const expanded = new Uint8Array(result.byteLength + added);
    expanded.set(result.subarray(0, insert));
    expanded.set(result.subarray(insert), insert + added);
    const ev = new DataView(expanded.buffer);
    if (field === void 0) {
      ev.setUint16(insert, EXTRA_ZIP64, true);
      ev.setUint16(insert + 2, 8, true);
    } else
      ev.setUint16(nameEnd + field + 2, view.getUint16(nameEnd + field + 2, true) + 8, true);
    ev.setBigUint64(insert + (field === void 0 ? 4 : 0), BigInt(offset), true);
    ev.setUint16(30, extra.byteLength + added, true);
    ev.setUint16(6, Math.max(45, ev.getUint16(6, true)), true);
    ev.setUint32(42, MAX_U32, true);
    return expanded;
  } else
    view.setUint32(42, offset, true);
  return result;
}
function createZipArchive(files, budget) {
  const seen = /* @__PURE__ */ new Set();
  const entries = [];
  for (const [name, data] of files) {
    if (seen.has(name))
      throw new TypeError(`\xAB${name}\xBB would be in the archive twice`);
    seen.add(name);
    entries.push(zipStoredEntry(name, data));
  }
  return assembleZipArchive(entries, EMPTY, budget);
}

export {
  ZIP_FLAG_UTF8_NAMES,
  zipLocalHeader,
  zipCentralRecord,
  zipEntryName,
  zipNeedsUtf8Flag,
  zipStoredEntry,
  assembleZipArchive,
  createZipArchive
};
