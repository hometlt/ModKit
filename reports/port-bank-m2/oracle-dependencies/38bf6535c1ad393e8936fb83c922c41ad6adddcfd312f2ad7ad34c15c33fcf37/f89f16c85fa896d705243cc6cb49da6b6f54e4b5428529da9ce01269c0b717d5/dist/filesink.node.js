import { getBaseFileSink, getBaseRotatingFileSink } from "./filesink.base.js";
import { getBaseTimeRotatingFileSink } from "./timefilesink.js";
import fs from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

//#region src/filesink.node.ts
/**
* A Node.js-specific file sink driver.
*/
const nodeDriver = {
	openSync(path) {
		return fs.openSync(path, "a");
	},
	writeSync: fs.writeSync,
	writeManySync(fd, chunks) {
		if (chunks.length === 0) return;
		if (chunks.length === 1) {
			fs.writeSync(fd, chunks[0]);
			return;
		}
		fs.writevSync(fd, chunks);
	},
	flushSync: fs.fsyncSync,
	closeSync: fs.closeSync,
	statSync: fs.statSync,
	renameSync: fs.renameSync,
	unlinkSync: fs.unlinkSync
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
			await promisify(fs.write)(fd, chunks[0]);
			return;
		}
		await promisify(fs.writev)(fd, chunks);
	},
	flush: promisify(fs.fsync),
	close: promisify(fs.close)
};
/**
* A Node.js-specific time-rotating file sink driver.
* @since 2.0.0
*/
const nodeTimeDriver = {
	...nodeDriver,
	readdirSync: fs.readdirSync,
	unlinkSync: fs.unlinkSync,
	mkdirSync: fs.mkdirSync,
	joinPath: join
};
/**
* A Node.js-specific async time-rotating file sink driver.
* @since 2.0.0
*/
const nodeAsyncTimeDriver = {
	...nodeAsyncDriver,
	readdirSync: fs.readdirSync,
	unlinkSync: fs.unlinkSync,
	mkdirSync: fs.mkdirSync,
	joinPath: join
};
function getFileSink(path, options = {}) {
	if (options.nonBlocking) return getBaseFileSink(path, {
		...options,
		...nodeAsyncDriver
	});
	return getBaseFileSink(path, {
		...options,
		...nodeDriver
	});
}
function getRotatingFileSink(path, options = {}) {
	if (options.nonBlocking) return getBaseRotatingFileSink(path, {
		...options,
		...nodeAsyncDriver
	});
	return getBaseRotatingFileSink(path, {
		...options,
		...nodeDriver
	});
}
function getTimeRotatingFileSink(options) {
	if (options.nonBlocking) {
		const driver$1 = {
			...nodeAsyncTimeDriver,
			statSync: fs.statSync
		};
		return getBaseTimeRotatingFileSink({
			...options,
			...driver$1
		});
	}
	const driver = {
		...nodeTimeDriver,
		statSync: fs.statSync
	};
	return getBaseTimeRotatingFileSink({
		...options,
		...driver
	});
}

//#endregion
export { getFileSink, getRotatingFileSink, getTimeRotatingFileSink, nodeAsyncDriver, nodeAsyncTimeDriver, nodeDriver, nodeTimeDriver };
//# sourceMappingURL=filesink.node.js.map