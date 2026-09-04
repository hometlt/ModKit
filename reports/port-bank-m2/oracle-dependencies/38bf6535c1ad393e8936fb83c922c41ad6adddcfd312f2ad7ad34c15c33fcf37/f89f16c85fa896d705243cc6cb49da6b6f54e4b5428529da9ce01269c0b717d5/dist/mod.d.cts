import { FileSinkDriver, FileSinkOptions, RotatingFileSinkDriver, RotatingFileSinkOptions } from "./filesink.base.cjs";
import { TimeRotatingFileSinkOptions, TimeRotationInterval } from "./timefilesink.cjs";
import { StreamFileSinkOptions, getStreamFileSink } from "./streamfilesink.cjs";
import { getFileSink, getRotatingFileSink, getTimeRotatingFileSink } from "#filesink";
export { FileSinkDriver, FileSinkOptions, RotatingFileSinkDriver, RotatingFileSinkOptions, StreamFileSinkOptions, TimeRotatingFileSinkOptions, TimeRotationInterval, getFileSink, getRotatingFileSink, getStreamFileSink, getTimeRotatingFileSink };