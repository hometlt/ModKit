
//#region src/terminal.ts
/**
* @fileoverview
* Terminal detection and width calculation utilities
*
* Provides cross-runtime compatible functions to detect if the process
* is attached to a terminal and get the terminal width.
*/
/**
* Detect if the current process is attached to a terminal (TTY).
*
* @returns True if stdout is connected to a terminal
*/
function isTerminal() {
	try {
		if (typeof Deno !== "undefined") {
			if (Deno.stdout.isTerminal) return Deno.stdout.isTerminal();
		}
		if (typeof process !== "undefined" && process.stdout) return Boolean(process.stdout.isTTY);
		if (typeof window !== "undefined") return false;
		return false;
	} catch {
		return false;
	}
}
/**
* Get the current terminal width in columns.
*
* @returns Terminal width in columns, or null if not available
*/
function getTerminalWidth() {
	try {
		if (typeof Deno !== "undefined") {
			if (Deno.consoleSize) {
				const size = Deno.consoleSize();
				return size?.columns || null;
			}
		}
		if (typeof process !== "undefined" && process.stdout) return process.stdout.columns || null;
		const envColumns = typeof Deno !== "undefined" ? Deno.env.get("COLUMNS") : process?.env?.COLUMNS;
		if (envColumns) {
			const parsed = parseInt(envColumns, 10);
			return isNaN(parsed) ? null : parsed;
		}
		return null;
	} catch {
		return null;
	}
}
/**
* Get the optimal word wrap width based on terminal detection.
*
* @param defaultWidth Default width to use when not in a terminal
* @returns The optimal width
*/
function getOptimalWordWrapWidth(defaultWidth = 80) {
	if (!isTerminal()) return defaultWidth;
	const terminalWidth = getTerminalWidth();
	return terminalWidth || defaultWidth;
}

//#endregion
exports.getOptimalWordWrapWidth = getOptimalWordWrapWidth;