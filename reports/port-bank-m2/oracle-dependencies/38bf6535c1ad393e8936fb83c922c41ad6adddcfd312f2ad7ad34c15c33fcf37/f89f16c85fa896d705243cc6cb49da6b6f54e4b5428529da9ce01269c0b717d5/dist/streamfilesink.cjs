const require_rolldown_runtime = require('./_virtual/rolldown_runtime.cjs');
const require_snapshot = require('./snapshot.cjs');
const __logtape_logtape = require_rolldown_runtime.__toESM(require("@logtape/logtape"));
const node_fs = require_rolldown_runtime.__toESM(require("node:fs"));
const node_events = require_rolldown_runtime.__toESM(require("node:events"));

//#region src/streamfilesink.ts
/**
* Create a high-performance stream-based file sink that writes log records to a file.
*
* This sink writes formatted records directly to a Node.js `WriteStream`. It
* leverages Node.js stream buffering for efficient asynchronous writes without
* blocking the main thread.
*
* ## Performance Characteristics
*
* - **High Performance**: Optimized for high-volume logging scenarios
* - **Non-blocking**: Uses asynchronous I/O that doesn't block the main thread
* - **Memory Efficient**: Uses the file stream buffer directly
* - **Stream-based**: Leverages Node.js native stream optimizations
*
* ## When to Use
*
* Use this sink when you need:
* - High-performance file logging for production applications
* - Non-blocking I/O behavior for real-time applications
* - Stream-buffered writes for high-volume scenarios
* - Simple file output without complex buffering configuration
*
* For more control over buffering behavior, consider using {@link getFileSink}
* instead, which provides options for buffer size, flush intervals, and
* non-blocking modes.
*
* ## Example
*
* ```typescript
* import { configure } from "@logtape/logtape";
* import { getStreamFileSink } from "@logtape/file";
*
* await configure({
*   sinks: {
*     file: getStreamFileSink("app.log", {
*       highWaterMark: 32768  // 32KB buffer for high-volume logging
*     })
*   },
*   loggers: [
*     { category: ["myapp"], sinks: ["file"] }
*   ]
* });
* ```
*
* @param path The path to the file to write logs to. The file will be created
*             if it doesn't exist, or appended to if it does exist.
* @param options Configuration options for the stream-based sink.
* @returns A sink that writes formatted log records to the specified file.
*          The returned sink implements `AsyncDisposable` for proper resource cleanup
*          that waits for all data to be flushed to disk.
*
* @since 1.0.0
*/
function getStreamFileSink(path, options = {}) {
	const highWaterMark = options.highWaterMark ?? 16384;
	const formatter = options.formatter ?? __logtape_logtape.defaultTextFormatter;
	const writeStream = (0, node_fs.createWriteStream)(path, {
		flags: "a",
		highWaterMark
	});
	let disposed = false;
	let streamError;
	const handleStreamError = (error) => {
		streamError = error;
	};
	writeStream.on("error", handleStreamError);
	const sink = (record) => {
		if (disposed) return;
		writeStream.write(formatter(record));
	};
	sink[Symbol.asyncDispose] = async () => {
		if (disposed) return;
		disposed = true;
		try {
			if (streamError != null) throw streamError;
			if (writeStream.writableNeedDrain && !writeStream.writableEnded) await (0, node_events.once)(writeStream, "drain");
			if (streamError != null) throw streamError;
			if (writeStream.closed || writeStream.destroyed) return;
			const closePromise = (0, node_events.once)(writeStream, "close");
			writeStream.end();
			await closePromise;
			if (streamError != null) throw streamError;
		} finally {
			writeStream.off("error", handleStreamError);
		}
	};
	return require_snapshot.markSinkAsImmediate(sink);
}

//#endregion
exports.getStreamFileSink = getStreamFileSink;