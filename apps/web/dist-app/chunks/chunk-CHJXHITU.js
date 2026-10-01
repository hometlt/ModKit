import {
  collectEncodedMedia,
  createMediaShell,
  mountContributedSections
} from "./chunk-BZC27BIS.js";
import {
  AUDIO_FALLBACK_MESSAGES,
  ViewerMountScope,
  createSurface,
  createViewerMount,
  defineViewerModule,
  element,
  setState,
  setViewerText,
  unknownSourceLease,
  withEnglishUiFallback
} from "./chunk-DYNIDBAC.js";
import {
  init_define_MODKIT_EMBED_EXTENSION_ORIGINS
} from "./chunk-BLWUC7LO.js";

// ../MODDING/modkit-core/packages/ui/dist/audio/index.js
init_define_MODKIT_EMBED_EXTENSION_ORIGINS();
var AUDIO_MAXIMUM_BYTES = 96 * 1024 * 1024;
var WAVEFORM_BUCKETS = 900;
var AUDIO_MAXIMUM_PCM_FRAMES = 10 * 60 * 48e3;
var AUDIO_PCM_WINDOW_FRAMES = 1 << 18;
var AUDIO_RATES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);
function computePeaks(channelData, buckets) {
  const frames = channelData[0]?.length ?? 0;
  const peaks = new Float32Array(buckets * 2);
  if (frames === 0)
    return peaks;
  const step = Math.max(1, Math.floor(frames / buckets));
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = bucket * step;
    const to = Math.min(frames, from + step);
    let minimum = 0;
    let maximum = 0;
    for (const channel of channelData) {
      for (let at = from; at < to; at += 1) {
        const value = channel[at];
        if (value < minimum)
          minimum = value;
        if (value > maximum)
          maximum = value;
      }
    }
    peaks[bucket * 2] = minimum;
    peaks[bucket * 2 + 1] = maximum;
  }
  return peaks;
}
function audioContextConstructor() {
  return globalThis.AudioContext ?? globalThis.webkitAudioContext;
}
async function collectCodecPcm(source, trackId, signal, onFrames = () => void 0) {
  if (source.readPcm === void 0)
    throw new TypeError("this source exposes no PCM");
  const windows = [];
  let sampleRate = 0;
  let channelCount = 0;
  let frames = 0;
  const maximumWindows = Math.ceil(AUDIO_MAXIMUM_PCM_FRAMES / AUDIO_PCM_WINDOW_FRAMES) + 1;
  for (let from = 0; frames < AUDIO_MAXIMUM_PCM_FRAMES; ) {
    if (windows.length >= maximumWindows) {
      throw new TypeError(`the codec returned ${windows.length} PCM windows without reaching the end of the track`);
    }
    const block = await source.readPcm({
      trackId,
      fromFrame: BigInt(from),
      frameCount: Math.min(AUDIO_PCM_WINDOW_FRAMES, AUDIO_MAXIMUM_PCM_FRAMES - frames),
      maxBytes: AUDIO_MAXIMUM_BYTES
    }, signal);
    if (block.frameCount === 0)
      break;
    if (block.fromFrame !== BigInt(from)) {
      throw new TypeError(`the codec answered from frame ${String(block.fromFrame)} when frame ${from} was requested`);
    }
    if (!Number.isSafeInteger(block.frameCount) || block.frameCount < 0) {
      throw new TypeError(`the codec reported ${String(block.frameCount)} PCM frames`);
    }
    if (!Number.isSafeInteger(block.channelCount) || block.channelCount <= 0) {
      throw new TypeError(`the codec reported ${String(block.channelCount)} channels`);
    }
    if (block.samples.length !== block.frameCount * block.channelCount) {
      throw new TypeError(`the codec sent ${block.samples.length} samples for ${block.frameCount} frames of ${block.channelCount} channels`);
    }
    sampleRate = block.sampleRate;
    channelCount = block.channelCount;
    windows.push({ samples: block.samples, frameCount: block.frameCount });
    frames += block.frameCount;
    from += block.frameCount;
    onFrames(frames);
  }
  if (frames === 0 || sampleRate <= 0)
    throw new TypeError("the codec decoded no PCM frames");
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  let offset = 0;
  for (const window of windows) {
    for (let frame = 0; frame < window.frameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const target = channels[channel];
        if (target !== void 0) {
          target[offset + frame] = window.samples[frame * channelCount + channel];
        }
      }
    }
    offset += window.frameCount;
  }
  return { sampleRate, channels, truncated: frames >= AUDIO_MAXIMUM_PCM_FRAMES };
}
async function loadTrack(source, info, track, context, signal, onPhase) {
  let buffer;
  let decodedBy;
  let mediaType;
  let sizeBytes;
  let truncated = false;
  if (info.pcmAccess && source.readPcm !== void 0 && track !== void 0) {
    onPhase("codec-pcm");
    const pcm = await collectCodecPcm(source, track.id, signal, (frames2) => onPhase(`codec-pcm:${frames2}`));
    const frames = pcm.channels[0]?.length ?? 0;
    buffer = context.createBuffer(Math.max(1, pcm.channels.length), frames, pcm.sampleRate);
    for (const [index, channel] of pcm.channels.entries()) {
      buffer.copyToChannel(channel, index);
    }
    sizeBytes = frames * Math.max(1, pcm.channels.length) * 4;
    decodedBy = "codec-pcm";
    truncated = pcm.truncated;
  } else {
    onPhase("encoded");
    const lease = await source.encoded(track?.id, signal);
    const media = await collectEncodedMedia(lease, AUDIO_MAXIMUM_BYTES, signal);
    mediaType = media.mediaType;
    sizeBytes = media.bytes.byteLength;
    onPhase("platform-decode");
    buffer = await context.decodeAudioData(media.bytes.slice().buffer);
    decodedBy = "platform-decoder";
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  onPhase("ready");
  return {
    model: {
      peaks: computePeaks(channels, WAVEFORM_BUCKETS),
      duration: buffer.duration,
      channels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
      bytes: sizeBytes
    },
    buffer,
    decodedBy,
    ...mediaType === void 0 ? {} : { mediaType },
    truncated
  };
}
var clock = (seconds) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
};
function audioTrackLine(track, index) {
  return [
    `#${index + 1}`,
    track.codec,
    track.channels === "unknown" ? void 0 : `${track.channels} ch`,
    track.sampleRate === "unknown" ? void 0 : `${(track.sampleRate / 1e3).toFixed(1)} kHz`,
    track.bitrateKbps === void 0 ? void 0 : `${track.bitrateKbps} kbps`,
    track.language
  ].filter((item) => item !== void 0).join(" \xB7 ");
}
function metadataGroups(descriptor) {
  return "identity" in descriptor ? descriptor.metadata ?? [] : [];
}
function containerOf(descriptor, mediaType) {
  const identity = "identity" in descriptor ? descriptor.identity : void 0;
  const type = mediaType ?? identity?.mediaType;
  if (identity === void 0)
    return type;
  return type === void 0 ? identity.formatLabel : `${identity.formatLabel} (${type})`;
}
function facts(parent, rows) {
  const list = element(parent, "dl", { part: "image.metadata" });
  for (const [label, value] of rows) {
    const row = element(list, "div", { part: "metadata.row" });
    element(row, "dt", { text: label, part: "metadata.label" });
    setViewerText(element(row, "dd", { part: "metadata.value" }), value, 512);
  }
}
function createAudioViewer(options = {}) {
  const localizer = withEnglishUiFallback(options.localizer, AUDIO_FALLBACK_MESSAGES);
  return defineViewerModule({
    abiVersion: 1,
    async mount(args) {
      const scope = new ViewerMountScope(args.signal);
      const root = createSurface(args.container, localizer.text("viewer.audio"));
      const shell = createMediaShell(root.ownerDocument, {
        localizer,
        ...args.gallery === void 0 ? {} : { gallery: args.gallery }
      });
      root.append(shell.root);
      scope.cleanup(() => shell.destroy());
      if (args.gallery !== void 0)
        void shell.refreshGallery(scope.signal).catch(() => void 0);
      const stage = element(shell.stage, "div", { part: "audio" });
      const toolbar = element(stage, "div", { part: "audio.toolbar", role: "toolbar" });
      toolbar.setAttribute("aria-label", localizer.text("viewer.audioControls"));
      const readout = element(stage, "output", { part: "audio.readout" });
      const notice = element(stage, "p", { part: "audio.notice" });
      notice.hidden = true;
      const failure = element(stage, "p", { part: "viewer.empty" });
      failure.hidden = true;
      const canvas = element(stage, "canvas", { part: "audio.waveform" });
      canvas.setAttribute("role", "img");
      const lease = await unknownSourceLease(args.sources, args.slot, "common.view/audio-media-source");
      if (lease === void 0)
        throw new TypeError("audio binding is unavailable");
      scope.lease(lease);
      const source = lease.value;
      let model;
      let cursor = 0;
      let audio;
      let gain;
      let buffer;
      let voice;
      let rate = 1;
      let volume = 1;
      let playing = false;
      let startedAt = 0;
      let decodedBy = "none";
      const context = canvas.getContext("2d");
      if (context === null)
        throw new TypeError("2d canvas context is unavailable");
      const paint = () => {
        if (model === void 0)
          return;
        const box = stage.getBoundingClientRect();
        const width = Math.max(160, Math.round(box.width - 16));
        const height = 120;
        canvas.width = width;
        canvas.height = height;
        const styles = getComputedStyle(root);
        const ink = styles.getPropertyValue("--mk-chart-categorical-1").trim() || "#4daafc";
        const ground = styles.getPropertyValue("--mk-color-sunken").trim() || "#181818";
        const guide = styles.getPropertyValue("--mk-color-border").trim() || "#2b2b2b";
        context.fillStyle = ground;
        context.fillRect(0, 0, width, height);
        context.strokeStyle = guide;
        context.beginPath();
        context.moveTo(0, height / 2);
        context.lineTo(width, height / 2);
        context.stroke();
        context.fillStyle = ink;
        const buckets = model.peaks.length / 2;
        for (let x = 0; x < width; x += 1) {
          const bucket = Math.min(buckets - 1, Math.floor(x / width * buckets));
          const minimum = model.peaks[bucket * 2];
          const maximum = model.peaks[bucket * 2 + 1];
          const top = (1 - maximum) * (height / 2);
          const bottom = (1 - minimum) * (height / 2);
          context.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
        if (cursor > 0 && model.duration > 0) {
          context.fillStyle = styles.getPropertyValue("--mk-color-accent").trim() || "#0078d4";
          context.fillRect(Math.round(cursor / model.duration * width), 0, 2, height);
        }
        setViewerText(readout, `${localizer.text("viewer.audioSummary", {
          position: clock(cursor),
          duration: clock(model.duration),
          channels: model.channels,
          rate: (model.sampleRate / 1e3).toFixed(1),
          size: (model.bytes / 1024).toFixed(0)
        })} \xB7 ${localizer.text("viewer.audioTransport", {
          state: localizer.text(playing ? "viewer.audioPlaying" : "viewer.audioPaused"),
          speed: rate.toFixed(2),
          decoder: decodedBy
        })}`);
        stage.dataset["transport"] = playing ? "playing" : "paused";
        stage.dataset["audioContext"] = audio?.state ?? "none";
        stage.dataset["rate"] = rate.toFixed(2);
        stage.dataset["decoder"] = decodedBy;
        stage.dataset["position"] = position().toFixed(3);
        stage.dataset["duration"] = model.duration.toFixed(3);
      };
      const position = () => {
        if (model === void 0)
          return 0;
        if (!playing || audio === void 0)
          return cursor;
        return Math.min(model.duration, cursor + (audio.currentTime - startedAt) * rate);
      };
      const stopVoice = () => {
        if (voice === void 0)
          return;
        voice.onended = null;
        try {
          voice.stop();
        } catch {
        }
        voice.disconnect();
        voice = void 0;
      };
      const pause = () => {
        if (!playing)
          return;
        cursor = position();
        playing = false;
        stopVoice();
      };
      const play = () => {
        if (playing || model === void 0)
          return;
        if (audio === void 0 || gain === void 0 || buffer === void 0)
          return;
        void audio.resume().catch(() => void 0);
        const next = audio.createBufferSource();
        next.buffer = buffer;
        next.playbackRate.value = rate;
        next.connect(gain);
        next.onended = () => {
          if (voice !== next)
            return;
          playing = false;
          cursor = 0;
          voice = void 0;
          paint();
        };
        startedAt = audio.currentTime;
        next.start(0, Math.min(cursor, Math.max(0, buffer.duration - 1e-3)));
        voice = next;
        playing = true;
      };
      const transportButton = (label, title, onClick) => {
        const node = element(toolbar, "button", {
          text: label,
          part: "operations.button"
        });
        node.type = "button";
        node.title = title;
        node.addEventListener("click", () => {
          onClick();
          paint();
        });
        scope.cleanup(() => node.replaceWith(node.cloneNode(true)));
      };
      transportButton("\u25B6", localizer.text("viewer.audioPlay"), () => play());
      transportButton("\u23F8", localizer.text("viewer.audioPause"), () => pause());
      transportButton("\u23EE", localizer.text("viewer.audioRestart"), () => {
        pause();
        cursor = 0;
      });
      transportButton("\xD7", localizer.text("viewer.audioCycleRate"), () => {
        const index = AUDIO_RATES.indexOf(rate);
        rate = AUDIO_RATES[(index + 1) % AUDIO_RATES.length] ?? 1;
        if (playing) {
          pause();
          play();
        }
      });
      const volumeInput = element(toolbar, "input");
      volumeInput.type = "range";
      volumeInput.min = "0";
      volumeInput.max = "1";
      volumeInput.step = "0.05";
      volumeInput.value = String(volume);
      volumeInput.title = localizer.text("viewer.audioVolume");
      volumeInput.setAttribute("aria-label", localizer.text("viewer.audioVolume"));
      volumeInput.addEventListener("input", () => {
        volume = Number(volumeInput.value);
        if (gain !== void 0)
          gain.gain.value = volume;
      }, { signal: scope.signal });
      canvas.addEventListener("click", (event) => {
        if (model === void 0)
          return;
        const box = canvas.getBoundingClientRect();
        const wasPlaying = playing;
        pause();
        cursor = (event.clientX - box.left) / box.width * model.duration;
        if (wasPlaying)
          play();
        paint();
      });
      const tick = setInterval(() => {
        if (playing)
          paint();
      }, 200);
      let loading;
      scope.cleanup(() => {
        clearInterval(tick);
        loading?.abort();
        stopVoice();
        void audio?.close().catch(() => void 0);
      });
      const fail = (error) => {
        setState(stage, ["error"]);
        canvas.hidden = true;
        failure.hidden = false;
        setViewerText(failure, localizer.text("viewer.audioDecodeError", {
          reason: error instanceof Error ? error.message : String(error)
        }));
      };
      const factsBody = shell.section("audio", localizer.text("viewer.audio"), {
        icon: "unmute"
      }).body;
      for (const group of metadataGroups(args.descriptor)) {
        if (/^(identity|traits|detection)$/iu.test(group.id))
          continue;
        facts(shell.section(`metadata:${group.id}`, group.label, {
          icon: "symbol-misc",
          collapsed: true
        }).body, group.entries.map((entry) => [entry.key, String(entry.value)]));
      }
      scope.cleanup(() => args.status?.clear());
      const show = async (info, track) => {
        loading?.abort();
        const controller = new AbortController();
        loading = controller;
        pause();
        cursor = 0;
        model = void 0;
        buffer = void 0;
        setState(stage, ["loading"]);
        stage.dataset["phase"] = "loading";
        try {
          if (audio === void 0) {
            const AudioContextCtor = audioContextConstructor();
            if (AudioContextCtor === void 0) {
              throw new TypeError("no platform audio decoder is available");
            }
            audio = new AudioContextCtor();
            gain = audio.createGain();
            gain.gain.value = volume;
            gain.connect(audio.destination);
          }
          const loaded = await loadTrack(source, info, track, audio, controller.signal, (phase) => {
            if (loading === controller)
              stage.dataset["phase"] = phase;
          });
          if (loading !== controller)
            return;
          model = loaded.model;
          buffer = loaded.buffer;
          decodedBy = loaded.decodedBy;
          setState(stage, []);
          canvas.hidden = false;
          failure.hidden = true;
          notice.hidden = !loaded.truncated;
          if (loaded.truncated) {
            setViewerText(notice, localizer.text("viewer.audioTruncated", { duration: clock(loaded.model.duration) }));
          }
          const container = containerOf(args.descriptor, loaded.mediaType);
          factsBody.replaceChildren();
          facts(factsBody, [
            [localizer.text("viewer.duration"), clock(loaded.model.duration)],
            [localizer.text("viewer.audioChannels"), String(loaded.model.channels)],
            [
              localizer.text("viewer.audioSampleRate"),
              `${(loaded.model.sampleRate / 1e3).toFixed(1)} kHz`
            ],
            ...track === void 0 ? [] : [[localizer.text("viewer.audioCodec"), track.codec]],
            ...track?.bitrateKbps === void 0 ? [] : [[localizer.text("viewer.audioBitrate"), `${track.bitrateKbps} kbps`]],
            ...container === void 0 ? [] : [[localizer.text("viewer.audioContainer"), container]],
            [localizer.text("viewer.audioSize"), `${(loaded.model.bytes / 1024).toFixed(0)} KiB`],
            [localizer.text("viewer.audioDecoder"), loaded.decodedBy]
          ]);
          args.status?.set([
            { id: "duration", icon: "watch", text: clock(loaded.model.duration), align: "start" },
            {
              id: "format",
              icon: "unmute",
              text: `${loaded.model.channels} ch \xB7 ${(loaded.model.sampleRate / 1e3).toFixed(1)} kHz`,
              align: "start"
            }
          ]);
          paint();
        } catch (error) {
          if (loading === controller)
            fail(error);
        }
      };
      setState(stage, ["loading"]);
      stage.dataset["phase"] = "info";
      try {
        const info = await source.info(scope.signal);
        const first = info.tracks.find((item) => item.selected) ?? info.tracks[0];
        if (info.tracks.length > 1) {
          const select = element(toolbar, "select");
          select.title = localizer.text("viewer.audioTracks");
          select.setAttribute("aria-label", localizer.text("viewer.audioTracks"));
          for (const [index, track] of info.tracks.entries()) {
            const option = element(select, "option", {
              text: audioTrackLine(track, index)
            });
            option.value = track.id;
          }
          if (first !== void 0)
            select.value = first.id;
          select.addEventListener("change", () => void show(info, info.tracks.find((track) => track.id === select.value)), { signal: scope.signal });
        }
        await show(info, first);
      } catch (error) {
        fail(error);
      }
      mountContributedSections(shell, options.sections, args, (unmount) => scope.cleanup(unmount));
      return createViewerMount(root, scope, args, ({ descriptor }) => {
        root.dataset["revision"] = descriptor.revision;
        paint();
      });
    }
  });
}
var audioViewer = createAudioViewer();

export {
  AUDIO_MAXIMUM_BYTES,
  WAVEFORM_BUCKETS,
  AUDIO_MAXIMUM_PCM_FRAMES,
  AUDIO_PCM_WINDOW_FRAMES,
  AUDIO_RATES,
  computePeaks,
  collectCodecPcm,
  audioTrackLine,
  createAudioViewer,
  audioViewer
};
