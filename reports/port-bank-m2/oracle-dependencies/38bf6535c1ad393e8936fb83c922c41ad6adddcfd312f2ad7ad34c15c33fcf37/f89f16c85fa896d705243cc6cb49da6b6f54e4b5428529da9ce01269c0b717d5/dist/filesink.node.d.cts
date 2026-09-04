import { AsyncRotatingFileSinkDriver, FileSinkOptions, RotatingFileSinkDriver, RotatingFileSinkOptions } from "./filesink.base.cjs";
import { AsyncTimeRotatingFileSinkDriver, TimeRotatingFileSinkDriver, TimeRotatingFileSinkOptions } from "./timefilesink.cjs";
import { Sink } from "@logtape/logtape";

//#region src/filesink.node.d.ts

/**
 * A Node.js-specific file sink driver.
 */
declare const nodeDriver: RotatingFileSinkDriver<number | void>;
/**
 * A Node.js-specific async file sink driver.
 * @since 1.0.0
 */
declare const nodeAsyncDriver: AsyncRotatingFileSinkDriver<number | void>;
/**
 * A Node.js-specific time-rotating file sink driver.
 * @since 2.0.0
 */
declare const nodeTimeDriver: TimeRotatingFileSinkDriver<number | void>;
/**
 * A Node.js-specific async time-rotating file sink driver.
 * @since 2.0.0
 */
declare const nodeAsyncTimeDriver: AsyncTimeRotatingFileSinkDriver<number | void>;
/**
 * Get a file sink.
 *
 * Note that this function is unavailable in the browser.
 *
 * @param path A path to the file to write to.
 * @param options The options for the sink.
 * @returns A sink that writes to the file.  The sink is also a disposable
 *          object that closes the file when disposed. If `nonBlocking` is enabled,
 *          returns a sink that also implements {@link AsyncDisposable}.
 */
declare function getFileSink(path: string, options?: FileSinkOptions): Sink & Disposable;
declare function getFileSink(path: string, options: FileSinkOptions & {
  nonBlocking: true;
}): Sink & AsyncDisposable;
/**
 * Get a rotating file sink.
 *
 * This sink writes log records to a file, and rotates the file when it reaches
 * the `maxSize`.  The rotated files are named with the original file name
 * followed by a dot and a number, starting from 1.  The number is incremented
 * for each rotation, and the maximum number of files to keep is `maxFiles`.
 *
 * Note that this function is unavailable in the browser.
 *
 * @param path A path to the file to write to.
 * @param options The options for the sink and the file driver.
 * @returns A sink that writes to the file.  The sink is also a disposable
 *          object that closes the file when disposed. If `nonBlocking` is enabled,
 *          returns a sink that also implements {@link AsyncDisposable}.
 */
declare function getRotatingFileSink(path: string, options?: RotatingFileSinkOptions): Sink & Disposable;
declare function getRotatingFileSink(path: string, options: RotatingFileSinkOptions & {
  nonBlocking: true;
}): Sink & AsyncDisposable;
/**
 * Get a time-rotating file sink.
 *
 * This sink writes log records to a file in a directory, rotating to a new
 * file based on time intervals.  The filename is generated based on the
 * current date/time and the configured interval.
 *
 * Note that this function is unavailable in the browser.
 *
 * @param options The options for the sink.
 * @returns A sink that writes to the file.  The sink is also a disposable
 *          object that closes the file when disposed. If `nonBlocking` is
 *          enabled, returns a sink that also implements {@link AsyncDisposable}.
 * @since 2.0.0
 */
declare function getTimeRotatingFileSink(options: TimeRotatingFileSinkOptions): Sink & Disposable;
declare function getTimeRotatingFileSink(options: TimeRotatingFileSinkOptions & {
  nonBlocking: true;
}): Sink & AsyncDisposable;
//# sourceMappingURL=filesink.node.d.ts.map
//#endregion
export { getFileSink, getRotatingFileSink, getTimeRotatingFileSink, nodeAsyncDriver, nodeAsyncTimeDriver, nodeDriver, nodeTimeDriver };
//# sourceMappingURL=filesink.node.d.cts.map