// ../MODDING/modkit-core/packages/codec-kit/dist/legacy/core/errors.js
var ModkitError = class _ModkitError extends Error {
  code;
  context;
  hint;
  constructor(opts) {
    super(opts.message, opts.cause !== void 0 ? { cause: opts.cause } : void 0);
    this.name = "ModkitError";
    this.code = opts.code;
    this.context = opts.context;
    this.hint = opts.hint;
    Object.setPrototypeOf(this, _ModkitError.prototype);
  }
};

export {
  ModkitError
};
