//#region src/snapshot.ts
const immediateSinkSymbol = Symbol.for("LogTape.sinkSnapshotPolicy.immediate");
function markSinkAsImmediate(sink) {
	Object.defineProperty(sink, immediateSinkSymbol, { value: true });
	return sink;
}

//#endregion
export { markSinkAsImmediate };
//# sourceMappingURL=snapshot.js.map