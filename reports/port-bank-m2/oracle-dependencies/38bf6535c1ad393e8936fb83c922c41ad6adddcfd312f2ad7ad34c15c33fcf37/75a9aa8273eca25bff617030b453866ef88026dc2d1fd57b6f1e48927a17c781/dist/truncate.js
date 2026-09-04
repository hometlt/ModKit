//#region src/truncate.ts
/**
* Truncates a category array to fit within a maximum width using the specified strategy.
*
* This function intelligently shortens long hierarchical category names while
* preserving important context. The truncation behavior depends on the chosen
* strategy:
*
* - `"middle"`: Keeps the first and last segments with "…" in between
* - `"end"`: Truncates at the end with "…" suffix
* - `false`: No truncation (returns full category string)
*
* When the category is too long even for middle truncation (first + "…" + last
* exceeds maxWidth), it falls back to end truncation.
*
* @param category The category segments to truncate.
* @param maxWidth Maximum width for the category string.
* @param separator Category separator (default: ".").
* @param strategy Truncation strategy to use (default: "middle").
* @returns The truncated category string.
*
* @example
* ```typescript
* // Middle truncation
* truncateCategory(["app", "server", "http", "auth"], 15, ".", "middle");
* // Returns: "app…auth"
*
* // End truncation
* truncateCategory(["app", "server", "http", "auth"], 15, ".", "end");
* // Returns: "app.server.h…"
*
* // No truncation
* truncateCategory(["app", "auth"], 20, ".", false);
* // Returns: "app.auth"
* ```
*
* @since 1.0.0
*/
function truncateCategory(category, maxWidth, separator = ".", strategy = "middle") {
	if (!strategy || maxWidth <= 0) return category.join(separator);
	const full = category.join(separator);
	if (full.length <= maxWidth) return full;
	const minWidth = 5;
	if (maxWidth < minWidth) return "…";
	if (strategy === "end") return full.substring(0, maxWidth - 1) + "…";
	if (category.length <= 2) return full.substring(0, maxWidth - 1) + "…";
	const first = category[0];
	const last = category[category.length - 1];
	const ellipsis = "…";
	const minimalLength = first.length + ellipsis.length + last.length;
	if (minimalLength > maxWidth) return full.substring(0, maxWidth - 1) + "…";
	return `${first}${ellipsis}${last}`;
}

//#endregion
export { truncateCategory };
//# sourceMappingURL=truncate.js.map