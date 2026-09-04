const require_wcwidth = require('./wcwidth.cjs');

//#region src/wordwrap.ts
/**
* Wrap text at specified width with proper indentation for continuation lines.
* Automatically detects the message start position from the first line.
*
* @param text The text to wrap (may contain ANSI escape codes)
* @param maxWidth Maximum width in terminal columns
* @param indentWidth Indentation width for continuation lines
* @returns Wrapped text with proper indentation
*/
function wrapText(text, maxWidth, indentWidth) {
	if (maxWidth <= 0) return text;
	const displayWidth = require_wcwidth.getDisplayWidth(text);
	if (displayWidth <= maxWidth && !text.includes("\n")) return text;
	const indent = " ".repeat(Math.max(0, indentWidth));
	if (text.includes("\n")) {
		const lines = text.split("\n");
		const wrappedLines = [];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineDisplayWidth = require_wcwidth.getDisplayWidth(line);
			if (lineDisplayWidth <= maxWidth) if (i === 0) wrappedLines.push(line);
			else wrappedLines.push(indent + line);
			else {
				const wrappedLine = wrapSingleLine(line, maxWidth, indent);
				if (i === 0) wrappedLines.push(wrappedLine);
				else {
					const subLines = wrappedLine.split("\n");
					for (let j = 0; j < subLines.length; j++) if (j === 0) wrappedLines.push(indent + subLines[j]);
					else wrappedLines.push(subLines[j]);
				}
			}
		}
		return wrappedLines.join("\n");
	}
	return wrapSingleLine(text, maxWidth, indent);
}
/**
* Wrap a single line of text (without existing newlines) at word boundaries.
* Preserves ANSI escape codes and handles Unicode character widths correctly.
*
* @param text The text to wrap (single line, may contain ANSI codes)
* @param maxWidth Maximum width in terminal columns
* @param indent Indentation string for continuation lines
* @returns Wrapped text with newlines and proper indentation
*/
function wrapSingleLine(text, maxWidth, indent) {
	const lines = [];
	let currentLine = "";
	let currentDisplayWidth = 0;
	let i = 0;
	while (i < text.length) {
		if (text[i] === "\x1B" && text[i + 1] === "[") {
			let j = i + 2;
			while (j < text.length && text[j] !== "m") j++;
			if (j < text.length) {
				j++;
				currentLine += text.slice(i, j);
				i = j;
				continue;
			}
		}
		const char = text[i];
		if (currentDisplayWidth >= maxWidth && char !== " ") {
			const breakPoint = currentLine.lastIndexOf(" ");
			if (breakPoint > 0) {
				lines.push(currentLine.slice(0, breakPoint));
				currentLine = indent + currentLine.slice(breakPoint + 1) + char;
				currentDisplayWidth = require_wcwidth.getDisplayWidth(currentLine);
			} else {
				lines.push(currentLine);
				currentLine = indent + char;
				currentDisplayWidth = require_wcwidth.getDisplayWidth(currentLine);
			}
		} else {
			currentLine += char;
			currentDisplayWidth = require_wcwidth.getDisplayWidth(currentLine);
		}
		i++;
	}
	if (currentLine.trim()) lines.push(currentLine);
	const filteredLines = lines.filter((line) => line.trim().length > 0);
	return filteredLines.join("\n");
}

//#endregion
exports.wrapText = wrapText;