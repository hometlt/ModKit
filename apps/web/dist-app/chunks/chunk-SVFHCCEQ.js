// ../../MODDING/modkit-core/packages/codec-kit/dist/logging.js
var loggerFactory;
function getLogger(category = []) {
  const invoke = (property, args) => {
    const target = loggerFactory?.(category);
    if (target === void 0)
      return void 0;
    const member = Reflect.get(target, property);
    return typeof member === "function" ? Reflect.apply(member, target, args) : member;
  };
  return new Proxy({}, {
    get(_target, property) {
      if (property === "isEnabledFor" && loggerFactory === void 0)
        return () => false;
      return (...args) => invoke(property, args);
    }
  });
}

export {
  getLogger
};
