//#region src/truncate.d.ts
/**
 * Truncation strategies for category names.
 *
 * @since 1.0.0
 */
type TruncationStrategy = "middle" | "end" | false;
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
//#endregion
export { TruncationStrategy };
//# sourceMappingURL=truncate.d.ts.map