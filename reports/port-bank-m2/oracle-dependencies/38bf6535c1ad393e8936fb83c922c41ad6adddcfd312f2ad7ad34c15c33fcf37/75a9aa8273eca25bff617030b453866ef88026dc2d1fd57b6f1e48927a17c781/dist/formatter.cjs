const require_rolldown_runtime = require('./_virtual/rolldown_runtime.cjs');
const require_terminal = require('./terminal.cjs');
const require_truncate = require('./truncate.cjs');
const require_wcwidth = require('./wcwidth.cjs');
const require_wordwrap = require('./wordwrap.cjs');
const __logtape_logtape = require_rolldown_runtime.__toESM(require("@logtape/logtape"));
const __util = require_rolldown_runtime.__toESM(require("#util"));

//#region src/formatter.ts
/**
* ANSI escape codes for styling
*/
const RESET = "\x1B[0m";
const DIM = "\x1B[2m";
const defaultColors = {
	trace: "rgb(167,139,250)",
	debug: "rgb(96,165,250)",
	info: "rgb(52,211,153)",
	warning: "rgb(251,191,36)",
	error: "rgb(248,113,113)",
	fatal: "rgb(220,38,38)",
	category: "rgb(100,116,139)",
	message: "rgb(148,163,184)",
	timestamp: "rgb(100,116,139)"
};
/**
* ANSI style codes
*/
const styles = {
	reset: RESET,
	bold: "\x1B[1m",
	dim: DIM,
	italic: "\x1B[3m",
	underline: "\x1B[4m",
	strikethrough: "\x1B[9m"
};
/**
* Standard ANSI colors (16-color)
*/
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
const RGB_PATTERN = /^rgb\((\d+),(\d+),(\d+)\)$/;
const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FIXED_OFFSET_PATTERN = /^([+-])(0\d|1\d|2[0-3]):([0-5]\d)$/;
/**
* Helper function to convert color to ANSI escape code
*/
function colorToAnsi(color) {
	if (color === null) return "";
	if (color in ansiColors) return ansiColors[color];
	const rgbMatch = color.match(RGB_PATTERN);
	if (rgbMatch) {
		const [, r, g, b] = rgbMatch;
		return `\x1b[38;2;${r};${g};${b}m`;
	}
	const hexMatch = color.match(HEX_PATTERN);
	if (hexMatch) {
		let hex = hexMatch[1];
		if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
		const r = parseInt(hex.substr(0, 2), 16);
		const g = parseInt(hex.substr(2, 2), 16);
		const b = parseInt(hex.substr(4, 2), 16);
		return `\x1b[38;2;${r};${g};${b}m`;
	}
	return "";
}
/**
* Helper function to convert style to ANSI escape code
*/
function styleToAnsi(style) {
	if (style === null) return "";
	if (Array.isArray(style)) return style.map((s) => styles[s] || "").join("");
	return styles[style] || "";
}
/**
* Converts a category color map to internal patterns and sorts them by specificity.
* More specific (longer) prefixes come first for proper matching precedence.
*/
function prepareCategoryPatterns(categoryColorMap) {
	const patterns = [];
	for (const [prefix, color] of categoryColorMap) patterns.push({
		prefix,
		color
	});
	return patterns.sort((a, b) => b.prefix.length - a.prefix.length);
}
/**
* Matches a category against category color patterns.
* Returns the color of the first matching pattern, or null if no match.
*/
function matchCategoryColor(category, patterns) {
	for (const pattern of patterns) if (categoryMatches(category, pattern.prefix)) return pattern.color;
	return null;
}
/**
* Checks if a category matches a prefix pattern.
* A category matches if it starts with all segments of the prefix.
*/
function categoryMatches(category, prefix) {
	if (prefix.length > category.length) return false;
	for (let i = 0; i < prefix.length; i++) if (category[i] !== prefix[i]) return false;
	return true;
}
function pad2(value) {
	return value < 10 ? `0${value}` : `${value}`;
}
function pad3(value) {
	return value < 10 ? `00${value}` : value < 100 ? `0${value}` : `${value}`;
}
function formatOffset(minutes, full) {
	const sign = minutes < 0 ? "-" : "+";
	const absolute = Math.abs(minutes);
	const hour = pad2(Math.floor(absolute / 60));
	const minute = pad2(absolute % 60);
	if (!full && minute === "00") return `${sign}${hour}`;
	return `${sign}${hour}:${minute}`;
}
function resolveTimeZone(timeZone) {
	if (typeof timeZone === "undefined") return { kind: "utc" };
	if (timeZone === null) return { kind: "local" };
	const offsetMatch = FIXED_OFFSET_PATTERN.exec(timeZone);
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
	const ms = pad3(d.getUTCMilliseconds());
	if (config.kind === "utc") return {
		year: `${d.getUTCFullYear()}`,
		month: pad2(d.getUTCMonth() + 1),
		day: pad2(d.getUTCDate()),
		hour: pad2(d.getUTCHours()),
		minute: pad2(d.getUTCMinutes()),
		second: pad2(d.getUTCSeconds()),
		ms,
		offsetMinutes: 0
	};
	if (config.kind === "local") return {
		year: `${d.getFullYear()}`,
		month: pad2(d.getMonth() + 1),
		day: pad2(d.getDate()),
		hour: pad2(d.getHours()),
		minute: pad2(d.getMinutes()),
		second: pad2(d.getSeconds()),
		ms,
		offsetMinutes: -d.getTimezoneOffset()
	};
	if (config.kind === "offset") {
		const shifted = new Date(ts + config.minutes * 6e4);
		return {
			year: `${shifted.getUTCFullYear()}`,
			month: pad2(shifted.getUTCMonth() + 1),
			day: pad2(shifted.getUTCDate()),
			hour: pad2(shifted.getUTCHours()),
			minute: pad2(shifted.getUTCMinutes()),
			second: pad2(shifted.getUTCSeconds()),
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
/**
* Default icons for each log level
*/
const defaultIcons = {
	trace: "🔍",
	debug: "🐛",
	info: "✨",
	warning: "⚡",
	error: "❌",
	fatal: "💀"
};
/**
* Normalize icon spacing to ensure consistent column alignment.
*
* All icons will be padded with spaces to match the width of the widest icon,
* ensuring consistent prefix alignment across all log levels.
*
* @param iconMap The icon mapping to normalize
* @returns A new icon map with consistent spacing
*/
function normalizeIconSpacing(iconMap) {
	const entries = Object.entries(iconMap);
	const maxWidth = Math.max(...entries.map(([, icon]) => require_wcwidth.getDisplayWidth(icon)));
	return Object.fromEntries(entries.map(([level, icon]) => [level, icon + " ".repeat(maxWidth - require_wcwidth.getDisplayWidth(icon))]));
}
/**
* Creates a beautiful console formatter optimized for local development.
*
* This formatter provides a Signale-inspired visual design with colorful icons,
* smart category truncation, dimmed styling, and perfect column alignment.
* It's specifically designed for development environments that support true colors
* and Unicode characters.
*
* The formatter features:
* - Emoji icons for each log level (🔍 trace, 🐛 debug, ✨ info, etc.)
* - True color support with rich color schemes
* - Intelligent category truncation for long hierarchical categories
* - Optional timestamp display with multiple formats
* - Configurable alignment and styling options
* - Enhanced value rendering with syntax highlighting
*
* @param options Configuration options for customizing the formatter behavior.
* @returns A text formatter function that can be used with LogTape sinks.
*
* @example
* ```typescript
* import { configure } from "@logtape/logtape";
* import { getConsoleSink } from "@logtape/logtape/sink";
* import { getPrettyFormatter } from "@logtape/pretty";
*
* await configure({
*   sinks: {
*     console: getConsoleSink({
*       formatter: getPrettyFormatter({
*         timestamp: "time",
*         categoryWidth: 25,
*         icons: {
*           info: "📘",
*           error: "🔥"
*         }
*       })
*     })
*   }
* });
* ```
*
* @since 1.0.0
*/
function getPrettyFormatter(options = {}) {
	const { timestamp = "none", timeZone, timestampColor = "rgb(100,116,139)", timestampStyle = "dim", level: levelFormat = "full", levelColors = {}, levelStyle = "underline", icons = true, categorySeparator = "·", categoryColor = "rgb(100,116,139)", categoryColorMap = /* @__PURE__ */ new Map(), categoryStyle = ["dim", "italic"], categoryWidth = 20, categoryTruncate = "middle", messageColor = "rgb(148,163,184)", messageStyle = "dim", colors: useColors = true, align = true, inspectOptions = {}, properties = false, wordWrap = true } = options;
	const baseIconMap = icons === false ? {
		trace: "",
		debug: "",
		info: "",
		warning: "",
		error: "",
		fatal: ""
	} : icons === true ? defaultIcons : {
		...defaultIcons,
		...icons
	};
	const iconMap = normalizeIconSpacing(baseIconMap);
	const resolvedLevelColors = {
		trace: defaultColors.trace,
		debug: defaultColors.debug,
		info: defaultColors.info,
		warning: defaultColors.warning,
		error: defaultColors.error,
		fatal: defaultColors.fatal,
		...levelColors
	};
	const levelMappings = {
		"ABBR": {
			trace: "TRC",
			debug: "DBG",
			info: "INF",
			warning: "WRN",
			error: "ERR",
			fatal: "FTL"
		},
		"L": {
			trace: "T",
			debug: "D",
			info: "I",
			warning: "W",
			error: "E",
			fatal: "F"
		},
		"abbr": {
			trace: "trc",
			debug: "dbg",
			info: "inf",
			warning: "wrn",
			error: "err",
			fatal: "ftl"
		},
		"l": {
			trace: "t",
			debug: "d",
			info: "i",
			warning: "w",
			error: "e",
			fatal: "f"
		}
	};
	const formatLevel = (level) => {
		if (typeof levelFormat === "function") return levelFormat(level);
		if (levelFormat === "FULL") return level.toUpperCase();
		if (levelFormat === "full") return level;
		return levelMappings[levelFormat]?.[level] ?? level;
	};
	const resolvedTimeZone = resolveTimeZone(timeZone);
	let timestampFn = null;
	if (timestamp === "none" || timestamp === "disabled") timestampFn = null;
	else if (typeof timestamp === "function") timestampFn = timestamp;
	else timestampFn = (ts) => {
		if (timestamp === "rfc3339" && resolvedTimeZone.kind === "utc") return new Date(ts).toISOString();
		const parts = getDateParts(ts, resolvedTimeZone);
		const date = `${parts.year}-${parts.month}-${parts.day}`;
		const time = `${parts.hour}:${parts.minute}:${parts.second}.${parts.ms}`;
		const tzLong = formatOffset(parts.offsetMinutes, true);
		const tzShort = formatOffset(parts.offsetMinutes, false);
		if (timestamp === "date-time-timezone") return `${date} ${time} ${tzLong}`;
		if (timestamp === "date-time-tz") return `${date} ${time} ${tzShort}`;
		if (timestamp === "date-time") return `${date} ${time}`;
		if (timestamp === "time-timezone") return `${time} ${tzLong}`;
		if (timestamp === "time-tz") return `${time} ${tzShort}`;
		if (timestamp === "time") return time;
		if (timestamp === "date") return date;
		return `${date}T${time}${tzLong}`;
	};
	const wordWrapEnabled = wordWrap !== false;
	let wordWrapWidth;
	if (typeof wordWrap === "number") wordWrapWidth = wordWrap;
	else if (wordWrap === true) wordWrapWidth = require_terminal.getOptimalWordWrapWidth(80);
	else wordWrapWidth = 80;
	const categoryPatterns = prepareCategoryPatterns(categoryColorMap);
	const allLevels = [...(0, __logtape_logtape.getLogLevels)()];
	const levelWidth = Math.max(...allLevels.map((l) => formatLevel(l).length));
	return (record) => {
		const icon = iconMap[record.level] || "";
		const level = formatLevel(record.level);
		const categoryStr = require_truncate.truncateCategory(record.category, categoryWidth, categorySeparator, categoryTruncate);
		let message = "";
		const messageColorCode = useColors ? colorToAnsi(messageColor) : "";
		const messageStyleCode = useColors ? styleToAnsi(messageStyle) : "";
		const messagePrefix = useColors ? `${messageStyleCode}${messageColorCode}` : "";
		for (let i = 0; i < record.message.length; i++) if (i % 2 === 0) message += record.message[i];
		else {
			const value = record.message[i];
			const inspected = (0, __util.inspect)(value, {
				colors: useColors,
				...inspectOptions
			});
			if (inspected.includes("\n")) {
				const lines = inspected.split("\n");
				const formattedLines = lines.map((line, index) => {
					if (index === 0) if (useColors && (messageColorCode || messageStyleCode)) return `${RESET}${line}${messagePrefix}`;
					else return line;
					else if (useColors && (messageColorCode || messageStyleCode)) return `${line}${messagePrefix}`;
					else return line;
				});
				message += formattedLines.join("\n");
			} else if (useColors && (messageColorCode || messageStyleCode)) message += `${RESET}${inspected}${messagePrefix}`;
			else message += inspected;
		}
		const finalCategoryColor = useColors ? matchCategoryColor(record.category, categoryPatterns) || categoryColor : null;
		const formattedIcon = icon;
		let formattedLevel = level;
		let formattedCategory = categoryStr;
		let formattedMessage = message;
		let formattedTimestamp = "";
		if (useColors) {
			const levelColorCode = colorToAnsi(resolvedLevelColors[record.level]);
			const levelStyleCode = styleToAnsi(levelStyle);
			formattedLevel = `${levelStyleCode}${levelColorCode}${level}${RESET}`;
			const categoryColorCode = colorToAnsi(finalCategoryColor);
			const categoryStyleCode = styleToAnsi(categoryStyle);
			formattedCategory = `${categoryStyleCode}${categoryColorCode}${categoryStr}${RESET}`;
			formattedMessage = `${messagePrefix}${message}${RESET}`;
		}
		if (timestampFn) {
			const ts = timestampFn(record.timestamp);
			if (ts !== null) if (useColors) {
				const timestampColorCode = colorToAnsi(timestampColor);
				const timestampStyleCode = styleToAnsi(timestampStyle);
				formattedTimestamp = `${timestampStyleCode}${timestampColorCode}${ts}${RESET}  `;
			} else formattedTimestamp = `${ts}  `;
		}
		if (align) {
			const levelColorLength = useColors ? colorToAnsi(resolvedLevelColors[record.level]).length + styleToAnsi(levelStyle).length + RESET.length : 0;
			const categoryColorLength = useColors ? colorToAnsi(finalCategoryColor).length + styleToAnsi(categoryStyle).length + RESET.length : 0;
			const paddedLevel = formattedLevel.padEnd(levelWidth + levelColorLength);
			const paddedCategory = formattedCategory.padEnd(categoryWidth + categoryColorLength);
			let result = `${formattedTimestamp}${formattedIcon} ${paddedLevel} ${paddedCategory} ${formattedMessage}`;
			const indentWidth = require_wcwidth.getDisplayWidth(require_wcwidth.stripAnsi(`${formattedTimestamp}${formattedIcon} ${paddedLevel} ${paddedCategory} `));
			if (wordWrapEnabled || message.includes("\n")) result = require_wordwrap.wrapText(result, wordWrapEnabled ? wordWrapWidth : Infinity, indentWidth);
			if (properties) result += formatProperties(record, indentWidth, wordWrapEnabled ? wordWrapWidth : Infinity, useColors, inspectOptions);
			return result + "\n";
		} else {
			let result = `${formattedTimestamp}${formattedIcon} ${formattedLevel} ${formattedCategory} ${formattedMessage}`;
			const indentWidth = require_wcwidth.getDisplayWidth(require_wcwidth.stripAnsi(`${formattedTimestamp}${formattedIcon} ${formattedLevel} ${formattedCategory} `));
			if (wordWrapEnabled || message.includes("\n")) result = require_wordwrap.wrapText(result, wordWrapEnabled ? wordWrapWidth : Infinity, indentWidth);
			if (properties) result += formatProperties(record, indentWidth, wordWrapEnabled ? wordWrapWidth : Infinity, useColors, inspectOptions);
			return result + "\n";
		}
	};
}
function formatProperties(record, indentWidth, maxWidth, useColors, inspectOptions) {
	let result = "";
	for (const prop in record.properties) {
		const propValue = record.properties[prop];
		const pad = Math.max(0, indentWidth - require_wcwidth.getDisplayWidth(prop) - 2);
		result += "\n" + require_wordwrap.wrapText(`${" ".repeat(pad)}${useColors ? DIM : ""}${prop}:${useColors ? RESET : ""} ${(0, __util.inspect)(propValue, {
			colors: useColors,
			...inspectOptions
		})}`, maxWidth, indentWidth);
	}
	return result;
}
/**
* A pre-configured beautiful console formatter for local development.
*
* This is a ready-to-use instance of the pretty formatter with sensible defaults
* for most development scenarios. It provides immediate visual enhancement to
* your logs without requiring any configuration.
*
* Features enabled by default:
* - Emoji icons for all log levels
* - True color support with rich color schemes
* - Dimmed text styling for better readability
* - Smart category truncation (20 characters max)
* - Perfect column alignment
* - No timestamp display (cleaner for development)
*
* For custom configuration, use {@link getPrettyFormatter} instead.
*
* @example
* ```typescript
* import { configure } from "@logtape/logtape";
* import { getConsoleSink } from "@logtape/logtape/sink";
* import { prettyFormatter } from "@logtape/pretty";
*
* await configure({
*   sinks: {
*     console: getConsoleSink({
*       formatter: prettyFormatter
*     })
*   }
* });
* ```
*
* @since 1.0.0
*/
const prettyFormatter = getPrettyFormatter();

//#endregion
exports.getPrettyFormatter = getPrettyFormatter;
exports.prettyFormatter = prettyFormatter;