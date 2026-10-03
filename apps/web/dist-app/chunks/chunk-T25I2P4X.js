import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../../MODDING/modkit-core/packages/ui/dist/model/orbit.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var PITCH_MINIMUM = -1.4;
var PITCH_MAXIMUM = 1.5;
var DRAG_RADIANS_PER_PIXEL = 8e-3;
var WHEEL_IN = 0.9;
var WHEEL_OUT = 1.1;
var DISTANCE_MINIMUM = 0.15;
var DISTANCE_MAXIMUM = 8;
var RESET_YAW = 0.7;
var RESET_PITCH = 0.45;
var clamp = (value, low, high) => Math.min(Math.max(value, low), high);
var POLE = Math.PI / 2 - 1e-3;
var AXIS_POSE = Object.freeze({
  "+x": [Math.PI / 2, 0],
  "-x": [-Math.PI / 2, 0],
  "+y": [0, POLE],
  "-y": [0, -POLE],
  "+z": [0, 0],
  "-z": [Math.PI, 0]
});
function createOrbitController(initial = {}) {
  let yaw = initial.yaw ?? RESET_YAW;
  let pitch = clamp(initial.pitch ?? RESET_PITCH, PITCH_MINIMUM, PITCH_MAXIMUM);
  let distanceScale = clamp(initial.distanceScale ?? 1, DISTANCE_MINIMUM, DISTANCE_MAXIMUM);
  const listeners = /* @__PURE__ */ new Set();
  const emit = () => {
    const pose = { yaw, pitch, distanceScale };
    for (const listener of listeners)
      listener(pose);
  };
  const controller = {
    get pose() {
      return { yaw, pitch, distanceScale };
    },
    position(target, radius) {
      const scaled = radius * distanceScale;
      return [
        target[0] + Math.sin(yaw) * Math.cos(pitch) * scaled,
        target[1] + Math.sin(pitch) * scaled,
        target[2] + Math.cos(yaw) * Math.cos(pitch) * scaled
      ];
    },
    basis() {
      const backward = [
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(yaw) * Math.cos(pitch)
      ];
      const horizontal = Math.hypot(backward[0], backward[2]) || 1;
      const right = [backward[2] / horizontal, 0, -backward[0] / horizontal];
      const up = [
        backward[1] * right[2],
        backward[2] * right[0] - backward[0] * right[2],
        -backward[1] * right[0]
      ];
      return { backward, right, up };
    },
    orbit(deltaX, deltaY) {
      yaw += deltaX * DRAG_RADIANS_PER_PIXEL;
      pitch = clamp(pitch + deltaY * DRAG_RADIANS_PER_PIXEL, PITCH_MINIMUM, PITCH_MAXIMUM);
      emit();
    },
    zoom(wheelDelta) {
      distanceScale = clamp(distanceScale * (wheelDelta > 0 ? WHEEL_OUT : WHEEL_IN), DISTANCE_MINIMUM, DISTANCE_MAXIMUM);
      emit();
    },
    snapTo(axis) {
      const pose = AXIS_POSE[axis];
      if (pose === void 0)
        throw new TypeError(`unknown view axis: ${String(axis)}`);
      yaw = pose[0];
      pitch = pose[1];
      emit();
    },
    reset() {
      yaw = RESET_YAW;
      pitch = RESET_PITCH;
      distanceScale = 1;
      emit();
    },
    set(pose) {
      if (pose.yaw !== void 0)
        yaw = pose.yaw;
      if (pose.pitch !== void 0)
        pitch = clamp(pose.pitch, PITCH_MINIMUM, PITCH_MAXIMUM);
      if (pose.distanceScale !== void 0) {
        distanceScale = clamp(pose.distanceScale, DISTANCE_MINIMUM, DISTANCE_MAXIMUM);
      }
      emit();
    },
    attach(host, signal) {
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      const options = signal === void 0 ? {} : { signal };
      host.addEventListener("pointerdown", (event) => {
        dragging = true;
        lastX = event.clientX;
        lastY = event.clientY;
        host.setPointerCapture(event.pointerId);
      }, options);
      host.addEventListener("pointermove", (event) => {
        if (!dragging)
          return;
        controller.orbit(event.clientX - lastX, event.clientY - lastY);
        lastX = event.clientX;
        lastY = event.clientY;
      }, options);
      const stop = () => {
        dragging = false;
      };
      host.addEventListener("pointerup", stop, options);
      host.addEventListener("pointercancel", stop, options);
      host.addEventListener("wheel", (event) => {
        event.preventDefault();
        controller.zoom(event.deltaY);
      }, { passive: false, ...options });
      host.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 40 : 12;
        if (event.key === "ArrowLeft")
          controller.orbit(-step, 0);
        else if (event.key === "ArrowRight")
          controller.orbit(step, 0);
        else if (event.key === "ArrowUp")
          controller.orbit(0, -step);
        else if (event.key === "ArrowDown")
          controller.orbit(0, step);
        else if (event.key === "+" || event.key === "=")
          controller.zoom(-1);
        else if (event.key === "-")
          controller.zoom(1);
        else if (event.key === "0")
          controller.reset();
        else
          return;
        event.preventDefault();
      }, options);
      return stop;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  return controller;
}

export {
  createOrbitController
};
