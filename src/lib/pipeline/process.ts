/**
 * Processing pipeline: download → transform → caption render → thumbnail,
 * producing one video variant per unique aspect/fill/duration combination
 * required by the workflow's destinations.
 */
import { rename, rm } from "node:fs/promises";
import path from "node:path";

import type {
  AspectRatioMode,
  FillMode,
  MediaType,
  Prisma,
  Workflow,
  WorkflowDestination,
} from "@prisma/client";

import type { SourceMedia } from "@/lib/adapters/types";
import { prisma } from "@/lib/db";
import { withConnectionCookies } from "@/lib/media/cookies";
import { downloadHttpFile, downloadSourceMedia } from "@/lib/media/download";
import {
  audioToWaveformVideo,
  burnSubtitles,
  concatClips,
  extractAudio,
  extractFrame,
  imagesToSlideshow,
  normalizeClip,
  probe,
  targetDimensions,
} from "@/lib/media/ffmpeg";
import { makeThumbnail, normalizeImage, resizeImageCover } from "@/lib/media/images";
import { ensureItemMediaDir, resolveAssetPath } from "@/lib/media/storage";
import {
  parseArtifacts,
  parseSourceMedia,
  toJson,
  variantKey,
  type MediaArtifacts,
} from "@/lib/pipeline/artifacts";
import { buildCaption, buildFirstComment, buildTitle, normalizeHashtags } from "@/lib/pipeline/captions";
import { enqueuePublish } from "@/lib/pipeline/enqueue";
import { logJob } from "@/lib/pipeline/logger";
import { scheduleContentItem } from "@/lib/pipeline/schedule";

const CAPTION_LIMITS: Record<string, number> = {
  YOUTUBE: 5000,
  TIKTOK: 2200,
  INSTAGRAM: 2200,
  FACEBOOK: 63206,
  X: 280,
  LINKEDIN: 3000,
  SNAPCHAT: 250,
};

const TITLE_LIMITS: Record<string, number> = {
  YOUTUBE: 100,
  TIKTOK: 100,
  LINKEDIN: 200,
};

type MediaPlanKind = "video" | "audio" | "images";

type Spec = {
  key: string;
  use: "video" | "waveform" | "slideshow";
  aspect: AspectRatioMode;
  fill: FillMode;
  maxDurationSec: number | null;
};

function isVideoDestination(type: MediaType): boolean {
  return type === "VIDEO" || type === "SHORT_VIDEO" || type === "STORY";
}

function planKindFor(
  itemMediaType: MediaType,
  destination: WorkflowDestination,
  workflow: Workflow,
): MediaPlanKind {
  const videoish = isVideoDestination(destination.targetMediaType);

  if (itemMediaType === "AUDIO") {
    return videoish && workflow.audioMode === "WAVEFORM_VIDEO" ? "video" : "audio";
  }
  if (itemMediaType === "PHOTO" || itemMediaType === "CAROUSEL") {
    return videoish ? "video" : destination.targetMediaType === "AUDIO" ? "audio" : "images";
  }
  return videoish ? "video" : "audio";
}

async function safeUnlink(target: string): Promise<void> {
  await rm(target, { force: true }).catch(() => undefined);
}

export type ProcessResult = {
  status: "READY" | "SCHEDULED";
  variants: number;
  scheduledFor?: string;
  skipped?: boolean;
};

export async function processContentItem(
  contentItemId: string,
  options: { queueJobId?: string; force?: boolean; autoPublish?: boolean } = {},
): Promise<ProcessResult | { skipped: true }> {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: {
      workflow: { include: { prependIntro: true, appendOutro: true, subtitleAsset: true } },
      targets: { include: { destination: true, connection: true } },
      sourceConnection: true,
    },
  });

  if (!item) {
    throw new Error(`ContentItem ${contentItemId} no longer exists`);
  }
  if (!options.force && (item.status === "PUBLISHED" || item.status === "PUBLISHING")) {
    return { skipped: true };
  }

  const workflow = item.workflow;
  const startedAt = Date.now();
  const context = {
    workflowId: workflow.id,
    contentItemId: item.id,
    queueJobId: options.queueJobId ?? null,
  };

  await prisma.contentItem.update({
    where: { id: item.id },
    data: { status: "DOWNLOADING", attemptCount: { increment: 1 }, lastError: null },
  });

  try {
    const sourceMedia = parseSourceMedia(item.sourceMedia);
    if (sourceMedia.length === 0) {
      throw new Error("Source post has no downloadable media URLs");
    }

    const dir = await ensureItemMediaDir(item.id);
    const outDir = path.join(dir, "out");
    const artifacts: MediaArtifacts = {
      sources: [],
      variants: {},
      images: [],
      audio: null,
      thumbnail: null,
    };

    // 1. Download every source asset.
    const downloads: Array<{ media: SourceMedia; path: string }> = [];
    await withConnectionCookies(item.sourceConnectionId, async (cookiesFile) => {
      for (const [index, media] of sourceMedia.entries()) {
        const downloaded = await downloadSourceMedia(
          media,
          path.join(dir, "sources", `source-${index + 1}`),
          { cookiesFile },
        );
        downloads.push({ media, path: downloaded });
        artifacts.sources.push(downloaded);
        await logJob({
          ...context,
          stage: "DOWNLOAD",
          message: `Downloaded source asset ${index + 1}/${sourceMedia.length}`,
          data: { kind: media.kind, url: media.url },
        });
      }
    });

    await prisma.contentItem.update({ where: { id: item.id }, data: { status: "PROCESSING" } });

    const videoEntry = downloads.find((entry) => entry.media.kind === "video");
    const audioEntry = downloads.find((entry) => entry.media.kind === "audio");
    const imageEntries = downloads.filter((entry) => entry.media.kind === "image");
    const videoInfo = videoEntry ? await probe(videoEntry.path) : null;

    // 2. Carousel/photo normalization.
    for (const [index, entry] of imageEntries.entries()) {
      const imagePath = path.join(outDir, `image-${index + 1}.jpg`);
      await normalizeImage(entry.path, imagePath);
      artifacts.images.push(imagePath);
    }

    // 3. Plan destination media + unique video variants.
    const plans = new Map<string, { kind: MediaPlanKind; variantKey?: string }>();
    const specs = new Map<string, Spec>();

    for (const target of item.targets) {
      const kind = planKindFor(item.mediaType, target.destination, workflow);
      if (kind !== "video") {
        plans.set(target.id, { kind });
        continue;
      }

      const aspect = target.destination.aspectRatio ?? workflow.aspectRatio;
      const fill = target.destination.fillMode ?? workflow.fillMode;
      const maxDurationSec =
        target.destination.maxDurationSec ?? workflow.trimMaxDurationSec ?? null;
      const use: Spec["use"] =
        item.mediaType === "AUDIO"
          ? "waveform"
          : item.mediaType === "PHOTO" || item.mediaType === "CAROUSEL"
            ? "slideshow"
            : "video";
      const key = `${variantKey(aspect, fill, maxDurationSec)}-${use}`;

      specs.set(key, { key, use, aspect, fill, maxDurationSec });
      plans.set(target.id, { kind, variantKey: key });
    }

    // 4. Audio extraction when a destination needs audio or the workflow asks.
    let audioPath = audioEntry?.path ?? null;
    const needsAudio = [...plans.values()].some((plan) => plan.kind === "audio");
    if (!audioPath && (needsAudio || workflow.audioMode === "EXTRACT_MP3") && videoEntry) {
      const extracted = path.join(outDir, "audio.mp3");
      await extractAudio(videoEntry.path, extracted);
      audioPath = extracted;
    }
    if (audioPath && (needsAudio || workflow.audioMode === "EXTRACT_MP3")) {
      artifacts.audio = audioPath;
    }

    // 5. Intro/outro + subtitles are shared by all video variants.
    const introPath = workflow.prependIntro
      ? resolveAssetPath(workflow.prependIntro.storageKey)
      : null;
    const outroPath = workflow.appendOutro ? resolveAssetPath(workflow.appendOutro.storageKey) : null;
    const subtitlePath =
      workflow.subtitleMode !== "NONE" && workflow.subtitleAsset
        ? resolveAssetPath(workflow.subtitleAsset.storageKey)
        : null;

    // 6. Render each variant.
    for (const spec of specs.values()) {
      const variantStartedAt = Date.now();
      const output = path.join(outDir, `${spec.key}.mp4`);
      const dimensions = targetDimensions(
        spec.aspect,
        videoInfo ? { width: videoInfo.width, height: videoInfo.height } : undefined,
      );
      const temps: string[] = [];

      try {
        if (spec.use === "waveform") {
          if (!audioPath) throw new Error("Audio source is required for waveform video");
          await audioToWaveformVideo(audioPath, output, dimensions);
        } else if (spec.use === "slideshow") {
          if (artifacts.images.length === 0) {
            throw new Error("No photos available to build a slideshow");
          }
          // The concat demuxer needs identical frame sizes, so cover-resize
          // every photo to the target dimensions first.
          const frames: string[] = [];
          for (const [index, image] of artifacts.images.entries()) {
            const frame = path.join(outDir, `${spec.key}-frame-${index + 1}.jpg`);
            await resizeImageCover(image, frame, dimensions.width, dimensions.height);
            frames.push(frame);
            temps.push(frame);
          }
          await imagesToSlideshow(frames, output, dimensions);
        } else {
          if (!videoEntry) throw new Error("Video source is required for a video destination");

          const needsConcat = Boolean(introPath || outroPath);
          const needsBurn = Boolean(subtitlePath);
          // Per-item trim (queue UI) wins over the workflow defaults.
          const trimStartSec = item.trimStartSec ?? workflow.trimStartSec;
          const trimEndSec = item.trimEndSec ?? workflow.trimEndSec;
          const mainPath = needsConcat || needsBurn ? path.join(outDir, `${spec.key}-main.mp4`) : output;

          await normalizeClip({
            input: videoEntry.path,
            output: mainPath,
            aspect: spec.aspect,
            fill: spec.fill,
            trimStartSec,
            trimEndSec,
            maxDurationSec: spec.maxDurationSec,
            ensureAudio: needsConcat,
          });
          if (mainPath !== output) temps.push(mainPath);

          let current = mainPath;
          if (needsConcat) {
            const clips: string[] = [];
            if (introPath) {
              const introOut = path.join(outDir, `${spec.key}-intro.mp4`);
              await normalizeClip({
                input: introPath,
                output: introOut,
                aspect: "SOURCE",
                fill: spec.fill,
                width: dimensions.width,
                height: dimensions.height,
                ensureAudio: true,
              });
              clips.push(introOut);
              temps.push(introOut);
            }
            clips.push(mainPath);
            if (outroPath) {
              const outroOut = path.join(outDir, `${spec.key}-outro.mp4`);
              await normalizeClip({
                input: outroPath,
                output: outroOut,
                aspect: "SOURCE",
                fill: spec.fill,
                width: dimensions.width,
                height: dimensions.height,
                ensureAudio: true,
              });
              clips.push(outroOut);
              temps.push(outroOut);
            }

            const joined = path.join(outDir, `${spec.key}-joined.mp4`);
            await concatClips(clips, joined);
            temps.push(joined);
            current = joined;
          }

          if (subtitlePath) {
            await burnSubtitles(current, output, subtitlePath);
          } else if (current !== output) {
            await rename(current, output);
          }
        }

        const rendered = await probe(output);
        artifacts.variants[spec.key] = {
          path: output,
          width: rendered.width ?? dimensions.width,
          height: rendered.height ?? dimensions.height,
          durationSec: rendered.durationSec,
          aspect: spec.aspect,
        };

        await logJob({
          ...context,
          stage: "TRANSFORM",
          message: `Rendered variant ${spec.key}`,
          durationMs: Date.now() - variantStartedAt,
          data: {
            aspect: spec.aspect,
            fill: spec.fill,
            maxDurationSec: spec.maxDurationSec,
            width: rendered.width,
            height: rendered.height,
            durationSec: rendered.durationSec,
          },
        });
      } finally {
        for (const temp of temps) await safeUnlink(temp);
      }
    }

    // 7. Thumbnail (remote cover first, then a frame from the video).
    const thumbOut = path.join(outDir, "thumb.jpg");
    if (item.thumbnailUrl) {
      try {
        const cover = await downloadHttpFile(item.thumbnailUrl, path.join(dir, "sources", "cover"));
        await makeThumbnail(cover, thumbOut);
        artifacts.thumbnail = thumbOut;
      } catch (error) {
        await logJob({
          ...context,
          stage: "TRANSFORM",
          level: "WARN",
          message: "Cover thumbnail download failed — falling back to a video frame",
          error,
        });
      }
    }
    if (!artifacts.thumbnail && videoEntry) {
      try {
        const frame = path.join(outDir, "frame.jpg");
        await extractFrame(videoEntry.path, frame, 1);
        await makeThumbnail(frame, thumbOut);
        artifacts.thumbnail = thumbOut;
        await safeUnlink(frame);
      } catch {
        // Thumbnails are optional.
      }
    }
    if (!artifacts.thumbnail && artifacts.images.length > 0) {
      try {
        await makeThumbnail(artifacts.images[0], thumbOut);
        artifacts.thumbnail = thumbOut;
      } catch {
        // Thumbnails are optional.
      }
    }

    // 8. Render captions/titles/first comments per destination.
    const hashtags = normalizeHashtags(item.hashtags);
    for (const target of item.targets) {
      const plan = plans.get(target.id);
      const provider = target.connection.provider;
      const captionInput = {
        workflow,
        destination: target.destination,
        sourcePlatform: item.sourceConnection.provider,
        sourcePostId: item.sourcePostId,
        publishedAt: item.sourcePublishedAt,
        sourceUrl: item.sourceUrl,
        title: item.title,
        caption: item.caption,
        firstComment: item.firstComment,
        hashtags,
      };

      const caption = buildCaption(captionInput, CAPTION_LIMITS[provider]);
      const title = buildTitle(captionInput, TITLE_LIMITS[provider] ?? 100);
      const firstComment = buildFirstComment(captionInput);

      await prisma.publishTarget.update({
        where: { id: target.id },
        data: {
          caption,
          title,
          firstComment,
          ...(target.status === "PUBLISHED" ? {} : { status: "PENDING" as const }),
          metadata: {
            mediaKind: plan?.kind ?? "video",
            variantKey: plan?.variantKey ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    }

    const durationSec = videoInfo?.durationSec
      ? Math.round(videoInfo.durationSec)
      : (item.durationSec ?? null);

    await prisma.contentItem.update({
      where: { id: item.id },
      data: {
        status: "READY",
        processedAt: new Date(),
        durationSec,
        artifacts: toJson(artifacts),
        lastError: null,
      },
    });

    let scheduledFor: Date | null = null;
    if (workflow.mode === "AUTO_PUBLISH" && workflow.scheduleMode === "DRIP") {
      scheduledFor = await scheduleContentItem(item.id);
    }
    if ((workflow.mode === "AUTO_PUBLISH" || options.autoPublish) && !scheduledFor) {
      await enqueuePublish(item.id);
    }

    await logJob({
      ...context,
      stage: "TRANSFORM",
      message: `Processing complete: ${Object.keys(artifacts.variants).length} variant(s)`,
      durationMs: Date.now() - startedAt,
      data: {
        variants: Object.keys(artifacts.variants),
        images: artifacts.images.length,
        audio: Boolean(artifacts.audio),
        scheduledFor: scheduledFor?.toISOString() ?? null,
      },
    });

    return {
      status: scheduledFor ? "SCHEDULED" : "READY",
      variants: Object.keys(artifacts.variants).length,
      scheduledFor: scheduledFor?.toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.contentItem.update({
      where: { id: item.id },
      data: { status: "FAILED", lastError: message.slice(0, 4000) },
    });
    await logJob({
      ...context,
      stage: "TRANSFORM",
      message: "Processing failed",
      error,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}
