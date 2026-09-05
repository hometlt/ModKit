import {
  ABI_CODEC_MODULE,
  ABI_SERVICE_PROVIDER_MODULE,
  createEndpoint,
  createStandardSurfaceRegistry,
  framePortFromMessagePort,
  protocolLimits
} from "./chunks/chunk-GUANBBUV.js";
import "./chunks/chunk-YFALMPQO.js";
import {
  ModkitError
} from "./chunks/chunk-S5ITZJYV.js";
import "./chunks/chunk-YRQVWMJF.js";
import "./chunks/chunk-CQ52GEHY.js";

// packages/host/dist/execution/frame-json.js
var LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// packages/host/dist/execution/module-reassembly.js
var unavailableResolver = {
  resolve: () => Promise.reject(new ModkitError({
    code: "x3.host/execution-backend-unavailable",
    message: "the host did not hand this worker a contract resolver"
  })),
  resolveUnknown: () => Promise.reject(new ModkitError({
    code: "x3.host/execution-backend-unavailable",
    message: "the host did not hand this worker a contract resolver"
  }))
};
function contributionContext(wire) {
  const sink = wire.diagnostics;
  return {
    budgets: wire.budgets,
    diagnostics: {
      report(diagnostic) {
        if (sink !== void 0)
          void sink.report(diagnostic).catch(() => void 0);
      }
    },
    contracts: wire.contracts ?? unavailableResolver,
    ...wire.providerIdentity === void 0 ? {} : { providerIdentity: Object.freeze({ ...wire.providerIdentity }) }
  };
}
function assetInput(wire) {
  const bindings = wire.bindings ?? [];
  const subjects = wire.subjects ?? [];
  return Object.assign(/* @__PURE__ */ Object.create(null), wire, {
    bindingsFor: (requirementId) => bindings.filter((binding) => binding.sourceKind === "requirement" && binding.requirementId === requirementId),
    subjectsFor: (requirementId) => subjects.filter((subject) => subject.requirementId === requirementId)
  });
}
function wrapServiceModule(module) {
  const createProvider = module["createProvider"];
  return {
    abiVersion: module["abiVersion"],
    provides: module["provides"],
    createProvider: (selection, wire) => createProvider.call(module, selection, contributionContext(wire))
  };
}
function wrapCodecModule(module) {
  const createCodec = module["createCodec"];
  return {
    abiVersion: module["abiVersion"],
    createCodec: typeof createCodec !== "function" ? void 0 : (wire) => {
      const codec = createCodec(contributionContext(wire));
      const open = codec["open"];
      return {
        ...codec,
        ...typeof open !== "function" ? {} : {
          open: (input, ...rest) => open.call(codec, assetInput(input), ...rest)
        }
      };
    }
  };
}
function wrapLoadedModule(module) {
  const isServiceModule = typeof module["createProvider"] === "function" && typeof module["createCodec"] !== "function";
  return {
    module: isServiceModule ? wrapServiceModule(module) : wrapCodecModule(module),
    surface: isServiceModule ? ABI_SERVICE_PROVIDER_MODULE : ABI_CODEC_MODULE
  };
}

// packages/host/dist/browser/worker-bootstrap-core.js
function runBrowserWorkerBootstrap(init) {
  let loads = 0;
  return createEndpoint({
    role: "worker",
    port: init.port,
    session: init.session,
    generation: init.generation,
    surfaces: createStandardSurfaceRegistry({ definitions: init.foreignSurfaces }),
    limits: protocolLimits(init.limits),
    loader: async (request) => {
      loads += 1;
      if (loads > 1) {
        throw new ModkitError({
          code: "x3.host/execution-load-rejected",
          message: "a worker serves exactly one load"
        });
      }
      if (request.moduleUrl !== init.moduleUrl) {
        throw new ModkitError({
          code: "x3.host/execution-load-rejected",
          message: "this worker evaluates exactly the verified module snapshot it was spawned with"
        });
      }
      const module = await import(
        /* @vite-ignore */
        init.moduleUrl
      );
      return { ...wrapLoadedModule(module), release: () => void 0 };
    },
    ...init.onTerminate === void 0 ? {} : { onTerminate: init.onTerminate },
    ...init.onFailure === void 0 ? {} : { onFailure: init.onFailure }
  });
}

// packages/host/dist/browser/worker-entry.js
function isInit(value) {
  return typeof value === "object" && value !== null && value.type === "x3.host/worker-init" && typeof value.session === "string" && typeof value.moduleUrl === "string" && typeof value.port === "object";
}
function installBrowserWorkerEntry(scope) {
  let started = false;
  const listener = (event) => {
    if (started || !isInit(event.data))
      return;
    started = true;
    scope.removeEventListener("message", listener);
    const init = event.data;
    runBrowserWorkerBootstrap({
      port: framePortFromMessagePort(init.port),
      session: init.session,
      generation: init.generation,
      limits: init.limits,
      foreignSurfaces: init.foreignSurfaces,
      moduleUrl: init.moduleUrl,
      onTerminate: () => scope.close(),
      onFailure: () => scope.close()
    });
  };
  scope.addEventListener("message", listener);
  return () => scope.removeEventListener("message", listener);
}
var workerScope = globalThis.self;
if (workerScope !== void 0 && typeof globalThis.WorkerGlobalScope === "function" && typeof workerScope.addEventListener === "function" && typeof workerScope.close === "function") {
  installBrowserWorkerEntry(workerScope);
}
export {
  installBrowserWorkerEntry
};
