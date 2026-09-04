import { AsyncFileSinkDriver, FileSinkDriver, FileSinkOptions } from "./filesink.base.cjs";
import { Sink } from "@logtape/logtape";

//#region src/timefilesink.d.ts

/**
 * The rotation interval for time-based file sinks.
 */
type TimeRotationInterval = "hourly" | "daily" | "weekly";
/**
 * Options for the {@link getBaseTimeRotatingFileSink} function.
 */
interface TimeRotatingFileSinkOptions extends Omit<FileSinkOptions, "lazy"> {
  /**
   * The directory to write log files to.
   */
  directory: string;
  /**
   * A function that generates the filename for the log file based on the date.
   * Default depends on `interval`:
   * - `"daily"`: `YYYY-MM-DD.log` (e.g., `2025-01-15.log`)
   * - `"hourly"`: `YYYY-MM-DD-HH.log` (e.g., `2025-01-15-09.log`)
   * - `"weekly"`: `YYYY-WW.log` (e.g., `2025-W03.log`)
   */
  filename?: (date: Date) => string;
  /**
   * The rotation interval.  Defaults to `"daily"`.
   */
  interval?: TimeRotationInterval;
  /**
   * The maximum age of log files in milliseconds.  Files older than this
   * will be deleted.  If not specified, old files are not deleted.
   *
   * When using `getTimeRotatingFileSink()` with `filename` set, cleanup uses
   * each file's modification time instead of parsing dates from filenames.
   */
  maxAgeMs?: number;
}
/**
 * A platform-specific time-rotating file sink driver.
 */
interface TimeRotatingFileSinkDriver<TFile> extends FileSinkDriver<TFile> {
  /**
   * Read the contents of a directory.
   * @param path A path to the directory.
   * @returns An array of filenames in the directory.
   */
  readdirSync(path: string): string[];
  /**
   * Delete a file.
   * @param path A path to the file to delete.
   */
  unlinkSync(path: string): void;
  /**
   * Create a directory if it doesn't exist.
   * @param path A path to the directory to create.
   * @param options Options for directory creation.
   */
  mkdirSync(path: string, options?: {
    recursive?: boolean;
  }): void;
  /**
   * Join path segments.
   * @param paths Path segments to join.
   * @returns The joined path.
   */
  joinPath(...paths: string[]): string;
}
/**
 * A platform-specific async time-rotating file sink driver.
 * @since 2.0.0
 */
interface AsyncTimeRotatingFileSinkDriver<TFile> extends AsyncFileSinkDriver<TFile> {
  /**
   * Read the contents of a directory.
   * @param path A path to the directory.
   * @returns An array of filenames in the directory.
   */
  readdirSync(path: string): string[];
  /**
   * Delete a file.
   * @param path A path to the file to delete.
   */
  unlinkSync(path: string): void;
  /**
   * Create a directory if it doesn't exist.
   * @param path A path to the directory to create.
   * @param options Options for directory creation.
   */
  mkdirSync(path: string, options?: {
    recursive?: boolean;
  }): void;
  /**
   * Join path segments.
   * @param paths Path segments to join.
   * @returns The joined path.
   */
  joinPath(...paths: string[]): string;
}
/**
 * Get the ISO week number of a date.
 * @param date The date to get the week number of.
 * @returns The ISO week number (1-53).
 */
//#endregion
export { AsyncTimeRotatingFileSinkDriver, TimeRotatingFileSinkDriver, TimeRotatingFileSinkOptions, TimeRotationInterval };
//# sourceMappingURL=timefilesink.d.cts.map