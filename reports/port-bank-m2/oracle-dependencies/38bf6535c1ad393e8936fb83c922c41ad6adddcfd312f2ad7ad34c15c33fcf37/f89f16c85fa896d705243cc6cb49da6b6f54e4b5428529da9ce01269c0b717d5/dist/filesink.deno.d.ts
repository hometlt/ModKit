import { AsyncRotatingFileSinkDriver, FileSinkOptions, RotatingFileSinkDriver, RotatingFileSinkOptions } from "./filesink.base.js";
import { AsyncTimeRotatingFileSinkDriver, TimeRotatingFileSinkDriver, TimeRotatingFileSinkOptions } from "./timefilesink.js";
import { Sink } from "@logtape/logtape";

//#region src/filesink.deno.d.ts

/**
 * A Deno-specific file sink driver.
 */
declare const denoDriver: RotatingFileSinkDriver<Deno.FsFile>;
/**
 * A Deno-specific async file sink driver.
 * @since 1.0.0
 */
declare const denoAsyncDriver: AsyncRotatingFileSinkDriver<Deno.FsFile>;
/**
 * A Deno-specific time-rotating file sink driver.
 * @since 2.0.0
 */
declare const denoTimeDriver: TimeRotatingFileSinkDriver<Deno.FsFile>;
/**
 * A Deno-specific async time-rotating file sink driver.
 * @since 2.0.0
 */
declare const denoAsyncTimeDriver: AsyncTimeRotatingFileSinkDriver<Deno.FsFile>;
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
//# sourceMappingURL=filesink.deno.d.ts.map
//#endregion
export { denoAsyncDriver, denoAsyncTimeDriver, denoDriver, denoTimeDriver, getFileSink, getRotatingFileSink, getTimeRotatingFileSink };
//# sourceMappingURL=filesink.deno.d.ts.map