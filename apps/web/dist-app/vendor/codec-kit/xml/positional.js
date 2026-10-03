import {
  getLogger
} from "../../../chunks/chunk-EJGE47SQ.js";
import "../../../chunks/chunk-CQ52GEHY.js";

// packages/codec-kit/dist/xml/positional/utils.js
function findFirst(array, p) {
  let low = 0, high = array.length;
  if (high === 0) {
    return 0;
  }
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (p(array[mid])) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}
function binarySearch(array, key, comparator) {
  let low = 0, high = array.length - 1;
  while (low <= high) {
    const mid = (low + high) / 2 | 0;
    const comp = comparator(array[mid], key);
    if (comp < 0) {
      low = mid + 1;
    } else if (comp > 0) {
      high = mid - 1;
    } else {
      return mid;
    }
  }
  return -(low + 1);
}

// packages/codec-kit/dist/xml/positional/types.js
var XMLNodeKind;
(function(XMLNodeKind2) {
  XMLNodeKind2[XMLNodeKind2["Document"] = 0] = "Document";
  XMLNodeKind2[XMLNodeKind2["Element"] = 1] = "Element";
})(XMLNodeKind || (XMLNodeKind = {}));
var XMLNode = class {
  start;
  end;
  parent;
  lang = {};
  children = [];
  constructor(start, end, parent) {
    this.start = start;
    this.end = end;
    this.parent = parent;
  }
  get firstChild() {
    return this.children[0];
  }
  get lastChild() {
    return this.children.length ? this.children[this.children.length - 1] : void 0;
  }
  findNodeBefore(offset) {
    const idx = findFirst(this.children, (c) => offset <= c.start) - 1;
    if (idx >= 0) {
      const child = this.children[idx];
      if (!child)
        return this;
      if (offset > child.start) {
        if (offset < child.end) {
          return child.findNodeBefore(offset);
        }
        const lastChild = child.lastChild;
        if (lastChild && lastChild.end === child.end) {
          return child.findNodeBefore(offset);
        }
        return child;
      }
    }
    return this;
  }
  findNodeAt(offset) {
    const idx = findFirst(this.children, (c) => offset <= c.start) - 1;
    if (idx >= 0) {
      const child = this.children[idx];
      if (child && offset > child.start && offset <= child.end) {
        return child.findNodeAt(offset);
      }
    }
    return this;
  }
  getDocument() {
    let curr = this;
    while (curr.parent) {
      curr = curr.parent;
    }
    return curr;
  }
  getDocumentDesc() {
    const curr = this.getDocument().firstChild;
    return curr;
  }
};
var XMLDocument = class extends XMLNode {
  kind = XMLNodeKind.Document;
  text;
  parseDiagnostics;
  getRootNode() {
    return this.firstChild;
  }
};
var XMLElement = class extends XMLNode {
  kind = XMLNodeKind.Element;
  tag;
  closed = false;
  selfClosed = false;
  startTagEnd;
  endTagStart;
  attributes = {};
  isSameTag(tagName) {
    return this.tag && tagName && this.tag.length === tagName.length && this.tag === tagName;
  }
  findAttributeAt(offset) {
    for (const attrKey in this.attributes) {
      const attr = this.attributes[attrKey];
      if (!attr)
        continue;
      if (attr.end < offset)
        continue;
      if (attr.start > offset)
        continue;
      return attr;
    }
    return null;
  }
  getAttributeValue(name, defValue = "") {
    const attr = this.attributes[name];
    if (!attr || !attr.startValue)
      return defValue;
    return attr.value;
  }
  hasAttribute(name) {
    const attr = this.attributes[name];
    if (!attr || !attr.startValue)
      return false;
    return true;
  }
};
var TokenType;
(function(TokenType2) {
  TokenType2[TokenType2["StartCommentTag"] = 0] = "StartCommentTag";
  TokenType2[TokenType2["Comment"] = 1] = "Comment";
  TokenType2[TokenType2["EndCommentTag"] = 2] = "EndCommentTag";
  TokenType2[TokenType2["StartTagOpen"] = 3] = "StartTagOpen";
  TokenType2[TokenType2["StartTagClose"] = 4] = "StartTagClose";
  TokenType2[TokenType2["StartTagSelfClose"] = 5] = "StartTagSelfClose";
  TokenType2[TokenType2["StartTag"] = 6] = "StartTag";
  TokenType2[TokenType2["EndTagOpen"] = 7] = "EndTagOpen";
  TokenType2[TokenType2["EndTagClose"] = 8] = "EndTagClose";
  TokenType2[TokenType2["EndTag"] = 9] = "EndTag";
  TokenType2[TokenType2["DelimiterAssign"] = 10] = "DelimiterAssign";
  TokenType2[TokenType2["AttributeName"] = 11] = "AttributeName";
  TokenType2[TokenType2["AttributeValue"] = 12] = "AttributeValue";
  TokenType2[TokenType2["StartDoctypeTag"] = 13] = "StartDoctypeTag";
  TokenType2[TokenType2["Doctype"] = 14] = "Doctype";
  TokenType2[TokenType2["EndDoctypeTag"] = 15] = "EndDoctypeTag";
  TokenType2[TokenType2["Content"] = 16] = "Content";
  TokenType2[TokenType2["Whitespace"] = 17] = "Whitespace";
  TokenType2[TokenType2["Unknown"] = 18] = "Unknown";
  TokenType2[TokenType2["EOS"] = 19] = "EOS";
})(TokenType || (TokenType = {}));
var ScannerState;
(function(ScannerState2) {
  ScannerState2[ScannerState2["WithinContent"] = 0] = "WithinContent";
  ScannerState2[ScannerState2["AfterOpeningStartTag"] = 1] = "AfterOpeningStartTag";
  ScannerState2[ScannerState2["AfterOpeningEndTag"] = 2] = "AfterOpeningEndTag";
  ScannerState2[ScannerState2["WithinDoctype"] = 3] = "WithinDoctype";
  ScannerState2[ScannerState2["WithinTag"] = 4] = "WithinTag";
  ScannerState2[ScannerState2["WithinEndTag"] = 5] = "WithinEndTag";
  ScannerState2[ScannerState2["WithinComment"] = 6] = "WithinComment";
  ScannerState2[ScannerState2["AfterAttributeName"] = 7] = "AfterAttributeName";
  ScannerState2[ScannerState2["BeforeAttributeValue"] = 8] = "BeforeAttributeValue";
})(ScannerState || (ScannerState = {}));
var DiagnosticCategory;
(function(DiagnosticCategory2) {
  DiagnosticCategory2[DiagnosticCategory2["Error"] = 1] = "Error";
  DiagnosticCategory2[DiagnosticCategory2["Warning"] = 2] = "Warning";
  DiagnosticCategory2[DiagnosticCategory2["Message"] = 3] = "Message";
  DiagnosticCategory2[DiagnosticCategory2["Hint"] = 4] = "Hint";
})(DiagnosticCategory || (DiagnosticCategory = {}));

// packages/codec-kit/dist/xml/positional/scanner.js
var log = getLogger(["xml", "positional-scanner"]);
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["nullCharacter"] = 0] = "nullCharacter";
  CharacterCodes2[CharacterCodes2["maxAsciiCharacter"] = 127] = "maxAsciiCharacter";
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["lineSeparator"] = 8232] = "lineSeparator";
  CharacterCodes2[CharacterCodes2["paragraphSeparator"] = 8233] = "paragraphSeparator";
  CharacterCodes2[CharacterCodes2["nextLine"] = 133] = "nextLine";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["nonBreakingSpace"] = 160] = "nonBreakingSpace";
  CharacterCodes2[CharacterCodes2["enQuad"] = 8192] = "enQuad";
  CharacterCodes2[CharacterCodes2["emQuad"] = 8193] = "emQuad";
  CharacterCodes2[CharacterCodes2["enSpace"] = 8194] = "enSpace";
  CharacterCodes2[CharacterCodes2["emSpace"] = 8195] = "emSpace";
  CharacterCodes2[CharacterCodes2["threePerEmSpace"] = 8196] = "threePerEmSpace";
  CharacterCodes2[CharacterCodes2["fourPerEmSpace"] = 8197] = "fourPerEmSpace";
  CharacterCodes2[CharacterCodes2["sixPerEmSpace"] = 8198] = "sixPerEmSpace";
  CharacterCodes2[CharacterCodes2["figureSpace"] = 8199] = "figureSpace";
  CharacterCodes2[CharacterCodes2["punctuationSpace"] = 8200] = "punctuationSpace";
  CharacterCodes2[CharacterCodes2["thinSpace"] = 8201] = "thinSpace";
  CharacterCodes2[CharacterCodes2["hairSpace"] = 8202] = "hairSpace";
  CharacterCodes2[CharacterCodes2["zeroWidthSpace"] = 8203] = "zeroWidthSpace";
  CharacterCodes2[CharacterCodes2["narrowNoBreakSpace"] = 8239] = "narrowNoBreakSpace";
  CharacterCodes2[CharacterCodes2["ideographicSpace"] = 12288] = "ideographicSpace";
  CharacterCodes2[CharacterCodes2["mathematicalSpace"] = 8287] = "mathematicalSpace";
  CharacterCodes2[CharacterCodes2["ogham"] = 5760] = "ogham";
  CharacterCodes2[CharacterCodes2["_"] = 95] = "_";
  CharacterCodes2[CharacterCodes2["$"] = 36] = "$";
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
  CharacterCodes2[CharacterCodes2["ampersand"] = 38] = "ampersand";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["at"] = 64] = "at";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["backtick"] = 96] = "backtick";
  CharacterCodes2[CharacterCodes2["bar"] = 124] = "bar";
  CharacterCodes2[CharacterCodes2["caret"] = 94] = "caret";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["closeParen"] = 41] = "closeParen";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["equals"] = 61] = "equals";
  CharacterCodes2[CharacterCodes2["exclamation"] = 33] = "exclamation";
  CharacterCodes2[CharacterCodes2["greaterThan"] = 62] = "greaterThan";
  CharacterCodes2[CharacterCodes2["hash"] = 35] = "hash";
  CharacterCodes2[CharacterCodes2["lessThan"] = 60] = "lessThan";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["openParen"] = 40] = "openParen";
  CharacterCodes2[CharacterCodes2["percent"] = 37] = "percent";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["question"] = 63] = "question";
  CharacterCodes2[CharacterCodes2["semicolon"] = 59] = "semicolon";
  CharacterCodes2[CharacterCodes2["singleQuote"] = 39] = "singleQuote";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["tilde"] = 126] = "tilde";
  CharacterCodes2[CharacterCodes2["backspace"] = 8] = "backspace";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["byteOrderMark"] = 65279] = "byteOrderMark";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
  CharacterCodes2[CharacterCodes2["verticalTab"] = 11] = "verticalTab";
})(CharacterCodes || (CharacterCodes = {}));
function localize(i, s) {
  return s;
}
var MultiLineStream = class {
  source;
  len;
  position;
  constructor(source, position) {
    this.source = source;
    this.len = source.length;
    this.position = position;
  }
  eos() {
    return this.len <= this.position;
  }
  getSource() {
    return this.source;
  }
  pos() {
    return this.position;
  }
  goBackTo(pos) {
    this.position = pos;
  }
  goBack(n) {
    this.position -= n;
  }
  advance(n) {
    this.position += n;
  }
  goToEnd() {
    this.position = this.source.length;
  }
  nextChar() {
    return this.source.charCodeAt(this.position++) || 0;
  }
  peekChar(n = 0) {
    return this.source.charCodeAt(this.position + n) || 0;
  }
  advanceIfChar(ch) {
    if (ch === this.source.charCodeAt(this.position)) {
      this.position++;
      return true;
    }
    return false;
  }
  advanceIfChars(ch) {
    let i;
    if (this.position + ch.length > this.source.length) {
      return false;
    }
    for (i = 0; i < ch.length; i++) {
      if (this.source.charCodeAt(this.position + i) !== ch[i]) {
        return false;
      }
    }
    this.advance(i);
    return true;
  }
  advanceIfRegExp(regex) {
    const str = this.source.substr(this.position);
    const match = str.match(regex);
    if (match) {
      this.position = this.position + match.index + match[0].length;
      return match[0];
    }
    return "";
  }
  advanceUntilRegExp(regex) {
    const str = this.source.substr(this.position);
    const match = str.match(regex);
    if (match) {
      this.position = this.position + match.index;
      return match[0];
    } else {
      this.goToEnd();
    }
    return "";
  }
  advanceUntilChar(ch) {
    while (this.position < this.source.length) {
      if (this.source.charCodeAt(this.position) === ch) {
        return true;
      }
      this.advance(1);
    }
    return false;
  }
  advanceUntilChars(ch) {
    while (this.position + ch.length <= this.source.length) {
      let i = 0;
      for (; i < ch.length && this.source.charCodeAt(this.position + i) === ch[i]; i++) {
      }
      if (i === ch.length) {
        return true;
      }
      this.advance(1);
    }
    this.goToEnd();
    return false;
  }
  skipWhitespace() {
    const n = this.advanceWhileChar((ch) => {
      return ch === _WSP || ch === _TAB || ch === _NWL || ch === _LFD || ch === _CAR;
    });
    return n > 0;
  }
  advanceWhileChar(condition) {
    const posNow = this.position;
    while (this.position < this.len && condition(this.source.charCodeAt(this.position))) {
      this.position++;
    }
    return this.position - posNow;
  }
};
var _BNG = "!".charCodeAt(0);
var _QST = "?".charCodeAt(0);
var _MIN = "-".charCodeAt(0);
var _LAN = "<".charCodeAt(0);
var _RAN = ">".charCodeAt(0);
var _FSL = "/".charCodeAt(0);
var _EQS = "=".charCodeAt(0);
var _DQO = '"'.charCodeAt(0);
var _SQO = "'".charCodeAt(0);
var _NWL = "\n".charCodeAt(0);
var _CAR = "\r".charCodeAt(0);
var _LFD = "\f".charCodeAt(0);
var _WSP = " ".charCodeAt(0);
var _TAB = "	".charCodeAt(0);
function createScanner(input, initialOffset = 0, initialState = ScannerState.WithinContent, onError) {
  const stream = new MultiLineStream(input, initialOffset);
  let state = initialState;
  let tokenOffset = 0;
  let tokenType = TokenType.Unknown;
  let tokenError;
  let hasSpaceAfterTag;
  let lastTag;
  let lastAttributeName;
  function nextElementName() {
    return stream.advanceIfRegExp(/^[_:\w][_:\w-.\d]*/).toLowerCase();
  }
  function nextAttributeName() {
    return stream.advanceIfRegExp(/^[^\s"'<>/=\x00-\x0F\x7F\x80-\x9F]*/).toLowerCase();
  }
  function finishToken(offset, type, errorMessage) {
    tokenType = type;
    tokenOffset = offset;
    if (errorMessage && onError) {
      onError({
        message: errorMessage,
        category: DiagnosticCategory.Error,
        start: tokenOffset,
        end: stream.pos()
      });
    }
    return type;
  }
  function scan() {
    const offset = stream.pos();
    const oldState = state;
    const token = internalScan();
    if (token !== TokenType.EOS && offset === stream.pos()) {
      log.warn("scan has not advanced", { offset, stateBefore: oldState, stateAfter: state });
      stream.advance(1);
      return finishToken(offset, TokenType.Unknown);
    }
    return token;
  }
  function internalScan() {
    const offset = stream.pos();
    if (stream.eos()) {
      return finishToken(offset, TokenType.EOS);
    }
    let errorMessage;
    switch (state) {
      case ScannerState.WithinComment:
        if (stream.advanceIfChars([_MIN, _MIN, _RAN])) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.EndCommentTag);
        }
        stream.advanceUntilChars([_MIN, _MIN, _RAN]);
        return finishToken(offset, TokenType.Comment);
      case ScannerState.WithinDoctype:
        stream.advanceIfChar(_QST);
        if (stream.advanceIfChar(_RAN)) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.EndDoctypeTag);
        }
        stream.advanceUntilChar(_RAN);
        return finishToken(offset, TokenType.Doctype);
      case ScannerState.WithinContent:
        if (stream.advanceIfChar(_LAN)) {
          if (!stream.eos() && (stream.peekChar() === _BNG || stream.peekChar() === _QST)) {
            if (stream.advanceIfChars([_BNG, _MIN, _MIN])) {
              state = ScannerState.WithinComment;
              return finishToken(offset, TokenType.StartCommentTag);
            }
            if (stream.advanceIfRegExp(/^\?xml/i)) {
              state = ScannerState.WithinDoctype;
              return finishToken(offset, TokenType.StartDoctypeTag);
            }
          }
          if (stream.advanceIfChar(_FSL)) {
            state = ScannerState.AfterOpeningEndTag;
            return finishToken(offset, TokenType.EndTagOpen);
          }
          state = ScannerState.AfterOpeningStartTag;
          return finishToken(offset, TokenType.StartTagOpen);
        }
        stream.advanceUntilChar(_LAN);
        return finishToken(offset, TokenType.Content);
      case ScannerState.AfterOpeningEndTag: {
        const tagName = nextElementName();
        if (tagName.length > 0) {
          state = ScannerState.WithinEndTag;
          return finishToken(offset, TokenType.EndTag);
        }
        if (stream.skipWhitespace()) {
          if (stream.peekChar() === _LAN) {
            state = ScannerState.WithinContent;
          }
          return finishToken(offset, TokenType.Whitespace, localize("error.unexpectedWhitespace", "Tag name must directly follow the open bracket."));
        }
        state = ScannerState.WithinEndTag;
        stream.advanceUntilChar(_RAN);
        if (offset < stream.pos()) {
          return finishToken(offset, TokenType.Unknown, localize("error.endTagNameExpected", "End tag name expected."));
        }
        return internalScan();
      }
      case ScannerState.WithinEndTag:
        if (stream.skipWhitespace()) {
          return finishToken(offset, TokenType.Whitespace);
        }
        if (stream.advanceIfChar(_RAN)) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.EndTagClose);
        }
        errorMessage = localize("error.tagNameExpected", "Closing bracket expected.");
        if (stream.peekChar() === _LAN) {
          state = ScannerState.WithinContent;
          finishToken(offset, TokenType.Unknown, errorMessage);
          return internalScan();
        }
        break;
      case ScannerState.AfterOpeningStartTag:
        lastTag = nextElementName();
        lastAttributeName = void 0;
        if (lastTag.length > 0) {
          hasSpaceAfterTag = false;
          state = ScannerState.WithinTag;
          return finishToken(offset, TokenType.StartTag);
        }
        if (stream.skipWhitespace()) {
          if (stream.peekChar() === _LAN) {
            state = ScannerState.WithinContent;
          }
          return finishToken(offset, TokenType.Whitespace, localize("error.unexpectedWhitespace", "Tag name must directly follow the open bracket."));
        }
        state = ScannerState.WithinTag;
        stream.advanceUntilChar(_RAN);
        if (offset < stream.pos()) {
          return finishToken(offset, TokenType.Unknown, localize("error.startTagNameExpected", "Start tag name expected."));
        }
        return internalScan();
      case ScannerState.WithinTag:
        if (stream.skipWhitespace()) {
          hasSpaceAfterTag = true;
          return finishToken(offset, TokenType.Whitespace);
        }
        if (hasSpaceAfterTag) {
          lastAttributeName = nextAttributeName();
          if (lastAttributeName.length > 0) {
            state = ScannerState.AfterAttributeName;
            hasSpaceAfterTag = false;
            return finishToken(offset, TokenType.AttributeName);
          }
        }
        if (stream.advanceIfChars([_FSL, _RAN])) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.StartTagSelfClose);
        }
        if (stream.advanceIfChar(_RAN)) {
          state = ScannerState.WithinContent;
          return finishToken(offset, TokenType.StartTagClose);
        }
        stream.advance(1);
        return finishToken(offset, TokenType.Unknown, localize("error.unexpectedCharacterInTag", "Unexpected character in tag."));
      case ScannerState.AfterAttributeName:
        if (stream.skipWhitespace()) {
          hasSpaceAfterTag = true;
          return finishToken(offset, TokenType.Whitespace);
        }
        if (stream.advanceIfChar(_EQS)) {
          state = ScannerState.BeforeAttributeValue;
          return finishToken(offset, TokenType.DelimiterAssign);
        }
        state = ScannerState.WithinTag;
        return internalScan();
      case ScannerState.BeforeAttributeValue: {
        if (stream.skipWhitespace()) {
          return finishToken(offset, TokenType.Whitespace);
        }
        const attributeValue = stream.advanceIfRegExp(/^[^\s"'`=<>/]+/);
        if (attributeValue.length > 0) {
          state = ScannerState.WithinTag;
          hasSpaceAfterTag = false;
          return finishToken(offset, TokenType.AttributeValue);
        }
        const ch = stream.peekChar();
        if (ch === _SQO || ch === _DQO) {
          stream.advance(1);
          state = ScannerState.WithinTag;
          hasSpaceAfterTag = false;
          const attributeValue2 = finishToken(offset, TokenType.AttributeValue);
          if (stream.advanceUntilChar(ch)) {
            stream.advance(1);
          }
          return attributeValue2;
        }
        state = ScannerState.WithinTag;
        hasSpaceAfterTag = false;
        return internalScan();
      }
    }
    stream.advance(1);
    state = ScannerState.WithinContent;
    return finishToken(offset, TokenType.Unknown, errorMessage);
  }
  return {
    scan,
    getTokenType: () => tokenType,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => stream.pos() - tokenOffset,
    getTokenEnd: () => stream.pos(),
    getTokenText: () => stream.getSource().substring(tokenOffset, stream.pos()),
    getScannerState: () => state,
    getTokenError: () => tokenError
  };
}
function buildLineMap(input) {
  const lineMap = [0];
  let offset = 0;
  while (offset < input.length) {
    if (input.charCodeAt(offset++) === CharacterCodes.lineFeed) {
      lineMap.push(offset);
    }
  }
  return lineMap;
}

// packages/codec-kit/dist/xml/positional/parser.js
function parse(text, hooks) {
  const diagnostics = [];
  const scanner = createScanner(text, 0, ScannerState.WithinContent, (report) => diagnostics.push(report));
  const docElement = new XMLDocument(0, text.length, void 0);
  docElement.text = text;
  hooks?.onDocumentCreate?.(docElement);
  let curr = docElement;
  let endTagStart = -1;
  let pendingAttribute = null;
  let token = scanner.scan();
  function printDiagnosticsAtCurrentToken(msg, start, end) {
    diagnostics.push({
      start: start || scanner.getTokenOffset(),
      end: end || scanner.getTokenEnd(),
      category: DiagnosticCategory.Error,
      message: msg
    });
  }
  while (token !== TokenType.EOS) {
    switch (token) {
      case TokenType.StartTagOpen: {
        if (curr.parent) {
          if (curr.tag === void 0) {
            curr = curr.parent;
          } else if (hooks?.shouldAutoClose?.(curr)) {
            printDiagnosticsAtCurrentToken(`?Missing end tag for "${curr.tag}"`, curr.start, curr.startTagEnd);
            curr.end = endTagStart;
            curr.closed = false;
            curr = curr.parent;
          }
        }
        curr = new XMLElement(scanner.getTokenOffset(), text.length, curr);
        break;
      }
      case TokenType.StartTag: {
        ;
        curr.tag = scanner.getTokenText();
        curr.parent.children.push(curr);
        hooks?.onElementOpen?.(curr, curr.parent);
        break;
      }
      case TokenType.StartTagClose: {
        ;
        curr.startTagEnd = curr.end = scanner.getTokenEnd();
        hooks?.onStartTagClose?.(curr);
        break;
      }
      case TokenType.EndTagOpen: {
        if (!curr.parent) {
          break;
        }
        if (curr.tag === void 0) {
          curr = curr.parent;
        }
        endTagStart = scanner.getTokenOffset();
        break;
      }
      case TokenType.EndTag: {
        const closeTag = scanner.getTokenText();
        if (curr !== docElement) {
          ;
          curr.closed = true;
          curr.endTagStart = endTagStart;
          if (!curr.isSameTag(closeTag) && curr.parent) {
            curr.end = endTagStart;
            curr.closed = false;
            if (curr.parent !== docElement && curr.parent.isSameTag(closeTag)) {
              printDiagnosticsAtCurrentToken(`Missing end tag for "${curr.tag}"`, curr.start, curr.start + curr.tag.length + 1);
              curr = curr.parent;
            } else {
              printDiagnosticsAtCurrentToken(`End tag miss-match for "${curr.tag}"`, scanner.getTokenOffset(), scanner.getTokenEnd());
            }
          }
        }
        break;
      }
      case TokenType.StartTagSelfClose: {
        if (curr.parent) {
          ;
          curr.closed = true;
          curr.selfClosed = true;
          curr.startTagEnd = curr.end = scanner.getTokenEnd();
          hooks?.onStartTagClose?.(curr);
          curr = curr.parent;
        }
        break;
      }
      case TokenType.EndTagClose: {
        if (curr.parent) {
          curr.end = scanner.getTokenEnd();
          curr = curr.parent;
        }
        break;
      }
      case TokenType.AttributeName: {
        pendingAttribute = scanner.getTokenText().toLocaleLowerCase();
        curr.attributes[pendingAttribute] = {
          start: scanner.getTokenOffset(),
          end: scanner.getTokenEnd(),
          name: scanner.getTokenText()
        };
        break;
      }
      case TokenType.AttributeValue: {
        let value = scanner.getTokenText();
        if (pendingAttribute) {
          if (value.length >= 2 && value.charCodeAt(0) === CharacterCodes.doubleQuote && value.charCodeAt(value.length - 1) === CharacterCodes.doubleQuote) {
            value = value.substr(1, value.length - 2);
          }
          const attr = curr.attributes[pendingAttribute];
          attr.value = value;
          attr.startValue = scanner.getTokenOffset();
          attr.end = scanner.getTokenEnd();
          pendingAttribute = null;
        }
        break;
      }
    }
    token = scanner.scan();
  }
  while (curr.parent) {
    if (curr.kind === XMLNodeKind.Element) {
      const currEl = curr;
      if (!currEl.closed) {
        printDiagnosticsAtCurrentToken(`Expected end tag for "${currEl.tag}", EOS.`);
      } else {
        printDiagnosticsAtCurrentToken(`End tag hasn't been closed appropriately for "${currEl.tag}"`);
      }
    }
    curr.end = text.length;
    curr = curr.parent;
  }
  if (docElement.children.length > 1) {
    printDiagnosticsAtCurrentToken("Encountered a second root tag. There can be only one root tag per file.");
  }
  return {
    diagnostics,
    root: docElement
  };
}
export {
  CharacterCodes,
  DiagnosticCategory,
  ScannerState,
  TokenType,
  XMLDocument,
  XMLElement,
  XMLNode,
  XMLNodeKind,
  binarySearch,
  buildLineMap,
  createScanner,
  findFirst,
  parse
};
