/**
 * FFmpeg layer: probe, aspect conversion (blurred fill / crop / pad), trim
 * and duration caps, intro/outro concatenation, hardsub burn-in, audio
 * extraction and audio-to-waveform video.
 *
 * All operations go through fluent-ffmpeg so paths are passed as arguments
 * (no shell interpolation).
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { AspectRatioMode, FillMode } from "@prisma/client";
import ffmpeg from "fluent-ffmpeg";

import { env } from "@/lib/env";

ffmpeg.setFfmpegPath(env.FFMPEG_PATH);
ffmpeg.setFfprobePath(env.FFPROBE_PATH);

const exec = promisify(execFile);
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;

export class MediaError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "MediaError";
  }
}

export type ProbeResult = {
  durationSec?: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  frameRate?: number;
};

export const ASPECT_DIMENSIONS: Record<Exclude<AspectRatioMode, "SOURCE">, { width: number; height: number }> = {
  PORTRAIT_9_16: { width: 1080, height: 1920 },
  LANDSCAPE_16_9: { width: 1920, height: 1080 },
  SQUARE_1_1: { width: 1080, height: 1080 },
};

export async function probe(file: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (error, data) => {
      if (error) {
        reject(new MediaError("ffprobe could not read the media file", error.message));
        return;
      }
      const video = data.streams.find((stream) => stream.codec_type === "video");
      const audio = data.streams.find((stream) => stream.codec_type === "audio");
      const duration = Number(data.format.duration ?? video?.duration ?? 0);
      resolve({
        durationSec: Number.isFinite(duration) && duration > 0 ? duration : undefined,
        width: video?.width,
        height: video?.height,
        hasVideo: Boolean(video),
        hasAudio: Boolean(audio),
        frameRate: video?.avg_frame_rate ? Number(video.avg_frame_rate.split("/")[0]) : undefined,
      });
    });
  });
}

function ffmpegArgs(stage: string, error: unknown, stderr?: string | null): MediaError {
  const tail = stderr?.split("\n").slice(-15).join("\n");
  return new MediaError(`${stage} failed`, tail || (error instanceof Error ? error.message : undefined));
}

function escapeFilterPath(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
}

export function subtitleFilter(srtPath: string): string {
  return `subtitles=filename='${escapeFilterPath(srtPath)}':force_style='FontName=DejaVu Sans,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0,MarginV=48'`;
}

/** Resolves the target frame size for an aspect/fill combination. */
export function targetDimensions(
  aspect: AspectRatioMode,
  source?: { width?: number; height?: number },
): { width: number; height: number } {
  if (aspect === "SOURCE") {
    const width = source?.width ?? 1080;
    const height = source?.height ?? 1920;
    return { width: width - (width % 2), height: height - (height % 2) };
  }
  return ASPECT_DIMENSIONS[aspect];
}

/**
 * Builds the filter chains for one video stream, ending in [v].
 * Blur mode composites a blurred cover background under a letterboxed copy.
 */
export function buildAspectChains(
  aspect: AspectRatioMode,
  fill: FillMode,
  dimensions: { width: number; height: number },
  /** Forces fill/crop into explicit dimensions even when aspect is SOURCE. */
  forceFit = false,
): string[] {
  const { width: w, height: h } = dimensions;
  const suffix = "setsar=1,fps=30[v]";

  if (!forceFit && aspect === "SOURCE") {
    return [`[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,${suffix}`];
  }

  if (fill === "CROP") {
    return [`[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${suffix}`];
  }

  if (fill === "PAD") {
    return [
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,${suffix}`,
    ];
  }

  return [
    "[0:v]split=2[bg][fg]",
    `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=luma_radius=40:luma_power=2[bgblur]`,
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgscaled]`,
    `[bgblur][fgscaled]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,${suffix}`,
  ];
}

function withSubtitles(chains: string[], srtPath?: string | null): string[] {
  if (!srtPath) return chains;
  const last = chains[chains.length - 1];
  chains[chains.length - 1] = last.replace(/\[v\]$/, `,${subtitleFilter(srtPath)}[v]`);
  return chains;
}

export type NormalizeOptions = {
  input: string;
  output: string;
  aspect?: AspectRatioMode;
  fill?: FillMode;
  /** Explicit output size, used when normalizing clips for concatenation. */
  width?: number;
  height?: number;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
  maxDurationSec?: number | null;
  subtitlePath?: string | null;
  /** Adds silent audio when the source has none (required for concat). */
  ensureAudio?: boolean;
};

export type NormalizeResult = { width: number; height: number; durationSec?: number };

export async function normalizeClip(options: NormalizeOptions): Promise<NormalizeResult> {
  const info = await probe(options.input);
  const aspect = options.aspect ?? "SOURCE";
  const fill = options.fill ?? "BLUR";
  const dimensions =
    options.width && options.height
      ? { width: options.width, height: options.height }
      : targetDimensions(aspect, info);

  const start = Math.max(0, options.trimStartSec ?? 0);
  const available = info.durationSec ? Math.max(0.1, info.durationSec - start) : undefined;
  const capCandidates = [
    options.trimEndSec != null ? options.trimEndSec - start : Number.POSITIVE_INFINITY,
    options.maxDurationSec ?? Number.POSITIVE_INFINITY,
    available ?? Number.POSITIVE_INFINITY,
  ];
  const cap = Math.min(...capCandidates);
  const capValue = Number.isFinite(cap) ? Math.max(0.1, cap) : undefined;

  const chains = withSubtitles(
    buildAspectChains(aspect, fill, dimensions, Boolean(options.width && options.height)),
    options.subtitlePath,
  );

  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg(options.input);
    if (start > 0) command.inputOptions(["-ss", start.toFixed(3)]);

    let audioMap = "0:a?";
    if (options.ensureAudio && !info.hasAudio) {
      command.input("anullsrc=channel_layout=stereo:sample_rate=48000").inputFormat("lavfi");
      if (capValue) command.inputOptions(["-t", capValue.toFixed(3)]);
      audioMap = "1:a";
    }

    command
      .complexFilter(chains, "v")
      .outputOptions([
        "-map",
        audioMap,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ar",
        "48000",
        "-ac",
        "2",
        ...(capValue ? ["-t", capValue.toFixed(3)] : []),
        "-movflags",
        "+faststart",
      ])
      .on("error", (error, _stdout, stderr) => reject(ffmpegArgs("Video render", error, stderr)))
      .on("end", () => resolve())
      .save(options.output);
  });

  const rendered = await probe(options.output).catch(() => undefined);
  return {
    width: rendered?.width ?? dimensions.width,
    height: rendered?.height ?? dimensions.height,
    durationSec: rendered?.durationSec ?? capValue,
  };
}

/** Concatenates already-normalized clips (same codec/resolution/fps). */
export async function concatClips(inputs: string[], output: string): Promise<void> {
  if (inputs.length === 0) throw new MediaError("No clips to concatenate");
  if (inputs.length === 1) {
    await copyFile(inputs[0], output);
    return;
  }

  const listPath = path.join(path.dirname(output), `concat-${randomUUID()}.txt`);
  const lines = inputs.map((input) => `file '${input.replace(/'/g, "'\\''")}'`);
  await writeFile(listPath, `${lines.join("\n")}\n`, "utf8");

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions(["-c", "copy", "-movflags", "+faststart"])
        .on("error", (error, _stdout, stderr) => reject(ffmpegArgs("Clip concatenation", error, stderr)))
        .on("end", () => resolve())
        .save(output);
    });
  } finally {
    await rm(listPath, { force: true });
  }
}

export async function burnSubtitles(input: string, output: string, srtPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(input)
      .videoFilters(subtitleFilter(srtPath))
      .outputOptions([
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
      ])
      .on("error", (error, _stdout, stderr) => reject(ffmpegArgs("Subtitle burn-in", error, stderr)))
      .on("end", () => resolve())
      .save(output);
  });
}

export async function extractAudio(
  input: string,
  output: string,
  options: { bitrate?: string } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(input)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate(options.bitrate ?? "192k")
      .on("error", (error, _stdout, stderr) => reject(ffmpegArgs("Audio extraction", error, stderr)))
      .on("end", () => resolve())
      .save(output);
  });
}

/** Podcast/MP3 -> vertical video with a waveform and dark background. */
export async function audioToWaveformVideo(
  input: string,
  output: string,
  dimensions: { width: number; height: number } = ASPECT_DIMENSIONS.PORTRAIT_9_16,
): Promise<void> {
  const info = await probe(input);
  const duration = Math.max(1, info.durationSec ?? 60);
  const { width, height } = dimensions;
  const waveHeight = Math.round(height * 0.2);

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(input)
      // Second input is a solid background; inputOptions apply to the last input.
      .input(`color=c=0x0b0b0f:s=${width}x${height}:r=30`)
      .inputFormat("lavfi")
      .inputOptions(["-t", duration.toFixed(3)])
      .complexFilter(
        [
          `[0:a]showwaves=s=${width}x${waveHeight}:mode=cline:colors=0x8b5cf6:rate=30[w]`,
          "[1:v][w]overlay=(W-w)/2:(H-h)/2[vo]",
        ],
        ["vo", "0:a"],
      )
      .outputOptions([
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-shortest",
        "-movflags",
        "+faststart",
      ])
      .on("error", (error, _stdout, stderr) => reject(ffmpegArgs("Waveform render", error, stderr)))
      .on("end", () => resolve())
      .save(output);
  });
}

/** Builds a silent slideshow video from normalized photos. */
export async function imagesToSlideshow(
  images: string[],
  output: string,
  dimensions: { width: number; height: number },
  secondsPerImage = 3,
): Promise<void> {
  if (images.length === 0) throw new MediaError("No images to build a slideshow from");

  const listPath = path.join(path.dirname(output), `slideshow-${randomUUID()}.txt`);
  const lines: string[] = [];
  for (const image of images) {
    lines.push(`file '${image.replace(/'/g, "'\\''")}'`, `duration ${secondsPerImage}`);
  }
  // The concat demuxer needs the final image repeated without a duration.
  lines.push(`file '${images[images.length - 1].replace(/'/g, "'\\''")}'`);
  await writeFile(listPath, `${lines.join("\n")}\n`, "utf8");

  const total = images.length * secondsPerImage;
  const { width, height } = dimensions;
  const chain = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v]`;

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .input("anullsrc=channel_layout=stereo:sample_rate=48000")
        .inputFormat("lavfi")
        .inputOptions(["-t", total.toFixed(3)])
        .complexFilter([chain], "v")
        .outputOptions([
          "-map",
          "1:a",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "21",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "160k",
          "-t",
          total.toFixed(3),
          "-movflags",
          "+faststart",
        ])
        .on("error", (error, _stdout, stderr) => reject(ffmpegArgs("Slideshow render", error, stderr)))
        .on("end", () => resolve())
        .save(output);
    });
  } finally {
    await rm(listPath, { force: true });
  }
}

export async function extractFrame(input: string, output: string, atSec = 0): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(input)
      .seekInput(Math.max(0, atSec))
      .frames(1)
      .outputOptions(["-q:v", "2"])
      .on("error", (error, _stdout, stderr) => reject(ffmpegArgs("Thumbnail extraction", error, stderr)))
      .on("end", () => resolve())
      .save(output);
  });
}

/** Raw ffmpeg escape hatch for diagnostics (e.g. `-version` in health checks). */
export async function ffmpegBinaryVersion(): Promise<string> {
  const { stdout } = await exec(env.FFMPEG_PATH, ["-version"], { timeout: 5000 });
  return stdout.split("\n")[0] ?? "";
}
