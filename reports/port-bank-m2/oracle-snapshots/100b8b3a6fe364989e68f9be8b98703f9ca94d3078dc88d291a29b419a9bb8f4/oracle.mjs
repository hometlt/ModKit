// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/bank.ts
import { XMLParser } from "file:///C:/FILES/SC2Files/coding/artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/oracle/cache/dependencies/38bf6535c1ad393e8936fb83c922c41ad6adddcfd312f2ad7ad34c15c33fcf37/244b5dde4eaa63f0bb6b66e972a7667067d3d4328c5c1771a470764a157bb592/src/fxp.js";

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/sha1.ts
var HEX = "0123456789abcdef";
function sha1Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const totalBytes = bytes.length + 9 + 63 >> 6 << 6;
  const data = new Uint8Array(totalBytes);
  data.set(bytes);
  data[bytes.length] = 128;
  const view = new DataView(data.buffer);
  const high = Math.floor(bitLength / 4294967296);
  const low = bitLength >>> 0;
  view.setUint32(totalBytes - 8, high, false);
  view.setUint32(totalBytes - 4, low, false);
  let h0 = 1732584193;
  let h1 = 4023233417;
  let h2 = 2562383102;
  let h3 = 271733878;
  let h4 = 3285377520;
  const words = new Uint32Array(80);
  for (let offset = 0; offset < totalBytes; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) {
      words[i] = rotl((words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16]) >>> 0, 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f;
      let k;
      if (i < 20) {
        f = b & c | ~b & d;
        k = 1518500249;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 1859775393;
      } else if (i < 60) {
        f = b & c | b & d | c & d;
        k = 2400959708;
      } else {
        f = b ^ c ^ d;
        k = 3395469782;
      }
      const temp = rotl(a, 5) + f + e + k + words[i] >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h0 = h0 + a >>> 0;
    h1 = h1 + b >>> 0;
    h2 = h2 + c >>> 0;
    h3 = h3 + d >>> 0;
    h4 = h4 + e >>> 0;
  }
  return wordHex(h0) + wordHex(h1) + wordHex(h2) + wordHex(h3) + wordHex(h4);
}
function rotl(value, bits) {
  return (value << bits | value >>> 32 - bits) >>> 0;
}
function wordHex(value) {
  let out = "";
  for (let shift = 28; shift >= 0; shift -= 4) out += HEX[value >>> shift & 15];
  return out;
}

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/bank.ts
var XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  allowBooleanAttributes: true
});
var DEFAULT_INDENT = "	";
var VALUE_TYPES = /* @__PURE__ */ new Set(["int", "fixed", "string", "flag", "text", "point"]);
function parseBank(xmlText) {
  const raw = XML_PARSER.parse(xmlText);
  const bankRoot = findBankRoot(raw);
  const bank = {
    sections: [],
    ...attr(bankRoot, "version") !== void 0 ? { version: attr(bankRoot, "version") } : {},
    ...readSignature(bankRoot) !== void 0 ? { signature: readSignature(bankRoot) } : {}
  };
  for (const sectionNode of toArray(bankRoot["Section"])) {
    const section = parseSection(sectionNode);
    if (section) bank.sections.push(section);
  }
  return bank;
}
function serializeBank(bank, options = {}) {
  const indent = options.indent ?? DEFAULT_INDENT;
  const working = options.sort ? sortBank(bank) : cloneBank(bank);
  if (options.signature !== false && options.signature !== void 0) {
    working.signature = calculateBankSignature(working, options.signature);
  }
  let out = options.xmlHeader === false ? "" : '<?xml version="1.0" encoding="utf-8"?>\n';
  out += `<Bank${working.version !== void 0 ? ` version="${escapeAttr(working.version)}"` : ""}>
`;
  for (const section of working.sections) {
    out += `${indent}<Section name="${escapeAttr(section.name)}">
`;
    for (const key of section.keys) {
      out += `${indent}${indent}<Key name="${escapeAttr(key.name)}">
`;
      if (key.value !== void 0) {
        out += `${indent}${indent}${indent}<Value ${key.value.type}="${escapeAttr(key.value.value)}"/>
`;
      }
      for (const node of key.nodes ?? []) {
        out += `${indent}${indent}${indent}<${node.name}`;
        const attrs = { ...node.attrs, [node.type]: node.value };
        for (const [name, value] of Object.entries(attrs)) out += ` ${name}="${escapeAttr(value)}"`;
        out += "/>\n";
      }
      out += `${indent}${indent}</Key>
`;
    }
    out += `${indent}</Section>
`;
  }
  if (working.signature !== void 0) {
    out += `${indent}<Signature value="${escapeAttr(working.signature)}"/>
`;
  }
  out += "</Bank>";
  return out;
}
function calculateBankSignature(bank, info) {
  let payload = `${info.authorId}${info.playerId}${info.bankName}`;
  for (const section of bank.sections) {
    payload += section.name;
    for (const key of section.keys) {
      payload += key.name;
      if (key.nodes !== void 0 && key.nodes.length > 0) {
        for (const node of key.nodes) {
          payload += node.name + node.type;
          if (node.type !== "text") payload += node.value;
        }
      } else if (key.value !== void 0) {
        payload += "Value" + key.value.type;
        if (key.value.type !== "text") payload += key.value.value;
      }
    }
  }
  return sha1Hex(payload).toUpperCase();
}
function verifyBankSignature(bank, info) {
  if (bank.signature === void 0) return false;
  return bank.signature.toUpperCase() === calculateBankSignature(bank, info);
}
function sortBank(bank) {
  const sections = bank.sections.map((section) => ({
    name: section.name,
    keys: section.keys.map((key) => ({
      ...key,
      ...key.nodes !== void 0 ? { nodes: [...key.nodes].sort(compareNodes) } : {}
    })).sort((a, b) => compareAscii(a.name, b.name))
  })).sort((a, b) => compareAscii(a.name, b.name));
  return {
    ...bank.version !== void 0 ? { version: bank.version } : {},
    sections,
    ...bank.signature !== void 0 ? { signature: bank.signature } : {}
  };
}
function getBankSection(bank, sectionName) {
  return bank.sections.find((section) => section.name === sectionName);
}
function getBankKey(bank, sectionName, keyName) {
  return getBankSection(bank, sectionName)?.keys.find((key) => key.name === keyName);
}
function getBankValue(bank, sectionName, keyName) {
  return getBankKey(bank, sectionName, keyName)?.value;
}
function coerceBankValue(value) {
  switch (value.type) {
    case "int":
      return parseInt(value.value, 10);
    case "fixed":
      return parseFloat(value.value);
    case "flag":
      return value.value === "1" || value.value.toLowerCase() === "true";
    case "point": {
      const [x = "0", y = "0"] = value.value.split(",");
      return { x: parseFloat(x), y: parseFloat(y) };
    }
    default:
      return value.value;
  }
}
function makeBankValue(type, value) {
  if (type === "flag") return { type, value: value === true || value === 1 ? "1" : "0" };
  if (type === "point" && typeof value === "object" && "x" in value && "y" in value) {
    return { type, value: `${formatFixed(value.x)},${formatFixed(value.y)}` };
  }
  return { type, value: String(value) };
}
function parseSection(node) {
  const name = attr(node, "name");
  if (name === void 0) return void 0;
  const section = { name, keys: [] };
  if (!isRecord(node)) return section;
  for (const keyNode of toArray(node["Key"])) {
    const key = parseKey(keyNode);
    if (key) section.keys.push(key);
  }
  return section;
}
function parseKey(node) {
  const name = attr(node, "name");
  if (name === void 0) return void 0;
  const key = { name };
  if (!isRecord(node)) return key;
  const valueNode = first(node["Value"]);
  if (valueNode !== void 0) {
    const value = parseValue(valueNode);
    if (value) key.value = value;
  }
  const nodes = [];
  for (const [tag, child] of Object.entries(node)) {
    if (tag === "Value" || tag === "#text" || tag.startsWith("@_") || tag.startsWith("?")) continue;
    for (const item of toArray(child)) {
      const parsed = parseNode(tag, item);
      if (parsed) nodes.push(parsed);
    }
  }
  if (nodes.length > 0) key.nodes = nodes;
  return key;
}
function parseValue(node) {
  const attrs = attrsOf(node);
  const [type, value] = Object.entries(attrs)[0] ?? [];
  if (type === void 0 || value === void 0) return void 0;
  return { type, value };
}
function parseNode(name, node) {
  const attrs = attrsOf(node);
  const firstTyped = Object.entries(attrs).find(([key]) => !VALUE_TYPES.has(key.toLowerCase())) ?? Object.entries(attrs)[0];
  if (firstTyped === void 0) return void 0;
  const [type, value] = firstTyped;
  return { name, type, value, attrs };
}
function findBankRoot(raw) {
  const root = raw["Bank"];
  if (isRecord(root)) {
    const nested = root["Bank"];
    return isRecord(nested) ? nested : root;
  }
  throw new Error("SC2Bank XML must contain a <Bank> root");
}
function readSignature(root) {
  return attr(first(root["Signature"]), "value");
}
function cloneBank(bank) {
  return {
    ...bank.version !== void 0 ? { version: bank.version } : {},
    sections: bank.sections.map((section) => ({
      name: section.name,
      keys: section.keys.map((key) => ({
        name: key.name,
        ...key.value !== void 0 ? { value: { ...key.value } } : {},
        ...key.nodes !== void 0 ? { nodes: key.nodes.map((node) => ({ ...node, attrs: { ...node.attrs } })) } : {}
      }))
    })),
    ...bank.signature !== void 0 ? { signature: bank.signature } : {}
  };
}
function compareNodes(a, b) {
  return compareAscii(a.name, b.name);
}
function compareAscii(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = a.charCodeAt(i) - b.charCodeAt(i);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}
function formatFixed(value) {
  return (Math.floor(value * 1e4 + 0.1) / 1e4).toString();
}
function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function first(value) {
  return Array.isArray(value) ? value[0] : value;
}
function toArray(value) {
  if (value === void 0 || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
function attr(node, name) {
  if (!isRecord(node)) return void 0;
  const value = node[`@_${name}`];
  return value !== void 0 ? String(value) : void 0;
}
function attrsOf(node) {
  const out = {};
  if (!isRecord(node)) return out;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) out[key.slice(2)] = String(value);
  }
  return out;
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/bank-list.ts
import { XMLParser as XMLParser2 } from "file:///C:/FILES/SC2Files/coding/artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/oracle/cache/dependencies/38bf6535c1ad393e8936fb83c922c41ad6adddcfd312f2ad7ad34c15c33fcf37/244b5dde4eaa63f0bb6b66e972a7667067d3d4328c5c1771a470764a157bb592/src/fxp.js";
var XML_PARSER2 = new XMLParser2({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  allowBooleanAttributes: true
});

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/editor.ts
var SC2BankEditor = class _SC2BankEditor {
  bank;
  signatureInfo;
  constructor(bank, signatureInfo) {
    this.bank = bank;
    if (signatureInfo !== void 0) this.signatureInfo = signatureInfo;
  }
  static parse(xmlText, signatureInfo) {
    return new _SC2BankEditor(parseBank(xmlText), signatureInfo);
  }
  get(sectionName, keyName) {
    return getBankValue(this.bank, sectionName, keyName);
  }
  getAny(sectionName, keyName) {
    const value = this.get(sectionName, keyName);
    return value !== void 0 ? coerceBankValue(value) : void 0;
  }
  getString(sectionName, keyName, fallback) {
    const value = this.get(sectionName, keyName);
    return value !== void 0 ? String(coerceBankValue(value)) : fallback;
  }
  getInt(sectionName, keyName, fallback) {
    const value = this.get(sectionName, keyName);
    if (value === void 0) return fallback;
    const coerced = coerceBankValue(value);
    return typeof coerced === "number" ? Math.trunc(coerced) : parseInt(String(coerced), 10);
  }
  getFixed(sectionName, keyName, fallback) {
    const value = this.get(sectionName, keyName);
    if (value === void 0) return fallback;
    const coerced = coerceBankValue(value);
    return typeof coerced === "number" ? coerced : parseFloat(String(coerced));
  }
  getFlag(sectionName, keyName, fallback) {
    const value = this.get(sectionName, keyName);
    if (value === void 0) return fallback;
    return coerceBankValue(value) === true;
  }
  set(sectionName, keyName, type, value) {
    const section = this.ensureSection(sectionName);
    const key = this.ensureKey(section, keyName);
    key.value = makeBankValue(type, value);
    delete key.nodes;
    return this;
  }
  setInt(sectionName, keyName, value) {
    return this.set(sectionName, keyName, "int", value);
  }
  setFixed(sectionName, keyName, value) {
    return this.set(sectionName, keyName, "fixed", value);
  }
  setString(sectionName, keyName, value) {
    return this.set(sectionName, keyName, "string", value);
  }
  setText(sectionName, keyName, value) {
    return this.set(sectionName, keyName, "text", value);
  }
  setFlag(sectionName, keyName, value) {
    return this.set(sectionName, keyName, "flag", value);
  }
  setPoint(sectionName, keyName, value) {
    return this.set(sectionName, keyName, "point", value);
  }
  removeKey(sectionName, keyName) {
    const section = getBankSection(this.bank, sectionName);
    if (section === void 0) return false;
    const before = section.keys.length;
    section.keys = section.keys.filter((key) => key.name !== keyName);
    return section.keys.length !== before;
  }
  removeSection(sectionName) {
    const before = this.bank.sections.length;
    this.bank.sections = this.bank.sections.filter((section) => section.name !== sectionName);
    return this.bank.sections.length !== before;
  }
  sort() {
    const sorted = sortBank(this.bank);
    this.bank.sections = sorted.sections;
    if (sorted.version !== void 0) this.bank.version = sorted.version;
    else delete this.bank.version;
    if (sorted.signature !== void 0) this.bank.signature = sorted.signature;
    else delete this.bank.signature;
    return this;
  }
  sign(signatureInfo = this.requireSignatureInfo()) {
    this.signatureInfo = signatureInfo;
    this.bank.signature = calculateBankSignature(this.bank, signatureInfo);
    return this.bank.signature;
  }
  verify(signatureInfo = this.requireSignatureInfo()) {
    return verifyBankSignature(this.bank, signatureInfo);
  }
  serialize(options = {}) {
    return serializeBank(this.bank, {
      ...options,
      ...options.signature === void 0 && this.signatureInfo !== void 0 ? { signature: this.signatureInfo } : {}
    });
  }
  ensureSection(sectionName) {
    const existing = getBankSection(this.bank, sectionName);
    if (existing !== void 0) return existing;
    const section = { name: sectionName, keys: [] };
    this.bank.sections.push(section);
    return section;
  }
  ensureKey(section, keyName) {
    const existing = getBankKey(this.bank, section.name, keyName);
    if (existing !== void 0) return existing;
    const key = { name: keyName };
    section.keys.push(key);
    return key;
  }
  requireSignatureInfo() {
    if (this.signatureInfo === void 0) {
      throw new Error("SC2BankEditor requires signatureInfo to sign or verify");
    }
    return this.signatureInfo;
  }
};

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/path-core.ts
var PLAYER_OR_AUTHOR_ID_RE = /^\d+-S2-\d+-\d+$/i;
var BANK_FILE_RE = /\.SC2Bank$/i;
function inferBankSignatureInfo(bankPath) {
  const normalized = normalizePath(bankPath);
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] ?? "";
  const bankName = fileName.replace(BANK_FILE_RE, "");
  const bankIndex = parts.findIndex((part) => part.toLowerCase() === "banks");
  let authorId;
  let playerId;
  if (bankIndex !== -1) {
    authorId = parts.slice(bankIndex + 1, -1).find((part) => PLAYER_OR_AUTHOR_ID_RE.test(part));
    const beforeBanks = parts.slice(0, bankIndex).reverse();
    playerId = beforeBanks.find((part) => PLAYER_OR_AUTHOR_ID_RE.test(part));
  } else {
    const ids = parts.filter((part) => PLAYER_OR_AUTHOR_ID_RE.test(part));
    playerId = ids.length >= 2 ? ids[ids.length - 2] : void 0;
    authorId = ids.length >= 1 ? ids[ids.length - 1] : void 0;
  }
  const missing = [];
  if (authorId === void 0) missing.push("authorId");
  if (playerId === void 0) missing.push("playerId");
  return {
    bankName,
    ...authorId !== void 0 ? { authorId } : {},
    ...playerId !== void 0 ? { playerId } : {},
    bankPath: normalized,
    missing
  };
}
function toSignatureInfo(info) {
  if (info.authorId === void 0 || info.playerId === void 0) return void 0;
  return { bankName: info.bankName, authorId: info.authorId, playerId: info.playerId };
}
function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/validate.ts
var KNOWN_VALUE_TYPES = /* @__PURE__ */ new Set(["int", "fixed", "string", "flag", "text", "point"]);
var INT_RE = /^-?\d+$/;
var FIXED_RE = /^-?(?:\d+|\d*\.\d+)$/;
function validateBank(bank, options = {}) {
  const findings = [];
  validateSections(bank, findings, options);
  validateSignature(bank, findings, options);
  return {
    ok: findings.every((finding) => finding.severity !== "error"),
    findings
  };
}
function validateSections(bank, findings, options) {
  const sectionNames = /* @__PURE__ */ new Set();
  for (let sectionIndex = 0; sectionIndex < bank.sections.length; sectionIndex++) {
    const section = bank.sections[sectionIndex];
    const sectionPath = `/Section[${sectionIndex}]`;
    if (section.name.length === 0) {
      add(findings, "error", "empty-section-name", "Section name is empty", sectionPath);
    }
    if (sectionNames.has(section.name)) {
      add(findings, "error", "duplicate-section", `Duplicate section "${section.name}"`, sectionPath);
    }
    sectionNames.add(section.name);
    validateKeys(section, sectionPath, findings, options);
  }
}
function validateKeys(section, sectionPath, findings, options) {
  const keyNames = /* @__PURE__ */ new Set();
  for (let keyIndex = 0; keyIndex < section.keys.length; keyIndex++) {
    const key = section.keys[keyIndex];
    const keyPath = `${sectionPath}/Key[${keyIndex}]`;
    if (key.name.length === 0) {
      add(findings, "error", "empty-key-name", `Key name is empty in section "${section.name}"`, keyPath);
    }
    if (keyNames.has(key.name)) {
      add(findings, "error", "duplicate-key", `Duplicate key "${key.name}" in section "${section.name}"`, keyPath);
    }
    keyNames.add(key.name);
    validateKey(key, keyPath, findings, options);
  }
}
function validateKey(key, keyPath, findings, options) {
  if (key.value !== void 0 && key.nodes !== void 0 && key.nodes.length > 0) {
    add(findings, "warning", "mixed-value-and-nodes", `Key "${key.name}" has both a Value and node children`, keyPath);
  }
  if (key.value !== void 0) validateValue(key.value, `${keyPath}/Value`, findings, options);
  for (let nodeIndex = 0; nodeIndex < (key.nodes?.length ?? 0); nodeIndex++) {
    const node = key.nodes[nodeIndex];
    if (node.type.length === 0) {
      add(findings, "error", "empty-node-type", `Node "${node.name}" has an empty value attribute type`, `${keyPath}/${node.name}[${nodeIndex}]`);
    }
  }
}
function validateValue(value, path, findings, options) {
  if (value.type.length === 0) {
    add(findings, "error", "empty-value-type", "Value type is empty", path);
    return;
  }
  if (!KNOWN_VALUE_TYPES.has(value.type) && options.allowUnknownValueTypes !== true) {
    add(findings, "warning", "unknown-value-type", `Unknown bank value type "${value.type}"`, path);
  }
  switch (value.type) {
    case "int":
      if (!INT_RE.test(value.value)) add(findings, "error", "invalid-int", `Invalid int value "${value.value}"`, path);
      break;
    case "fixed":
      if (!FIXED_RE.test(value.value)) add(findings, "error", "invalid-fixed", `Invalid fixed value "${value.value}"`, path);
      break;
    case "flag":
      if (!["0", "1", "true", "false"].includes(value.value.toLowerCase())) {
        add(findings, "error", "invalid-flag", `Invalid flag value "${value.value}"`, path);
      }
      break;
    case "point":
      validatePoint(value.value, path, findings);
      break;
  }
}
function validatePoint(value, path, findings) {
  const parts = value.split(",");
  if (parts.length !== 2 || !FIXED_RE.test(parts[0] ?? "") || !FIXED_RE.test(parts[1] ?? "")) {
    add(findings, "error", "invalid-point", `Invalid point value "${value}"`, path);
  }
}
function validateSignature(bank, findings, options) {
  if (bank.signature === void 0) {
    add(
      findings,
      options.requireSignature === true ? "error" : "warning",
      "missing-signature",
      "Bank has no Signature element",
      "/Signature"
    );
    return;
  }
  if (options.signatureInfo === void 0) {
    add(findings, "warning", "missing-signature-info", "Signature exists but no signatureInfo was provided for verification", "/Signature");
    return;
  }
  if (verifyBankSignature(bank, options.signatureInfo)) {
    add(findings, "info", "valid-signature", "Bank signature is valid", "/Signature");
  } else {
    add(findings, "error", "invalid-signature", "Bank signature does not match provided signatureInfo", "/Signature");
  }
}
function add(findings, severity, code, message, path) {
  findings.push({ severity, code, message, path });
}

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/core/patcher.ts
function patchBankValueXml(xml, opts) {
  const { section, key, type, value } = opts;
  const sectionRange = findSectionRange(xml, section);
  if (!sectionRange) {
    return { ok: false, reason: `Section "${section}" not found` };
  }
  const [secStart, secEnd] = sectionRange;
  const keyRange = findKeyRange(xml, key, secStart, secEnd);
  if (!keyRange) {
    return { ok: false, reason: `Key "${key}" not found in section "${section}"` };
  }
  const [keyStart, keyEnd] = keyRange;
  const valuePos = findValueElement(xml, keyStart, keyEnd);
  if (!valuePos) {
    return { ok: false, reason: `<Value> element not found for key "${key}" in section "${section}"` };
  }
  const [valStart, valEnd, existingType] = valuePos;
  const escapedValue = escapeAttrValue(value);
  let replacement;
  if (existingType === type) {
    const original = xml.slice(valStart, valEnd);
    const attrRe = new RegExp(`(${escapeRegex(type)}\\s*=\\s*)(['"])[^'"]*\\2`);
    if (!attrRe.test(original)) {
      return { ok: false, reason: `Could not locate ${type}=... attribute in <Value> tag` };
    }
    replacement = original.replace(attrRe, `$1$2${escapedValue}$2`);
  } else {
    replacement = `<Value ${type}="${escapedValue}"/>`;
  }
  const newXml = xml.slice(0, valStart) + replacement + xml.slice(valEnd);
  const changed = newXml !== xml;
  return { ok: true, xml: newXml, changed };
}
function patchBankSignatureXml(xml, signature) {
  const escapedSig = escapeAttrValue(signature);
  const sigRe = /(<Signature\s[^>]*value\s*=\s*)(['"])([^'"]*)\2/;
  if (sigRe.test(xml)) {
    const newXml2 = xml.replace(sigRe, `$1$2${escapedSig}$2`);
    const changed = newXml2 !== xml;
    return { ok: true, xml: newXml2, changed };
  }
  const closingBank = xml.lastIndexOf("</Bank>");
  if (closingBank === -1) {
    return { ok: false, reason: "</Bank> closing tag not found" };
  }
  const indent = detectIndent(xml);
  const sigTag = `${indent}<Signature value="${escapedSig}"/>
`;
  const newXml = xml.slice(0, closingBank) + sigTag + xml.slice(closingBank);
  return { ok: true, xml: newXml, changed: true };
}
function findSectionRange(xml, sectionName) {
  const openRe = /<Section(\s[^>]*)>/g;
  let m;
  while ((m = openRe.exec(xml)) !== null) {
    if (hasAttr(m[1] ?? "", "name", sectionName)) {
      const contentStart = m.index + m[0].length;
      const closeIdx = xml.indexOf("</Section>", contentStart);
      if (closeIdx === -1) return null;
      return [contentStart, closeIdx];
    }
  }
  return null;
}
function findKeyRange(xml, keyName, from, to) {
  const slice = xml.slice(from, to);
  const openRe = /<Key(\s[^>]*)>/g;
  let m;
  while ((m = openRe.exec(slice)) !== null) {
    if (hasAttr(m[1] ?? "", "name", keyName)) {
      const contentStart = from + m.index + m[0].length;
      const closeIdx = slice.indexOf("</Key>", m.index + m[0].length);
      if (closeIdx === -1) return null;
      return [contentStart, from + closeIdx];
    }
  }
  return null;
}
function findValueElement(xml, from, to) {
  const slice = xml.slice(from, to);
  const selfRe = /<Value(\s[^>]*)\s*\/>/;
  const selfM = selfRe.exec(slice);
  if (selfM) {
    const typeAttr = detectTypeAttr(selfM[1] ?? "");
    if (!typeAttr) return null;
    return [from + selfM.index, from + selfM.index + selfM[0].length, typeAttr];
  }
  const openRe = /<Value(\s[^>]*)>/;
  const openM = openRe.exec(slice);
  if (openM) {
    const closeM = slice.indexOf("</Value>", openM.index + openM[0].length);
    if (closeM === -1) return null;
    const typeAttr = detectTypeAttr(openM[1] ?? "");
    if (!typeAttr) return null;
    const tagEnd = from + closeM + "</Value>".length;
    return [from + openM.index, tagEnd, typeAttr];
  }
  return null;
}
function hasAttr(attrs, name, value) {
  const re = new RegExp(`\\b${escapeRegex(name)}\\s*=\\s*(['"])${escapeRegex(value)}\\1`);
  return re.test(attrs);
}
function detectTypeAttr(attrs) {
  const TYPES = ["int", "fixed", "string", "flag", "text", "point"];
  for (const t of TYPES) {
    if (new RegExp(`\\b${t}\\s*=`).test(attrs)) return t;
  }
  const m = /\b(\w+)\s*=/.exec(attrs);
  return m ? m[1] ?? null : null;
}
function detectIndent(xml) {
  const m = /\n([ \t]+)<(?:Section|Signature)\b/.exec(xml);
  return m ? m[1] ?? "	" : "	";
}
function escapeAttrValue(v) {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// mk2-pin:packages/assets/src/json.ts
var DEFAULT_MAX_DEPTH = 64;
function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}
function isJsonSerializable(value, maxDepth = DEFAULT_MAX_DEPTH) {
  return check(value, maxDepth, /* @__PURE__ */ new Set(), false);
}
function check(value, depth, seen, insideArray) {
  if (depth < 0) return false;
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "undefined":
      return !insideArray;
    case "bigint":
    case "symbol":
    case "function":
      return false;
    default:
      break;
  }
  const object = value;
  if (seen.has(object)) return false;
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return object.every((entry2) => check(entry2, depth - 1, seen, true));
    }
    if (!isPlainObject(object)) return false;
    return Object.values(object).every(
      (entry2) => check(entry2, depth - 1, seen, false)
    );
  } finally {
    seen.delete(object);
  }
}

// mk2-pin:packages/assets/src/cancellation.ts
var NOOP_SUBSCRIPTION = { dispose() {
} };
function createToken(isCancelled, subscribe) {
  return {
    get isCancellationRequested() {
      return isCancelled();
    },
    onCancellationRequested: subscribe
  };
}
var CancellationTokenNone = createToken(
  () => false,
  () => NOOP_SUBSCRIPTION
);
var CancellationTokenCancelled = createToken(
  () => true,
  (listener) => {
    listener();
    return NOOP_SUBSCRIPTION;
  }
);
var CancellationError = class extends Error {
  name = "CancellationError";
  constructor(message = "Operation was cancelled") {
    super(message);
  }
};
function throwIfCancelled(token, message) {
  if (token?.isCancellationRequested) throw new CancellationError(message);
}

// mk2-pin:packages/core/src/errors.ts
var ModkitError = class _ModkitError extends Error {
  code;
  context;
  hint;
  constructor(opts) {
    super(opts.message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
    this.name = "ModkitError";
    this.code = opts.code;
    this.context = opts.context;
    this.hint = opts.hint;
    Object.setPrototypeOf(this, _ModkitError.prototype);
  }
};

// mk2-pin:packages/assets/src/operations.ts
function operationHandlerId(operation) {
  return operation.handlerId ?? operation.id;
}

// mk2-pin:packages/assets/src/codec-manifest.ts
var CODEC_DEPENDENCY_RELATIONS = [
  "requires",
  "defaults",
  "suggests",
  "integrates",
  "conflicts",
  "replaces",
  "provides"
];
var GAME_CONTRIBUTION_MODES = ["requires", "defaults", "suggests", "integrates"];
var DEPENDENCY_KEYS = new Set(CODEC_DEPENDENCY_RELATIONS);
var GAME_FEATURE_GROUP_KEYS = new Set(GAME_CONTRIBUTION_MODES);

// mk2-pin:packages/assets/src/source.ts
async function readSourceHeader(source, byteCount, cancellation) {
  return source.readRange(
    { offset: 0, length: byteCount },
    cancellation ? { cancellation } : void 0
  );
}

// mk2-pin:packages/assets/src/view-descriptors.ts
var DEFAULT_CODE_VIEW_POLICY = Object.freeze({
  maxMaterializedBytes: 16 * 1024 * 1024,
  pageAboveBytes: 4 * 1024 * 1024,
  pageBytes: 256 * 1024
});
var DEFAULT_HEX_VIEW_POLICY = Object.freeze({
  maxMaterializedBytes: 1024 * 1024,
  pageAboveBytes: 0,
  pageBytes: 64 * 1024
});

// mk2-pin:packages/assets/src/descriptor.ts
var ASSET_DESCRIPTOR_SCHEMA_VERSION = 1;

// mk2-pin:packages/assets/src/artifact-session.ts
var DefaultArtifactOperationSession = class {
  codecId;
  context;
  descriptor;
  document;
  handlers;
  permissions;
  onDispose;
  disposePromise;
  constructor(init) {
    this.codecId = init.codecId;
    this.document = init.document;
    this.context = init.context;
    this.descriptor = init.descriptor;
    this.handlers = init.handlers;
    this.permissions = new Set(init.grantedPermissions ?? []);
    if (init.onDispose !== void 0) this.onDispose = init.onDispose;
  }
  get disposed() {
    return this.disposePromise !== void 0;
  }
  async invoke(handlerId, input) {
    if (this.disposed) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "Artifact operation session has already been disposed.",
        context: { codecId: this.codecId, handlerId }
      });
    }
    throwIfCancelled(this.context.cancellation);
    if (input !== void 0 && !isJsonSerializable(input)) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "Artifact operation input must be JSON-serializable.",
        context: { codecId: this.codecId, handlerId }
      });
    }
    const operation = this.descriptor.operations.find(
      (candidate) => operationHandlerId(candidate) === handlerId
    );
    if (operation === void 0) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "Artifact operation handler is not declared by this document.",
        context: { codecId: this.codecId, handlerId }
      });
    }
    if (operation.state !== "available") {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "Artifact operation is not available for this document.",
        context: {
          codecId: this.codecId,
          handlerId,
          operationId: operation.id,
          state: operation.state,
          reason: operation.reason
        },
        ...operation.reason === void 0 ? {} : { hint: operation.reason.message }
      });
    }
    const missingPermissions = (operation.permissions ?? []).filter(
      (permission) => !this.permissions.has(permission)
    );
    if (missingPermissions.length > 0) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "Artifact operation requires permissions not granted to this session.",
        context: {
          codecId: this.codecId,
          handlerId,
          operationId: operation.id,
          missingPermissions
        }
      });
    }
    const handler = this.handlers[handlerId];
    if (handler === void 0) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "Artifact operation handler is not registered by the selected codec.",
        context: { codecId: this.codecId, handlerId, operationId: operation.id }
      });
    }
    return handler({
      document: this.document,
      context: this.context,
      descriptor: this.descriptor,
      operation,
      input
    });
  }
  dispose() {
    if (this.disposePromise === void 0) {
      this.disposePromise = Promise.resolve().then(() => this.onDispose?.());
    }
    return this.disposePromise;
  }
};
function createArtifactOperationSession(init) {
  return new DefaultArtifactOperationSession(init);
}

// mk2-pin:packages/core/src/logging.ts
import {
  configure,
  getLogger as getLogTapeLogger,
  getTextFormatter
} from "file:///C:/FILES/SC2Files/coding/artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/oracle/cache/dependencies/38bf6535c1ad393e8936fb83c922c41ad6adddcfd312f2ad7ad34c15c33fcf37/b54204e8a2ad841390678857444a7b57fe6ff1706d115599d03767c01750f47e/dist/mod.js";
import { getPrettyFormatter } from "file:///C:/FILES/SC2Files/coding/artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/oracle/cache/dependencies/38bf6535c1ad393e8936fb83c922c41ad6adddcfd312f2ad7ad34c15c33fcf37/75a9aa8273eca25bff617030b453866ef88026dc2d1fd57b6f1e48927a17c781/dist/mod.js";
import { getRotatingFileSink } from "file:///C:/FILES/SC2Files/coding/artifacts/legacy-parity-sc2/sc2-bank/m2-2026-09-04/oracle/cache/dependencies/38bf6535c1ad393e8936fb83c922c41ad6adddcfd312f2ad7ad34c15c33fcf37/f89f16c85fa896d705243cc6cb49da6b6f54e4b5428529da9ce01269c0b717d5/dist/mod.js";
import { inspect } from "node:util";

// mk2-pin:packages/core/src/logger.ts
var loggerFactory;
function installLoggerFactory(factory) {
  loggerFactory = factory;
}
function getLogger(category = []) {
  const invoke = (property, args) => {
    const target = loggerFactory?.(category);
    if (target === void 0) return void 0;
    const member = Reflect.get(target, property);
    return typeof member === "function" ? Reflect.apply(member, target, args) : member;
  };
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "isEnabledFor" && loggerFactory === void 0) return () => false;
        return (...args) => invoke(property, args);
      }
    }
  );
}

// mk2-pin:packages/core/src/logging.ts
var ROOT = "modkit";
installLoggerFactory((category) => getLogTapeLogger([ROOT, ...category]));
function toMethod(level) {
  switch (level) {
    case "fatal":
      return "fatal";
    case "error":
      return "error";
    case "warn":
    case "warning":
      return "warn";
    case "info":
      return "info";
    case "debug":
      return "debug";
    // 'verbose' is a legacy winston alias → trace (the lowest, noisiest tier)
    case "trace":
    case "verbose":
      return "trace";
    default:
      return "info";
  }
}
function makeCompat(lt) {
  const emit = (level, message, rest) => {
    const props = rest.length ? { data: rest.length === 1 ? rest[0] : rest } : void 0;
    lt[toMethod(level)](
      message,
      props
    );
  };
  return {
    error: (m, ...r) => emit("error", m, r),
    warn: (m, ...r) => emit("warn", m, r),
    info: (m, ...r) => emit("info", m, r),
    verbose: (m, ...r) => emit("verbose", m, r),
    debug: (m, ...r) => emit("debug", m, r),
    log: (lvl, m, ...r) => emit(lvl, m, r)
  };
}
function getCompatLogger(category = []) {
  return makeCompat(getLogger(category));
}
var logger = getCompatLogger();
var traceLogger = getLogger(["trace"]);

// mk2-pin:packages/semantic/src/saves.ts
var SAVE_OPERATION_IDS = {
  inspect: "view.inspect",
  validate: "asset.validate",
  patchValue: "edit.content",
  saveAs: "source.save-as",
  exportRaw: "export.raw",
  sign: "save.sign"
};
var SAVE_OPERATION_ID_LIST = Object.freeze(
  Object.values(SAVE_OPERATION_IDS)
);

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/identity.ts
var SC2_GAME_ID = "starcraft-2";
var SC2_BANK_CODEC_ID = "sc2-bank";
var SC2_BANK_CODEC_VERSION = "0.1.0";
var SC2_BANK_EXTENSION = ".sc2bank";

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/describe.ts
function sc2BankHandlerId(operationId) {
  return `${SC2_BANK_CODEC_ID}.${operationId}`;
}
var NOT_SIGNABLE_REASON = {
  code: "not-implemented",
  message: "Author/player IDs could not be inferred from the source path (expected .../Banks/<authorId>/<bankName>.SC2Bank under a .../<playerId>/Banks/ ancestor) and no declared signatureInfo was available. Signing itself is implemented in @modkitx/bank; only this document lacks the identity it needs."
};
var SC2_BANK_OPERATIONS = Object.freeze([
  {
    id: SAVE_OPERATION_IDS.inspect,
    state: "available",
    mutatesSource: false,
    label: "Inspect bank",
    handlerId: sc2BankHandlerId(SAVE_OPERATION_IDS.inspect),
    permissions: ["read-source"],
    outputs: [{ id: "card", label: "Bank card data", mediaType: "application/json" }]
  },
  {
    id: SAVE_OPERATION_IDS.validate,
    state: "available",
    mutatesSource: false,
    label: "Validate bank",
    handlerId: sc2BankHandlerId(SAVE_OPERATION_IDS.validate),
    permissions: ["read-source"],
    outputs: [
      { id: "diagnostics", label: "Validation diagnostics", mediaType: "application/json" }
    ]
  },
  {
    id: SAVE_OPERATION_IDS.patchValue,
    state: "available",
    mutatesSource: true,
    label: "Patch value",
    handlerId: sc2BankHandlerId(SAVE_OPERATION_IDS.patchValue),
    permissions: ["read-source"],
    // patchBankValueXml/patchBankSignatureXml rewrite only the targeted attribute/tag —
    // everything else in the original XML (whitespace, comments, quote style) is preserved.
    preservesUnknownData: true,
    roundTripSafe: true,
    outputs: [{ id: "xml", label: "Patched raw XML", mediaType: "application/xml" }]
  },
  {
    id: SAVE_OPERATION_IDS.saveAs,
    state: "available",
    mutatesSource: false,
    label: "Save bank as",
    handlerId: sc2BankHandlerId(SAVE_OPERATION_IDS.saveAs),
    permissions: ["read-source"],
    outputs: [{ id: "xml", label: "Serialized bank XML", mediaType: "application/xml" }]
  },
  {
    id: SAVE_OPERATION_IDS.exportRaw,
    state: "available",
    mutatesSource: false,
    label: "Export raw XML",
    handlerId: sc2BankHandlerId(SAVE_OPERATION_IDS.exportRaw),
    permissions: ["read-source"],
    preservesUnknownData: true,
    roundTripSafe: true,
    outputs: [
      { id: "xml", label: "Original raw XML bytes", role: "raw", mediaType: "application/xml" }
    ]
  },
  {
    // Default state; describeSc2Bank() overrides this per-document (see buildOperations).
    id: SAVE_OPERATION_IDS.sign,
    state: "disabled",
    mutatesSource: true,
    label: "Sign bank",
    handlerId: sc2BankHandlerId(SAVE_OPERATION_IDS.sign),
    permissions: ["read-source"],
    reason: NOT_SIGNABLE_REASON
  }
]);
var SC2_BANK_CONTRIBUTIONS = Object.freeze([
  {
    id: "sc2-bank.overview",
    kind: "stage",
    priority: 60,
    label: "Bank overview",
    requiresTraits: [{ id: "structure.hierarchy" }]
  }
]);
function entry(id, label, value, kind) {
  return { id, label, value, ...kind ? { kind } : {} };
}
function buildDiagnostics(document) {
  return document.validation.findings.map((finding, index) => ({
    id: `sc2-bank.validate.${finding.code}.${index}`,
    severity: finding.severity,
    code: `sc2-bank.${finding.code}`,
    message: finding.message,
    source: SC2_BANK_CODEC_ID,
    path: finding.path
  }));
}
function buildTraits(document) {
  const keyCount = document.bank.sections.reduce((sum, section) => sum + section.keys.length, 0);
  const traits = [
    {
      id: "structure.hierarchy",
      version: 1,
      state: "available",
      parameters: { sections: document.bank.sections.length, keys: keyCount }
    },
    {
      id: "content.metadata",
      version: 1,
      state: "available",
      parameters: {
        version: document.bank.version ?? null,
        hasSignature: document.bank.signature !== void 0
      }
    }
  ];
  return traits;
}
function diagnosticIdsFor(document, severities) {
  return document.validation.findings.map((finding, index) => ({ finding, id: `sc2-bank.validate.${finding.code}.${index}` })).filter(({ finding }) => severities.includes(finding.severity)).map(({ id }) => id);
}
function buildOperations(document) {
  const validateDiagnosticIds = diagnosticIdsFor(document, ["error", "warning"]);
  return SC2_BANK_OPERATIONS.map((operation) => {
    if (operation.id === SAVE_OPERATION_IDS.validate && validateDiagnosticIds.length > 0) {
      return { ...operation, diagnosticIds: validateDiagnosticIds };
    }
    if (operation.id === SAVE_OPERATION_IDS.sign && document.signatureInfo !== void 0) {
      const { reason: _reason, ...available } = operation;
      return { ...available, state: "available" };
    }
    return operation;
  });
}
function buildMetadata(document) {
  const { bank, inferredInfo, signatureInfo, source } = document;
  const groups = [
    {
      id: "identity",
      label: "Bank",
      order: 10,
      entries: [
        entry("name", "Name", inferredInfo.bankName, "text"),
        entry("path", "Path", source.path, "path"),
        entry("codec", "Codec", SC2_BANK_CODEC_ID, "id"),
        entry("version", "Version", bank.version ?? "(none)", "text"),
        entry("sections", "Sections", bank.sections.length, "number")
      ]
    },
    {
      id: "signature",
      label: "Signature",
      order: 20,
      entries: [
        entry("present", "Signature present", bank.signature !== void 0, "boolean"),
        ...signatureInfo !== void 0 ? [
          entry("authorId", "Author ID", signatureInfo.authorId, "id"),
          entry("playerId", "Player ID", signatureInfo.playerId, "id")
        ] : [entry("unresolved", "Author/player IDs", "could not be inferred from path", "text")]
      ]
    }
  ];
  return groups;
}
function buildIdentity(document) {
  return {
    pluginId: SC2_BANK_CODEC_ID,
    pluginVersion: SC2_BANK_CODEC_VERSION,
    formatId: SC2_BANK_CODEC_ID,
    formatLabel: "StarCraft II bank",
    mediaType: "application/xml",
    categories: ["semantic-game-asset"],
    confidence: document.detection.confidence,
    detection: document.detection.evidence
  };
}
function buildConstraints(_document) {
  return {
    readOnly: false,
    seekable: true,
    randomAccess: true,
    trusted: true
  };
}
function describeSc2Bank(document, _context = {}) {
  return {
    schemaVersion: ASSET_DESCRIPTOR_SCHEMA_VERSION,
    source: document.source,
    identity: buildIdentity(document),
    traits: buildTraits(document),
    operations: buildOperations(document),
    constraints: buildConstraints(document),
    contributions: SC2_BANK_CONTRIBUTIONS,
    metadata: buildMetadata(document),
    diagnostics: buildDiagnostics(document)
  };
}

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/detect.ts
var SC2_BANK_SOURCE_KINDS = ["file", "archive-entry"];
var HEADER_SNIFF_BYTES = 4096;
var BANK_ROOT_TAG_RE = /<Bank[\s>]/;
function clamp(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
async function detectSc2Bank(source, context = {}) {
  const descriptor = source.descriptor;
  const evidence = [];
  const hasExtension = descriptor.extension.toLowerCase() === SC2_BANK_EXTENSION;
  const header = await readSourceHeader(source, HEADER_SNIFF_BYTES, context.cancellation);
  const headerText = new TextDecoder("utf-8").decode(header);
  const hasStructuralRoot = BANK_ROOT_TAG_RE.test(headerText);
  if (hasStructuralRoot) {
    evidence.push({ kind: "structure", detail: "header window contains a <Bank ...> root tag" });
  }
  if (hasExtension) {
    evidence.push({ kind: "extension", detail: `root name ${descriptor.name}` });
  }
  if (context.gameId === SC2_GAME_ID || descriptor.context?.gameId === SC2_GAME_ID) {
    evidence.push({ kind: "context", detail: `declared game ${SC2_GAME_ID}` });
  }
  if (hasStructuralRoot) {
    let confidence = 0.9;
    if (hasExtension) confidence += 0.05;
    if (context.gameId === SC2_GAME_ID || descriptor.context?.gameId === SC2_GAME_ID)
      confidence += 0.05;
    return {
      pluginId: SC2_BANK_CODEC_ID,
      confidence: clamp(confidence),
      evidence,
      requiredRanges: [{ offset: 0, length: HEADER_SNIFF_BYTES }]
    };
  }
  if (hasExtension) {
    return {
      pluginId: SC2_BANK_CODEC_ID,
      confidence: 0.3,
      evidence,
      requiredRanges: [{ offset: 0, length: HEADER_SNIFF_BYTES }],
      diagnostics: [
        {
          id: "sc2-bank.detect.extension-only",
          severity: "warning",
          category: "ambiguous-detection",
          code: "sc2-bank.extension-only",
          message: "Matched the .SC2Bank extension but no <Bank> root was found in the header window.",
          source: SC2_BANK_CODEC_ID
        }
      ]
    };
  }
  return { pluginId: SC2_BANK_CODEC_ID, confidence: 0, evidence: [], requiredRanges: [] };
}

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/document.ts
function createSc2BankDocument(init) {
  const bank = parseBank(init.xml);
  const inferredInfo = inferBankSignatureInfo(init.source.path);
  const signatureInfo = toSignatureInfo(inferredInfo);
  const editor = new SC2BankEditor(bank, signatureInfo);
  const validation = validateBank(bank, signatureInfo !== void 0 ? { signatureInfo } : {});
  return {
    codecId: SC2_BANK_CODEC_ID,
    source: init.source,
    detection: init.detection,
    xml: init.xml,
    bank,
    editor,
    inferredInfo,
    ...signatureInfo !== void 0 ? { signatureInfo } : {},
    validation,
    context: init.context
  };
}
async function readSc2BankXml(source, context = {}) {
  const bytes = await source.read(
    context.cancellation ? { cancellation: context.cancellation } : void 0
  );
  return new TextDecoder("utf-8").decode(bytes);
}

// mk2-pin:extensions/blizzard/starcraft-2/codecs/sc2-bank/src/codec.ts
var Sc2BankCodec = class {
  id = SC2_BANK_CODEC_ID;
  kind = "save";
  supportedGames = [SC2_GAME_ID];
  sourceKinds = SC2_BANK_SOURCE_KINDS;
  operations = SC2_BANK_OPERATIONS;
  detect(source, context = {}) {
    return detectSc2Bank(source, context);
  }
  /**
   * Parse the bank.
   *
   * Detection runs first and is retained on the document so `describe()` can report real
   * evidence and confidence instead of a hardcoded 1.0 — mirrors `Sc2ModCodec.open()`. A
   * low-confidence detection does not block the open; routing is the registry's job.
   */
  async open(source, context = {}) {
    const detection = await this.detect(source, context);
    const xml = await readSc2BankXml(source, context);
    return createSc2BankDocument({ source: source.descriptor, detection, xml, context });
  }
  async describe(document, context = {}) {
    return describeSc2Bank(document, context);
  }
  createSession(document, context, descriptor, options = {}) {
    return createArtifactOperationSession({
      codecId: this.id,
      document,
      context,
      descriptor,
      ...options,
      handlers: {
        [sc2BankHandlerId(SAVE_OPERATION_IDS.inspect)]: ({ descriptor: current }) => current.metadata,
        [sc2BankHandlerId(SAVE_OPERATION_IDS.validate)]: () => this.validate(document),
        [sc2BankHandlerId(SAVE_OPERATION_IDS.patchValue)]: ({ input }) => this.patchValue(
          document,
          input
        ),
        [sc2BankHandlerId(SAVE_OPERATION_IDS.saveAs)]: ({ input }) => this.saveAs(document, input ?? {}),
        [sc2BankHandlerId(SAVE_OPERATION_IDS.exportRaw)]: () => this.exportRaw(document),
        [sc2BankHandlerId(SAVE_OPERATION_IDS.sign)]: () => this.sign(document)
      }
    });
  }
  // --- registered operation handlers ------------------------------------------------------
  // Each maps 1:1 onto an operation ID declared in `describe()`.
  /** `asset.validate` — the descriptor's diagnostics, so a host never sees two different verdicts. */
  async validate(document) {
    const descriptor = await this.describe(document, document.context);
    return descriptor.diagnostics.filter((diagnostic) => diagnostic.severity !== "info");
  }
  /**
   * `edit.content` — raw-preserving patch of a single key's value. Only the targeted attribute
   * (or the whole `<Value .../>` tag, on a type change) is rewritten; everything else in the
   * original XML (whitespace, comments, quote style, unrelated keys) is untouched.
   */
  patchValue(document, request) {
    return patchBankValueXml(document.xml, request);
  }
  /** `save.sign` — recompute and embed the author/player signature in the raw XML. */
  sign(document, signatureInfo) {
    const info = signatureInfo ?? document.signatureInfo;
    if (info === void 0) {
      throw new ModkitError({
        code: "CONFIG_INVALID",
        message: "SC2Bank signing cannot proceed because no signatureInfo was inferred or provided.",
        context: { codecId: this.id, sourcePath: document.source.path },
        hint: "Open the bank from its player Banks path or provide explicit signature metadata."
      });
    }
    const signature = calculateBankSignature(document.bank, info);
    return patchBankSignatureXml(document.xml, signature);
  }
  /** Verifies the bank's embedded signature against `signatureInfo` (inferred or provided). */
  verify(document, signatureInfo) {
    const info = signatureInfo ?? document.signatureInfo;
    if (info === void 0) return false;
    return verifyBankSignature(document.bank, info);
  }
  /** `source.save-as` — serialize the parsed bank (re-formats; use `patchValue`/`sign` to preserve raw XML). */
  saveAs(document, options = {}) {
    return serializeBank(document.bank, options);
  }
  /** `export.raw` — the original raw XML bytes, byte-for-byte. */
  exportRaw(document) {
    return document.xml;
  }
};
function createSc2BankCodec() {
  return new Sc2BankCodec();
}
export {
  Sc2BankCodec,
  createSc2BankCodec
};
