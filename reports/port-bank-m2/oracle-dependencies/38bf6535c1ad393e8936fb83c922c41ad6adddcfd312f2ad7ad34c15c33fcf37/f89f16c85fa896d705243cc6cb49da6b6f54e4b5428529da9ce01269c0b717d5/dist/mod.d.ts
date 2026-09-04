import { FileSinkDriver, FileSinkOptions, RotatingFileSinkDriver, RotatingFileSinkOptions } from "./filesink.base.js";
import { TimeRotatingFileSinkOptions, TimeRotationInterval } from "./timefilesink.js";
import { StreamFileSinkOptions, getStreamFileSink } from "./streamfilesink.js";
import { getFileSink, getRotatingFileSink, getTimeRotatingFileSink } from "#filesink";
export { FileSinkDriver, FileSinkOptions, RotatingFileSinkDriver, RotatingFileSinkOptions, StreamFileSinkOptions, TimeRotatingFileSinkOptions, TimeRotationInterval, getFileSink, getRotatingFileSink, getStreamFileSink, getTimeRotatingFileSink };