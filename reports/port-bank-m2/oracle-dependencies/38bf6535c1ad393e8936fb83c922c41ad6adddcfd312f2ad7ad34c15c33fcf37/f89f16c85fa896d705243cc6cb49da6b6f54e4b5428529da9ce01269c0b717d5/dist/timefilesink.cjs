const require_rolldown_runtime = require('./_virtual/rolldown_runtime.cjs');
const require_snapshot = require('./snapshot.cjs');
const __logtape_logtape = require_rolldown_runtime.__toESM(require("@logtape/logtape"));

//#region src/timefilesink.ts
/**
* Get the ISO week number of a date.
* @param date The date to get the week number of.
* @returns The ISO week number (1-53).
*/
function getISOWeek(date) {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
}
/**
* Get the ISO week year of a date.  This may differ from the calendar year
* for dates near the start or end of a year.
* @param date The date to get the ISO week year of.
* @returns The ISO week year.
*/
function getISOWeekYear(date) {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	return d.getUTCFullYear();
}
/**
* Get the default filename generator for the given interval.
* @param interval The rotation interval.
* @returns A function that generates a filename for a given date.
*/
function getDefaultFilename(interval) {
	switch (interval) {
		case "hourly": return (date) => {
			const yyyy = date.getFullYear();
			const mm = String(date.getMonth() + 1).padStart(2, "0");
			const dd = String(date.getDate()).padStart(2, "0");
			const hh = String(date.getHours()).padStart(2, "0");
			return `${yyyy}-${mm}-${dd}-${hh}.log`;
		};
		case "daily": return (date) => {
			const yyyy = date.getFullYear();
			const mm = String(date.getMonth() + 1).padStart(2, "0");
			const dd = String(date.getDate()).padStart(2, "0");
			return `${yyyy}-${mm}-${dd}.log`;
		};
		case "weekly": return (date) => {
			const yyyy = getISOWeekYear(date);
			const week = getISOWeek(date);
			return `${yyyy}-W${String(week).padStart(2, "0")}.log`;
		};
	}
}
/**
* Get the rotation key for the given date and interval.
* The key is used to determine when to rotate to a new file.
* @param date The date to get the rotation key of.
* @param interval The rotation interval.
* @returns A string key that changes when rotation should occur.
*/
function getRotationKey(date, interval) {
	switch (interval) {
		case "hourly": return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
		case "daily": return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
		case "weekly": return `${getISOWeekYear(date)}-${getISOWeek(date)}`;
	}
}
function getRotationIntervalMs(interval) {
	switch (interval) {
		case "hourly": return 60 * 60 * 1e3;
		case "daily": return 24 * 60 * 60 * 1e3;
		case "weekly": return 7 * 24 * 60 * 60 * 1e3;
	}
}
function hasStatSyncDriver(options) {
	return "statSync" in options && typeof options.statSync === "function";
}
function parseDefaultFilename(file) {
	const dateMatch = file.match(/^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2}))?\.log$/);
	const weekMatch = file.match(/^(\d{4})-W(\d{2})\.log$/);
	if (dateMatch) {
		const [, year, month, day, hour] = dateMatch;
		return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hour ? parseInt(hour, 10) : 0);
	}
	if (weekMatch) {
		const [, year, week] = weekMatch;
		const jan4 = new Date(parseInt(year, 10), 0, 4);
		const dayOfWeek = jan4.getDay() || 7;
		const fileDate = new Date(jan4);
		fileDate.setDate(jan4.getDate() - dayOfWeek + 1 + (parseInt(week, 10) - 1) * 7);
		return fileDate;
	}
	return null;
}
function getBaseTimeRotatingFileSink(options) {
	const formatter = options.formatter ?? __logtape_logtape.defaultTextFormatter;
	const encoder = options.encoder ?? new TextEncoder();
	const interval = options.interval ?? "daily";
	const hasCustomFilename = options.filename !== void 0;
	const filenameGenerator = options.filename ?? getDefaultFilename(interval);
	const maxAgeMs = options.maxAgeMs;
	const cleanupInterval = maxAgeMs === void 0 ? getRotationIntervalMs(interval) : Math.min(getRotationIntervalMs(interval), maxAgeMs);
	const bufferSize = options.bufferSize ?? 1024 * 8;
	const flushInterval = options.flushInterval ?? 5e3;
	const directory = options.directory;
	const statSync = hasStatSyncDriver(options) ? options.statSync : void 0;
	try {
		options.mkdirSync(directory, { recursive: true });
	} catch {}
	let currentFilename = filenameGenerator(/* @__PURE__ */ new Date());
	let currentPath = options.joinPath(directory, currentFilename);
	let currentRotationKey = getRotationKey(/* @__PURE__ */ new Date(), interval);
	let fd = options.openSync(currentPath);
	let lastFlushTimestamp = Date.now();
	let lastCleanupTimestamp;
	let buffer = "";
	function shouldRotate() {
		const now = /* @__PURE__ */ new Date();
		const newKey = getRotationKey(now, interval);
		return newKey !== currentRotationKey;
	}
	function performRotation() {
		options.closeSync(fd);
		const now = /* @__PURE__ */ new Date();
		currentFilename = filenameGenerator(now);
		currentPath = options.joinPath(directory, currentFilename);
		currentRotationKey = getRotationKey(now, interval);
		fd = options.openSync(currentPath);
	}
	function cleanupOldFiles() {
		if (maxAgeMs === void 0) return;
		const now = Date.now();
		if (lastCleanupTimestamp !== void 0 && cleanupInterval > 0 && now - lastCleanupTimestamp < cleanupInterval) return;
		lastCleanupTimestamp = now;
		let files;
		try {
			files = options.readdirSync(directory);
		} catch {
			return;
		}
		for (const file of files) {
			if (file === currentFilename) continue;
			let fileDate = null;
			if (hasCustomFilename) {
				if (statSync === void 0) continue;
				try {
					fileDate = statSync(options.joinPath(directory, file)).mtime;
				} catch {
					continue;
				}
				if (fileDate === null || filenameGenerator(fileDate) !== file) continue;
			} else {
				if (!file.endsWith(".log")) continue;
				fileDate = parseDefaultFilename(file);
			}
			if (fileDate && now - fileDate.getTime() > maxAgeMs) {
				const filePath = options.joinPath(directory, file);
				try {
					options.unlinkSync(filePath);
				} catch {}
			}
		}
	}
	if (!options.nonBlocking) {
		function flushBuffer$1() {
			if (buffer.length > 0) {
				if (shouldRotate()) performRotation();
				const bytes = encoder.encode(buffer);
				buffer = "";
				options.writeSync(fd, bytes);
				options.flushSync(fd);
				lastFlushTimestamp = Date.now();
				cleanupOldFiles();
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
	async function flushBuffer() {
		if (buffer.length === 0) return;
		if (shouldRotate()) performRotation();
		const data = buffer;
		buffer = "";
		try {
			const bytes = encoder.encode(data);
			asyncOptions.writeSync(fd, bytes);
			await asyncOptions.flush(fd);
			lastFlushTimestamp = Date.now();
			cleanupOldFiles();
		} catch {}
	}
	function scheduleFlush() {
		if (activeFlush || disposed) return;
		activeFlush = flushBuffer().finally(() => {
			activeFlush = null;
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
		await flushBuffer();
		try {
			await asyncOptions.close(fd);
		} catch {}
	};
	return require_snapshot.markSinkAsImmediate(nonBlockingSink);
}

//#endregion
exports.getBaseTimeRotatingFileSink = getBaseTimeRotatingFileSink;