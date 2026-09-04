import { Sink, StreamSinkOptions } from "@logtape/logtape";

//#region src/filesink.base.d.ts

/**
 * Options for the {@link getBaseFileSink} function.
 */
interface FileSinkOptions extends StreamSinkOptions {
  /**
   * If `true`, the file is not opened until the first write.  Defaults to `false`.
   */
  lazy?: boolean;
  /**
   * The size of the buffer to use when writing to the file.  If not specified,
   * a default buffer size will be used.  If it is less or equal to 0,
   * the file will be written directly without buffering.
   * @default 8192
   * @since 0.12.0
   */
  bufferSize?: number;
  /**
   * The maximum time interval in milliseconds between flushes.  If this time
   * passes since the last flush, the buffer will be flushed regardless of size.
   * This helps prevent log loss during unexpected process termination.
   * @default 5000
   * @since 0.12.0
   */
  flushInterval?: number;
  /**
   * Enable non-blocking mode with background flushing.
   * When enabled, flush operations are performed asynchronously to prevent
   * blocking the main thread during file I/O operations.
   *
   * @default `false`
   * @since 1.0.0
   */
  nonBlocking?: boolean;
}
/**
 * A platform-specific file sink driver.
 * @template TFile The type of the file descriptor.
 */
interface FileSinkDriver<TFile> {
  /**
   * Open a file for appending and return a file descriptor.
   * @param path A path to the file to open.
   */
  openSync(path: string): TFile;
  /**
   * Write a chunk of data to the file.
   * @param fd The file descriptor.
   * @param chunk The data to write.
   */
  writeSync(fd: TFile, chunk: Uint8Array): void;
  /**
   * Write multiple chunks of data to the file in a single operation.
   * This is optional - if not implemented, falls back to multiple writeSync calls.
   * @param fd The file descriptor.
   * @param chunks Array of data chunks to write.
   */
  writeManySync?(fd: TFile, chunks: Uint8Array[]): void;
  /**
   * Flush the file to ensure that all data is written to the disk.
   * @param fd The file descriptor.
   */
  flushSync(fd: TFile): void;
  /**
   * Close the file.
   * @param fd The file descriptor.
   */
  closeSync(fd: TFile): void;
}
/**
 * A platform-specific async file sink driver.
 * @template TFile The type of the file descriptor.
 * @since 1.0.0
 */
interface AsyncFileSinkDriver<TFile> extends FileSinkDriver<TFile> {
  /**
   * Asynchronously write multiple chunks of data to the file in a single operation.
   * This is optional - if not implemented, falls back to multiple writeSync calls.
   * @param fd The file descriptor.
   * @param chunks Array of data chunks to write.
   */
  writeMany?(fd: TFile, chunks: Uint8Array[]): Promise<void>;
  /**
   * Asynchronously flush the file to ensure that all data is written to the disk.
   * @param fd The file descriptor.
   */
  flush(fd: TFile): Promise<void>;
  /**
   * Asynchronously close the file.
   * @param fd The file descriptor.
   */
  close(fd: TFile): Promise<void>;
}
/**
 * Get a platform-independent file sink.
 *
 * @template TFile The type of the file descriptor.
 * @param path A path to the file to write to.
 * @param options The options for the sink and the file driver.
 * @returns A sink that writes to the file.  The sink is also a disposable
 *          object that closes the file when disposed. If `nonBlocking` is enabled,
 *          returns a sink that also implements {@link AsyncDisposable}.
 */

/**
 * Options for the {@link getBaseRotatingFileSink} function.
 */
interface RotatingFileSinkOptions extends Omit<FileSinkOptions, "lazy"> {
  /**
   * The maximum bytes of the file before it is rotated.  1 MiB by default.
   */
  maxSize?: number;
  /**
   * The maximum number of files to keep.  5 by default.
   */
  maxFiles?: number;
}
/**
 * A platform-specific rotating file sink driver.
 */
interface RotatingFileSinkDriver<TFile> extends FileSinkDriver<TFile> {
  /**
   * Get the size of the file.
   * @param path A path to the file.
   * @returns The `size` of the file in bytes, in an object.
   */
  statSync(path: string): {
    size: number;
  };
  /**
   * Rename a file.
   * @param oldPath A path to the file to rename.
   * @param newPath A path to be renamed to.
   */
  renameSync(oldPath: string, newPath: string): void;
  /**
   * Delete a file.
   * @param path A path to the file to delete.
   */
  unlinkSync?(path: string): void;
}
/**
 * A platform-specific async rotating file sink driver.
 * @since 1.0.0
 */
interface AsyncRotatingFileSinkDriver<TFile> extends AsyncFileSinkDriver<TFile> {
  /**
   * Get the size of the file.
   * @param path A path to the file.
   * @returns The `size` of the file in bytes, in an object.
   */
  statSync(path: string): {
    size: number;
  };
  /**
   * Rename a file.
   * @param oldPath A path to the file to rename.
   * @param newPath A path to be renamed to.
   */
  renameSync(oldPath: string, newPath: string): void;
  /**
   * Delete a file.
   * @param path A path to the file to delete.
   */
  unlinkSync?(path: string): void;
}
/**
 * Get a platform-independent rotating file sink.
 *
 * This sink writes log records to a file, and rotates the file when it reaches
 * the `maxSize`.  The rotated files are named with the original file name
 * followed by a dot and a number, starting from 1.  The number is incremented
 * for each rotation, and the maximum number of files to keep is `maxFiles`.
 *
 * @param path A path to the file to write to.
 * @param options The options for the sink and the file driver.
 * @returns A sink that writes to the file.  The sink is also a disposable
 *          object that closes the file when disposed. If `nonBlocking` is enabled,
 *          returns a sink that also implements {@link AsyncDisposable}.
 */
//#endregion
export { AsyncFileSinkDriver, AsyncRotatingFileSinkDriver, FileSinkDriver, FileSinkOptions, RotatingFileSinkDriver, RotatingFileSinkOptions };
//# sourceMappingURL=filesink.base.d.cts.map