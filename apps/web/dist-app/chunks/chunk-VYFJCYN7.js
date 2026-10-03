import {
  collectEncodedMedia,
  createMediaShell,
  mediaFacts,
  mountContributedSections
} from "./chunk-7FYO6RSO.js";
import {
  VIDEO_FALLBACK_MESSAGES,
  ViewerMountScope,
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  rememberUiPreference,
  setState,
  setViewerText,
  uiPreference,
  unknownSourceLease,
  withEnglishUiFallback
} from "./chunk-HWKS7XZX.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// packages/ui/dist/video/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var VIDEO_MAXIMUM_BYTES = 256 * 1024 * 1024;
var POSTER_MAXIMUM_BYTES = 64 * 1024 * 1024;
function videoTrackLine(track) {
  return [
    track.codec,
    track.width === void 0 || track.height === void 0 ? void 0 : `${track.width}\xD7${track.height}`,
    track.frameRate === void 0 ? void 0 : `${Number(track.frameRate.toFixed(3))} fps`,
    track.language
  ].filter((part) => part !== void 0 && part !== "").join(" \xB7 ");
}
function remembered(key) {
  return uiPreference(key) === true;
}
function remember(key, value) {
  rememberUiPreference(key, value);
}
function metadataGroups(descriptor) {
  return "identity" in descriptor ? descriptor.metadata ?? [] : [];
}
function createVideoViewer(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, VIDEO_FALLBACK_MESSAGES);
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("viewer.video"));
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...args.gallery === void 0 ? {} : { gallery: args.gallery }
      });
      root.append(shell.root);
      scope.cleanup(() => shell.destroy());
      if (args.gallery !== void 0)
        void shell.refreshGallery(scope.signal).catch(() => void 0);
      const stage = element(shell.stage, "div", { part: "video" });
      const readout = element(stage, "output", { part: "video.readout" });
      const player = element(stage, "video", { part: "video.player" });
      player.controls = true;
      player.preload = "metadata";
      player.loop = remembered("video.loop");
      player.autoplay = remembered("video.autoplay");
      const lease = await unknownSourceLease(args.sources, args.slot, "common.view/video-media-source");
      if (lease === void 0)
        throw new TypeError("video binding is unavailable");
      scope.lease(lease);
      setState(stage, ["loading"]);
      try {
        const source = lease.value;
        const [info, encoded] = await Promise.all([
          source.info(scope.signal),
          source.encoded(scope.signal)
        ]);
        const media = await collectEncodedMedia(encoded, VIDEO_MAXIMUM_BYTES, scope.signal);
        const objectUrl = URL.createObjectURL(new Blob([media.bytes], { type: media.mediaType }));
        player.src = objectUrl;
        scope.cleanup(() => URL.revokeObjectURL(objectUrl));
        const duration = info.durationMs === "unknown" ? localizer.text("viewer.durationUnknown") : `${info.durationMs} ms`;
        const videoTracks = info.tracks.filter((track) => track.kind === "video");
        const audioTracks = info.tracks.filter((track) => track.kind === "audio");
        setViewerText(readout, localizer.text("viewer.videoSummary", {
          video: videoTracks.length,
          audio: audioTracks.length,
          duration
        }));
        const rows = [
          [localizer.text("viewer.videoTracks"), String(videoTracks.length)],
          [localizer.text("viewer.audioTracks"), String(audioTracks.length)],
          [localizer.text("viewer.duration"), duration],
          [localizer.text("viewer.mediaType"), media.mediaType],
          // each track's codec, picture size and frame rate, as MK2's media panel listed them
          ...info.tracks.map((track, index) => [
            localizer.text("viewer.videoTrack", { kind: track.kind, index: index + 1 }),
            videoTrackLine(track)
          ])
        ];
        const section = shell.section("video", localizer.text("viewer.video"), {
          icon: "device-camera-video"
        }).body;
        mediaFacts(section, rows);
        const playback = element(section, "div", { part: "video.options" });
        for (const [key, label, apply] of [
          [
            "video.loop",
            localizer.text("viewer.videoLoop"),
            (on) => {
              player.loop = on;
            }
          ],
          [
            "video.autoplay",
            localizer.text("viewer.videoAutoplay"),
            (on) => {
              player.autoplay = on;
              if (on && player.paused)
                void player.play().catch(() => void 0);
            }
          ]
        ]) {
          const option = element(playback, "label");
          const box = element(option, "input");
          box.type = "checkbox";
          box.checked = remembered(key);
          option.append(" ", label);
          box.addEventListener("change", () => {
            remember(key, box.checked);
            apply(box.checked);
          });
        }
        const first = videoTracks[0];
        if (info.frameAccess && source.readFrame !== void 0 && first !== void 0) {
          void source.readFrame({
            trackId: first.id,
            timestampMs: 0,
            pixelFormat: "rgba8",
            maxBytes: POSTER_MAXIMUM_BYTES
          }, scope.signal).then((frame) => {
            if (scope.signal.aborted || frame.pixelFormat !== "rgba8")
              return;
            const canvas = root.ownerDocument.createElement("canvas");
            canvas.width = frame.width;
            canvas.height = frame.height;
            const context = canvas.getContext("2d");
            if (context === null)
              return;
            const image = context.createImageData(frame.width, frame.height);
            for (let row = 0; row < frame.height; row += 1) {
              image.data.set(frame.pixels.subarray(row * frame.rowStride, row * frame.rowStride + frame.width * 4), row * frame.width * 4);
            }
            context.putImageData(image, 0, 0);
            player.poster = canvas.toDataURL("image/png");
          }).catch(() => void 0);
        }
        for (const group of metadataGroups(args.descriptor)) {
          if (/^(identity|traits|detection)$/iu.test(group.id))
            continue;
          mediaFacts(shell.section(`metadata:${group.id}`, group.label, {
            icon: "symbol-misc",
            collapsed: true
          }).body, group.entries.map((entry) => [entry.key, String(entry.value)]));
        }
        args.status?.set([
          {
            id: "duration",
            icon: "watch",
            text: duration,
            align: "start"
          },
          {
            id: "tracks",
            icon: "layers",
            text: localizer.text("viewer.videoTrackCount", {
              video: videoTracks.length,
              audio: audioTracks.length
            }),
            align: "start"
          }
        ]);
        scope.cleanup(() => args.status?.clear());
        setState(stage, []);
      } catch (error) {
        setState(stage, ["error"]);
        player.remove();
        element(stage, "p", {
          part: "viewer.empty",
          text: localizer.text("viewer.videoPlayError", {
            reason: error instanceof Error ? error.message : String(error)
          })
        });
      }
      mountContributedSections(shell, options.sections, args, (unmount) => scope.cleanup(unmount));
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset["revision"] = descriptor.revision;
      });
    }
  });
}
var videoViewer = createVideoViewer();

export {
  VIDEO_MAXIMUM_BYTES,
  videoTrackLine,
  createVideoViewer,
  videoViewer
};
