const require_filter = require('./filter.cjs');
const require_logger = require('./logger.cjs');
const require_sink = require('./sink.cjs');

//#region src/config.ts
/**
* The current configuration, if any.  Otherwise, `null`.
*/
let currentConfig = null;
/**
* Strong references to the loggers.
* This is to prevent the loggers from being garbage collected so that their
* sinks and filters are not removed.
*/
const strongRefs = /* @__PURE__ */ new Set();
/**
* Sync filter disposables to dispose when resetting the configuration.
*/
const filterDisposables = /* @__PURE__ */ new Set();
/**
* Sync sink disposables to dispose when resetting the configuration.
*/
const sinkDisposables = /* @__PURE__ */ new Set();
/**
* Async filter disposables to dispose when resetting the configuration.
*/
const asyncFilterDisposables = /* @__PURE__ */ new Set();
/**
* Async sink disposables to dispose when resetting the configuration.
*/
const asyncSinkDisposables = /* @__PURE__ */ new Set();
let unregisterDisposeHook;
/**
* Check if a config is for the meta logger.
*/
function isLoggerConfigMeta(cfg) {
	const category = Array.isArray(cfg.category) ? cfg.category : [cfg.category];
	return category.length === 0 || category.length === 1 && category[0] === "logtape" || category.length === 2 && category[0] === "logtape" && category[1] === "meta";
}
function registerDisposeHook(allowAsync) {
	unregisterDisposeHook?.();
	unregisterDisposeHook = void 0;
	const handler = allowAsync ? dispose : disposeSync;
	if (typeof globalThis.EdgeRuntime !== "string" && "process" in globalThis && !("Deno" in globalThis)) {
		const proc = globalThis.process;
		const onMethod = proc?.["on"];
		if (typeof onMethod === "function") {
			onMethod.call(proc, "exit", handler);
			unregisterDisposeHook = () => {
				const offMethod = proc?.["off"] ?? proc?.["removeListener"];
				if (typeof offMethod === "function") offMethod.call(proc, "exit", handler);
			};
			return;
		}
	}
	const addEventListenerMethod = globalThis.addEventListener;
	if (typeof addEventListenerMethod !== "function") return;
	const removeEventListenerMethod = globalThis.removeEventListener;
	if ("Deno" in globalThis) {
		addEventListenerMethod.call(globalThis, "unload", handler);
		if (typeof removeEventListenerMethod === "function") unregisterDisposeHook = () => {
			removeEventListenerMethod.call(globalThis, "unload", handler);
		};
	} else {
		addEventListenerMethod.call(globalThis, "pagehide", handler);
		if (typeof removeEventListenerMethod === "function") unregisterDisposeHook = () => {
			removeEventListenerMethod.call(globalThis, "pagehide", handler);
		};
	}
}
/**
* Configure the loggers with the specified configuration.
*
* Note that if the given sinks or filters are disposable, they will be
* disposed when the configuration is reset, or when the process exits.
*
* @example
* ```typescript
* await configure({
*   sinks: {
*     console: getConsoleSink(),
*   },
*   filters: {
*     slow: (log) =>
*       "duration" in log.properties &&
*       log.properties.duration as number > 1000,
*   },
*   loggers: [
*     {
*       category: "my-app",
*       sinks: ["console"],
*       lowestLevel: "info",
*     },
*     {
*       category: ["my-app", "sql"],
*       filters: ["slow"],
*       lowestLevel: "debug",
*     },
*     {
*       category: "logtape",
*       sinks: ["console"],
*       lowestLevel: "error",
*     },
*   ],
* });
* ```
*
* @param config The configuration.
*/
async function configure(config) {
	if (currentConfig != null && !config.reset) throw new ConfigError("Already configured; if you want to reset, turn on the reset flag.");
	await reset();
	try {
		configureInternal(config, true);
	} catch (e) {
		if (e instanceof ConfigError) await reset();
		throw e;
	}
}
/**
* Configure sync loggers with the specified configuration.
*
* Note that if the given sinks or filters are disposable, they will be
* disposed when the configuration is reset, or when the process exits.
*
* Also note that passing async sinks or filters will throw. If
* necessary use {@link resetSync} or {@link disposeSync}.
*
* @example
* ```typescript
* configureSync({
*   sinks: {
*     console: getConsoleSink(),
*   },
*   loggers: [
*     {
*       category: "my-app",
*       sinks: ["console"],
*       lowestLevel: "info",
*     },
*     {
*       category: "logtape",
*       sinks: ["console"],
*       lowestLevel: "error",
*     },
*   ],
* });
* ```
*
* @param config The configuration.
* @since 0.9.0
*/
function configureSync(config) {
	if (currentConfig != null && !config.reset) throw new ConfigError("Already configured; if you want to reset, turn on the reset flag.");
	if (asyncFilterDisposables.size > 0 || asyncSinkDisposables.size > 0) throw new ConfigError("Previously configured async disposables are still active. Use configure() instead or explicitly dispose them using dispose().");
	resetSync();
	try {
		configureInternal(config, false);
	} catch (e) {
		if (e instanceof ConfigError) resetSync();
		throw e;
	}
}
function configureInternal(config, allowAsync) {
	currentConfig = config;
	let metaConfigured = false;
	const configuredCategories = /* @__PURE__ */ new Set();
	for (const cfg of config.loggers) {
		if (isLoggerConfigMeta(cfg)) metaConfigured = true;
		const categoryKey = Array.isArray(cfg.category) ? JSON.stringify(cfg.category) : JSON.stringify([cfg.category]);
		if (configuredCategories.has(categoryKey)) throw new ConfigError(`Duplicate logger configuration for category: ${categoryKey}. Each category can only be configured once.`);
		configuredCategories.add(categoryKey);
		const logger = require_logger.LoggerImpl.getLogger(cfg.category);
		for (const sinkId of cfg.sinks ?? []) {
			const sink = config.sinks[sinkId];
			if (!sink) throw new ConfigError(`Sink not found: ${sinkId}.`);
			logger.sinks.push(sink);
		}
		logger.parentSinks = cfg.parentSinks ?? "inherit";
		if (cfg.lowestLevel !== void 0) logger.lowestLevel = cfg.lowestLevel;
		for (const filterId of cfg.filters ?? []) {
			const filter = config.filters?.[filterId];
			if (filter === void 0) throw new ConfigError(`Filter not found: ${filterId}.`);
			logger.filters.push(require_filter.toFilter(filter));
		}
		strongRefs.add(logger);
	}
	require_logger.LoggerImpl.getLogger().contextLocalStorage = config.contextLocalStorage;
	for (const sink of Object.values(config.sinks)) {
		if (Symbol.asyncDispose in sink) if (allowAsync) asyncSinkDisposables.add(sink);
		else throw new ConfigError("Async disposables cannot be used with configureSync().");
		if (Symbol.dispose in sink) sinkDisposables.add(sink);
	}
	for (const filter of Object.values(config.filters ?? {})) {
		if (filter == null || typeof filter === "string") continue;
		if (Symbol.asyncDispose in filter) {
			if (allowAsync) asyncFilterDisposables.add(filter);
			else throw new ConfigError("Async disposables cannot be used with configureSync().");
			asyncSinkDisposables.delete(filter);
		}
		if (Symbol.dispose in filter) {
			filterDisposables.add(filter);
			sinkDisposables.delete(filter);
		}
	}
	registerDisposeHook(allowAsync);
	const meta = require_logger.LoggerImpl.getLogger(["logtape", "meta"]);
	if (!metaConfigured) meta.sinks.push(require_sink.getConsoleSink());
	meta.info("LogTape loggers are configured.  Note that LogTape itself uses the meta logger, which has category {metaLoggerCategory}.  The meta logger is used to log internal diagnostics such as sink exceptions.  It's recommended to configure the meta logger with a separate sink so that you can easily notice if logging itself fails or is misconfigured.  To turn off this message, configure the meta logger with higher log levels than {dismissLevel}.  See also <https://logtape.org/manual/categories#meta-logger>.", {
		metaLoggerCategory: ["logtape", "meta"],
		dismissLevel: "info"
	});
}
/**
* Get the current configuration, if any.  Otherwise, `null`.
* @returns The current configuration, if any.  Otherwise, `null`.
*/
function getConfig() {
	return currentConfig;
}
/**
* Reset the configuration.  Mostly for testing purposes.
*/
async function reset() {
	await dispose();
	resetInternal();
}
/**
* Reset the configuration.  Mostly for testing purposes. Will not clear async
* sinks, only use with sync sinks. Use {@link reset} if you have async sinks.
* @since 0.9.0
*/
function resetSync() {
	disposeSync();
	resetInternal();
}
function resetInternal() {
	unregisterDisposeHook?.();
	unregisterDisposeHook = void 0;
	const rootLogger = require_logger.LoggerImpl.getLogger([]);
	rootLogger.resetDescendants();
	delete rootLogger.contextLocalStorage;
	strongRefs.clear();
	currentConfig = null;
}
/**
* Dispose of the disposables.
*/
async function dispose() {
	const errors = [];
	try {
		disposeSyncFilters();
	} catch (error) {
		errors.push(error);
	}
	try {
		await disposeAsyncFilters();
	} catch (error) {
		errors.push(error);
	}
	try {
		disposeSyncSinks();
	} catch (error) {
		errors.push(error);
	}
	try {
		await disposeAsyncSinks();
	} catch (error) {
		errors.push(error);
	}
	throwDisposeErrors(errors);
}
/**
* Dispose of the sync disposables. Async disposables will be untouched,
* use {@link dispose} if you have async sinks.
* @since 0.9.0
*/
function disposeSync() {
	const errors = [];
	try {
		disposeSyncFilters();
	} catch (error) {
		errors.push(error);
	}
	try {
		disposeSyncSinks();
	} catch (error) {
		errors.push(error);
	}
	throwDisposeErrors(errors);
}
function disposeSyncFilters() {
	disposeSyncDisposables(filterDisposables);
}
function disposeSyncSinks() {
	disposeSyncDisposables(sinkDisposables);
}
function disposeSyncDisposables(disposables) {
	const errors = [];
	try {
		for (const disposable of disposables) try {
			disposable[Symbol.dispose]();
		} catch (error) {
			errors.push(error);
		} finally {
			disposables.delete(disposable);
		}
	} finally {
		disposables.clear();
	}
	throwDisposeErrors(errors);
}
async function disposeAsyncFilters() {
	await disposeAsyncDisposables(asyncFilterDisposables);
}
async function disposeAsyncSinks() {
	await disposeAsyncDisposables(asyncSinkDisposables);
}
async function disposeAsyncDisposables(disposables) {
	const promises = [];
	try {
		for (const disposable of disposables) try {
			promises.push(Promise.resolve(disposable[Symbol.asyncDispose]()));
		} catch (error) {
			promises.push(Promise.reject(error));
		} finally {
			disposables.delete(disposable);
		}
	} finally {
		disposables.clear();
	}
	await settleDisposePromises(promises);
}
async function settleDisposePromises(promises) {
	const results = await Promise.allSettled(promises);
	throwDisposeErrors(results.filter((result) => result.status === "rejected").map((result) => result.reason));
}
function throwDisposeErrors(errors) {
	if (errors.length < 1) return;
	if (errors.length === 1) throw errors[0];
	throw new AggregateError(errors, "Multiple errors occurred while disposing LogTape resources.");
}
/**
* A configuration error.
*/
var ConfigError = class extends Error {
	/**
	* Constructs a new configuration error.
	* @param message The error message.
	*/
	constructor(message) {
		super(message);
		this.name = "ConfigError";
	}
};

//#endregion
exports.ConfigError = ConfigError;
exports.configure = configure;
exports.configureSync = configureSync;
exports.dispose = dispose;
exports.disposeSync = disposeSync;
exports.getConfig = getConfig;
exports.reset = reset;
exports.resetSync = resetSync;