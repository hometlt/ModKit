import * as util from "#util";

//#region src/formatter.ts
/**
* The severity level abbreviations.
*/
const levelAbbreviations = {
	"trace": "TRC",
	"debug": "DBG",
	"info": "INF",
	"warning": "WRN",
	"error": "ERR",
	"fatal": "FTL"
};
/**
* A platform-specific inspect function.  In Deno, this is {@link Deno.inspect},
* and in Node.js/Bun it is `util.inspect()`.  If neither is available, it
* falls back to {@link JSON.stringify}.
*
* @param value The value to inspect.
* @param options The options for inspecting the value.
*                If `colors` is `true`, the output will be ANSI-colored.
* @returns The string representation of the value.
*/
const platformInspect = typeof document !== "undefined" || typeof navigator !== "undefined" && navigator.product === "ReactNative" ? (v) => JSON.stringify(v) : "Deno" in globalThis && "inspect" in globalThis.Deno && typeof globalThis.Deno.inspect === "function" ? (v, opts) => globalThis.Deno.inspect(v, {
	strAbbreviateSize: Infinity,
	iterableLimit: Infinity,
	...opts
}) : util != null && "inspect" in util && typeof util.inspect === "function" ? (v, opts) => util.inspect(v, {
	maxArrayLength: Infinity,
	maxStringLength: Infinity,
	...opts
}) : (v) => JSON.stringify(v);
const inspect = (value, options) => String(platformInspect(value, options));
const utf8Encoder = new TextEncoder();
function renderMessageParts(msgParts, valueRenderer) {
	const msgLen = msgParts.length;
	if (msgLen === 1) return msgParts[0];
	if (msgLen <= 6) {
		let message = "";
		for (let i = 0; i < msgLen; i++) message += i % 2 === 0 ? msgParts[i] : valueRenderer(msgParts[i]);
		return message;
	}
	const parts = new Array(msgLen);
	for (let i = 0; i < msgLen; i++) parts[i] = i % 2 === 0 ? msgParts[i] : valueRenderer(msgParts[i]);
	return parts.join("");
}
function padZero(num) {
	return num < 10 ? `0${num}` : `${num}`;
}
function padThree(num) {
	return num < 10 ? `00${num}` : num < 100 ? `0${num}` : `${num}`;
}
const fixedOffsetPattern = /^([+-])(0\d|1\d|2[0-3]):([0-5]\d)$/;
function formatOffset(minutes, full) {
	const sign = minutes < 0 ? "-" : "+";
	const absolute = Math.abs(minutes);
	const hour = padZero(Math.floor(absolute / 60));
	const minute = padZero(absolute % 60);
	if (!full && minute === "00") return `${sign}${hour}`;
	return `${sign}${hour}:${minute}`;
}
function readPartsFromFormatter(formatter, ts) {
	const parts = formatter.formatToParts(new Date(ts));
	let year = "";
	let month = "";
	let day = "";
	let hour = "";
	let minute = "";
	let second = "";
	for (const part of parts) if (part.type === "year") year = part.value;
	else if (part.type === "month") month = part.value;
	else if (part.type === "day") day = part.value;
	else if (part.type === "hour") hour = part.value;
	else if (part.type === "minute") minute = part.value;
	else if (part.type === "second") second = part.value;
	return {
		year,
		month,
		day,
		hour,
		minute,
		second
	};
}
function getDateParts(ts, config) {
	const d = new Date(ts);
	const ms = padThree(d.getUTCMilliseconds());
	if (config.kind === "utc") return {
		year: `${d.getUTCFullYear()}`,
		month: padZero(d.getUTCMonth() + 1),
		day: padZero(d.getUTCDate()),
		hour: padZero(d.getUTCHours()),
		minute: padZero(d.getUTCMinutes()),
		second: padZero(d.getUTCSeconds()),
		ms,
		offsetMinutes: 0
	};
	if (config.kind === "local") return {
		year: `${d.getFullYear()}`,
		month: padZero(d.getMonth() + 1),
		day: padZero(d.getDate()),
		hour: padZero(d.getHours()),
		minute: padZero(d.getMinutes()),
		second: padZero(d.getSeconds()),
		ms,
		offsetMinutes: -d.getTimezoneOffset()
	};
	if (config.kind === "offset") {
		const shifted = new Date(ts + config.minutes * 6e4);
		return {
			year: `${shifted.getUTCFullYear()}`,
			month: padZero(shifted.getUTCMonth() + 1),
			day: padZero(shifted.getUTCDate()),
			hour: padZero(shifted.getUTCHours()),
			minute: padZero(shifted.getUTCMinutes()),
			second: padZero(shifted.getUTCSeconds()),
			ms,
			offsetMinutes: config.minutes
		};
	}
	const parts = readPartsFromFormatter(config.formatter, ts);
	const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second), d.getUTCMilliseconds());
	const offsetMinutes = Math.round((asUtc - ts) / 6e4);
	return {
		...parts,
		ms,
		offsetMinutes
	};
}
function resolveTimeZone(timeZone) {
	if (typeof timeZone === "undefined") return { kind: "utc" };
	if (timeZone === null) return { kind: "local" };
	const offsetMatch = fixedOffsetPattern.exec(timeZone);
	if (offsetMatch != null) {
		const sign = offsetMatch[1] === "-" ? -1 : 1;
		const hours = Number(offsetMatch[2]);
		const minutes = Number(offsetMatch[3]);
		return {
			kind: "offset",
			minutes: sign * (hours * 60 + minutes)
		};
	}
	if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") throw new TypeError(`Invalid timeZone option: ${JSON.stringify(timeZone)}. This environment does not support IANA time zones.`);
	try {
		return {
			kind: "iana",
			formatter: new Intl.DateTimeFormat("en-CA", {
				timeZone,
				hour12: false,
				hourCycle: "h23",
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			})
		};
	} catch {
		throw new TypeError(`Invalid timeZone option: ${JSON.stringify(timeZone)}. Expected an IANA time zone name (e.g., "Asia/Seoul") or a fixed UTC offset string (e.g., "+09:00").`);
	}
}
function createTimestampFormatter(pattern, timeZone) {
	if (pattern === "none") return () => null;
	if (pattern === "rfc3339" && timeZone.kind === "utc") return (ts) => new Date(ts).toISOString();
	return (ts) => {
		const parts = getDateParts(ts, timeZone);
		const date = `${parts.year}-${parts.month}-${parts.day}`;
		const time = `${parts.hour}:${parts.minute}:${parts.second}.${parts.ms}`;
		const tzLong = formatOffset(parts.offsetMinutes, true);
		const tzShort = formatOffset(parts.offsetMinutes, false);
		if (pattern === "date-time-timezone") return `${date} ${time} ${tzLong}`;
		if (pattern === "date-time-tz") return `${date} ${time} ${tzShort}`;
		if (pattern === "date-time") return `${date} ${time}`;
		if (pattern === "time-timezone") return `${time} ${tzLong}`;
		if (pattern === "time-tz") return `${time} ${tzShort}`;
		if (pattern === "time") return time;
		if (pattern === "date") return date;
		return `${date}T${time}${tzLong}`;
	};
}
const levelRenderersCache = {
	ABBR: levelAbbreviations,
	abbr: {
		trace: "trc",
		debug: "dbg",
		info: "inf",
		warning: "wrn",
		error: "err",
		fatal: "ftl"
	},
	FULL: {
		trace: "TRACE",
		debug: "DEBUG",
		info: "INFO",
		warning: "WARNING",
		error: "ERROR",
		fatal: "FATAL"
	},
	full: {
		trace: "trace",
		debug: "debug",
		info: "info",
		warning: "warning",
		error: "error",
		fatal: "fatal"
	},
	L: {
		trace: "T",
		debug: "D",
		info: "I",
		warning: "W",
		error: "E",
		fatal: "F"
	},
	l: {
		trace: "t",
		debug: "d",
		info: "i",
		warning: "w",
		error: "e",
		fatal: "f"
	}
};
/**
* Helper function to get the line ending value based on the option.
* @param lineEnding The line ending option.
* @returns The line ending string.
*/
function getLineEndingValue(lineEnding) {
	return lineEnding === "crlf" ? "\r\n" : "\n";
}
function jsonReplacer(_key, value) {
	if (!(value instanceof Error)) return value;
	const serialized = {
		name: value.name,
		message: value.message
	};
	if (typeof value.stack === "string") serialized.stack = value.stack;
	const cause = value.cause;
	if (cause !== void 0) serialized.cause = cause;
	if (typeof AggregateError !== "undefined" && value instanceof AggregateError) serialized.errors = value.errors;
	for (const key of Object.keys(value)) if (!(key in serialized)) serialized[key] = value[key];
	return serialized;
}
function renderDefaultJsonLinesMessage(message) {
	const messageLength = message.length;
	if (messageLength === 1) return message[0];
	if (messageLength === 3) return message[0] + JSON.stringify(message[1]) + message[2];
	let rendered = message[0];
	for (let i = 1; i < messageLength; i++) rendered += i & 1 ? JSON.stringify(message[i]) : message[i];
	return rendered;
}
function stringifyJsonLinesField(key, value) {
	if (value != null && (typeof value === "object" || typeof value === "function" || typeof value === "bigint")) {
		const toJSON = value.toJSON;
		if (typeof toJSON === "function") value = toJSON.call(value, key);
	}
	return JSON.stringify(jsonReplacer(key, value), jsonReplacer);
}
function formatDefaultJsonLinesRecord(record, lineEnding) {
	const level = record.level === "warning" ? "WARN" : record.level.toUpperCase();
	const messageJson = stringifyJsonLinesField("message", renderDefaultJsonLinesMessage(record.message));
	const propertiesJson = stringifyJsonLinesField("properties", record.properties);
	let line = `{"@timestamp":${JSON.stringify(new Date(record.timestamp).toISOString())},"level":${JSON.stringify(level)}`;
	if (messageJson !== void 0) line += `,"message":${messageJson}`;
	line += `,"logger":${JSON.stringify(record.category.join("."))}`;
	if (propertiesJson !== void 0) line += `,"properties":${propertiesJson}`;
	return `${line}}${lineEnding}`;
}
/**
* Get a text formatter with the specified options.  Although it's flexible
* enough to create a custom formatter, if you want more control, you can
* create a custom formatter that satisfies the {@link TextFormatter} type
* instead.
*
* For more information on the options, see {@link TextFormatterOptions}.
*
* By default, the formatter formats log records as follows:
*
* ```
* 2023-11-14 22:13:20.000 +00:00 [INF] category·subcategory: Hello, world!
* ```
* @param options The options for the text formatter.
* @returns The text formatter.
* @since 0.6.0
*/
function getTextFormatter(options = {}) {
	const timestampRenderer = (() => {
		const tsOption = options.timestamp;
		const timeZone = resolveTimeZone(options.timeZone);
		if (tsOption == null) return createTimestampFormatter("date-time-timezone", timeZone);
		else if (tsOption === "disabled") return createTimestampFormatter("none", timeZone);
		else if (typeof tsOption === "string" && (tsOption === "date-time-timezone" || tsOption === "date-time-tz" || tsOption === "date-time" || tsOption === "time-timezone" || tsOption === "time-tz" || tsOption === "time" || tsOption === "date" || tsOption === "rfc3339" || tsOption === "none")) return createTimestampFormatter(tsOption, timeZone);
		else return tsOption;
	})();
	const categorySeparator = options.category ?? "·";
	const valueRenderer = options.value ? (v) => options.value(v, inspect) : inspect;
	const levelRenderer = (() => {
		const levelOption = options.level;
		if (levelOption == null || levelOption === "ABBR") return (level) => levelRenderersCache.ABBR[level];
		else if (levelOption === "abbr") return (level) => levelRenderersCache.abbr[level];
		else if (levelOption === "FULL") return (level) => levelRenderersCache.FULL[level];
		else if (levelOption === "full") return (level) => levelRenderersCache.full[level];
		else if (levelOption === "L") return (level) => levelRenderersCache.L[level];
		else if (levelOption === "l") return (level) => levelRenderersCache.l[level];
		else return levelOption;
	})();
	const lineEnding = getLineEndingValue(options.lineEnding);
	const formatter = options.format ?? (({ timestamp, level, category, message }) => `${timestamp ? `${timestamp} ` : ""}[${level}] ${category}: ${message}`);
	return (record) => {
		const message = renderMessageParts(record.message, valueRenderer);
		const timestamp = timestampRenderer(record.timestamp);
		const level = levelRenderer(record.level);
		const category = typeof categorySeparator === "function" ? categorySeparator(record.category) : record.category.join(categorySeparator);
		const values = {
			timestamp,
			level,
			category,
			message,
			record
		};
		return `${formatter(values)}${lineEnding}`;
	};
}
/**
* The default text formatter.  This formatter formats log records as follows:
*
* ```
* 2023-11-14 22:13:20.000 +00:00 [INF] category·subcategory: Hello, world!
* ```
*
* @param record The log record to format.
* @returns The formatted log record.
*/
const defaultTextFormatter = getTextFormatter();
const RESET = "\x1B[0m";
const ansiColors = {
	black: "\x1B[30m",
	red: "\x1B[31m",
	green: "\x1B[32m",
	yellow: "\x1B[33m",
	blue: "\x1B[34m",
	magenta: "\x1B[35m",
	cyan: "\x1B[36m",
	white: "\x1B[37m"
};
const ansiStyles = {
	bold: "\x1B[1m",
	dim: "\x1B[2m",
	italic: "\x1B[3m",
	underline: "\x1B[4m",
	strikethrough: "\x1B[9m"
};
const defaultLevelColors = {
	trace: null,
	debug: "blue",
	info: "green",
	warning: "yellow",
	error: "red",
	fatal: "magenta"
};
/**
* Get an ANSI color formatter with the specified options.
*
* ![A preview of an ANSI color formatter.](https://i.imgur.com/I8LlBUf.png)
* @param option The options for the ANSI color formatter.
* @returns The ANSI color formatter.
* @since 0.6.0
*/
function getAnsiColorFormatter(options = {}) {
	const format = options.format;
	const timestampStyle = typeof options.timestampStyle === "undefined" ? "dim" : options.timestampStyle;
	const timestampColor = options.timestampColor ?? null;
	const timestampPrefix = `${timestampStyle == null ? "" : ansiStyles[timestampStyle]}${timestampColor == null ? "" : ansiColors[timestampColor]}`;
	const timestampSuffix = timestampStyle == null && timestampColor == null ? "" : RESET;
	const levelStyle = typeof options.levelStyle === "undefined" ? "bold" : options.levelStyle;
	const levelColors = options.levelColors ?? defaultLevelColors;
	const categoryStyle = typeof options.categoryStyle === "undefined" ? "dim" : options.categoryStyle;
	const categoryColor = options.categoryColor ?? null;
	const categoryPrefix = `${categoryStyle == null ? "" : ansiStyles[categoryStyle]}${categoryColor == null ? "" : ansiColors[categoryColor]}`;
	const categorySuffix = categoryStyle == null && categoryColor == null ? "" : RESET;
	return getTextFormatter({
		timestamp: "date-time-tz",
		value(value, fallbackInspect) {
			return fallbackInspect(value, { colors: true });
		},
		...options,
		format({ timestamp, level, category, message, record }) {
			const levelColor = levelColors[record.level];
			timestamp = timestamp == null ? null : `${timestampPrefix}${timestamp}${timestampSuffix}`;
			level = `${levelStyle == null ? "" : ansiStyles[levelStyle]}${levelColor == null ? "" : ansiColors[levelColor]}${level}${levelStyle == null && levelColor == null ? "" : RESET}`;
			return format == null ? `${timestamp == null ? "" : `${timestamp} `}${level} ${categoryPrefix}${category}:${categorySuffix} ${message}` : format({
				timestamp,
				level,
				category: `${categoryPrefix}${category}${categorySuffix}`,
				message,
				record
			});
		}
	});
}
/**
* A text formatter that uses ANSI colors to format log records.
*
* ![A preview of ansiColorFormatter.](https://i.imgur.com/I8LlBUf.png)
*
* @param record The log record to format.
* @returns The formatted log record.
* @since 0.5.0
*/
const ansiColorFormatter = getAnsiColorFormatter();
/**
* Get a [JSON Lines] formatter with the specified options.  The log records
* will be rendered as JSON objects, one per line, which is a common format
* for log files.  This format is also known as Newline-Delimited JSON (NDJSON).
* It looks like this:
*
* ```json
* {"@timestamp":"2023-11-14T22:13:20.000Z","level":"INFO","message":"Hello, world!","logger":"my.logger","properties":{"key":"value"}}
* ```
*
* [JSON Lines]: https://jsonlines.org/
* @param options The options for the JSON Lines formatter.
* @returns The JSON Lines formatter.
* @since 0.11.0
*/
function getJsonLinesFormatter(options = {}) {
	const lineEnding = getLineEndingValue(options.lineEnding);
	if (!options.categorySeparator && !options.message && !options.properties) return (record) => formatDefaultJsonLinesRecord(record, lineEnding);
	const isTemplateMessage = options.message === "template";
	const propertiesOption = options.properties ?? "nest:properties";
	let joinCategory;
	if (typeof options.categorySeparator === "function") joinCategory = options.categorySeparator;
	else {
		const separator = options.categorySeparator ?? ".";
		joinCategory = (category) => category.join(separator);
	}
	let getProperties;
	if (propertiesOption === "flatten") getProperties = (properties) => properties;
	else if (propertiesOption.startsWith("prepend:")) {
		const prefix = propertiesOption.substring(8);
		if (prefix === "") throw new TypeError(`Invalid properties option: ${JSON.stringify(propertiesOption)}. It must be of the form "prepend:<prefix>" where <prefix> is a non-empty string.`);
		getProperties = (properties) => {
			const result = {};
			for (const key in properties) result[`${prefix}${key}`] = properties[key];
			return result;
		};
	} else if (propertiesOption.startsWith("nest:")) {
		const key = propertiesOption.substring(5);
		getProperties = (properties) => ({ [key]: properties });
	} else throw new TypeError(`Invalid properties option: ${JSON.stringify(propertiesOption)}. It must be "flatten", "prepend:<prefix>", or "nest:<key>".`);
	let getMessage;
	if (isTemplateMessage) getMessage = (record) => {
		if (typeof record.rawMessage === "string") return record.rawMessage;
		let msg = "";
		for (let i = 0; i < record.rawMessage.length; i++) {
			if (i > 0) msg += "{}";
			msg += record.rawMessage[i];
		}
		return msg;
	};
	else getMessage = (record) => {
		const msgLen = record.message.length;
		if (msgLen === 1) return record.message[0];
		let msg = "";
		for (let i = 0; i < msgLen; i++) msg += i % 2 < 1 ? record.message[i] : JSON.stringify(record.message[i]);
		return msg;
	};
	return (record) => {
		return JSON.stringify({
			"@timestamp": new Date(record.timestamp).toISOString(),
			level: record.level === "warning" ? "WARN" : record.level.toUpperCase(),
			message: getMessage(record),
			logger: joinCategory(record.category),
			...getProperties(record.properties)
		}, jsonReplacer) + lineEnding;
	};
}
/**
* The default [JSON Lines] formatter.  This formatter formats log records
* as JSON objects, one per line, which is a common format for log files.
* It looks like this:
*
* ```json
* {"@timestamp":"2023-11-14T22:13:20.000Z","level":"INFO","message":"Hello, world!","logger":"my.logger","properties":{"key":"value"}}
* ```
*
* You can customize the output by passing options to
* {@link getJsonLinesFormatter}.  For example, you can change the category
* separator, the message format, and how the properties are formatted.
*
* [JSON Lines]: https://jsonlines.org/
* @since 0.11.0
*/
const jsonLinesFormatter = getJsonLinesFormatter();
function renderStructuredMessage(record, template) {
	if (template) {
		if (typeof record.rawMessage === "string") return record.rawMessage;
		return record.rawMessage.join("{}");
	}
	return renderMessageParts(record.message, stringifyLogfmtValue);
}
function filterLogfmtKey(key) {
	if (key === "") return null;
	let needsEscape = false;
	for (const char of key) {
		const code = char.codePointAt(0);
		if (shouldEscapeLogfmtKeyChar(char, code)) {
			needsEscape = true;
			break;
		}
	}
	if (!needsEscape) return key;
	let result = "";
	for (const char of key) {
		const code = char.codePointAt(0);
		if (shouldEscapeLogfmtKeyChar(char, code)) result += encodeLogfmtKeyChar(char);
		else result += char;
	}
	return result;
}
function shouldEscapeLogfmtKeyChar(char, code) {
	return code <= 32 || code === 127 || code === 65533 || char === "=" || char === "\"" || char === "%";
}
function encodeLogfmtKeyChar(char) {
	let result = "";
	for (const byte of utf8Encoder.encode(char)) result += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
	return result;
}
function stringifyLogfmtValue(value) {
	if (typeof value === "string") return value;
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint" || typeof value === "undefined" || typeof value === "symbol" || typeof value === "function") return String(value);
	try {
		const json = JSON.stringify(value, jsonReplacer);
		if (typeof json === "string") return unwrapJsonStringLiteral(json);
	} catch {}
	return inspect(value, { colors: false });
}
function unwrapJsonStringLiteral(json) {
	if (json.startsWith("\"") && json.endsWith("\"")) return JSON.parse(json);
	return json;
}
function quoteLogfmtValue(value, isString) {
	let needsQuote = value === "" || isString && shouldQuoteStringLiteral(value);
	for (const char of value) {
		const code = char.codePointAt(0);
		if (shouldQuoteLogfmtValueChar(char, code)) {
			needsQuote = true;
			break;
		}
	}
	if (!needsQuote) return value;
	let quoted = "";
	for (const char of value) {
		const code = char.codePointAt(0);
		quoted += escapeLogfmtValueChar(char, code);
	}
	return `"${quoted}"`;
}
function shouldQuoteStringLiteral(value) {
	return value === "null" || value === "undefined" || value === "true" || value === "false";
}
function shouldQuoteLogfmtValueChar(char, code) {
	return code <= 32 || code === 127 || code === 65533 || char === "=" || char === "\"" || char === "\\";
}
function escapeLogfmtValueChar(char, code) {
	switch (char) {
		case "	": return "\\t";
		case "\n": return "\\n";
		case "\r": return "\\r";
		case "\"": return "\\\"";
		case "\\": return "\\\\";
		default: return code <= 31 || code === 127 ? `\\u${code.toString(16).padStart(4, "0")}` : char;
	}
}
function formatLogfmtValue(value) {
	const stringified = stringifyLogfmtValue(value);
	return quoteLogfmtValue(stringified, typeof value === "string");
}
function pushLogfmtPair(pairs, key, value) {
	const filteredKey = filterLogfmtKey(key);
	if (filteredKey == null) return;
	pairs.push(`${filteredKey}=${formatLogfmtValue(value)}`);
}
/**
* Get a [logfmt] formatter with the specified options.  The log records
* will be rendered as space-delimited key-value pairs, one record per line.
* It looks like this:
*
* ```text
* time=2023-11-14T22:13:20.000Z level=info logger=my.logger msg="Hello, world!" key=value
* ```
*
* [logfmt]: https://brandur.org/logfmt
* @param options The options for the logfmt formatter.
* @returns The logfmt formatter.
* @since 2.1.0
*/
function getLogfmtFormatter(options = {}) {
	const prependPrefix = "prepend:";
	const lineEnding = getLineEndingValue(options.lineEnding);
	const timestampRenderer = createTimestampFormatter("rfc3339", resolveTimeZone(options.timeZone));
	const isTemplateMessage = options.message === "template";
	const propertiesOption = options.properties ?? "flatten";
	let joinCategory;
	if (typeof options.categorySeparator === "function") joinCategory = options.categorySeparator;
	else {
		const separator = options.categorySeparator ?? ".";
		joinCategory = (category) => category.join(separator);
	}
	let propertyPrefix = "";
	if (propertiesOption === "flatten") propertyPrefix = "";
	else if (propertiesOption.startsWith(prependPrefix)) {
		propertyPrefix = propertiesOption.substring(prependPrefix.length);
		if (propertyPrefix === "") throw new TypeError("Invalid properties option: " + JSON.stringify(propertiesOption) + ". It must be of the form \"prepend:<prefix>\" where <prefix> is a non-empty string.");
	} else throw new TypeError(`Invalid properties option: ${JSON.stringify(propertiesOption)}. It must be "flatten" or "prepend:<prefix>".`);
	return (record) => {
		const pairs = [];
		pushLogfmtPair(pairs, "time", timestampRenderer(record.timestamp));
		pushLogfmtPair(pairs, "level", record.level);
		pushLogfmtPair(pairs, "logger", joinCategory(record.category));
		pushLogfmtPair(pairs, "msg", renderStructuredMessage(record, isTemplateMessage));
		for (const key in record.properties) if (Object.prototype.hasOwnProperty.call(record.properties, key)) pushLogfmtPair(pairs, `${propertyPrefix}${key}`, record.properties[key]);
		return `${pairs.join(" ")}${lineEnding}`;
	};
}
/**
* The default [logfmt] formatter.  This formatter formats log records as
* space-delimited key-value pairs, one record per line.
*
* [logfmt]: https://brandur.org/logfmt
* @since 2.1.0
*/
const logfmtFormatter = getLogfmtFormatter();
/**
* The styles for the log level in the console.
*/
const logLevelStyles = {
	"trace": "background-color: gray; color: white;",
	"debug": "background-color: gray; color: white;",
	"info": "background-color: white; color: black;",
	"warning": "background-color: orange; color: black;",
	"error": "background-color: red; color: white;",
	"fatal": "background-color: maroon; color: white;"
};
/**
* The default console formatter.
*
* @param record The log record to format.
* @returns The formatted log record, as an array of arguments for
*          {@link console.log}.
*/
function defaultConsoleFormatter(record) {
	let msg = "";
	const values = [];
	for (let i = 0; i < record.message.length; i++) if (i % 2 === 0) msg += record.message[i];
	else {
		msg += "%o";
		values.push(record.message[i]);
	}
	const date = new Date(record.timestamp);
	const time = `${date.getUTCHours().toString().padStart(2, "0")}:${date.getUTCMinutes().toString().padStart(2, "0")}:${date.getUTCSeconds().toString().padStart(2, "0")}.${date.getUTCMilliseconds().toString().padStart(3, "0")}`;
	return [
		`%c${time} %c${levelAbbreviations[record.level]}%c %c${record.category.join("·")} %c${msg}`,
		"color: gray;",
		logLevelStyles[record.level],
		"background-color: default;",
		"color: gray;",
		"color: default;",
		...values
	];
}

//#endregion
export { ansiColorFormatter, defaultConsoleFormatter, defaultTextFormatter, getAnsiColorFormatter, getJsonLinesFormatter, getLogfmtFormatter, getTextFormatter, jsonLinesFormatter, logfmtFormatter };
//# sourceMappingURL=formatter.js.map