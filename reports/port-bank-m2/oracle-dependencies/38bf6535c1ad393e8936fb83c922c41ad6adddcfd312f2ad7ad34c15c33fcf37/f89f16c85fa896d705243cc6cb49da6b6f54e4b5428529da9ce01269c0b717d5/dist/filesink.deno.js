import { join } from "./node_modules/.pnpm/@jsr_std__path@1.1.0/node_modules/@jsr/std__path/join.js";
import { getBaseFileSink, getBaseRotatingFileSink } from "./filesink.base.js";
import { getBaseTimeRotatingFileSink } from "./timefilesink.js";

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
	joinPath: join
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
	joinPath: join
};
function getFileSink(path, options = {}) {
	if (options.nonBlocking) return getBaseFileSink(path, {
		...options,
		...denoAsyncDriver
	});
	return getBaseFileSink(path, {
		...options,
		...denoDriver
	});
}
function getRotatingFileSink(path, options = {}) {
	if (options.nonBlocking) return getBaseRotatingFileSink(path, {
		...options,
		...denoAsyncDriver
	});
	return getBaseRotatingFileSink(path, {
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
		return getBaseTimeRotatingFileSink({
			...options,
			...driver$1
		});
	}
	const driver = {
		...denoTimeDriver,
		statSync: globalThis?.Deno.statSync
	};
	return getBaseTimeRotatingFileSink({
		...options,
		...driver
	});
}

//#endregion
export { denoAsyncDriver, denoAsyncTimeDriver, denoDriver, denoTimeDriver, getFileSink, getRotatingFileSink, getTimeRotatingFileSink };
//# sourceMappingURL=filesink.deno.js.map