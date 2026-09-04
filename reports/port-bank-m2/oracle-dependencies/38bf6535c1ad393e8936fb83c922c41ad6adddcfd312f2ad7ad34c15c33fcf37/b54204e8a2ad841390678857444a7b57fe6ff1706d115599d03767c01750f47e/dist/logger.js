import { getCategoryPrefix, getImplicitContextIfAny } from "./context.js";
import { compareLogLevel } from "./level.js";

//#region src/logger.ts
/**
* Symbol to identify lazy values.
*/
const lazySymbol = Symbol.for("logtape.lazy");
const throttlingSummaryRecordSymbol = Symbol.for("LogTape.throttlingSummaryRecord");
const immediateSinkSymbol = Symbol.for("LogTape.sinkSnapshotPolicy.immediate");
const internalStringLogRecords = /* @__PURE__ */ new WeakSet();
const resolvedStringLogRecords = /* @__PURE__ */ new WeakSet();
/**
* Checks if a value is a lazy value.
*
* @param value The value to check.
* @returns `true` if the value is a lazy value, `false` otherwise.
* @since 2.0.0
*/
function isLazy(value) {
	return value != null && typeof value === "object" && lazySymbol in value && value[lazySymbol] === true;
}
/**
* Creates a lazy value that is evaluated at logging time.
*
* This is useful for logging contextual properties that may change over time,
* such as the current user or request context.
*
* @example
* ```typescript
* let currentUser: string | null = null;
* const logger = getLogger("app").with({ user: lazy(() => currentUser) });
*
* logger.info("User action");  // logs with user: null
* currentUser = "alice";
* logger.info("User action");  // logs with user: "alice"
* ```
*
* @typeParam T The type of the value.
* @param getter A function that returns the value.
* @returns A lazy value.
* @since 2.0.0
*/
function lazy(getter) {
	return {
		[lazySymbol]: true,
		getter
	};
}
/**
* Resolves lazy values in a properties object.
*
* @param properties The properties object with potential lazy values.
* @returns A new object with all lazy values resolved.
*/
function resolveProperties(properties) {
	const resolved = {};
	for (const key in properties) {
		const value = properties[key];
		resolved[key] = isLazy(value) ? value.getter() : value;
	}
	const symbolProperties = properties;
	const symbolResolved = resolved;
	if (Object.prototype.propertyIsEnumerable.call(properties, throttlingSummaryRecordSymbol)) {
		const value = symbolProperties[throttlingSummaryRecordSymbol];
		symbolResolved[throttlingSummaryRecordSymbol] = isLazy(value) ? value.getter() : value;
	}
	return resolved;
}
function isPromiseObject(value) {
	if (value instanceof Promise) return true;
	return Object.prototype.toString.call(value) === "[object Promise]" && typeof value.then === "function";
}
function logStringMessage(logger, level, message, props) {
	if (typeof props !== "function") {
		const properties = props ?? {};
		logger.log(level, message, properties);
		return;
	}
	if (!logger.isEnabledFor(level)) return Promise.resolve();
	const result = props();
	if (isPromiseObject(result)) return Promise.resolve(result).then((resolvedProps) => {
		logger.log(level, message, resolvedProps);
	});
	logger.log(level, message, result);
}
function snapshotLogRecordProperties(record) {
	if (resolvedStringLogRecords.has(record)) return record;
	const properties = resolveProperties(record.properties);
	if (internalStringLogRecords.has(record)) return {
		category: record.category,
		level: record.level,
		get message() {
			return record.message;
		},
		rawMessage: record.rawMessage,
		timestamp: record.timestamp,
		properties
	};
	const descriptors = Object.getOwnPropertyDescriptors(record);
	descriptors.properties = {
		value: properties,
		enumerable: true,
		configurable: true
	};
	return Object.defineProperties({}, descriptors);
}
function hasEnumerableProperties(properties) {
	if (properties == null || typeof properties !== "object") return false;
	return Object.keys(properties).length > 0 || Object.prototype.propertyIsEnumerable.call(properties, throttlingSummaryRecordSymbol);
}
function shouldSnapshotForSink(sink) {
	return sink[immediateSinkSymbol] !== true;
}
/**
* Get a logger with the given category.
*
* ```typescript
* const logger = getLogger(["my-app"]);
* ```
*
* @param category The category of the logger.  It can be a string or an array
*                 of strings.  If it is a string, it is equivalent to an array
*                 with a single element.
* @returns The logger.
*/
function getLogger(category = []) {
	return LoggerImpl.getLogger(category);
}
/**
* The symbol for the global root logger.
*/
const globalRootLoggerSymbol = Symbol.for("logtape.rootLogger");
function isMetaLoggerCategory(category) {
	return category.length >= 2 && category[0] === "logtape" && category[1] === "meta";
}
/**
* A logger implementation.  Do not use this directly; use {@link getLogger}
* instead.  This class is exported for testing purposes.
*/
var LoggerImpl = class LoggerImpl {
	parent;
	children;
	category;
	sinks;
	filters;
	contextLocalStorage;
	#parentSinks = "inherit";
	#lowestLevel = "trace";
	#sinkPlanCache = {};
	static getLogger(category = []) {
		let rootLogger = globalRootLoggerSymbol in globalThis ? globalThis[globalRootLoggerSymbol] ?? null : null;
		if (rootLogger == null) {
			rootLogger = new LoggerImpl(null, []);
			globalThis[globalRootLoggerSymbol] = rootLogger;
		}
		if (typeof category === "string") return rootLogger.getChild(category);
		if (category.length === 0) return rootLogger;
		return rootLogger.getChild(category);
	}
	static getNearestExistingLogger(category) {
		let logger = LoggerImpl.getLogger();
		for (const name of category) {
			const childRef = logger.children[name];
			const child = childRef instanceof LoggerImpl ? childRef : childRef?.deref();
			if (child == null) break;
			logger = child;
		}
		return logger;
	}
	constructor(parent, category) {
		this.parent = parent;
		this.children = {};
		this.category = category;
		this.sinks = [];
		this.filters = [];
	}
	get parentSinks() {
		return this.#parentSinks;
	}
	set parentSinks(value) {
		if (this.#parentSinks === value) return;
		this.#parentSinks = value;
	}
	get lowestLevel() {
		return this.#lowestLevel;
	}
	set lowestLevel(value) {
		if (this.#lowestLevel === value) return;
		this.#lowestLevel = value;
	}
	getChild(subcategory) {
		const name = typeof subcategory === "string" ? subcategory : subcategory[0];
		const childRef = this.children[name];
		let child = childRef instanceof LoggerImpl ? childRef : childRef?.deref();
		if (child == null) {
			child = new LoggerImpl(this, [...this.category, name]);
			this.children[name] = "WeakRef" in globalThis ? new WeakRef(child) : child;
		}
		if (typeof subcategory === "string" || subcategory.length === 1) return child;
		return child.getChild(subcategory.slice(1));
	}
	/**
	* Reset the logger.  This removes all sinks and filters from the logger.
	*/
	reset() {
		while (this.sinks.length > 0) this.sinks.shift();
		this.parentSinks = "inherit";
		while (this.filters.length > 0) this.filters.shift();
		this.lowestLevel = "trace";
	}
	/**
	* Reset the logger and all its descendants.  This removes all sinks and
	* filters from the logger and all its descendants.
	*/
	resetDescendants() {
		for (const child of Object.values(this.children)) {
			const logger = child instanceof LoggerImpl ? child : child.deref();
			if (logger != null) logger.resetDescendants();
		}
		this.reset();
	}
	with(properties) {
		return new LoggerCtx(this, { ...properties });
	}
	filter(record) {
		for (const filter of this.filters) if (!filter(record)) return false;
		if (this.filters.length < 1) return this.parent?.filter(record) ?? true;
		return true;
	}
	*getSinks(level) {
		const plan = this.getSinkDispatchPlan(level);
		switch (plan.kind) {
			case "none": return;
			case "one":
				yield plan.sink;
				return;
			case "many":
				yield* plan.sinks;
				return;
		}
	}
	getSinkDispatchPlan(level) {
		const cached = this.#sinkPlanCache[level];
		if (cached != null && this.isSinkDispatchPlanFresh(level, cached)) return cached;
		const parentPlan = this.parent != null && this.parentSinks === "inherit" ? this.parent.getSinkDispatchPlan(level) : void 0;
		const plan = this.createSinkDispatchPlan(level, parentPlan);
		this.#sinkPlanCache[level] = plan;
		return plan;
	}
	isSinkDispatchPlanFresh(level, plan) {
		if (plan.lowestLevel !== this.lowestLevel || plan.parentSinks !== this.parentSinks || plan.localSinks.length !== this.sinks.length) return false;
		for (let i = 0; i < plan.localSinks.length; i++) if (plan.localSinks[i] !== this.sinks[i]) return false;
		const parentPlan = this.parent != null && this.parentSinks === "inherit" ? this.parent.getSinkDispatchPlan(level) : void 0;
		return plan.parentPlan === parentPlan;
	}
	createSinkDispatchPlan(level, parentPlan) {
		const state = {
			localSinks: [...this.sinks],
			parentSinks: this.parentSinks,
			lowestLevel: this.lowestLevel,
			parentPlan
		};
		if (state.lowestLevel === null) return {
			...state,
			kind: "none"
		};
		if (compareLogLevel(level, state.lowestLevel) < 0) return {
			...state,
			kind: "none"
		};
		let firstSink;
		let sinks;
		const appendSink = (sink) => {
			if (sinks != null) sinks.push(sink);
			else if (firstSink == null) firstSink = sink;
			else sinks = [firstSink, sink];
		};
		if (parentPlan != null) {
			if (parentPlan.kind === "one") firstSink = parentPlan.sink;
			else if (parentPlan.kind === "many") sinks = [...parentPlan.sinks];
		}
		for (const sink of state.localSinks) appendSink(sink);
		if (sinks != null) return {
			...state,
			kind: "many",
			sinks
		};
		if (firstSink != null) return {
			...state,
			kind: "one",
			sink: firstSink
		};
		return {
			...state,
			kind: "none"
		};
	}
	isEnabledFor(level) {
		const categoryPrefix = isMetaLoggerCategory(this.category) ? [] : getCategoryPrefix();
		const dispatcher = categoryPrefix.length > 0 ? LoggerImpl.getNearestExistingLogger([...categoryPrefix, ...this.category]) : this;
		return dispatcher.isEnabledForResolved(level);
	}
	isEnabledForResolved(level) {
		return this.getSinkDispatchPlan(level).kind !== "none";
	}
	emit(record, bypassSinks) {
		const hasCategory = "category" in record;
		const baseCategory = hasCategory ? record.category : this.category;
		const categoryPrefix = isMetaLoggerCategory(baseCategory) ? [] : getCategoryPrefix();
		const fullCategory = categoryPrefix.length > 0 ? [...categoryPrefix, ...baseCategory] : baseCategory;
		if (categoryPrefix.length < 1 && Object.prototype.hasOwnProperty.call(record, "category")) {
			this.emitResolved(record, bypassSinks);
			return;
		}
		const descriptors = Object.getOwnPropertyDescriptors(record);
		descriptors.category = {
			value: fullCategory,
			enumerable: true,
			configurable: true
		};
		const fullRecord = Object.defineProperties({}, descriptors);
		const dispatcher = categoryPrefix.length > 0 ? LoggerImpl.getNearestExistingLogger(fullCategory) : this;
		dispatcher.emitResolved(fullRecord, bypassSinks);
	}
	emitResolved(record, bypassSinks) {
		if (this.lowestLevel === null || compareLogLevel(record.level, this.lowestLevel) < 0 || !this.filter(record)) return;
		const plan = this.getSinkDispatchPlan(record.level);
		if (plan.kind === "none") return;
		let snapshot;
		let snapshotFailed = false;
		if (plan.kind === "one") {
			const sink = plan.sink;
			if (bypassSinks?.has(sink)) return;
			try {
				if (shouldSnapshotForSink(sink)) try {
					snapshot = snapshotLogRecordProperties(record);
				} catch {
					snapshotFailed = true;
					snapshot = record;
				}
				sink(snapshot ?? record);
			} catch (error) {
				const bypassSinks2 = new Set(bypassSinks);
				bypassSinks2.add(sink);
				metaLogger.log("fatal", "Failed to emit a log record to sink {sink}: {error}", {
					sink,
					error,
					record
				}, bypassSinks2);
			}
			return;
		}
		for (const sink of plan.sinks) {
			if (bypassSinks?.has(sink)) continue;
			try {
				if (snapshot == null && !snapshotFailed && shouldSnapshotForSink(sink)) try {
					snapshot = snapshotLogRecordProperties(record);
				} catch {
					snapshotFailed = true;
					snapshot = record;
				}
				sink(snapshot ?? record);
			} catch (error) {
				const bypassSinks2 = new Set(bypassSinks);
				bypassSinks2.add(sink);
				metaLogger.log("fatal", "Failed to emit a log record to sink {sink}: {error}", {
					sink,
					error,
					record
				}, bypassSinks2);
			}
		}
	}
	log(level, rawMessage, properties, bypassSinks) {
		const implicitContext = getImplicitContextIfAny();
		if (typeof properties !== "function" && implicitContext == null && !rawMessage.includes("{") && !hasEnumerableProperties(properties)) {
			const record$1 = {
				category: this.category,
				level,
				message: [rawMessage],
				rawMessage,
				timestamp: Date.now(),
				properties: {}
			};
			resolvedStringLogRecords.add(record$1);
			this.emit(record$1, bypassSinks);
			return;
		}
		let cachedProps = void 0;
		let cachedMessage = void 0;
		const record = typeof properties === "function" ? {
			category: this.category,
			level,
			timestamp: Date.now(),
			get message() {
				if (cachedMessage == null) cachedMessage = parseMessageTemplate(rawMessage, this.properties);
				return cachedMessage;
			},
			rawMessage,
			get properties() {
				if (cachedProps == null) cachedProps = resolveProperties({
					...implicitContext ?? {},
					...properties()
				});
				return cachedProps;
			}
		} : {
			category: this.category,
			level,
			timestamp: Date.now(),
			get message() {
				if (cachedMessage == null) cachedMessage = parseMessageTemplate(rawMessage, this.properties);
				return cachedMessage;
			},
			rawMessage,
			get properties() {
				if (cachedProps == null) cachedProps = resolveProperties({
					...implicitContext ?? {},
					...properties
				});
				return cachedProps;
			}
		};
		internalStringLogRecords.add(record);
		this.emit(record, bypassSinks);
	}
	logLazily(level, callback, properties = {}) {
		const implicitContext = getImplicitContextIfAny();
		let rawMessage = void 0;
		let msg = void 0;
		function realizeMessage() {
			if (msg == null || rawMessage == null) {
				msg = callback((tpl, ...values) => {
					rawMessage = tpl;
					return renderMessage(tpl, values);
				});
				if (rawMessage == null) throw new TypeError("No log record was made.");
			}
			return [msg, rawMessage];
		}
		this.emit({
			category: this.category,
			level,
			get message() {
				return realizeMessage()[0];
			},
			get rawMessage() {
				return realizeMessage()[1];
			},
			timestamp: Date.now(),
			properties: {
				...implicitContext ?? {},
				...properties
			}
		});
	}
	logTemplate(level, messageTemplate, values, properties = {}) {
		const implicitContext = getImplicitContextIfAny();
		this.emit({
			category: this.category,
			level,
			message: renderMessage(messageTemplate, values),
			rawMessage: messageTemplate,
			timestamp: Date.now(),
			properties: {
				...implicitContext ?? {},
				...properties
			}
		});
	}
	trace(message, ...values) {
		if (typeof message === "string") return logStringMessage(this, "trace", message, values[0]);
		else if (typeof message === "function") this.logLazily("trace", message);
		else if (!Array.isArray(message)) this.log("trace", "{*}", message);
		else this.logTemplate("trace", message, values);
	}
	debug(message, ...values) {
		if (typeof message === "string") return logStringMessage(this, "debug", message, values[0]);
		else if (typeof message === "function") this.logLazily("debug", message);
		else if (!Array.isArray(message)) this.log("debug", "{*}", message);
		else this.logTemplate("debug", message, values);
	}
	info(message, ...values) {
		if (typeof message === "string") return logStringMessage(this, "info", message, values[0]);
		else if (typeof message === "function") this.logLazily("info", message);
		else if (!Array.isArray(message)) this.log("info", "{*}", message);
		else this.logTemplate("info", message, values);
	}
	logError(level, error, props) {
		if (typeof props !== "function") {
			this.log(level, "{error.message}", {
				...props,
				error
			});
			return;
		}
		if (!this.isEnabledFor(level)) return Promise.resolve();
		const result = props();
		if (result instanceof Promise) return result.then((resolved) => {
			this.log(level, "{error.message}", {
				...resolved,
				error
			});
		});
		this.log(level, "{error.message}", {
			...result,
			error
		});
	}
	warn(message, ...values) {
		if (message instanceof Error) return this.logError("warning", message, values[0]);
		else if (typeof message === "string" && values[0] instanceof Error) this.log("warning", message, { error: values[0] });
		else if (typeof message === "string") return logStringMessage(this, "warning", message, values[0]);
		else if (typeof message === "function") this.logLazily("warning", message);
		else if (!Array.isArray(message)) this.log("warning", "{*}", message);
		else this.logTemplate("warning", message, values);
	}
	warning(message, ...values) {
		if (message instanceof Error) return this.logError("warning", message, values[0]);
		else if (typeof message === "string" && values[0] instanceof Error) this.log("warning", message, { error: values[0] });
		else if (typeof message === "string") return logStringMessage(this, "warning", message, values[0]);
		else if (typeof message === "function") this.logLazily("warning", message);
		else if (!Array.isArray(message)) this.log("warning", "{*}", message);
		else this.logTemplate("warning", message, values);
	}
	error(message, ...values) {
		if (message instanceof Error) return this.logError("error", message, values[0]);
		else if (typeof message === "string" && values[0] instanceof Error) this.log("error", message, { error: values[0] });
		else if (typeof message === "string") return logStringMessage(this, "error", message, values[0]);
		else if (typeof message === "function") this.logLazily("error", message);
		else if (!Array.isArray(message)) this.log("error", "{*}", message);
		else this.logTemplate("error", message, values);
	}
	fatal(message, ...values) {
		if (message instanceof Error) return this.logError("fatal", message, values[0]);
		else if (typeof message === "string" && values[0] instanceof Error) this.log("fatal", message, { error: values[0] });
		else if (typeof message === "string") return logStringMessage(this, "fatal", message, values[0]);
		else if (typeof message === "function") this.logLazily("fatal", message);
		else if (!Array.isArray(message)) this.log("fatal", "{*}", message);
		else this.logTemplate("fatal", message, values);
	}
};
/**
* A logger implementation with contextual properties.  Do not use this
* directly; use {@link Logger.with} instead.  This class is exported
* for testing purposes.
*/
var LoggerCtx = class LoggerCtx {
	logger;
	properties;
	constructor(logger, properties) {
		this.logger = logger;
		this.properties = properties;
	}
	get category() {
		return this.logger.category;
	}
	get parent() {
		return this.logger.parent;
	}
	getChild(subcategory) {
		return this.logger.getChild(subcategory).with(this.properties);
	}
	with(properties) {
		return new LoggerCtx(this.logger, {
			...this.properties,
			...properties
		});
	}
	log(level, message, properties, bypassSinks) {
		const contextProps = this.properties;
		this.logger.log(level, message, typeof properties === "function" ? () => resolveProperties({
			...contextProps,
			...properties()
		}) : () => resolveProperties({
			...contextProps,
			...properties
		}), bypassSinks);
	}
	logLazily(level, callback) {
		this.logger.logLazily(level, callback, resolveProperties(this.properties));
	}
	logTemplate(level, messageTemplate, values) {
		this.logger.logTemplate(level, messageTemplate, values, resolveProperties(this.properties));
	}
	emit(record) {
		const recordWithContext = {
			...record,
			properties: resolveProperties({
				...this.properties,
				...record.properties
			})
		};
		this.logger.emit(recordWithContext);
	}
	isEnabledFor(level) {
		return this.logger.isEnabledFor(level);
	}
	trace(message, ...values) {
		if (typeof message === "string") return logStringMessage(this, "trace", message, values[0]);
		else if (typeof message === "function") this.logLazily("trace", message);
		else if (!Array.isArray(message)) this.log("trace", "{*}", message);
		else this.logTemplate("trace", message, values);
	}
	debug(message, ...values) {
		if (typeof message === "string") return logStringMessage(this, "debug", message, values[0]);
		else if (typeof message === "function") this.logLazily("debug", message);
		else if (!Array.isArray(message)) this.log("debug", "{*}", message);
		else this.logTemplate("debug", message, values);
	}
	info(message, ...values) {
		if (typeof message === "string") return logStringMessage(this, "info", message, values[0]);
		else if (typeof message === "function") this.logLazily("info", message);
		else if (!Array.isArray(message)) this.log("info", "{*}", message);
		else this.logTemplate("info", message, values);
	}
	logError(level, error, props) {
		if (typeof props !== "function") {
			this.log(level, "{error.message}", {
				...props,
				error
			});
			return;
		}
		if (!this.isEnabledFor(level)) return Promise.resolve();
		const result = props();
		if (result instanceof Promise) return result.then((resolved) => {
			this.log(level, "{error.message}", {
				...resolved,
				error
			});
		});
		this.log(level, "{error.message}", {
			...result,
			error
		});
	}
	warn(message, ...values) {
		if (message instanceof Error) return this.logError("warning", message, values[0]);
		else if (typeof message === "string" && values[0] instanceof Error) this.log("warning", message, { error: values[0] });
		else if (typeof message === "string") return logStringMessage(this, "warning", message, values[0]);
		else if (typeof message === "function") this.logLazily("warning", message);
		else if (!Array.isArray(message)) this.log("warning", "{*}", message);
		else this.logTemplate("warning", message, values);
	}
	warning(message, ...values) {
		if (message instanceof Error) return this.logError("warning", message, values[0]);
		else if (typeof message === "string" && values[0] instanceof Error) this.log("warning", message, { error: values[0] });
		else if (typeof message === "string") return logStringMessage(this, "warning", message, values[0]);
		else if (typeof message === "function") this.logLazily("warning", message);
		else if (!Array.isArray(message)) this.log("warning", "{*}", message);
		else this.logTemplate("warning", message, values);
	}
	error(message, ...values) {
		if (message instanceof Error) return this.logError("error", message, values[0]);
		else if (typeof message === "string" && values[0] instanceof Error) this.log("error", message, { error: values[0] });
		else if (typeof message === "string") return logStringMessage(this, "error", message, values[0]);
		else if (typeof message === "function") this.logLazily("error", message);
		else if (!Array.isArray(message)) this.log("error", "{*}", message);
		else this.logTemplate("error", message, values);
	}
	fatal(message, ...values) {
		if (message instanceof Error) return this.logError("fatal", message, values[0]);
		else if (typeof message === "string" && values[0] instanceof Error) this.log("fatal", message, { error: values[0] });
		else if (typeof message === "string") return logStringMessage(this, "fatal", message, values[0]);
		else if (typeof message === "function") this.logLazily("fatal", message);
		else if (!Array.isArray(message)) this.log("fatal", "{*}", message);
		else this.logTemplate("fatal", message, values);
	}
};
/**
* The meta logger.  It is a logger with the category `["logtape", "meta"]`.
*/
const metaLogger = LoggerImpl.getLogger(["logtape", "meta"]);
/**
* Check if a property access key contains nested access patterns.
* @param key The property key to check.
* @returns True if the key contains nested access patterns.
*/
function isNestedAccess(key) {
	return key.includes(".") || key.includes("[") || key.includes("?.");
}
/**
* Safely access an own property from an object, blocking prototype pollution.
*
* @param obj The object to access the property from.
* @param key The property key to access.
* @returns The property value or undefined if not accessible.
*/
function getOwnProperty(obj, key) {
	if (key === "__proto__" || key === "prototype" || key === "constructor") return void 0;
	if ((typeof obj === "object" || typeof obj === "function") && obj !== null) return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : void 0;
	return void 0;
}
/**
* Parse the next segment from a property path string.
*
* @param path The full property path string.
* @param fromIndex The index to start parsing from.
* @returns The parsed segment and next index, or null if parsing fails.
*/
function parseNextSegment(path, fromIndex) {
	const len = path.length;
	let i = fromIndex;
	if (i >= len) return null;
	let segment;
	if (path[i] === "[") {
		i++;
		if (i >= len) return null;
		if (path[i] === "\"" || path[i] === "'") {
			const quote = path[i];
			i++;
			let segmentStr = "";
			while (i < len && path[i] !== quote) if (path[i] === "\\") {
				i++;
				if (i < len) {
					const escapeChar = path[i];
					switch (escapeChar) {
						case "n":
							segmentStr += "\n";
							break;
						case "t":
							segmentStr += "	";
							break;
						case "r":
							segmentStr += "\r";
							break;
						case "b":
							segmentStr += "\b";
							break;
						case "f":
							segmentStr += "\f";
							break;
						case "v":
							segmentStr += "\v";
							break;
						case "0":
							segmentStr += "\0";
							break;
						case "\\":
							segmentStr += "\\";
							break;
						case "\"":
							segmentStr += "\"";
							break;
						case "'":
							segmentStr += "'";
							break;
						case "u":
							if (i + 4 < len) {
								const hex = path.slice(i + 1, i + 5);
								const codePoint = Number.parseInt(hex, 16);
								if (!Number.isNaN(codePoint)) {
									segmentStr += String.fromCharCode(codePoint);
									i += 4;
								} else segmentStr += escapeChar;
							} else segmentStr += escapeChar;
							break;
						default: segmentStr += escapeChar;
					}
					i++;
				}
			} else {
				segmentStr += path[i];
				i++;
			}
			if (i >= len) return null;
			segment = segmentStr;
			i++;
		} else {
			const startIndex = i;
			while (i < len && path[i] !== "]" && path[i] !== "'" && path[i] !== "\"") i++;
			if (i >= len) return null;
			const indexStr = path.slice(startIndex, i);
			if (indexStr.length === 0) return null;
			const indexNum = Number(indexStr);
			segment = Number.isNaN(indexNum) ? indexStr : indexNum;
		}
		while (i < len && path[i] !== "]") i++;
		if (i < len) i++;
	} else {
		const startIndex = i;
		while (i < len && path[i] !== "." && path[i] !== "[" && path[i] !== "?" && path[i] !== "]") i++;
		segment = path.slice(startIndex, i);
		if (segment.length === 0) return null;
	}
	if (i < len && path[i] === ".") i++;
	return {
		segment,
		nextIndex: i
	};
}
/**
* Access a property or index on an object or array.
*
* @param obj The object or array to access.
* @param segment The property key or array index.
* @returns The accessed value or undefined if not accessible.
*/
function accessProperty(obj, segment) {
	if (typeof segment === "string") return getOwnProperty(obj, segment);
	if (Array.isArray(obj) && segment >= 0 && segment < obj.length) return obj[segment];
	return void 0;
}
/**
* Resolve a nested property path from an object.
*
* There are two types of property access patterns:
* 1. Array/index access: [0] or ["prop"]
* 2. Property access: prop or prop?.next
*
* @param obj The object to traverse.
* @param path The property path (e.g., "user.name", "users[0].email", "user['full-name']").
* @returns The resolved value or undefined if path doesn't exist.
*/
function resolvePropertyPath(obj, path) {
	if (obj == null) return void 0;
	if (path.length === 0 || path.endsWith(".")) return void 0;
	let current = obj;
	let i = 0;
	const len = path.length;
	while (i < len) {
		const isOptional = path.slice(i, i + 2) === "?.";
		if (isOptional) {
			i += 2;
			if (current == null) return void 0;
		} else if (current == null) return void 0;
		const result = parseNextSegment(path, i);
		if (result === null) return void 0;
		const { segment, nextIndex } = result;
		i = nextIndex;
		current = accessProperty(current, segment);
		if (current === void 0) return void 0;
	}
	return current;
}
/**
* Parse a message template into a message template array and a values array.
*
* Placeholders to be replaced with `values` are indicated by keys in curly braces
* (e.g., `{value}`). The system supports both simple property access and nested
* property access patterns:
*
* **Simple property access:**
* ```ts
* parseMessageTemplate("Hello, {user}!", { user: "foo" })
* // Returns: ["Hello, ", "foo", "!"]
* ```
*
* **Nested property access (dot notation):**
* ```ts
* parseMessageTemplate("Hello, {user.name}!", {
*   user: { name: "foo", email: "foo@example.com" }
* })
* // Returns: ["Hello, ", "foo", "!"]
* ```
*
* **Array indexing:**
* ```ts
* parseMessageTemplate("First: {users[0]}", {
*   users: ["foo", "bar", "baz"]
* })
* // Returns: ["First: ", "foo", ""]
* ```
*
* **Bracket notation for special property names:**
* ```ts
* parseMessageTemplate("Name: {user[\"full-name\"]}", {
*   user: { "full-name": "foo bar" }
* })
* // Returns: ["Name: ", "foo bar", ""]
* ```
*
* **Optional chaining for safe navigation:**
* ```ts
* parseMessageTemplate("Email: {user?.profile?.email}", {
*   user: { name: "foo" }
* })
* // Returns: ["Email: ", undefined, ""]
* ```
*
* **Wildcard patterns:**
* - `{*}` - Replaced with the entire properties object
* - `{ key-with-whitespace }` - Whitespace is trimmed when looking up keys
*
* **Escaping:**
* - `{{` and `}}` are escaped literal braces
*
* **Error handling:**
* - Non-existent paths return `undefined`
* - Malformed expressions resolve to `undefined` without throwing errors
* - Out of bounds array access returns `undefined`
*
* @param template The message template string containing placeholders.
* @param properties The values to replace placeholders with.
* @returns The message template array with values interleaved between text segments.
*/
function parseMessageTemplate(template, properties) {
	const length = template.length;
	if (length === 0) return [""];
	if (!template.includes("{")) return [template];
	const message = [];
	let startIndex = 0;
	for (let i = 0; i < length; i++) {
		const char = template[i];
		if (char === "{") {
			const nextChar = i + 1 < length ? template[i + 1] : "";
			if (nextChar === "{") {
				i++;
				continue;
			}
			const closeIndex = template.indexOf("}", i + 1);
			if (closeIndex === -1) continue;
			const beforeText = template.slice(startIndex, i);
			message.push(beforeText.replace(/{{/g, "{").replace(/}}/g, "}"));
			const key = template.slice(i + 1, closeIndex);
			let prop;
			const trimmedKey = key.trim();
			if (trimmedKey === "*") prop = key in properties ? properties[key] : "*" in properties ? properties["*"] : properties;
			else {
				if (key !== trimmedKey) prop = key in properties ? properties[key] : properties[trimmedKey];
				else prop = properties[key];
				if (prop === void 0 && isNestedAccess(trimmedKey)) prop = resolvePropertyPath(properties, trimmedKey);
			}
			message.push(prop);
			i = closeIndex;
			startIndex = i + 1;
		} else if (char === "}" && i + 1 < length && template[i + 1] === "}") i++;
	}
	const remainingText = template.slice(startIndex);
	message.push(remainingText.replace(/{{/g, "{").replace(/}}/g, "}"));
	return message;
}
/**
* Render a message template with values.
* @param template The message template.
* @param values The message template values.
* @returns The message template values interleaved between the substitution
*          values.
*/
function renderMessage(template, values) {
	const args = [];
	for (let i = 0; i < template.length; i++) {
		args.push(template[i]);
		if (i < values.length) args.push(values[i]);
	}
	return args;
}

//#endregion
export { LoggerImpl, getLogger, isLazy, lazy };
//# sourceMappingURL=logger.js.map