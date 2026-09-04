const require_rolldown_runtime = require('./_virtual/rolldown_runtime.cjs');
const require_snapshot = require('./snapshot.cjs');
const __logtape_logtape = require_rolldown_runtime.__toESM(require("@logtape/logtape"));

//#region src/filesink.base.ts
function isMetaLoggerRecord(record) {
	return record.category.length === 2 && record.category[0] === "logtape" && record.category[1] === "meta";
}
/**
* Adaptive flush strategy that dynamically adjusts buffer thresholds
* based on recent flush patterns for optimal performance.
*/
var AdaptiveFlushStrategy = class {
	recentFlushSizes = [];
	recentFlushTimes = [];
	avgFlushSize;
	avgFlushInterval;
	maxHistorySize = 10;
	baseThreshold;
	baseInterval;
	constructor(baseThreshold, baseInterval) {
		this.baseThreshold = baseThreshold;
		this.baseInterval = baseInterval;
		this.avgFlushSize = baseThreshold;
		this.avgFlushInterval = baseInterval;
	}
	/**
	* Record a flush event for pattern analysis.
	* @param size The size of data flushed in bytes.
	* @param timeSinceLastFlush Time since last flush in milliseconds.
	*/
	recordFlush(size, timeSinceLastFlush) {
		this.recentFlushSizes.push(size);
		this.recentFlushTimes.push(timeSinceLastFlush);
		if (this.recentFlushSizes.length > this.maxHistorySize) {
			this.recentFlushSizes.shift();
			this.recentFlushTimes.shift();
		}
		this.updateAverages();
	}
	/**
	* Determine if buffer should be flushed based on adaptive strategy.
	* @param currentSize Current buffer size in bytes.
	* @param timeSinceLastFlush Time since last flush in milliseconds.
	* @returns True if buffer should be flushed.
	*/
	shouldFlush(currentSize, timeSinceLastFlush) {
		const adaptiveThreshold = this.calculateAdaptiveThreshold();
		const adaptiveInterval = this.calculateAdaptiveInterval();
		return currentSize >= adaptiveThreshold || adaptiveInterval > 0 && timeSinceLastFlush >= adaptiveInterval;
	}
	updateAverages() {
		if (this.recentFlushSizes.length === 0) return;
		this.avgFlushSize = this.recentFlushSizes.reduce((sum, size) => sum + size, 0) / this.recentFlushSizes.length;
		this.avgFlushInterval = this.recentFlushTimes.reduce((sum, time) => sum + time, 0) / this.recentFlushTimes.length;
	}
	calculateAdaptiveThreshold() {
		const adaptiveFactor = Math.min(2, Math.max(.5, this.avgFlushSize / this.baseThreshold));
		return Math.max(Math.min(4096, this.baseThreshold / 2), Math.min(64 * 1024, this.baseThreshold * adaptiveFactor));
	}
	calculateAdaptiveInterval() {
		if (this.baseInterval <= 0) return 0;
		if (this.avgFlushInterval <= 0) return this.baseInterval;
		if (this.recentFlushTimes.length < 3) return this.avgFlushInterval;
		const variance = this.calculateVariance(this.recentFlushTimes);
		const stabilityFactor = Math.min(2, Math.max(.5, 1e3 / variance));
		return Math.max(1e3, Math.min(1e4, this.avgFlushInterval * stabilityFactor));
	}
	calculateVariance(values) {
		if (values.length < 2) return 1e3;
		const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
		const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
		return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
	}
};
/**
* Memory pool for reusing Uint8Array buffers to minimize GC pressure.
* Maintains a pool of pre-allocated buffers for efficient reuse.
*/
var BufferPool = class {
	pool = [];
	maxPoolSize = 50;
	maxBufferSize = 64 * 1024;
	/**
	* Acquire a buffer from the pool or create a new one.
	* @param size The minimum size needed for the buffer.
	* @returns A Uint8Array that can be used for encoding.
	*/
	acquire(size) {
		if (size > this.maxBufferSize) return new Uint8Array(size);
		for (let i = this.pool.length - 1; i >= 0; i--) {
			const buffer = this.pool[i];
			if (buffer.length >= size) {
				this.pool.splice(i, 1);
				return buffer.subarray(0, size);
			}
		}
		const actualSize = Math.max(size, 1024);
		return new Uint8Array(actualSize);
	}
	/**
	* Return a buffer to the pool for future reuse.
	* @param buffer The buffer to return to the pool.
	*/
	release(buffer) {
		if (this.pool.length >= this.maxPoolSize || buffer.length > this.maxBufferSize) return;
		if (buffer.length < 256) return;
		this.pool.push(buffer);
	}
	/**
	* Clear the pool to free memory. Useful for cleanup.
	*/
	clear() {
		this.pool.length = 0;
	}
	/**
	* Get current pool statistics for monitoring.
	* @returns Object with pool size and buffer count.
	*/
	getStats() {
		return {
			poolSize: this.pool.reduce((sum, buf) => sum + buf.length, 0),
			totalBuffers: this.pool.length
		};
	}
};
/**
* High-performance byte buffer for batching log records.
* Eliminates string concatenation overhead by storing pre-encoded bytes.
* Uses memory pooling to reduce GC pressure.
*/
var ByteRingBuffer = class {
	buffers = [];
	totalSize = 0;
	bufferPool;
	constructor(bufferPool) {
		this.bufferPool = bufferPool;
	}
	/**
	* Append pre-encoded log record bytes to the buffer.
	* @param data The encoded log record as bytes.
	*/
	append(data) {
		this.buffers.push(data);
		this.totalSize += data.length;
	}
	/**
	* Get the current total size of buffered data in bytes.
	* @returns The total size in bytes.
	*/
	size() {
		return this.totalSize;
	}
	/**
	* Get the number of buffered records.
	* @returns The number of records in the buffer.
	*/
	count() {
		return this.buffers.length;
	}
	/**
	* Flush all buffered data and return it as an array of byte arrays.
	* This clears the internal buffer and returns used buffers to the pool.
	* @returns Array of buffered byte arrays ready for writev() operations.
	*/
	flush() {
		const result = [...this.buffers];
		this.clear();
		return result;
	}
	/**
	* Clear the buffer without returning data.
	* Returns buffers to the pool for reuse.
	*/
	clear() {
		for (const buffer of this.buffers) this.bufferPool.release(buffer);
		this.buffers.length = 0;
		this.totalSize = 0;
	}
	/**
	* Check if the buffer is empty.
	* @returns True if the buffer contains no data.
	*/
	isEmpty() {
		return this.buffers.length === 0;
	}
};
function getBaseFileSink(path, options) {
	const formatter = options.formatter ?? __logtape_logtape.defaultTextFormatter;
	const encoder = options.encoder ?? new TextEncoder();
	const bufferSize = options.bufferSize ?? 1024 * 8;
	const flushInterval = options.flushInterval ?? 5e3;
	let fd = options.lazy ? null : options.openSync(path);
	const bufferPool = new BufferPool();
	const byteBuffer = new ByteRingBuffer(bufferPool);
	const adaptiveStrategy = new AdaptiveFlushStrategy(bufferSize, flushInterval);
	let lastFlushTimestamp = Date.now();
	if (!options.nonBlocking) {
		function flushBuffer$1() {
			if (fd == null || byteBuffer.isEmpty()) return;
			const flushSize = byteBuffer.size();
			const currentTime = Date.now();
			const timeSinceLastFlush = currentTime - lastFlushTimestamp;
			const chunks = byteBuffer.flush();
			if (options.writeManySync && chunks.length > 1) options.writeManySync(fd, chunks);
			else for (const chunk of chunks) options.writeSync(fd, chunk);
			options.flushSync(fd);
			adaptiveStrategy.recordFlush(flushSize, timeSinceLastFlush);
			lastFlushTimestamp = currentTime;
		}
		const sink = (record) => {
			if (fd == null) fd = options.openSync(path);
			let formattedRecord;
			let encodedRecord;
			if (byteBuffer.isEmpty()) {
				formattedRecord = formatter(record);
				encodedRecord = encoder.encode(formattedRecord);
				if (encodedRecord.length < 200) {
					options.writeSync(fd, encodedRecord);
					options.flushSync(fd);
					const currentTime = Date.now();
					adaptiveStrategy.recordFlush(encodedRecord.length, currentTime - lastFlushTimestamp);
					lastFlushTimestamp = currentTime;
					return;
				}
			}
			formattedRecord ??= formatter(record);
			encodedRecord ??= encoder.encode(formattedRecord);
			byteBuffer.append(encodedRecord);
			if (bufferSize <= 0) flushBuffer$1();
			else {
				const timeSinceLastFlush = record.timestamp - lastFlushTimestamp;
				const shouldFlush = adaptiveStrategy.shouldFlush(byteBuffer.size(), timeSinceLastFlush);
				if (shouldFlush) flushBuffer$1();
			}
		};
		sink[Symbol.dispose] = () => {
			if (fd !== null) {
				flushBuffer$1();
				options.closeSync(fd);
			}
			bufferPool.clear();
		};
		return require_snapshot.markSinkAsImmediate(sink);
	}
	const asyncOptions = options;
	let disposed = false;
	let activeFlush = null;
	let flushTimer = null;
	let bufferedNonMetaRecord = false;
	function reportFlushError(error) {
		try {
			(0, __logtape_logtape.getLogger)(["logtape", "meta"]).warn("Non-blocking file sink flush failed for {path}: {error}", {
				error,
				path
			});
		} catch {}
	}
	async function flushBuffer() {
		if (fd == null || byteBuffer.isEmpty()) return;
		const flushSize = byteBuffer.size();
		const currentTime = Date.now();
		const timeSinceLastFlush = currentTime - lastFlushTimestamp;
		const chunks = byteBuffer.flush();
		const suppressErrorReport = !bufferedNonMetaRecord;
		bufferedNonMetaRecord = false;
		try {
			if (asyncOptions.writeMany && chunks.length > 1) await asyncOptions.writeMany(fd, chunks);
			else for (const chunk of chunks) asyncOptions.writeSync(fd, chunk);
			await asyncOptions.flush(fd);
			adaptiveStrategy.recordFlush(flushSize, timeSinceLastFlush);
			lastFlushTimestamp = currentTime;
		} catch (error) {
			if (!suppressErrorReport) reportFlushError(error);
		}
	}
	function scheduleFlush() {
		if (activeFlush || disposed) return;
		activeFlush = flushBuffer().finally(() => {
			activeFlush = null;
			if (!disposed && !byteBuffer.isEmpty()) scheduleFlush();
		});
	}
	function scheduleDirectFlush(flushSize, suppressErrorReport) {
		if (activeFlush || disposed || fd == null) return;
		const flushFd = fd;
		const startedAt = Date.now();
		const timeSinceLastFlush = startedAt - lastFlushTimestamp;
		activeFlush = Promise.resolve().then(() => asyncOptions.flush(flushFd)).then(() => {
			adaptiveStrategy.recordFlush(flushSize, timeSinceLastFlush);
			lastFlushTimestamp = Date.now();
		}).catch((error) => {
			if (!suppressErrorReport) reportFlushError(error);
		}).finally(() => {
			activeFlush = null;
			if (!disposed && !byteBuffer.isEmpty()) scheduleFlush();
		});
	}
	function startFlushTimer() {
		if (flushTimer !== null || disposed) return;
		flushTimer = setInterval(() => {
			scheduleFlush();
		}, flushInterval);
	}
	const nonBlockingSink = (record) => {
		if (disposed) return;
		if (fd == null) fd = asyncOptions.openSync(path);
		let formattedRecord;
		let encodedRecord;
		if (byteBuffer.isEmpty() && !activeFlush) {
			formattedRecord = formatter(record);
			encodedRecord = encoder.encode(formattedRecord);
			if (encodedRecord.length < 200) {
				asyncOptions.writeSync(fd, encodedRecord);
				scheduleDirectFlush(encodedRecord.length, isMetaLoggerRecord(record));
				return;
			}
		}
		formattedRecord ??= formatter(record);
		encodedRecord ??= encoder.encode(formattedRecord);
		byteBuffer.append(encodedRecord);
		bufferedNonMetaRecord ||= !isMetaLoggerRecord(record);
		if (bufferSize <= 0) scheduleFlush();
		else {
			const timeSinceLastFlush = record.timestamp - lastFlushTimestamp;
			const shouldFlush = adaptiveStrategy.shouldFlush(byteBuffer.size(), timeSinceLastFlush);
			if (shouldFlush) scheduleFlush();
			else if (flushTimer === null && flushInterval > 0) startFlushTimer();
		}
	};
	nonBlockingSink[Symbol.asyncDispose] = async () => {
		disposed = true;
		if (flushTimer !== null) {
			clearInterval(flushTimer);
			flushTimer = null;
		}
		if (activeFlush !== null) await activeFlush;
		await flushBuffer();
		if (fd !== null) try {
			await asyncOptions.close(fd);
		} catch {}
		bufferPool.clear();
	};
	return require_snapshot.markSinkAsImmediate(nonBlockingSink);
}
function isFileNotFoundError(error) {
	if (!(error instanceof Error)) return false;
	const errorWithCode = error;
	return errorWithCode.code === "ENOENT" || error.name === "NotFound";
}
function getBaseRotatingFileSink(path, options) {
	const formatter = options.formatter ?? __logtape_logtape.defaultTextFormatter;
	const encoder = options.encoder ?? new TextEncoder();
	const maxSize = options.maxSize ?? 1024 * 1024;
	const maxFiles = options.maxFiles ?? 5;
	const bufferSize = options.bufferSize ?? 1024 * 8;
	const flushInterval = options.flushInterval ?? 5e3;
	if (maxFiles <= 0 && options.unlinkSync == null) throw new TypeError("maxFiles <= 0 requires unlinkSync support.");
	let offset = 0;
	try {
		const stat = options.statSync(path);
		offset = stat.size;
	} catch {}
	let fd = options.openSync(path);
	let lastFlushTimestamp = Date.now();
	let buffer = "";
	function shouldRollover(bytes) {
		return offset + bytes.length > maxSize;
	}
	function performRollover() {
		if (maxFiles <= 0) {
			const unlinkSync = options.unlinkSync;
			if (unlinkSync == null) return;
			options.closeSync(fd);
			try {
				unlinkSync(path);
			} catch (error) {
				if (!isFileNotFoundError(error)) {
					try {
						offset = options.statSync(path).size;
					} catch {
						offset = 0;
					}
					fd = options.openSync(path);
					throw error;
				}
			}
			offset = 0;
			fd = options.openSync(path);
			return;
		}
		options.closeSync(fd);
		for (let i = maxFiles - 1; i > 0; i--) {
			const oldPath = `${path}.${i}`;
			const newPath = `${path}.${i + 1}`;
			try {
				options.renameSync(oldPath, newPath);
			} catch (_) {}
		}
		options.renameSync(path, `${path}.1`);
		offset = 0;
		fd = options.openSync(path);
	}
	if (!options.nonBlocking) {
		function flushBuffer$1() {
			if (buffer.length > 0) {
				const bytes = encoder.encode(buffer);
				buffer = "";
				if (shouldRollover(bytes)) performRollover();
				options.writeSync(fd, bytes);
				options.flushSync(fd);
				offset += bytes.length;
				lastFlushTimestamp = Date.now();
			}
		}
		const sink = (record) => {
			buffer += formatter(record);
			const shouldFlushBySize = buffer.length >= bufferSize;
			const shouldFlushByTime = flushInterval > 0 && record.timestamp - lastFlushTimestamp >= flushInterval;
			if (shouldFlushBySize || shouldFlushByTime) flushBuffer$1();
		};
		sink[Symbol.dispose] = () => {
			flushBuffer$1();
			options.closeSync(fd);
		};
		return require_snapshot.markSinkAsImmediate(sink);
	}
	const asyncOptions = options;
	let disposed = false;
	let activeFlush = null;
	let flushTimer = null;
	let bufferedNonMetaRecord = false;
	function reportFlushError(error) {
		try {
			(0, __logtape_logtape.getLogger)(["logtape", "meta"]).warn("Non-blocking rotating file sink flush failed for {path}: {error}", {
				error,
				path
			});
		} catch {}
	}
	async function flushBuffer() {
		if (buffer.length === 0) return;
		const data = buffer;
		buffer = "";
		const suppressErrorReport = !bufferedNonMetaRecord;
		bufferedNonMetaRecord = false;
		try {
			const bytes = encoder.encode(data);
			if (shouldRollover(bytes)) performRollover();
			asyncOptions.writeSync(fd, bytes);
			await asyncOptions.flush(fd);
			offset += bytes.length;
			lastFlushTimestamp = Date.now();
		} catch (error) {
			if (!suppressErrorReport) reportFlushError(error);
		}
	}
	function scheduleFlush() {
		if (activeFlush || disposed) return;
		activeFlush = flushBuffer().finally(() => {
			activeFlush = null;
			if (!disposed && buffer.length > 0) scheduleFlush();
		});
	}
	function startFlushTimer() {
		if (flushTimer !== null || disposed) return;
		flushTimer = setInterval(() => {
			scheduleFlush();
		}, flushInterval);
	}
	const nonBlockingSink = (record) => {
		if (disposed) return;
		buffer += formatter(record);
		bufferedNonMetaRecord ||= !isMetaLoggerRecord(record);
		const shouldFlushBySize = buffer.length >= bufferSize;
		const shouldFlushByTime = flushInterval > 0 && record.timestamp - lastFlushTimestamp >= flushInterval;
		if (shouldFlushBySize || shouldFlushByTime) scheduleFlush();
		else if (flushTimer === null && flushInterval > 0) startFlushTimer();
	};
	nonBlockingSink[Symbol.asyncDispose] = async () => {
		disposed = true;
		if (flushTimer !== null) {
			clearInterval(flushTimer);
			flushTimer = null;
		}
		if (activeFlush !== null) await activeFlush;
		await flushBuffer();
		try {
			await asyncOptions.close(fd);
		} catch {}
	};
	return require_snapshot.markSinkAsImmediate(nonBlockingSink);
}

//#endregion
exports.getBaseFileSink = getBaseFileSink;
exports.getBaseRotatingFileSink = getBaseRotatingFileSink;