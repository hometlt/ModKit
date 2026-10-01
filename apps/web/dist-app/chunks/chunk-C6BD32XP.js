import {
  collectEncodedMedia,
  createMediaShell,
  mountContributedSections
} from "./chunk-XMM5M5LA.js";
import {
  VIDEO_FALLBACK_MESSAGES,
  ViewerMountScope,
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  unknownSourceLease,
  withEnglishUiFallback
} from "./chunk-BD2JSGWD.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/ui/dist/video/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var VIDEO_MAXIMUM_BYTES = 256 * 1024 * 1024;
function metadataGroups(descriptor) {
  return "identity" in descriptor ? descriptor.metadata ?? [] : [];
}
function facts(parent, rows) {
  const list = element(parent, "dl", { part: "image.metadata" });
  for (const [label, value] of rows) {
    const row = element(list, "div", { part: "metadata.row" });
    element(row, "dt", { text: label, part: "metadata.label" });
    setViewerText(element(row, "dd", { part: "metadata.value" }), value, 512);
  }
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
          [localizer.text("viewer.mediaType"), media.mediaType]
        ];
        facts(shell.section("video", localizer.text("viewer.video"), { icon: "device-camera-video" }).body, rows);
        for (const group of metadataGroups(args.descriptor)) {
          if (/^(identity|traits|detection)$/iu.test(group.id))
            continue;
          facts(shell.section(`metadata:${group.id}`, group.label, {
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
  createVideoViewer,
  videoViewer
};
