var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/util.js
var require_util = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/util.js"(exports) {
    "use strict";
    var nameStartChar = ":A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD";
    var nameChar = nameStartChar + "\\-.\\d\\u00B7\\u0300-\\u036F\\u203F-\\u2040";
    var nameRegexp = "[" + nameStartChar + "][" + nameChar + "]*";
    var regexName = new RegExp("^" + nameRegexp + "$");
    var getAllMatches = function(string, regex) {
      const matches = [];
      let match = regex.exec(string);
      while (match) {
        const allmatches = [];
        allmatches.startIndex = regex.lastIndex - match[0].length;
        const len = match.length;
        for (let index = 0; index < len; index++) {
          allmatches.push(match[index]);
        }
        matches.push(allmatches);
        match = regex.exec(string);
      }
      return matches;
    };
    var isName = function(string) {
      const match = regexName.exec(string);
      return !(match === null || typeof match === "undefined");
    };
    exports.isExist = function(v) {
      return typeof v !== "undefined";
    };
    exports.isEmptyObject = function(obj) {
      return Object.keys(obj).length === 0;
    };
    exports.merge = function(target, a, arrayMode) {
      if (a) {
        const keys = Object.keys(a);
        const len = keys.length;
        for (let i = 0; i < len; i++) {
          if (arrayMode === "strict") {
            target[keys[i]] = [a[keys[i]]];
          } else {
            target[keys[i]] = a[keys[i]];
          }
        }
      }
    };
    exports.getValue = function(v) {
      if (exports.isExist(v)) {
        return v;
      } else {
        return "";
      }
    };
    var DANGEROUS_PROPERTY_NAMES = [
      // '__proto__',
      // 'constructor',
      // 'prototype',
      "hasOwnProperty",
      "toString",
      "valueOf",
      "__defineGetter__",
      "__defineSetter__",
      "__lookupGetter__",
      "__lookupSetter__"
    ];
    var criticalProperties = ["__proto__", "constructor", "prototype"];
    exports.isName = isName;
    exports.getAllMatches = getAllMatches;
    exports.nameRegexp = nameRegexp;
    exports.DANGEROUS_PROPERTY_NAMES = DANGEROUS_PROPERTY_NAMES;
    exports.criticalProperties = criticalProperties;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/validator.js
var require_validator = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/validator.js"(exports) {
    "use strict";
    var util = require_util();
    var defaultOptions = {
      allowBooleanAttributes: false,
      //A tag can have attributes without any value
      unpairedTags: []
    };
    exports.validate = function(xmlData, options) {
      options = Object.assign({}, defaultOptions, options);
      const tags = [];
      let tagFound = false;
      let reachedRoot = false;
      if (xmlData[0] === "\uFEFF") {
        xmlData = xmlData.substr(1);
      }
      for (let i = 0; i < xmlData.length; i++) {
        if (xmlData[i] === "<" && xmlData[i + 1] === "?") {
          i += 2;
          i = readPI(xmlData, i);
          if (i.err) return i;
        } else if (xmlData[i] === "<") {
          let tagStartPos = i;
          i++;
          if (xmlData[i] === "!") {
            i = readCommentAndCDATA(xmlData, i);
            continue;
          } else {
            let closingTag = false;
            if (xmlData[i] === "/") {
              closingTag = true;
              i++;
            }
            let tagName = "";
            for (; i < xmlData.length && xmlData[i] !== ">" && xmlData[i] !== " " && xmlData[i] !== "	" && xmlData[i] !== "\n" && xmlData[i] !== "\r"; i++) {
              tagName += xmlData[i];
            }
            tagName = tagName.trim();
            if (tagName[tagName.length - 1] === "/") {
              tagName = tagName.substring(0, tagName.length - 1);
              i--;
            }
            if (!validateTagName(tagName)) {
              let msg;
              if (tagName.trim().length === 0) {
                msg = "Invalid space after '<'.";
              } else {
                msg = "Tag '" + tagName + "' is an invalid name.";
              }
              return getErrorObject("InvalidTag", msg, getLineNumberForPosition(xmlData, i));
            }
            const result = readAttributeStr(xmlData, i);
            if (result === false) {
              return getErrorObject("InvalidAttr", "Attributes for '" + tagName + "' have open quote.", getLineNumberForPosition(xmlData, i));
            }
            let attrStr = result.value;
            i = result.index;
            if (attrStr[attrStr.length - 1] === "/") {
              const attrStrStart = i - attrStr.length;
              attrStr = attrStr.substring(0, attrStr.length - 1);
              const isValid = validateAttributeString(attrStr, options);
              if (isValid === true) {
                tagFound = true;
              } else {
                return getErrorObject(isValid.err.code, isValid.err.msg, getLineNumberForPosition(xmlData, attrStrStart + isValid.err.line));
              }
            } else if (closingTag) {
              if (!result.tagClosed) {
                return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' doesn't have proper closing.", getLineNumberForPosition(xmlData, i));
              } else if (attrStr.trim().length > 0) {
                return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' can't have attributes or invalid starting.", getLineNumberForPosition(xmlData, tagStartPos));
              } else if (tags.length === 0) {
                return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' has not been opened.", getLineNumberForPosition(xmlData, tagStartPos));
              } else {
                const otg = tags.pop();
                if (tagName !== otg.tagName) {
                  let openPos = getLineNumberForPosition(xmlData, otg.tagStartPos);
                  return getErrorObject(
                    "InvalidTag",
                    "Expected closing tag '" + otg.tagName + "' (opened in line " + openPos.line + ", col " + openPos.col + ") instead of closing tag '" + tagName + "'.",
                    getLineNumberForPosition(xmlData, tagStartPos)
                  );
                }
                if (tags.length == 0) {
                  reachedRoot = true;
                }
              }
            } else {
              const isValid = validateAttributeString(attrStr, options);
              if (isValid !== true) {
                return getErrorObject(isValid.err.code, isValid.err.msg, getLineNumberForPosition(xmlData, i - attrStr.length + isValid.err.line));
              }
              if (reachedRoot === true) {
                return getErrorObject("InvalidXml", "Multiple possible root nodes found.", getLineNumberForPosition(xmlData, i));
              } else if (options.unpairedTags.indexOf(tagName) !== -1) {
              } else {
                tags.push({ tagName, tagStartPos });
              }
              tagFound = true;
            }
            for (i++; i < xmlData.length; i++) {
              if (xmlData[i] === "<") {
                if (xmlData[i + 1] === "!") {
                  i++;
                  i = readCommentAndCDATA(xmlData, i);
                  continue;
                } else if (xmlData[i + 1] === "?") {
                  i = readPI(xmlData, ++i);
                  if (i.err) return i;
                } else {
                  break;
                }
              } else if (xmlData[i] === "&") {
                const afterAmp = validateAmpersand(xmlData, i);
                if (afterAmp == -1)
                  return getErrorObject("InvalidChar", "char '&' is not expected.", getLineNumberForPosition(xmlData, i));
                i = afterAmp;
              } else {
                if (reachedRoot === true && !isWhiteSpace(xmlData[i])) {
                  return getErrorObject("InvalidXml", "Extra text at the end", getLineNumberForPosition(xmlData, i));
                }
              }
            }
            if (xmlData[i] === "<") {
              i--;
            }
          }
        } else {
          if (isWhiteSpace(xmlData[i])) {
            continue;
          }
          return getErrorObject("InvalidChar", "char '" + xmlData[i] + "' is not expected.", getLineNumberForPosition(xmlData, i));
        }
      }
      if (!tagFound) {
        return getErrorObject("InvalidXml", "Start tag expected.", 1);
      } else if (tags.length == 1) {
        return getErrorObject("InvalidTag", "Unclosed tag '" + tags[0].tagName + "'.", getLineNumberForPosition(xmlData, tags[0].tagStartPos));
      } else if (tags.length > 0) {
        return getErrorObject("InvalidXml", "Invalid '" + JSON.stringify(tags.map((t) => t.tagName), null, 4).replace(/\r?\n/g, "") + "' found.", { line: 1, col: 1 });
      }
      return true;
    };
    function isWhiteSpace(char) {
      return char === " " || char === "	" || char === "\n" || char === "\r";
    }
    function readPI(xmlData, i) {
      const start = i;
      for (; i < xmlData.length; i++) {
        if (xmlData[i] == "?" || xmlData[i] == " ") {
          const tagname = xmlData.substr(start, i - start);
          if (i > 5 && tagname === "xml") {
            return getErrorObject("InvalidXml", "XML declaration allowed only at the start of the document.", getLineNumberForPosition(xmlData, i));
          } else if (xmlData[i] == "?" && xmlData[i + 1] == ">") {
            i++;
            break;
          } else {
            continue;
          }
        }
      }
      return i;
    }
    function readCommentAndCDATA(xmlData, i) {
      if (xmlData.length > i + 5 && xmlData[i + 1] === "-" && xmlData[i + 2] === "-") {
        for (i += 3; i < xmlData.length; i++) {
          if (xmlData[i] === "-" && xmlData[i + 1] === "-" && xmlData[i + 2] === ">") {
            i += 2;
            break;
          }
        }
      } else if (xmlData.length > i + 8 && xmlData[i + 1] === "D" && xmlData[i + 2] === "O" && xmlData[i + 3] === "C" && xmlData[i + 4] === "T" && xmlData[i + 5] === "Y" && xmlData[i + 6] === "P" && xmlData[i + 7] === "E") {
        let angleBracketsCount = 1;
        for (i += 8; i < xmlData.length; i++) {
          if (xmlData[i] === "<") {
            angleBracketsCount++;
          } else if (xmlData[i] === ">") {
            angleBracketsCount--;
            if (angleBracketsCount === 0) {
              break;
            }
          }
        }
      } else if (xmlData.length > i + 9 && xmlData[i + 1] === "[" && xmlData[i + 2] === "C" && xmlData[i + 3] === "D" && xmlData[i + 4] === "A" && xmlData[i + 5] === "T" && xmlData[i + 6] === "A" && xmlData[i + 7] === "[") {
        for (i += 8; i < xmlData.length; i++) {
          if (xmlData[i] === "]" && xmlData[i + 1] === "]" && xmlData[i + 2] === ">") {
            i += 2;
            break;
          }
        }
      }
      return i;
    }
    var doubleQuote = '"';
    var singleQuote = "'";
    function readAttributeStr(xmlData, i) {
      let attrStr = "";
      let startChar = "";
      let tagClosed = false;
      for (; i < xmlData.length; i++) {
        if (xmlData[i] === doubleQuote || xmlData[i] === singleQuote) {
          if (startChar === "") {
            startChar = xmlData[i];
          } else if (startChar !== xmlData[i]) {
          } else {
            startChar = "";
          }
        } else if (xmlData[i] === ">") {
          if (startChar === "") {
            tagClosed = true;
            break;
          }
        }
        attrStr += xmlData[i];
      }
      if (startChar !== "") {
        return false;
      }
      return {
        value: attrStr,
        index: i,
        tagClosed
      };
    }
    var validAttrStrRegxp = new RegExp(`(\\s*)([^\\s=]+)(\\s*=)?(\\s*(['"])(([\\s\\S])*?)\\5)?`, "g");
    function validateAttributeString(attrStr, options) {
      const matches = util.getAllMatches(attrStr, validAttrStrRegxp);
      const attrNames = {};
      for (let i = 0; i < matches.length; i++) {
        if (matches[i][1].length === 0) {
          return getErrorObject("InvalidAttr", "Attribute '" + matches[i][2] + "' has no space in starting.", getPositionFromMatch(matches[i]));
        } else if (matches[i][3] !== void 0 && matches[i][4] === void 0) {
          return getErrorObject("InvalidAttr", "Attribute '" + matches[i][2] + "' is without value.", getPositionFromMatch(matches[i]));
        } else if (matches[i][3] === void 0 && !options.allowBooleanAttributes) {
          return getErrorObject("InvalidAttr", "boolean attribute '" + matches[i][2] + "' is not allowed.", getPositionFromMatch(matches[i]));
        }
        const attrName = matches[i][2];
        if (!validateAttrName(attrName)) {
          return getErrorObject("InvalidAttr", "Attribute '" + attrName + "' is an invalid name.", getPositionFromMatch(matches[i]));
        }
        if (!attrNames.hasOwnProperty(attrName)) {
          attrNames[attrName] = 1;
        } else {
          return getErrorObject("InvalidAttr", "Attribute '" + attrName + "' is repeated.", getPositionFromMatch(matches[i]));
        }
      }
      return true;
    }
    function validateNumberAmpersand(xmlData, i) {
      let re = /\d/;
      if (xmlData[i] === "x") {
        i++;
        re = /[\da-fA-F]/;
      }
      for (; i < xmlData.length; i++) {
        if (xmlData[i] === ";")
          return i;
        if (!xmlData[i].match(re))
          break;
      }
      return -1;
    }
    function validateAmpersand(xmlData, i) {
      i++;
      if (xmlData[i] === ";")
        return -1;
      if (xmlData[i] === "#") {
        i++;
        return validateNumberAmpersand(xmlData, i);
      }
      let count = 0;
      for (; i < xmlData.length; i++, count++) {
        if (xmlData[i].match(/\w/) && count < 20)
          continue;
        if (xmlData[i] === ";")
          break;
        return -1;
      }
      return i;
    }
    function getErrorObject(code, message, lineNumber) {
      return {
        err: {
          code,
          msg: message,
          line: lineNumber.line || lineNumber,
          col: lineNumber.col
        }
      };
    }
    function validateAttrName(attrName) {
      return util.isName(attrName);
    }
    function validateTagName(tagname) {
      return util.isName(tagname);
    }
    function getLineNumberForPosition(xmlData, index) {
      const lines = xmlData.substring(0, index).split(/\r?\n/);
      return {
        line: lines.length,
        // column number is last line's length + 1, because column numbering starts at 1:
        col: lines[lines.length - 1].length + 1
      };
    }
    function getPositionFromMatch(match) {
      return match.startIndex + match[1].length;
    }
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/OptionsBuilder.js
var require_OptionsBuilder = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/OptionsBuilder.js"(exports) {
    var { DANGEROUS_PROPERTY_NAMES, criticalProperties } = require_util();
    var defaultOnDangerousProperty = (name) => {
      if (DANGEROUS_PROPERTY_NAMES.includes(name)) {
        return "__" + name;
      }
      return name;
    };
    var defaultOptions = {
      preserveOrder: false,
      attributeNamePrefix: "@_",
      attributesGroupName: false,
      textNodeName: "#text",
      ignoreAttributes: true,
      removeNSPrefix: false,
      // remove NS from tag name or attribute name if true
      allowBooleanAttributes: false,
      //a tag can have attributes without any value
      //ignoreRootElement : false,
      parseTagValue: true,
      parseAttributeValue: false,
      trimValues: true,
      //Trim string values of tag and attributes
      cdataPropName: false,
      numberParseOptions: {
        hex: true,
        leadingZeros: true,
        eNotation: true
      },
      tagValueProcessor: function(tagName, val) {
        return val;
      },
      attributeValueProcessor: function(attrName, val) {
        return val;
      },
      stopNodes: [],
      //nested tags will not be parsed even for errors
      alwaysCreateTextNode: false,
      isArray: () => false,
      commentPropName: false,
      unpairedTags: [],
      processEntities: true,
      htmlEntities: false,
      ignoreDeclaration: false,
      ignorePiTags: false,
      transformTagName: false,
      transformAttributeName: false,
      updateTag: function(tagName, jPath, attrs) {
        return tagName;
      },
      // skipEmptyListItem: false
      captureMetaData: false,
      maxNestedTags: 100,
      strictReservedNames: true,
      onDangerousProperty: defaultOnDangerousProperty
    };
    function validatePropertyName(propertyName, optionName) {
      if (typeof propertyName !== "string") {
        return;
      }
      const normalized = propertyName.toLowerCase();
      if (DANGEROUS_PROPERTY_NAMES.some((dangerous) => normalized === dangerous.toLowerCase())) {
        throw new Error(
          `[SECURITY] Invalid ${optionName}: "${propertyName}" is a reserved JavaScript keyword that could cause prototype pollution`
        );
      }
      if (criticalProperties.some((dangerous) => normalized === dangerous.toLowerCase())) {
        throw new Error(
          `[SECURITY] Invalid ${optionName}: "${propertyName}" is a reserved JavaScript keyword that could cause prototype pollution`
        );
      }
    }
    function normalizeProcessEntities(value) {
      if (typeof value === "boolean") {
        return {
          enabled: value,
          // true or false
          maxEntitySize: 1e4,
          maxExpansionDepth: 10,
          maxTotalExpansions: 1e3,
          maxExpandedLength: 1e5,
          allowedTags: null,
          tagFilter: null
        };
      }
      if (typeof value === "object" && value !== null) {
        return {
          enabled: value.enabled !== false,
          maxEntitySize: Math.max(1, value.maxEntitySize ?? 1e4),
          maxExpansionDepth: Math.max(1, value.maxExpansionDepth ?? 1e4),
          maxTotalExpansions: Math.max(1, value.maxTotalExpansions ?? Infinity),
          maxExpandedLength: Math.max(1, value.maxExpandedLength ?? 1e5),
          maxEntityCount: Math.max(1, value.maxEntityCount ?? 1e3),
          allowedTags: value.allowedTags ?? null,
          tagFilter: value.tagFilter ?? null
        };
      }
      return normalizeProcessEntities(true);
    }
    var buildOptions = function(options) {
      const built = Object.assign({}, defaultOptions, options);
      const propertyNameOptions = [
        { value: built.attributeNamePrefix, name: "attributeNamePrefix" },
        { value: built.attributesGroupName, name: "attributesGroupName" },
        { value: built.textNodeName, name: "textNodeName" },
        { value: built.cdataPropName, name: "cdataPropName" },
        { value: built.commentPropName, name: "commentPropName" }
      ];
      for (const { value, name } of propertyNameOptions) {
        if (value) {
          validatePropertyName(value, name);
        }
      }
      if (built.onDangerousProperty === null) {
        built.onDangerousProperty = defaultOnDangerousProperty;
      }
      built.processEntities = normalizeProcessEntities(built.processEntities);
      return built;
    };
    exports.buildOptions = buildOptions;
    exports.defaultOptions = defaultOptions;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/xmlNode.js
var require_xmlNode = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/xmlNode.js"(exports, module) {
    "use strict";
    var XmlNode = class {
      constructor(tagname) {
        this.tagname = tagname;
        this.child = [];
        this[":@"] = {};
      }
      add(key, val) {
        if (key === "__proto__") key = "#__proto__";
        this.child.push({ [key]: val });
      }
      addChild(node) {
        if (node.tagname === "__proto__") node.tagname = "#__proto__";
        if (node[":@"] && Object.keys(node[":@"]).length > 0) {
          this.child.push({ [node.tagname]: node.child, [":@"]: node[":@"] });
        } else {
          this.child.push({ [node.tagname]: node.child });
        }
      }
    };
    module.exports = XmlNode;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/DocTypeReader.js
var require_DocTypeReader = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/DocTypeReader.js"(exports, module) {
    var util = require_util();
    var DocTypeReader = class {
      constructor(options) {
        this.suppressValidationErr = !options;
        this.options = options || {};
      }
      readDocType(xmlData, i) {
        const entities = /* @__PURE__ */ Object.create(null);
        let entityCount = 0;
        if (xmlData[i + 3] === "O" && xmlData[i + 4] === "C" && xmlData[i + 5] === "T" && xmlData[i + 6] === "Y" && xmlData[i + 7] === "P" && xmlData[i + 8] === "E") {
          i = i + 9;
          let angleBracketsCount = 1;
          let hasBody = false, comment = false;
          let exp = "";
          for (; i < xmlData.length; i++) {
            if (xmlData[i] === "<" && !comment) {
              if (hasBody && hasSeq(xmlData, "!ENTITY", i)) {
                i += 7;
                let entityName, val;
                [entityName, val, i] = this.readEntityExp(xmlData, i + 1, this.suppressValidationErr);
                if (val.indexOf("&") === -1) {
                  if (this.options.enabled !== false && this.options.maxEntityCount != null && entityCount >= this.options.maxEntityCount) {
                    throw new Error(
                      `Entity count (${entityCount + 1}) exceeds maximum allowed (${this.options.maxEntityCount})`
                    );
                  }
                  const escaped = entityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  entities[entityName] = {
                    regx: RegExp(`&${escaped};`, "g"),
                    val
                  };
                  entityCount++;
                }
              } else if (hasBody && hasSeq(xmlData, "!ELEMENT", i)) {
                i += 8;
                const { index } = this.readElementExp(xmlData, i + 1);
                i = index;
              } else if (hasBody && hasSeq(xmlData, "!ATTLIST", i)) {
                i += 8;
              } else if (hasBody && hasSeq(xmlData, "!NOTATION", i)) {
                i += 9;
                const { index } = this.readNotationExp(xmlData, i + 1, this.suppressValidationErr);
                i = index;
              } else if (hasSeq(xmlData, "!--", i)) {
                comment = true;
              } else {
                throw new Error(`Invalid DOCTYPE`);
              }
              angleBracketsCount++;
              exp = "";
            } else if (xmlData[i] === ">") {
              if (comment) {
                if (xmlData[i - 1] === "-" && xmlData[i - 2] === "-") {
                  comment = false;
                  angleBracketsCount--;
                }
              } else {
                angleBracketsCount--;
              }
              if (angleBracketsCount === 0) {
                break;
              }
            } else if (xmlData[i] === "[") {
              hasBody = true;
            } else {
              exp += xmlData[i];
            }
          }
          if (angleBracketsCount !== 0) {
            throw new Error(`Unclosed DOCTYPE`);
          }
        } else {
          throw new Error(`Invalid Tag instead of DOCTYPE`);
        }
        return { entities, i };
      }
      readEntityExp(xmlData, i) {
        i = skipWhitespace(xmlData, i);
        let entityName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i]) && xmlData[i] !== '"' && xmlData[i] !== "'") {
          entityName += xmlData[i];
          i++;
        }
        validateEntityName(entityName);
        i = skipWhitespace(xmlData, i);
        if (!this.suppressValidationErr) {
          if (xmlData.substring(i, i + 6).toUpperCase() === "SYSTEM") {
            throw new Error("External entities are not supported");
          } else if (xmlData[i] === "%") {
            throw new Error("Parameter entities are not supported");
          }
        }
        let entityValue = "";
        [i, entityValue] = this.readIdentifierVal(xmlData, i, "entity");
        if (this.options.enabled !== false && this.options.maxEntitySize != null && entityValue.length > this.options.maxEntitySize) {
          throw new Error(
            `Entity "${entityName}" size (${entityValue.length}) exceeds maximum allowed size (${this.options.maxEntitySize})`
          );
        }
        i--;
        return [entityName, entityValue, i];
      }
      readNotationExp(xmlData, i) {
        i = skipWhitespace(xmlData, i);
        let notationName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i])) {
          notationName += xmlData[i];
          i++;
        }
        !this.suppressValidationErr && validateEntityName(notationName);
        i = skipWhitespace(xmlData, i);
        const identifierType = xmlData.substring(i, i + 6).toUpperCase();
        if (!this.suppressValidationErr && identifierType !== "SYSTEM" && identifierType !== "PUBLIC") {
          throw new Error(`Expected SYSTEM or PUBLIC, found "${identifierType}"`);
        }
        i += identifierType.length;
        i = skipWhitespace(xmlData, i);
        let publicIdentifier = null;
        let systemIdentifier = null;
        if (identifierType === "PUBLIC") {
          [i, publicIdentifier] = this.readIdentifierVal(xmlData, i, "publicIdentifier");
          i = skipWhitespace(xmlData, i);
          if (xmlData[i] === '"' || xmlData[i] === "'") {
            [i, systemIdentifier] = this.readIdentifierVal(xmlData, i, "systemIdentifier");
          }
        } else if (identifierType === "SYSTEM") {
          [i, systemIdentifier] = this.readIdentifierVal(xmlData, i, "systemIdentifier");
          if (!this.suppressValidationErr && !systemIdentifier) {
            throw new Error("Missing mandatory system identifier for SYSTEM notation");
          }
        }
        return { notationName, publicIdentifier, systemIdentifier, index: --i };
      }
      readIdentifierVal(xmlData, i, type) {
        let identifierVal = "";
        const startChar = xmlData[i];
        if (startChar !== '"' && startChar !== "'") {
          throw new Error(`Expected quoted string, found "${startChar}"`);
        }
        i++;
        while (i < xmlData.length && xmlData[i] !== startChar) {
          identifierVal += xmlData[i];
          i++;
        }
        if (xmlData[i] !== startChar) {
          throw new Error(`Unterminated ${type} value`);
        }
        i++;
        return [i, identifierVal];
      }
      readElementExp(xmlData, i) {
        i = skipWhitespace(xmlData, i);
        let elementName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i])) {
          elementName += xmlData[i];
          i++;
        }
        if (!this.suppressValidationErr && !util.isName(elementName)) {
          throw new Error(`Invalid element name: "${elementName}"`);
        }
        i = skipWhitespace(xmlData, i);
        let contentModel = "";
        if (xmlData[i] === "E" && hasSeq(xmlData, "MPTY", i)) {
          i += 4;
        } else if (xmlData[i] === "A" && hasSeq(xmlData, "NY", i)) {
          i += 2;
        } else if (xmlData[i] === "(") {
          i++;
          while (i < xmlData.length && xmlData[i] !== ")") {
            contentModel += xmlData[i];
            i++;
          }
          if (xmlData[i] !== ")") {
            throw new Error("Unterminated content model");
          }
        } else if (!this.suppressValidationErr) {
          throw new Error(`Invalid Element Expression, found "${xmlData[i]}"`);
        }
        return {
          elementName,
          contentModel: contentModel.trim(),
          index: i
        };
      }
      readAttlistExp(xmlData, i) {
        i = skipWhitespace(xmlData, i);
        let elementName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i])) {
          elementName += xmlData[i];
          i++;
        }
        validateEntityName(elementName);
        i = skipWhitespace(xmlData, i);
        let attributeName = "";
        while (i < xmlData.length && !/\s/.test(xmlData[i])) {
          attributeName += xmlData[i];
          i++;
        }
        if (!validateEntityName(attributeName)) {
          throw new Error(`Invalid attribute name: "${attributeName}"`);
        }
        i = skipWhitespace(xmlData, i);
        let attributeType = "";
        if (xmlData.substring(i, i + 8).toUpperCase() === "NOTATION") {
          attributeType = "NOTATION";
          i += 8;
          i = skipWhitespace(xmlData, i);
          if (xmlData[i] !== "(") {
            throw new Error(`Expected '(', found "${xmlData[i]}"`);
          }
          i++;
          let allowedNotations = [];
          while (i < xmlData.length && xmlData[i] !== ")") {
            let notation = "";
            while (i < xmlData.length && xmlData[i] !== "|" && xmlData[i] !== ")") {
              notation += xmlData[i];
              i++;
            }
            notation = notation.trim();
            if (!validateEntityName(notation)) {
              throw new Error(`Invalid notation name: "${notation}"`);
            }
            allowedNotations.push(notation);
            if (xmlData[i] === "|") {
              i++;
              i = skipWhitespace(xmlData, i);
            }
          }
          if (xmlData[i] !== ")") {
            throw new Error("Unterminated list of notations");
          }
          i++;
          attributeType += " (" + allowedNotations.join("|") + ")";
        } else {
          while (i < xmlData.length && !/\s/.test(xmlData[i])) {
            attributeType += xmlData[i];
            i++;
          }
          const validTypes = ["CDATA", "ID", "IDREF", "IDREFS", "ENTITY", "ENTITIES", "NMTOKEN", "NMTOKENS"];
          if (!this.suppressValidationErr && !validTypes.includes(attributeType.toUpperCase())) {
            throw new Error(`Invalid attribute type: "${attributeType}"`);
          }
        }
        i = skipWhitespace(xmlData, i);
        let defaultValue = "";
        if (xmlData.substring(i, i + 8).toUpperCase() === "#REQUIRED") {
          defaultValue = "#REQUIRED";
          i += 8;
        } else if (xmlData.substring(i, i + 7).toUpperCase() === "#IMPLIED") {
          defaultValue = "#IMPLIED";
          i += 7;
        } else {
          [i, defaultValue] = this.readIdentifierVal(xmlData, i, "ATTLIST");
        }
        return {
          elementName,
          attributeName,
          attributeType,
          defaultValue,
          index: i
        };
      }
    };
    var skipWhitespace = (data, index) => {
      while (index < data.length && /\s/.test(data[index])) {
        index++;
      }
      return index;
    };
    function hasSeq(data, seq, i) {
      for (let j = 0; j < seq.length; j++) {
        if (seq[j] !== data[i + j + 1]) return false;
      }
      return true;
    }
    function validateEntityName(name) {
      if (util.isName(name))
        return name;
      else
        throw new Error(`Invalid entity name ${name}`);
    }
    module.exports = DocTypeReader;
  }
});

// node_modules/.pnpm/strnum@1.1.2/node_modules/strnum/strnum.js
var require_strnum = __commonJS({
  "node_modules/.pnpm/strnum@1.1.2/node_modules/strnum/strnum.js"(exports, module) {
    var hexRegex = /^[-+]?0x[a-fA-F0-9]+$/;
    var numRegex = /^([\-\+])?(0*)([0-9]*(\.[0-9]*)?)$/;
    var consider = {
      hex: true,
      // oct: false,
      leadingZeros: true,
      decimalPoint: ".",
      eNotation: true
      //skipLike: /regex/
    };
    function toNumber(str, options = {}) {
      options = Object.assign({}, consider, options);
      if (!str || typeof str !== "string") return str;
      let trimmedStr = str.trim();
      if (options.skipLike !== void 0 && options.skipLike.test(trimmedStr)) return str;
      else if (str === "0") return 0;
      else if (options.hex && hexRegex.test(trimmedStr)) {
        return parse_int(trimmedStr, 16);
      } else if (trimmedStr.search(/[eE]/) !== -1) {
        const notation = trimmedStr.match(/^([-\+])?(0*)([0-9]*(\.[0-9]*)?[eE][-\+]?[0-9]+)$/);
        if (notation) {
          if (options.leadingZeros) {
            trimmedStr = (notation[1] || "") + notation[3];
          } else {
            if (notation[2] === "0" && notation[3][0] === ".") {
            } else {
              return str;
            }
          }
          return options.eNotation ? Number(trimmedStr) : str;
        } else {
          return str;
        }
      } else {
        const match = numRegex.exec(trimmedStr);
        if (match) {
          const sign = match[1];
          const leadingZeros = match[2];
          let numTrimmedByZeros = trimZeros(match[3]);
          if (!options.leadingZeros && leadingZeros.length > 0 && sign && trimmedStr[2] !== ".") return str;
          else if (!options.leadingZeros && leadingZeros.length > 0 && !sign && trimmedStr[1] !== ".") return str;
          else if (options.leadingZeros && leadingZeros === str) return 0;
          else {
            const num = Number(trimmedStr);
            const numStr = "" + num;
            if (numStr.search(/[eE]/) !== -1) {
              if (options.eNotation) return num;
              else return str;
            } else if (trimmedStr.indexOf(".") !== -1) {
              if (numStr === "0" && numTrimmedByZeros === "") return num;
              else if (numStr === numTrimmedByZeros) return num;
              else if (sign && numStr === "-" + numTrimmedByZeros) return num;
              else return str;
            }
            if (leadingZeros) {
              return numTrimmedByZeros === numStr || sign + numTrimmedByZeros === numStr ? num : str;
            } else {
              return trimmedStr === numStr || trimmedStr === sign + numStr ? num : str;
            }
          }
        } else {
          return str;
        }
      }
    }
    function trimZeros(numStr) {
      if (numStr && numStr.indexOf(".") !== -1) {
        numStr = numStr.replace(/0+$/, "");
        if (numStr === ".") numStr = "0";
        else if (numStr[0] === ".") numStr = "0" + numStr;
        else if (numStr[numStr.length - 1] === ".") numStr = numStr.substr(0, numStr.length - 1);
        return numStr;
      }
      return numStr;
    }
    function parse_int(numStr, base) {
      if (parseInt) return parseInt(numStr, base);
      else if (Number.parseInt) return Number.parseInt(numStr, base);
      else if (window && window.parseInt) return window.parseInt(numStr, base);
      else throw new Error("parseInt, Number.parseInt, window.parseInt are not supported");
    }
    module.exports = toNumber;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/ignoreAttributes.js
var require_ignoreAttributes = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/ignoreAttributes.js"(exports, module) {
    function getIgnoreAttributesFn(ignoreAttributes) {
      if (typeof ignoreAttributes === "function") {
        return ignoreAttributes;
      }
      if (Array.isArray(ignoreAttributes)) {
        return (attrName) => {
          for (const pattern of ignoreAttributes) {
            if (typeof pattern === "string" && attrName === pattern) {
              return true;
            }
            if (pattern instanceof RegExp && pattern.test(attrName)) {
              return true;
            }
          }
        };
      }
      return () => false;
    }
    module.exports = getIgnoreAttributesFn;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/OrderedObjParser.js
var require_OrderedObjParser = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/OrderedObjParser.js"(exports, module) {
    "use strict";
    var util = require_util();
    var xmlNode = require_xmlNode();
    var DocTypeReader = require_DocTypeReader();
    var toNumber = require_strnum();
    var getIgnoreAttributesFn = require_ignoreAttributes();
    var OrderedObjParser = class {
      constructor(options) {
        this.options = options;
        this.currentNode = null;
        this.tagsNodeStack = [];
        this.docTypeEntities = {};
        this.lastEntities = {
          "apos": { regex: /&(apos|#39|#x27);/g, val: "'" },
          "gt": { regex: /&(gt|#62|#x3E);/g, val: ">" },
          "lt": { regex: /&(lt|#60|#x3C);/g, val: "<" },
          "quot": { regex: /&(quot|#34|#x22);/g, val: '"' }
        };
        this.ampEntity = { regex: /&(amp|#38|#x26);/g, val: "&" };
        this.htmlEntities = {
          "space": { regex: /&(nbsp|#160);/g, val: " " },
          // "lt" : { regex: /&(lt|#60);/g, val: "<" },
          // "gt" : { regex: /&(gt|#62);/g, val: ">" },
          // "amp" : { regex: /&(amp|#38);/g, val: "&" },
          // "quot" : { regex: /&(quot|#34);/g, val: "\"" },
          // "apos" : { regex: /&(apos|#39);/g, val: "'" },
          "cent": { regex: /&(cent|#162);/g, val: "\xA2" },
          "pound": { regex: /&(pound|#163);/g, val: "\xA3" },
          "yen": { regex: /&(yen|#165);/g, val: "\xA5" },
          "euro": { regex: /&(euro|#8364);/g, val: "\u20AC" },
          "copyright": { regex: /&(copy|#169);/g, val: "\xA9" },
          "reg": { regex: /&(reg|#174);/g, val: "\xAE" },
          "inr": { regex: /&(inr|#8377);/g, val: "\u20B9" },
          "num_dec": { regex: /&#([0-9]{1,7});/g, val: (_, str) => fromCodePoint(str, 10, "&#") },
          "num_hex": { regex: /&#x([0-9a-fA-F]{1,6});/g, val: (_, str) => fromCodePoint(str, 16, "&#x") }
        };
        this.addExternalEntities = addExternalEntities;
        this.parseXml = parseXml;
        this.parseTextData = parseTextData;
        this.resolveNameSpace = resolveNameSpace;
        this.buildAttributesMap = buildAttributesMap;
        this.isItStopNode = isItStopNode;
        this.replaceEntitiesValue = replaceEntitiesValue;
        this.readStopNodeData = readStopNodeData;
        this.saveTextToParentTag = saveTextToParentTag;
        this.addChild = addChild;
        this.ignoreAttributesFn = getIgnoreAttributesFn(this.options.ignoreAttributes);
        this.entityExpansionCount = 0;
        this.currentExpandedLength = 0;
        if (this.options.stopNodes && this.options.stopNodes.length > 0) {
          this.stopNodesExact = /* @__PURE__ */ new Set();
          this.stopNodesWildcard = /* @__PURE__ */ new Set();
          for (let i = 0; i < this.options.stopNodes.length; i++) {
            const stopNodeExp = this.options.stopNodes[i];
            if (typeof stopNodeExp !== "string") continue;
            if (stopNodeExp.startsWith("*.")) {
              this.stopNodesWildcard.add(stopNodeExp.substring(2));
            } else {
              this.stopNodesExact.add(stopNodeExp);
            }
          }
        }
      }
    };
    function addExternalEntities(externalEntities) {
      const entKeys = Object.keys(externalEntities);
      for (let i = 0; i < entKeys.length; i++) {
        const ent = entKeys[i];
        const escaped = ent.replace(/[.\-+*:]/g, "\\.");
        this.lastEntities[ent] = {
          regex: new RegExp("&" + escaped + ";", "g"),
          val: externalEntities[ent]
        };
      }
    }
    function parseTextData(val, tagName, jPath, dontTrim, hasAttributes, isLeafNode, escapeEntities) {
      if (val !== void 0) {
        if (this.options.trimValues && !dontTrim) {
          val = val.trim();
        }
        if (val.length > 0) {
          if (!escapeEntities) val = this.replaceEntitiesValue(val, tagName, jPath);
          const newval = this.options.tagValueProcessor(tagName, val, jPath, hasAttributes, isLeafNode);
          if (newval === null || newval === void 0) {
            return val;
          } else if (typeof newval !== typeof val || newval !== val) {
            return newval;
          } else if (this.options.trimValues) {
            return parseValue2(val, this.options.parseTagValue, this.options.numberParseOptions);
          } else {
            const trimmedVal = val.trim();
            if (trimmedVal === val) {
              return parseValue2(val, this.options.parseTagValue, this.options.numberParseOptions);
            } else {
              return val;
            }
          }
        }
      }
    }
    function resolveNameSpace(tagname) {
      if (this.options.removeNSPrefix) {
        const tags = tagname.split(":");
        const prefix = tagname.charAt(0) === "/" ? "/" : "";
        if (tags[0] === "xmlns") {
          return "";
        }
        if (tags.length === 2) {
          tagname = prefix + tags[1];
        }
      }
      return tagname;
    }
    var attrsRegx = new RegExp(`([^\\s=]+)\\s*(=\\s*(['"])([\\s\\S]*?)\\3)?`, "gm");
    function buildAttributesMap(attrStr, jPath, tagName) {
      if (this.options.ignoreAttributes !== true && typeof attrStr === "string") {
        const matches = util.getAllMatches(attrStr, attrsRegx);
        const len = matches.length;
        const attrs = {};
        for (let i = 0; i < len; i++) {
          const attrName = this.resolveNameSpace(matches[i][1]);
          if (this.ignoreAttributesFn(attrName, jPath)) {
            continue;
          }
          let oldVal = matches[i][4];
          let aName = this.options.attributeNamePrefix + attrName;
          if (attrName.length) {
            if (this.options.transformAttributeName) {
              aName = this.options.transformAttributeName(aName);
            }
            aName = sanitizeName(aName, this.options);
            if (oldVal !== void 0) {
              if (this.options.trimValues) {
                oldVal = oldVal.trim();
              }
              oldVal = this.replaceEntitiesValue(oldVal, tagName, jPath);
              const newVal = this.options.attributeValueProcessor(attrName, oldVal, jPath);
              if (newVal === null || newVal === void 0) {
                attrs[aName] = oldVal;
              } else if (typeof newVal !== typeof oldVal || newVal !== oldVal) {
                attrs[aName] = newVal;
              } else {
                attrs[aName] = parseValue2(
                  oldVal,
                  this.options.parseAttributeValue,
                  this.options.numberParseOptions
                );
              }
            } else if (this.options.allowBooleanAttributes) {
              attrs[aName] = true;
            }
          }
        }
        if (!Object.keys(attrs).length) {
          return;
        }
        if (this.options.attributesGroupName) {
          const attrCollection = {};
          attrCollection[this.options.attributesGroupName] = attrs;
          return attrCollection;
        }
        return attrs;
      }
    }
    var parseXml = function(xmlData) {
      xmlData = xmlData.replace(/\r\n?/g, "\n");
      const xmlObj = new xmlNode("!xml");
      let currentNode = xmlObj;
      let textData = "";
      let jPath = "";
      this.entityExpansionCount = 0;
      this.currentExpandedLength = 0;
      const docTypeReader = new DocTypeReader(this.options.processEntities);
      for (let i = 0; i < xmlData.length; i++) {
        const ch = xmlData[i];
        if (ch === "<") {
          if (xmlData[i + 1] === "/") {
            const closeIndex = findClosingIndex(xmlData, ">", i, "Closing Tag is not closed.");
            let tagName = xmlData.substring(i + 2, closeIndex).trim();
            if (this.options.removeNSPrefix) {
              const colonIndex = tagName.indexOf(":");
              if (colonIndex !== -1) {
                tagName = tagName.substr(colonIndex + 1);
              }
            }
            if (this.options.transformTagName) {
              tagName = this.options.transformTagName(tagName);
            }
            if (currentNode) {
              textData = this.saveTextToParentTag(textData, currentNode, jPath);
            }
            const lastTagName = jPath.substring(jPath.lastIndexOf(".") + 1);
            if (tagName && this.options.unpairedTags.indexOf(tagName) !== -1) {
              throw new Error(`Unpaired tag can not be used as closing tag: </${tagName}>`);
            }
            let propIndex = 0;
            if (lastTagName && this.options.unpairedTags.indexOf(lastTagName) !== -1) {
              propIndex = jPath.lastIndexOf(".", jPath.lastIndexOf(".") - 1);
              this.tagsNodeStack.pop();
            } else {
              propIndex = jPath.lastIndexOf(".");
            }
            jPath = jPath.substring(0, propIndex);
            currentNode = this.tagsNodeStack.pop();
            textData = "";
            i = closeIndex;
          } else if (xmlData[i + 1] === "?") {
            let tagData = readTagExp(xmlData, i, false, "?>");
            if (!tagData) throw new Error("Pi Tag is not closed.");
            textData = this.saveTextToParentTag(textData, currentNode, jPath);
            if (this.options.ignoreDeclaration && tagData.tagName === "?xml" || this.options.ignorePiTags) {
            } else {
              const childNode = new xmlNode(tagData.tagName);
              childNode.add(this.options.textNodeName, "");
              if (tagData.tagName !== tagData.tagExp && tagData.attrExpPresent) {
                childNode[":@"] = this.buildAttributesMap(tagData.tagExp, jPath, tagData.tagName);
              }
              this.addChild(currentNode, childNode, jPath, i);
            }
            i = tagData.closeIndex + 1;
          } else if (xmlData.substr(i + 1, 3) === "!--") {
            const endIndex = findClosingIndex(xmlData, "-->", i + 4, "Comment is not closed.");
            if (this.options.commentPropName) {
              const comment = xmlData.substring(i + 4, endIndex - 2);
              textData = this.saveTextToParentTag(textData, currentNode, jPath);
              currentNode.add(this.options.commentPropName, [{ [this.options.textNodeName]: comment }]);
            }
            i = endIndex;
          } else if (xmlData.substr(i + 1, 2) === "!D") {
            const result = docTypeReader.readDocType(xmlData, i);
            this.docTypeEntities = result.entities;
            i = result.i;
          } else if (xmlData.substr(i + 1, 2) === "![") {
            const closeIndex = findClosingIndex(xmlData, "]]>", i, "CDATA is not closed.") - 2;
            const tagExp = xmlData.substring(i + 9, closeIndex);
            textData = this.saveTextToParentTag(textData, currentNode, jPath);
            let val = this.parseTextData(tagExp, currentNode.tagname, jPath, true, false, true, true);
            if (val == void 0) val = "";
            if (this.options.cdataPropName) {
              currentNode.add(this.options.cdataPropName, [{ [this.options.textNodeName]: tagExp }]);
            } else {
              currentNode.add(this.options.textNodeName, val);
            }
            i = closeIndex + 2;
          } else {
            let result = readTagExp(xmlData, i, this.options.removeNSPrefix);
            let tagName = result.tagName;
            const rawTagName = result.rawTagName;
            let tagExp = result.tagExp;
            let attrExpPresent = result.attrExpPresent;
            let closeIndex = result.closeIndex;
            if (this.options.transformTagName) {
              const newTagName = this.options.transformTagName(tagName);
              if (tagExp === tagName) {
                tagExp = newTagName;
              }
              tagName = newTagName;
            }
            if (this.options.strictReservedNames && (tagName === this.options.commentPropName || tagName === this.options.cdataPropName || tagName === this.options.textNodeName || tagName === this.options.attributesGroupName)) {
              throw new Error(`Invalid tag name: ${tagName}`);
            }
            if (currentNode && textData) {
              if (currentNode.tagname !== "!xml") {
                textData = this.saveTextToParentTag(textData, currentNode, jPath, false);
              }
            }
            const lastTag = currentNode;
            if (lastTag && this.options.unpairedTags.indexOf(lastTag.tagname) !== -1) {
              currentNode = this.tagsNodeStack.pop();
              jPath = jPath.substring(0, jPath.lastIndexOf("."));
            }
            if (tagName !== xmlObj.tagname) {
              jPath += jPath ? "." + tagName : tagName;
            }
            const startIndex = i;
            if (this.isItStopNode(this.stopNodesExact, this.stopNodesWildcard, jPath, tagName)) {
              let tagContent = "";
              if (tagExp.length > 0 && tagExp.lastIndexOf("/") === tagExp.length - 1) {
                if (tagName[tagName.length - 1] === "/") {
                  tagName = tagName.substr(0, tagName.length - 1);
                  jPath = jPath.substr(0, jPath.length - 1);
                  tagExp = tagName;
                } else {
                  tagExp = tagExp.substr(0, tagExp.length - 1);
                }
                i = result.closeIndex;
              } else if (this.options.unpairedTags.indexOf(tagName) !== -1) {
                i = result.closeIndex;
              } else {
                const result2 = this.readStopNodeData(xmlData, rawTagName, closeIndex + 1);
                if (!result2) throw new Error(`Unexpected end of ${rawTagName}`);
                i = result2.i;
                tagContent = result2.tagContent;
              }
              const childNode = new xmlNode(tagName);
              if (tagName !== tagExp && attrExpPresent) {
                childNode[":@"] = this.buildAttributesMap(tagExp, jPath, tagName);
              }
              if (tagContent) {
                tagContent = this.parseTextData(tagContent, tagName, jPath, true, attrExpPresent, true, true);
              }
              jPath = jPath.substr(0, jPath.lastIndexOf("."));
              childNode.add(this.options.textNodeName, tagContent);
              this.addChild(currentNode, childNode, jPath, startIndex);
            } else {
              if (tagExp.length > 0 && tagExp.lastIndexOf("/") === tagExp.length - 1) {
                if (tagName[tagName.length - 1] === "/") {
                  tagName = tagName.substr(0, tagName.length - 1);
                  jPath = jPath.substr(0, jPath.length - 1);
                  tagExp = tagName;
                } else {
                  tagExp = tagExp.substr(0, tagExp.length - 1);
                }
                if (this.options.transformTagName) {
                  const newTagName = this.options.transformTagName(tagName);
                  if (tagExp === tagName) {
                    tagExp = newTagName;
                  }
                  tagName = newTagName;
                }
                const childNode = new xmlNode(tagName);
                if (tagName !== tagExp && attrExpPresent) {
                  childNode[":@"] = this.buildAttributesMap(tagExp, jPath, tagName);
                }
                this.addChild(currentNode, childNode, jPath, startIndex);
                jPath = jPath.substr(0, jPath.lastIndexOf("."));
              } else if (this.options.unpairedTags.indexOf(tagName) !== -1) {
                const childNode = new xmlNode(tagName);
                if (tagName !== tagExp && attrExpPresent) {
                  childNode[":@"] = this.buildAttributesMap(tagExp, jPath);
                }
                this.addChild(currentNode, childNode, jPath, startIndex);
                jPath = jPath.substr(0, jPath.lastIndexOf("."));
                i = result.closeIndex;
                continue;
              } else {
                const childNode = new xmlNode(tagName);
                if (this.tagsNodeStack.length > this.options.maxNestedTags) {
                  throw new Error("Maximum nested tags exceeded");
                }
                this.tagsNodeStack.push(currentNode);
                if (tagName !== tagExp && attrExpPresent) {
                  childNode[":@"] = this.buildAttributesMap(tagExp, jPath, tagName);
                }
                this.addChild(currentNode, childNode, jPath);
                currentNode = childNode;
              }
              textData = "";
              i = closeIndex;
            }
          }
        } else {
          textData += xmlData[i];
        }
      }
      return xmlObj.child;
    };
    function addChild(currentNode, childNode, jPath, startIndex) {
      if (!this.options.captureMetaData) startIndex = void 0;
      const result = this.options.updateTag(childNode.tagname, jPath, childNode[":@"]);
      if (result === false) {
      } else if (typeof result === "string") {
        childNode.tagname = result;
        currentNode.addChild(childNode, startIndex);
      } else {
        currentNode.addChild(childNode, startIndex);
      }
    }
    var replaceEntitiesValue = function(val, tagName, jPath) {
      if (val.indexOf("&") === -1) {
        return val;
      }
      const entityConfig = this.options.processEntities;
      if (!entityConfig.enabled) {
        return val;
      }
      if (entityConfig.allowedTags) {
        if (!entityConfig.allowedTags.includes(tagName)) {
          return val;
        }
      }
      if (entityConfig.tagFilter) {
        if (!entityConfig.tagFilter(tagName, jPath)) {
          return val;
        }
      }
      for (let entityName in this.docTypeEntities) {
        const entity = this.docTypeEntities[entityName];
        const matches = val.match(entity.regx);
        if (matches) {
          this.entityExpansionCount += matches.length;
          if (entityConfig.maxTotalExpansions && this.entityExpansionCount > entityConfig.maxTotalExpansions) {
            throw new Error(
              `Entity expansion limit exceeded: ${this.entityExpansionCount} > ${entityConfig.maxTotalExpansions}`
            );
          }
          const lengthBefore = val.length;
          val = val.replace(entity.regx, entity.val);
          if (entityConfig.maxExpandedLength) {
            this.currentExpandedLength += val.length - lengthBefore;
            if (this.currentExpandedLength > entityConfig.maxExpandedLength) {
              throw new Error(
                `Total expanded content size exceeded: ${this.currentExpandedLength} > ${entityConfig.maxExpandedLength}`
              );
            }
          }
        }
      }
      if (val.indexOf("&") === -1) return val;
      for (const entityName of Object.keys(this.lastEntities)) {
        const entity = this.lastEntities[entityName];
        const matches = val.match(entity.regex);
        if (matches) {
          this.entityExpansionCount += matches.length;
          if (entityConfig.maxTotalExpansions && this.entityExpansionCount > entityConfig.maxTotalExpansions) {
            throw new Error(
              `Entity expansion limit exceeded: ${this.entityExpansionCount} > ${entityConfig.maxTotalExpansions}`
            );
          }
        }
        val = val.replace(entity.regex, entity.val);
      }
      if (val.indexOf("&") === -1) return val;
      if (this.options.htmlEntities) {
        for (const entityName of Object.keys(this.htmlEntities)) {
          const entity = this.htmlEntities[entityName];
          const matches = val.match(entity.regex);
          if (matches) {
            this.entityExpansionCount += matches.length;
            if (entityConfig.maxTotalExpansions && this.entityExpansionCount > entityConfig.maxTotalExpansions) {
              throw new Error(
                `Entity expansion limit exceeded: ${this.entityExpansionCount} > ${entityConfig.maxTotalExpansions}`
              );
            }
          }
          val = val.replace(entity.regex, entity.val);
        }
      }
      val = val.replace(this.ampEntity.regex, this.ampEntity.val);
      return val;
    };
    function saveTextToParentTag(textData, parentNode, jPath, isLeafNode) {
      if (textData) {
        if (isLeafNode === void 0) isLeafNode = parentNode.child.length === 0;
        textData = this.parseTextData(
          textData,
          parentNode.tagname,
          jPath,
          false,
          parentNode[":@"] ? Object.keys(parentNode[":@"]).length !== 0 : false,
          isLeafNode
        );
        if (textData !== void 0 && textData !== "")
          parentNode.add(this.options.textNodeName, textData);
        textData = "";
      }
      return textData;
    }
    function isItStopNode(stopNodesExact, stopNodesWildcard, jPath, currentTagName) {
      if (stopNodesWildcard && stopNodesWildcard.has(currentTagName)) return true;
      if (stopNodesExact && stopNodesExact.has(jPath)) return true;
      return false;
    }
    function tagExpWithClosingIndex(xmlData, i, closingChar = ">") {
      let attrBoundary;
      let tagExp = "";
      for (let index = i; index < xmlData.length; index++) {
        let ch = xmlData[index];
        if (attrBoundary) {
          if (ch === attrBoundary) attrBoundary = "";
        } else if (ch === '"' || ch === "'") {
          attrBoundary = ch;
        } else if (ch === closingChar[0]) {
          if (closingChar[1]) {
            if (xmlData[index + 1] === closingChar[1]) {
              return {
                data: tagExp,
                index
              };
            }
          } else {
            return {
              data: tagExp,
              index
            };
          }
        } else if (ch === "	") {
          ch = " ";
        }
        tagExp += ch;
      }
    }
    function findClosingIndex(xmlData, str, i, errMsg) {
      const closingIndex = xmlData.indexOf(str, i);
      if (closingIndex === -1) {
        throw new Error(errMsg);
      } else {
        return closingIndex + str.length - 1;
      }
    }
    function readTagExp(xmlData, i, removeNSPrefix, closingChar = ">") {
      const result = tagExpWithClosingIndex(xmlData, i + 1, closingChar);
      if (!result) return;
      let tagExp = result.data;
      const closeIndex = result.index;
      const separatorIndex = tagExp.search(/\s/);
      let tagName = tagExp;
      let attrExpPresent = true;
      if (separatorIndex !== -1) {
        tagName = tagExp.substring(0, separatorIndex);
        tagExp = tagExp.substring(separatorIndex + 1).trimStart();
      }
      const rawTagName = tagName;
      if (removeNSPrefix) {
        const colonIndex = tagName.indexOf(":");
        if (colonIndex !== -1) {
          tagName = tagName.substr(colonIndex + 1);
          attrExpPresent = tagName !== result.data.substr(colonIndex + 1);
        }
      }
      return {
        tagName,
        tagExp,
        closeIndex,
        attrExpPresent,
        rawTagName
      };
    }
    function readStopNodeData(xmlData, tagName, i) {
      const startIndex = i;
      let openTagCount = 1;
      for (; i < xmlData.length; i++) {
        if (xmlData[i] === "<") {
          if (xmlData[i + 1] === "/") {
            const closeIndex = findClosingIndex(xmlData, ">", i, `${tagName} is not closed`);
            let closeTagName = xmlData.substring(i + 2, closeIndex).trim();
            if (closeTagName === tagName) {
              openTagCount--;
              if (openTagCount === 0) {
                return {
                  tagContent: xmlData.substring(startIndex, i),
                  i: closeIndex
                };
              }
            }
            i = closeIndex;
          } else if (xmlData[i + 1] === "?") {
            const closeIndex = findClosingIndex(xmlData, "?>", i + 1, "StopNode is not closed.");
            i = closeIndex;
          } else if (xmlData.substr(i + 1, 3) === "!--") {
            const closeIndex = findClosingIndex(xmlData, "-->", i + 3, "StopNode is not closed.");
            i = closeIndex;
          } else if (xmlData.substr(i + 1, 2) === "![") {
            const closeIndex = findClosingIndex(xmlData, "]]>", i, "StopNode is not closed.") - 2;
            i = closeIndex;
          } else {
            const tagData = readTagExp(xmlData, i, ">");
            if (tagData) {
              const openTagName = tagData && tagData.tagName;
              if (openTagName === tagName && tagData.tagExp[tagData.tagExp.length - 1] !== "/") {
                openTagCount++;
              }
              i = tagData.closeIndex;
            }
          }
        }
      }
    }
    function parseValue2(val, shouldParse, options) {
      if (shouldParse && typeof val === "string") {
        const newval = val.trim();
        if (newval === "true") return true;
        else if (newval === "false") return false;
        else return toNumber(val, options);
      } else {
        if (util.isExist(val)) {
          return val;
        } else {
          return "";
        }
      }
    }
    function fromCodePoint(str, base, prefix) {
      const codePoint = Number.parseInt(str, base);
      if (codePoint >= 0 && codePoint <= 1114111) {
        return String.fromCodePoint(codePoint);
      } else {
        return prefix + str + ";";
      }
    }
    function sanitizeName(name, options) {
      if (util.criticalProperties.includes(name)) {
        throw new Error(`[SECURITY] Invalid name: "${name}" is a reserved JavaScript keyword that could cause prototype pollution`);
      } else if (util.DANGEROUS_PROPERTY_NAMES.includes(name)) {
        return options.onDangerousProperty(name);
      }
      return name;
    }
    module.exports = OrderedObjParser;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/node2json.js
var require_node2json = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/node2json.js"(exports) {
    "use strict";
    function prettify(node, options) {
      return compress(node, options);
    }
    function compress(arr, options, jPath) {
      let text;
      const compressedObj = {};
      for (let i = 0; i < arr.length; i++) {
        const tagObj = arr[i];
        const property = propName(tagObj);
        let newJpath = "";
        if (jPath === void 0) newJpath = property;
        else newJpath = jPath + "." + property;
        if (property === options.textNodeName) {
          if (text === void 0) text = tagObj[property];
          else text += "" + tagObj[property];
        } else if (property === void 0) {
          continue;
        } else if (tagObj[property]) {
          let val = compress(tagObj[property], options, newJpath);
          const isLeaf = isLeafTag(val, options);
          if (tagObj[":@"]) {
            assignAttributes(val, tagObj[":@"], newJpath, options);
          } else if (Object.keys(val).length === 1 && val[options.textNodeName] !== void 0 && !options.alwaysCreateTextNode) {
            val = val[options.textNodeName];
          } else if (Object.keys(val).length === 0) {
            if (options.alwaysCreateTextNode) val[options.textNodeName] = "";
            else val = "";
          }
          if (compressedObj[property] !== void 0 && compressedObj.hasOwnProperty(property)) {
            if (!Array.isArray(compressedObj[property])) {
              compressedObj[property] = [compressedObj[property]];
            }
            compressedObj[property].push(val);
          } else {
            if (options.isArray(property, newJpath, isLeaf)) {
              compressedObj[property] = [val];
            } else {
              compressedObj[property] = val;
            }
          }
        }
      }
      if (typeof text === "string") {
        if (text.length > 0) compressedObj[options.textNodeName] = text;
      } else if (text !== void 0) compressedObj[options.textNodeName] = text;
      return compressedObj;
    }
    function propName(obj) {
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key !== ":@") return key;
      }
    }
    function assignAttributes(obj, attrMap, jpath, options) {
      if (attrMap) {
        const keys = Object.keys(attrMap);
        const len = keys.length;
        for (let i = 0; i < len; i++) {
          const atrrName = keys[i];
          if (options.isArray(atrrName, jpath + "." + atrrName, true, true)) {
            obj[atrrName] = [attrMap[atrrName]];
          } else {
            obj[atrrName] = attrMap[atrrName];
          }
        }
      }
    }
    function isLeafTag(obj, options) {
      const { textNodeName } = options;
      const propCount = Object.keys(obj).length;
      if (propCount === 0) {
        return true;
      }
      if (propCount === 1 && (obj[textNodeName] || typeof obj[textNodeName] === "boolean" || obj[textNodeName] === 0)) {
        return true;
      }
      return false;
    }
    exports.prettify = prettify;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/XMLParser.js
var require_XMLParser = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlparser/XMLParser.js"(exports, module) {
    var { buildOptions } = require_OptionsBuilder();
    var OrderedObjParser = require_OrderedObjParser();
    var { prettify } = require_node2json();
    var validator = require_validator();
    var XMLParser3 = class {
      constructor(options) {
        this.externalEntities = {};
        this.options = buildOptions(options);
      }
      /**
       * Parse XML dats to JS object 
       * @param {string|Buffer} xmlData 
       * @param {boolean|Object} validationOption 
       */
      parse(xmlData, validationOption) {
        if (typeof xmlData === "string") {
        } else if (xmlData.toString) {
          xmlData = xmlData.toString();
        } else {
          throw new Error("XML data is accepted in String or Bytes[] form.");
        }
        if (validationOption) {
          if (validationOption === true) validationOption = {};
          const result = validator.validate(xmlData, validationOption);
          if (result !== true) {
            throw Error(`${result.err.msg}:${result.err.line}:${result.err.col}`);
          }
        }
        const orderedObjParser = new OrderedObjParser(this.options);
        orderedObjParser.addExternalEntities(this.externalEntities);
        const orderedResult = orderedObjParser.parseXml(xmlData);
        if (this.options.preserveOrder || orderedResult === void 0) return orderedResult;
        else return prettify(orderedResult, this.options);
      }
      /**
       * Add Entity which is not by default supported by this library
       * @param {string} key 
       * @param {string} value 
       */
      addEntity(key, value) {
        if (value.indexOf("&") !== -1) {
          throw new Error("Entity value can't have '&'");
        } else if (key.indexOf("&") !== -1 || key.indexOf(";") !== -1) {
          throw new Error("An entity must be set without '&' and ';'. Eg. use '#xD' for '&#xD;'");
        } else if (value === "&") {
          throw new Error("An entity with value '&' is not permitted");
        } else {
          this.externalEntities[key] = value;
        }
      }
    };
    module.exports = XMLParser3;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlbuilder/orderedJs2Xml.js
var require_orderedJs2Xml = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlbuilder/orderedJs2Xml.js"(exports, module) {
    var EOL = "\n";
    function toXml(jArray, options) {
      let indentation = "";
      if (options.format && options.indentBy.length > 0) {
        indentation = EOL;
      }
      return arrToStr(jArray, options, "", indentation);
    }
    function arrToStr(arr, options, jPath, indentation) {
      let xmlStr = "";
      let isPreviousElementTag = false;
      if (!Array.isArray(arr)) {
        if (arr !== void 0 && arr !== null) {
          let text = arr.toString();
          text = replaceEntitiesValue(text, options);
          return text;
        }
        return "";
      }
      for (let i = 0; i < arr.length; i++) {
        const tagObj = arr[i];
        const tagName = propName(tagObj);
        if (tagName === void 0) continue;
        let newJPath = "";
        if (jPath.length === 0) newJPath = tagName;
        else newJPath = `${jPath}.${tagName}`;
        if (tagName === options.textNodeName) {
          let tagText = tagObj[tagName];
          if (!isStopNode(newJPath, options)) {
            tagText = options.tagValueProcessor(tagName, tagText);
            tagText = replaceEntitiesValue(tagText, options);
          }
          if (isPreviousElementTag) {
            xmlStr += indentation;
          }
          xmlStr += tagText;
          isPreviousElementTag = false;
          continue;
        } else if (tagName === options.cdataPropName) {
          if (isPreviousElementTag) {
            xmlStr += indentation;
          }
          xmlStr += `<![CDATA[${tagObj[tagName][0][options.textNodeName]}]]>`;
          isPreviousElementTag = false;
          continue;
        } else if (tagName === options.commentPropName) {
          xmlStr += indentation + `<!--${tagObj[tagName][0][options.textNodeName]}-->`;
          isPreviousElementTag = true;
          continue;
        } else if (tagName[0] === "?") {
          const attStr2 = attr_to_str(tagObj[":@"], options);
          const tempInd = tagName === "?xml" ? "" : indentation;
          let piTextNodeName = tagObj[tagName][0][options.textNodeName];
          piTextNodeName = piTextNodeName.length !== 0 ? " " + piTextNodeName : "";
          xmlStr += tempInd + `<${tagName}${piTextNodeName}${attStr2}?>`;
          isPreviousElementTag = true;
          continue;
        }
        let newIdentation = indentation;
        if (newIdentation !== "") {
          newIdentation += options.indentBy;
        }
        const attStr = attr_to_str(tagObj[":@"], options);
        const tagStart = indentation + `<${tagName}${attStr}`;
        const tagValue = arrToStr(tagObj[tagName], options, newJPath, newIdentation);
        if (options.unpairedTags.indexOf(tagName) !== -1) {
          if (options.suppressUnpairedNode) xmlStr += tagStart + ">";
          else xmlStr += tagStart + "/>";
        } else if ((!tagValue || tagValue.length === 0) && options.suppressEmptyNode) {
          xmlStr += tagStart + "/>";
        } else if (tagValue && tagValue.endsWith(">")) {
          xmlStr += tagStart + `>${tagValue}${indentation}</${tagName}>`;
        } else {
          xmlStr += tagStart + ">";
          if (tagValue && indentation !== "" && (tagValue.includes("/>") || tagValue.includes("</"))) {
            xmlStr += indentation + options.indentBy + tagValue + indentation;
          } else {
            xmlStr += tagValue;
          }
          xmlStr += `</${tagName}>`;
        }
        isPreviousElementTag = true;
      }
      return xmlStr;
    }
    function propName(obj) {
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        if (key !== ":@") return key;
      }
    }
    function attr_to_str(attrMap, options) {
      let attrStr = "";
      if (attrMap && !options.ignoreAttributes) {
        for (let attr2 in attrMap) {
          if (!Object.prototype.hasOwnProperty.call(attrMap, attr2)) continue;
          let attrVal = options.attributeValueProcessor(attr2, attrMap[attr2]);
          attrVal = replaceEntitiesValue(attrVal, options);
          if (attrVal === true && options.suppressBooleanAttributes) {
            attrStr += ` ${attr2.substr(options.attributeNamePrefix.length)}`;
          } else {
            attrStr += ` ${attr2.substr(options.attributeNamePrefix.length)}="${attrVal}"`;
          }
        }
      }
      return attrStr;
    }
    function isStopNode(jPath, options) {
      jPath = jPath.substr(0, jPath.length - options.textNodeName.length - 1);
      let tagName = jPath.substr(jPath.lastIndexOf(".") + 1);
      for (let index in options.stopNodes) {
        if (options.stopNodes[index] === jPath || options.stopNodes[index] === "*." + tagName) return true;
      }
      return false;
    }
    function replaceEntitiesValue(textValue, options) {
      if (textValue && textValue.length > 0 && options.processEntities) {
        for (let i = 0; i < options.entities.length; i++) {
          const entity = options.entities[i];
          textValue = textValue.replace(entity.regex, entity.val);
        }
      }
      return textValue;
    }
    module.exports = toXml;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlbuilder/json2xml.js
var require_json2xml = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/xmlbuilder/json2xml.js"(exports, module) {
    "use strict";
    var buildFromOrderedJs = require_orderedJs2Xml();
    var getIgnoreAttributesFn = require_ignoreAttributes();
    var defaultOptions = {
      attributeNamePrefix: "@_",
      attributesGroupName: false,
      textNodeName: "#text",
      ignoreAttributes: true,
      cdataPropName: false,
      format: false,
      indentBy: "  ",
      suppressEmptyNode: false,
      suppressUnpairedNode: true,
      suppressBooleanAttributes: true,
      tagValueProcessor: function(key, a) {
        return a;
      },
      attributeValueProcessor: function(attrName, a) {
        return a;
      },
      preserveOrder: false,
      commentPropName: false,
      unpairedTags: [],
      entities: [
        { regex: new RegExp("&", "g"), val: "&amp;" },
        //it must be on top
        { regex: new RegExp(">", "g"), val: "&gt;" },
        { regex: new RegExp("<", "g"), val: "&lt;" },
        { regex: new RegExp("'", "g"), val: "&apos;" },
        { regex: new RegExp('"', "g"), val: "&quot;" }
      ],
      processEntities: true,
      stopNodes: [],
      // transformTagName: false,
      // transformAttributeName: false,
      oneListGroup: false
    };
    function Builder(options) {
      this.options = Object.assign({}, defaultOptions, options);
      if (this.options.ignoreAttributes === true || this.options.attributesGroupName) {
        this.isAttribute = function() {
          return false;
        };
      } else {
        this.ignoreAttributesFn = getIgnoreAttributesFn(this.options.ignoreAttributes);
        this.attrPrefixLen = this.options.attributeNamePrefix.length;
        this.isAttribute = isAttribute;
      }
      this.processTextOrObjNode = processTextOrObjNode;
      if (this.options.format) {
        this.indentate = indentate;
        this.tagEndChar = ">\n";
        this.newLine = "\n";
      } else {
        this.indentate = function() {
          return "";
        };
        this.tagEndChar = ">";
        this.newLine = "";
      }
    }
    Builder.prototype.build = function(jObj) {
      if (this.options.preserveOrder) {
        return buildFromOrderedJs(jObj, this.options);
      } else {
        if (Array.isArray(jObj) && this.options.arrayNodeName && this.options.arrayNodeName.length > 1) {
          jObj = {
            [this.options.arrayNodeName]: jObj
          };
        }
        return this.j2x(jObj, 0, []).val;
      }
    };
    Builder.prototype.j2x = function(jObj, level, ajPath) {
      let attrStr = "";
      let val = "";
      const jPath = ajPath.join(".");
      for (let key in jObj) {
        if (!Object.prototype.hasOwnProperty.call(jObj, key)) continue;
        if (typeof jObj[key] === "undefined") {
          if (this.isAttribute(key)) {
            val += "";
          }
        } else if (jObj[key] === null) {
          if (this.isAttribute(key)) {
            val += "";
          } else if (key === this.options.cdataPropName) {
            val += "";
          } else if (key[0] === "?") {
            val += this.indentate(level) + "<" + key + "?" + this.tagEndChar;
          } else {
            val += this.indentate(level) + "<" + key + "/" + this.tagEndChar;
          }
        } else if (jObj[key] instanceof Date) {
          val += this.buildTextValNode(jObj[key], key, "", level);
        } else if (typeof jObj[key] !== "object") {
          const attr2 = this.isAttribute(key);
          if (attr2 && !this.ignoreAttributesFn(attr2, jPath)) {
            attrStr += this.buildAttrPairStr(attr2, "" + jObj[key]);
          } else if (!attr2) {
            if (key === this.options.textNodeName) {
              let newval = this.options.tagValueProcessor(key, "" + jObj[key]);
              val += this.replaceEntitiesValue(newval);
            } else {
              val += this.buildTextValNode(jObj[key], key, "", level);
            }
          }
        } else if (Array.isArray(jObj[key])) {
          const arrLen = jObj[key].length;
          let listTagVal = "";
          let listTagAttr = "";
          for (let j = 0; j < arrLen; j++) {
            const item = jObj[key][j];
            if (typeof item === "undefined") {
            } else if (item === null) {
              if (key[0] === "?") val += this.indentate(level) + "<" + key + "?" + this.tagEndChar;
              else val += this.indentate(level) + "<" + key + "/" + this.tagEndChar;
            } else if (typeof item === "object") {
              if (this.options.oneListGroup) {
                const result = this.j2x(item, level + 1, ajPath.concat(key));
                listTagVal += result.val;
                if (this.options.attributesGroupName && item.hasOwnProperty(this.options.attributesGroupName)) {
                  listTagAttr += result.attrStr;
                }
              } else {
                listTagVal += this.processTextOrObjNode(item, key, level, ajPath);
              }
            } else {
              if (this.options.oneListGroup) {
                let textValue = this.options.tagValueProcessor(key, item);
                textValue = this.replaceEntitiesValue(textValue);
                listTagVal += textValue;
              } else {
                listTagVal += this.buildTextValNode(item, key, "", level);
              }
            }
          }
          if (this.options.oneListGroup) {
            listTagVal = this.buildObjectNode(listTagVal, key, listTagAttr, level);
          }
          val += listTagVal;
        } else {
          if (this.options.attributesGroupName && key === this.options.attributesGroupName) {
            const Ks = Object.keys(jObj[key]);
            const L = Ks.length;
            for (let j = 0; j < L; j++) {
              attrStr += this.buildAttrPairStr(Ks[j], "" + jObj[key][Ks[j]]);
            }
          } else {
            val += this.processTextOrObjNode(jObj[key], key, level, ajPath);
          }
        }
      }
      return { attrStr, val };
    };
    Builder.prototype.buildAttrPairStr = function(attrName, val) {
      val = this.options.attributeValueProcessor(attrName, "" + val);
      val = this.replaceEntitiesValue(val);
      if (this.options.suppressBooleanAttributes && val === "true") {
        return " " + attrName;
      } else return " " + attrName + '="' + val + '"';
    };
    function processTextOrObjNode(object, key, level, ajPath) {
      const result = this.j2x(object, level + 1, ajPath.concat(key));
      if (object[this.options.textNodeName] !== void 0 && Object.keys(object).length === 1) {
        return this.buildTextValNode(object[this.options.textNodeName], key, result.attrStr, level);
      } else {
        return this.buildObjectNode(result.val, key, result.attrStr, level);
      }
    }
    Builder.prototype.buildObjectNode = function(val, key, attrStr, level) {
      if (val === "") {
        if (key[0] === "?") return this.indentate(level) + "<" + key + attrStr + "?" + this.tagEndChar;
        else {
          return this.indentate(level) + "<" + key + attrStr + this.closeTag(key) + this.tagEndChar;
        }
      } else {
        let tagEndExp = "</" + key + this.tagEndChar;
        let piClosingChar = "";
        if (key[0] === "?") {
          piClosingChar = "?";
          tagEndExp = "";
        }
        if ((attrStr || attrStr === "") && val.indexOf("<") === -1) {
          return this.indentate(level) + "<" + key + attrStr + piClosingChar + ">" + val + tagEndExp;
        } else if (this.options.commentPropName !== false && key === this.options.commentPropName && piClosingChar.length === 0) {
          return this.indentate(level) + `<!--${val}-->` + this.newLine;
        } else {
          return this.indentate(level) + "<" + key + attrStr + piClosingChar + this.tagEndChar + val + this.indentate(level) + tagEndExp;
        }
      }
    };
    Builder.prototype.closeTag = function(key) {
      let closeTag = "";
      if (this.options.unpairedTags.indexOf(key) !== -1) {
        if (!this.options.suppressUnpairedNode) closeTag = "/";
      } else if (this.options.suppressEmptyNode) {
        closeTag = "/";
      } else {
        closeTag = `></${key}`;
      }
      return closeTag;
    };
    Builder.prototype.buildTextValNode = function(val, key, attrStr, level) {
      if (this.options.cdataPropName !== false && key === this.options.cdataPropName) {
        return this.indentate(level) + `<![CDATA[${val}]]>` + this.newLine;
      } else if (this.options.commentPropName !== false && key === this.options.commentPropName) {
        return this.indentate(level) + `<!--${val}-->` + this.newLine;
      } else if (key[0] === "?") {
        return this.indentate(level) + "<" + key + attrStr + "?" + this.tagEndChar;
      } else {
        let textValue = this.options.tagValueProcessor(key, val);
        textValue = this.replaceEntitiesValue(textValue);
        if (textValue === "") {
          return this.indentate(level) + "<" + key + attrStr + this.closeTag(key) + this.tagEndChar;
        } else {
          return this.indentate(level) + "<" + key + attrStr + ">" + textValue + "</" + key + this.tagEndChar;
        }
      }
    };
    Builder.prototype.replaceEntitiesValue = function(textValue) {
      if (textValue && textValue.length > 0 && this.options.processEntities) {
        for (let i = 0; i < this.options.entities.length; i++) {
          const entity = this.options.entities[i];
          textValue = textValue.replace(entity.regex, entity.val);
        }
      }
      return textValue;
    };
    function indentate(level) {
      return this.options.indentBy.repeat(level);
    }
    function isAttribute(name) {
      if (name.startsWith(this.options.attributeNamePrefix) && name !== this.options.textNodeName) {
        return name.substr(this.attrPrefixLen);
      } else {
        return false;
      }
    }
    module.exports = Builder;
  }
});

// node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/fxp.js
var require_fxp = __commonJS({
  "node_modules/.pnpm/fast-xml-parser@4.5.6/node_modules/fast-xml-parser/src/fxp.js"(exports, module) {
    "use strict";
    var validator = require_validator();
    var XMLParser3 = require_XMLParser();
    var XMLBuilder = require_json2xml();
    module.exports = {
      XMLParser: XMLParser3,
      XMLValidator: validator,
      XMLBuilder
    };
  }
});

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/core/bank.js
var import_fast_xml_parser = __toESM(require_fxp(), 1);

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/crypto/sha1.js
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
    for (let i = 0; i < 16; i++)
      words[i] = view.getUint32(offset + i * 4, false);
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
  for (let shift = 28; shift >= 0; shift -= 4)
    out += HEX[value >>> shift & 15];
  return out;
}

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/core/bank.js
var XML_PARSER = new import_fast_xml_parser.XMLParser({
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
    if (section)
      bank.sections.push(section);
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
        for (const [name, value] of Object.entries(attrs))
          out += ` ${name}="${escapeAttr(value)}"`;
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
          if (node.type !== "text")
            payload += node.value;
        }
      } else if (key.value !== void 0) {
        payload += "Value" + key.value.type;
        if (key.value.type !== "text")
          payload += key.value.value;
      }
    }
  }
  return sha1Hex(payload).toUpperCase();
}
function verifyBankSignature(bank, info) {
  if (bank.signature === void 0)
    return false;
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
  if (type === "flag")
    return { type, value: value === true || value === 1 ? "1" : "0" };
  if (type === "point" && typeof value === "object" && "x" in value && "y" in value) {
    return { type, value: `${formatFixed(value.x)},${formatFixed(value.y)}` };
  }
  return { type, value: String(value) };
}
function parseSection(node) {
  const name = attr(node, "name");
  if (name === void 0)
    return void 0;
  const section = { name, keys: [] };
  if (!isRecord(node))
    return section;
  for (const keyNode of toArray(node["Key"])) {
    const key = parseKey(keyNode);
    if (key)
      section.keys.push(key);
  }
  return section;
}
function parseKey(node) {
  const name = attr(node, "name");
  if (name === void 0)
    return void 0;
  const key = { name };
  if (!isRecord(node))
    return key;
  const valueNode = first(node["Value"]);
  if (valueNode !== void 0) {
    const value = parseValue(valueNode);
    if (value)
      key.value = value;
  }
  const nodes = [];
  for (const [tag, child] of Object.entries(node)) {
    if (tag === "Value" || tag === "#text" || tag.startsWith("@_") || tag.startsWith("?"))
      continue;
    for (const item of toArray(child)) {
      const parsed = parseNode(tag, item);
      if (parsed)
        nodes.push(parsed);
    }
  }
  if (nodes.length > 0)
    key.nodes = nodes;
  return key;
}
function parseValue(node) {
  const attrs = attrsOf(node);
  const [type, value] = Object.entries(attrs)[0] ?? [];
  if (type === void 0 || value === void 0)
    return void 0;
  return { type, value };
}
function parseNode(name, node) {
  const attrs = attrsOf(node);
  const firstTyped = Object.entries(attrs).find(([key]) => !VALUE_TYPES.has(key.toLowerCase())) ?? Object.entries(attrs)[0];
  if (firstTyped === void 0)
    return void 0;
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
    if (diff !== 0)
      return diff;
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
  if (value === void 0 || value === null)
    return [];
  return Array.isArray(value) ? value : [value];
}
function attr(node, name) {
  if (!isRecord(node))
    return void 0;
  const value = node[`@_${name}`];
  return value !== void 0 ? String(value) : void 0;
}
function attrsOf(node) {
  const out = {};
  if (!isRecord(node))
    return out;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_"))
      out[key.slice(2)] = String(value);
  }
  return out;
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/core/bank-list.js
var import_fast_xml_parser2 = __toESM(require_fxp(), 1);
var XML_PARSER2 = new import_fast_xml_parser2.XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  allowBooleanAttributes: true
});
function parseBankList(xmlText) {
  const raw = XML_PARSER2.parse(xmlText);
  const root = raw["BankList"];
  if (!isRecord2(root))
    throw new Error("BankList XML must contain a <BankList> root");
  const banks = [];
  for (const item of toArray2(root["Bank"])) {
    if (!isRecord2(item))
      continue;
    const attrs = attrsOf2(item);
    const name = attrs["Name"] ?? attrs["name"];
    const player = attrs["Player"] ?? attrs["player"];
    if (name === void 0 || player === void 0)
      continue;
    banks.push({ name, player, attrs });
  }
  return { banks };
}
function serializeBankList(list) {
  let out = '<?xml version="1.0" encoding="utf-8"?>\n<BankList>\n';
  for (const bank of list.banks) {
    const attrs = { ...bank.attrs, Name: bank.name, Player: bank.player };
    out += "    <Bank";
    for (const [name, value] of Object.entries(attrs))
      out += ` ${name}="${escapeAttr2(value)}"`;
    out += "/>\n";
  }
  out += "</BankList>\n";
  return out;
}
function getBankListNames(list) {
  return [...new Set(list.banks.map((bank) => bank.name))];
}
function matchBankListToDiscovered(list, discovered) {
  return list.banks.map((entry2) => ({
    entry: entry2,
    discovered: discovered.filter((file) => file.info.bankName.toLowerCase() === entry2.name.toLowerCase())
  }));
}
function toArray2(value) {
  if (value === void 0 || value === null)
    return [];
  return Array.isArray(value) ? value : [value];
}
function attrsOf2(node) {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_"))
      out[key.slice(2)] = String(value);
  }
  return out;
}
function escapeAttr2(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/core/editor.js
var SC2BankEditor = class _SC2BankEditor {
  bank;
  signatureInfo;
  constructor(bank, signatureInfo) {
    this.bank = bank;
    if (signatureInfo !== void 0)
      this.signatureInfo = signatureInfo;
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
    if (value === void 0)
      return fallback;
    const coerced = coerceBankValue(value);
    return typeof coerced === "number" ? Math.trunc(coerced) : parseInt(String(coerced), 10);
  }
  getFixed(sectionName, keyName, fallback) {
    const value = this.get(sectionName, keyName);
    if (value === void 0)
      return fallback;
    const coerced = coerceBankValue(value);
    return typeof coerced === "number" ? coerced : parseFloat(String(coerced));
  }
  getFlag(sectionName, keyName, fallback) {
    const value = this.get(sectionName, keyName);
    if (value === void 0)
      return fallback;
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
    if (section === void 0)
      return false;
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
    if (sorted.version !== void 0)
      this.bank.version = sorted.version;
    else
      delete this.bank.version;
    if (sorted.signature !== void 0)
      this.bank.signature = sorted.signature;
    else
      delete this.bank.signature;
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
    if (existing !== void 0)
      return existing;
    const section = { name: sectionName, keys: [] };
    this.bank.sections.push(section);
    return section;
  }
  ensureKey(section, keyName) {
    const existing = getBankKey(this.bank, section.name, keyName);
    if (existing !== void 0)
      return existing;
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

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/core/path-core.js
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
  if (authorId === void 0)
    missing.push("authorId");
  if (playerId === void 0)
    missing.push("playerId");
  return {
    bankName,
    ...authorId !== void 0 ? { authorId } : {},
    ...playerId !== void 0 ? { playerId } : {},
    bankPath: normalized,
    missing
  };
}
function toSignatureInfo(info) {
  if (info.authorId === void 0 || info.playerId === void 0)
    return void 0;
  return { bankName: info.bankName, authorId: info.authorId, playerId: info.playerId };
}
function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/core/validate.js
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
  if (key.value !== void 0)
    validateValue(key.value, `${keyPath}/Value`, findings, options);
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
      if (!INT_RE.test(value.value))
        add(findings, "error", "invalid-int", `Invalid int value "${value.value}"`, path);
      break;
    case "fixed":
      if (!FIXED_RE.test(value.value))
        add(findings, "error", "invalid-fixed", `Invalid fixed value "${value.value}"`, path);
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
    add(findings, options.requireSignature === true ? "error" : "warning", "missing-signature", "Bank has no Signature element", "/Signature");
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

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/core/patcher.js
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
      if (closeIdx === -1)
        return null;
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
      if (closeIdx === -1)
        return null;
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
    if (!typeAttr)
      return null;
    return [from + selfM.index, from + selfM.index + selfM[0].length, typeAttr];
  }
  const openRe = /<Value(\s[^>]*)>/;
  const openM = openRe.exec(slice);
  if (openM) {
    const closeM = slice.indexOf("</Value>", openM.index + openM[0].length);
    if (closeM === -1)
      return null;
    const typeAttr = detectTypeAttr(openM[1] ?? "");
    if (!typeAttr)
      return null;
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
    if (new RegExp(`\\b${t}\\s*=`).test(attrs))
      return t;
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

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/core/errors.js
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

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/assets/cancellation.js
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
var CancellationTokenNone = createToken(() => false, () => NOOP_SUBSCRIPTION);
var CancellationTokenCancelled = createToken(() => true, (listener) => {
  listener();
  return NOOP_SUBSCRIPTION;
});
var CancellationError = class extends Error {
  name = "CancellationError";
  constructor(message = "Operation was cancelled") {
    super(message);
  }
};
function throwIfCancelled(token, message) {
  if (token?.isCancellationRequested)
    throw new CancellationError(message);
}

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/assets/json.js
var DEFAULT_MAX_DEPTH = 64;
function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}
function isJsonSerializable(value, maxDepth = DEFAULT_MAX_DEPTH) {
  return check(value, maxDepth, /* @__PURE__ */ new Set(), false);
}
function check(value, depth, seen, insideArray) {
  if (depth < 0)
    return false;
  if (value === null)
    return true;
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
  if (seen.has(object))
    return false;
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return object.every((entry2) => check(entry2, depth - 1, seen, true));
    }
    if (!isPlainObject(object))
      return false;
    return Object.values(object).every((entry2) => check(entry2, depth - 1, seen, false));
  } finally {
    seen.delete(object);
  }
}

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/assets/operations.js
function operationHandlerId(operation) {
  return operation.handlerId ?? operation.id;
}

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/assets/artifact-session.js
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
    if (init.onDispose !== void 0)
      this.onDispose = init.onDispose;
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
    const operation = this.descriptor.operations.find((candidate) => operationHandlerId(candidate) === handlerId);
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
    const missingPermissions = (operation.permissions ?? []).filter((permission) => !this.permissions.has(permission));
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

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/assets/codec-manifest.js
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

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/assets/source.js
async function readSourceHeader(source, byteCount, cancellation) {
  return source.readRange({ offset: 0, length: byteCount }, cancellation ? { cancellation } : void 0);
}

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/assets/descriptor.js
var ASSET_DESCRIPTOR_SCHEMA_VERSION = 1;

// node_modules/.pnpm/@modkit+core@file+vendor+modkit-core-0.1.0.tgz/node_modules/@modkit/core/dist/ids.js
var OPERATION_DOMAINS = Object.freeze([
  "archive",
  "model",
  "image",
  "audio",
  "video",
  "vector",
  "document",
  "game",
  "map",
  "mod",
  "data",
  "script",
  "layout",
  "localization",
  "replay",
  "save",
  "runtime"
]);
var CONTAINER_EXTRACT_OPERATION_ID = "container.extract";
var SHARED_OPERATION_IDS = Object.freeze([
  "view.render",
  "view.inspect",
  "view.thumbnail",
  "view.hex",
  "view.template",
  "media.play",
  "media.play-pause",
  "media.seek",
  "media.set-rate",
  "media.select-track",
  "edit.content",
  "edit.structure",
  "edit.field",
  "edit.undo-redo",
  "source.save",
  "source.save-as",
  "export.raw",
  "export.convert",
  CONTAINER_EXTRACT_OPERATION_ID,
  "container.pack",
  "asset.search",
  "asset.validate",
  "asset.compare",
  "subject.compare",
  "subject.select",
  "content.resolve-dependencies",
  "content.mount"
]);

// node_modules/.pnpm/@modkit+core@file+vendor+modkit-core-0.1.0.tgz/node_modules/@modkit/core/dist/immutability.js
function deepFreeze(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const visit = (candidate) => {
    if (typeof candidate !== "object" || candidate === null || seen.has(candidate))
      return;
    seen.add(candidate);
    for (const key of Reflect.ownKeys(candidate)) {
      visit(candidate[key]);
    }
    Object.freeze(candidate);
  };
  visit(value);
  return value;
}

// node_modules/.pnpm/@modkit+core@file+vendor+modkit-core-0.1.0.tgz/node_modules/@modkit/core/dist/source-span.js
var UINT64_MAX_DECIMAL = "18446744073709551615";
function fixedWidthDecimalAtMost(maximum) {
  const alternatives = [maximum];
  for (let index = 1; index < maximum.length; index += 1) {
    const maximumDigit = Number(maximum[index]);
    if (maximumDigit === 0)
      continue;
    const prefix = maximum.slice(0, index);
    const lowerDigit = maximumDigit === 1 ? "0" : `[0-${maximumDigit - 1}]`;
    const remaining = maximum.length - index - 1;
    const suffix = remaining === 0 ? "" : `[0-9]{${remaining}}`;
    alternatives.push(`${prefix}${lowerDigit}${suffix}`);
  }
  return `(?:${alternatives.join("|")})`;
}
var UINT64_DECIMAL_PATTERN = `^(?:0|[1-9][0-9]{0,18}|${fixedWidthDecimalAtMost(UINT64_MAX_DECIMAL)})$`;
var byteCoordinateProperties = {
  byteOffset: { type: "string", pattern: UINT64_DECIMAL_PATTERN },
  byteLength: { type: "string", pattern: UINT64_DECIMAL_PATTERN }
};
var textCoordinateProperties = {
  utf16Offset: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  utf16Length: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  line: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  column: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
};
var sourceSpanSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.modkit.org/x3/source-span.v1.schema.json",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["byteOffset", "byteLength"],
      properties: byteCoordinateProperties
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["utf16Offset", "utf16Length", "line", "column"],
      properties: textCoordinateProperties
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["byteOffset", "byteLength", "utf16Offset", "utf16Length", "line", "column"],
      properties: {
        ...byteCoordinateProperties,
        ...textCoordinateProperties
      }
    }
  ]
};
deepFreeze(sourceSpanSchema);
var uint64DecimalPattern = new RegExp(UINT64_DECIMAL_PATTERN);

// node_modules/.pnpm/@modkit+core@file+vendor+modkit-core-0.1.0.tgz/node_modules/@modkit/core/dist/ordering.js
var encoder = new TextEncoder();

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/semantic/documents.js
var DOCUMENT_OPERATION_IDS = {
  inspect: "view.inspect",
  validate: "asset.validate",
  raw: "export.raw",
  serialize: "export.convert",
  edit: "edit.content",
  save: "source.save"
};
var DOCUMENT_OPERATION_ID_LIST = Object.freeze(Object.values(DOCUMENT_OPERATION_IDS));

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/semantic/maps.js
var MAP_SCENE_3D_OPERATION_ID = "map.scene-3d";
var GAME_LAUNCH_MAP_OPERATION_ID = "game.launch-map";
var MAP_OPERATION_IDS = {
  inspect: "view.inspect",
  validate: "asset.validate",
  thumbnail: "view.thumbnail",
  preview2d: "view.render",
  scene3d: MAP_SCENE_3D_OPERATION_ID,
  extract: "container.extract",
  edit: "edit.content",
  pack: "container.pack",
  saveAs: "source.save-as",
  launch: GAME_LAUNCH_MAP_OPERATION_ID
};
var MAP_OPERATION_ID_LIST = Object.freeze(Object.values(MAP_OPERATION_IDS));

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/semantic/mods.js
var MOD_OPERATION_IDS = {
  /** Resolve the artifact's declared and implicit content dependencies. */
  resolveDependencies: "content.resolve-dependencies",
  /** Expose the ordered mounted workspace behind the artifact. */
  mountWorkspace: "content.mount",
  /** Compare content owned by the artifact with inherited content. */
  compareOverrides: "asset.compare",
  /** Validate the loaded artifact and its dependency state. */
  validate: "asset.validate",
  /** Extract original content while preserving relative paths. */
  extract: "container.extract",
  /** Rewrite the mod container. */
  pack: "container.pack",
  /** Export the mod to another representation. */
  export: "export.convert",
  /** Return inspector/card data without prescribing a viewer shell. */
  inspect: "view.inspect",
  /** Apply a codec-defined structural edit to the mod. */
  addLocale: "edit.structure"
};
var MOD_OPERATION_ID_LIST = Object.freeze(Object.values(MOD_OPERATION_IDS));

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/semantic/saves.js
var SAVE_OPERATION_IDS = {
  inspect: "view.inspect",
  validate: "asset.validate",
  patchValue: "edit.content",
  saveAs: "source.save-as",
  exportRaw: "export.raw",
  sign: "save.sign"
};
var SAVE_OPERATION_ID_LIST = Object.freeze(Object.values(SAVE_OPERATION_IDS));

// node_modules/.pnpm/@modkit+codec-kit@file+vendor+modkit-codec-kit-1.0.0.tgz/node_modules/@modkit/codec-kit/dist/legacy/semantic/scripts.js
var SCRIPT_SYMBOLS_OPERATION_ID = "script.symbols";
var SCRIPT_REFERENCES_OPERATION_ID = "script.references";
var SCRIPT_COMPLETION_OPERATION_ID = "script.completion";
var SCRIPT_FORMAT_OPERATION_ID = "script.format";
var SCRIPT_COMPILE_OPERATION_ID = "script.compile";
var SCRIPT_OPERATION_IDS = {
  parse: "view.inspect",
  symbols: SCRIPT_SYMBOLS_OPERATION_ID,
  references: SCRIPT_REFERENCES_OPERATION_ID,
  diagnostics: "asset.validate",
  completion: SCRIPT_COMPLETION_OPERATION_ID,
  formatting: SCRIPT_FORMAT_OPERATION_ID,
  refactor: "edit.structure",
  edit: "edit.content",
  compile: SCRIPT_COMPILE_OPERATION_ID,
  convert: "export.convert",
  compare: "asset.compare",
  search: "asset.search"
};
var SCRIPT_OPERATION_ID_LIST = Object.freeze(Object.values(SCRIPT_OPERATION_IDS));
var LOCAL_SCRIPT_OPERATION_IDS = Object.freeze([
  SCRIPT_SYMBOLS_OPERATION_ID,
  SCRIPT_REFERENCES_OPERATION_ID,
  SCRIPT_COMPLETION_OPERATION_ID,
  SCRIPT_FORMAT_OPERATION_ID,
  SCRIPT_COMPILE_OPERATION_ID
]);

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/identity.js
var SC2_GAME_ID = "starcraft-2";
var SC2_BANK_CODEC_ID = "sc2-bank";
var SC2_BANK_CODEC_VERSION = "0.1.0";
var SC2_BANK_EXTENSION = ".sc2bank";

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/describe.js
function sc2BankHandlerId(operationId2) {
  return `${SC2_BANK_CODEC_ID}.${operationId2}`;
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

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/detect.js
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
    if (hasExtension)
      confidence += 0.05;
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

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/document.js
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
  const bytes = await source.read(context.cancellation ? { cancellation: context.cancellation } : void 0);
  return new TextDecoder("utf-8").decode(bytes);
}

// starcraft2/dist/lib/mk2/codecs/sc2-bank/src/codec.js
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
        [sc2BankHandlerId(SAVE_OPERATION_IDS.patchValue)]: ({ input }) => this.patchValue(document, input),
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
    return descriptor.diagnostics.filter((diagnostic2) => diagnostic2.severity !== "info");
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
    if (info === void 0)
      return false;
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
  SC2BankEditor,
  Sc2BankCodec,
  calculateBankSignature,
  coerceBankValue,
  createSc2BankCodec,
  getBankKey,
  getBankListNames,
  getBankSection,
  getBankValue,
  inferBankSignatureInfo,
  makeBankValue,
  matchBankListToDiscovered,
  parseBank,
  parseBankList,
  patchBankSignatureXml,
  patchBankValueXml,
  serializeBank,
  serializeBankList,
  sortBank,
  toSignatureInfo,
  validateBank,
  verifyBankSignature
};
