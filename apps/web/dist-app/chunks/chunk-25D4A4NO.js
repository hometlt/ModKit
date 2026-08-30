import {
  WRITER_CONTRACT_ID,
  WRITER_FACET_MATCHER_PROFILE,
  WRITER_SURFACE,
  grantValidity,
  revisionId,
  validateSubjectDescriptorV2,
  writerOfferSatisfies,
  writerSelectionKey
} from "./chunk-ODEN2UNX.js";
import {
  ModkitError,
  canonicalJsonStringify,
  contractId,
  diagnostic,
  isCancellation,
  throwIfAborted,
  uint64
} from "./chunk-GZ3IOGQJ.js";

// packages/sdk/dist/language/index.js
var LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT = "common.language/document-analysis";
var LANGUAGE_DOCUMENT_MATCHER_PROFILE = "org.modkitx/language-document-matcher";

// packages/sdk/dist/runtime/index.js
var RUNTIME_PROVIDER_CONTRACT = "common.runtime/provider";
var RUNTIME_SESSION_CONTRACT = "common.runtime/session";
var RUNTIME_PROVIDER_MATCHER_PROFILE = "org.modkitx/runtime-provider-matcher";
var RUNTIME_SESSION_V2_MEMBERS = Object.freeze([
  "offers",
  "identity",
  "step",
  "events",
  "snapshot",
  "restore",
  "stateHash"
]);

// packages/sdk/dist/renderer/index.js
var SCENE_RENDERER_CONTRACT = "common.render/scene-3d";
var SCENE_RENDERER_MATCHER_PROFILE = "org.modkitx/scene-renderer-matcher";

// packages/sdk/dist/games/index.js
var GAME_INSTALLATION_DISCOVERY_CONTRACT = "common.game/installation-discovery";
var GAME_LAUNCH_PLAN_CONTRACT = "common.game/launch-plan";
var GAME_INSTALLATION_MATCHER_PROFILE = "org.modkitx/game-installation-matcher";

// packages/sdk/dist/mods/index.js
var MOD_WORKSPACE_COMPOSITION_CONTRACT = "common.mod/workspace-composition";
var MOD_WORKSPACE_MATCHER_PROFILE = "org.modkitx/mod-workspace-matcher";

// packages/sdk/dist/data/index.js
var DATA_CATALOG_ANALYSIS_CONTRACT = "common.data/catalog-analysis";
var DATA_CATALOG_MATCHER_PROFILE = "org.modkitx/data-catalog-matcher";
var RESOLVED_DATA_WORKSPACE_CONTRACT = "common.data/resolved-workspace";
var RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE = "org.modkitx/resolved-data-workspace-matcher";

// packages/sdk/dist/maps/index.js
var MAP_SEMANTIC_ANALYSIS_CONTRACT = "common.map/semantic-analysis";
var RESOLVED_MAP_WORKSPACE_CONTRACT = "common.map/resolved-workspace";
var MAP_PREVIEW_PREPARATION_CONTRACT = "common.map/preview-preparation";
var MAP_SEMANTIC_MATCHER_PROFILE = "org.modkitx/map-semantic-matcher";
var MAP_PREVIEW_PREPARATION_MATCHER_PROFILE = "org.modkitx/map-preview-preparation-matcher";

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += "\n";
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "	";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += "\n";
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      // tokens: []{}:,
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      // strings
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      // comments
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength2 = len - 1;
          let commentClosed = false;
          while (pos < safeLength2) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      // numbers
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      // found a minus, followed by a number so
      // we fall through to proceed with scanning
      // numbers
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      // literals and unknown symbols
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
  CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
  CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
  CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
  CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
  CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
  CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
  CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
  CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
  CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
  CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
  CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
  CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
  CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
  CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
  CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
  CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
  CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
  CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
  CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
  CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
  CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
  CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
  CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
  CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
  CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
  CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
  CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
  CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
  CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
  CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
  CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
  CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
  CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
  CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
  CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
  CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
  CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
  CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
  CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
  CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
  CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
  CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
  CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
  CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
  CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
  CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
  CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
  CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
  CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
  CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
  CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
  CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
  CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
  CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
  CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
  CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
  CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
  CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
  CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
  CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
  CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + " ".repeat(index);
    })
  },
  "	": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + "	".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "	".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + "	".repeat(index);
    })
  }
};

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parseTree(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentParent = { type: "array", offset: -1, length: -1, children: [], parent: void 0 };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({ type: "object", offset, length: -1, parent: currentParent, children: [] });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({ type: "property", offset, length: -1, parent: currentParent, children: [] });
      currentParent.children.push({ type: "string", value: name, offset, length, parent: currentParent });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({ type: "array", offset, length: -1, parent: currentParent, children: [] });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({ type: getNodeType(value), offset, length, parent: currentParent, value });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep, offset, length) => {
      if (currentParent.type === "property") {
        if (sep === ":") {
          currentParent.colonOffset = offset;
        } else if (sep === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error3, offset, length) => {
      errors.push({ error: error3, offset, length });
    }
  };
  visit(text, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(
            14
            /* ParseErrorCode.InvalidUnicode */
          );
          break;
        case 5:
          handleError(
            15
            /* ParseErrorCode.InvalidEscapeCharacter */
          );
          break;
        case 3:
          handleError(
            13
            /* ParseErrorCode.UnexpectedEndOfNumber */
          );
          break;
        case 1:
          if (!disallowComments) {
            handleError(
              11
              /* ParseErrorCode.UnexpectedEndOfComment */
            );
          }
          break;
        case 2:
          handleError(
            12
            /* ParseErrorCode.UnexpectedEndOfString */
          );
          break;
        case 6:
          handleError(
            16
            /* ParseErrorCode.InvalidCharacter */
          );
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(
              10
              /* ParseErrorCode.InvalidCommentToken */
            );
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(
            1
            /* ParseErrorCode.InvalidSymbol */
          );
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error3, skipUntilAfter = [], skipUntil = []) {
    onError(error3);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(
            2
            /* ParseErrorCode.InvalidNumberFormat */
          );
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
    } else {
      handleError(5, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [
        2
        /* SyntaxKind.CloseBraceToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [
          4,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [
        4
        /* SyntaxKind.CloseBracketToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}

// node_modules/.pnpm/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError2) {
  ScanError2[ScanError2["None"] = 0] = "None";
  ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind2) {
  SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
  SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
  SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
  SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
  SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parseTree2 = parseTree;
var ParseErrorCode;
(function(ParseErrorCode2) {
  ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}

// packages/host/dist/index.js
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var RESTRICTED_LINKED_EXECUTION = Object.freeze({
  origin: "linked",
  allowTrustedInProcess: false
});
var PROVIDER_OFFER_INVENTORY_FACT = contractId(
  "org.modkitx.inventory/provider-offer"
);
var VIEWER_CONTRIBUTION_INVENTORY_FACT = contractId(
  "org.modkitx.inventory/viewer-contribution"
);
var COMMAND_SUBJECT_UNRESOLVED = "x3.command/subject-unresolved";
var COMMAND_UNAVAILABLE = "x3.command/unavailable";
var commandDiagnostic = (item) => ({
  code: item.code,
  message: item.message,
  ...item.severity === void 0 ? {} : { severity: item.severity }
});
var ok = (command, data, diagnostics = []) => ({ state: "ok", command, data, diagnostics });
var unavailable = (command, reason, alternative, diagnostics = [], code = COMMAND_UNAVAILABLE) => ({ state: "unavailable", command, code, reason, alternative, diagnostics });
var failed = (command, code, message, diagnostics = []) => ({ state: "failed", command, code, message, diagnostics });
var RESULT_STATES = Object.freeze(["ok", "unavailable", "failed"]);
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
function defineSubjectCommandTargets(targets) {
  return deepFreeze(targets);
}
var SUBJECT_COMMAND_TARGETS = defineSubjectCommandTargets({
  open: {
    commandId: "subject.open",
    needsSubject: true,
    mutatesSource: false,
    operationIds: [],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  inspect: {
    commandId: "subject.inspect",
    needsSubject: true,
    mutatesSource: false,
    operationIds: [],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  validate: {
    commandId: "subject.validate",
    needsSubject: true,
    mutatesSource: false,
    operationIds: ["asset.validate"],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  extract: {
    commandId: "subject.extract",
    needsSubject: true,
    mutatesSource: false,
    operationIds: ["container.extract"],
    dataSourceContracts: ["common.view/namespace-entry-source"],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  convert: {
    commandId: "subject.convert",
    needsSubject: true,
    mutatesSource: false,
    operationIds: ["export.convert", "export.raw"],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  },
  preview: {
    commandId: "subject.preview",
    needsSubject: true,
    mutatesSource: false,
    operationIds: ["view.thumbnail", "view.render"],
    dataSourceContracts: [],
    hostCallers: ["automation", "cli", "electron", "pwa", "server", "vscode"]
  }
});
var OPEN_COMMAND = SUBJECT_COMMAND_TARGETS.open.commandId;
var INSPECT_COMMAND = SUBJECT_COMMAND_TARGETS.inspect.commandId;
var VALIDATE_COMMAND = SUBJECT_COMMAND_TARGETS.validate.commandId;
var VALIDATE = SUBJECT_COMMAND_TARGETS.validate.operationIds[0];
var EXTRACT_COMMAND = SUBJECT_COMMAND_TARGETS.extract.commandId;
var CONTAINER_EXTRACT_OPERATION_ID2 = SUBJECT_COMMAND_TARGETS.extract.operationIds[0];
var NAMESPACE_ENTRY_SOURCE = SUBJECT_COMMAND_TARGETS.extract.dataSourceContracts[0];
var CONVERT_COMMAND = SUBJECT_COMMAND_TARGETS.convert.commandId;
var CONVERT = SUBJECT_COMMAND_TARGETS.convert.operationIds[0];
var RAW_EXPORT = SUBJECT_COMMAND_TARGETS.convert.operationIds[1];
var PREVIEW_COMMAND = SUBJECT_COMMAND_TARGETS.preview.commandId;
var THUMBNAIL = SUBJECT_COMMAND_TARGETS.preview.operationIds[0];
var RENDER = SUBJECT_COMMAND_TARGETS.preview.operationIds[1];
function availableOperation(descriptor, id) {
  const found = (descriptor.operations ?? []).find(
    (item) => item.id === id && item.state === "available" && item.mutatesSource !== true
  );
  return found === void 0 ? void 0 : { handlerId: found.handlerId };
}
var publishedOperations = (descriptor) => (descriptor.operations ?? []).length === 0 ? "it publishes no operations at all" : `it publishes ${(descriptor.operations ?? []).map((item) => item.id).join(", ")}`;
async function withSubject(command, context, ref, body) {
  context.progress?.({ step: "open", message: `opening ${ref}` });
  const subject = await context.openSubject(ref, context.signal);
  const diagnostics = subject.snapshot.diagnostics.map((item) => ({
    code: item.code,
    message: item.message,
    ...item.severity === void 0 ? {} : { severity: item.severity }
  }));
  try {
    if (subject.snapshot.state !== "opened" || subject.session === void 0) {
      return failed(
        command,
        COMMAND_SUBJECT_UNRESOLVED,
        subject.snapshot.state === "opened" ? "the subject opened without a session" : `no contribution claimed this subject: ${subject.snapshot.reason}`,
        diagnostics
      );
    }
    const descriptor = await subject.session.descriptor();
    return await body(subject, subject.session, descriptor, diagnostics);
  } finally {
    await subject.dispose();
  }
}
async function invoke(command, context, session, handlerId, input, diagnostics) {
  const answer = await session.operations().invoke(handlerId, input, context.signal === void 0 ? {} : { signal: context.signal });
  const carried = [...diagnostics, ...answer.diagnostics.map(commandDiagnostic)];
  if (answer.state !== "ok") {
    return {
      state: "failed",
      result: failed(
        command,
        `x3.command/operation-${answer.reason}`,
        `the subject refused ${handlerId}: ${answer.reason}`,
        carried
      )
    };
  }
  return { state: "ok", output: answer.output };
}
var openCommand = {
  id: OPEN_COMMAND,
  title: "Open",
  summary: "Open a subject and report which contribution claimed it, and under which boundary.",
  needsSubject: true,
  mutatesSource: false,
  async run(context, input) {
    return withSubject(
      OPEN_COMMAND,
      context,
      String(input.subject),
      async (subject, _session, descriptor, diagnostics) => {
        const snapshot2 = subject.snapshot;
        if (snapshot2.state !== "opened")
          return failed(OPEN_COMMAND, COMMAND_SUBJECT_UNRESOLVED, "unreachable", diagnostics);
        return ok(
          OPEN_COMMAND,
          {
            ref: subject.ref,
            state: "opened",
            selected: {
              contributionId: snapshot2.selected.contributionId,
              variantId: snapshot2.selected.variantId,
              confidence: snapshot2.selected.confidence
            },
            formatId: descriptor.identity?.formatId ?? null,
            formatLabel: descriptor.identity?.formatLabel ?? null,
            candidates: snapshot2.candidates.length,
            operations: (descriptor.operations ?? []).map((item) => item.id)
          },
          diagnostics
        );
      }
    );
  }
};
var inspectCommand = {
  id: INSPECT_COMMAND,
  title: "Inspect",
  summary: "Report the full descriptor of a subject: identity, traits, operations, data sources.",
  needsSubject: true,
  mutatesSource: false,
  async run(context, input) {
    return withSubject(
      INSPECT_COMMAND,
      context,
      String(input.subject),
      async (subject, _session, descriptor, diagnostics) => {
        context.progress?.({ step: "describe", message: "reading the descriptor" });
        return ok(
          INSPECT_COMMAND,
          {
            ref: subject.ref,
            identity: {
              formatId: descriptor.identity?.formatId ?? null,
              formatLabel: descriptor.identity?.formatLabel ?? null
            },
            traits: (descriptor.traits ?? []).map((item) => ({ id: item.id, state: item.state })),
            operations: (descriptor.operations ?? []).map((item) => ({
              id: item.id,
              state: item.state,
              ...item.reason === void 0 ? {} : { reason: item.reason }
            })),
            dataSources: (descriptor.dataSources ?? []).map(
              (item) => `${item.contract}@${item.major}`
            ),
            metadataGroups: (descriptor.metadata ?? []).map((group) => ({
              id: group.id,
              entries: group.entries.length
            }))
          },
          diagnostics
        );
      }
    );
  }
};
var validateCommand = {
  id: VALIDATE_COMMAND,
  title: "Validate",
  summary: "Run the subject\u2019s own validation, when the codec publishes one.",
  needsSubject: true,
  mutatesSource: false,
  operationId: VALIDATE,
  async run(context, input) {
    return withSubject(
      VALIDATE_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation = availableOperation(descriptor, VALIDATE);
        if (operation === void 0) {
          return unavailable(
            VALIDATE_COMMAND,
            `this subject publishes no available \xAB${VALIDATE}\xBB \u2014 ${publishedOperations(descriptor)}`,
            "run subject.inspect: it reports every trait and diagnostic the codec did produce, which is what validation would have been reading",
            diagnostics
          );
        }
        context.progress?.({ step: "validate", message: "running the codec\u2019s validation" });
        const answer = await invoke(
          VALIDATE_COMMAND,
          context,
          session,
          operation.handlerId,
          {},
          diagnostics
        );
        if (answer.state === "failed") return answer.result;
        return ok(
          VALIDATE_COMMAND,
          {
            ref: subject.ref,
            outputKind: answer.output.kind,
            report: answer.output.value ?? null
          },
          diagnostics
        );
      }
    );
  }
};
async function entryIdFor(session, wanted, signal) {
  const lease2 = await session.dataSource(NAMESPACE_ENTRY_SOURCE, 1);
  try {
    const namespace = lease2.value;
    let cursor3;
    do {
      const page = await namespace.list(
        "",
        cursor3 === void 0 ? { limit: 512 } : { cursor: cursor3, limit: 512 },
        signal
      );
      const found = page.items.find((item) => item.path === wanted || item.id === wanted);
      if (found !== void 0) return found.id;
      cursor3 = page.nextCursor;
    } while (cursor3 !== void 0);
    return void 0;
  } finally {
    await lease2.release();
  }
}
var extractCommand = {
  id: EXTRACT_COMMAND,
  title: "Extract",
  summary: "Read one member out of a container, through the container\u2019s own bounded extraction.",
  needsSubject: true,
  mutatesSource: false,
  operationId: CONTAINER_EXTRACT_OPERATION_ID2,
  async run(context, input) {
    const entry2 = typeof input.entry === "string" ? input.entry : "";
    if (entry2 === "") {
      return failed(EXTRACT_COMMAND, "x3.command/input-invalid", "subject.extract needs an \xABentry\xBB");
    }
    return withSubject(
      EXTRACT_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation = availableOperation(descriptor, CONTAINER_EXTRACT_OPERATION_ID2);
        const listing = (descriptor.dataSources ?? []).some(
          (item) => item.contract === NAMESPACE_ENTRY_SOURCE
        );
        if (operation === void 0 || !listing) {
          return unavailable(
            EXTRACT_COMMAND,
            `this subject is not a container this host can read into \u2014 ${publishedOperations(descriptor)}`,
            `run subject.inspect to see what it does publish; extraction needs both \xAB${CONTAINER_EXTRACT_OPERATION_ID2}\xBB and \xAB${NAMESPACE_ENTRY_SOURCE}\xBB`,
            diagnostics
          );
        }
        context.progress?.({ step: "locate", message: `locating ${entry2}` });
        const entryId = await entryIdFor(session, entry2, context.signal);
        if (entryId === void 0) {
          return failed(
            EXTRACT_COMMAND,
            "x3.command/entry-not-found",
            `this container lists no \xAB${entry2}\xBB`,
            diagnostics
          );
        }
        context.progress?.({ step: "extract", message: `extracting ${entry2}` });
        const answer = await invoke(
          EXTRACT_COMMAND,
          context,
          session,
          operation.handlerId,
          { entryId },
          diagnostics
        );
        if (answer.state === "failed") return answer.result;
        if (answer.output.kind !== "bytes") {
          return failed(
            EXTRACT_COMMAND,
            "x3.command/unexpected-output",
            `the container answered ${answer.output.kind}, not bytes`,
            diagnostics
          );
        }
        const bytes = answer.output.value;
        const name = entry2.slice(entry2.lastIndexOf("/") + 1);
        const wroteTo = context.writeOutput === void 0 ? void 0 : await context.writeOutput(name, bytes, context.signal);
        return ok(
          EXTRACT_COMMAND,
          {
            ref: subject.ref,
            entry: entry2,
            byteLength: bytes.byteLength,
            ...wroteTo === void 0 ? { wroteTo: null } : { wroteTo }
          },
          diagnostics
        );
      }
    );
  }
};
var convertCommand = {
  id: CONVERT_COMMAND,
  title: "Convert",
  summary: "Export a subject through the codec\u2019s own conversion, when it publishes one.",
  needsSubject: true,
  mutatesSource: false,
  operationId: CONVERT,
  async run(context, input) {
    return withSubject(
      CONVERT_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const operation = availableOperation(descriptor, CONVERT) ?? availableOperation(descriptor, RAW_EXPORT);
        if (operation === void 0) {
          return unavailable(
            CONVERT_COMMAND,
            `this subject publishes neither \xAB${CONVERT}\xBB nor \xAB${RAW_EXPORT}\xBB \u2014 ${publishedOperations(descriptor)}`,
            "run subject.inspect to see which data sources it does publish; a universal projection is the route for formats with no native export",
            diagnostics
          );
        }
        context.progress?.({ step: "convert", message: "running the codec\u2019s export" });
        const request = typeof input.target === "string" ? { target: input.target } : {};
        const answer = await invoke(
          CONVERT_COMMAND,
          context,
          session,
          operation.handlerId,
          request,
          diagnostics
        );
        if (answer.state === "failed") return answer.result;
        const bytes = answer.output.kind === "bytes" ? answer.output.value : void 0;
        const wroteTo = bytes === void 0 || context.writeOutput === void 0 ? void 0 : await context.writeOutput(
          `${input.target ?? "export"}`,
          bytes,
          context.signal
        );
        return ok(
          CONVERT_COMMAND,
          {
            ref: subject.ref,
            outputKind: answer.output.kind,
            ...bytes === void 0 ? {} : { byteLength: bytes.byteLength },
            ...wroteTo === void 0 ? { wroteTo: null } : { wroteTo }
          },
          diagnostics
        );
      }
    );
  }
};
var previewCommand = {
  id: PREVIEW_COMMAND,
  title: "Preview",
  summary: "Produce the subject\u2019s own preview \u2014 a thumbnail if it has one, a render otherwise.",
  needsSubject: true,
  mutatesSource: false,
  operationId: THUMBNAIL,
  async run(context, input) {
    return withSubject(
      PREVIEW_COMMAND,
      context,
      String(input.subject),
      async (subject, session, descriptor, diagnostics) => {
        const thumbnail = availableOperation(descriptor, THUMBNAIL);
        const operation = thumbnail ?? availableOperation(descriptor, RENDER);
        if (operation === void 0) {
          return unavailable(
            PREVIEW_COMMAND,
            `this subject publishes no \xAB${THUMBNAIL}\xBB or \xAB${RENDER}\xBB \u2014 ${publishedOperations(descriptor)}`,
            `mount a viewer over one of its data sources instead: ${(descriptor.dataSources ?? []).map((item) => item.contract).join(", ") || "it publishes none"}`,
            diagnostics
          );
        }
        context.progress?.({ step: "preview", message: "rendering the preview" });
        const answer = await invoke(
          PREVIEW_COMMAND,
          context,
          session,
          operation.handlerId,
          {},
          diagnostics
        );
        if (answer.state === "failed") return answer.result;
        const bytes = answer.output.kind === "bytes" ? answer.output.value : void 0;
        return ok(
          PREVIEW_COMMAND,
          {
            ref: subject.ref,
            via: thumbnail === void 0 ? RENDER : THUMBNAIL,
            outputKind: answer.output.kind,
            ...bytes === void 0 ? {} : { byteLength: bytes.byteLength }
          },
          diagnostics
        );
      }
    );
  }
};
var SUBJECT_COMMANDS = Object.freeze([
  openCommand,
  inspectCommand,
  validateCommand,
  extractCommand,
  convertCommand,
  previewCommand
]);
var EVIDENCE_KINDS = Object.freeze([
  "magic",
  "structure",
  "companion",
  "context",
  "extension",
  "user-override"
]);
var DETECTION_EVIDENCE_LADDER = Object.freeze([
  "name-only",
  "generic-syntax",
  "carrier-magic",
  "generic-syntax-and-format-marker",
  "carrier-magic-and-format-structure",
  "format-magic",
  "format-magic-and-second-signal"
]);
var DETECTION_UNTIE_RULES = Object.freeze([
  Object.freeze({
    id: "strictly-highest-confidence-wins",
    rule: "Among candidates at or above the host confidence floor, the one with the strictly highest confidence is selected. There is no secondary ranking by extension id, contribution status, implementation tier or load order.",
    enforcedBy: "packages/host/src/subject-open.ts"
  }),
  Object.freeze({
    id: "an-exact-tie-is-ambiguous",
    rule: "Two or more candidates sharing the top confidence resolve to `unresolved` with reason `ambiguous`. The host never breaks a tie by sort order: a stable sort would make the winner depend on which extension happened to load first, which is a coin toss wearing a rule.",
    enforcedBy: "packages/host/src/subject-open.ts"
  }),
  Object.freeze({
    id: "below-the-floor-is-no-match",
    rule: "A candidate under the host confidence floor is not eligible at all, so a lone weak guess produces `no-match` rather than an open nobody can justify.",
    enforcedBy: "packages/host/src/subject-open.ts"
  }),
  Object.freeze({
    id: "a-carrier-ranks-below-its-passengers",
    rule: "A codec that matched only a carrier magic (ZIP, RIFF) or only a general syntax (UTF-8 text, XML, JSON) must score below a codec that matched the same bytes *and* a structure specific to its own format. The generic route is the fallback for bytes nobody claimed, never the winner over a format that read more.",
    enforcedBy: "the detecting codecs; the ordering is proved in packages/testkit/test/detection-collisions.test.ts"
  }),
  Object.freeze({
    id: "a-second-signal-breaks-a-would-be-tie",
    rule: "Where two routes read the same evidence, the one that also reads an independent second signal \u2014 typically the declared extension \u2014 ranks above it. This is how a relocated port beats the staging route it replaces without either of them inventing evidence.",
    enforcedBy: "the detecting codecs; proved in packages/testkit/test/common-documents-rtf.test.ts"
  }),
  Object.freeze({
    id: "an-extension-alone-never-decides",
    rule: "The file name may add margin to a candidate that already read the bytes; it may never carry one over the confidence floor by itself. A renamed file is decided by its content, and a correctly named file whose content disagrees is refused.",
    enforcedBy: "the detecting codecs; proved in packages/testkit/test/detection-collisions.test.ts"
  }),
  Object.freeze({
    id: "a-foreign-format-scores-zero-not-low",
    rule: "Bytes that positively declare a *different* format are a refusal, not a weak match: an ODP renamed to `.odt` scores zero rather than a hedged number, so it can never win by being the only candidate left.",
    enforcedBy: "extensions/common/documents/src/odf/package.js and its peers"
  }),
  Object.freeze({
    id: "a-declaration-scopes-a-generic",
    rule: "A contribution is put in front of the probe only for bytes its own declaration matches by name or signature, and that \u2014 not confidence \u2014 is what keeps a generic away from another format\u2019s body. `text-ini` scores `Key=Value` lines happily but declares only `.ini`, so it never sees a publisher-specific text file; `text-csv` declares `.csv` and `.tsv`, so it never sees an unrelated atlas index. A generic that widens its declaration to every path gives this protection up and must then win every collision on confidence alone.",
    enforcedBy: "matchesSpec in packages/host/src/subject-open.ts (an empty rule set is not a wildcard); proved in packages/testkit/test/detection-collisions.test.ts"
  }),
  Object.freeze({
    id: "a-signature-shortlists-but-does-not-select",
    rule: "A declared byte signature only puts a contribution in front of the probe \u2014 a renamed `.dat` PNG reaches the PNG probe. Selection is still decided by the probe result, so a signature can never open a subject on its own.",
    enforcedBy: "packages/host/src/detection-index.ts"
  })
]);
var MAX_SIGNATURE_WINDOW_BYTES = 4096 + 64;
var SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
var WINDOWS_DRIVE = /^[a-zA-Z]:/;
function refuse(entrypoint, why) {
  return new ModkitError({
    code: "x3.host/entrypoint-not-contained",
    message: `entry point \xAB${entrypoint}\xBB is not a relative path inside the artifact: ${why}`,
    context: { entrypoint, why }
  });
}
function assertRelativeEntrypoint(entrypoint) {
  if (entrypoint.trim().length === 0) throw refuse(entrypoint, "empty");
  if (/[\u0000-\u001f\u007f]/.test(entrypoint)) {
    throw refuse(entrypoint, "contains control characters");
  }
  if (SCHEME.test(entrypoint) && !WINDOWS_DRIVE.test(entrypoint)) {
    throw refuse(entrypoint, "URL schemes are not allowed");
  }
  if (WINDOWS_DRIVE.test(entrypoint)) throw refuse(entrypoint, "absolute Windows path");
  if (entrypoint.startsWith("/") || entrypoint.startsWith("\\")) {
    throw refuse(entrypoint, "absolute path");
  }
  if (entrypoint.includes("\\")) throw refuse(entrypoint, "use forward slashes");
  if (entrypoint.split("/").includes("..")) throw refuse(entrypoint, "`..` traversal");
}
function resolveContainedEntrypoint(baseUrl, entrypoint) {
  assertRelativeEntrypoint(entrypoint);
  const root = baseUrl.href.endsWith("/") ? baseUrl : new URL(`${baseUrl.href}/`);
  const resolved = new URL(entrypoint, root);
  if (resolved.protocol !== root.protocol) {
    throw refuse(entrypoint, `resolved to a different protocol (${resolved.protocol})`);
  }
  if (!resolved.href.startsWith(root.href)) {
    throw refuse(entrypoint, `resolved outside the artifact root (${root.href})`);
  }
  return resolved;
}
var PROFILE_VALUES = Object.freeze([
  "browser-sandbox",
  "worker-brokered",
  "process-brokered",
  "wasm-brokered",
  "trusted-in-process",
  "remote-provider"
]);
var PROBE_PERMISSION_CLASSES = Object.freeze(["read-source"]);
function rejected(reason, message) {
  return {
    state: "rejected",
    reason,
    diagnostics: [diagnostic("error", `x3.host/${reason}`, message)]
  };
}
function snapshotInput2(input) {
  try {
    return JSON.parse(canonicalJsonStringify(input));
  } catch {
    return void 0;
  }
}
function snapshotStructured(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value))
    return Object.freeze(value.map((item) => snapshotStructured(item)));
  if (typeof value === "object" && value !== null) {
    return Object.freeze(
      Object.fromEntries(
        Reflect.ownKeys(value).map((key2) => [
          key2,
          snapshotStructured(value[key2])
        ])
      )
    );
  }
  return value;
}
function snapshotOutput(output) {
  switch (output.kind) {
    case "json": {
      const value = snapshotInput2(output.value);
      if (value === void 0) {
        throw new ModkitError({
          code: "x3.host/non-json-operation-output",
          message: "operation JSON output must be inert JSON data"
        });
      }
      return Object.freeze({ kind: "json", value });
    }
    case "bytes":
      return Object.freeze({ kind: "bytes", value: output.value.slice() });
    case "source":
      return Object.freeze({
        kind: "source",
        source: Object.freeze({
          ...output.source,
          ...output.source.parentIds === void 0 ? {} : {
            parentIds: Object.freeze([...output.source.parentIds])
          }
        })
      });
    case "artifact":
      return Object.freeze({ ...output });
    case "none":
      return Object.freeze({ kind: "none" });
    case "stream":
      return Object.freeze({ kind: "stream", stream: output.stream });
    case "edit-plan":
      return Object.freeze({ kind: "edit-plan", plan: snapshotStructured(output.plan) });
    case "transaction":
      return Object.freeze({ kind: "transaction", receipt: snapshotStructured(output.receipt) });
  }
}
function staleDiagnostic(expected, actual) {
  return Object.freeze({
    id: "session-stale-revision",
    category: "operation",
    ...diagnostic(
      "error",
      "x3.host/stale-revision",
      `asset session revision ${expected} no longer matches source revision ${actual}`
    )
  });
}
async function assembleSubjectDescriptor(value) {
  const result = await validateSubjectDescriptorV2(value);
  if (result.descriptor !== void 0) return result.descriptor;
  throw new ModkitError({
    code: "x3.host/invalid-subject-descriptor",
    message: "subject descriptor assembly failed validation",
    context: {
      diagnostics: result.diagnostics.map((item) => ({
        code: item.code,
        severity: item.severity,
        message: item.message,
        ...item.path === void 0 ? {} : { path: item.path }
      }))
    }
  });
}
function createAssetSession(options) {
  const descriptor = options.descriptor;
  const operationByHandler = new Map(descriptor.operations.map((item) => [item.handlerId, item]));
  const declarationByHandler = new Map(
    options.operationDeclarations.map((item) => [item.handlerId, item])
  );
  const handlers = new Map(options.handlers);
  const releases = [...options.release ?? []];
  const subscribers = /* @__PURE__ */ new Set();
  let state = "live";
  let disposal;
  const publish = (event) => {
    for (const subscriber of subscribers) {
      subscriber.queue.push(event);
      subscriber.wake?.();
      subscriber.wake = void 0;
    }
  };
  const operations = {
    async invoke(handlerId, input, invokeOptions = {}) {
      const operation = operationByHandler.get(handlerId);
      const declaration = declarationByHandler.get(handlerId);
      if (operation === void 0 || declaration === void 0 || declaration.id !== operation.id) {
        return rejected("not-declared", `handler ${handlerId} is not declared by this asset`);
      }
      if (operation.state === "disabled") {
        return rejected("disabled", operation.reason);
      }
      if (operation.state === "dependency-required") {
        return rejected("dependency-required", operation.reason);
      }
      if (state === "stale-revision") {
        return rejected("stale-revision", "the source changed; reopen the asset explicitly");
      }
      if (state === "disposed") {
        return rejected("cancelled", "the asset session has been disposed");
      }
      if (invokeOptions.signal?.aborted) {
        return rejected("cancelled", "the operation was cancelled before dispatch");
      }
      const required = declaration.requiredPermissions ?? [];
      const validity = grantValidity(options.permissionGrant);
      const missing = required.filter((item) => !options.permissionGrant.classes.includes(item));
      if (validity.state !== "valid" || missing.length > 0) {
        return rejected(
          "permission-missing",
          validity.state === "valid" ? `operation requires permissions: ${missing.join(", ")}` : "the operation permission grant is not valid"
        );
      }
      const ownedInput = snapshotInput2(input);
      if (ownedInput === void 0) {
        return rejected("input-not-serializable", "operation input must be inert JSON data");
      }
      const handler = handlers.get(handlerId);
      if (handler === void 0) {
        return rejected("handler-unregistered", `handler ${handlerId} is not registered`);
      }
      try {
        throwIfAborted(invokeOptions.signal);
        const output = snapshotOutput(await handler(ownedInput, invokeOptions));
        throwIfAborted(invokeOptions.signal);
        if (declaration.outputKinds !== void 0 && !declaration.outputKinds.includes(output.kind)) {
          throw new ModkitError({
            code: "x3.host/undeclared-operation-output",
            message: `handler ${handlerId} returned undeclared output kind ${output.kind}`,
            context: { handlerId, outputKind: output.kind }
          });
        }
        return { state: "ok", output, diagnostics: [] };
      } catch (error3) {
        if (isCancellation(error3) || invokeOptions.signal?.aborted) {
          return rejected("cancelled", "the operation was cancelled");
        }
        if (error3 instanceof ModkitError) throw error3;
        const reason = error3 instanceof Error ? error3.message : String(error3);
        throw new ModkitError({
          code: "x3.host/operation-handler-failed",
          message: `operation handler ${handlerId} failed: ${reason}`,
          context: { handlerId },
          cause: error3
        });
      }
    },
    async dispose() {
      await dispose();
    }
  };
  const dispose = async () => {
    if (disposal !== void 0) return disposal;
    disposal = (async () => {
      state = "disposed";
      publish({ kind: "state", state });
      const failures = [];
      for (const release of releases.reverse()) {
        try {
          await release();
        } catch (error3) {
          failures.push(error3);
        }
      }
      for (const subscriber of subscribers) {
        subscriber.wake?.();
        subscriber.wake = void 0;
      }
      if (failures.length > 0) {
        throw new ModkitError({
          code: "x3.host/session-dispose-failed",
          message: `${failures.length} asset session resource release(s) failed`,
          context: { failureCount: failures.length },
          cause: failures[0]
        });
      }
    })();
    return disposal;
  };
  const session = Object.freeze({
    revision: options.revision,
    state: () => state,
    descriptor: async () => descriptor,
    async dataSource(contract, major) {
      if (state !== "live") {
        throw new ModkitError({
          code: state === "stale-revision" ? "x3.host/stale-revision" : "x3.host/session-disposed",
          message: state === "stale-revision" ? "the source changed; reopen the asset before accessing data sources" : "the asset session has been disposed"
        });
      }
      return options.openDataSource(contract, major);
    },
    operations: () => operations,
    async *events(signal) {
      if (signal?.aborted) return;
      yield { kind: "descriptor", descriptor };
      if (state !== "live") {
        yield { kind: "state", state };
        return;
      }
      const subscriber = { queue: [], wake: void 0 };
      subscribers.add(subscriber);
      const onAbort = () => subscriber.wake?.();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        while (!signal?.aborted) {
          const event = subscriber.queue.shift();
          if (event !== void 0) {
            yield event;
            if (event.kind === "state" && event.state === "disposed") return;
            continue;
          }
          if (state === "disposed") return;
          await new Promise((resolve) => {
            subscriber.wake = resolve;
          });
        }
      } finally {
        subscribers.delete(subscriber);
        signal?.removeEventListener("abort", onAbort);
      }
    },
    dispose
  });
  return Object.freeze({
    session,
    updateSourceRevision(revision) {
      if (state !== "live" || revision === options.revision) return;
      state = "stale-revision";
      const item = staleDiagnostic(options.revision, revision);
      publish({ kind: "diagnostic", diagnostic: item });
      publish({ kind: "state", state });
    }
  });
}
var NAMESPACE_PATH_ENCODER = new TextEncoder();
var DEFAULT_COMPANION_LIMITS = Object.freeze({
  maxEntries: 4096,
  maxProbes: 64,
  maxProbeBytes: 256 * 1024,
  maxBindings: 64
});
var NAMESPACE_SCOPES = Object.freeze([
  "current-mount",
  "enclosing-container"
]);
var FACETLESS_SERVICE_MATCHER_PROFILE = contractId("org.modkitx/facetless-matcher");
var facetlessMatcher = Object.freeze({
  profile: FACETLESS_SERVICE_MATCHER_PROFILE,
  major: 1,
  match(context) {
    return context.offerFacet === void 0 && context.requestFacet === void 0 ? { state: "match", selectionKey: "facetless:v1" } : { state: "no-match" };
  }
});
var REQUIREMENT_KEYS = ["formatId", "representationId", "mutationMode", "minimumRoundTrip"];
var OFFER_KEYS = [...REQUIREMENT_KEYS, "providerId", "fidelityEvidenceId"];
var MUTATION_MODES = /* @__PURE__ */ new Set(["export-only", "mutate"]);
var ROUND_TRIPS = /* @__PURE__ */ new Set(["byte-identical", "semantic", "lossy", "none"]);
function facetOf(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const record = value;
  const own = Object.keys(record);
  if (own.length !== keys.length || !keys.every((key2) => own.includes(key2))) return void 0;
  for (const key2 of keys) {
    if (typeof record[key2] !== "string" || record[key2].length === 0) return void 0;
  }
  if (!MUTATION_MODES.has(record["mutationMode"])) return void 0;
  if (!ROUND_TRIPS.has(record["minimumRoundTrip"])) return void 0;
  return record;
}
function matchWriterFacets(context) {
  const request = facetOf(context.requestFacet, REQUIREMENT_KEYS);
  const offer = facetOf(context.offerFacet, OFFER_KEYS);
  if (request === void 0 || offer === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/writer-facet-invalid",
          `${context.contract}@${context.major}: writer request and offer facets must both be complete`
        )
      ]
    };
  }
  return writerOfferSatisfies(
    request,
    offer
  ) ? {
    state: "match",
    selectionKey: writerSelectionKey(request)
  } : { state: "no-match" };
}
var WRITER_FACET_MATCHER = Object.freeze({
  profile: contractId(WRITER_FACET_MATCHER_PROFILE),
  major: 1,
  match: matchWriterFacets
});
var WRITER_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: WRITER_CONTRACT_ID,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({ $ref: "https://schemas.modkitx.org/x3/writer-offer.v1.schema.json" })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/writer-requirement.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: WRITER_FACET_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.edit/writer-v1",
  surface: WRITER_SURFACE
});
var STANDARD_EDITING_DEFINITIONS = Object.freeze([WRITER_CONTRACT_DEFINITION]);
var SYMBOL_KINDS = /* @__PURE__ */ new Set([
  "class",
  "constant",
  "enum",
  "field",
  "function",
  "interface",
  "module",
  "namespace",
  "property",
  "struct",
  "variable"
]);
var COMPLETION_KINDS = /* @__PURE__ */ new Set([
  ...SYMBOL_KINDS,
  "keyword",
  "parameter",
  "snippet",
  "text",
  "type"
]);
var OFFER_KEYS2 = /* @__PURE__ */ new Set(["languageIds", "documentKinds", "extensions"]);
var REQUEST_KEYS = /* @__PURE__ */ new Set(["languageId", "documentKind", "extension"]);
function recordOf2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function stringList(value) {
  if (!Array.isArray(value) || value.length === 0) return void 0;
  if (!value.every((item) => typeof item === "string" && item.trim().length > 0)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer(value) {
  const record = recordOf2(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS2.has(key2)))
    return void 0;
  const languageIds = stringList(record["languageIds"]);
  if (languageIds === void 0) return void 0;
  const rawKinds = record["documentKinds"];
  const rawExtensions = record["extensions"];
  const documentKinds = rawKinds === void 0 ? void 0 : stringList(rawKinds);
  const extensions = rawExtensions === void 0 ? void 0 : stringList(rawExtensions);
  if (rawKinds !== void 0 && documentKinds === void 0 || rawExtensions !== void 0 && extensions === void 0) {
    return void 0;
  }
  return {
    languageIds,
    ...documentKinds === void 0 ? {} : { documentKinds },
    ...extensions === void 0 ? {} : { extensions }
  };
}
function parseRequest(value) {
  const record = recordOf2(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS.has(key2)))
    return void 0;
  const languageId = record["languageId"];
  const documentKind = record["documentKind"];
  const extension = record["extension"];
  if (typeof languageId !== "string" || languageId.trim().length === 0) return void 0;
  if (documentKind !== void 0 && (typeof documentKind !== "string" || documentKind.length === 0)) {
    return void 0;
  }
  if (extension !== void 0 && (typeof extension !== "string" || extension.length === 0)) {
    return void 0;
  }
  return {
    languageId,
    ...documentKind === void 0 ? {} : { documentKind },
    ...extension === void 0 ? {} : { extension }
  };
}
var normalizedExtension2 = (value) => value.replace(/^\./u, "").toLowerCase();
function matchLanguageFacets(context) {
  const offer = parseOffer(context.offerFacet);
  const request = parseRequest(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/language-facet-invalid",
          `${context.contract}@${context.major}: language request and offer routes must be well formed`
        )
      ]
    };
  }
  if (!offer.languageIds.includes(request.languageId)) return { state: "no-match" };
  if (request.documentKind !== void 0 && !offer.documentKinds?.includes(request.documentKind)) {
    return { state: "no-match" };
  }
  const requestExtension = request.extension;
  if (requestExtension !== void 0 && !offer.extensions?.some(
    (value) => normalizedExtension2(value) === normalizedExtension2(requestExtension)
  )) {
    return { state: "no-match" };
  }
  return {
    state: "match",
    selectionKey: [
      `language=${request.languageId}`,
      `document=${request.documentKind ?? "*"}`,
      `extension=${request.extension === void 0 ? "*" : normalizedExtension2(request.extension)}`
    ].join(";")
  };
}
var LANGUAGE_DOCUMENT_MATCHER = Object.freeze({
  profile: contractId(LANGUAGE_DOCUMENT_MATCHER_PROFILE),
  major: 1,
  match: matchLanguageFacets
});
var LANGUAGE_DOCUMENT_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: LANGUAGE_DOCUMENT_ANALYSIS_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/language-provider-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/language-provider-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: LANGUAGE_DOCUMENT_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.language/document-analysis-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "languageIds", "workspaceLanguageIds"]),
    methods: Object.freeze({
      analyze: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      completion: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      hover: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      signatureHelp: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      definition: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      references: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      prepareRename: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      rename: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      formatting: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      documentSymbols: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      workspaceSymbols: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      diagnostics: Object.freeze({
        kind: "value",
        optional: true,
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var OFFER_KEYS3 = /* @__PURE__ */ new Set(["runtimeIds"]);
var REQUEST_KEYS2 = /* @__PURE__ */ new Set(["runtimeId"]);
function recordOf3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList2(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer2(value) {
  const record = recordOf3(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS3.has(key2)))
    return void 0;
  const runtimeIds = stringList2(record["runtimeIds"]);
  return runtimeIds === void 0 ? void 0 : { runtimeIds };
}
function parseRequest2(value) {
  const record = recordOf3(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS2.has(key2)))
    return void 0;
  const runtimeId = record["runtimeId"];
  return nonEmptyString(runtimeId) ? { runtimeId } : void 0;
}
function matchRuntimeFacets(context) {
  const offer = parseOffer2(context.offerFacet);
  const request = parseRequest2(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/runtime-facet-invalid",
          `${context.contract}@${context.major}: runtime request and offer routes must be well formed`
        )
      ]
    };
  }
  return offer.runtimeIds.includes(request.runtimeId) ? { state: "match", selectionKey: `runtime=${request.runtimeId}` } : { state: "no-match" };
}
var RUNTIME_PROVIDER_MATCHER = Object.freeze({
  profile: contractId(RUNTIME_PROVIDER_MATCHER_PROFILE),
  major: 1,
  match: matchRuntimeFacets
});
var RUNTIME_PROVIDER_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RUNTIME_PROVIDER_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/runtime-provider-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/runtime-provider-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: RUNTIME_PROVIDER_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.runtime/provider-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "providerId", "runtimeIds"]),
    methods: Object.freeze({
      createSession: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: RUNTIME_SESSION_CONTRACT, major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var RUNTIME_SESSION_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RUNTIME_SESSION_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({ presence: "forbidden" }),
  requestFacet: Object.freeze({ presence: "forbidden" }),
  matching: Object.freeze({ profile: FACETLESS_SERVICE_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.runtime/session-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "sessionId", "providerId", "budget"]),
    methods: Object.freeze({
      execute: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      status: Object.freeze({ kind: "value" })
    })
  })
});
var STANDARD_RUNTIME_DEFINITIONS = Object.freeze([RUNTIME_PROVIDER_CONTRACT_DEFINITION, RUNTIME_SESSION_CONTRACT_DEFINITION]);
var OFFER_KEYS4 = /* @__PURE__ */ new Set(["rendererIds", "outputKinds"]);
var REQUEST_KEYS3 = /* @__PURE__ */ new Set(["rendererId", "outputKind"]);
var OUTPUT_KINDS = /* @__PURE__ */ new Set(["rgba8"]);
function recordOf4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString2(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList3(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString2)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function outputKind(value) {
  return typeof value === "string" && OUTPUT_KINDS.has(value) ? value : void 0;
}
function outputKindList(value) {
  if (!Array.isArray(value) || value.length === 0) return void 0;
  const outputKinds = value.flatMap((item) => {
    const parsed = outputKind(item);
    return parsed === void 0 ? [] : [parsed];
  });
  return outputKinds.length === value.length && new Set(outputKinds).size === outputKinds.length ? outputKinds : void 0;
}
function parseOffer3(value) {
  const record = recordOf4(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS4.has(key2)))
    return void 0;
  const rendererIds = stringList3(record["rendererIds"]);
  const outputKinds = outputKindList(record["outputKinds"]);
  return rendererIds === void 0 || outputKinds === void 0 ? void 0 : { rendererIds, outputKinds };
}
function parseRequest3(value) {
  const record = recordOf4(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS3.has(key2)))
    return void 0;
  const rendererId = record["rendererId"];
  const parsedOutput = outputKind(record["outputKind"]);
  if (parsedOutput === void 0 || rendererId !== void 0 && !nonEmptyString2(rendererId)) {
    return void 0;
  }
  return {
    outputKind: parsedOutput,
    ...rendererId === void 0 ? {} : { rendererId }
  };
}
function matchRendererFacets(context) {
  const offer = parseOffer3(context.offerFacet);
  const request = parseRequest3(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/renderer-facet-invalid",
          `${context.contract}@${context.major}: renderer request and offer routes must be well formed`
        )
      ]
    };
  }
  if (!offer.outputKinds.includes(request.outputKind)) return { state: "no-match" };
  if (request.rendererId !== void 0 && !offer.rendererIds.includes(request.rendererId)) {
    return { state: "no-match" };
  }
  return {
    state: "match",
    selectionKey: `renderer=${request.rendererId ?? "*"};output=${request.outputKind}`
  };
}
var SCENE_RENDERER_MATCHER = Object.freeze({
  profile: contractId(SCENE_RENDERER_MATCHER_PROFILE),
  major: 1,
  match: matchRendererFacets
});
var SCENE_RENDERER_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: SCENE_RENDERER_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/scene-renderer-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/scene-renderer-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: SCENE_RENDERER_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.render/scene-3d-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "rendererId", "outputKinds"]),
    methods: Object.freeze({
      render: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var OFFER_KEYS5 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS4 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString3(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList4(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString3)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer4(value) {
  const record = recordOf5(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS5.has(key2)))
    return void 0;
  const gameIds = stringList4(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest4(value) {
  const record = recordOf5(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS4.has(key2))) {
    return void 0;
  }
  return nonEmptyString3(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchGameInstallationFacets(context) {
  const offer = parseOffer4(context.offerFacet);
  const request = parseRequest4(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/game-installation-facet-invalid",
          `${context.contract}@${context.major}: game installation routes must be well formed`
        )
      ]
    };
  }
  return offer.gameIds.includes(request.gameId) ? { state: "match", selectionKey: `game=${request.gameId}` } : { state: "no-match" };
}
var GAME_INSTALLATION_MATCHER = Object.freeze({
  profile: contractId(GAME_INSTALLATION_MATCHER_PROFILE),
  major: 1,
  match: matchGameInstallationFacets
});
var GAME_INSTALLATION_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: GAME_INSTALLATION_DISCOVERY_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/game-installation-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/game-installation-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: GAME_INSTALLATION_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.game/installation-discovery-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "discoveryId", "gameIds", "origins"]),
    methods: Object.freeze({
      discover: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var GAME_LAUNCH_PLAN_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: GAME_LAUNCH_PLAN_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/game-launch-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/game-launch-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: GAME_INSTALLATION_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.game/launch-plan-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "plannerId", "gameIds"]),
    methods: Object.freeze({
      plan: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var OFFER_KEYS6 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS5 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString4(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList5(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString4)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer5(value) {
  const record = recordOf6(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS6.has(key2))) {
    return void 0;
  }
  const gameIds = stringList5(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest5(value) {
  const record = recordOf6(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS5.has(key2))) {
    return void 0;
  }
  return nonEmptyString4(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchModWorkspaceFacets(context) {
  const offer = parseOffer5(context.offerFacet);
  const request = parseRequest5(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/mod-workspace-facet-invalid",
          `${context.contract}@${context.major}: mod workspace routes must be well formed`
        )
      ]
    };
  }
  return offer.gameIds.includes(request.gameId) ? { state: "match", selectionKey: `game=${request.gameId}` } : { state: "no-match" };
}
var MOD_WORKSPACE_MATCHER = Object.freeze({
  profile: contractId(MOD_WORKSPACE_MATCHER_PROFILE),
  major: 1,
  match: matchModWorkspaceFacets
});
var MOD_WORKSPACE_CONTRACT_DEFINITION = Object.freeze(
  {
    schemaVersion: 1,
    kind: "service",
    contract: MOD_WORKSPACE_COMPOSITION_CONTRACT,
    major: 1,
    offerFacet: Object.freeze({
      presence: "required",
      schema: Object.freeze({
        $ref: "https://schemas.modkitx.org/x3/mod-workspace-offer.v1.schema.json"
      })
    }),
    requestFacet: Object.freeze({
      presence: "required",
      schema: Object.freeze({
        $ref: "https://schemas.modkitx.org/x3/mod-workspace-request.v1.schema.json"
      })
    }),
    matching: Object.freeze({ profile: MOD_WORKSPACE_MATCHER_PROFILE, major: 1 }),
    conformanceProfile: "common.mod/workspace-composition-v1",
    surface: Object.freeze({
      fields: Object.freeze(["contract", "compositionId", "gameIds"]),
      methods: Object.freeze({
        compose: Object.freeze({
          kind: "value",
          signal: Object.freeze({ arg: 0, key: "signal" }),
          limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 32768 })
        })
      })
    })
  }
);
var OFFER_KEYS7 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS6 = /* @__PURE__ */ new Set(["gameId"]);
function recordOf7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString5(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList6(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString5)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer6(value) {
  const record = recordOf7(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS7.has(key2))) {
    return void 0;
  }
  const gameIds = stringList6(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest6(value) {
  const record = recordOf7(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS6.has(key2))) {
    return void 0;
  }
  return nonEmptyString5(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchDataCatalogFacets(context) {
  const offer = parseOffer6(context.offerFacet);
  const request = parseRequest6(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/data-catalog-facet-invalid",
          `${context.contract}@${context.major}: data catalog routes must be well formed`
        )
      ]
    };
  }
  return offer.gameIds.includes(request.gameId) ? { state: "match", selectionKey: `game=${request.gameId}` } : { state: "no-match" };
}
var DATA_CATALOG_MATCHER = Object.freeze({
  profile: contractId(DATA_CATALOG_MATCHER_PROFILE),
  major: 1,
  match: matchDataCatalogFacets
});
var RESOLVED_DATA_WORKSPACE_MATCHER = Object.freeze({
  profile: contractId(RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE),
  major: 1,
  match: matchDataCatalogFacets
});
var DATA_CATALOG_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: DATA_CATALOG_ANALYSIS_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/data-catalog-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/data-catalog-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: DATA_CATALOG_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.data/catalog-analysis-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "analyzerId", "gameIds"]),
    methods: Object.freeze({
      analyze: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 16777216, maxStringLength: 4194304 })
      })
    })
  })
});
var RESOLVED_DATA_WORKSPACE_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RESOLVED_DATA_WORKSPACE_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/data-catalog-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/data-catalog-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: RESOLVED_DATA_WORKSPACE_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.data/resolved-workspace-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "providerId", "gameIds"]),
    methods: Object.freeze({
      plan: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 1048576 })
      }),
      analyze: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 16777216, maxStringLength: 4194304 })
      }),
      openSchemaTree: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/tree-data-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openDefinitionTable: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/table-data-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openLocalizationTable: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/table-data-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openRelations: Object.freeze({
        kind: "lease",
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/relation-graph-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openSubjectFacts: Object.freeze({
        kind: "lease",
        optional: true,
        wrapper: "lease",
        result: Object.freeze({ contract: "common.view/subject-facts-source", major: 1 }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      }),
      openSubjectCalculations: Object.freeze({
        kind: "lease",
        optional: true,
        wrapper: "lease",
        result: Object.freeze({
          contract: "common.view/subject-calculations-source",
          major: 1
        }),
        signal: Object.freeze({ arg: 0, key: "signal" })
      })
    })
  })
});
var RESOURCE_NOT_FOUND = "x3.host/resource-not-found";
var RESOURCE_NOT_ALLOWLISTED = "x3.host/resource-not-allowlisted";
var RESOURCE_PATH_REFUSED = "x3.host/resource-path-refused";
var RESOURCE_SCOPE_UNSUPPORTED = "x3.host/resource-scope-unsupported";
var RESOURCE_BUDGET_EXCEEDED = "x3.host/resource-budget-exceeded";
var RESOURCE_CYCLE_DETECTED = "x3.host/resource-cycle-detected";
var RESOURCE_SESSION_DISPOSED = "x3.host/resource-session-disposed";
var REASON_CODES = Object.freeze({
  "not-found": RESOURCE_NOT_FOUND,
  "not-allowlisted": RESOURCE_NOT_ALLOWLISTED,
  "path-refused": RESOURCE_PATH_REFUSED,
  "scope-unsupported": RESOURCE_SCOPE_UNSUPPORTED,
  "budget-exceeded": RESOURCE_BUDGET_EXCEEDED,
  "cycle-detected": RESOURCE_CYCLE_DETECTED,
  "session-disposed": RESOURCE_SESSION_DISPOSED
});
var DEFAULT_RESOURCE_SESSION_LIMITS = Object.freeze({
  maxResources: 256,
  maxBytes: 256n * 1024n * 1024n,
  maxDepth: 8,
  maxEntries: 4096
});
var OFFER_KEYS8 = /* @__PURE__ */ new Set(["gameIds"]);
var REQUEST_KEYS7 = /* @__PURE__ */ new Set(["gameId"]);
var PREVIEW_OFFER_KEYS = /* @__PURE__ */ new Set(["subjectFormatIds"]);
var PREVIEW_REQUEST_KEYS = /* @__PURE__ */ new Set(["subjectFormatId"]);
function recordOf8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString6(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList7(value) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(nonEmptyString6)) return void 0;
  const strings = value;
  return new Set(strings).size === strings.length ? strings : void 0;
}
function parseOffer7(value) {
  const record = recordOf8(value);
  if (record === void 0 || Object.keys(record).some((key2) => !OFFER_KEYS8.has(key2))) {
    return void 0;
  }
  const gameIds = stringList7(record["gameIds"]);
  return gameIds === void 0 ? void 0 : { gameIds };
}
function parseRequest7(value) {
  const record = recordOf8(value);
  if (record === void 0 || Object.keys(record).some((key2) => !REQUEST_KEYS7.has(key2))) {
    return void 0;
  }
  return nonEmptyString6(record["gameId"]) ? { gameId: record["gameId"] } : void 0;
}
function matchMapSemanticFacets(context) {
  const offer = parseOffer7(context.offerFacet);
  const request = parseRequest7(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/map-semantic-facet-invalid",
          `${context.contract}@${context.major}: semantic map routes must be well formed`
        )
      ]
    };
  }
  return offer.gameIds.includes(request.gameId) ? { state: "match", selectionKey: `game=${request.gameId}` } : { state: "no-match" };
}
var MAP_SEMANTIC_MATCHER = Object.freeze({
  profile: contractId(MAP_SEMANTIC_MATCHER_PROFILE),
  major: 1,
  match: matchMapSemanticFacets
});
function parsePreviewOffer(value) {
  const record = recordOf8(value);
  if (record === void 0 || Object.keys(record).some((key2) => !PREVIEW_OFFER_KEYS.has(key2))) {
    return void 0;
  }
  const subjectFormatIds = stringList7(record["subjectFormatIds"]);
  return subjectFormatIds === void 0 ? void 0 : { subjectFormatIds };
}
function parsePreviewRequest(value) {
  const record = recordOf8(value);
  if (record === void 0 || Object.keys(record).some((key2) => !PREVIEW_REQUEST_KEYS.has(key2))) {
    return void 0;
  }
  return nonEmptyString6(record["subjectFormatId"]) ? { subjectFormatId: record["subjectFormatId"] } : void 0;
}
function matchMapPreviewPreparationFacets(context) {
  const offer = parsePreviewOffer(context.offerFacet);
  const request = parsePreviewRequest(context.requestFacet);
  if (offer === void 0 || request === void 0) {
    return {
      state: "invalid",
      diagnostics: [
        diagnostic(
          "error",
          "x3.host/map-preview-preparation-facet-invalid",
          `${context.contract}@${context.major}: map preview preparation routes must be well formed`
        )
      ]
    };
  }
  return offer.subjectFormatIds.includes(request.subjectFormatId) ? { state: "match", selectionKey: `subject-format=${request.subjectFormatId}` } : { state: "no-match" };
}
var MAP_PREVIEW_PREPARATION_MATCHER = Object.freeze({
  profile: contractId(MAP_PREVIEW_PREPARATION_MATCHER_PROFILE),
  major: 1,
  match: matchMapPreviewPreparationFacets
});
var MAP_SEMANTIC_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: MAP_SEMANTIC_ANALYSIS_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/map-semantic-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/map-semantic-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: MAP_SEMANTIC_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.map/semantic-analysis-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "analyzerId", "gameIds"]),
    methods: Object.freeze({
      open: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 33554432, maxStringLength: 4194304 })
      })
    })
  })
});
var RESOLVED_MAP_WORKSPACE_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: RESOLVED_MAP_WORKSPACE_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/map-semantic-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/map-semantic-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({ profile: MAP_SEMANTIC_MATCHER_PROFILE, major: 1 }),
  conformanceProfile: "common.map/resolved-workspace-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "analyzerId", "gameIds"]),
    methods: Object.freeze({
      plan: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 1048576 })
      }),
      analyze: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 33554432, maxStringLength: 4194304 })
      })
    })
  })
});
var MAP_PREVIEW_PREPARATION_CONTRACT_DEFINITION = Object.freeze({
  schemaVersion: 1,
  kind: "service",
  contract: MAP_PREVIEW_PREPARATION_CONTRACT,
  major: 1,
  offerFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/map-preview-preparation-offer.v1.schema.json"
    })
  }),
  requestFacet: Object.freeze({
    presence: "required",
    schema: Object.freeze({
      $ref: "https://schemas.modkitx.org/x3/map-preview-preparation-request.v1.schema.json"
    })
  }),
  matching: Object.freeze({
    profile: MAP_PREVIEW_PREPARATION_MATCHER_PROFILE,
    major: 1
  }),
  conformanceProfile: "common.map/preview-preparation-v1",
  surface: Object.freeze({
    fields: Object.freeze(["contract", "preparationId", "subjectFormatIds"]),
    methods: Object.freeze({
      prepare: Object.freeze({
        kind: "value",
        signal: Object.freeze({ arg: 0, key: "signal" }),
        limits: Object.freeze({ maxBytes: 4194304, maxStringLength: 1048576 })
      })
    })
  })
});
var ABI_CODEC_MODULE = { contract: "x3.abi/codec-module", major: 1 };
var ABI_SERVICE_PROVIDER_MODULE = {
  contract: "x3.abi/service-provider-module",
  major: 1
};
var ABI_CODEC = { contract: "x3.abi/codec", major: 1 };
var ABI_ASSET_SESSION = { contract: "x3.abi/asset-session", major: 1 };
var ABI_OPERATION_SESSION = { contract: "x3.abi/operation-session", major: 1 };
var ABI_ARTIFACT_SOURCE = { contract: "x3.abi/artifact-source", major: 1 };
var ABI_ASSET_NAMESPACE = { contract: "x3.abi/asset-namespace", major: 1 };
var ABI_ASSET_INPUT = { contract: "x3.abi/asset-input", major: 1 };
var ABI_DIAGNOSTIC_SINK = { contract: "x3.abi/diagnostic-sink", major: 1 };
var ABI_CONTRACT_RESOLVER = { contract: "x3.abi/contract-resolver", major: 1 };
var sig = { signal: "last" };
var codecModuleSurface = {
  ...ABI_CODEC_MODULE,
  fields: ["abiVersion"],
  methods: {
    /** `createCodec(context)` — the backend marshals `context` (budgets copied, ports as refs). */
    createCodec: { kind: "lease", result: ABI_CODEC, wrapper: "bare" }
  }
};
var serviceProviderModuleSurface = {
  ...ABI_SERVICE_PROVIDER_MODULE,
  fields: ["abiVersion", "provides"],
  methods: {
    /**
     * `createProvider(selection, context)` — the leased provider's surface is the one the
     * selection names (its contract definition's `surface`); `context` is marshalled like
     * `createCodec`'s. Returns a `Lease`: releasing the handle releases the provider.
     */
    createProvider: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } }
    }
  }
};
var codecSurface = {
  ...ABI_CODEC,
  methods: {
    probe: { kind: "value", ...sig },
    planInput: { kind: "value", optional: true, ...sig },
    open: { kind: "lease", result: ABI_ASSET_SESSION, wrapper: "bare", ...sig }
  }
};
var assetSessionSurface = {
  ...ABI_ASSET_SESSION,
  fields: ["revision"],
  releaseVia: "dispose",
  methods: {
    state: { kind: "value" },
    descriptor: { kind: "value" },
    /** `dataSource(contract, major)` — the leased surface is named by the arguments. */
    dataSource: {
      kind: "lease",
      resultFromArgs: { contract: 0, major: 1 },
      wrapper: "lease"
    },
    operations: { kind: "lease", result: ABI_OPERATION_SESSION, wrapper: "bare" },
    events: { kind: "events", ...sig },
    dispose: { kind: "value" }
  }
};
var operationSessionSurface = {
  ...ABI_OPERATION_SESSION,
  releaseVia: "dispose",
  methods: {
    invoke: {
      kind: "value",
      signal: { arg: 2, key: "signal" },
      progress: { arg: 2, key: "onProgress" }
    },
    dispose: { kind: "value" }
  }
};
var artifactSourceSurface = {
  ...ABI_ARTIFACT_SOURCE,
  fields: ["ref", "revision", "kind", "size"],
  methods: {
    read: { kind: "value", optional: true, ...sig },
    stream: { kind: "iterable", optional: true, ...sig },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE,
      wrapper: "lease",
      optional: true,
      ...sig
    }
  }
};
var assetNamespaceSurface = {
  ...ABI_ASSET_NAMESPACE,
  methods: {
    list: { kind: "iterable", ...sig },
    open: { kind: "lease", result: ABI_ARTIFACT_SOURCE, wrapper: "lease", ...sig }
  }
};
var assetInputSurface = {
  ...ABI_ASSET_INPUT,
  // topology data as fields: physical bindings, the namespace/derived discriminants, the derived
  // subject list and its optional materialized requirement/recipe
  fields: [
    "originKind",
    "root",
    "bindings",
    "revisions",
    "primaryBindingId",
    "subjects",
    "recipe",
    "materialized"
  ],
  methods: {
    openBinding: {
      kind: "lease",
      result: ABI_ARTIFACT_SOURCE,
      wrapper: "lease",
      optional: true,
      ...sig
    },
    openNamespace: {
      kind: "lease",
      result: ABI_ASSET_NAMESPACE,
      wrapper: "lease",
      optional: true,
      ...sig
    },
    // derived inputs: open one input subject as a session, or the optional materialized artifact
    openSubject: {
      kind: "lease",
      result: ABI_ASSET_SESSION,
      wrapper: "lease",
      optional: true,
      ...sig
    },
    openMaterialized: {
      kind: "lease",
      result: ABI_ARTIFACT_SOURCE,
      wrapper: "lease",
      optional: true,
      ...sig
    }
  }
};
var contractResolverSurface = {
  ...ABI_CONTRACT_RESOLVER,
  methods: {
    resolve: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } },
      signal: { arg: 0, key: "signal" }
    },
    resolveUnknown: {
      kind: "lease",
      wrapper: "lease",
      resultFromArgs: { contract: { arg: 0, key: "contract" }, major: { arg: 0, key: "major" } },
      signal: { arg: 0, key: "signal" }
    }
  }
};
var diagnosticSinkSurface = {
  ...ABI_DIAGNOSTIC_SINK,
  methods: {
    report: { kind: "value" }
  }
};
var RUNTIME_ABI_SURFACES = Object.freeze([
  codecModuleSurface,
  serviceProviderModuleSurface,
  codecSurface,
  assetSessionSurface,
  operationSessionSurface,
  artifactSourceSurface,
  assetNamespaceSurface,
  assetInputSurface,
  diagnosticSinkSurface,
  contractResolverSurface
]);
var WIRE_TYPED_ARRAYS = Object.freeze({
  bytes: Uint8Array,
  i8: Int8Array,
  u8c: Uint8ClampedArray,
  i16: Int16Array,
  u16: Uint16Array,
  i32: Int32Array,
  u32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
  i64: BigInt64Array,
  u64: BigUint64Array
});
var DEFAULT_PROTOCOL_LIMITS = Object.freeze({
  maxDepth: 32,
  // Resolved game catalogs legitimately carry tens of thousands of definitions and field nodes
  // in one pinned snapshot. The byte, array, object-key, deadline and worker-memory ceilings still
  // bound the frame; this node ceiling prevents valid schemas from being rejected first.
  maxNodes: 4e6,
  maxStringLength: 4 * 1024 * 1024,
  maxArrayLength: 1e5,
  maxObjectKeys: 1e4,
  maxTransferBytes: 64 * 1024 * 1024,
  maxArgs: 16,
  maxPendingCalls: 256,
  maxHandles: 4096,
  maxIterators: 256,
  maxSubscriptions: 64,
  maxQueuedEvents: 1024,
  defaultCallDeadlineMs: 3e4,
  iteratorBatchItems: 1
});
function protocolLimits(overrides = {}) {
  const merged = { ...DEFAULT_PROTOCOL_LIMITS, ...overrides };
  for (const [key2, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ModkitError({
        code: "x3.host/rpc-invalid-limits",
        message: `protocol limit ${key2} must be a non-negative safe integer`,
        context: { key: key2 }
      });
    }
  }
  if (merged.iteratorBatchItems < 1 || merged.iteratorBatchItems > merged.maxArrayLength) {
    throw new ModkitError({
      code: "x3.host/rpc-invalid-limits",
      message: "protocol limit iteratorBatchItems must be between 1 and maxArrayLength",
      context: { key: "iteratorBatchItems" }
    });
  }
  return Object.freeze(merged);
}
var MAX_ERROR_MESSAGE = 8 * 1024;
var SUBJECT_SERVICES = Object.freeze({ contract: "x3.app/subject-services", major: 1 });
var SUBJECT_EDITING = Object.freeze({ contract: "x3.app/subject-editing", major: 1 });
var subjectServicesSurface = {
  ...SUBJECT_SERVICES,
  methods: {
    /** `open(path)` → an inert snapshot (opened carries a `sessionId` to attach). */
    open: { kind: "value", signal: "last" },
    /** `attach(sessionId)` → the live session under `x3.abi/asset-session@1`. */
    attach: { kind: "lease", result: ABI_ASSET_SESSION, wrapper: "bare" },
    /** `edit(sessionId)` → the editing arm, when this host can write this subject. */
    edit: { kind: "lease", result: SUBJECT_EDITING, wrapper: "bare" }
  }
};
var subjectEditingSurface = {
  ...SUBJECT_EDITING,
  releaseVia: "dispose",
  methods: {
    state: { kind: "value" },
    propose: { kind: "value", signal: "last", arity: 1 },
    plan: { kind: "value", signal: "last", arity: 1 },
    prepare: { kind: "value", signal: "last", arity: 1 },
    commit: { kind: "value", signal: "last", arity: 1 },
    dispose: { kind: "value" }
  }
};
var SUBJECT_RPC_LIMITS = protocolLimits({ defaultCallDeadlineMs: 6e4 });
var HOST_RAW_WRITER_IDENTITY = Object.freeze({
  providerId: "org.modkitx.host/raw-writer",
  providerVersion: "1.0.0",
  artifactDigest: "host:raw-writer",
  formatId: "*",
  representationId: "source"
});
var RAW_CLAIM = Object.freeze({
  roundTrip: "byte-identical",
  preservesUnknownData: true
});
var HOST_RAW_WRITER_EVIDENCE_ID = "host:raw-writer/by-construction";
var HOST_RAW_WRITER_EVIDENCE_RECORD = Object.freeze({
  writer: HOST_RAW_WRITER_IDENTITY,
  claim: RAW_CLAIM,
  evidenceId: HOST_RAW_WRITER_EVIDENCE_ID,
  corpusId: "by-construction: literal replacement, no re-encoding",
  corpusDigest: "none:by-construction",
  conformanceProfile: "org.modkitx/raw-writer-v1",
  optionsFingerprint: "options:none",
  inputClass: "any",
  provenAt: "2026-08-19T00:00:00Z"
});
var GUARANTEE_STRENGTH = Object.freeze({
  "best-effort": 0,
  recoverable: 1,
  transactional: 2,
  atomic: 3
});
var NO_STAGED_PAYLOADS = Object.freeze({
  async open(ref) {
    throw new ModkitError({
      code: "x3.host/edit-payload-unavailable",
      message: `no payload store can open staged payload \xAB${ref.handleId}\xBB`
    });
  }
});
var DEFAULT_INLINE_PAYLOAD_BYTES = 16 * 1024 * 1024;
var DEFAULT_MAXIMUM_SEARCHABLE_CHARACTERS = 64 * 1024 * 1024;
var HARD_MAXIMUM_SEARCHABLE_CHARACTERS = 128 * 1024 * 1024;
var UINT64_MASK = (1n << 64n) - 1n;
var DEFAULT_CHUNK_BYTES = 64 * 1024;
function safeLength(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ModkitError({
      code: "x3.host/text-source-too-large",
      message: "text source exceeds the exact JavaScript indexing range"
    });
  }
  return Number(value);
}
async function readBounded(source, offset, length, chunkBytes, signal) {
  const total = safeLength(length);
  const result = new Uint8Array(total);
  let written = 0;
  while (written < total) {
    throwIfAborted(signal);
    const next = await source.read(
      offset + BigInt(written),
      Math.min(chunkBytes, total - written),
      signal
    );
    if (next.byteLength === 0) break;
    result.set(next, written);
    written += next.byteLength;
  }
  return written === total ? result : result.slice(0, written);
}
function cursor2(offset, line) {
  return `v1:${offset}:${line}`;
}
function parseCursor(value) {
  const match = /^v1:(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.exec(value);
  if (match === null) {
    throw new ModkitError({
      code: "x3.host/invalid-text-cursor",
      message: "text cursor is malformed or belongs to another implementation version"
    });
  }
  const line = Number(match[2]);
  if (!Number.isSafeInteger(line)) {
    throw new ModkitError({
      code: "x3.host/invalid-text-cursor",
      message: "text cursor line is outside the exact JavaScript range"
    });
  }
  return { offset: BigInt(match[1]), line };
}
function createUtf8TextDataSource(source, options = {}) {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new TypeError("text source chunkBytes must be a positive safe integer");
  }
  let indexPromise;
  const buildIndex = async (signal) => {
    const size = await source.size();
    const first = await source.read(0n, 3, signal);
    const bom = first[0] === 239 && first[1] === 187 && first[2] === 191;
    const lineStarts = [bom ? 3n : 0n];
    const newlineKinds = /* @__PURE__ */ new Set();
    let lineStart = lineStarts[0];
    let longest = 0n;
    let offset = 0n;
    let pendingCr;
    while (offset < size) {
      throwIfAborted(signal);
      const bytes = await source.read(
        offset,
        Math.min(chunkBytes, safeLength(size - offset)),
        signal
      );
      if (bytes.byteLength === 0) break;
      for (let index2 = 0; index2 < bytes.byteLength; index2 += 1) {
        const absolute = offset + BigInt(index2);
        const byte = bytes[index2];
        if (pendingCr !== void 0) {
          if (byte === 10) {
            newlineKinds.add("crlf");
            longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart;
            lineStart = absolute + 1n;
            lineStarts.push(lineStart);
            pendingCr = void 0;
            continue;
          }
          newlineKinds.add("cr");
          longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart;
          lineStart = pendingCr + 1n;
          lineStarts.push(lineStart);
          pendingCr = void 0;
        }
        if (byte === 13) pendingCr = absolute;
        else if (byte === 10) {
          newlineKinds.add("lf");
          longest = longest > absolute - lineStart ? longest : absolute - lineStart;
          lineStart = absolute + 1n;
          lineStarts.push(lineStart);
        }
      }
      offset += BigInt(bytes.byteLength);
    }
    if (pendingCr !== void 0) {
      newlineKinds.add("cr");
      longest = longest > pendingCr - lineStart ? longest : pendingCr - lineStart;
      lineStart = pendingCr + 1n;
      lineStarts.push(lineStart);
    }
    longest = longest > size - lineStart ? longest : size - lineStart;
    const kinds = [...newlineKinds];
    return Object.freeze({
      size,
      bom,
      lineStarts: Object.freeze(lineStarts),
      newline: kinds.length > 1 ? "mixed" : kinds[0] ?? "lf",
      longestLineBytes: longest > BigInt(Number.MAX_SAFE_INTEGER) ? "unknown" : Number(longest)
    });
  };
  const index = (signal) => {
    indexPromise ??= buildIndex(signal);
    return indexPromise;
  };
  const slice = async (request, signal) => {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new ModkitError({
        code: "x3.host/invalid-text-page",
        message: "text page maxBytes must be a positive safe integer"
      });
    }
    const facts = await index(signal);
    let fromLine;
    let start;
    let requestedEnd;
    if (request.kind === "from-line") {
      if (!Number.isSafeInteger(request.line) || request.line < 0 || !Number.isSafeInteger(request.lineCount) || request.lineCount <= 0) {
        throw new ModkitError({
          code: "x3.host/invalid-text-page",
          message: "text line and lineCount must be safe non-negative page coordinates"
        });
      }
      fromLine = request.line;
      start = facts.lineStarts[fromLine] ?? facts.size;
      requestedEnd = facts.lineStarts[fromLine + request.lineCount] ?? facts.size;
    } else {
      const parsed = parseCursor(request.cursor);
      fromLine = parsed.line;
      start = parsed.offset;
      requestedEnd = facts.size;
    }
    if (start > facts.size) {
      throw new ModkitError({
        code: "x3.host/invalid-text-cursor",
        message: "text cursor points beyond the current source revision"
      });
    }
    const pageEnd = start + BigInt(request.maxBytes);
    const end = [facts.size, requestedEnd, pageEnd].reduce(
      (left, right) => left < right ? left : right
    );
    const bytes = await readBounded(source, start, end - start, chunkBytes, signal);
    throwIfAborted(signal);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const actualEnd = start + BigInt(bytes.byteLength);
    let nextLine = fromLine;
    while (nextLine + 1 < facts.lineStarts.length && facts.lineStarts[nextLine + 1] <= actualEnd) {
      nextLine += 1;
    }
    const complete = actualEnd >= facts.size;
    return complete ? { complete: true, text, fromLine, lineCount: nextLine - fromLine + (text === "" ? 0 : 1) } : {
      complete: false,
      text,
      fromLine,
      lineCount: nextLine - fromLine + (text === "" ? 0 : 1),
      nextCursor: cursor2(actualEnd, nextLine)
    };
  };
  return Object.freeze({
    async info() {
      const facts = await index();
      return {
        bytes: facts.size,
        encoding: "utf-8",
        bom: facts.bom,
        newline: facts.newline,
        lines: facts.lineStarts.length,
        longestLineBytes: facts.longestLineBytes
      };
    },
    slice,
    async *search(query, signal) {
      const facts = await index(signal);
      const flags = query.caseSensitive ? "gu" : "giu";
      const expression = query.regex ? new RegExp(query.pattern, flags) : new RegExp(query.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      for (let line = 0; line < facts.lineStarts.length; line += 1) {
        throwIfAborted(signal);
        const start = facts.lineStarts[line];
        const end = facts.lineStarts[line + 1] ?? facts.size;
        const bytes = await readBounded(source, start, end - start, chunkBytes, signal);
        const text = new TextDecoder().decode(bytes);
        for (const match of text.matchAll(expression)) {
          const prefixBytes = new TextEncoder().encode(text.slice(0, match.index)).byteLength;
          const matchBytes = new TextEncoder().encode(match[0]).byteLength;
          yield Object.freeze({
            byteOffset: uint64(start + BigInt(prefixBytes)),
            byteLength: uint64(BigInt(matchBytes))
          });
          if (match[0] === "") expression.lastIndex += 1;
        }
      }
    }
  });
}
var COMMON_PRESENTATION_CATALOG = Object.freeze([
  Object.freeze({
    slot: Object.freeze({
      slotId: "code",
      kind: "stage",
      contributionId: "org.modkitx.ui-monaco/code-stage",
      extensionId: "org.modkitx/ui-monaco",
      priority: 400,
      singletonGroup: "stage.code",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "code-content",
          contract: "common.view/text-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "content.text", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/text-data-source", major: 1 }],
      applicability: { interpretation: "any", sourceBytes: { maximum: "8388608" } },
      priority: 400,
      singletonGroup: "stage.code"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "video",
      kind: "stage",
      contributionId: "org.modkitx.ui/video-stage",
      extensionId: "org.modkitx/ui",
      priority: 370,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "video-content",
          contract: "common.view/video-media-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "video.streams", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/video-media-source", major: 1 }],
      priority: 370,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "image",
      kind: "stage",
      contributionId: "org.modkitx.ui/image-stage",
      extensionId: "org.modkitx/ui",
      priority: 360,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "image-content",
          contract: "common.view/raster-image-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "image.raster", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/raster-image-source", major: 1 }],
      priority: 360,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "audio",
      kind: "stage",
      contributionId: "org.modkitx.ui/audio-stage",
      extensionId: "org.modkitx/ui",
      priority: 360,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "audio-content",
          contract: "common.view/audio-media-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "audio.streams", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/audio-media-source", major: 1 }],
      priority: 360,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "world",
      kind: "stage",
      contributionId: "org.modkitx.ui/world-stage",
      extensionId: "org.modkitx/ui",
      priority: 380,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "world-content",
          contract: "common.view/world-scene-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/world-scene-source", major: 1 }],
      priority: 380,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "model",
      kind: "stage",
      contributionId: "org.modkitx.ui/model-stage",
      extensionId: "org.modkitx/ui",
      priority: 350,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "model-content",
          contract: "common.view/model-scene-source",
          major: 1
        })
      ])
    }),
    optionalBindings: Object.freeze([
      Object.freeze({
        bindingId: "model-optional-1",
        contract: "common.view/model-resource-refs-source",
        major: 1
      }),
      Object.freeze({
        bindingId: "model-optional-2",
        contract: "common.view/model-skeleton-source",
        major: 1
      }),
      Object.freeze({
        bindingId: "model-optional-3",
        contract: "common.view/model-animation-source",
        major: 1
      }),
      Object.freeze({
        bindingId: "model-optional-4",
        contract: "common.view/model-collision-source",
        major: 1
      }),
      Object.freeze({
        bindingId: "model-optional-5",
        contract: "common.view/model-material-source",
        major: 1
      })
    ]),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "model.geometry", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/model-scene-source", major: 1 }],
      optionalDataSources: [
        { contract: "common.view/model-resource-refs-source", major: 1 },
        { contract: "common.view/model-skeleton-source", major: 1 },
        { contract: "common.view/model-animation-source", major: 1 },
        { contract: "common.view/model-collision-source", major: 1 },
        { contract: "common.view/model-material-source", major: 1 }
      ],
      priority: 350,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "vector",
      kind: "stage",
      contributionId: "org.modkitx.ui/vector-stage",
      extensionId: "org.modkitx/ui",
      priority: 350,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "vector-content",
          contract: "common.view/vector-scene-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "vector.scene", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/vector-scene-source", major: 1 }],
      priority: 350,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "table",
      kind: "stage",
      contributionId: "org.modkitx.ui/table-stage",
      extensionId: "org.modkitx/ui",
      priority: 320,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "table-content",
          contract: "common.view/table-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "table.cells", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/table-data-source", major: 1 }],
      priority: 320,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "card",
      kind: "stage",
      contributionId: "org.modkitx.ui/subject-card-stage",
      extensionId: "org.modkitx/ui",
      priority: 390,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "card-content",
          contract: "common.view/subject-facts-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/subject-facts-source", major: 1 }],
      priority: 390,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "calculations",
      kind: "stage",
      contributionId: "org.modkitx.ui/subject-calculations-stage",
      extensionId: "org.modkitx/ui",
      priority: 380,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "calculations-content",
          contract: "common.view/subject-calculations-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/subject-calculations-source", major: 1 }],
      priority: 380,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "relations",
      kind: "stage",
      contributionId: "org.modkitx.ui/relation-graph-stage",
      extensionId: "org.modkitx/ui",
      priority: 370,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "relations-content",
          contract: "common.view/relation-graph-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/relation-graph-source", major: 1 }],
      priority: 370,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "template",
      kind: "stage",
      contributionId: "org.modkitx.ui/game-template-stage",
      extensionId: "org.modkitx/ui",
      priority: 365,
      singletonGroup: "center-stage",
      bindings: Object.freeze([])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresOperations: ["view.template"],
      consumesDataSources: [],
      priority: 365,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "tree",
      kind: "stage",
      contributionId: "org.modkitx.ui/tree-stage",
      extensionId: "org.modkitx/ui",
      priority: 300,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "tree-content",
          contract: "common.view/tree-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "structure.hierarchy", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/tree-data-source", major: 1 }],
      priority: 300,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "text",
      kind: "stage",
      contributionId: "org.modkitx.ui/bounded-text-stage",
      extensionId: "org.modkitx/ui",
      priority: 220,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "text-content",
          contract: "common.view/text-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "content.text", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/text-data-source", major: 1 }],
      applicability: {
        interpretation: "any",
        sourceBytes: { maximum: "16777216" },
        longestLineBytes: { maximum: 1048576, whenUnknown: "ineligible" }
      },
      priority: 220,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "virtual-text",
      kind: "stage",
      contributionId: "org.modkitx.ui/virtual-text-stage",
      extensionId: "org.modkitx/ui",
      priority: 120,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "virtual-text-content",
          contract: "common.view/text-data-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      requiresTraits: [{ id: "content.text", states: ["available"] }],
      consumesDataSources: [{ contract: "common.view/text-data-source", major: 1 }],
      applicability: { interpretation: "any" },
      priority: 120,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "hex",
      kind: "stage",
      contributionId: "org.modkitx.ui/hex-stage",
      extensionId: "org.modkitx/ui",
      priority: 40,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "hex-content",
          contract: "common.view/byte-range-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/byte-range-source", major: 1 }],
      priority: 40,
      singletonGroup: "center-stage"
    })
  }),
  Object.freeze({
    slot: Object.freeze({
      slotId: "archive",
      kind: "stage",
      contributionId: "org.modkitx.ui/archive-stage",
      extensionId: "org.modkitx/ui",
      priority: 340,
      singletonGroup: "center-stage",
      bindings: Object.freeze([
        Object.freeze({
          bindingId: "archive-content",
          contract: "common.view/namespace-entry-source",
          major: 1
        })
      ])
    }),
    spec: Object.freeze({
      kind: "stage",
      consumesDataSources: [{ contract: "common.view/namespace-entry-source", major: 1 }],
      priority: 340,
      singletonGroup: "center-stage"
    })
  })
]);
var codec_json_default = {
  schemaVersion: 1,
  contract: {
    id: "org.modkitx/codec-contribution",
    major: 1
  },
  id: "org.modkitx/text-json",
  displayName: "JSON text data",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./json/families/json/entrypoints/json-codec.js",
      target: {
        environments: ["node"]
      },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: ["read-source"]
    },
    {
      variantId: "portable",
      entrypoint: "./json/families/json/entrypoints/json-codec.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: ["read-source"]
    }
  ],
  spec: {
    formatRefs: [
      {
        formatId: "json",
        label: "JSON",
        mediaType: "application/json"
      }
    ],
    roles: ["semantic"],
    sourceTopology: "single",
    artifactStages: ["authored"],
    openIntents: ["probe", "inspect", "full", "stream", "export"],
    match: {
      extensions: ["json"],
      mediaTypes: ["application/json"]
    },
    probe: {
      kind: "bytes",
      ranges: [
        {
          from: "start",
          length: 8192
        }
      ],
      maxBytes: 8192
    },
    requires: [
      {
        contract: "common.text-data/json-syntax",
        major: 1,
        range: "^1.0.0"
      }
    ],
    representations: [
      {
        id: "syntax-document",
        contract: "common.text-data/json-document",
        major: 1,
        stage: "authored",
        lossy: false
      }
    ],
    publishesDataSources: [
      {
        contract: "common.view/tree-data-source",
        major: 1
      },
      {
        contract: "common.view/text-data-source",
        major: 1
      },
      {
        contract: "common.view/byte-range-source",
        major: 1
      }
    ],
    operations: [
      {
        id: "view.inspect",
        handlerId: "inspect",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "asset.validate",
        handlerId: "validate",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["none"]
      },
      {
        id: "asset.search",
        handlerId: "search",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "export.raw",
        handlerId: "export-raw",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      },
      {
        id: "data.parse",
        handlerId: "parse",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "data.serialize",
        handlerId: "serialize",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      }
    ],
    traitDeclarations: [
      {
        id: "structure.hierarchy",
        representation: "source",
        presence: "will-expose"
      },
      {
        id: "content.text",
        representation: "source",
        presence: "will-expose"
      },
      {
        id: "content.binary",
        representation: "source",
        presence: "will-expose"
      }
    ],
    implementationTier: {
      claimed: 1
    },
    budgets: {
      maxInputBytes: "1073741824",
      maxDepth: 256,
      maxNodes: 1e6,
      maxScalarBytes: 104857600,
      maxDiagnostics: 1e4
    }
  }
};
var codec_jsonc_default = {
  schemaVersion: 1,
  contract: {
    id: "org.modkitx/codec-contribution",
    major: 1
  },
  id: "org.modkitx/text-jsonc",
  displayName: "JSONC text data",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./json/families/json/entrypoints/jsonc-codec.js",
      target: {
        environments: ["node"]
      },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: ["read-source"]
    },
    {
      variantId: "portable",
      entrypoint: "./json/families/json/entrypoints/jsonc-codec.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: ["read-source"]
    }
  ],
  spec: {
    formatRefs: [
      {
        formatId: "jsonc",
        label: "JSONC",
        mediaType: "application/jsonc"
      }
    ],
    roles: ["semantic"],
    sourceTopology: "single",
    artifactStages: ["authored"],
    openIntents: ["probe", "inspect", "full", "stream", "export"],
    match: {
      extensions: ["jsonc"],
      mediaTypes: ["application/jsonc"]
    },
    probe: {
      kind: "bytes",
      ranges: [
        {
          from: "start",
          length: 8192
        }
      ],
      maxBytes: 8192
    },
    requires: [
      {
        contract: "common.text-data/jsonc-syntax",
        major: 1,
        range: "^1.0.0"
      }
    ],
    representations: [
      {
        id: "syntax-document",
        contract: "common.text-data/jsonc-document",
        major: 1,
        stage: "authored",
        lossy: false
      }
    ],
    publishesDataSources: [
      {
        contract: "common.view/tree-data-source",
        major: 1
      },
      {
        contract: "common.view/text-data-source",
        major: 1
      },
      {
        contract: "common.view/byte-range-source",
        major: 1
      }
    ],
    operations: [
      {
        id: "view.inspect",
        handlerId: "inspect",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "asset.validate",
        handlerId: "validate",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["none"]
      },
      {
        id: "asset.search",
        handlerId: "search",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "export.raw",
        handlerId: "export-raw",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      },
      {
        id: "data.parse",
        handlerId: "parse",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "data.serialize",
        handlerId: "serialize",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      }
    ],
    traitDeclarations: [
      {
        id: "structure.hierarchy",
        representation: "source",
        presence: "will-expose"
      },
      {
        id: "content.text",
        representation: "source",
        presence: "will-expose"
      },
      {
        id: "content.binary",
        representation: "source",
        presence: "will-expose"
      }
    ],
    implementationTier: {
      claimed: 1
    },
    budgets: {
      maxInputBytes: "1073741824",
      maxDepth: 256,
      maxNodes: 1e6,
      maxScalarBytes: 104857600,
      maxDiagnostics: 1e4
    }
  }
};
var codec_txt_default = {
  schemaVersion: 1,
  contract: { id: "org.modkitx/codec-contribution", major: 1 },
  id: "org.modkitx/txt",
  displayName: "Plain Text Document",
  status: "supported",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./plain/txt/codec.js",
      target: { environments: ["node"] },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: ["read-source"]
    },
    {
      variantId: "portable",
      entrypoint: "./plain/txt/codec.js",
      target: { environments: ["browser-worker", "node-worker"] },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: ["read-source"]
    }
  ],
  limitations: [
    "The codec is read-only: editing plain text is the separate org.modkitx/plain-text-writer contribution, and no operation here mutates a source.",
    "UTF-16 is accepted only with a byte-order mark, and a UTF-16 document publishes the paragraph outline and the raw bytes but not the lazy text source, whose line index is only true for UTF-8."
  ],
  spec: {
    formatRefs: [
      { formatId: "txt", label: "Plain Text Document", mediaType: "text/plain" }
    ],
    roles: ["semantic"],
    sourceTopology: "single",
    artifactStages: ["authored"],
    openIntents: ["probe", "inspect", "full", "export"],
    match: { extensions: ["txt"], mediaTypes: ["text/plain"] },
    probe: { kind: "bytes", ranges: [{ from: "start", length: 8192 }], maxBytes: 8192 },
    representations: [
      {
        id: "flow-metadata",
        contract: "common.document/flow-metadata",
        major: 1,
        stage: "authored",
        lossy: false
      }
    ],
    publishesDataSources: [
      { contract: "common.view/tree-data-source", major: 1 },
      { contract: "common.view/text-data-source", major: 1 },
      { contract: "common.view/byte-range-source", major: 1 }
    ],
    operations: [
      {
        id: "view.inspect",
        handlerId: "inspect",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "asset.validate",
        handlerId: "validate",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["none"]
      },
      {
        id: "asset.search",
        handlerId: "search",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["json"]
      },
      {
        id: "export.raw",
        handlerId: "export-raw",
        mutatesSource: false,
        requiredPermissions: ["read-source"],
        outputKinds: ["bytes"]
      }
    ],
    traitDeclarations: [
      { id: "document.flow", representation: "source", presence: "will-expose" },
      { id: "structure.hierarchy", representation: "source", presence: "will-expose" },
      { id: "content.text", representation: "source", presence: "will-expose" },
      { id: "content.binary", representation: "source", presence: "will-expose" }
    ],
    implementationTier: { claimed: 1 },
    budgets: {
      maxInputBytes: "1073741824",
      maxDepth: 64,
      maxNodes: 1e5,
      maxScalarBytes: 104857600,
      maxDiagnostics: 1e3
    }
  }
};
var contract_json_syntax_default = {
  schemaVersion: 1,
  contract: {
    id: "org.modkitx/contract-definition",
    major: 1
  },
  id: "org.modkitx/json-syntax-contract",
  displayName: "JSON syntax service contract",
  spec: {
    schemaVersion: 1,
    kind: "service",
    contract: "common.text-data/json-syntax",
    major: 1,
    offerFacet: {
      presence: "forbidden"
    },
    requestFacet: {
      presence: "forbidden"
    },
    matching: {
      profile: "org.modkitx/facetless-matcher",
      major: 1
    },
    conformanceProfile: "common.text-data/json-syntax-v1",
    surface: {
      fields: ["contract"],
      methods: {
        parse: {
          kind: "value",
          signal: {
            arg: 0,
            key: "signal"
          }
        },
        serialize: {
          kind: "value",
          signal: {
            arg: 0,
            key: "signal"
          }
        },
        dataSource: {
          kind: "lease",
          wrapper: "lease",
          result: {
            contract: "common.view/tree-data-source",
            major: 1
          },
          signal: {
            arg: 0,
            key: "signal"
          }
        }
      }
    }
  }
};
var contract_jsonc_syntax_default = {
  schemaVersion: 1,
  contract: {
    id: "org.modkitx/contract-definition",
    major: 1
  },
  id: "org.modkitx/jsonc-syntax-contract",
  displayName: "JSONC syntax service contract",
  spec: {
    schemaVersion: 1,
    kind: "service",
    contract: "common.text-data/jsonc-syntax",
    major: 1,
    offerFacet: {
      presence: "forbidden"
    },
    requestFacet: {
      presence: "forbidden"
    },
    matching: {
      profile: "org.modkitx/facetless-matcher",
      major: 1
    },
    conformanceProfile: "common.text-data/jsonc-syntax-v1",
    surface: {
      fields: ["contract"],
      methods: {
        parse: {
          kind: "value",
          signal: {
            arg: 0,
            key: "signal"
          }
        },
        serialize: {
          kind: "value",
          signal: {
            arg: 0,
            key: "signal"
          }
        },
        dataSource: {
          kind: "lease",
          wrapper: "lease",
          result: {
            contract: "common.view/tree-data-source",
            major: 1
          },
          signal: {
            arg: 0,
            key: "signal"
          }
        }
      }
    }
  }
};
var provider_json_default_default = {
  schemaVersion: 1,
  contract: {
    id: "org.modkitx/service-provider-contribution",
    major: 1
  },
  id: "org.modkitx/json-syntax-default",
  displayName: "json syntax provider",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./json/families/json/entrypoints/json-provider.js",
      target: {
        environments: ["node"]
      },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: []
    },
    {
      variantId: "portable",
      entrypoint: "./json/families/json/entrypoints/json-provider.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: []
    }
  ],
  spec: {
    provides: [
      {
        offerId: "json-syntax-default-v1",
        contract: "common.text-data/json-syntax",
        major: 1,
        version: "1.0.0"
      }
    ],
    lifecycleScope: "session",
    outputs: [
      {
        id: "structure.hierarchy",
        representation: "runtime",
        presence: "will-expose"
      }
    ]
  }
};
var provider_jsonc_default_default = {
  schemaVersion: 1,
  contract: {
    id: "org.modkitx/service-provider-contribution",
    major: 1
  },
  id: "org.modkitx/jsonc-syntax-default",
  displayName: "jsonc syntax provider",
  runtimeVariants: [
    {
      variantId: "trusted-node",
      entrypoint: "./json/families/json/entrypoints/jsonc-provider.js",
      target: {
        environments: ["node"]
      },
      executionProfile: "trusted-in-process",
      requestedPermissionClasses: []
    },
    {
      variantId: "portable",
      entrypoint: "./json/families/json/entrypoints/jsonc-provider.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: []
    }
  ],
  spec: {
    provides: [
      {
        offerId: "jsonc-syntax-default-v1",
        contract: "common.text-data/jsonc-syntax",
        major: 1,
        version: "1.0.0"
      }
    ],
    lifecycleScope: "session",
    outputs: [
      {
        id: "structure.hierarchy",
        representation: "runtime",
        presence: "will-expose"
      }
    ]
  }
};
var writer_json_default = {
  schemaVersion: 1,
  contract: {
    id: "org.modkitx/service-provider-contribution",
    major: 1
  },
  id: "org.modkitx/text-json-writer",
  displayName: "JSON and JSONC text writer",
  runtimeVariants: [
    {
      variantId: "portable",
      entrypoint: "./json/editing/text-writer.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: []
    }
  ],
  spec: {
    lifecycleScope: "session",
    provides: [
      {
        offerId: "json-source",
        contract: "common.edit/writer",
        major: 1,
        version: "1.0.0",
        facet: {
          providerId: "org.modkitx/text-json-writer",
          fidelityEvidenceId: "text-json-text-writer-v1",
          formatId: "json",
          representationId: "source",
          mutationMode: "mutate",
          minimumRoundTrip: "byte-identical"
        }
      },
      {
        offerId: "jsonc-source",
        contract: "common.edit/writer",
        major: 1,
        version: "1.0.0",
        facet: {
          providerId: "org.modkitx/text-json-writer",
          fidelityEvidenceId: "text-json-text-writer-v1",
          formatId: "jsonc",
          representationId: "source",
          mutationMode: "mutate",
          minimumRoundTrip: "byte-identical"
        }
      }
    ]
  }
};
var writer_plain_text_default = {
  schemaVersion: 1,
  contract: {
    id: "org.modkitx/service-provider-contribution",
    major: 1
  },
  id: "org.modkitx/plain-text-writer",
  displayName: "Plain text writer",
  runtimeVariants: [
    {
      variantId: "portable",
      entrypoint: "./plain/editing/text-writer.js",
      target: {
        environments: ["browser-worker", "node-worker"]
      },
      executionProfile: "worker-brokered",
      requestedPermissionClasses: []
    }
  ],
  spec: {
    lifecycleScope: "session",
    provides: [
      {
        offerId: "plain-text-source",
        contract: "common.edit/writer",
        major: 1,
        version: "1.0.0",
        facet: {
          providerId: "org.modkitx/plain-text-writer",
          fidelityEvidenceId: "plain-text-writer-v1",
          formatId: "txt",
          representationId: "source",
          mutationMode: "mutate",
          minimumRoundTrip: "byte-identical"
        }
      }
    ]
  }
};
var json_codec_exports = {};
__export(json_codec_exports, {
  abiVersion: () => abiVersion,
  createCodec: () => createCodec
});
function lease(value) {
  let released = false;
  return Object.freeze({
    value,
    async release() {
      released = true;
    },
    isReleased: () => released
  });
}
function pageStart(cursor3) {
  if (cursor3 === void 0) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(cursor3)) throw new TypeError("invalid page cursor");
  const value = Number(cursor3);
  if (!Number.isSafeInteger(value)) throw new TypeError("page cursor exceeds safe integer range");
  return value;
}
function createTreeDataSource(rootNode) {
  const nodes = /* @__PURE__ */ new Map();
  const register = (node, id) => {
    const children = Array.isArray(node.children) ? node.children : [];
    nodes.set(id, { node, childIds: children.map((_, index) => `${id}/${index}`) });
    children.forEach((child, index) => register(child, `${id}/${index}`));
  };
  register(rootNode, "root");
  const ref = (id) => {
    const item = nodes.get(id);
    return Object.freeze({ id, hasChildren: (item?.childIds.length ?? 0) > 0 });
  };
  return Object.freeze({
    async root() {
      return ref("root");
    },
    async children(node, page, signal) {
      if (signal?.aborted) throw new DOMException("operation cancelled", "AbortError");
      if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
        throw new TypeError("tree page limit must be a positive safe integer");
      }
      const start = pageStart(page.cursor);
      const childIds = nodes.get(node.id)?.childIds ?? [];
      const items = childIds.slice(start, start + page.limit).map(ref);
      return Object.freeze({
        items: Object.freeze(items),
        ...start + items.length < childIds.length ? { nextCursor: String(start + items.length) } : {}
      });
    },
    async facts(node) {
      const value = nodes.get(node.id)?.node;
      if (value === void 0) throw new TypeError(`unknown tree node ${node.id}`);
      return Object.freeze({
        kind: value.kind,
        label: value.label,
        ...value.preview === void 0 ? {} : { preview: value.preview }
      });
    },
    async *search(query) {
      for (const [id, item] of nodes) {
        const label = item.node.label ?? "";
        const preview2 = item.node.preview ?? "";
        if (label.includes(query.pattern) || preview2.includes(query.pattern)) yield ref(id);
      }
    }
  });
}
function newlineOf(text) {
  const crlf = (text.match(/\r\n/gu) ?? []).length;
  const withoutCrLf = text.replace(/\r\n/gu, "");
  const lf = (withoutCrLf.match(/\n/gu) ?? []).length;
  const cr = (withoutCrLf.match(/\r/gu) ?? []).length;
  if ([crlf, lf, cr].filter((count) => count > 0).length > 1) return "mixed";
  if (crlf > 0) return "crlf";
  if (lf > 0) return "lf";
  if (cr > 0) return "cr";
  return "none";
}
function defineWriter({
  providerId,
  providerVersion = "1.0.0",
  artifactDigest,
  offerId,
  formatId,
  representationId,
  mutationMode = "mutate",
  minimumRoundTrip,
  fidelityEvidenceId,
  fidelity,
  validate,
  planEdits
}) {
  const identity = Object.freeze({
    providerId,
    providerVersion,
    artifactDigest,
    formatId,
    representationId
  });
  const offer = Object.freeze({
    providerId,
    fidelityEvidenceId,
    formatId,
    representationId,
    mutationMode,
    minimumRoundTrip
  });
  const writer = Object.freeze({
    identity,
    offer,
    async validate(change, signal) {
      return validate(change, signal);
    },
    async plan(change, signal) {
      const edits = await planEdits(change, signal);
      return Object.freeze({
        planId: `${providerId}:${change.targets.map((target) => target.targetId).join("+")}`,
        targets: change.targets,
        edits,
        semantics: Object.freeze({ mutationMode, minimumGuarantee: "atomic" }),
        fidelity,
        diagnostics: Object.freeze([])
      });
    }
  });
  return Object.freeze({
    abiVersion: 1,
    provides: Object.freeze(["common.edit/writer"]),
    async createProvider(selection) {
      if (selection.offerId !== offerId)
        throw new TypeError(`unknown writer offer ${selection.offerId}`);
      return lease(writer);
    }
  });
}
function decodeInput(input) {
  if (typeof input.text === "string") {
    return {
      text: input.text,
      bytes: new TextEncoder().encode(input.text),
      source: { encoding: "utf-8", bom: false, newline: newlineOf(input.text) }
    };
  }
  const bytes = input.bytes;
  let encoding = input.encoding;
  let bom = false;
  let offset = 0;
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    encoding = encoding ?? "utf-8";
    bom = true;
    offset = 3;
  } else if (bytes[0] === 255 && bytes[1] === 254) {
    encoding = encoding ?? "utf-16le";
    bom = true;
    offset = 2;
  } else if (bytes[0] === 254 && bytes[1] === 255) {
    encoding = encoding ?? "utf-16be";
    bom = true;
    offset = 2;
  }
  encoding ??= "utf-8";
  const content = bytes.subarray(offset);
  let text;
  if (encoding === "utf-16be") {
    const swapped = new Uint8Array(content.length);
    for (let index = 0; index + 1 < content.length; index += 2) {
      swapped[index] = content[index + 1];
      swapped[index + 1] = content[index];
    }
    text = new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
  } else {
    text = new TextDecoder(encoding, { fatal: true }).decode(content);
  }
  return { text, bytes, source: { encoding, bom, newline: newlineOf(text) } };
}
function span(text, offset = 0, length = text.length) {
  const prefix = text.slice(0, offset);
  const lastLf = prefix.lastIndexOf("\n");
  return Object.freeze({
    byteOffset: uint64(BigInt(new TextEncoder().encode(prefix).byteLength)),
    byteLength: uint64(
      BigInt(new TextEncoder().encode(text.slice(offset, offset + length)).byteLength)
    ),
    utf16Offset: offset,
    utf16Length: length,
    line: (prefix.match(/\n/gu) ?? []).length,
    column: offset - (lastLf === -1 ? 0 : lastLf + 1)
  });
}
function failure(code, message, text = "", offset = 0, length = 0) {
  return {
    state: "failed",
    diagnostics: [
      diagnostic("error", code, message, void 0, void 0, span(text, offset, length))
    ]
  };
}
function preflight(decoded2, budget, signal) {
  throwIfAborted(signal);
  if (BigInt(decoded2.bytes.byteLength) > budget.maxInputBytes) {
    return failure(
      "org.modkitx/text-data-input-budget",
      "input exceeds maxInputBytes",
      decoded2.text
    );
  }
  if (decoded2.text.includes("\0")) {
    return failure("org.modkitx/text-data-nul", "NUL is forbidden in text input", decoded2.text);
  }
  return void 0;
}
function encodeText(text, source, target = {}) {
  const facts = { ...source, ...target };
  const newline = facts.newline === "none" ? source.newline : facts.newline;
  const separator = newline === "crlf" ? "\r\n" : newline === "cr" ? "\r" : "\n";
  const normalized = newline === "mixed" || newline === "none" ? text : text.replace(/\r\n|\r|\n/gu, separator);
  let bytes;
  if (facts.encoding === "utf-8") bytes = new TextEncoder().encode(normalized);
  else {
    const little = new Uint8Array(normalized.length * 2);
    const view = new DataView(little.buffer);
    for (let index = 0; index < normalized.length; index += 1) {
      view.setUint16(index * 2, normalized.charCodeAt(index), facts.encoding === "utf-16le");
    }
    bytes = little;
  }
  if (facts.bom) {
    const marker = facts.encoding === "utf-8" ? new Uint8Array([239, 187, 191]) : facts.encoding === "utf-16le" ? new Uint8Array([255, 254]) : new Uint8Array([254, 255]);
    const joined = new Uint8Array(marker.length + bytes.length);
    joined.set(marker);
    joined.set(bytes, marker.length);
    bytes = joined;
  }
  return {
    bytes,
    encoding: facts.encoding,
    bom: facts.bom,
    newline: facts.newline,
    diagnostics: []
  };
}
function scalar(value, raw = JSON.stringify(value)) {
  if (value === null) return { kind: "null", raw: "null" };
  if (typeof value === "boolean") return { kind: "boolean", value, raw: String(value) };
  if (typeof value === "string") return { kind: "string", value, raw: raw ?? JSON.stringify(value) };
  if (typeof value === "bigint")
    return { kind: "integer", decimal: String(value), raw: String(value) };
  if (typeof value === "number" && Number.isInteger(value)) {
    return { kind: "integer", decimal: String(value), raw: raw ?? String(value) };
  }
  if (typeof value === "number")
    return { kind: "number", raw: raw ?? String(value), finiteValue: value };
  return { kind: "string", value: String(value), raw: raw ?? String(value) };
}
function treeDataSource(document) {
  const nodes = /* @__PURE__ */ new Map([["root", { value: document, children: [] }]]);
  const entries = document.root?.kind === "object" ? document.root.members.map((member) => [member.key, member.value]) : Object.entries(document);
  nodes.get("root").children = entries.map(([key2, value], index) => {
    const id = `root/${index}`;
    nodes.set(id, { value, label: String(key2), children: [] });
    return { id, hasChildren: false };
  });
  return Object.freeze({
    async root() {
      return { id: "root", hasChildren: true };
    },
    async children(node, page) {
      const all = nodes.get(node.id)?.children ?? [];
      const start = page.cursor ? Number(page.cursor) : 0;
      const items = all.slice(start, start + page.limit);
      return {
        items,
        ...start + items.length < all.length ? { nextCursor: String(start + items.length) } : {}
      };
    },
    async facts(node) {
      const item = nodes.get(node.id);
      return { kind: item?.value?.kind ?? "value", label: item?.label ?? "root" };
    },
    async *search(query) {
      for (const [id, item] of nodes) {
        if ((item.label ?? "").includes(query.pattern)) yield { id, hasChildren: false };
      }
    }
  });
}
function createTextSyntaxProvider(definition) {
  const provider = Object.freeze({
    contract: definition.contract,
    async parse(request) {
      throwIfAborted(request.signal);
      let decoded2;
      try {
        decoded2 = decodeInput(request.input);
      } catch (cause) {
        return failure(
          "org.modkitx/text-data-decode",
          cause instanceof Error ? cause.message : String(cause)
        );
      }
      const rejected2 = preflight(decoded2, request.budget, request.signal);
      return rejected2 ?? definition.parse(decoded2, request);
    },
    async serialize(request) {
      throwIfAborted(request.signal);
      const result = await definition.serialize(request);
      if (BigInt(result.bytes.byteLength) <= request.budget.maxInputBytes) return result;
      return {
        ...result,
        bytes: new Uint8Array(),
        diagnostics: [
          diagnostic(
            "error",
            "org.modkitx/text-data-output-budget",
            "serialized output exceeds maxInputBytes"
          )
        ]
      };
    },
    async dataSource(request) {
      const parsed = await provider.parse(request);
      if (parsed.state === "failed")
        throw new TypeError(parsed.diagnostics[0]?.message ?? "parse failed");
      return lease(treeDataSource(parsed.document));
    }
  });
  return provider;
}
function createSelectedProvider(definition, selection, factory = createTextSyntaxProvider) {
  if (selection?.contract !== definition.contract) {
    throw new TypeError(`provider does not implement ${String(selection?.contract)}`);
  }
  return factory(definition);
}
var OPERATIONS = Object.freeze([
  {
    id: "view.inspect",
    handlerId: "inspect",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "asset.validate",
    handlerId: "validate",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["none"]
  },
  {
    id: "asset.search",
    handlerId: "search",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "export.raw",
    handlerId: "export-raw",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["bytes"]
  },
  {
    id: "data.parse",
    handlerId: "parse",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "data.serialize",
    handlerId: "serialize",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["bytes"]
  }
]);
function createTextCodec(definition, context) {
  return Object.freeze({
    async probe(request, signal) {
      if (request.source.kind !== "bytes" || request.plan.kind !== "bytes")
        throw new TypeError("text codecs require byte probes");
      const declared = Math.min(
        request.plan.maxBytes,
        request.plan.ranges[0]?.length ?? request.plan.maxBytes
      );
      const available = request.source.size === void 0 ? declared : Number(request.source.size);
      const bytes = await request.source.read(
        0n,
        Math.max(0, Math.min(declared, available)),
        signal
      );
      let text = "";
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return {
          codecId: `org.modkitx/text-${definition.format}`,
          confidence: 0.01,
          evidence: [{ kind: "structure", weight: -1, note: "invalid-utf8" }],
          requiredRanges: [{ byteOffset: "0", byteLength: String(bytes.byteLength) }]
        };
      }
      const result = definition.detect(text, request.source.ref.uri);
      return {
        codecId: `org.modkitx/text-${definition.format}`,
        confidence: result.confidence,
        evidence: [{ kind: "structure", weight: result.confidence, note: result.note }],
        requiredRanges: [{ byteOffset: "0", byteLength: String(bytes.byteLength) }]
      };
    },
    async planInput() {
      return {
        originKind: "single",
        candidate: { bindingId: "content", role: "content", ownership: "owned" },
        requirements: []
      };
    },
    async open(input, _intent, budget, signal) {
      if (input.originKind !== "single") throw new TypeError("text codec requires a single source");
      const binding = input.bindings[0];
      const sourceLease = await input.openBinding(binding.bindingId, signal);
      const source = sourceLease.value;
      if (source.kind !== "bytes" || source.size === void 0 || source.size > budget.maxInputBytes) {
        await sourceLease.release();
        throw new RangeError("text codec requires a sized source inside budget");
      }
      const bytes = await source.read(0n, Number(source.size), signal);
      const providerLease = await context.contracts.resolve({
        contract: definition.contract,
        major: 1,
        signal
      });
      const provider = providerLease.value;
      const parsed = await provider.parse({
        input: { bytes },
        dialect: definition.dialect,
        budget,
        signal
      });
      if (parsed.state === "failed") {
        await providerLease.release();
        await sourceLease.release();
        throw new TypeError(parsed.diagnostics[0]?.message ?? "parse failed");
      }
      const dataLease = await provider.dataSource({
        input: { bytes },
        dialect: definition.dialect,
        budget,
        signal
      });
      const byteSource = {
        size: async () => source.size,
        read: (offset, length, readSignal) => source.read(offset, length, readSignal)
      };
      const textSource = createUtf8TextDataSource(byteSource);
      const textInfo = await textSource.info();
      const descriptor = await assembleSubjectDescriptor({
        schemaVersion: 2,
        subjectUri: binding.source.uri,
        origin: {
          kind: "single",
          binding: {
            id: binding.bindingId,
            role: binding.role,
            source: binding.source,
            required: true,
            ownership: binding.ownership,
            revision: binding.revision
          }
        },
        interpretation: "codec",
        identity: {
          codecId: `org.modkitx/text-${definition.format}`,
          codecVersion: "1.0.0",
          formatId: definition.format,
          formatLabel: definition.format.toUpperCase(),
          mediaType: definition.mediaType,
          confidence: 1,
          detection: [{ kind: "structure", weight: 1 }]
        },
        traits: [
          {
            id: "structure.hierarchy",
            descriptorVersion: 1,
            state: "available",
            parameters: { nodeCount: "unknown", lazy: true, hasLocations: true }
          },
          {
            id: "content.text",
            descriptorVersion: 1,
            state: "available",
            parameters: {
              encoding: textInfo.encoding,
              lineCount: textInfo.lines,
              bom: textInfo.bom,
              newline: textInfo.newline
            }
          },
          {
            id: "content.binary",
            descriptorVersion: 1,
            state: "available",
            parameters: { bytes: source.size.toString(10) }
          }
        ],
        operations: OPERATIONS.map((operation) => ({
          id: operation.id,
          handlerId: operation.handlerId,
          mutatesSource: false,
          state: "available"
        })),
        constraints: {
          readOnly: true,
          seekable: true,
          randomAccess: true,
          trusted: false,
          maxDecodedBytes: source.size.toString(10)
        },
        dataSources: [
          { contract: "common.view/tree-data-source", major: 1 },
          { contract: "common.view/text-data-source", major: 1 },
          { contract: "common.view/byte-range-source", major: 1 }
        ],
        diagnostics: [],
        metadata: [],
        revision: input.revisions.revision
      });
      const handlers = /* @__PURE__ */ new Map([
        [
          "inspect",
          async () => ({
            kind: "json",
            value: { format: definition.format, parseState: parsed.state }
          })
        ],
        ["validate", async () => ({ kind: "none" })],
        ["search", async () => ({ kind: "json", value: [] })],
        ["export-raw", async () => ({ kind: "bytes", value: bytes })],
        ["parse", async () => ({ kind: "json", value: { state: parsed.state } })],
        [
          "serialize",
          async () => ({
            kind: "bytes",
            value: (await provider.serialize({
              document: parsed.document,
              dialect: definition.dialect,
              budget,
              signal
            })).bytes
          })
        ]
      ]);
      return createAssetSession({
        revision: revisionId(input.revisions.revision),
        descriptor,
        operationDeclarations: OPERATIONS,
        permissionGrant: { id: `text-${definition.format}-session`, classes: ["read-source"] },
        handlers,
        async openDataSource(contract) {
          if (contract === "common.view/tree-data-source") return lease(dataLease.value);
          if (contract === "common.view/text-data-source") return lease(textSource);
          if (contract === "common.view/byte-range-source") return lease(byteSource);
          throw new TypeError(`text-${definition.format} does not publish ${contract}`);
        },
        release: [
          () => dataLease.release(),
          () => providerLease.release(),
          () => sourceLease.release()
        ]
      }).session;
    }
  });
}
function markerOutsideString(text, marker) {
  let quote = false;
  let escaped = false;
  for (let index = 0; index <= text.length - marker.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') quote = true;
    else if (text.startsWith(marker, index)) return true;
  }
  return false;
}
function detectJson(dialect, text, uri) {
  if (text.includes("\0")) return { confidence: 0.01, note: "nul-byte" };
  const trimmed = text.trimStart();
  const structure = trimmed.startsWith("{") || trimmed.startsWith("[");
  const comment = markerOutsideString(text, "//") || markerOutsideString(text, "/*");
  if (!structure) return { confidence: 0.05, note: "no-json-root" };
  if (dialect === "jsonc" && comment) return { confidence: 0.98, note: "jsonc-marker" };
  if (dialect === "json" && comment) return { confidence: 0.1, note: "jsonc-marker" };
  const extension = uri.split(/[?#]/u, 1)[0]?.split(".").at(-1)?.toLowerCase();
  return {
    confidence: extension === dialect ? 0.78 : 0.72,
    note: "json-jsonc-ambiguous"
  };
}
function createJsonCodec(profile3, context) {
  return createTextCodec(
    {
      ...profile3,
      detect: (text, uri) => detectJson(profile3.dialect, text, uri)
    },
    context
  );
}
var profile = Object.freeze({
  format: "json",
  extensions: Object.freeze(["json"]),
  mediaType: "application/json",
  contract: "common.text-data/json-syntax",
  dialect: "json",
  semantic: "tree",
  implementationTier: 1
});
var abiVersion = 1;
var createCodec = (context) => createJsonCodec(profile, context);
var json_provider_exports = {};
__export(json_provider_exports, {
  abiVersion: () => abiVersion2,
  createProvider: () => createProvider,
  createTextSyntaxProvider: () => createTextSyntaxProvider2,
  provides: () => provides
});
function jsonNode(node, text, counters, depth = 0) {
  counters.nodes += 1;
  counters.depth = Math.max(counters.depth, depth);
  const range = span(text, node.offset, node.length);
  if (node.type === "object") {
    return {
      kind: "object",
      members: (node.children ?? []).map((property) => ({
        key: String(property.children?.[0]?.value ?? ""),
        keyRange: span(
          text,
          property.children?.[0]?.offset ?? property.offset,
          property.children?.[0]?.length ?? 0
        ),
        value: jsonNode(property.children?.[1], text, counters, depth + 1)
      })),
      range
    };
  }
  if (node.type === "array") {
    return {
      kind: "array",
      items: (node.children ?? []).map((item) => jsonNode(item, text, counters, depth + 1)),
      range
    };
  }
  return {
    kind: "scalar",
    value: scalar(node.value, text.slice(node.offset, node.offset + node.length)),
    range
  };
}
function parseJson(decoded2, dialect, budget) {
  const errors = [];
  const root = parseTree2(decoded2.text, errors, {
    allowTrailingComma: dialect === "jsonc",
    disallowComments: dialect === "json"
  });
  if (!root || errors.length > 0) {
    const first = errors[0] ?? { error: 0, offset: 0, length: 0 };
    return failure(
      "org.modkitx/text-data-json-parse",
      printParseErrorCode(first.error),
      decoded2.text,
      first.offset,
      first.length
    );
  }
  const counters = { nodes: 0, depth: 0 };
  const converted = jsonNode(root, decoded2.text, counters);
  if (counters.nodes > budget.maxNodes || counters.depth > budget.maxDepth) {
    return {
      state: "truncated",
      document: { dialect, root: converted, trivia: [], source: decoded2.source },
      truncated: { limit: counters.nodes > budget.maxNodes ? "maxNodes" : "maxDepth" },
      diagnostics: []
    };
  }
  return {
    state: "ok",
    document: { dialect, root: converted, trivia: [], source: decoded2.source },
    diagnostics: []
  };
}
function valueFromJsonNode(node) {
  if (node.kind === "scalar") {
    if (node.value.kind === "null") return null;
    if ("value" in node.value) return node.value.value;
    if (node.value.kind === "integer") return Number(node.value.decimal);
    return Number(node.value.raw);
  }
  if (node.kind === "array") return node.items.map(valueFromJsonNode);
  return Object.fromEntries(
    node.members.map((member) => [member.key, valueFromJsonNode(member.value)])
  );
}
function createJsonSyntaxProvider(definition) {
  return createTextSyntaxProvider({
    contract: definition.contract,
    parse: (decoded2, request) => parseJson(decoded2, definition.dialect, request.budget),
    serialize(request) {
      const text = `${JSON.stringify(valueFromJsonNode(request.document.root), null, 2)}
`;
      return encodeText(text, request.document.source, request.target);
    }
  });
}
var abiVersion2 = 1;
var provides = Object.freeze([profile.contract]);
var createTextSyntaxProvider2 = () => createJsonSyntaxProvider(profile);
var createProvider = (selection) => lease(createSelectedProvider(profile, selection, createJsonSyntaxProvider));
var jsonc_codec_exports = {};
__export(jsonc_codec_exports, {
  abiVersion: () => abiVersion3,
  createCodec: () => createCodec2
});
var profile2 = Object.freeze({
  format: "jsonc",
  extensions: Object.freeze(["jsonc"]),
  mediaType: "application/jsonc",
  contract: "common.text-data/jsonc-syntax",
  dialect: "jsonc",
  semantic: "tree",
  implementationTier: 1
});
var abiVersion3 = 1;
var createCodec2 = (context) => createJsonCodec(profile2, context);
var jsonc_provider_exports = {};
__export(jsonc_provider_exports, {
  abiVersion: () => abiVersion4,
  createProvider: () => createProvider2,
  createTextSyntaxProvider: () => createTextSyntaxProvider3,
  provides: () => provides2
});
var abiVersion4 = 1;
var provides2 = Object.freeze([profile2.contract]);
var createTextSyntaxProvider3 = () => createJsonSyntaxProvider(profile2);
var createProvider2 = (selection) => lease(createSelectedProvider(profile2, selection, createJsonSyntaxProvider));
var text_writer_exports = {};
__export(text_writer_exports, {
  abiVersion: () => abiVersion5,
  createProvider: () => createProvider3,
  provides: () => provides3
});
var PROVIDER_ID = "org.modkitx/text-json-writer";
var EVIDENCE_ID = "text-json-text-writer-v1";
var ARTIFACT_DIGEST = "x3:org.modkitx/text-json-writer@1.0.0";
var RANGE_KINDS = Object.freeze(["utf16", "bytes"]);
var PAYLOAD_KINDS = Object.freeze(["text", "inline"]);
var error = (code, message) => Object.freeze({ severity: "error", code, message });
function validateTextChange(change) {
  const diagnostics = [];
  if (change.targets.length === 0 || change.edits.length === 0) {
    diagnostics.push(
      error(
        "org.modkitx/text-writer-change-empty",
        "a change set must carry at least one target and one edit"
      )
    );
  }
  const targetIds = new Set(change.targets.map((target) => target.targetId));
  const sourceIds = new Set(change.targets.map((target) => target.ownerSource.id));
  for (const edit of change.edits) {
    if (edit.operation !== "replace") {
      diagnostics.push(
        error(
          "org.modkitx/text-writer-operation-unsupported",
          `a text writer rewrites its own source: \xAB${edit.operation}\xBB is not a text edit`
        )
      );
      continue;
    }
    if (!targetIds.has(edit.targetId) || !sourceIds.has(edit.source.id)) {
      diagnostics.push(
        error(
          "org.modkitx/text-writer-target-foreign",
          `edit target \xAB${edit.targetId}\xBB is not a target of this change set`
        )
      );
      continue;
    }
    if (edit.range !== void 0 && !RANGE_KINDS.includes(edit.range.kind)) {
      diagnostics.push(
        error(
          "org.modkitx/text-writer-range-unsupported",
          `\xAB${edit.range.kind}\xBB is not a text range (utf16 or bytes)`
        )
      );
      continue;
    }
    if (!PAYLOAD_KINDS.includes(edit.payload.kind)) {
      diagnostics.push(
        error(
          "org.modkitx/text-writer-payload-unsupported",
          `\xAB${edit.payload.kind}\xBB payloads are not readable inline (text or inline)`
        )
      );
    }
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}
async function planTextEdits(change) {
  const result = validateTextChange(change);
  if (!result.valid) {
    throw new TypeError(result.diagnostics.map((item) => item.message).join("; "));
  }
  return change.edits;
}
function jsonSyntaxDiagnostics(change) {
  for (const edit of change.edits) {
    if (edit.operation !== "replace" || edit.range !== void 0) continue;
    if (edit.payload.kind !== "text") continue;
    try {
      JSON.parse(edit.payload.text);
    } catch (cause) {
      return [
        error(
          "org.modkitx/text-writer-syntax-invalid",
          `the replacement is not valid JSON, and saving it would corrupt the file: ${cause instanceof Error ? cause.message : String(cause)}`
        )
      ];
    }
  }
  return [];
}
var textWriter = (formatId, syntaxDiagnostics) => defineWriter({
  providerId: PROVIDER_ID,
  providerVersion: "1.0.0",
  artifactDigest: ARTIFACT_DIGEST,
  offerId: `${formatId}-source`,
  formatId,
  representationId: "source",
  mutationMode: "mutate",
  minimumRoundTrip: "byte-identical",
  fidelityEvidenceId: EVIDENCE_ID,
  fidelity: Object.freeze({ roundTrip: "byte-identical", preservesUnknownData: true }),
  validate: async (change) => {
    const carried = validateTextChange(change);
    if (!carried.valid || syntaxDiagnostics === void 0) return carried;
    const syntax = syntaxDiagnostics(change);
    return syntax.length === 0 ? carried : Object.freeze({ valid: false, diagnostics: Object.freeze(syntax) });
  },
  planEdits: async (change) => {
    const syntax = syntaxDiagnostics === void 0 ? [] : syntaxDiagnostics(change);
    if (syntax.length > 0) {
      throw new TypeError(syntax.map((item) => item.message).join("; "));
    }
    return planTextEdits(change);
  }
});
var OFFERS = Object.freeze({
  "json-source": textWriter("json", jsonSyntaxDiagnostics),
  "jsonc-source": textWriter("jsonc")
});
var abiVersion5 = 1;
var provides3 = Object.freeze(["common.edit/writer"]);
async function createProvider3(selection) {
  const offered = OFFERS[selection.offerId];
  if (offered === void 0) throw new TypeError(`unknown writer offer ${selection.offerId}`);
  return offered.createProvider(selection);
}
var codec_exports = {};
__export(codec_exports, {
  abiVersion: () => abiVersion6,
  createCodec: () => createCodec3
});
var CODEC_ID = "org.modkitx/txt";
var TEXT_CONTROLS = /* @__PURE__ */ new Set([9, 10, 12, 13]);
var CONTROL_RATIO_LIMIT = 0.02;
var OPERATION_DECLARATIONS = Object.freeze([
  {
    id: "view.inspect",
    handlerId: "inspect",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "asset.validate",
    handlerId: "validate",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["none"]
  },
  {
    id: "asset.search",
    handlerId: "search",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["json"]
  },
  {
    id: "export.raw",
    handlerId: "export-raw",
    mutatesSource: false,
    requiredPermissions: ["read-source"],
    outputKinds: ["bytes"]
  }
]);
function extensionOf(uri) {
  const clean = uri.split(/[?#]/u, 1)[0] ?? "";
  const name = clean.slice(clean.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}
function decodeSample(bytes) {
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) {
    return decodeWith(bytes.subarray(3), "utf-8", true);
  }
  if (bytes[0] === 255 && bytes[1] === 254) return decodeWith(bytes.subarray(2), "utf-16le", true);
  if (bytes[0] === 254 && bytes[1] === 255) return decodeWith(bytes.subarray(2), "utf-16be", true);
  return decodeWith(bytes, "utf-8", false);
}
function decodeWith(content, encoding, bom) {
  if (encoding === "utf-8" && content.includes(0)) {
    return { ok: false, encoding, bom, reason: "nul-byte" };
  }
  let text;
  try {
    if (encoding === "utf-16be") {
      const swapped = new Uint8Array(content.length - content.length % 2);
      for (let index = 0; index + 1 < swapped.length; index += 2) {
        swapped[index] = content[index + 1];
        swapped[index + 1] = content[index];
      }
      text = new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
    } else if (encoding === "utf-16le") {
      text = new TextDecoder("utf-16le", { fatal: true }).decode(
        content.subarray(0, content.length - content.length % 2)
      );
    } else {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    }
  } catch {
    return { ok: false, encoding, bom, reason: "undecodable" };
  }
  if (text.includes("\0")) return { ok: false, encoding, bom, reason: "nul-byte" };
  let controls = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code < 32 && !TEXT_CONTROLS.has(code)) controls += 1;
  }
  const ratio = text.length === 0 ? 0 : controls / text.length;
  if (ratio > CONTROL_RATIO_LIMIT) return { ok: false, encoding, bom, reason: "control-ratio" };
  return { ok: true, encoding, bom, text, reason: "bounded-text" };
}
function outline(text, maxNodes) {
  const lines = text.split(/\r\n|\n|\r/u);
  const paragraphs = [];
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    paragraphs.push(current.join("\n"));
    current = [];
    if (paragraphs.length > maxNodes) throw new RangeError("text paragraphs exceed maxNodes budget");
  };
  for (const line of lines) {
    if (line.trim() === "") flush();
    else current.push(line);
  }
  flush();
  const trimmed = text.trim();
  return {
    lines: lines.length,
    words: trimmed === "" ? 0 : trimmed.split(/\s+/u).length,
    characters: text.length,
    paragraphs
  };
}
function preview(value) {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}
function treeFor(shape) {
  return {
    kind: "document",
    label: "Plain text",
    preview: `${shape.lines} line(s), ${shape.words} word(s)`,
    children: shape.paragraphs.map((value, index) => ({
      kind: "paragraph",
      label: `Paragraph ${index + 1}`,
      preview: preview(value)
    }))
  };
}
var abiVersion6 = 1;
var createCodec3 = () => Object.freeze({
  async probe(request, signal) {
    if (request.source.kind !== "bytes" || request.plan.kind !== "bytes") {
      throw new TypeError("plain text accepts only byte candidates and byte probe plans");
    }
    const declared = Math.min(
      request.plan.maxBytes,
      request.plan.ranges[0]?.length ?? request.plan.maxBytes
    );
    const available = request.source.size === void 0 ? declared : Number(request.source.size);
    const length = Math.max(0, Math.min(declared, available));
    const bytes = await request.source.read(0n, length, signal);
    const uri = request.source.ref.uri;
    const required = [{ byteOffset: "0", byteLength: String(bytes.byteLength) }];
    const decoded2 = decodeSample(bytes);
    if (!decoded2.ok) {
      return {
        codecId: CODEC_ID,
        confidence: 0.02,
        evidence: [{ kind: "structure", weight: -1, note: decoded2.reason }],
        requiredRanges: required
      };
    }
    const known = extensionOf(uri) === "txt";
    return {
      codecId: CODEC_ID,
      confidence: known ? 0.9 : 0.6,
      evidence: [
        {
          kind: "structure",
          weight: 0.6,
          note: `${decoded2.encoding}${decoded2.bom ? "-bom" : ""}`
        },
        ...known ? [{ kind: "extension", weight: 0.3, note: "txt" }] : []
      ],
      requiredRanges: required
    };
  },
  async planInput(source) {
    if (source.kind === "derived") throw new TypeError("plain text requires a byte candidate");
    return {
      originKind: "single",
      candidate: { bindingId: "content", role: "content", ownership: "owned" },
      requirements: []
    };
  },
  async open(input, _intent, budget, signal) {
    if (input.originKind !== "single") throw new TypeError("plain text requires a single source");
    const binding = input.bindings[0];
    const sourceLease = await input.openBinding(binding.bindingId, signal);
    const source = sourceLease.value;
    if (source.kind !== "bytes" || source.size === void 0) {
      await sourceLease.release();
      throw new TypeError("plain text requires a sized byte source");
    }
    if (source.size > budget.maxInputBytes) {
      await sourceLease.release();
      throw new RangeError("plain text input exceeds the session budget");
    }
    const raw = await source.read(0n, Number(source.size), signal);
    const decoded2 = decodeSample(raw);
    if (!decoded2.ok) {
      await sourceLease.release();
      throw new TypeError(`plain text rejected a binary source (${decoded2.reason})`);
    }
    if (decoded2.text.length * 2 > budget.maxScalarBytes) {
      await sourceLease.release();
      throw new RangeError("decoded text exceeds the maxScalarBytes budget");
    }
    const shape = outline(decoded2.text, budget.maxNodes);
    const bytes = Object.freeze({
      size: async () => source.size,
      read: (offset, length, readSignal) => source.read(offset, length, readSignal)
    });
    const tree = createTreeDataSource(treeFor(shape));
    const utf8 = decoded2.encoding === "utf-8";
    const text = utf8 ? createUtf8TextDataSource(bytes) : void 0;
    const dataSources = [
      { contract: "common.view/tree-data-source", major: 1 },
      ...utf8 ? [{ contract: "common.view/text-data-source", major: 1 }] : [],
      { contract: "common.view/byte-range-source", major: 1 }
    ];
    const summary = {
      format: "txt",
      encoding: decoded2.encoding,
      bom: decoded2.bom,
      newline: newlineOf(decoded2.text),
      characters: shape.characters,
      lines: shape.lines,
      words: shape.words,
      paragraphs: shape.paragraphs.length
    };
    const descriptor = await assembleSubjectDescriptor({
      schemaVersion: 2,
      subjectUri: binding.source.uri,
      origin: {
        kind: "single",
        binding: {
          id: binding.bindingId,
          role: binding.role,
          source: binding.source,
          required: true,
          ownership: binding.ownership,
          revision: binding.revision,
          mediaType: "text/plain"
        }
      },
      interpretation: "codec",
      identity: {
        codecId: CODEC_ID,
        codecVersion: "1.0.0",
        formatId: "txt",
        formatLabel: "Plain Text Document",
        mediaType: "text/plain",
        confidence: 1,
        detection: [{ kind: "structure", weight: 0.9, note: decoded2.encoding }]
      },
      traits: [
        {
          id: "document.flow",
          descriptorVersion: 1,
          state: "available",
          parameters: { paragraphs: shape.paragraphs.length, lines: shape.lines }
        },
        {
          id: "structure.hierarchy",
          descriptorVersion: 1,
          state: "available",
          parameters: { nodeCount: shape.paragraphs.length, lazy: true, hasLocations: false }
        },
        {
          id: "content.text",
          descriptorVersion: 1,
          state: "available",
          parameters: {
            encoding: decoded2.encoding,
            bom: decoded2.bom,
            newline: summary.newline,
            lineCount: shape.lines,
            characters: shape.characters
          }
        },
        {
          id: "content.binary",
          descriptorVersion: 1,
          state: "available",
          parameters: { bytes: source.size.toString(10) }
        }
      ],
      operations: OPERATION_DECLARATIONS.map((operation) => ({
        id: operation.id,
        handlerId: operation.handlerId,
        mutatesSource: false,
        state: "available"
      })),
      constraints: {
        readOnly: true,
        seekable: true,
        randomAccess: true,
        trusted: false,
        maxDecodedBytes: source.size.toString(10)
      },
      dataSources,
      diagnostics: [],
      metadata: [
        {
          id: "plain-text",
          label: "Plain text",
          entries: Object.entries(summary).map(([key2, value]) => ({ key: key2, value }))
        }
      ],
      revision: input.revisions.revision
    });
    const handlers = /* @__PURE__ */ new Map([
      ["inspect", async () => ({ kind: "json", value: summary })],
      ["validate", async () => ({ kind: "none" })],
      [
        "search",
        async (operationInput) => {
          const pattern = operationInput !== null && typeof operationInput === "object" && typeof operationInput.pattern === "string" ? operationInput.pattern : "";
          if (pattern === "") return { kind: "json", value: [] };
          const matches = [];
          let index = decoded2.text.indexOf(pattern);
          while (index !== -1 && matches.length < budget.maxDiagnostics) {
            matches.push({ utf16Offset: index, utf16Length: pattern.length });
            index = decoded2.text.indexOf(pattern, index + Math.max(1, pattern.length));
          }
          return { kind: "json", value: matches };
        }
      ],
      ["export-raw", async () => ({ kind: "bytes", value: raw })]
    ]);
    const managed = createAssetSession({
      revision: revisionId(input.revisions.revision),
      descriptor,
      operationDeclarations: OPERATION_DECLARATIONS,
      permissionGrant: { id: "plain-text-session", classes: ["read-source"] },
      handlers,
      async openDataSource(contract) {
        if (contract === "common.view/tree-data-source") return lease(tree);
        if (contract === "common.view/byte-range-source") return lease(bytes);
        if (contract === "common.view/text-data-source" && text !== void 0) {
          return lease(text);
        }
        throw new TypeError(`org.modkitx/txt does not publish ${contract}`);
      },
      release: [() => sourceLease.release()]
    });
    return managed.session;
  }
});
var text_writer_exports2 = {};
__export(text_writer_exports2, {
  abiVersion: () => abiVersion7,
  createProvider: () => createProvider4,
  provides: () => provides4
});
var PROVIDER_ID2 = "org.modkitx/plain-text-writer";
var RANGE_KINDS2 = Object.freeze(["utf16", "bytes"]);
var PAYLOAD_KINDS2 = Object.freeze(["text", "inline"]);
var error2 = (code, message) => Object.freeze({ severity: "error", code, message });
function validateTextChange2(change) {
  const diagnostics = [];
  if (change.targets.length === 0 || change.edits.length === 0) {
    diagnostics.push(
      error2(
        "org.modkitx/text-writer-change-empty",
        "a change set must carry at least one target and one edit"
      )
    );
  }
  const targetIds = new Set(change.targets.map((target) => target.targetId));
  const sourceIds = new Set(change.targets.map((target) => target.ownerSource.id));
  for (const edit of change.edits) {
    if (edit.operation !== "replace") {
      diagnostics.push(
        error2(
          "org.modkitx/text-writer-operation-unsupported",
          `a text writer rewrites its own source: \xAB${edit.operation}\xBB is not a text edit`
        )
      );
      continue;
    }
    if (!targetIds.has(edit.targetId) || !sourceIds.has(edit.source.id)) {
      diagnostics.push(
        error2(
          "org.modkitx/text-writer-target-foreign",
          `edit target \xAB${edit.targetId}\xBB is not a target of this change set`
        )
      );
      continue;
    }
    if (edit.range !== void 0 && !RANGE_KINDS2.includes(edit.range.kind)) {
      diagnostics.push(
        error2(
          "org.modkitx/text-writer-range-unsupported",
          `\xAB${edit.range.kind}\xBB is not a text range (utf16 or bytes)`
        )
      );
      continue;
    }
    if (!PAYLOAD_KINDS2.includes(edit.payload.kind)) {
      diagnostics.push(
        error2(
          "org.modkitx/text-writer-payload-unsupported",
          `\xAB${edit.payload.kind}\xBB payloads are not readable inline (text or inline)`
        )
      );
    }
  }
  return Object.freeze({ valid: diagnostics.length === 0, diagnostics: Object.freeze(diagnostics) });
}
var { abiVersion: abiVersion7, provides: provides4, createProvider: createProvider4 } = defineWriter({
  providerId: PROVIDER_ID2,
  providerVersion: "1.0.0",
  /** A module cannot see its own artifact digest; the host inventory carries the attested one. */
  artifactDigest: "x3:org.modkitx/plain-text-writer@1.0.0",
  offerId: "plain-text-source",
  formatId: "txt",
  representationId: "source",
  mutationMode: "mutate",
  minimumRoundTrip: "byte-identical",
  fidelityEvidenceId: "plain-text-writer-v1",
  fidelity: Object.freeze({ roundTrip: "byte-identical", preservesUnknownData: true }),
  validate: async (change) => validateTextChange2(change),
  /** Pass-through: the editor authored the edits; the writer only refuses what it cannot carry. */
  planEdits: async (change) => {
    const result = validateTextChange2(change);
    if (!result.valid) throw new TypeError(result.diagnostics.map((item) => item.message).join("; "));
    return change.edits;
  }
});
var variantsOf = (manifest) => {
  const list = manifest.runtimeVariants;
  return Array.isArray(list) ? list : [];
};
var refuse2 = (message, context) => {
  throw new ModkitError({ code: "x3.host/linked-extension-invalid", message, context });
};
function defineLinkedExtension(init) {
  const modkit = init.packageJson.modkit;
  const publisher = typeof modkit?.publisher === "string" ? modkit.publisher : void 0;
  const id = typeof modkit?.id === "string" ? modkit.id : void 0;
  if (publisher === void 0 || id === void 0) {
    refuse2("linked extension package.json carries no modkit publisher/id", {
      source: init.source
    });
  }
  const coordinate2 = `${publisher}/${id}`;
  const automaticExcluded = [];
  const contributions = init.contributions.flatMap((contribution) => {
    const variants = variantsOf(contribution.manifest);
    if (variants.length === 0) return [contribution];
    const trusted = variants.filter((variant) => variant.executionProfile === "trusted-in-process");
    if (trusted.length === 0) {
      const manifestId = contribution.manifest.id;
      automaticExcluded.push({
        path: contribution.path,
        reason: `${typeof manifestId === "string" ? manifestId : contribution.path} declares no trusted-in-process variant, and linked code runs in-process by definition`
      });
      return [];
    }
    const manifest = contribution.manifest;
    return [{ ...contribution, manifest: { ...manifest, runtimeVariants: trusted } }];
  });
  const files = init.files ?? Object.freeze([
    "package.json",
    ...contributions.map((item) => item.path),
    ...Object.keys(init.modules).map((path) => path.replace(/^\.\//u, ""))
  ]);
  const artifactDigest = init.artifactDigest ?? `linked:${coordinate2}`;
  const artifactRoot = new URL(`modkit-linked://${publisher}.${id}/`.toLowerCase());
  const moduleEntries = [];
  for (const contribution of contributions) {
    for (const variant of variantsOf(contribution.manifest)) {
      if (variant.executionProfile !== "trusted-in-process") {
        refuse2("a linked contribution may declare only trusted-in-process variants", {
          source: init.source,
          path: contribution.path
        });
      }
      const entrypoint = typeof variant.entrypoint === "string" ? variant.entrypoint : "";
      const module = init.modules[entrypoint];
      if (module === void 0) {
        refuse2(`linked variant entrypoint \xAB${entrypoint}\xBB has no imported module`, {
          source: init.source,
          path: contribution.path
        });
        continue;
      }
      moduleEntries.push([resolveContainedEntrypoint(artifactRoot, entrypoint).href, module]);
    }
  }
  const input = Object.freeze({
    source: init.source,
    containers: Object.freeze({ packageJson: init.packageJson }),
    files: Object.freeze([...files]),
    documents: new Map(contributions.map((item) => [item.path, item.manifest])),
    documentDigests: new Map(
      contributions.map((item) => [item.path, item.digest ?? `linked:${coordinate2}:${item.path}`])
    ),
    artifact: Object.freeze({
      inventoryRecordId: `linked:${coordinate2}`,
      artifactDigest,
      artifactRoot,
      // the bytes cannot change under a linked artifact: they are the caller's own bundle
      verifyArtifactDigest: (expected) => expected === artifactDigest
    }),
    /*
     * `allowTrustedInProcess: true` is the point, not an oversight: linking is the artifact-level
     * trust decision (see the module header). The gate still refuses any variant that is not
     * declared `trusted-in-process`, and still emits its audit notice on every activation.
     */
    execution: Object.freeze({ origin: "bundled", allowTrustedInProcess: true })
  });
  return Object.freeze({
    coordinate: coordinate2,
    input,
    moduleEntries: Object.freeze(moduleEntries),
    excluded: Object.freeze([...automaticExcluded, ...init.excluded ?? []])
  });
}
var NATIVE_ENVIRONMENTS = Object.freeze(["node", "node-worker", "browser-main", "browser-worker"]);
var nativeExecutable = (manifest, entrypoint) => {
  const document = manifest;
  const variants = Array.isArray(document.runtimeVariants) ? document.runtimeVariants : [];
  if (variants.length === 0) return manifest;
  const selected = variants.find(
    (variant) => typeof variant === "object" && variant !== null && variant.executionProfile === "trusted-in-process"
  ) ?? variants[0];
  if (typeof selected !== "object" || selected === null) return manifest;
  return {
    ...document,
    runtimeVariants: [
      {
        ...selected,
        variantId: "core-native",
        ...entrypoint === void 0 ? {} : { entrypoint },
        executionProfile: "trusted-in-process",
        target: { environments: NATIVE_ENVIRONMENTS }
      }
    ]
  };
};
var nativeText = defineLinkedExtension({
  source: "native:core/text",
  packageJson: {
    name: "@modkitx-x3/core-native-text",
    version: "1.0.0",
    license: "MIT",
    modkit: {
      schemaVersion: 1,
      publisher: "org.modkitx",
      id: "core-native-text",
      contributionManifests: ["./contributions/*.json"]
    }
  },
  contributions: [
    { path: "contributions/codec-txt.json", manifest: nativeExecutable(codec_txt_default) },
    {
      path: "contributions/writer-plain-text.json",
      manifest: nativeExecutable(writer_plain_text_default)
    },
    { path: "contributions/codec-json.json", manifest: nativeExecutable(codec_json_default) },
    { path: "contributions/codec-jsonc.json", manifest: nativeExecutable(codec_jsonc_default) },
    { path: "contributions/contract-json-syntax.json", manifest: contract_json_syntax_default },
    { path: "contributions/contract-jsonc-syntax.json", manifest: contract_jsonc_syntax_default },
    { path: "contributions/provider-json-default.json", manifest: nativeExecutable(provider_json_default_default) },
    {
      path: "contributions/provider-jsonc-default.json",
      manifest: nativeExecutable(provider_jsonc_default_default)
    },
    {
      path: "contributions/writer-json.json",
      manifest: nativeExecutable(writer_json_default)
    }
  ],
  modules: {
    "./plain/txt/codec.js": codec_exports,
    "./plain/editing/text-writer.js": text_writer_exports2,
    "./json/editing/text-writer.js": text_writer_exports,
    "./json/families/json/entrypoints/json-codec.js": json_codec_exports,
    "./json/families/json/entrypoints/json-provider.js": json_provider_exports,
    "./json/families/json/entrypoints/jsonc-codec.js": jsonc_codec_exports,
    "./json/families/json/entrypoints/jsonc-provider.js": jsonc_provider_exports
  }
});
var NATIVE_TEXT_INPUT = nativeText.input;
var NATIVE_TEXT_MODULES = new Map(
  nativeText.moduleEntries
);

export {
  assembleSubjectDescriptor,
  createAssetSession,
  createUtf8TextDataSource
};
