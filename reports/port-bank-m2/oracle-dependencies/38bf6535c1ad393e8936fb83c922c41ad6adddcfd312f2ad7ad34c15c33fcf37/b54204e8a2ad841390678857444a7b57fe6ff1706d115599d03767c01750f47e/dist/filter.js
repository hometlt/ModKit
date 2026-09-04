//#region src/filter.ts
/**
* Converts a {@link FilterLike} value to an actual {@link Filter}.
*
* @param filter The filter-like value to convert.
* @returns The actual filter.
*/
function toFilter(filter) {
	if (typeof filter === "function") return filter;
	return getLevelFilter(filter);
}
/**
* Returns a filter that accepts log records with the specified level.
*
* @param level The level to filter by.  If `null`, the filter will reject all
*              records.
* @returns The filter.
*/
function getLevelFilter(level) {
	if (level == null) return () => false;
	if (level === "fatal") return (record) => record.level === "fatal";
	else if (level === "error") return (record) => record.level === "fatal" || record.level === "error";
	else if (level === "warning") return (record) => record.level === "fatal" || record.level === "error" || record.level === "warning";
	else if (level === "info") return (record) => record.level === "fatal" || record.level === "error" || record.level === "warning" || record.level === "info";
	else if (level === "debug") return (record) => record.level === "fatal" || record.level === "error" || record.level === "warning" || record.level === "info" || record.level === "debug";
	else if (level === "trace") return () => true;
	throw new TypeError(`Invalid log level: ${level}.`);
}
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
function getThrottlingFilter(options) {
	validatePositiveInteger("limit", options.limit);
	validatePositiveNumber("windowMs", options.windowMs);
	if (options.maxKeys != null) validatePositiveInteger("maxKeys", options.maxKeys);
	const limit = options.limit;
	const windowMs = options.windowMs;
	const mode = options.mode ?? "fixed";
	const timeSource = options.timeSource ?? "clock";
	const clock = options.clock ?? Date.now;
	const getKey = options.key ?? getDefaultThrottlingKey;
	const maxKeys = options.maxKeys === void 0 ? 1e3 : options.maxKeys;
	const buckets = /* @__PURE__ */ new Map();
	const summaryRecord = Symbol.for("LogTape.throttlingSummaryRecord");
	let accessCounter = 0;
	let emittingSummary = false;
	if (mode !== "fixed" && mode !== "sliding") throw new TypeError(`Invalid throttling mode: ${String(mode)}.`);
	if (timeSource !== "clock" && timeSource !== "record") throw new TypeError(`Invalid throttling timeSource: ${String(timeSource)}.`);
	const filter = (record) => {
		if (emittingSummary && isSummaryRecord(record)) return true;
		const key = getKey(record);
		let bucket = buckets.get(key);
		const observedTime = timeSource === "record" ? record.timestamp : clock();
		const now = bucket == null || timeSource === "record" ? observedTime : Math.max(observedTime, bucket.lastTime);
		if (bucket == null) {
			evictKeysIfNeeded(now);
			bucket = {
				windowStart: now,
				summaryStartTime: now,
				acceptedAt: [],
				allowed: 0,
				suppressed: 0,
				firstRecord: record,
				lastRecord: record,
				lastTime: now,
				lastAccess: ++accessCounter
			};
			buckets.set(key, bucket);
			evictKeysIfNeeded(now);
		} else bucket.lastAccess = ++accessCounter;
		if (mode === "fixed") return filterFixedWindow(key, bucket, record, now);
		return filterSlidingWindow(key, bucket, record, now);
	};
	filter[Symbol.dispose] = () => {
		for (const [key, bucket] of buckets) {
			const endTime = timeSource === "record" ? bucket.lastTime : Math.max(clock(), bucket.lastTime);
			emitSummary(key, bucket, "dispose", endTime);
		}
		buckets.clear();
	};
	return filter;
	function filterFixedWindow(key, bucket, record, now) {
		if (now - bucket.windowStart >= windowMs) {
			emitSummary(key, bucket, "window", now);
			bucket.windowStart = now;
			bucket.summaryStartTime = now;
			bucket.acceptedAt.length = 0;
			bucket.allowed = 0;
			bucket.suppressed = 0;
			bucket.firstRecord = record;
		}
		const allowed = bucket.allowed < limit;
		if (allowed) bucket.allowed++;
		else bucket.suppressed++;
		bucket.lastRecord = record;
		bucket.lastTime = now;
		return allowed;
	}
	function filterSlidingWindow(key, bucket, record, now) {
		pruneExpiredAcceptedAt(bucket, now);
		const allowed = bucket.acceptedAt.length < limit;
		if (allowed) {
			if (bucket.suppressed > 0) {
				emitSummary(key, bucket, "window", now);
				bucket.allowed = 0;
				bucket.suppressed = 0;
				bucket.summaryStartTime = now;
				bucket.firstRecord = record;
			}
			pushAcceptedAt(bucket, now);
			bucket.allowed++;
		} else bucket.suppressed++;
		bucket.lastRecord = record;
		bucket.lastTime = now;
		return allowed;
	}
	function pruneExpiredAcceptedAt(bucket, now) {
		let acceptedAtCount = 0;
		for (let i = 0; i < bucket.acceptedAt.length; i++) {
			const acceptedAt = bucket.acceptedAt[i];
			if (acceptedAt <= now && now - acceptedAt < windowMs) {
				bucket.acceptedAt[acceptedAtCount] = acceptedAt;
				acceptedAtCount++;
			}
		}
		bucket.acceptedAt.length = acceptedAtCount;
	}
	function pushAcceptedAt(bucket, acceptedAt) {
		bucket.acceptedAt.push(acceptedAt);
	}
	function evictKeysIfNeeded(now) {
		if (maxKeys == null) return;
		while (buckets.size > maxKeys) {
			let keyToEvict;
			let oldestAccess = Infinity;
			for (const [key, bucket$1] of buckets) if (bucket$1.lastAccess < oldestAccess) {
				keyToEvict = key;
				oldestAccess = bucket$1.lastAccess;
			}
			if (keyToEvict === void 0) return;
			const bucket = buckets.get(keyToEvict);
			if (bucket != null) {
				const endTime = timeSource === "record" ? bucket.lastTime : Math.max(now, bucket.lastTime);
				emitSummary(keyToEvict, bucket, "eviction", endTime);
				buckets.delete(keyToEvict);
			}
		}
	}
	function emitSummary(key, bucket, reason, endTime) {
		const summaryOptions = options.summary;
		if (summaryOptions == null || bucket.suppressed < 1) return;
		const summary = {
			key,
			suppressed: bucket.suppressed,
			allowed: bucket.allowed,
			reason,
			startTime: bucket.summaryStartTime,
			endTime,
			firstRecord: bucket.firstRecord,
			lastRecord: bucket.lastRecord
		};
		const level = typeof summaryOptions.level === "function" ? summaryOptions.level(summary) : summaryOptions.level ?? "warning";
		const message = typeof summaryOptions.message === "function" ? summaryOptions.message(summary) : summaryOptions.message ?? "Last log message was suppressed {suppressed} times.";
		const log = summaryOptions.logger[level];
		if (typeof log !== "function") return;
		const properties = {
			key: summary.key,
			suppressed: summary.suppressed,
			allowed: summary.allowed,
			reason: summary.reason,
			startTime: summary.startTime,
			endTime: summary.endTime,
			firstRecord: summary.firstRecord,
			lastRecord: summary.lastRecord,
			[summaryRecord]: true
		};
		emittingSummary = true;
		try {
			log.call(summaryOptions.logger, message, properties);
		} finally {
			emittingSummary = false;
		}
	}
	function isSummaryRecord(record) {
		const properties = record.properties;
		return properties != null && typeof properties === "object" && properties[summaryRecord] === true;
	}
}
function validatePositiveInteger(name, value) {
	if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer.`);
}
function validatePositiveNumber(name, value) {
	if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive number.`);
}
function getDefaultThrottlingKey(record) {
	const categoryKey = encodeKeyParts(record.category);
	const rawMessage = getRawMessageTemplate(record.rawMessage);
	const rawMessageKey = typeof rawMessage === "string" ? `s${encodeKeyPart(rawMessage)}` : `t${encodeKeyParts(rawMessage)}`;
	return `c${categoryKey}l${encodeKeyPart(record.level)}r${rawMessageKey}`;
}
function getRawMessageTemplate(rawMessage) {
	if (typeof rawMessage === "string") return rawMessage;
	for (const part of rawMessage) if (typeof part !== "string") return rawMessage.raw;
	return rawMessage;
}
function encodeKeyParts(parts) {
	let key = `${parts.length}:`;
	for (const part of parts) key += encodeKeyPart(part);
	return key;
}
function encodeKeyPart(part) {
	return `${part.length}:${part}`;
}

//#endregion
export { getLevelFilter, getThrottlingFilter, toFilter };
//# sourceMappingURL=filter.js.map