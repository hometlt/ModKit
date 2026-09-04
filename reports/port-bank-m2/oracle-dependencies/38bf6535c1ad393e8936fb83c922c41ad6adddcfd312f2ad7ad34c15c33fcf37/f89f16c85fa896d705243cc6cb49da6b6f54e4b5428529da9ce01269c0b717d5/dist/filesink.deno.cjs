const require_join = require('./node_modules/.pnpm/@jsr_std__path@1.1.0/node_modules/@jsr/std__path/join.cjs');
const require_filesink_base = require('./filesink.base.cjs');
const require_timefilesink = require('./timefilesink.cjs');

//#region src/filesink.deno.ts
/**
* A Deno-specific file sink driver.
*/
const denoDriver = {
	openSync(path) {
		return Deno.openSync(path, {
			create: true,
			append: true
		});
	},
	writeSync(fd, chunk) {
		fd.writeSync(chunk);
	},
	writeManySync(fd, chunks) {
		for (const chunk of chunks) fd.writeSync(chunk);
	},
	flushSync(fd) {
		fd.syncSync();
	},
	closeSync(fd) {
		fd.close();
	},
	statSync: globalThis?.Deno.statSync,
	renameSync: globalThis?.Deno.renameSync,
	unlinkSync: globalThis?.Deno.removeSync
};
/**
* A Deno-specific async file sink driver.
* @since 1.0.0
*/
const denoAsyncDriver = {
	...denoDriver,
	async writeMany(fd, chunks) {
		for (const chunk of chunks) await fd.write(chunk);
	},
	async flush(fd) {
		await fd.sync();
	},
	close(fd) {
		return Promise.resolve(fd.close());
	}
};
/**
* A Deno-specific time-rotating file sink driver.
* @since 2.0.0
*/
const denoTimeDriver = {
	...denoDriver,
	readdirSync(path) {
		return [...Deno.readDirSync(path)].map((entry) => entry.name);
	},
	unlinkSync: globalThis?.Deno.removeSync,
	mkdirSync(path, options) {
		Deno.mkdirSync(path, options);
	},
	joinPath: require_join.join
};
/**
* A Deno-specific async time-rotating file sink driver.
* @since 2.0.0
*/
const denoAsyncTimeDriver = {
	...denoAsyncDriver,
	readdirSync(path) {
		return [...Deno.readDirSync(path)].map((entry) => entry.name);
	},
	unlinkSync: globalThis?.Deno.removeSync,
	mkdirSync(path, options) {
		Deno.mkdirSync(path, options);
	},
	joinPath: require_join.join
};
function getFileSink(path, options = {}) {
	if (options.nonBlocking) return require_filesink_base.getBaseFileSink(path, {
		...options,
		...denoAsyncDriver
	});
	return require_filesink_base.getBaseFileSink(path, {
		...options,
		...denoDriver
	});
}
function getRotatingFileSink(path, options = {}) {
	if (options.nonBlocking) return require_filesink_base.getBaseRotatingFileSink(path, {
		...options,
		...denoAsyncDriver
	});
	return require_filesink_base.getBaseRotatingFileSink(path, {
		...options,
		...denoDriver
	});
}
function getTimeRotatingFileSink(options) {
	if (options.nonBlocking) {
		const driver$1 = {
			...denoAsyncTimeDriver,
			statSync: globalThis?.Deno.statSync
		};
		return require_timefilesink.getBaseTimeRotatingFileSink({
			...options,
			...driver$1
		});
	}
	const driver = {
		...denoTimeDriver,
		statSync: globalThis?.Deno.statSync
	};
	return require_timefilesink.getBaseTimeRotatingFileSink({
		...options,
		...driver
	});
}

//#endregion
exports.denoAsyncDriver = denoAsyncDriver;
exports.denoAsyncTimeDriver = denoAsyncTimeDriver;
exports.denoDriver = denoDriver;
exports.denoTimeDriver = denoTimeDriver;
exports.getFileSink = getFileSink;
exports.getRotatingFileSink = getRotatingFileSink;
exports.getTimeRotatingFileSink = getTimeRotatingFileSink;