/**
 * Serializable workflow form contract shared by the builder (client) and the
 * server action. Keep values as strings in the UI; the action validates and
 * coerces them into Prisma enums.
 */

export type DestinationInput = {
  connectionId: string;
  targetMediaType: string;
  privacyStatus?: string | null;
  folderPath?: string | null;
  aspectRatio?: string | null;
  titleTemplate?: string | null;
  captionTemplate?: string | null;
  firstCommentTemplate?: string | null;
  maxDurationSec?: number | null;
};

export type WorkflowInput = {
  name: string;
  description?: string | null;
  isActive: boolean;
  sourceConnectionId: string;
  sourceMediaType: string;
  sourceCollection?: string | null;
  pollIntervalMinutes: number;
  mode: string;

  includeHashtags: string[];
  excludeHashtags: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  minDurationSec?: number | null;
  maxDurationSec?: number | null;
  importBacklog: boolean;
  backlogSince?: string | null;

  captionTemplate?: string | null;
  firstCommentTemplate?: string | null;
  captionPrefix?: string | null;
  captionSuffix?: string | null;
  stripHashtags: boolean;
  replaceHashtags: string[];
  preserveMentions: boolean;
  repurposeFirstComment: boolean;

  aspectRatio: string;
  fillMode: string;
  trimStartSec?: number | null;
  trimEndSec?: number | null;
  trimMaxDurationSec?: number | null;
  subtitleMode: string;
  audioMode: string;

  scheduleMode: string;
  dripMaxPerDay?: number | null;
  dripTimes: string[];
  timezone: string;

  destinations: DestinationInput[];
};

export const MEDIA_TYPE_OPTIONS = [
  { value: "ANY", label: "Any media" },
  { value: "SHORT_VIDEO", label: "Short video (TikTok, Reels, Shorts)" },
  { value: "VIDEO", label: "Long-form video" },
  { value: "STORY", label: "Story" },
  { value: "PHOTO", label: "Photo" },
  { value: "CAROUSEL", label: "Carousel" },
  { value: "AUDIO", label: "Audio / podcast" },
] as const;

export const ASPECT_OPTIONS = [
  { value: "SOURCE", label: "Keep source aspect ratio" },
  { value: "PORTRAIT_9_16", label: "9:16 vertical" },
  { value: "LANDSCAPE_16_9", label: "16:9 horizontal" },
  { value: "SQUARE_1_1", label: "1:1 square" },
] as const;

export const FILL_OPTIONS = [
  { value: "BLUR", label: "Blurred background fill" },
  { value: "CROP", label: "Smart center crop" },
  { value: "PAD", label: "Black bars" },
] as const;

export const PRIVACY_OPTIONS = [
  { value: "", label: "Platform default" },
  { value: "PUBLIC", label: "Public" },
  { value: "UNLISTED", label: "Unlisted" },
  { value: "PRIVATE", label: "Private" },
] as const;

export const AUTOMATION_OPTIONS = [
  { value: "AUTO_PUBLISH", label: "Auto-publish 24/7" },
  { value: "MANUAL_APPROVAL", label: "Manual approval queue" },
] as const;

export const SCHEDULE_OPTIONS = [
  { value: "IMMEDIATE", label: "Publish immediately" },
  { value: "DRIP", label: "Drip into time slots" },
] as const;

export const AUDIO_OPTIONS = [
  { value: "KEEP", label: "Keep audio" },
  { value: "EXTRACT_MP3", label: "Extract MP3" },
  { value: "WAVEFORM_VIDEO", label: "Waveform video" },
] as const;

export const SUBTITLE_OPTIONS = [
  { value: "NONE", label: "No subtitles" },
  { value: "BURN_IN", label: "Burn in uploaded .srt" },
] as const;

export const TARGET_MEDIA_OPTIONS = [
  { value: "SHORT_VIDEO", label: "Short video / Reel / Short" },
  { value: "VIDEO", label: "Long-form video" },
  { value: "STORY", label: "Story" },
  { value: "PHOTO", label: "Photo" },
  { value: "CAROUSEL", label: "Carousel" },
  { value: "AUDIO", label: "Audio" },
] as const;

/** Splits a comma/space separated input into trimmed values. */
export function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function joinList(values: string[]): string {
  return values.join(", ");
}
