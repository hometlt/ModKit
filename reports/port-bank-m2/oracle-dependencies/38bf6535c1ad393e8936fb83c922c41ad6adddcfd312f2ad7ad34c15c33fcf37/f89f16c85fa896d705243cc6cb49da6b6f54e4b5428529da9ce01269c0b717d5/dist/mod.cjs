const require_rolldown_runtime = require('./_virtual/rolldown_runtime.cjs');
const require_streamfilesink = require('./streamfilesink.cjs');
const __filesink = require_rolldown_runtime.__toESM(require("#filesink"));

Object.defineProperty(exports, 'getFileSink', {
  enumerable: true,
  get: function () {
    return __filesink.getFileSink;
  }
});
Object.defineProperty(exports, 'getRotatingFileSink', {
  enumerable: true,
  get: function () {
    return __filesink.getRotatingFileSink;
  }
});
exports.getStreamFileSink = require_streamfilesink.getStreamFileSink;
Object.defineProperty(exports, 'getTimeRotatingFileSink', {
  enumerable: true,
  get: function () {
    return __filesink.getTimeRotatingFileSink;
  }
});