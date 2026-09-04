import { TruncationStrategy } from "./truncate.cjs";
import { LogLevel, TextFormatter, TextFormatterOptions } from "@logtape/logtape";

//#region src/formatter.d.ts

/**
 * ANSI style codes
 */
declare const styles: {
  readonly reset: "\u001B[0m";
  readonly bold: "\u001B[1m";
  readonly dim: "\u001B[2m";
  readonly italic: "\u001B[3m";
  readonly underline: "\u001B[4m";
  readonly strikethrough: "\u001B[9m";
};
/**
 * Standard ANSI colors (16-color)
 */
declare const ansiColors: {
  readonly black: "\u001B[30m";
  readonly red: "\u001B[31m";
  readonly green: "\u001B[32m";
  readonly yellow: "\u001B[33m";
  readonly blue: "\u001B[34m";
  readonly magenta: "\u001B[35m";
  readonly cyan: "\u001B[36m";
  readonly white: "\u001B[37m";
};
/**
 * Color type definition
 */
type Color = keyof typeof ansiColors | `rgb(${number},${number},${number})` | `#${string}` | null;
/**
 * Category color mapping for prefix-based coloring.
 *
 * Maps category prefixes (as arrays) to colors. The formatter will match
 * categories against these prefixes and use the corresponding color.
 * Longer/more specific prefixes take precedence over shorter ones.
 *
 * @example
 * ```typescript
 * new Map([
 *   [["app", "auth"], "#ff6b6b"],     // app.auth.* -> red
 *   [["app", "db"], "#4ecdc4"],       // app.db.* -> teal
 *   [["app"], "#45b7d1"],             // app.* (fallback) -> blue
 *   [["lib"], "#96ceb4"],             // lib.* -> green
 * ])
 * ```
 */
type CategoryColorMap = Map<readonly string[], Color>;
/**
 * Style type definition - supports single styles, arrays of styles, or null
 */
type Style = keyof typeof styles | (keyof typeof styles)[] | null;
/**
 * Configuration options for the pretty formatter.
 *
 * This interface extends the base text formatter options while providing
 * extensive customization options for visual styling, layout control, and
 * development-focused features. It offers granular control over colors,
 * styles, and formatting similar to the ANSI color formatter.
 *
 * @since 1.0.0
 */
interface PrettyFormatterOptions extends Omit<TextFormatterOptions, "category" | "value" | "format"> {
  /**
   * Color for timestamp display when timestamps are enabled.
   *
   * Supports true color RGB values, hex colors, or ANSI color names.
   * Set to `null` to disable timestamp coloring.
   *
   * @example
   * ```typescript
   * timestampColor: "#888888"        // Hex color
   * timestampColor: "rgb(128,128,128)" // RGB color
   * timestampColor: "cyan"           // ANSI color name
   * timestampColor: null             // No color
   * ```
   *
   * @default `"rgb(100,116,139)"` (slate gray)
   */
  readonly timestampColor?: Color;
  /**
   * Visual style applied to timestamp text.
   *
   * Controls text appearance like boldness, dimming, etc.
   * Supports single styles, multiple styles combined, or no styling.
   * Combines with `timestampColor` for full styling control.
   *
   * @example
   * ```typescript
   * timestampStyle: "dim"                    // Single style: dimmed text
   * timestampStyle: "bold"                   // Single style: bold text
   * timestampStyle: ["bold", "underline"]    // Multiple styles: bold + underlined
   * timestampStyle: ["dim", "italic"]        // Multiple styles: dimmed + italic
   * timestampStyle: null                     // No styling
   * ```
   *
   * @default `"dim"`
   */
  readonly timestampStyle?: Style;
  /**
   * Custom colors for each log level.
   *
   * Allows fine-grained control over level appearance. Each level can have
   * its own color scheme. Unspecified levels use built-in defaults.
   * Set individual levels to `null` to disable coloring for that level.
   *
   * @example
   * ```typescript
   * levelColors: {
   *   info: "#00ff00",     // Bright green for info
   *   error: "#ff0000",    // Bright red for errors
   *   warning: "orange",   // ANSI orange for warnings
   *   debug: null,         // No color for debug
   * }
   * ```
   *
   * @default Built-in color scheme (purple trace, blue debug, green info, amber warning, red error, dark red fatal)
   */
  readonly levelColors?: Partial<Record<LogLevel, Color>>;
  /**
   * Visual style applied to log level text.
   *
   * Controls the appearance of the level indicator (e.g., "info", "error").
   * Supports single styles, multiple styles combined, or no styling.
   * Applied in addition to level-specific colors.
   *
   * @example
   * ```typescript
   * levelStyle: "bold"                    // Single style: bold level text
   * levelStyle: "underline"               // Single style: underlined level text
   * levelStyle: ["bold", "underline"]     // Multiple styles: bold + underlined
   * levelStyle: ["dim", "italic"]         // Multiple styles: dimmed + italic
   * levelStyle: null                      // No additional styling
   * ```
   *
   * @default `"underline"`
   */
  readonly levelStyle?: Style;
  /**
   * Icon configuration for each log level.
   *
   * Controls the emoji/symbol displayed before each log entry.
   * Provides visual quick-identification of log severity.
   *
   * - `true`: Use built-in emoji set (🔍 trace, 🐛 debug, ✨ info, ⚠️ warning, ❌ error, 💀 fatal)
   * - `false`: Disable all icons for clean text-only output
   * - Object: Custom icon mapping, falls back to defaults for unspecified levels
   *
   * @example
   * ```typescript
   * icons: true                    // Use default emoji set
   * icons: false                   // No icons
   * icons: {
   *   info: "ℹ️",                  // Custom info icon
   *   error: "🔥",                 // Custom error icon
   *   warning: "⚡",               // Custom warning icon
   * }
   * ```
   *
   * @default `true` (use default emoji icons)
   */
  readonly icons?: boolean | Partial<Record<LogLevel, string>>;
  /**
   * Character(s) used to separate category hierarchy levels.
   *
   * Categories are hierarchical (e.g., ["app", "auth", "jwt"]) and this
   * separator joins them for display (e.g., "app.auth.jwt").
   *
   * @example
   * ```typescript
   * categorySeparator: "·"        // app·auth·jwt
   * categorySeparator: "."        // app.auth.jwt
   * categorySeparator: ":"        // app:auth:jwt
   * categorySeparator: " > "      // app > auth > jwt
   * categorySeparator: "::"       // app::auth::jwt
   * ```
   *
   * @default `"·"` (interpunct)
   */
  readonly categorySeparator?: string;
  /**
   * Default color for category display.
   *
   * Used as fallback when no specific color is found in `categoryColorMap`.
   * Controls the visual appearance of the category hierarchy display.
   *
   * @example
   * ```typescript
   * categoryColor: "#666666"        // Gray categories
   * categoryColor: "blue"           // Blue categories
   * categoryColor: "rgb(100,150,200)" // Light blue categories
   * categoryColor: null             // No coloring
   * ```
   *
   * @default `"rgb(100,116,139)"` (slate gray)
   */
  readonly categoryColor?: Color;
  /**
   * Category-specific color mapping based on prefixes.
   *
   * Maps category prefixes (as arrays) to colors for visual grouping.
   * More specific (longer) prefixes take precedence over shorter ones.
   * If no prefix matches, falls back to the default `categoryColor`.
   *
   * @example
   * ```typescript
   * new Map([
   *   [["app", "auth"], "#ff6b6b"],     // app.auth.* -> red
   *   [["app", "db"], "#4ecdc4"],       // app.db.* -> teal
   *   [["app"], "#45b7d1"],             // app.* (fallback) -> blue
   *   [["lib"], "#96ceb4"],             // lib.* -> green
   * ])
   * ```
   */
  readonly categoryColorMap?: CategoryColorMap;
  /**
   * Visual style applied to category text.
   *
   * Controls the appearance of the category hierarchy display.
   * Supports single styles, multiple styles combined, or no styling.
   * Applied in addition to category colors from `categoryColor` or `categoryColorMap`.
   *
   * @example
   * ```typescript
   * categoryStyle: "dim"                     // Single style: dimmed category text
   * categoryStyle: "italic"                  // Single style: italic category text
   * categoryStyle: ["dim", "italic"]         // Multiple styles: dimmed + italic
   * categoryStyle: ["bold", "underline"]     // Multiple styles: bold + underlined
   * categoryStyle: null                      // No additional styling
   * ```
   *
   * @default `["dim", "italic"]` (dimmed for subtle appearance)
   */
  readonly categoryStyle?: Style;
  /**
   * Maximum display width for category names.
   *
   * Controls layout consistency by limiting category width.
   * Long categories are truncated according to `categoryTruncate` strategy.
   *
   * @default `20`
   */
  readonly categoryWidth?: number;
  /**
   * Strategy for truncating long category names.
   *
   * When categories exceed `categoryWidth`, this controls how truncation works.
   * Smart truncation preserves important context while maintaining layout.
   *
   * - `"middle"`: Keep first and last parts (e.g., "app.server…auth.jwt")
   * - `"end"`: Truncate at the end (e.g., "app.server.middleware…")
   * - `false`: No truncation (ignores `categoryWidth`)
   *
   * @example
   * ```typescript
   * categoryTruncate: "middle"   // app.server…jwt (preserves context)
   * categoryTruncate: "end"      // app.server.midd… (linear truncation)
   * categoryTruncate: false      // app.server.middleware.auth.jwt (full)
   * ```
   *
   * @default `"middle"` (smart context-preserving truncation)
   */
  readonly categoryTruncate?: TruncationStrategy;
  /**
   * Color for log message text content.
   *
   * Controls the visual appearance of the actual log message content.
   * Does not affect structured values, which use syntax highlighting.
   *
   * @example
   * ```typescript
   * messageColor: "#ffffff"        // White message text
   * messageColor: "green"          // Green message text
   * messageColor: "rgb(200,200,200)" // Light gray message text
   * messageColor: null             // No coloring
   * ```
   *
   * @default `"rgb(148,163,184)"` (light slate gray)
   */
  readonly messageColor?: Color;
  /**
   * Visual style applied to log message text.
   *
   * Controls the appearance of the log message content.
   * Supports single styles, multiple styles combined, or no styling.
   * Applied in addition to `messageColor`.
   *
   * @example
   * ```typescript
   * messageStyle: "dim"                      // Single style: dimmed message text
   * messageStyle: "italic"                   // Single style: italic message text
   * messageStyle: ["dim", "italic"]          // Multiple styles: dimmed + italic
   * messageStyle: ["bold", "underline"]      // Multiple styles: bold + underlined
   * messageStyle: null                       // No additional styling
   * ```
   *
   * @default `"dim"` (dimmed for subtle readability)
   */
  readonly messageStyle?: Style;
  /**
   * Global color control for the entire formatter.
   *
   * Master switch to enable/disable all color output.
   * When disabled, produces clean monochrome output suitable for
   * non-color terminals or when colors are not desired.
   *
   * @example
   * ```typescript
   * colors: true     // Full color output (default)
   * colors: false    // Monochrome output only
   * ```
   *
   * @default `true` (colors enabled)
   */
  readonly colors?: boolean;
  /**
   * Column alignment for consistent visual layout.
   *
   * When enabled, ensures all log components (icons, levels, categories)
   * align consistently across multiple log entries, creating a clean
   * tabular appearance.
   *
   * @example
   * ```typescript
   * align: true      // Aligned columns (default)
   * align: false     // Compact, non-aligned output
   * ```
   *
   * @default `true` (alignment enabled)
   */
  readonly align?: boolean;
  /**
   * Configuration for structured value inspection and rendering.
   *
   * Controls how objects, arrays, and other complex values are displayed
   * within log messages. Uses Node.js `util.inspect()` style options.
   *
   * @example
   * ```typescript
   * inspectOptions: {
   *   depth: 3,         // Show 3 levels of nesting
   *   colors: false,    // Disable value syntax highlighting
   *   compact: true,    // Use compact object display
   * }
   * ```
   *
   * @default `{}` (use built-in defaults: depth=unlimited, colors=auto, compact=true)
   */
  readonly inspectOptions?: {
    /**
     * Maximum depth to traverse when inspecting nested objects.
     * @default Infinity (no depth limit)
     */
    readonly depth?: number;
    /**
     * Whether to use syntax highlighting colors for inspected values.
     * @default Inherited from global `colors` setting
     */
    readonly colors?: boolean;
    /**
     * Whether to use compact formatting for objects and arrays.
     * @default `true` (compact formatting)
     */
    readonly compact?: boolean;
    /**
     * Whether to invoke getter functions during inspection.
     * (Node.js, Deno, and Bun only; browsers fall back to default behavior.)
     *
     * @default Inherited from runtime defaults
     * @since 1.2.0
     */
    readonly getters?: boolean;
    /**
     * Whether to show Proxy objects with their target and handler.
     * (Node.js, Deno, and Bun only; browsers fall back to default behavior.)
     *
     * @default Inherited from runtime defaults
     * @since 1.2.0
     */
    readonly showProxy?: boolean;
  };
  /**
   * Configuration to always render structured data.
   *
   * If set to `true`, any structured data that is logged will
   * always be rendered. This can be very verbose. Make sure
   * to configure `inspectOptions` properly for your usecase.
   *
   * @default `false`
   * @since 1.1.0
   */
  readonly properties?: boolean;
  /**
   * Enable word wrapping for long messages.
   *
   * When enabled, long messages will be wrapped at the specified width,
   * with continuation lines aligned to the message column position.
   *
   * - `true`: Auto-detect terminal width when attached to a terminal,
   *   fallback to 80 columns when not in a terminal or detection fails
   * - `number`: Use the specified width in columns
   * - `false`: Disable word wrapping
   *
   * @example
   * ```typescript
   * // Auto-detect terminal width (recommended)
   * wordWrap: true
   *
   * // Custom wrap width
   * wordWrap: 120
   *
   * // Disable word wrapping (default)
   * wordWrap: false
   * ```
   *
   * @default `true` (auto-detect terminal width)
   * @since 1.0.0
   */
  readonly wordWrap?: boolean | number;
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
declare function getPrettyFormatter(options?: PrettyFormatterOptions): TextFormatter;
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
declare const prettyFormatter: TextFormatter;
//#endregion
export { PrettyFormatterOptions, getPrettyFormatter, prettyFormatter };
//# sourceMappingURL=formatter.d.cts.map