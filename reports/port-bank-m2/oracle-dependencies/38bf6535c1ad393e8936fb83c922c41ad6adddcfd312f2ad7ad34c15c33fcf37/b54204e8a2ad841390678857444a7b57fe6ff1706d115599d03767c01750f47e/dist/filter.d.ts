import { LogLevel } from "./level.js";
import { LogRecord } from "./record.js";

//#region src/filter.d.ts

/**
 * A filter is a function that accepts a log record and returns `true` if the
 * record should be passed to the sink.
 *
 * @param record The log record to filter.
 * @returns `true` if the record should be passed to the sink.
 */
type Filter = (record: LogRecord) => boolean;
/**
 * Summary information emitted by {@link getThrottlingFilter} when suppressed
 * records are reported.
 *
 * @since 2.1.0
 */
interface ThrottlingFilterSummary {
  /**
   * The throttling key whose records were suppressed.
   */
  readonly key: string;
  /**
   * The number of records suppressed since the previous summary for the key.
   */
  readonly suppressed: number;
  /**
   * The number of records allowed during the same summary period.
   */
  readonly allowed: number;
  /**
   * Why the summary was emitted.
   */
  readonly reason: "window" | "eviction" | "dispose";
  /**
   * The time at which the summary period started, in milliseconds.
   */
  readonly startTime: number;
  /**
   * The time at which the summary period ended, in milliseconds.
   */
  readonly endTime: number;
  /**
   * The first record observed in the summary period.
   */
  readonly firstRecord: LogRecord;
  /**
   * The most recent record observed in the summary period.
   */
  readonly lastRecord: LogRecord;
}
/**
 * A logger-like object used by {@link getThrottlingFilter} to emit summaries.
 *
 * A regular {@link Logger} returned by `getLogger()` satisfies this interface.
 *
 * @since 2.1.0
 */
type ThrottlingSummaryLogger = { readonly [Level in LogLevel]?: (message: string, properties: Record<string, unknown>) => void };
/**
 * Summary logging options for {@link getThrottlingFilter}.
 *
 * @since 2.1.0
 */
interface ThrottlingFilterSummaryOptions {
  /**
   * The logger used to emit summary records.
   */
  readonly logger: ThrottlingSummaryLogger;
  /**
   * The summary log level.
   * @default `"warning"`
   */
  readonly level?: LogLevel | ((summary: ThrottlingFilterSummary) => LogLevel);
  /**
   * The summary message.
   * @default `"Last log message was suppressed {suppressed} times."`
   */
  readonly message?: string | ((summary: ThrottlingFilterSummary) => string);
}
/**
 * Options for {@link getThrottlingFilter}.
 *
 * @since 2.1.0
 */
interface ThrottlingFilterOptions {
  /**
   * Number of records allowed for each key in the configured window.
   */
  readonly limit: number;
  /**
   * Window size in milliseconds.
   */
  readonly windowMs: number;
  /**
   * Window algorithm.
   *
   * - `"fixed"` starts a window when the first record for a key arrives.
   * - `"sliding"` counts records accepted during the previous `windowMs`.
   *
   * @default `"fixed"`
   */
  readonly mode?: "fixed" | "sliding";
  /**
   * Source of time for window calculations.
   *
   * - `"clock"` uses {@link ThrottlingFilterOptions.clock}.
   * - `"record"` uses {@link LogRecord.timestamp}.
   *
   * @default `"clock"`
   */
  readonly timeSource?: "clock" | "record";
  /**
   * Clock used when {@link timeSource} is `"clock"`.
   * @default `Date.now`
   */
  readonly clock?: () => number;
  /**
   * Derives a throttling key from a log record.  By default, records are keyed
   * by category, level, and raw message template.
   */
  readonly key?: (record: LogRecord) => string;
  /**
   * Maximum number of keys tracked by the filter.  When the limit is reached,
   * the least recently used key is evicted.  Set to `null` to disable the cap.
   *
   * @default `1000`
   */
  readonly maxKeys?: number | null;
  /**
   * Summary logging options for suppressed records.
   */
  readonly summary?: ThrottlingFilterSummaryOptions;
}
/**
 * A filter-like value is either a {@link Filter} or a {@link LogLevel}.
 * `null` is also allowed to represent a filter that rejects all records.
 */
type FilterLike = Filter | LogLevel | null;
/**
 * Converts a {@link FilterLike} value to an actual {@link Filter}.
 *
 * @param filter The filter-like value to convert.
 * @returns The actual filter.
 */
declare function toFilter(filter: FilterLike): Filter;
/**
 * Returns a filter that accepts log records with the specified level.
 *
 * @param level The level to filter by.  If `null`, the filter will reject all
 *              records.
 * @returns The filter.
 */
declare function getLevelFilter(level: LogLevel | null): Filter;
/**
 * Returns a stateful filter that rate-limits repeated log records.
 *
 * The default key treats records with the same category, level, and raw
 * message template as identical, ignoring substituted values.  If summary
 * logging is enabled, the filter logs summaries as a side effect when
 * suppression ends, when a suppressed key is evicted, or when the filter is
 * disposed.
 *
 * @param options Throttling options.
 * @returns A throttling filter.
 * @since 2.1.0
 */
declare function getThrottlingFilter(options: ThrottlingFilterOptions): Filter & Disposable;
//# sourceMappingURL=filter.d.ts.map
//#endregion
export { Filter, FilterLike, ThrottlingFilterOptions, ThrottlingFilterSummary, ThrottlingFilterSummaryOptions, ThrottlingSummaryLogger, getLevelFilter, getThrottlingFilter, toFilter };
//# sourceMappingURL=filter.d.ts.map