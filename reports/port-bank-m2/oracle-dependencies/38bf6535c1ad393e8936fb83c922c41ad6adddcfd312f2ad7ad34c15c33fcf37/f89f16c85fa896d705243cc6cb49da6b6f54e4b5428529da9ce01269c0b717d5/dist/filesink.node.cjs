const require_rolldown_runtime = require('./_virtual/rolldown_runtime.cjs');
const require_filesink_base = require('./filesink.base.cjs');
const require_timefilesink = require('./timefilesink.cjs');
const node_fs = require_rolldown_runtime.__toESM(require("node:fs"));
const node_path = require_rolldown_runtime.__toESM(require("node:path"));
const node_util = require_rolldown_runtime.__toESM(require("node:util"));

//#region src/filesink.node.ts
/**
* A Node.js-specific file sink driver.
*/
const nodeDriver = {
	openSync(path) {
		return node_fs.default.openSync(path, "a");
	},
	writeSync: node_fs.default.writeSync,
	writeManySync(fd, chunks) {
		if (chunks.length === 0) return;
		if (chunks.length === 1) {
			node_fs.default.writeSync(fd, chunks[0]);
			return;
		}
		node_fs.default.writevSync(fd, chunks);
	},
	flushSync: node_fs.default.fsyncSync,
	closeSync: node_fs.default.closeSync,
	statSync: node_fs.default.statSync,
	renameSync: node_fs.default.renameSync,
	unlinkSync: node_fs.default.unlinkSync
};
/**
* A Node.js-specific async file sink driver.
* @since 1.0.0
*/
const nodeAsyncDriver = {
	...nodeDriver,
	async writeMany(fd, chunks) {
		if (chunks.length === 0) return;
		if (chunks.length === 1) {
			await (0, node_util.promisify)(node_fs.default.write)(fd, chunks[0]);
			return;
		}
		await (0, node_util.promisify)(node_fs.default.writev)(fd, chunks);
	},
	flush: (0, node_util.promisify)(node_fs.default.fsync),
	close: (0, node_util.promisify)(node_fs.default.close)
};
/**
* A Node.js-specific time-rotating file sink driver.
* @since 2.0.0
*/
const nodeTimeDriver = {
	...nodeDriver,
	readdirSync: node_fs.default.readdirSync,
	unlinkSync: node_fs.default.unlinkSync,
	mkdirSync: node_fs.default.mkdirSync,
	joinPath: node_path.join
};
/**
* A Node.js-specific async time-rotating file sink driver.
* @since 2.0.0
*/
const nodeAsyncTimeDriver = {
	...nodeAsyncDriver,
	readdirSync: node_fs.default.readdirSync,
	unlinkSync: node_fs.default.unlinkSync,
	mkdirSync: node_fs.default.mkdirSync,
	joinPath: node_path.join
};
function getFileSink(path, options = {}) {
	if (options.nonBlocking) return require_filesink_base.getBaseFileSink(path, {
		...options,
		...nodeAsyncDriver
	});
	return require_filesink_base.getBaseFileSink(path, {
		...options,
		...nodeDriver
	});
}
function getRotatingFileSink(path, options = {}) {
	if (options.nonBlocking) return require_filesink_base.getBaseRotatingFileSink(path, {
		...options,
		...nodeAsyncDriver
	});
	return require_filesink_base.getBaseRotatingFileSink(path, {
		...options,
		...nodeDriver
	});
}
function getTimeRotatingFileSink(options) {
	if (options.nonBlocking) {
		const driver$1 = {
			...nodeAsyncTimeDriver,
			statSync: node_fs.default.statSync
		};
		return require_timefilesink.getBaseTimeRotatingFileSink({
			...options,
			...driver$1
		});
	}
	const driver = {
		...nodeTimeDriver,
		statSync: node_fs.default.statSync
	};
	return require_timefilesink.getBaseTimeRotatingFileSink({
		...options,
		...driver
	});
}

//#endregion
exports.getFileSink = getFileSink;
exports.getRotatingFileSink = getRotatingFileSink;
exports.getTimeRotatingFileSink = getTimeRotatingFileSink;
exports.nodeAsyncDriver = nodeAsyncDriver;
exports.nodeAsyncTimeDriver = nodeAsyncTimeDriver;
exports.nodeDriver = nodeDriver;
exports.nodeTimeDriver = nodeTimeDriver;